import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";

import {sha256} from "../shared/hashing";
import {MONEY_CURRENCY, isMoneyCents} from "../shared/money";
import {workspaceRef, type WorkspaceRole} from "../shared/workspaceAuth";

/**
 * Modelo autoritativo de contas/carteiras, movimentos e transferências
 * (D-30, P3-J).
 *
 * Coleções sob `workspaces/{wid}`, com `schemaVersion: 1`, gravadas só pelo
 * backend (as Rules negam ao cliente toda escrita). O modelo substituiu o
 * grupo genérico `wallet` do catálogo, sem migração: não há dados reais.
 * Documento fora do schema é recusado (falha fechada).
 *
 * - `cash_accounts/{accountId}`: nome, tipo (`accountType`), estado
 *   (`active`|`archived`) e `balanceCents` — saldo em centavos inteiros,
 *   negativo permitido, alterado só no mesmo commit de um movimento.
 *   `updatedAt`/`updatedBy` mudam só com nome, tipo e estado (é a versão que
 *   o cliente informa para editar); o saldo registra `lastMovementAt`.
 * - `cash_account_movements/{movementId}`: livro-razão imutável da conta.
 *   Cada movimento tem a conta, o tipo, o valor com sinal, a data efetiva, a
 *   origem (`sourceDomain`, `sourceId` e o fato `sourceFactId`), o vínculo de
 *   estorno (`reversalOf`) e quem/qual operação o gerou. Sem PII nem texto
 *   livre. O saldo da conta é sempre a soma dos seus movimentos.
 * - `cash_transfers/{transferId}`: transferência entre duas contas do mesmo
 *   workspace; nunca é receita nem despesa e não cria `transactions`.
 * - `cash_account_events`: auditoria append-only (owner/admin), sem PII.
 */
export const CASH_ACCOUNT_SCHEMA_VERSION = 1;

export const CASH_ACCOUNTS_COLLECTION = "cash_accounts";
export const CASH_ACCOUNT_MOVEMENTS_COLLECTION = "cash_account_movements";
export const CASH_TRANSFERS_COLLECTION = "cash_transfers";
export const CASH_ACCOUNT_EVENTS_COLLECTION = "cash_account_events";

export const CASH_ACCOUNT_TYPES =
  ["cash", "checking", "savings", "digital", "other"] as const;
export type CashAccountType = typeof CASH_ACCOUNT_TYPES[number];
export type CashAccountStatus = "active" | "archived";

export const CASH_ACCOUNT_MOVEMENT_KINDS = [
  "opening_balance",
  "cash_transaction",
  "loan",
  "receivable",
  "credit_card_payment",
  "split",
  "investment",
  "transfer_in",
  "transfer_out",
  "reversal",
] as const;
export type CashAccountMovementKind =
  typeof CASH_ACCOUNT_MOVEMENT_KINDS[number];

/**
 * Domínio que originou o movimento. `credit_card` (P4-A): pagamento de fatura
 * de cartão e o seu estorno, sempre na conta do pagamento original. `split`
 * (P4-C): despesa de título de divisão paga pelo Caixa e pagamento de
 * reembolso PJ, com as compensações na mesma conta. `investment` (P4-D,
 * D-15): aporte liquidado (saída) e retirada recebida (entrada), com o
 * estorno na conta do movimento original.
 */
export const CASH_ACCOUNT_SOURCE_DOMAINS = [
  "account",
  "cash",
  "loan",
  "receivable",
  "credit_card",
  "split",
  "investment",
  "transfer",
] as const;
export type CashAccountSourceDomain =
  typeof CASH_ACCOUNT_SOURCE_DOMAINS[number];

export type CashTransferStatus = "completed" | "reversed";

export type CashAccountEventOperation =
  | "cash_account.created"
  | "cash_account.updated"
  | "cash_account.archived"
  | "cash_account.reactivated"
  | "cash_transfer.created"
  | "cash_transfer.reversed";

/**
 * Teto do saldo de uma conta, nos dois sentidos: R$ 1 trilhão. Bem abaixo
 * de `Number.MAX_SAFE_INTEGER`, de modo que nenhuma soma de movimentos aceitos
 * sai dos inteiros seguros.
 */
export const CASH_ACCOUNT_BALANCE_LIMIT_CENTS = 100_000_000_000_000;

/**
 * Teto operacional de contas por workspace, ativas e arquivadas (não é quota
 * comercial). A lista, as escolhas de conta e o saldo geral do frontend leem
 * no máximo 100 contas — o teto de listagem das Rules —, então o backend não
 * deixa o workspace passar disso; a contagem é relida na transação.
 */
