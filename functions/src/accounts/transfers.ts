import * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";

import {compareCommitTimes} from "../cash/periods";
import {parseIsoInstant} from "../shared/commitTime";
import {ApplicationError} from "../shared/errors";
import {
  completeActorIdempotency,
  reserveActorIdempotency,
} from "../shared/idempotency";
import {MONEY_CURRENCY} from "../shared/money";
import {reserveRateLimit, type RateLimitPolicy} from "../shared/rateLimit";
import {
  reassertWorkspaceActor,
  type WorkspaceActor,
  type WorkspaceRole,
} from "../shared/workspaceAuth";
import type {
  CashTransferResult,
  CreateCashTransferPayload,
  ReverseCashTransferPayload,
} from "./contracts";
import {
  postAccountMovements,
  readPostedMovement,
  readPostingAccounts,
  reversalOfMovement,
} from "./ledger";
import {
  CASH_ACCOUNT_EVENTS_COLLECTION,
  CASH_ACCOUNT_SCHEMA_VERSION,
  accountIntentIdFor,
  appendCashAccountEvent,
  cashTransferIdFor,
  cashTransfersRef,
  readAuthoritativeCashTransfer,
  transferMovementIdFor,
} from "./model";

/**
 * Transferência entre contas do mesmo workspace e o seu estorno (D-30, P3-J).
 *
 * A transferência não é receita nem despesa e não cria `transactions`: o
 * efeito global é zero. Num único commit: saída na origem (`transfer_out`),
 * entrada no destino (`transfer_in`), os dois saldos, o documento da
 * transferência, a auditoria e a idempotência.
 *
 * O estorno compensa as duas pernas no mesmo commit (movimentos `reversal`
 * com `reversalOf`), marca a transferência como estornada e audita. Um
 * segundo estorno é recusado; a repetição da mesma intenção é replay.
 *
 * Papéis: owner, admin e member transferem entre contas ativas; owner e
 * admin estornam qualquer transferência, member só as que registrou; viewer
 * só lê.
 */
export const CREATE_CASH_TRANSFER_OPERATION = "createCashTransfer";
export const REVERSE_CASH_TRANSFER_OPERATION = "reverseCashTransfer";

export const CASH_TRANSFER_ROLES: readonly WorkspaceRole[] =
  ["owner", "admin", "member"];

/** Limite operacional das transferências e estornos (não é quota). */
export const CASH_TRANSFER_RATE_LIMIT: RateLimitPolicy = {
  operation: "cashTransferMutation",
  limit: 60,
  windowSeconds: 10 * 60,
};

export const TRANSFER_IDEMPOTENCY_CONFLICT_MESSAGE =
  "Esta chave de idempotência já foi usada com outros dados.";
export const TRANSFER_NOT_FOUND_MESSAGE = "Transferência não encontrada.";
export const TRANSFER_INCONSISTENT_MESSAGE =
  "Esta transferência tem dados inconsistentes e não pode ser estornada.";
export const TRANSFER_ALREADY_REVERSED_MESSAGE =
  "Esta transferência já foi estornada.";
export const TRANSFER_CONFLICT_MESSAGE =
  "Esta transferência foi alterada por outra operação depois que você a " +
  "abriu. Atualize e tente novamente.";
export const MEMBER_TRANSFER_OWNERSHIP_MESSAGE =
  "Você só pode estornar as transferências que você mesmo registrou.";
const TRANSFER_INTERNAL_MESSAGE =
  "Não foi possível concluir a transferência. Tente novamente.";

/** Ponto de falha injetável, só para os testes. */
export interface CashTransferOptions {
  beforeCommit?: () => void;
}

const db = () => admin.firestore();

const replayResult = (stored: Record<string, unknown>): CashTransferResult => {
  if (typeof stored.transferId !== "string") {
    throw new ApplicationError("internal", TRANSFER_INTERNAL_MESSAGE);
  }
  return {...(stored as unknown as CashTransferResult), replayed: true};
};

const reserveTransferRateLimit = (
  transaction: admin.firestore.Transaction,
  actor: WorkspaceActor,
) => reserveRateLimit(transaction, actor.workspaceId, actor.uid,
  CASH_TRANSFER_RATE_LIMIT);

// ----------------------------------------------------------- transferência

