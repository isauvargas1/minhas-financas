import * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";

import {sha256} from "./hashing";
import {workspaceRef, type WorkspaceRole} from "./workspaceAuth";

/**
 * Auditoria append-only de workspace e membership (P1, §2.6).
 *
 * `workspaces/{workspaceId}/membership_events/{eventId}` é gravado somente
 * pelo backend, dentro da mesma transação da mutação: o evento existe se e
 * somente se a mudança foi confirmada. As Rules negam leitura e escrita do
 * cliente (a superfície de consulta é do painel administrativo, P7).
 *
 * O ID é derivado de `requestId`, operação e alvo, e a escrita usa
 * `transaction.create`: dentro de uma requisição, o mesmo evento não pode ser
 * gravado duas vezes, e um replay de idempotência devolve o resultado salvo
 * antes de chegar aqui — cada efeito é auditado exatamente uma vez.
 */
export type MembershipEventOperation =
  | "account.bootstrapped"
  | "workspace.created"
  | "workspace.settings_updated"
  | "workspace.archived"
  | "invite.created"
  | "invite.accepted"
  | "invite.revoked"
  | "member.role_changed"
  | "member.removed"
  | "member.left"
  | "ownership.transferred";

export type AuditScalar = string | number | boolean | null;
export type AuditSnapshot = Record<string, AuditScalar>;

export interface MembershipEventInput {
  workspaceId: string;
  operation: MembershipEventOperation;
  actorId: string;
  actorRole: WorkspaceRole | null;
  targetId: string | null;
  before: AuditSnapshot | null;
  after: AuditSnapshot | null;
  reason: string | null;
  requestId: string;
}

export const MEMBERSHIP_EVENTS_COLLECTION = "membership_events";

/** ID determinístico de evento: o mesmo efeito não é auditado duas vezes. */
const auditEventId = (
  requestId: string,
  operation: string,
  targetId: string | null,
): string =>
  `${operation.replace(".", "_")}_` +
  sha256(`${requestId}:${operation}:${targetId ?? "-"}`).slice(0, 32);

export const membershipEventId = (
  requestId: string,
  operation: MembershipEventOperation,
  targetId: string | null,
): string => auditEventId(requestId, operation, targetId);

export const appendMembershipEvent = (
  transaction: admin.firestore.Transaction,
  input: MembershipEventInput,
): admin.firestore.DocumentReference => {
  const ref = workspaceRef(input.workspaceId)
    .collection(MEMBERSHIP_EVENTS_COLLECTION)
    .doc(membershipEventId(input.requestId, input.operation, input.targetId));
  transaction.create(ref, {
    id: ref.id,
    workspaceId: input.workspaceId,
    operation: input.operation,
    actorId: input.actorId,
    actorRole: input.actorRole,
    targetId: input.targetId,
    before: input.before,
    after: input.after,
    reason: input.reason,
    requestId: input.requestId,
    createdAt: FieldValue.serverTimestamp(),
  });
  return ref;
};

/**
 * Auditoria append-only do caixa (P3-A, PR-TX-05 parcial).
 *
 * `workspaces/{workspaceId}/cash_events/{eventId}` segue o mesmo contrato de
 * `membership_events`: gravado só pelo backend, com `transaction.create`, na
 * mesma transação do lançamento — o evento existe se e somente se o
 * lançamento foi confirmado, e um replay de idempotência não chega aqui.
 *
 * O evento diz quem fez o quê, em que papel e contexto PF/PJ, sobre qual
 * lançamento e em qual requisição. Valor, descrição, categoria e data **não**
 * são copiados: o fato financeiro vive no próprio lançamento, que nunca é
 * apagado (INV-P2-032), e uma segunda cópia só ampliaria a exposição. O campo
 * `requestHash` liga o evento à intenção exata sem repetir o conteúdo.
 */
export type CashEventOperation = "cash_entry.created";

export interface CashEventInput {
  workspaceId: string;
  operation: CashEventOperation;
  actorId: string;
  /** `null` só na geração automática de Recorrentes (ator de sistema). */
  actorRole: WorkspaceRole | null;
  /** Contexto PF/PJ do workspace no momento do lançamento. */
  profileType: "PF" | "PJ";
  transactionId: string;
  requestHash: string;
  requestId: string;
  /**
   * Canal da criação quando não é o formulário (P3-D): `import` para cada
   * linha de uma importação; `recurring` (P4-B) para o lançamento gerado por
   * uma ocorrência de despesa recorrente. Ausente na criação manual unitária.
   */
  channel?: "import" | "recurring";
  /** Estado inicial do lançamento criado (D-29): confirmado ou pendente. */
  entryStatus: "confirmed" | "pending";
}

export const CASH_EVENTS_COLLECTION = "cash_events";

export const cashEventId = (
  requestId: string,
  operation: CashEventOperation,
  transactionId: string,
): string => auditEventId(requestId, operation, transactionId);

