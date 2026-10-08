import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";

import {transactionInstant} from "../cash/createTransaction";
import {sha256} from "../shared/hashing";
import {MONEY_CURRENCY} from "../shared/money";
import {workspaceRef, type WorkspaceRole} from "../shared/workspaceAuth";
import {
  RECEIVABLE_CASH_ENTRY_VERSION,
  receiptCashCents,
  type ReceivableCashEntry,
} from "./cashEffect";

/**
 * Modelo autoritativo de clientes e recebíveis (D-24, D-39, P3-I).
 *
 * Coleções sob `workspaces/{wid}`, com a marca `schemaVersion: 1`, gravadas
 * só pelo backend (as Rules negam ao cliente toda escrita). O modelo
 * substituiu diretamente o anterior, sem migração: não há dados reais.
 * Documento fora do schema é recusado pelas operações (falha fechada).
 *
 * - `clients/{clientId}`: só o compartilhado com o workspace — `clientId`,
 *   `workspaceId`, `name`, `status` (`active`|`archived`), autoria,
 *   timestamps e `schemaVersion`. Nada derivado do payload (nem hash): o
 *   hash da intenção cobre os dados pessoais e fica só no evento privado.
 * - `client_private/{clientId}`: dados pessoais (D-24) — documento, e-mail,
 *   telefone, endereço e observações. Leitura só owner/admin.
 * - `receivables/{receivableId}`: `amountCents` (principal contratado),
 *   acumulados (`principalReceivedCents`, `discountGrantedCents`,
 *   `interestReceivedCents`, `penaltyReceivedCents`), `balanceCents`
 *   = amount − principal recebido − desconto, `activeReceiptCount`,
 *   `dueDate` civil e `status` (`open`|`received`|`cancelled`). Atraso não é
 *   persistido: é `open` com `dueDate` antes de hoje em São Paulo.
 * - `receivable_movements/{movementId}`: recebimento (`receipt`) e estorno
 *   (`reversal`), fatos imutáveis exceto o vínculo `reversedBy`.
 * - `client_events`, `receivable_events`: auditoria append-only, sem PII.
 */
export const CLIENT_SCHEMA_VERSION = 1;
export const RECEIVABLE_SCHEMA_VERSION = 1;

export const CLIENTS_COLLECTION = "clients";
export const CLIENT_PRIVATE_COLLECTION = "client_private";
export const CLIENT_EVENTS_COLLECTION = "client_events";
export const RECEIVABLES_COLLECTION = "receivables";
export const RECEIVABLE_MOVEMENTS_COLLECTION = "receivable_movements";
export const RECEIVABLE_EVENTS_COLLECTION = "receivable_events";

export const RECEIVABLE_CASH_CATEGORY = "Recebíveis";

export type ClientStatus = "active" | "archived";
export type ReceivableStatus = "open" | "received" | "cancelled";
export type ReceivableMovementKind = "receipt" | "reversal";

export type ClientEventOperation =
  | "client.created"
  | "client.updated"
  | "client.archived";

export type ReceivableEventOperation =
  | "receivable.created"
  | "receivable.updated"
  | "receivable.received"
  | "receivable.receipt_reversed"
  | "receivable.cancelled";

export const clientsRef = (workspaceId: string) =>
  workspaceRef(workspaceId).collection(CLIENTS_COLLECTION);
export const clientPrivateRef = (workspaceId: string) =>
  workspaceRef(workspaceId).collection(CLIENT_PRIVATE_COLLECTION);
export const clientEventsRef = (workspaceId: string) =>
  workspaceRef(workspaceId).collection(CLIENT_EVENTS_COLLECTION);
export const receivablesRef = (workspaceId: string) =>
  workspaceRef(workspaceId).collection(RECEIVABLES_COLLECTION);
export const receivableMovementsRef = (workspaceId: string) =>
  workspaceRef(workspaceId).collection(RECEIVABLE_MOVEMENTS_COLLECTION);
export const receivableEventsRef = (workspaceId: string) =>
  workspaceRef(workspaceId).collection(RECEIVABLE_EVENTS_COLLECTION);