export const executeCreateCashTransfer = async (
  actor: WorkspaceActor,
  payload: CreateCashTransferPayload,
  requestId: string,
  options: CashTransferOptions = {},
): Promise<CashTransferResult> =>
  db().runTransaction(async (transaction) => {
    const {role} = await reassertWorkspaceActor(
      transaction, actor, CASH_TRANSFER_ROLES);
    const reservation = await reserveActorIdempotency(transaction, {
      uid: actor.uid,
      operation: CREATE_CASH_TRANSFER_OPERATION,
      idempotencyKey: payload.idempotencyKey,
      payload,
    });
    if (reservation.replay) return replayResult(reservation.replay);

    const transferId = cashTransferIdFor(
      actor.workspaceId, actor.uid, payload.idempotencyKey);
    const transferRef = cashTransfersRef(actor.workspaceId).doc(transferId);
    const existing = await transaction.get(transferRef);
    if (existing.exists) {
      // Chave expirada, transferência preservada: a âncora durável decide.
      if (
        existing.get("requestHash") === reservation.requestHash &&
        existing.get("createdBy") === actor.uid
      ) {
        return {
          transferId,
          status: existing.get("status") === "reversed" ?
            "reversed" : "completed",
          replayed: true,
        };
      }
      throw new ApplicationError("idempotency_conflict",
        TRANSFER_IDEMPOTENCY_CONFLICT_MESSAGE);
    }
    // As duas contas no workspace autorizado (o caminho garante o tenant).
    const accounts = await readPostingAccounts(transaction, actor.workspaceId,
      [payload.sourceAccountId, payload.destinationAccountId]);
    const rateLimit = await reserveTransferRateLimit(transaction, actor);

    const outMovementId = transferMovementIdFor(transferId, "out", false);
    const inMovementId = transferMovementIdFor(transferId, "in", false);
    // Recusa conta arquivada antes de qualquer escrita.
    postAccountMovements(transaction, accounts, [
      {
        id: outMovementId,
        accountId: payload.sourceAccountId,
        kind: "transfer_out",
        amountCents: -payload.amountCents,
        effectiveDate: payload.date,
        sourceDomain: "transfer",
        sourceId: transferId,
        sourceFactId: transferId,
        reversalOf: null,
      },
      {
        id: inMovementId,
        accountId: payload.destinationAccountId,
        kind: "transfer_in",
        amountCents: payload.amountCents,
        effectiveDate: payload.date,
        sourceDomain: "transfer",
        sourceId: transferId,
        sourceFactId: transferId,
        reversalOf: null,
      },
    ], {
      workspaceId: actor.workspaceId,
      actorUid: actor.uid,
      operation: CREATE_CASH_TRANSFER_OPERATION,
      requestId,
    });
    transaction.create(transferRef, {
      id: transferId,
      schemaVersion: CASH_ACCOUNT_SCHEMA_VERSION,
      workspaceId: actor.workspaceId,
      sourceAccountId: payload.sourceAccountId,
      destinationAccountId: payload.destinationAccountId,
      amountCents: payload.amountCents,
      currency: MONEY_CURRENCY,
      date: payload.date,
      ...(payload.description === undefined ?
        {} : {description: payload.description}),
      status: "completed",
      outMovementId,
      inMovementId,
      reversal: null,
      requestHash: reservation.requestHash,
      createdBy: actor.uid,
      updatedBy: actor.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    appendCashAccountEvent(transaction, {
      workspaceId: actor.workspaceId,
      operation: "cash_transfer.created",
      targetKey: transferId,
      accountId: null,
      transferId,
      actorId: actor.uid,
      actorRole: role,
      intentId: accountIntentIdFor(actor.uid, payload.idempotencyKey),
      requestHash: reservation.requestHash,
      requestId,
      correlationId: payload.correlationId ?? null,
      before: null,
      after: {
        sourceAccountId: payload.sourceAccountId,
        destinationAccountId: payload.destinationAccountId,
        amountCents: payload.amountCents,
        date: payload.date,
        status: "completed",
      },
      reason: null,
    });
    const result = {transferId, status: "completed" as const};
    completeActorIdempotency(transaction, reservation, {
      uid: actor.uid,
      operation: CREATE_CASH_TRANSFER_OPERATION,
      workspaceId: actor.workspaceId,
      requestId,
      result,
    });
    rateLimit.commit();
    options.beforeCommit?.();
    return {...result, replayed: false};
  });

// ------------------------------------------------------------------ estorno

export const executeReverseCashTransfer = async (
  actor: WorkspaceActor,
  payload: ReverseCashTransferPayload,
  requestId: string,
  options: CashTransferOptions = {},
): Promise<CashTransferResult> =>
  db().runTransaction(async (transaction) => {
    const {role} = await reassertWorkspaceActor(
      transaction, actor, CASH_TRANSFER_ROLES);
    const reservation = await reserveActorIdempotency(transaction, {
      uid: actor.uid,
      operation: REVERSE_CASH_TRANSFER_OPERATION,
      idempotencyKey: payload.idempotencyKey,
      payload,
    });
    if (reservation.replay) return replayResult(reservation.replay);

    const intentId = accountIntentIdFor(actor.uid, payload.idempotencyKey);
    const transferRef = cashTransfersRef(actor.workspaceId)
      .doc(payload.transferId);
    const snapshot = await transaction.get(transferRef);
    const anchors = await transaction.get(
      db().collectionGroup(CASH_ACCOUNT_EVENTS_COLLECTION)
        .where("intentId", "==", intentId)
        .where("operation", "==", "cash_transfer.reversed")
        .limit(1),
    );
    const anchor = anchors.docs[0];
    if (anchor) {
      if (
        anchor.get("requestHash") !== reservation.requestHash ||
        anchor.get("actorId") !== actor.uid ||
        anchor.get("workspaceId") !== actor.workspaceId ||
        anchor.get("transferId") !== payload.transferId
      ) {
        throw new ApplicationError("idempotency_conflict",
          TRANSFER_IDEMPOTENCY_CONFLICT_MESSAGE);
      }
      return {transferId: payload.transferId, status: "reversed",
        replayed: true};
    }
    if (!snapshot.exists) {
      throw new ApplicationError("not_found", TRANSFER_NOT_FOUND_MESSAGE);
    }
    const transfer = readAuthoritativeCashTransfer(
      snapshot.id, snapshot.data(), actor.workspaceId);
    if (!transfer) {
      throw new ApplicationError("domain_precondition_failed",
        TRANSFER_INCONSISTENT_MESSAGE, {ineligible: "inconsistent_transfer"});
    }
    if (role === "member" && transfer.createdBy !== actor.uid) {
      throw new ApplicationError("workspace_role_denied",
        MEMBER_TRANSFER_OWNERSHIP_MESSAGE);
    }
    if (
      compareCommitTimes(transfer.updatedAt,
        parseIsoInstant(payload.expectedUpdatedAt)) !== 0
    ) {
      throw new ApplicationError("concurrent_update",
        TRANSFER_CONFLICT_MESSAGE);
    }
    if (transfer.status === "reversed") {
      throw new ApplicationError("domain_precondition_failed",
        TRANSFER_ALREADY_REVERSED_MESSAGE);
    }
    // As pernas originais vêm do servidor; o cliente não escolhe contas.
    const outMovement = await readPostedMovement(transaction,
      actor.workspaceId, transfer.outMovementId,
      {accountId: transfer.sourceAccountId, sourceId: transfer.id});
    const inMovement = await readPostedMovement(transaction,
      actor.workspaceId, transfer.inMovementId,
      {accountId: transfer.destinationAccountId, sourceId: transfer.id});
    if (
      outMovement.amountCents !== -transfer.amountCents ||
      inMovement.amountCents !== transfer.amountCents
    ) {
      throw new ApplicationError("domain_precondition_failed",
        TRANSFER_INCONSISTENT_MESSAGE, {ineligible: "inconsistent_transfer"});
    }
    const accounts = await readPostingAccounts(transaction, actor.workspaceId,
      [transfer.sourceAccountId, transfer.destinationAccountId]);
    const rateLimit = await reserveTransferRateLimit(transaction, actor);

    const outReversalId = transferMovementIdFor(transfer.id, "out", true);
    const inReversalId = transferMovementIdFor(transfer.id, "in", true);
    postAccountMovements(transaction, accounts, [
      reversalOfMovement(outMovement, outReversalId, transfer.id),
      reversalOfMovement(inMovement, inReversalId, transfer.id),
    ], {
      workspaceId: actor.workspaceId,
      actorUid: actor.uid,
      operation: REVERSE_CASH_TRANSFER_OPERATION,
      requestId,
    });
    transaction.update(transferRef, {
      status: "reversed",
      reversal: {
        outMovementId: outReversalId,
        inMovementId: inReversalId,
        reason: payload.reason,
        reversedBy: actor.uid,
        reversedAt: FieldValue.serverTimestamp(),
      },
      updatedBy: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    appendCashAccountEvent(transaction, {
      workspaceId: actor.workspaceId,
      operation: "cash_transfer.reversed",
      targetKey: transfer.id,
      accountId: null,
      transferId: transfer.id,
      actorId: actor.uid,
      actorRole: role,
      intentId,
      requestHash: reservation.requestHash,
      requestId,
      correlationId: payload.correlationId ?? null,
      before: {status: "completed", amountCents: transfer.amountCents},
      after: {status: "reversed", amountCents: transfer.amountCents},
      reason: payload.reason,
    });
    const result = {transferId: transfer.id, status: "reversed" as const};
    completeActorIdempotency(transaction, reservation, {
      uid: actor.uid,
      operation: REVERSE_CASH_TRANSFER_OPERATION,
      workspaceId: actor.workspaceId,
      requestId,
      result,
    });
    rateLimit.commit();
    options.beforeCommit?.();
    return {...result, replayed: false};
  });