export const appendCashEvent = (
  transaction: admin.firestore.Transaction,
  input: CashEventInput,
): admin.firestore.DocumentReference => {
  const ref = workspaceRef(input.workspaceId)
    .collection(CASH_EVENTS_COLLECTION)
    .doc(cashEventId(input.requestId, input.operation, input.transactionId));
  transaction.create(ref, {
    id: ref.id,
    workspaceId: input.workspaceId,
    operation: input.operation,
    actorId: input.actorId,
    actorRole: input.actorRole,
    profileType: input.profileType,
    transactionId: input.transactionId,
    requestHash: input.requestHash,
    requestId: input.requestId,
    ...(input.channel === undefined ? {} : {channel: input.channel}),
    entryStatus: input.entryStatus,
    createdAt: FieldValue.serverTimestamp(),
  });
  return ref;
};

/**
 * Trilha da correção, da confirmação (P3-F, D-29) e da anulação de
 * lançamento (P3-C, D-35, PR-TX-05).
 *
 * Mesmo destino e mesmo contrato de `cash_entry.created`: append-only,
 * `transaction.create`, na mesma transação que altera o lançamento. Duas
 * diferenças deliberadas:
 *
 * - **ID pela intenção**, não pela requisição: `(intentId, operação,
 *   lançamento)`, com `intentId = sha256(uid:idempotencyKey)`. Uma nova
 *   tentativa da mesma intenção, mesmo depois de expirada a chave do ator,
 *   encontra o evento e não aplica de novo.
 * - **Antes e depois financeiros** em centavos inteiros (`amountCents`,
 *   `type`, `date`), porque reconstituir uma correção exige o estado anterior.
 *   Campos descritivos entram só pelo nome em `changedFields`; descrição,
 *   categoria e textos livres não são copiados.
 *
 * O `reason` é o motivo informado pelo usuário, exigido por D-35. A leitura da
 * trilha segue as Rules de `cash_events`: owner e admin.
 */
export type CashMutationOperation =
  | "cash_entry.updated"
  | "cash_entry.confirmed"
  | "cash_entry.voided";

/**
 * Retrato financeiro antes e depois (D-35; P3-F, D-29): estado, valor, tipo,
 * data de referência (efetiva no confirmado, vencimento no pendente) e
 * vencimento, quando houver.
 */
export interface CashFinancialSnapshot {
  status: "pending" | "confirmed";
  amountCents: number;
  type: "receita" | "despesa";
  date: string;
  dueDate: string | null;
  /**
   * Conta/carteira (D-30). O tipo admite `null` porque a trilha registra o
   * que leu; a elegibilidade exige a conta em todo lançamento do Caixa.
   */
  cashAccountId: string | null;
}

export interface CashMutationEventInput {
  workspaceId: string;
  operation: CashMutationOperation;
  actorId: string;
  actorRole: WorkspaceRole;
  profileType: "PF" | "PJ";
  transactionId: string;
  /** `sha256(uid:idempotencyKey)` truncado: identifica a intenção. */
  intentId: string;
  requestHash: string;
  requestId: string;
  correlationId: string | null;
  /** Motivo (D-35); `null` só na confirmação, que é fluxo normal. */
  reason: string | null;
  changedFields: string[];
  before: CashFinancialSnapshot;
  after: CashFinancialSnapshot | null;
  /** Revisão do lançamento depois desta operação. */
  revision: number;
}

export const cashIntentEventId = (
  intentId: string,
  operation: CashMutationOperation,
  transactionId: string,
): string => auditEventId(intentId, operation, transactionId);

export const cashMutationEventRef = (
  workspaceId: string,
  intentId: string,
  operation: CashMutationOperation,
  transactionId: string,
): admin.firestore.DocumentReference =>
  workspaceRef(workspaceId)
    .collection(CASH_EVENTS_COLLECTION)
    .doc(cashIntentEventId(intentId, operation, transactionId));

export const appendCashMutationEvent = (
  transaction: admin.firestore.Transaction,
  input: CashMutationEventInput,
): admin.firestore.DocumentReference => {
  const ref = cashMutationEventRef(
    input.workspaceId,
    input.intentId,
    input.operation,
    input.transactionId,
  );
  transaction.create(ref, {
    id: ref.id,
    workspaceId: input.workspaceId,
    operation: input.operation,
    actorId: input.actorId,
    actorRole: input.actorRole,
    profileType: input.profileType,
    transactionId: input.transactionId,
    intentId: input.intentId,
    requestHash: input.requestHash,
    requestId: input.requestId,
    correlationId: input.correlationId,
    reason: input.reason,
    changedFields: input.changedFields,
    before: input.before,
    after: input.after,
    revision: input.revision,
    createdAt: FieldValue.serverTimestamp(),
  });
  return ref;
};