const hash40 = (value: string): string => sha256(value).slice(0, 40);

/** ID do cliente: hash de `(workspace, ator, chave)`, âncora da criação. */
export const clientIdFor = (
  workspaceId: string,
  uid: string,
  idempotencyKey: string,
): string => `cli_${hash40(`${workspaceId}:${uid}:${idempotencyKey}`)}`;

/** ID do recebível: hash de `(workspace, ator, chave)`, âncora da criação. */
export const receivableIdFor = (
  workspaceId: string,
  uid: string,
  idempotencyKey: string,
): string => `rcv_${hash40(`${workspaceId}:${uid}:${idempotencyKey}`)}`;

/** Intenção do ator, procurada nos eventos de qualquer workspace. */
export const intentIdFor = (uid: string, idempotencyKey: string): string =>
  sha256(`${uid}:${idempotencyKey}`).slice(0, 32);

export const receiptMovementIdFor = (receivableId: string, intentId: string) =>
  `rmv_${hash40(`${receivableId}:receipt:${intentId}`)}`;
/** Um recebimento tem no máximo um estorno: o ID deriva do original. */
export const reversalMovementIdFor = (movementId: string): string =>
  `rmv_${hash40(`${movementId}:reversal`)}`;
/** Espelho de caixa: um por movimento com dinheiro, ID do movimento. */
export const receivableCashTransactionIdFor = (movementId: string): string =>
  `recvcash_${movementId.replace(/^rmv_/, "")}`;

const eventIdFor = (operation: string, targetKey: string): string =>
  `${operation.replace(".", "_")}_${sha256(`${operation}:${targetKey}`)
    .slice(0, 32)}`;

const isText = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;
const isCount = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

// ------------------------------------------------------------------ cliente

export interface AuthoritativeClient {
  id: string;
  workspaceId: string;
  name: string;
  status: ClientStatus;
  createdBy: string;
  updatedAt: Timestamp;
}

export const readAuthoritativeClient = (
  id: string,
  data: admin.firestore.DocumentData | undefined,
  workspaceId: string,
): AuthoritativeClient | null => {
  if (!data || data.schemaVersion !== CLIENT_SCHEMA_VERSION) return null;
  if (
    data.clientId !== id ||
    data.workspaceId !== workspaceId ||
    !isText(data.name) ||
    (data.status !== "active" && data.status !== "archived") ||
    !isText(data.createdBy) ||
    !(data.updatedAt instanceof Timestamp)
  ) {
    return null;
  }
  return {
    id,
    workspaceId,
    name: data.name,
    status: data.status,
    createdBy: data.createdBy,
    updatedAt: data.updatedAt,
  };
};

// ---------------------------------------------------------------- recebível

export interface ReceivableFinancialState {
  amountCents: number;
  principalReceivedCents: number;
  discountGrantedCents: number;
  interestReceivedCents: number;
  penaltyReceivedCents: number;
  balanceCents: number;
  activeReceiptCount: number;
  status: ReceivableStatus;
}

export interface AuthoritativeReceivable extends ReceivableFinancialState {
  id: string;
  workspaceId: string;
  clientId: string;
  description: string;
  category: string | null;
  dueDate: string;
  createdBy: string;
  revision: number;
  requestHash: string;
  updatedAt: Timestamp;
}

const RECEIVABLE_STATUSES = new Set(["open", "received", "cancelled"]);

/** Saldo = principal contratado − principal recebido − desconto. */
export const balanceOf = (state: Pick<ReceivableFinancialState,
  "amountCents" | "principalReceivedCents" | "discountGrantedCents">,
): number =>
  state.amountCents - state.principalReceivedCents - state.discountGrantedCents;

/**
 * Status persistido: `cancelled` é terminal; senão `received` se e somente
 * se o saldo é zero; senão `open`. Atraso não é status.
 */
export const deriveReceivableStatus = (
  cancelled: boolean,
  balanceCents: number,
): ReceivableStatus =>
  cancelled ? "cancelled" : balanceCents === 0 ? "received" : "open";

