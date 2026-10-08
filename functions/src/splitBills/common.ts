import type * as admin from "firebase-admin";
import type {Timestamp} from "firebase-admin/firestore";

import {compareCommitTimes} from "../cash/periods";
import {parseIsoInstant} from "../shared/commitTime";
import {saoPauloDayKey} from "../shared/dateKeys";
import {ApplicationError} from "../shared/errors";
import {
  completeActorIdempotency,
  reserveActorIdempotency,
  type ActorIdempotencyReservation,
} from "../shared/idempotency";
import {reserveRateLimit, type RateLimitPolicy} from "../shared/rateLimit";
import {
  reassertWorkspaceActor,
  type WorkspaceActor,
  type WorkspaceRole,
} from "../shared/workspaceAuth";
import {
  readAuthoritativeGroup,
  readAuthoritativeParticipant,
  splitEventRef,
  splitGroupsRef,
  splitIntentIdFor,
  splitMemberParticipantIdFor,
  splitParticipantsRef,
  type AuthoritativeSplitGroup,
  type AuthoritativeSplitParticipant,
  type SplitEventOperation,
} from "./model";

/**
 * Regras comuns da Divisão de contas (P4-C, D-14).
 *
 * Papéis do workspace:
 * - owner/admin: administram qualquer grupo, título, rateio e reembolso;
 * - member: cria grupos (vira o dono) e atua nos grupos em que participa,
 *   conforme o papel no grupo;
 * - viewer: só lê (as Rules liberam a leitura a todo membro ativo); não
 *   participa de grupos.
 *
 * Papéis no grupo (só do participante `workspace_member`): `owner`
 * (administra o grupo), `participant` (lança e acompanha), `viewer` (só
 * lê). A identidade é sempre `uid` → participante do usuário naquele grupo
 * (ID determinístico), nunca o nome de exibição. O papel do workspace e o
 * participante são relidos dentro da transação de cada operação.
 */
export const SPLIT_ACTOR_ROLES: readonly WorkspaceRole[] =
  ["owner", "admin", "member"];
export const SPLIT_ADMIN_ROLES: readonly WorkspaceRole[] = ["owner", "admin"];

export const isWorkspaceAdmin = (role: WorkspaceRole): boolean =>
  role === "owner" || role === "admin";

/** Estruturais (grupo, participantes, convites): limite proporcional. */
export const SPLIT_STRUCTURE_RATE_LIMIT: RateLimitPolicy = {
  operation: "splitStructureMutation",
  limit: 60,
  windowSeconds: 10 * 60,
};
/** Títulos, rateios e reembolsos. */
export const SPLIT_FINANCIAL_RATE_LIMIT: RateLimitPolicy = {
  operation: "splitFinancialMutation",
  limit: 120,
  windowSeconds: 10 * 60,
};
/** Geração de convites. */
export const SPLIT_INVITE_RATE_LIMIT: RateLimitPolicy = {
  operation: "splitInviteCreate",
  limit: 10,
  windowSeconds: 60 * 60,
};
/**
 * Aceite: teto agressivo, consumido também pelas tentativas que falham — é
 * o que fecha a varredura do espaço de códigos.
 */
export const SPLIT_ACCEPT_RATE_LIMIT: RateLimitPolicy = {
  operation: "splitInviteAccept",
  limit: 10,
  windowSeconds: 15 * 60,
};

export const IDEMPOTENCY_CONFLICT_MESSAGE =
  "Esta chave de idempotência já foi usada com outros dados.";
export const INTERNAL_MESSAGE =
  "Não foi possível concluir a operação. Tente novamente.";
export const GROUP_NOT_FOUND_MESSAGE = "Grupo não encontrado.";
export const GROUP_INCONSISTENT_MESSAGE =
  "Este grupo tem dados inconsistentes e não pode ser alterado.";
export const GROUP_ARCHIVED_MESSAGE =
  "Este grupo está arquivado. Reative-o para continuar.";
export const GROUP_CONFLICT_MESSAGE =
  "O grupo foi alterado por outra pessoa. Recarregue e tente novamente.";