export const CASH_ACCOUNT_LIMIT_PER_WORKSPACE = 100;

export const cashAccountsRef = (workspaceId: string) =>
  workspaceRef(workspaceId).collection(CASH_ACCOUNTS_COLLECTION);
export const cashAccountMovementsRef = (workspaceId: string) =>
  workspaceRef(workspaceId).collection(CASH_ACCOUNT_MOVEMENTS_COLLECTION);
export const cashTransfersRef = (workspaceId: string) =>
  workspaceRef(workspaceId).collection(CASH_TRANSFERS_COLLECTION);
export const cashAccountEventsRef = (workspaceId: string) =>
  workspaceRef(workspaceId).collection(CASH_ACCOUNT_EVENTS_COLLECTION);

const hash40 = (value: string): string => sha256(value).slice(0, 40);

/** ID da conta: hash de `(workspace, ator, chave)`, âncora da criação. */
export const cashAccountIdFor = (
  workspaceId: string,
  uid: string,
  idempotencyKey: string,
): string => `acc_${hash40(`${workspaceId}:${uid}:${idempotencyKey}`)}`;

/**
 * Conta padrão do workspace recém-criado ("Carteira principal"): uma por
 * workspace, ID determinístico (o provisionamento só faz `create`).
 */
export const defaultCashAccountIdFor = (workspaceId: string): string =>
  `acc_${hash40(`${workspaceId}:default`)}`;

export const DEFAULT_CASH_ACCOUNT_NAME = "Carteira principal";

/** ID da transferência: hash de `(workspace, ator, chave)`. */
export const cashTransferIdFor = (
  workspaceId: string,
  uid: string,
  idempotencyKey: string,
): string => `trf_${hash40(`${workspaceId}:${uid}:${idempotencyKey}`)}`;

/** Intenção do ator, procurada nos eventos de qualquer workspace. */
export const accountIntentIdFor = (uid: string, idempotencyKey: string) =>
  sha256(`${uid}:${idempotencyKey}`).slice(0, 32);

/**
 * ID determinístico do movimento: o mesmo fato gera sempre o mesmo ID, e o
 * `create` do segundo commit aborta em vez de duplicar.
 *
 * `slot` distingue os efeitos de um mesmo registro — a aplicação e a
 * compensação de cada revisão de um lançamento, as duas pernas de uma
 * transferência e os seus estornos.
 */
export const cashAccountMovementIdFor = (
  domain: CashAccountSourceDomain,
  sourceId: string,
  slot: string,
): string => `acm_${hash40(`${domain}:${sourceId}:${slot}`)}`;

export const openingBalanceMovementIdFor = (accountId: string): string =>
  cashAccountMovementIdFor("account", accountId, "opening");

/** Lançamento manual: aplicação e compensação por revisão do lançamento. */
export const cashEntryMovementIdFor = (
  transactionId: string,
  effect: "apply" | "reverse",
  revision: number,
): string => cashAccountMovementIdFor(
  "cash", transactionId, `${effect}:${revision}`);

/** Movimento de empréstimo: um por movimento do domínio. */
export const loanAccountMovementIdFor = (loanMovementId: string): string =>
  cashAccountMovementIdFor("loan", loanMovementId, "account");

/** Movimento de recebível: um por movimento do domínio com dinheiro. */
export const receivableAccountMovementIdFor = (
  receivableMovementId: string,
): string => cashAccountMovementIdFor(
  "receivable", receivableMovementId, "account");

/** Pagamento de fatura de cartão (ou o seu estorno): um por fato. */
export const creditCardPaymentAccountMovementIdFor = (
  paymentId: string,
): string => cashAccountMovementIdFor("credit_card", paymentId, "account");

/** Fato da Divisão de contas no Caixa (ou a sua compensação): um por fato. */
export const splitAccountMovementIdFor = (transactionId: string): string =>
  cashAccountMovementIdFor("split", transactionId, "account");

/**
 * Movimento de investimento com dinheiro (aporte liquidado, retirada
 * recebida ou o estorno de um deles): um por movimento do domínio.
 */
export const investmentAccountMovementIdFor = (
  investmentMovementId: string,
): string => cashAccountMovementIdFor(
  "investment", investmentMovementId, "account");

export const transferMovementIdFor = (
  transferId: string,
  leg: "out" | "in",
  reversal: boolean,
): string => cashAccountMovementIdFor(
  "transfer", transferId, reversal ? `${leg}:reversal` : leg);

