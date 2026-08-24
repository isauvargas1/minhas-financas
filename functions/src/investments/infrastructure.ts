import {createHash} from "node:crypto";
import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";

import type {
  WorkspaceAuthorizationContext,
  WorkspaceMemberRole,
} from "../creditCards/auth";
import {CreditCardApplicationError} from "../creditCards/errors";
import {consumeRateLimit} from "../shared/rateLimit";
import type {InvestmentProfileType} from "./domain";
import {investmentRateLimitPolicy} from "./rateLimits";
import {
  INVESTMENT_COLLECTIONS,
  investmentDoc,
  investmentMemberDoc,
  investmentWorkspaceRef,
} from "./paths";

export type InvestmentBackendOperation =
  | "onboardInvestmentWorkspace"
  | "saveInvestmentAccount"
  | "saveInvestmentAsset"
  | "createInvestmentContribution"
  | "createInvestmentRedemption"
  | "cancelInvestmentMovement"
  | "settleInvestmentRedemption"
  | "reverseInvestmentMovement"
  | "recordInvestmentValuation"
  | "linkInvestmentToGoal"
  | "unlinkInvestmentFromGoal"
  | "recalculateInvestmentPosition"
  | "recalculateGoalInvestmentProgress"
  | "rebuildInvestmentProjections"
  | "backfillInvestmentWorkspace"
  | "migrateLegacyInvestments"
  | "rollbackLegacyInvestmentMigration"
  | "enableInvestmentsV2Flag"
  | "registerInvestmentImportBatch"
  | "archiveInvestmentAccount"
  | "archiveInvestmentAsset"
  // Trilha legada do M2, mantida separada e documentada por estado da flag.
  | "saveInvestmentRedemption"
  | "cancelInvestmentRedemption"
  | "reverseInvestmentRedemption";

export interface InvestmentIdempotencyReservation {
  ref: admin.firestore.DocumentReference;
  requestHash: string;
  keyHash: string;
  replay?: Record<string, unknown>;
  /**
   * Gravador do contador de limite de frequência (INV-P2-031).
   *
   * A verificação acontece na fase de leitura, junto com a reserva; a escrita
   * só pode acontecer depois de todas as leituras da operação, e por isso é
   * feita em `completeInvestmentIdempotency`.
   */
  commitRateLimit?: () => void;
}

export const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

export const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
};

export const deterministicDocumentId = (...parts: string[]): string =>
  `inv_${sha256(parts.join(":")).slice(0, 36)}`;

export const investmentPositionId = (
  accountId: string,
  assetId: string,
): string => deterministicDocumentId("position", accountId, assetId);

/**
 * Tolerância de relógio entre o cliente e o servidor.
 *
 * Um instante enviado pelo navegador pode estar minutos adiantado sem que
 * exista qualquer intenção de lançar no futuro.
 */
export const FUTURE_DATE_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * Recusa data futura em fato financeiro (INV-P2-022).
 *
 * Liquidação, estorno e valoração não tinham nenhuma checagem temporal. Uma
 * valoração no futuro cria o período do mês futuro e passa a receber deltas;
 * um estorno com data futura desloca o fechamento de meses que ainda não
 * existem.
 */
export const assertNotFuture = (
  value: Timestamp,
  field: string,
): Timestamp => {
  if (value.toMillis() > Date.now() + FUTURE_DATE_TOLERANCE_MS) {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      `A data informada em ${field} está no futuro.`,
    );
  }
  return value;
};

/**
 * Recusa data anterior ao fato que a originou (INV-P2-022).
 *
 * Um estorno com `reversedAt` retroativo subtrai patrimônio de um mês anterior
 * ao próprio movimento estornado e propaga o negativo para todos os meses
 * seguintes.
 */
export const assertNotBefore = (
  value: Timestamp,
  floor: Timestamp,
  field: string,
  floorLabel: string,
): Timestamp => {
  if (value.toMillis() < floor.toMillis()) {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      `A data informada em ${field} é anterior ${floorLabel}.`,
    );
  }
  return value;
};