/** Atraso derivado: em aberto com vencimento antes de hoje (São Paulo). */
export const isReceivableOverdue = (
  receivable: Pick<ReceivableFinancialState, "status"> & {dueDate: string},
  today: string,
): boolean => receivable.status === "open" && receivable.dueDate < today;

/** Invariantes D-39; `false` = estado impossível, recusar. */
export const isConsistentReceivableState = (
  state: ReceivableFinancialState,
): boolean =>
  isCount(state.amountCents) && state.amountCents > 0 &&
  isCount(state.principalReceivedCents) &&
  isCount(state.discountGrantedCents) &&
  isCount(state.interestReceivedCents) &&
  isCount(state.penaltyReceivedCents) &&
  isCount(state.activeReceiptCount) &&
  isCount(state.balanceCents) &&
  state.balanceCents === balanceOf(state) &&
  RECEIVABLE_STATUSES.has(state.status) &&
  (state.status === "cancelled" ?
    state.activeReceiptCount === 0 :
    (state.status === "received") === (state.balanceCents === 0));

export const readAuthoritativeReceivable = (
  id: string,
  data: admin.firestore.DocumentData | undefined,
  workspaceId: string,
): AuthoritativeReceivable | null => {
  if (!data || data.schemaVersion !== RECEIVABLE_SCHEMA_VERSION) return null;
  if (
    data.id !== id ||
    data.workspaceId !== workspaceId ||
    !isText(data.clientId) ||
    !isText(data.description) ||
    !isText(data.dueDate) ||
    !isText(data.createdBy) ||
    !isCount(data.revision) ||
    !(data.updatedAt instanceof Timestamp) ||
    !isConsistentReceivableState(data as ReceivableFinancialState)
  ) {
    return null;
  }
  return {
    id,
    workspaceId,
    clientId: data.clientId,
    description: data.description,
    category: isText(data.category) ? data.category : null,
    dueDate: data.dueDate,
    createdBy: data.createdBy,
    revision: data.revision,
    requestHash: String(data.requestHash ?? ""),
    updatedAt: data.updatedAt,
    amountCents: data.amountCents,
    principalReceivedCents: data.principalReceivedCents,
    discountGrantedCents: data.discountGrantedCents,
    interestReceivedCents: data.interestReceivedCents,
    penaltyReceivedCents: data.penaltyReceivedCents,
    balanceCents: data.balanceCents,
    activeReceiptCount: data.activeReceiptCount,
    status: data.status,
  };
};

/** Instantâneo financeiro da auditoria: sem descrição, cliente ou PII. */
export const receivableSnapshot = (
  state: ReceivableFinancialState,
): Record<string, number | string> => ({
  status: state.status,
  amountCents: state.amountCents,
  balanceCents: state.balanceCents,
  principalReceivedCents: state.principalReceivedCents,
  discountGrantedCents: state.discountGrantedCents,
  interestReceivedCents: state.interestReceivedCents,
  penaltyReceivedCents: state.penaltyReceivedCents,
  activeReceiptCount: state.activeReceiptCount,
});

export const receivableStatePatch = (
  state: ReceivableFinancialState,
  actorUid: string,
  revision: number,
): admin.firestore.DocumentData => ({
  amountCents: state.amountCents,
  principalReceivedCents: state.principalReceivedCents,
  discountGrantedCents: state.discountGrantedCents,
  interestReceivedCents: state.interestReceivedCents,
  penaltyReceivedCents: state.penaltyReceivedCents,
  balanceCents: state.balanceCents,
  activeReceiptCount: state.activeReceiptCount,
  status: state.status,
  revision,
  updatedBy: actorUid,
  updatedAt: FieldValue.serverTimestamp(),
});

// ---------------------------------------------------------------- movimentos

export interface AuthoritativeReceivableMovement {
  id: string;
  receivableId: string;
  kind: ReceivableMovementKind;
  principalCents: number;
  interestCents: number;
  penaltyCents: number;
  discountCents: number;
  date: string;
  cashTransactionId: string | null;
  reversedBy: string | null;
  /** Conta movida (D-30) e o movimento de conta; `null` sem dinheiro. */
  cashAccountId: string | null;
  accountMovementId: string | null;
}

