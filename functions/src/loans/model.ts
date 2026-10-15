import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";

import {sha256} from "../shared/hashing";
import {MONEY_CURRENCY} from "../shared/money";
import {workspaceRef, type WorkspaceRole} from "../shared/workspaceAuth";
import {
  LOAN_CASH_ENTRY_VERSION,
  loanCashEffect,
  type LoanCashEntry,
  type LoanCashFactKind,
  type LoanType,
} from "./cashEffect";
import type {
  LoanInstallmentPlan,
  LoanInterestTerms,
  LoanStatus,
} from "./schedule";

/**
 * Modelo autoritativo de empréstimos (D-13, P3-G).
 *
 * Coleções `workspaces/{wid}/loans` e `loan_movements`, com a marca
 * `schemaVersion: 1`. Só o backend grava (as Rules negam ao cliente toda
 * escrita nas duas coleções, P3-H). O schema autoritativo substituiu
 * diretamente o modelo anterior, sem migração: o DINDIN não tem dados reais
 * anteriores. Documento fora do schema é recusado (falha fechada).
 *
 * Contrato (`loans/{loanId}`):
 * - identidade e autoria: `id`, `workspaceId`, `profileType` (do workspace
 *   persistido), `createdBy`/`updatedBy` (do token), `createdAt`/`updatedAt`
 *   (servidor), `revision`, `requestHash` da criação;
 * - termos: `type` (`borrow`|`lend`), `principalCents`, `interest`
 *   (`none` | `fixed` com total | `percentage` com `ratePpm`, período e
 *   amortização), `startDate`, `firstDueDate`, `installmentsCount`,
 *   `schedule` (cronograma previsto, embutido: no máximo 360 parcelas, ~36 KB),
 *   `scheduledInterestCents`, `maturityDate` — imutáveis depois da criação;
 * - estado: `balanceCents` = principal − principal liquidado não estornado,
 *   `totalPrincipalSettledCents`, `totalInterestSettledCents`,
 *   `activePaymentCount` (liquidações não estornadas), `status` e
 *   `overdueFrom` derivados (`deriveLoanStatus`), vínculos com a contratação
 *   (`disbursementMovementId`, `disbursementTransactionId`);
 * - metadados: `personName`, `personContact`, `description` e, só em PJ,
 *   `counterpartyType`, `cnpjCpf`, `classification`, `costCenter`.
 *
 * Nenhum valor em reais e nenhum float é autoridade: não existem aqui
 * `principalValue`, `currentBalance` nem `amount`.
 */
export const LOAN_SCHEMA_VERSION = 1;
export const LOANS_COLLECTION = "loans";
export const LOAN_MOVEMENTS_COLLECTION = "loan_movements";
export const LOAN_EVENTS_COLLECTION = "loan_events";
export const LOAN_STATUS_SYSTEM_ACTOR = "system:loan-status";

export const LOAN_CASH_CATEGORY = "Empréstimos";

export type LoanEventOperation =
  | "loan.created"
  | "loan.payment_registered"
  | "loan.movement_reversed"
  | "loan.cancelled"
  | "loan.metadata_updated"
  | "loan.status_refreshed";

export type LoanMovementKind = "disbursement" | "payment" | "reversal";

export const loansRef = (workspaceId: string) =>
  workspaceRef(workspaceId).collection(LOANS_COLLECTION);
export const loanMovementsRef = (workspaceId: string) =>
  workspaceRef(workspaceId).collection(LOAN_MOVEMENTS_COLLECTION);
export const loanEventsRef = (workspaceId: string) =>
  workspaceRef(workspaceId).collection(LOAN_EVENTS_COLLECTION);

const hash40 = (value: string): string => sha256(value).slice(0, 40);

/** ID do contrato: hash de `(workspace, ator, chave)`, âncora da criação. */
export const loanIdFor = (
  workspaceId: string,
  uid: string,
  idempotencyKey: string,
): string => `loan_${hash40(`${workspaceId}:${uid}:${idempotencyKey}`)}`;

/** Intenção do ator, procurada em `loan_events` de qualquer workspace. */
export const loanIntentId = (uid: string, idempotencyKey: string): string =>
  sha256(`${uid}:${idempotencyKey}`).slice(0, 32);