const eventIdFor = (operation: string, targetKey: string): string =>
  `${operation.replace(".", "_")}_${sha256(`${operation}:${targetKey}`)
    .slice(0, 32)}`;

export const cashAccountEventIdFor = (
  operation: CashAccountEventOperation,
  targetKey: string,
): string => eventIdFor(operation, targetKey);

const isText = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const isDayKeyText = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

export const isCashAccountBalance = (value: unknown): value is number =>
  isMoneyCents(value) &&
  Math.abs(value) <= CASH_ACCOUNT_BALANCE_LIMIT_CENTS;

// -------------------------------------------------------------------- conta

export interface AuthoritativeCashAccount {
  id: string;
  workspaceId: string;
  name: string;
  accountType: CashAccountType;
  status: CashAccountStatus;
  balanceCents: number;
  createdBy: string;
  updatedAt: Timestamp;
}

export const readAuthoritativeCashAccount = (
  id: string,
  data: admin.firestore.DocumentData | undefined,
  workspaceId: string,
): AuthoritativeCashAccount | null => {
  if (
    !data ||
    data.schemaVersion !== CASH_ACCOUNT_SCHEMA_VERSION ||
    data.id !== id ||
    data.workspaceId !== workspaceId ||
    !isText(data.name) ||
    !(CASH_ACCOUNT_TYPES as readonly string[]).includes(data.accountType) ||
    (data.status !== "active" && data.status !== "archived") ||
    !isCashAccountBalance(data.balanceCents) ||
    data.currency !== MONEY_CURRENCY ||
    !isText(data.createdBy) ||
    !(data.updatedAt instanceof Timestamp)
  ) {
    return null;
  }
  return {
    id,
    workspaceId,
    name: data.name,
    accountType: data.accountType,
    status: data.status,
    balanceCents: data.balanceCents === 0 ? 0 : data.balanceCents,
    createdBy: data.createdBy,
    updatedAt: data.updatedAt,
  };
};

/** Documento da conta recém-criada: saldo zero até o primeiro movimento. */
export const cashAccountDocument = (input: {
  id: string;
  workspaceId: string;
  name: string;
  accountType: CashAccountType;
  actorUid: string;
}): admin.firestore.DocumentData => ({
  id: input.id,
  schemaVersion: CASH_ACCOUNT_SCHEMA_VERSION,
  workspaceId: input.workspaceId,
  name: input.name,
  accountType: input.accountType,
  status: "active",
  balanceCents: 0,
  currency: MONEY_CURRENCY,
  createdBy: input.actorUid,
  updatedBy: input.actorUid,
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
});

// ---------------------------------------------------------------- movimento

export interface CashAccountMovementInput {
  id: string;
  accountId: string;
  kind: CashAccountMovementKind;
  /** Centavos com sinal: entrada positiva, saída negativa; nunca zero. */
  amountCents: number;
  effectiveDate: string;
  sourceDomain: CashAccountSourceDomain;
  /** Registro de origem: lançamento, empréstimo, recebível, transferência. */
  sourceId: string;
  /** Fato de origem: movimento do domínio, revisão do lançamento etc. */
  sourceFactId: string;
  /** No estorno: o movimento de conta compensado. */
  reversalOf: string | null;
}

export interface AuthoritativeCashAccountMovement {
  id: string;
  accountId: string;
  kind: CashAccountMovementKind;
  amountCents: number;
  effectiveDate: string;
  sourceDomain: CashAccountSourceDomain;
  sourceId: string;
  sourceFactId: string;
  reversalOf: string | null;
}

export const readAuthoritativeCashAccountMovement = (
  id: string,
  data: admin.firestore.DocumentData | undefined,
  workspaceId: string,
): AuthoritativeCashAccountMovement | null => {
  if (
    !data ||
    data.schemaVersion !== CASH_ACCOUNT_SCHEMA_VERSION ||
    data.id !== id ||
    data.workspaceId !== workspaceId ||
    !isText(data.accountId) ||
    !(CASH_ACCOUNT_MOVEMENT_KINDS as readonly string[]).includes(data.kind) ||
    !isCashAccountBalance(data.amountCents) ||
    data.amountCents === 0 ||
    !isDayKeyText(data.effectiveDate) ||
    !(CASH_ACCOUNT_SOURCE_DOMAINS as readonly string[])
      .includes(data.sourceDomain) ||
    !isText(data.sourceId) ||
    !isText(data.sourceFactId) ||
    (data.reversalOf !== null && !isText(data.reversalOf))
  ) {
    return null;
  }
  return {
    id,
    accountId: data.accountId,
    kind: data.kind,
    amountCents: data.amountCents,
    effectiveDate: data.effectiveDate,
    sourceDomain: data.sourceDomain,
    sourceId: data.sourceId,
    sourceFactId: data.sourceFactId,
    reversalOf: data.reversalOf,
  };
};