export const readAuthoritativeReceivableMovement = (
  id: string,
  data: admin.firestore.DocumentData | undefined,
  workspaceId: string,
  receivableId: string,
): AuthoritativeReceivableMovement | null => {
  if (
    !data ||
    data.schemaVersion !== RECEIVABLE_SCHEMA_VERSION ||
    data.id !== id ||
    data.workspaceId !== workspaceId ||
    data.receivableId !== receivableId ||
    (data.kind !== "receipt" && data.kind !== "reversal") ||
    !isCount(data.principalCents) ||
    !isCount(data.interestCents) ||
    !isCount(data.penaltyCents) ||
    !isCount(data.discountCents) ||
    !isText(data.date) ||
    (data.cashTransactionId !== null && !isText(data.cashTransactionId)) ||
    // D-30: com dinheiro, conta e movimento de conta; sem, nenhum dos dois.
    (data.cashTransactionId === null ?
      data.cashAccountId !== null || data.accountMovementId !== null :
      !isText(data.cashAccountId) || !isText(data.accountMovementId))
  ) {
    return null;
  }
  return {
    id,
    receivableId,
    kind: data.kind,
    principalCents: data.principalCents,
    interestCents: data.interestCents,
    penaltyCents: data.penaltyCents,
    discountCents: data.discountCents,
    date: data.date,
    cashTransactionId: data.cashTransactionId,
    reversedBy: isText(data.reversedBy) ? data.reversedBy : null,
    cashAccountId: data.cashAccountId,
    accountMovementId: data.accountMovementId,
  };
};

export interface ReceivableMovementInput {
  id: string;
  workspaceId: string;
  receivableId: string;
  clientId: string;
  kind: ReceivableMovementKind;
  principalCents: number;
  interestCents: number;
  penaltyCents: number;
  discountCents: number;
  date: string;
  cashTransactionId: string | null;
  /** Conta movida (D-30) e o movimento de conta; `null` sem dinheiro. */
  cashAccountId: string | null;
  accountMovementId: string | null;
  reversalOf: string | null;
  reason: string | null;
  actorUid: string;
  intentId: string;
  requestHash: string;
}

/** Fato do domínio: imutável, exceto o vínculo `reversedBy` do estorno. */
export const receivableMovementDocument = (
  input: ReceivableMovementInput,
): admin.firestore.DocumentData => ({
  id: input.id,
  schemaVersion: RECEIVABLE_SCHEMA_VERSION,
  workspaceId: input.workspaceId,
  receivableId: input.receivableId,
  clientId: input.clientId,
  kind: input.kind,
  principalCents: input.principalCents,
  interestCents: input.interestCents,
  penaltyCents: input.penaltyCents,
  discountCents: input.discountCents,
  cashCents: receiptCashCents(input),
  currency: MONEY_CURRENCY,
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
});

// --------------------------------------------------------- espelho de caixa

export const receivableCashEntryFor = (input: {
  receivableId: string;
  movementId: string;
  clientId: string;
  reversal: boolean;
  reversalOf: string | null;
  principalCents: number;
  interestCents: number;
  penaltyCents: number;
  discountCents: number;
}): ReceivableCashEntry => ({
  domainVersion: RECEIVABLE_CASH_ENTRY_VERSION,
  receivableId: input.receivableId,
  receivableMovementId: input.movementId,
  clientId: input.clientId,
  kind: "receipt",
  reversal: input.reversal,
  principalCents: input.principalCents,
  interestCents: input.interestCents,
  penaltyCents: input.penaltyCents,
  discountCents: input.discountCents,
  currency: MONEY_CURRENCY,
  ...(input.reversal && input.reversalOf ?
    {reversalOf: input.reversalOf} :
    {}),
});