export const disbursementMovementIdFor = (loanId: string): string =>
  `lmv_${hash40(`${loanId}:disbursement`)}`;
export const paymentMovementIdFor = (loanId: string, intentId: string) =>
  `lmv_${hash40(`${loanId}:payment:${intentId}`)}`;
/** Um movimento tem no máximo um estorno: o ID deriva do original. */
export const reversalMovementIdFor = (movementId: string): string =>
  `lmv_${hash40(`${movementId}:reversal`)}`;
/** Espelho de caixa: um por movimento, ID derivado do movimento. */
export const loanCashTransactionIdFor = (movementId: string): string =>
  `loancash_${movementId.replace(/^lmv_/, "")}`;

export const loanEventIdFor = (
  operation: LoanEventOperation,
  targetKey: string,
): string =>
  `${operation.replace(".", "_")}_${sha256(`${operation}:${targetKey}`)
    .slice(0, 32)}`;

export interface LoanFinancialState {
  principalCents: number;
  balanceCents: number;
  totalPrincipalSettledCents: number;
  totalInterestSettledCents: number;
  activePaymentCount: number;
  status: LoanStatus;
}

/** Instantâneo financeiro da auditoria: sem nome, contato ou documento. */
export const financialSnapshot = (
  state: LoanFinancialState,
): Record<string, number | string> => ({
  status: state.status,
  principalCents: state.principalCents,
  balanceCents: state.balanceCents,
  totalPrincipalSettledCents: state.totalPrincipalSettledCents,
  totalInterestSettledCents: state.totalInterestSettledCents,
  activePaymentCount: state.activePaymentCount,
});

const isText = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;
const isCount = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

/** Contrato autoritativo do workspace, lido como está, ou `null`. */
export interface AuthoritativeLoan extends LoanFinancialState {
  id: string;
  workspaceId: string;
  profileType: "PF" | "PJ";
  type: LoanType;
  createdBy: string;
  startDate: string;
  firstDueDate: string;
  installmentsCount: number;
  interest: LoanInterestTerms;
  schedule: LoanInstallmentPlan[];
  disbursementMovementId: string;
  disbursementTransactionId: string;
  updatedAt: Timestamp;
  revision: number;
  overdueFrom: string | null;
  requestHash: string;
}

const LOAN_STATUSES = new Set(["active", "overdue", "paid", "cancelled"]);

export const readAuthoritativeLoan = (
  id: string,
  data: admin.firestore.DocumentData | undefined,
  workspaceId: string,
): AuthoritativeLoan | null => {
  if (!data || data.schemaVersion !== LOAN_SCHEMA_VERSION) return null;
  if (
    data.workspaceId !== workspaceId ||
    (data.profileType !== "PF" && data.profileType !== "PJ") ||
    (data.type !== "borrow" && data.type !== "lend") ||
    !isText(data.createdBy) ||
    !isCount(data.principalCents) ||
    !isCount(data.balanceCents) ||
    !isCount(data.totalPrincipalSettledCents) ||
    !isCount(data.totalInterestSettledCents) ||
    !isCount(data.activePaymentCount) ||
    !LOAN_STATUSES.has(data.status) ||
    !Array.isArray(data.schedule) ||
    data.schedule.length !== data.installmentsCount ||
    !isText(data.disbursementMovementId) ||
    !isText(data.disbursementTransactionId) ||
    !(data.updatedAt instanceof Timestamp) ||
    data.balanceCents + data.totalPrincipalSettledCents !== data.principalCents
  ) {
    return null;
  }
  return {...data, id} as AuthoritativeLoan;
};

/** Movimento autoritativo do mesmo contrato, ou `null`. */
export interface AuthoritativeMovement {
  id: string;
  loanId: string;
  kind: LoanMovementKind;
  principalCents: number;
  interestCents: number;
  date: string;
  reversedBy: string | null;
  cashTransactionId: string;
  /** Conta/carteira movida pelo fato (D-30) e o movimento de conta. */
  cashAccountId: string;
  accountMovementId: string;
}