export const GROUP_MANAGE_DENIED_MESSAGE =
  "Só o dono do grupo ou um administrador do espaço pode fazer isso.";
export const GROUP_WRITE_DENIED_MESSAGE =
  "Você não participa deste grupo com permissão para lançar.";
export const PARTICIPANT_NOT_FOUND_MESSAGE = "Participante não encontrado.";
export const PARTICIPANT_INCONSISTENT_MESSAGE =
  "Este participante tem dados inconsistentes.";
export const PARTICIPANT_CONFLICT_MESSAGE =
  "O participante foi alterado por outra pessoa. Recarregue e tente novamente.";
export const BILL_NOT_FOUND_MESSAGE = "Título não encontrado.";
export const BILL_INCONSISTENT_MESSAGE =
  "Este título tem dados inconsistentes e não pode ser alterado.";
export const BILL_CONFLICT_MESSAGE =
  "O título foi alterado por outra pessoa. Recarregue e tente novamente.";
export const SHARE_NOT_FOUND_MESSAGE = "Rateio não encontrado.";
export const SHARE_INCONSISTENT_MESSAGE =
  "Este rateio tem dados inconsistentes e não pode ser alterado.";
export const SHARE_CONFLICT_MESSAGE =
  "O rateio foi alterado por outra pessoa. Recarregue e tente novamente.";
export const REIMBURSEMENT_NOT_FOUND_MESSAGE = "Reembolso não encontrado.";
export const REIMBURSEMENT_INCONSISTENT_MESSAGE =
  "Este reembolso tem dados inconsistentes e não pode ser alterado.";
export const REIMBURSEMENT_CONFLICT_MESSAGE =
  "O reembolso foi alterado por outra pessoa. Recarregue e tente novamente.";
export const FUTURE_DATE_MESSAGE = "A data não pode estar no futuro.";

/** Relógio e ponto de falha injetáveis, só para os testes. */
export interface SplitOperationOptions {
  now?: () => number;
  /** Com todas as escritas enfileiradas, antes do commit. */
  beforeCommit?: () => void;
}

export const nowOf = (options: SplitOperationOptions): number =>
  (options.now ?? Date.now)();

export const todayOf = (options: SplitOperationOptions): string =>
  saoPauloDayKey(new Date(nowOf(options)));

export const assertNotFuture = (
  day: string,
  options: SplitOperationOptions,
  message = FUTURE_DATE_MESSAGE,
): void => {
  if (day > todayOf(options)) {
    throw new ApplicationError("domain_precondition_failed", message);
  }
};

export const assertVersion = (
  current: Timestamp,
  expected: string,
  message: string,
): void => {
  if (compareCommitTimes(current, parseIsoInstant(expected)) !== 0) {
    throw new ApplicationError("concurrent_update", message);
  }
};

export const reserveSplitRateLimit = (
  transaction: admin.firestore.Transaction,
  actor: WorkspaceActor,
  policy: RateLimitPolicy,
) => reserveRateLimit(transaction, actor.workspaceId, actor.uid, policy);

/**
 * Resultado das mutações: só identificadores, sempre com as mesmas chaves —
 * o recibo da chave e a âncora durável reconstroem exatamente o mesmo
 * resultado no replay.
 */
export interface SplitMutationIds {
  groupId: string;
  billId: string | null;
  shareId: string | null;
  participantId: string | null;
  reimbursementId: string | null;
  inviteId: string | null;
}

export interface SplitMutationResult extends SplitMutationIds {
  replayed: boolean;
  [key: string]: unknown;
}

export const splitIds = (
  ids: Partial<SplitMutationIds> & {groupId: string},
): SplitMutationIds => ({
  groupId: ids.groupId,
  billId: ids.billId ?? null,
  shareId: ids.shareId ?? null,
  participantId: ids.participantId ?? null,
  reimbursementId: ids.reimbursementId ?? null,
  inviteId: ids.inviteId ?? null,
});