/**
 * Espelho de caixa do recebimento, no mesmo commit do movimento.
 *
 * `type`/`value` seguem a direção do caixa para os leitores atuais; a
 * projeção decide por `receivableEntry`. Descrição genérica: nunca o nome do
 * cliente, documento, contato ou a descrição do recebível. `valueCents`
 * torna o documento não editável pelo cliente nas Rules. Não consome a quota
 * manual `transactionsPerMonth` (D-40).
 */
export const receivableCashMirrorDocument = (input: {
  workspaceId: string;
  actorUid: string;
  date: string;
  entry: ReceivableCashEntry;
  /** Conta movida pelo recebimento (D-30), para exibição. */
  cashAccountId: string;
}): admin.firestore.DocumentData => {
  const valueCents = receiptCashCents(input.entry);
  return {
    type: input.entry.reversal ? "despesa" : "receita",
    description: input.entry.reversal ?
      "Estorno: recebimento de recebível" : "Recebimento de recebível",
    category: RECEIVABLE_CASH_CATEGORY,
    value: valueCents / 100,
    valueCents,
    date: input.date,
    transactionDate: transactionInstant(input.date),
    isPaid: true,
    workspaceId: input.workspaceId,
    profileId: input.workspaceId,
    profileType: "PJ",
    userId: input.actorUid,
    source: "receivable",
    receivableEntry: input.entry,
    cashAccountId: input.cashAccountId,
    createdBy: input.actorUid,
    updatedBy: input.actorUid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
};

// ------------------------------------------------------------------ eventos

interface EventBase {
  workspaceId: string;
  /** Chave do ID determinístico do evento (alvo do fato ou intenção). */
  targetKey: string;
  actorId: string;
  actorRole: WorkspaceRole | null;
  intentId: string;
  requestHash: string;
  requestId: string;
  correlationId: string | null;
  /** Só nomes de campos: valores pessoais e textos livres não são copiados. */
  changedFields?: string[];
}

export const clientEventIdFor = (
  operation: ClientEventOperation,
  targetKey: string,
): string => eventIdFor(operation, targetKey);

export const receivableEventIdFor = (
  operation: ReceivableEventOperation,
  targetKey: string,
): string => eventIdFor(operation, targetKey);

/** Auditoria do cadastro: sem nome, documento, contato ou observações. */
export const appendClientEvent = (
  transaction: admin.firestore.Transaction,
  input: EventBase & {
    clientId: string;
    operation: ClientEventOperation;
    statusBefore: ClientStatus | null;
    statusAfter: ClientStatus;
  },
): void => {
  const ref = clientEventsRef(input.workspaceId)
    .doc(clientEventIdFor(input.operation, input.targetKey));
  transaction.create(ref, {
    id: ref.id,
    schemaVersion: CLIENT_SCHEMA_VERSION,
    workspaceId: input.workspaceId,
    clientId: input.clientId,
    operation: input.operation,
    actorId: input.actorId,
    actorRole: input.actorRole,
    intentId: input.intentId,
    requestHash: input.requestHash,
    requestId: input.requestId,
    correlationId: input.correlationId,
    statusBefore: input.statusBefore,
    statusAfter: input.statusAfter,
    changedFields: input.changedFields ?? [],
    createdAt: FieldValue.serverTimestamp(),
  });
};

/** Auditoria financeira: IDs e centavos; nunca PII do cliente. */
export const appendReceivableEvent = (
  transaction: admin.firestore.Transaction,
  input: EventBase & {
    receivableId: string;
    clientId: string;
    operation: ReceivableEventOperation;
    movementId: string | null;
    before: Record<string, number | string> | null;
    after: Record<string, number | string> | null;
    reason: string | null;
    revision: number;
  },
): void => {
  const ref = receivableEventsRef(input.workspaceId)
    .doc(receivableEventIdFor(input.operation, input.targetKey));
  transaction.create(ref, {
    id: ref.id,
    schemaVersion: RECEIVABLE_SCHEMA_VERSION,
    workspaceId: input.workspaceId,
    receivableId: input.receivableId,
    clientId: input.clientId,
    operation: input.operation,
    actorId: input.actorId,
    actorRole: input.actorRole,
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
};