export const parseTimestamp = (value: string): Timestamp => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new CreditCardApplicationError("invalid_payload", "Data inválida.");
  }
  return Timestamp.fromDate(date);
};

export const profileTypeFromWorkspace = (
  workspace: admin.firestore.DocumentData,
): InvestmentProfileType => {
  if (workspace.type === "PF" || workspace.type === "PJ") {
    return workspace.type;
  }
  throw new CreditCardApplicationError(
    "domain_precondition_failed",
    "O workspace precisa declarar explicitamente o contexto PF ou PJ.",
  );
};

const isRole = (value: unknown): value is WorkspaceMemberRole =>
  value === "owner" ||
  value === "admin" ||
  value === "member" ||
  value === "viewer";

export const authorizeInvestmentTransaction = async (
  transaction: admin.firestore.Transaction,
  auth: WorkspaceAuthorizationContext,
  allowedRoles: WorkspaceMemberRole[],
): Promise<{
  workspace: admin.firestore.DocumentData;
  profileType: InvestmentProfileType;
  role: WorkspaceMemberRole;
}> => {
  const [workspaceSnapshot, memberSnapshot] = await Promise.all([
    transaction.get(investmentWorkspaceRef(auth.workspaceId)),
    transaction.get(investmentMemberDoc(auth.workspaceId, auth.uid)),
  ]);
  if (!workspaceSnapshot.exists) {
    throw new CreditCardApplicationError(
      "workspace_not_found",
      "Workspace não encontrado.",
    );
  }
  const workspace = workspaceSnapshot.data() ?? {};
  const member = memberSnapshot.data();
  if (
    memberSnapshot.exists &&
    member?.status !== undefined &&
    member.status !== "active"
  ) {
    throw new CreditCardApplicationError(
      "workspace_membership_required",
      "A participação do usuário neste workspace não está ativa.",
    );
  }
  const persistedRole =
    memberSnapshot.exists && isRole(member?.role) ?
      member.role :
      workspace.ownerId === auth.uid ?
        "owner" :
        undefined;
  if (!persistedRole) {
    throw new CreditCardApplicationError(
      "workspace_membership_required",
      "Usuário não pertence a este workspace.",
    );
  }
  if (!allowedRoles.includes(persistedRole)) {
    throw new CreditCardApplicationError(
      "workspace_role_denied",
      "Usuário não possui permissão para executar esta operação.",
    );
  }
  return {
    workspace,
    profileType: profileTypeFromWorkspace(workspace),
    role: persistedRole,
  };
};

/**
 * Payload considerado para a identidade da chave de idempotência.
 *
 * `correlationId` é metadado de rastreamento, não conteúdo da operação: um
 * retry legítimo do cliente gera um novo `correlationId` e precisa ser tratado
 * como replay, não como `idempotency_conflict`. O valor continua registrado na
 * chave, no movimento e no event log.
 */
export const idempotencyIdentityPayload = (payload: unknown): unknown => {
  if (typeof payload !== "object" || payload === null) return payload;
  const {correlationId: _ignored, ...rest} = payload as Record<
    string,
    unknown
  >;
  return rest;
};