export const readAuthoritativeMovement = (
  id: string,
  data: admin.firestore.DocumentData | undefined,
  workspaceId: string,
  loanId: string,
): AuthoritativeMovement | null => {
  if (
    !data ||
    data.schemaVersion !== LOAN_SCHEMA_VERSION ||
    data.workspaceId !== workspaceId ||
    data.loanId !== loanId ||
    (data.kind !== "disbursement" && data.kind !== "payment" &&
      data.kind !== "reversal") ||
    !isCount(data.principalCents) ||
    !isCount(data.interestCents) ||
    !isText(data.date) ||
    !isText(data.cashTransactionId) ||
    // D-30: todo movimento de empréstimo moveu uma conta.
    !isText(data.cashAccountId) ||
    !isText(data.accountMovementId)
  ) {
    return null;
  }
  return {
    id,
    loanId,
    kind: data.kind,
    principalCents: data.principalCents,
    interestCents: data.interestCents,
    date: data.date,
    reversedBy: isText(data.reversedBy) ? data.reversedBy : null,
    cashTransactionId: data.cashTransactionId,
    cashAccountId: data.cashAccountId,
    accountMovementId: data.accountMovementId,
  };
};

export interface MovementDocumentInput {
  id: string;
  workspaceId: string;
  loanId: string;
  loanType: LoanType;
  kind: LoanMovementKind;
  /** No estorno: o tipo do fato estornado. */
  originalKind?: LoanCashFactKind;
  principalCents: number;
  interestCents: number;
  date: string;
  cashTransactionId: string;
  /** Conta/carteira movida (D-30) e o movimento de conta correspondente. */
  cashAccountId: string;
  accountMovementId: string;
  reversalOf: string | null;
  reason: string | null;
  actorUid: string;
  intentId: string | null;
  requestHash: string | null;
}

/**
 * Efeito do fato sobre a conta (D-30): o mesmo `netCents` do espelho de
 * caixa — tomado: contratação entra, liquidação sai (principal + juros);
 * concedido: o oposto; estorno com sinal invertido.
 */
export const loanMovementAccountCents = (input: {
  loanId: string;
  movementId: string;
  loanType: LoanType;
  kind: LoanMovementKind;
  originalKind?: LoanCashFactKind;
  reversalOf: string | null;
  principalCents: number;
  interestCents: number;
}): number => loanCashEffect(loanCashEntryFor({
  loanId: input.loanId,
  movementId: input.movementId,
  loanType: input.loanType,
  kind: input.kind === "reversal" ? input.originalKind ?? "payment" :
    input.kind,
  reversal: input.kind === "reversal",
  reversalOf: input.reversalOf,
  principalCents: input.principalCents,
  interestCents: input.interestCents,
})).netCents;

/** Fato do domínio: imutável, exceto o vínculo `reversedBy` do estorno. */
export const loanMovementDocument = (
  input: MovementDocumentInput,
): admin.firestore.DocumentData => {
  const cash = loanCashEntryFor({
    loanId: input.loanId,
    movementId: input.id,
    loanType: input.loanType,
    kind: input.kind === "reversal" ? input.originalKind ?? "payment" :
      input.kind,
    reversal: input.kind === "reversal",
    reversalOf: input.reversalOf,
    principalCents: input.principalCents,
    interestCents: input.interestCents,
  });
  const net = loanCashEffect(cash).netCents;
  return {
    id: input.id,
    schemaVersion: LOAN_SCHEMA_VERSION,
    workspaceId: input.workspaceId,
    loanId: input.loanId,
    loanType: input.loanType,
    kind: input.kind,
    ...(input.originalKind ? {originalKind: input.originalKind} : {}),
    principalCents: input.principalCents,
    interestCents: input.interestCents,
    totalCents: input.principalCents + input.interestCents,
    currency: MONEY_CURRENCY,
    cashDirection: net >= 0 ? "in" : "out",
    date: input.date,
    cashTransactionId: input.cashTransactionId,
    cashAccountId: input.cashAccountId,
    accountMovementId: input.accountMovementId,
    reversalOf: input.reversalOf,
    reversedBy: null,
    reason: input.reason,
    intentId: input.intentId,
    requestHash: input.requestHash,
    createdBy: input.actorUid,
    createdAt: FieldValue.serverTimestamp(),
  };
};