/** Replay (recibo ou âncora): o resultado guardado, marcado como repetido. */
export const replayOf = (
  stored: Record<string, unknown>,
): SplitMutationResult => {
  if (typeof stored.groupId !== "string") {
    throw new ApplicationError("internal", INTERNAL_MESSAGE);
  }
  return {...(stored as unknown as SplitMutationResult), replayed: true};
};

/** Resultado reconstruído da âncora durável (replay depois do recibo). */
export type SplitAnchorReplay = SplitMutationIds;

/**
 * Âncora durável de uma intenção: o evento da operação no ID determinístico
 * `(operação, intenção)`, lido diretamente na transação. Mesmo conteúdo é
 * replay; outro conteúdo é conflito.
 */
export const readIntentAnchor = async (
  transaction: admin.firestore.Transaction,
  workspaceId: string,
  operation: SplitEventOperation,
  intentId: string,
  reservation: ActorIdempotencyReservation,
  actorUid: string,
): Promise<SplitAnchorReplay | null> => {
  const snapshot = await transaction.get(
    splitEventRef(workspaceId, operation, intentId));
  if (!snapshot.exists) return null;
  if (
    snapshot.get("requestHash") !== reservation.requestHash ||
    snapshot.get("actorId") !== actorUid ||
    snapshot.get("workspaceId") !== workspaceId
  ) {
    throw new ApplicationError("idempotency_conflict",
      IDEMPOTENCY_CONFLICT_MESSAGE);
  }
  const optional = (key: keyof SplitMutationIds): string | null => {
    const value = snapshot.get(key);
    return typeof value === "string" ? value : null;
  };
  return splitIds({
    groupId: String(snapshot.get("groupId")),
    billId: optional("billId"),
    shareId: optional("shareId"),
    participantId: optional("participantId"),
    reimbursementId: optional("reimbursementId"),
    inviteId: optional("inviteId"),
  });
};

/** Fase inicial comum: papel relido, recibo da chave e âncora durável. */
export const beginSplitMutation = async (
  transaction: admin.firestore.Transaction,
  actor: WorkspaceActor,
  input: {
    operation: string;
    eventOperation: SplitEventOperation;
    roles: readonly WorkspaceRole[];
    payload: {idempotencyKey: string} & Record<string, unknown>;
  },
): Promise<
  | {replay: SplitMutationResult}
  | {
      role: WorkspaceRole;
      workspace: admin.firestore.DocumentData;
      reservation: ActorIdempotencyReservation;
      intentId: string;
    }
> => {
  const {role, workspace} = await reassertWorkspaceActor(transaction, actor,
    input.roles);
  const reservation = await reserveActorIdempotency(transaction, {
    uid: actor.uid,
    operation: input.operation,
    idempotencyKey: input.payload.idempotencyKey,
    payload: input.payload,
  });
  if (reservation.replay) return {replay: replayOf(reservation.replay)};
  const intentId = splitIntentIdFor(actor.uid, input.payload.idempotencyKey);
  const anchor = await readIntentAnchor(transaction, actor.workspaceId,
    input.eventOperation, intentId, reservation, actor.uid);
  if (anchor) return {replay: replayOf({...anchor})};
  return {role, workspace, reservation, intentId};
};

export type SplitMutationStart = Exclude<
  Awaited<ReturnType<typeof beginSplitMutation>>, {replay: unknown}>;

/**
 * Fase final comum: recibo da chave com o resultado (só identificadores e
 * dados não sensíveis), consumo do rate limit e ponto de falha dos testes.
 */
export const finishSplitMutation = (
  transaction: admin.firestore.Transaction,
  actor: WorkspaceActor,
  input: {
    start: SplitMutationStart;
    operation: string;
    requestId: string;
    ids: SplitMutationIds;
    /** Campos extras do resultado (também guardados no recibo). */
    extra?: Record<string, unknown>;
    rateLimit: {commit(): void};
    options: SplitOperationOptions;
  },
): SplitMutationResult => {
  const result = {...input.ids, ...(input.extra ?? {})};
  completeActorIdempotency(transaction, input.start.reservation, {
    uid: actor.uid,
    operation: input.operation,
    workspaceId: actor.workspaceId,
    requestId: input.requestId,
    result,
  });
  input.rateLimit.commit();
  input.options.beforeCommit?.();
  return {...result, replayed: false};
};