/** Fato imutável do livro-razão da conta. */
export const cashAccountMovementDocument = (input: {
  workspaceId: string;
  movement: CashAccountMovementInput;
  actorUid: string;
  operation: string;
  requestId: string;
}): admin.firestore.DocumentData => ({
  id: input.movement.id,
  schemaVersion: CASH_ACCOUNT_SCHEMA_VERSION,
  workspaceId: input.workspaceId,
  accountId: input.movement.accountId,
  kind: input.movement.kind,
  amountCents: input.movement.amountCents,
  currency: MONEY_CURRENCY,
  effectiveDate: input.movement.effectiveDate,
  sourceDomain: input.movement.sourceDomain,
  sourceId: input.movement.sourceId,
  sourceFactId: input.movement.sourceFactId,
  reversalOf: input.movement.reversalOf,
  actorId: input.actorUid,
  operation: input.operation,
  requestId: input.requestId,
  createdAt: FieldValue.serverTimestamp(),
});

// ----------------------------------------------------------- transferência

export interface AuthoritativeCashTransfer {
  id: string;
  workspaceId: string;
  sourceAccountId: string;
  destinationAccountId: string;
  amountCents: number;
  date: string;
  status: CashTransferStatus;
  outMovementId: string;
  inMovementId: string;
  createdBy: string;
  updatedAt: Timestamp;
}

export const readAuthoritativeCashTransfer = (
  id: string,
  data: admin.firestore.DocumentData | undefined,
  workspaceId: string,
): AuthoritativeCashTransfer | null => {
  if (
    !data ||
    data.schemaVersion !== CASH_ACCOUNT_SCHEMA_VERSION ||
    data.id !== id ||
    data.workspaceId !== workspaceId ||
    !isText(data.sourceAccountId) ||
    !isText(data.destinationAccountId) ||
    data.sourceAccountId === data.destinationAccountId ||
    !isMoneyCents(data.amountCents) ||
    data.amountCents <= 0 ||
    !isDayKeyText(data.date) ||
    (data.status !== "completed" && data.status !== "reversed") ||
    !isText(data.outMovementId) ||
    !isText(data.inMovementId) ||
    !isText(data.createdBy) ||
    !(data.updatedAt instanceof Timestamp)
  ) {
    return null;
  }
  return {
    id,
    workspaceId,
    sourceAccountId: data.sourceAccountId,
    destinationAccountId: data.destinationAccountId,
    amountCents: data.amountCents,
    date: data.date,
    status: data.status,
    outMovementId: data.outMovementId,
    inMovementId: data.inMovementId,
    createdBy: data.createdBy,
    updatedAt: data.updatedAt,
  };
};

// ---------------------------------------------------------------- auditoria

export interface CashAccountEventInput {
  workspaceId: string;
  operation: CashAccountEventOperation;
  /** Chave do ID determinístico do evento (uma vez por fato). */
  targetKey: string;
  accountId: string | null;
  transferId: string | null;
  actorId: string;
  actorRole: WorkspaceRole;
  intentId: string;
  requestHash: string;
  requestId: string;
  correlationId: string | null;
  before: Record<string, number | string | null> | null;
  after: Record<string, number | string | null> | null;
  changedFields?: string[];
  reason: string | null;
}

/** Auditoria append-only: IDs, centavos e nomes de campos; sem PII. */
export const appendCashAccountEvent = (
  transaction: admin.firestore.Transaction,
  input: CashAccountEventInput,
): string => {
  const ref = cashAccountEventsRef(input.workspaceId)
    .doc(cashAccountEventIdFor(input.operation, input.targetKey));
  transaction.create(ref, {
    id: ref.id,
    schemaVersion: CASH_ACCOUNT_SCHEMA_VERSION,
    workspaceId: input.workspaceId,
    operation: input.operation,
    accountId: input.accountId,
    transferId: input.transferId,
    actorId: input.actorId,
    actorRole: input.actorRole,
    intentId: input.intentId,
    requestHash: input.requestHash,
    requestId: input.requestId,
    correlationId: input.correlationId,
    before: input.before,
    after: input.after,
    changedFields: input.changedFields ?? [],
    reason: input.reason,
    createdAt: FieldValue.serverTimestamp(),
  });
  return ref.id;
};
