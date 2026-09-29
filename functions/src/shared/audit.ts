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

export const membershipEventId = (
  requestId: string,
  operation: MembershipEventOperation,
  targetId: string | null,
): string =>
  `${operation.replace(".", "_")}_` +
  sha256(`${requestId}:${operation}:${targetId ?? "-"}`).slice(0, 32);

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