export interface GroupAccess {
  group: AuthoritativeSplitGroup;
  groupRef: admin.firestore.DocumentReference;
  /** ID do registro do ator neste grupo (exista ou não). */
  actorParticipantId: string;
  /** Participante ativo ou inativo do próprio ator, se houver. */
  actorParticipant: AuthoritativeSplitParticipant | null;
  /** ID do registro de um membro do workspace neste grupo. */
  participantIdOf(uid: string): string;
}

/** Relê o grupo e o participante do ator (ID derivado do `uid`). */
export const loadGroupAccess = async (
  transaction: admin.firestore.Transaction,
  actor: WorkspaceActor,
  groupId: string,
): Promise<GroupAccess> => {
  const groupRef = splitGroupsRef(actor.workspaceId).doc(groupId);
  const participantIdOf = (uid: string) =>
    splitMemberParticipantIdFor(actor.workspaceId, groupId, uid);
  const actorParticipantId = participantIdOf(actor.uid);
  const participantRef = splitParticipantsRef(actor.workspaceId)
    .doc(actorParticipantId);
  const [groupSnapshot, participantSnapshot] = await transaction.getAll(
    groupRef, participantRef);
  if (!groupSnapshot.exists) {
    throw new ApplicationError("not_found", GROUP_NOT_FOUND_MESSAGE);
  }
  const group = readAuthoritativeGroup(groupSnapshot.id, groupSnapshot.data(),
    actor.workspaceId);
  if (!group) {
    throw new ApplicationError("domain_precondition_failed",
      GROUP_INCONSISTENT_MESSAGE, {ineligible: "inconsistent_group"});
  }
  let actorParticipant: AuthoritativeSplitParticipant | null = null;
  if (participantSnapshot.exists) {
    actorParticipant = readAuthoritativeParticipant(participantSnapshot.id,
      participantSnapshot.data(), actor.workspaceId);
    if (
      !actorParticipant ||
      actorParticipant.groupId !== groupId ||
      actorParticipant.kind !== "workspace_member" ||
      actorParticipant.userId !== actor.uid
    ) {
      throw new ApplicationError("domain_precondition_failed",
        PARTICIPANT_INCONSISTENT_MESSAGE);
    }
  }
  return {group, groupRef, actorParticipantId, actorParticipant,
    participantIdOf};
};

export const assertGroupActive = (group: AuthoritativeSplitGroup): void => {
  if (group.status !== "active") {
    throw new ApplicationError("domain_precondition_failed",
      GROUP_ARCHIVED_MESSAGE, {ineligible: "archived_group"});
  }
};

const activeRoleOf = (access: GroupAccess) =>
  access.actorParticipant?.status === "active" ?
    access.actorParticipant.role : null;

/** Dono do grupo (participante ativo) ou owner/admin do workspace. */
export const canManageGroup = (
  role: WorkspaceRole,
  access: GroupAccess,
): boolean => isWorkspaceAdmin(role) || activeRoleOf(access) === "owner";

export const assertCanManageGroup = (
  role: WorkspaceRole,
  access: GroupAccess,
): void => {
  if (!canManageGroup(role, access)) {
    throw new ApplicationError("permission_denied",
      GROUP_MANAGE_DENIED_MESSAGE);
  }
};

/** Lança no grupo: dono ou participante ativo, ou owner/admin do workspace. */
export const assertCanWriteInGroup = (
  role: WorkspaceRole,
  access: GroupAccess,
): void => {
  const groupRole = activeRoleOf(access);
  if (
    !isWorkspaceAdmin(role) &&
    groupRole !== "owner" && groupRole !== "participant"
  ) {
    throw new ApplicationError("permission_denied", GROUP_WRITE_DENIED_MESSAGE);
  }
};

export const correlationOf = (payload: {correlationId?: string}) =>
  payload.correlationId ?? null;