export const reserveInvestmentIdempotency = async (
  transaction: admin.firestore.Transaction,
  auth: WorkspaceAuthorizationContext,
  operation: InvestmentBackendOperation,
  idempotencyKey: string,
  correlationId: string,
  payload: unknown,
): Promise<InvestmentIdempotencyReservation> => {
  const payloadWorkspaceId =
    typeof payload === "object" && payload ?
      (payload as Record<string, unknown>).workspaceId :
      undefined;
  if (payloadWorkspaceId !== auth.workspaceId) {
    throw new CreditCardApplicationError(
      "permission_denied",
      "O workspace do payload não corresponde ao contexto autorizado.",
    );
  }
  const keyHash = sha256(idempotencyKey);
  const actorKeyHash = sha256(`${auth.uid}:${idempotencyKey}`).slice(0, 32);
  const id = `${operation}_${actorKeyHash}`;
  const ref = investmentDoc(
    auth.workspaceId,
    INVESTMENT_COLLECTIONS.idempotencyKeys,
    id,
  );
  const requestHash = sha256(stableStringify(idempotencyIdentityPayload(payload)));
  const snapshot = await transaction.get(ref);
  if (!snapshot.exists) {
    // INV-P2-031 — limite de frequência por ator e workspace, consumido
    // dentro da transação e **antes** de qualquer escrita de domínio.
    //
    // Só a intenção nova consome orçamento: um replay de idempotência é a
    // mesma intenção do usuário chegando de novo, e penalizá-lo transformaria
    // o mecanismo que existe para tolerar retry num motivo de recusa.
    const policy = investmentRateLimitPolicy(operation);
    const rateLimit = policy ?
      await consumeRateLimit(transaction, auth.workspaceId, auth.uid, policy) :
      undefined;
    return {ref, requestHash, keyHash, commitRateLimit: rateLimit?.commit};
  }
  const data = snapshot.data() ?? {};
  if (
    data.workspaceId !== auth.workspaceId ||
    data.actorId !== auth.uid ||
    data.operation !== operation ||
    data.requestHash !== requestHash
  ) {
    throw new CreditCardApplicationError(
      "idempotency_conflict",
      "A chave de idempotência já foi usada com outros dados.",
    );
  }
  if (
    data.status !== "completed" ||
    typeof data.result !== "object" ||
    !data.result
  ) {
    throw new CreditCardApplicationError(
      "idempotency_conflict",
      "Esta solicitação já está em processamento.",
    );
  }
  return {
    ref,
    requestHash,
    keyHash,
    replay: data.result as Record<string, unknown>,
  };
};

export const completeInvestmentIdempotency = (
  transaction: admin.firestore.Transaction,
  auth: WorkspaceAuthorizationContext,
  operation: InvestmentBackendOperation,
  correlationId: string,
  reservation: InvestmentIdempotencyReservation,
  result: Record<string, unknown>,
): void => {
  // Fase de escrita: é aqui que o contador de frequência é efetivado.
  reservation.commitRateLimit?.();
  transaction.create(reservation.ref, {
    id: reservation.ref.id,
    workspaceId: auth.workspaceId,
    actorId: auth.uid,
    operation,
    correlationId,
    idempotencyKeyHash: reservation.keyHash,
    requestHash: reservation.requestHash,
    status: "completed",
    result,
    createdAt: FieldValue.serverTimestamp(),
    completedAt: FieldValue.serverTimestamp(),
  });
};

export const recordInvestmentEvent = (
  transaction: admin.firestore.Transaction,
  auth: WorkspaceAuthorizationContext,
  role: WorkspaceMemberRole,
  profileType: InvestmentProfileType,
  operation: InvestmentBackendOperation,
  reservation: InvestmentIdempotencyReservation,
  correlationId: string,
  entityType: string,
  entityId: string,
  details: Record<string, unknown>,
): void => {
  const eventId = `${reservation.ref.id}_event`;
  transaction.create(
    investmentDoc(auth.workspaceId, INVESTMENT_COLLECTIONS.eventLogs, eventId),
    {
      id: eventId,
      workspaceId: auth.workspaceId,
      profileType,
      actorId: auth.uid,
      actorRole: role,
      operation,
      entityType,
      entityId,
      correlationId,
      idempotencyKeyId: reservation.ref.id,
      outcome: "completed",
      details,
      occurredAt: FieldValue.serverTimestamp(),
    },
  );
};

export const assertWorkspaceDocument = (
  snapshot: admin.firestore.DocumentSnapshot,
  workspaceId: string,
  label: string,
): admin.firestore.DocumentData => {
  if (!snapshot.exists) {
    throw new CreditCardApplicationError(
      "not_found",
      `${label} não encontrado.`,
    );
  }
  const data = snapshot.data() ?? {};
  if (data.workspaceId !== undefined && data.workspaceId !== workspaceId) {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      `${label} não pertence ao workspace autorizado.`,
    );
  }
  return data;
};