export const loanCashEntryFor = (input: {
  loanId: string;
  movementId: string;
  loanType: LoanType;
  kind: LoanCashFactKind;
  reversal: boolean;
  reversalOf: string | null;
  principalCents: number;
  interestCents: number;
}): LoanCashEntry => ({
  domainVersion: LOAN_CASH_ENTRY_VERSION,
  loanId: input.loanId,
  loanMovementId: input.movementId,
  loanType: input.loanType,
  kind: input.kind,
  reversal: input.reversal,
  principalCents: input.principalCents,
  interestCents: input.interestCents,
  currency: MONEY_CURRENCY,
  ...(input.reversal && input.reversalOf ?
    {reversalOf: input.reversalOf} :
    {}),
});

/**
 * Descrição genérica do espelho: nunca o nome, documento ou contato da
 * contraparte (o vínculo é pelo ID em `loanEntry`).
 */
const mirrorDescription = (entry: LoanCashEntry): string => {
  const base = entry.kind === "disbursement" ?
    (entry.loanType === "borrow" ? "Empréstimo recebido" :
      "Empréstimo concedido") :
    (entry.loanType === "borrow" ? "Pagamento de empréstimo" :
      "Recebimento de empréstimo");
  if (!entry.reversal) return base;
  return entry.kind === "disbursement" ?
    `Cancelamento: ${base.toLowerCase()}` :
    `Estorno: ${base.toLowerCase()}`;
};

/**
 * Espelho de caixa de um movimento, gravado no mesmo commit do movimento.
 *
 * `type`/`value` seguem a direção do caixa para os leitores atuais (lista,
 * saldo do frontend); a projeção decide por `loanEntry` (`cashEffect.ts`),
 * que separa principal de juros. `valueCents` torna o documento não
 * editável pelo cliente nas Rules, e `loanEntry` é chave negada ao cliente.
 * Não consome a quota manual `transactionsPerMonth` (D-40).
 */
export const loanCashMirrorDocument = (input: {
  workspaceId: string;
  profileType: "PF" | "PJ";
  actorUid: string;
  date: string;
  entry: LoanCashEntry;
  /** Conta/carteira movida pelo fato (D-30), para exibição. */
  cashAccountId: string;
}): admin.firestore.DocumentData => {
  const net = loanCashEffect(input.entry).netCents;
  const valueCents = Math.abs(net);
  return {
    type: net >= 0 ? "receita" : "despesa",
    description: mirrorDescription(input.entry),
    category: LOAN_CASH_CATEGORY,
    valueCents,
    date: input.date,
    isPaid: true,
    workspaceId: input.workspaceId,
    profileId: input.workspaceId,
    profileType: input.profileType,
    userId: input.actorUid,
    source: "loan",
    loanEntry: input.entry,
    cashAccountId: input.cashAccountId,
    createdBy: input.actorUid,
    updatedBy: input.actorUid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
};

export interface LoanEventInput {
  workspaceId: string;
  loanId: string;
  operation: LoanEventOperation;
  /** Chave do ID determinístico do evento (movimento ou intenção). */
  targetKey: string;
  actorId: string;
  actorRole: WorkspaceRole | null;
  profileType: "PF" | "PJ";
  intentId: string | null;
  requestHash: string | null;
  requestId: string;
  correlationId: string | null;
  movementId: string | null;
  before: Record<string, number | string> | null;
  after: Record<string, number | string> | null;
  /** Só nomes de campos: os valores de metadados pessoais não são copiados. */
  changedFields?: string[];
  reason: string | null;
  revision: number;
}

/** Auditoria append-only, no mesmo commit; `create` impede duplicidade. */
export const appendLoanEvent = (
  transaction: admin.firestore.Transaction,
  input: LoanEventInput,
): admin.firestore.DocumentReference => {
  const ref = loanEventsRef(input.workspaceId)
    .doc(loanEventIdFor(input.operation, input.targetKey));
  transaction.create(ref, {
    id: ref.id,
    schemaVersion: LOAN_SCHEMA_VERSION,
    workspaceId: input.workspaceId,
    loanId: input.loanId,
    operation: input.operation,
    actorId: input.actorId,
    actorRole: input.actorRole,
    profileType: input.profileType,
    intentId: input.intentId,
    requestHash: input.requestHash,
    requestId: input.requestId,
    correlationId: input.correlationId,
    movementId: input.movementId,
    before: input.before,
    after: input.after,
    changedFields: input.changedFields ?? [],
    reason: input.reason,
    revision: input.revision,
    createdAt: FieldValue.serverTimestamp(),
  });
  return ref;
};
