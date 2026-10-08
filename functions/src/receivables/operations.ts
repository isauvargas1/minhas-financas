import * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";

import {
  postAccountMovements,
  readPostedMovement,
  readPostingAccounts,
  reversalOfMovement,
  type PostingAccounts,
} from "../accounts/ledger";
import {receivableAccountMovementIdFor} from "../accounts/model";
import {ApplicationError} from "../shared/errors";
import {
  completeActorIdempotency,
  reserveActorIdempotency,
  type ActorIdempotencyReservation,
} from "../shared/idempotency";
import {reserveRateLimit} from "../shared/rateLimit";
import {
  reassertWorkspaceActor,
  workspaceRef,
  type WorkspaceActor,
  type WorkspaceRole,
} from "../shared/workspaceAuth";
import {receiptCashCents} from "./cashEffect";
import {
  IDEMPOTENCY_CONFLICT_MESSAGE,
  INTERNAL_MESSAGE,
  RECEIVABLE_MUTATION_RATE_LIMIT,
  RECEIVABLE_ROLES,
  assertPjWorkspace,
  assertVersion,
  findIntentAnchor,
  type OperationOptions,
} from "./common";
import type {
  CancelReceivablePayload,
  CreateReceivablePayload,
  ReceivableMutationResult,
  ReceiveReceivablePayload,
  ReverseReceivableReceiptPayload,
  UpdateReceivablePayload,
} from "./contracts";
import {
  RECEIVABLE_EVENTS_COLLECTION,
  RECEIVABLE_SCHEMA_VERSION,
  appendReceivableEvent,
  balanceOf,
  clientsRef,
  deriveReceivableStatus,
  intentIdFor,
  isConsistentReceivableState,
  readAuthoritativeClient,
  readAuthoritativeReceivable,
  readAuthoritativeReceivableMovement,
  receiptMovementIdFor,
  receivableCashEntryFor,
  receivableCashMirrorDocument,
  receivableCashTransactionIdFor,
  receivableIdFor,
  receivableMovementDocument,
  receivableMovementsRef,
  receivableSnapshot,
  receivableStatePatch,
  receivablesRef,
  reversalMovementIdFor,
  type AuthoritativeReceivable,
  type ReceivableEventOperation,
  type ReceivableFinancialState,
} from "./model";

/**
 * Operações autoritativas de recebíveis (D-39, P3-I).
 *
 * Cada operação é uma transação do Firestore que faz tudo ou nada:
 *
 * 1. relê a autorização (conta ativa, membership ativo, papel, workspace
 *    ativo e PJ) e, quando grava caixa, a janela sem escritas do ledger;
 * 2. reserva a chave de idempotência do ator; replay devolve o resultado
 *    salvo sem escrita;
 * 3. procura a âncora durável da intenção: na criação, o próprio recebível
 *    no ID `(workspace, ator, chave)`; nas mutações, o evento da intenção em
 *    `receivable_events` de qualquer workspace. Mesma intenção = replay;
 *    mesma chave com outro conteúdo, recebível ou workspace = conflito;
 * 4. lê o recebível e exige o schema autoritativo (fora dele: recusa), a
 *    titularidade (`member` só no que criou) e a versão lida pelo cliente
 *    (`expectedUpdatedAt`);
 * 5. aplica as regras sobre o estado relido, reserva o limite operacional e
 *    só então escreve recebível, movimento, espelho de caixa, evento,
 *    idempotência e limite — no mesmo commit.
 *
 * Dinheiro só entra no caixa quando é recebido: a criação e o cancelamento
 * não tocam `transactions`. O recebimento grava um espelho com a marca
 * backend-only `receivableEntry` (principal = receita operacional; juros e
 * multa = receita financeira; desconto não é dinheiro). Nada é apagado: o
 * estorno é um movimento compensatório com `reversalOf`/`reversedBy`.
 */
export const CREATE_RECEIVABLE_OPERATION = "createReceivable";
export const UPDATE_RECEIVABLE_OPERATION = "updateReceivable";
export const RECEIVE_RECEIVABLE_OPERATION = "receiveReceivable";
export const REVERSE_RECEIVABLE_RECEIPT_OPERATION = "reverseReceivableReceipt";
export const CANCEL_RECEIVABLE_OPERATION = "cancelReceivable";

export const RECEIVABLE_NOT_FOUND_MESSAGE = "Recebível não encontrado.";
export const INCONSISTENT_RECEIVABLE_MESSAGE =
  "Este recebível tem dados inconsistentes e não pode ser alterado.";
export const RECEIVABLE_CONFLICT_MESSAGE =
  "Este recebível foi alterado por outra operação depois que você o abriu. " +
  "Atualize e tente novamente.";
export const MEMBER_RECEIVABLE_OWNERSHIP_MESSAGE =
  "Membros só podem administrar os recebíveis que registraram.";
export const RECEIVABLE_CLIENT_NOT_FOUND_MESSAGE = "Cliente não encontrado.";
export const RECEIVABLE_CLIENT_ARCHIVED_MESSAGE =
  "Cliente arquivado não recebe novos recebíveis.";
export const RECEIVABLE_CANCELLED_MESSAGE =
  "Recebível cancelado não recebe novas operações.";
export const RECEIVABLE_ALREADY_RECEIVED_MESSAGE =
  "Este recebível já está quitado: não há saldo a receber.";
export const RECEIPT_ABOVE_BALANCE_MESSAGE =
  "Principal e desconto somados ultrapassam o saldo do recebível.";
export const RECEIVABLE_AMOUNT_LOCKED_MESSAGE =
  "O valor só pode ser alterado enquanto não houver recebimento nem " +
  "desconto ativos. Estorne os recebimentos para corrigir o valor.";
export const RECEIVABLE_UNCHANGED_MESSAGE =
  "Nenhum dado foi alterado: os valores informados já são os atuais.";
export const RECEIVABLE_MOVEMENT_NOT_FOUND_MESSAGE =
  "Movimento não encontrado neste recebível.";
export const RECEIVABLE_MOVEMENT_NOT_REVERSIBLE_MESSAGE =
  "Só recebimentos podem ser estornados.";
export const RECEIVABLE_MOVEMENT_ALREADY_REVERSED_MESSAGE =
  "Este recebimento já foi estornado.";
export const RECEIVABLE_ALREADY_CANCELLED_MESSAGE =
  "Este recebível já está cancelado.";
export const CANCEL_WITH_RECEIPTS_MESSAGE =
  "Este recebível tem recebimentos registrados. Estorne-os antes de " +
  "cancelar.";

const db = () => admin.firestore();

const replayResult = (
  stored: Record<string, unknown>,
): ReceivableMutationResult => {
  if (typeof stored.receivableId !== "string") {
    throw new ApplicationError("internal", INTERNAL_MESSAGE);
  }
  return {...(stored as unknown as ReceivableMutationResult), replayed: true};
};

const reserveReceivableRateLimit = (
  transaction: admin.firestore.Transaction,
  actor: WorkspaceActor,
) => reserveRateLimit(
  transaction,
  actor.workspaceId,
  actor.uid,
  RECEIVABLE_MUTATION_RATE_LIMIT,
);

const stateOf = (
  receivable: AuthoritativeReceivable,
): ReceivableFinancialState => ({
  amountCents: receivable.amountCents,
  principalReceivedCents: receivable.principalReceivedCents,
  discountGrantedCents: receivable.discountGrantedCents,
  interestReceivedCents: receivable.interestReceivedCents,
  penaltyReceivedCents: receivable.penaltyReceivedCents,
  balanceCents: receivable.balanceCents,
  activeReceiptCount: receivable.activeReceiptCount,
  status: receivable.status,
});

const assertConsistent = (state: ReceivableFinancialState): void => {
  if (!isConsistentReceivableState(state)) {
    throw new ApplicationError("internal", INCONSISTENT_RECEIVABLE_MESSAGE);
  }
};

// ----------------------------------------------------------------- criação

export const executeCreateReceivable = async (
  actor: WorkspaceActor,
  payload: CreateReceivablePayload,
  requestId: string,
  options: OperationOptions = {},
): Promise<ReceivableMutationResult> =>
  db().runTransaction(async (transaction) => {
    const {workspace, role} = await reassertWorkspaceActor(
      transaction, actor, RECEIVABLE_ROLES);
    assertPjWorkspace(workspace);
    const reservation = await reserveActorIdempotency(transaction, {
      uid: actor.uid,
      operation: CREATE_RECEIVABLE_OPERATION,
      idempotencyKey: payload.idempotencyKey,
      payload,
    });
    if (reservation.replay) return replayResult(reservation.replay);

    const receivableId = receivableIdFor(
      actor.workspaceId, actor.uid, payload.idempotencyKey);
    const receivableRef = receivablesRef(actor.workspaceId).doc(receivableId);
    const clientRef = clientsRef(actor.workspaceId).doc(payload.clientId);
    const [existing, clientSnapshot] = await transaction.getAll(
      receivableRef, clientRef);
    if (existing.exists) {
      // Chave expirada, recebível preservado: a âncora durável decide.
      if (
        existing.get("schemaVersion") === RECEIVABLE_SCHEMA_VERSION &&
        existing.get("requestHash") === reservation.requestHash &&
        existing.get("createdBy") === actor.uid
      ) {
        return {receivableId, replayed: true};
      }
      throw new ApplicationError("idempotency_conflict",
        IDEMPOTENCY_CONFLICT_MESSAGE);
    }
    const client = clientSnapshot.exists ?
      readAuthoritativeClient(
        clientSnapshot.id, clientSnapshot.data(), actor.workspaceId) :
      null;
    if (!client) {
      throw new ApplicationError("not_found",
        RECEIVABLE_CLIENT_NOT_FOUND_MESSAGE);
    }
    if (client.status !== "active") {
      throw new ApplicationError("domain_precondition_failed",
        RECEIVABLE_CLIENT_ARCHIVED_MESSAGE);
    }
    const rateLimit = await reserveReceivableRateLimit(transaction, actor);

    const intentId = intentIdFor(actor.uid, payload.idempotencyKey);
    const state: ReceivableFinancialState = {
      amountCents: payload.amountCents,
      principalReceivedCents: 0,
      discountGrantedCents: 0,
      interestReceivedCents: 0,
      penaltyReceivedCents: 0,
      balanceCents: payload.amountCents,
      activeReceiptCount: 0,
      status: "open",
    };
    assertConsistent(state);
    transaction.create(receivableRef, {
      id: receivableId,
      schemaVersion: RECEIVABLE_SCHEMA_VERSION,
      workspaceId: actor.workspaceId,
      clientId: client.id,
      description: payload.description,
      ...(payload.category === undefined ? {} : {category: payload.category}),
      currency: "BRL",
      ...state,
      dueDate: payload.dueDate,
      requestHash: reservation.requestHash,
      revision: 1,
      createdBy: actor.uid,
      updatedBy: actor.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    appendReceivableEvent(transaction, {
      workspaceId: actor.workspaceId,
      receivableId,
      clientId: client.id,
      operation: "receivable.created",
      targetKey: receivableId,
      actorId: actor.uid,
      actorRole: role,
      intentId,
      requestHash: reservation.requestHash,
      requestId,
      correlationId: payload.correlationId ?? null,
      movementId: null,
      before: null,
      after: receivableSnapshot(state),
      reason: null,
      revision: 1,
    });
    const result = {
      receivableId,
      status: state.status,
      balanceCents: state.balanceCents,
    };
    completeActorIdempotency(transaction, reservation, {
      uid: actor.uid,
      operation: CREATE_RECEIVABLE_OPERATION,
      workspaceId: actor.workspaceId,
      requestId,
      result,
    });
    rateLimit.commit();
    options.beforeCommit?.();
    return {...result, replayed: false};
  });

// ---------------------------------------------------------------- mutações

interface MutationPayload {
  idempotencyKey: string;
  receivableId: string;
  expectedUpdatedAt: string;
}

interface LoadedReceivable {
  role: WorkspaceRole;
  reservation: ActorIdempotencyReservation;
  intentId: string;
  receivableRef: admin.firestore.DocumentReference;
  receivable: AuthoritativeReceivable;
}

type LoadOutcome =
  | {replay: ReceivableMutationResult}
  | {loaded: LoadedReceivable};

const loadReceivableForMutation = async (
  transaction: admin.firestore.Transaction,
  actor: WorkspaceActor,
  payload: MutationPayload,
  operation: string,
  eventOperation: ReceivableEventOperation,
): Promise<LoadOutcome> => {
  const {workspace, role} = await reassertWorkspaceActor(
    transaction, actor, RECEIVABLE_ROLES);
  assertPjWorkspace(workspace);
  const reservation = await reserveActorIdempotency(transaction, {
    uid: actor.uid,
    operation,
    idempotencyKey: payload.idempotencyKey,
    payload: payload as unknown as Record<string, unknown>,
  });
  if (reservation.replay) return {replay: replayResult(reservation.replay)};

  const intentId = intentIdFor(actor.uid, payload.idempotencyKey);
  const receivableRef = receivablesRef(actor.workspaceId)
    .doc(payload.receivableId);
  const snapshot = await transaction.get(receivableRef);
  const anchor = await findIntentAnchor(
    transaction, RECEIVABLE_EVENTS_COLLECTION, intentId, eventOperation);
  if (anchor) {
    if (
      anchor.get("requestHash") !== reservation.requestHash ||
      anchor.get("actorId") !== actor.uid ||
      anchor.get("workspaceId") !== actor.workspaceId ||
      anchor.get("receivableId") !== payload.receivableId
    ) {
      throw new ApplicationError("idempotency_conflict",
        IDEMPOTENCY_CONFLICT_MESSAGE);
    }
    const movementId = anchor.get("movementId");
    return {
      replay: {
        receivableId: payload.receivableId,
        ...(typeof movementId === "string" ? {movementId} : {}),
        // Só a alteração efetiva tem evento (a sem efeito é recusada).
        ...(eventOperation === "receivable.updated" ? {changed: true} : {}),
        replayed: true,
      },
    };
  }
  if (!snapshot.exists) {
    throw new ApplicationError("not_found", RECEIVABLE_NOT_FOUND_MESSAGE);
  }
  const receivable = readAuthoritativeReceivable(
    snapshot.id, snapshot.data(), actor.workspaceId);
  if (!receivable) {
    // Fora do schema autoritativo: falha fechada, nunca "consertado".
    throw new ApplicationError("domain_precondition_failed",
      INCONSISTENT_RECEIVABLE_MESSAGE, {ineligible: "inconsistent"});
  }
  if (role === "member" && receivable.createdBy !== actor.uid) {
    throw new ApplicationError("workspace_role_denied",
      MEMBER_RECEIVABLE_OWNERSHIP_MESSAGE);
  }
  assertVersion(receivable.updatedAt, payload.expectedUpdatedAt,
    RECEIVABLE_CONFLICT_MESSAGE);
  return {
    loaded: {role, reservation, intentId, receivableRef, receivable},
  };
};

// ----------------------------------------------------------------- edição

export const executeUpdateReceivable = async (
  actor: WorkspaceActor,
  payload: UpdateReceivablePayload,
  requestId: string,
  options: OperationOptions = {},
): Promise<ReceivableMutationResult> =>
  db().runTransaction(async (transaction) => {
    const outcome = await loadReceivableForMutation(
      transaction, actor, payload, UPDATE_RECEIVABLE_OPERATION,
      "receivable.updated");
    if ("replay" in outcome) return outcome.replay;
    const {loaded} = outcome;
    const {receivable} = loaded;
    const {changes} = payload;
    if (receivable.status === "cancelled") {
      throw new ApplicationError("domain_precondition_failed",
        RECEIVABLE_CANCELLED_MESSAGE);
    }

    const changedFields: string[] = [];
    const patch: admin.firestore.DocumentData = {};
    if (
      changes.description !== undefined &&
      changes.description !== receivable.description
    ) {
      patch.description = changes.description;
      changedFields.push("description");
    }
    if (changes.category !== undefined) {
      if (changes.category === null && receivable.category !== null) {
        patch.category = FieldValue.delete();
        changedFields.push("category");
      } else if (
        changes.category !== null &&
        changes.category !== receivable.category
      ) {
        patch.category = changes.category;
        changedFields.push("category");
      }
    }
    if (
      changes.dueDate !== undefined &&
      changes.dueDate !== receivable.dueDate
    ) {
      patch.dueDate = changes.dueDate;
      changedFields.push("dueDate");
    }
    const before = stateOf(receivable);
    let next = before;
    if (
      changes.amountCents !== undefined &&
      changes.amountCents !== receivable.amountCents
    ) {
      // Principal contratado imutável depois do primeiro recebimento ativo.
      if (
        receivable.activeReceiptCount > 0 ||
        receivable.principalReceivedCents > 0 ||
        receivable.discountGrantedCents > 0
      ) {
        throw new ApplicationError("domain_precondition_failed",
          RECEIVABLE_AMOUNT_LOCKED_MESSAGE);
      }
      const balanceCents = changes.amountCents;
      next = {
        ...before,
        amountCents: changes.amountCents,
        balanceCents,
        status: deriveReceivableStatus(false, balanceCents),
      };
      changedFields.push("amountCents");
    }
    if (changedFields.length === 0) {
      throw new ApplicationError("domain_precondition_failed",
        RECEIVABLE_UNCHANGED_MESSAGE);
    }
    assertConsistent(next);
    const rateLimit = await reserveReceivableRateLimit(transaction, actor);

    const revision = receivable.revision + 1;
    transaction.update(loaded.receivableRef, {
      ...patch,
      ...receivableStatePatch(next, actor.uid, revision),
    });
    appendReceivableEvent(transaction, {
      workspaceId: actor.workspaceId,
      receivableId: receivable.id,
      clientId: receivable.clientId,
      operation: "receivable.updated",
      targetKey: loaded.intentId,
      actorId: actor.uid,
      actorRole: loaded.role,
      intentId: loaded.intentId,
      requestHash: loaded.reservation.requestHash,
      requestId,
      correlationId: payload.correlationId ?? null,
      movementId: null,
      before: receivableSnapshot(before),
      after: receivableSnapshot(next),
      changedFields: changedFields.sort(),
      reason: null,
      revision,
    });
    const result = {
      receivableId: receivable.id,
      changed: true,
      status: next.status,
      balanceCents: next.balanceCents,
    };
    completeActorIdempotency(transaction, loaded.reservation, {
      uid: actor.uid,
      operation: UPDATE_RECEIVABLE_OPERATION,
      workspaceId: actor.workspaceId,
      requestId,
      result,
    });
    rateLimit.commit();
    options.beforeCommit?.();
    return {...result, replayed: false};
  });

// -------------------------------------------------------------- recebimento

export const executeReceiveReceivable = async (
  actor: WorkspaceActor,
  payload: ReceiveReceivablePayload,
  requestId: string,
  options: OperationOptions = {},
): Promise<ReceivableMutationResult> =>
  db().runTransaction(async (transaction) => {
    const cashCents = receiptCashCents(payload);
    const outcome = await loadReceivableForMutation(
      transaction, actor, payload, RECEIVE_RECEIVABLE_OPERATION,
      "receivable.received");
    if ("replay" in outcome) return outcome.replay;
    const {loaded} = outcome;
    const {receivable} = loaded;

    if (receivable.status === "cancelled") {
      throw new ApplicationError("domain_precondition_failed",
        RECEIVABLE_CANCELLED_MESSAGE);
    }
    if (receivable.status === "received") {
      throw new ApplicationError("domain_precondition_failed",
        RECEIVABLE_ALREADY_RECEIVED_MESSAGE);
    }
    if (payload.principalCents + payload.discountCents >
      receivable.balanceCents) {
      throw new ApplicationError("domain_precondition_failed",
        RECEIPT_ABOVE_BALANCE_MESSAGE);
    }
    // Conta que recebe o dinheiro (D-30): só quando há dinheiro.
    const accountId = cashCents > 0 ? payload.cashAccountId ?? null : null;
    const accounts: PostingAccounts = accountId ?
      await readPostingAccounts(transaction, actor.workspaceId, [accountId]) :
      new Map();
    const rateLimit = await reserveReceivableRateLimit(transaction, actor);

    const before = stateOf(receivable);
    const accumulated = {
      ...before,
      principalReceivedCents:
        before.principalReceivedCents + payload.principalCents,
      discountGrantedCents: before.discountGrantedCents + payload.discountCents,
      interestReceivedCents:
        before.interestReceivedCents + payload.interestCents,
      penaltyReceivedCents: before.penaltyReceivedCents + payload.penaltyCents,
      activeReceiptCount: before.activeReceiptCount + 1,
    };
    const balanceCents = balanceOf(accumulated);
    const next: ReceivableFinancialState = {
      ...accumulated,
      balanceCents,
      status: deriveReceivableStatus(false, balanceCents),
    };
    assertConsistent(next);

    const movementId = receiptMovementIdFor(receivable.id, loaded.intentId);
    const cashTransactionId = cashCents > 0 ?
      receivableCashTransactionIdFor(movementId) : null;
    const accountMovementId = accountId ?
      receivableAccountMovementIdFor(movementId) : null;
    const revision = receivable.revision + 1;
    if (accountId && accountMovementId) {
      // Principal + juros + multa entram na conta; desconto não é dinheiro.
      postAccountMovements(transaction, accounts, [{
        id: accountMovementId,
        accountId,
        kind: "receivable",
        amountCents: cashCents,
        effectiveDate: payload.paymentDate,
        sourceDomain: "receivable",
        sourceId: receivable.id,
        sourceFactId: movementId,
        reversalOf: null,
      }], {
        workspaceId: actor.workspaceId,
        actorUid: actor.uid,
        operation: RECEIVE_RECEIVABLE_OPERATION,
        requestId,
      });
    }
    transaction.create(
      receivableMovementsRef(actor.workspaceId).doc(movementId),
      receivableMovementDocument({
        id: movementId,
        workspaceId: actor.workspaceId,
        receivableId: receivable.id,
        clientId: receivable.clientId,
        kind: "receipt",
        principalCents: payload.principalCents,
        interestCents: payload.interestCents,
        penaltyCents: payload.penaltyCents,
        discountCents: payload.discountCents,
        date: payload.paymentDate,
        cashTransactionId,
        cashAccountId: accountId,
        accountMovementId,
        reversalOf: null,
        reason: null,
        actorUid: actor.uid,
        intentId: loaded.intentId,
        requestHash: loaded.reservation.requestHash,
      }),
    );
    if (cashTransactionId) {
      transaction.create(
        workspaceRef(actor.workspaceId).collection("transactions")
          .doc(cashTransactionId),
        receivableCashMirrorDocument({
          workspaceId: actor.workspaceId,
          actorUid: actor.uid,
          date: payload.paymentDate,
          cashAccountId: accountId as string,
          entry: receivableCashEntryFor({
            receivableId: receivable.id,
            movementId,
            clientId: receivable.clientId,
            reversal: false,
            reversalOf: null,
            principalCents: payload.principalCents,
            interestCents: payload.interestCents,
            penaltyCents: payload.penaltyCents,
            discountCents: payload.discountCents,
          }),
        }),
      );
    }
    transaction.update(
      loaded.receivableRef,
      receivableStatePatch(next, actor.uid, revision),
    );
    appendReceivableEvent(transaction, {
      workspaceId: actor.workspaceId,
      receivableId: receivable.id,
      clientId: receivable.clientId,
      operation: "receivable.received",
      targetKey: movementId,
      actorId: actor.uid,
      actorRole: loaded.role,
      intentId: loaded.intentId,
      requestHash: loaded.reservation.requestHash,
      requestId,
      correlationId: payload.correlationId ?? null,
      movementId,
      before: receivableSnapshot(before),
      after: receivableSnapshot(next),
      reason: null,
      revision,
    });
    const result = {
      receivableId: receivable.id,
      movementId,
      cashTransactionId,
      status: next.status,
      balanceCents: next.balanceCents,
    };
    completeActorIdempotency(transaction, loaded.reservation, {
      uid: actor.uid,
      operation: RECEIVE_RECEIVABLE_OPERATION,
      workspaceId: actor.workspaceId,
      requestId,
      result,
    });
    rateLimit.commit();
    options.beforeCommit?.();
    return {...result, replayed: false};
  });

// ------------------------------------------------------------------ estorno

export const executeReverseReceivableReceipt = async (
  actor: WorkspaceActor,
  payload: ReverseReceivableReceiptPayload,
  requestId: string,
  options: OperationOptions = {},
): Promise<ReceivableMutationResult> =>
  db().runTransaction(async (transaction) => {
    const outcome = await loadReceivableForMutation(
      transaction, actor, payload, REVERSE_RECEIVABLE_RECEIPT_OPERATION,
      "receivable.receipt_reversed");
    if ("replay" in outcome) return outcome.replay;
    const {loaded} = outcome;
    const {receivable} = loaded;
    if (receivable.status === "cancelled") {
      throw new ApplicationError("domain_precondition_failed",
        RECEIVABLE_CANCELLED_MESSAGE);
    }
    const movementRef = receivableMovementsRef(actor.workspaceId)
      .doc(payload.movementId);
    const movement = readAuthoritativeReceivableMovement(
      movementRef.id,
      (await transaction.get(movementRef)).data(),
      actor.workspaceId,
      receivable.id,
    );
    if (!movement) {
      throw new ApplicationError("not_found",
        RECEIVABLE_MOVEMENT_NOT_FOUND_MESSAGE);
    }
    if (movement.kind !== "receipt") {
      throw new ApplicationError("domain_precondition_failed",
        RECEIVABLE_MOVEMENT_NOT_REVERSIBLE_MESSAGE);
    }
    if (movement.reversedBy !== null) {
      throw new ApplicationError("domain_precondition_failed",
        RECEIVABLE_MOVEMENT_ALREADY_REVERSED_MESSAGE);
    }
    // A conta é a do recebimento original (D-30); o cliente não a escolhe.
    const accountMovement = movement.accountMovementId &&
      movement.cashAccountId ?
      await readPostedMovement(transaction, actor.workspaceId,
        movement.accountMovementId,
        {accountId: movement.cashAccountId, sourceId: receivable.id}) :
      null;
    if (
      accountMovement &&
      (accountMovement.amountCents !== receiptCashCents(movement) ||
        accountMovement.sourceFactId !== movement.id)
    ) {
      throw new ApplicationError("internal", INTERNAL_MESSAGE);
    }
    const accounts: PostingAccounts = accountMovement ?
      await readPostingAccounts(transaction, actor.workspaceId,
        [accountMovement.accountId]) :
      new Map();
    const rateLimit = await reserveReceivableRateLimit(transaction, actor);

    const before = stateOf(receivable);
    const restored = {
      ...before,
      principalReceivedCents:
        before.principalReceivedCents - movement.principalCents,
      discountGrantedCents:
        before.discountGrantedCents - movement.discountCents,
      interestReceivedCents:
        before.interestReceivedCents - movement.interestCents,
      penaltyReceivedCents: before.penaltyReceivedCents - movement.penaltyCents,
      activeReceiptCount: before.activeReceiptCount - 1,
    };
    const balanceCents = balanceOf(restored);
    const next: ReceivableFinancialState = {
      ...restored,
      balanceCents,
      status: deriveReceivableStatus(false, balanceCents),
    };
    assertConsistent(next);

    const reversalId = reversalMovementIdFor(movement.id);
    const cashTransactionId = movement.cashTransactionId ?
      receivableCashTransactionIdFor(reversalId) : null;
    const reversalAccountMovementId = accountMovement ?
      receivableAccountMovementIdFor(reversalId) : null;
    const revision = receivable.revision + 1;
    if (accountMovement && reversalAccountMovementId) {
      postAccountMovements(transaction, accounts, [reversalOfMovement(
        accountMovement, reversalAccountMovementId, reversalId)], {
        workspaceId: actor.workspaceId,
        actorUid: actor.uid,
        operation: REVERSE_RECEIVABLE_RECEIPT_OPERATION,
        requestId,
      });
    }
    transaction.create(
      receivableMovementsRef(actor.workspaceId).doc(reversalId),
      receivableMovementDocument({
        id: reversalId,
        workspaceId: actor.workspaceId,
        receivableId: receivable.id,
        clientId: receivable.clientId,
        kind: "reversal",
        principalCents: movement.principalCents,
        interestCents: movement.interestCents,
        penaltyCents: movement.penaltyCents,
        discountCents: movement.discountCents,
        // O estorno corrige o fato: mesmo dia civil do original, para que o
        // mês do original some zero.
        date: movement.date,
        cashTransactionId,
        cashAccountId: movement.cashAccountId,
        accountMovementId: reversalAccountMovementId,
        reversalOf: movement.id,
        reason: payload.reason,
        actorUid: actor.uid,
        intentId: loaded.intentId,
        requestHash: loaded.reservation.requestHash,
      }),
    );
    transaction.update(movementRef, {
      reversedBy: reversalId,
      reversedAt: FieldValue.serverTimestamp(),
    });
    if (cashTransactionId) {
      transaction.create(
        workspaceRef(actor.workspaceId).collection("transactions")
          .doc(cashTransactionId),
        receivableCashMirrorDocument({
          workspaceId: actor.workspaceId,
          actorUid: actor.uid,
          date: movement.date,
          cashAccountId: movement.cashAccountId as string,
          entry: receivableCashEntryFor({
            receivableId: receivable.id,
            movementId: reversalId,
            clientId: receivable.clientId,
            reversal: true,
            reversalOf: movement.id,
            principalCents: movement.principalCents,
            interestCents: movement.interestCents,
            penaltyCents: movement.penaltyCents,
            discountCents: movement.discountCents,
          }),
        }),
      );
    }
    transaction.update(
      loaded.receivableRef,
      receivableStatePatch(next, actor.uid, revision),
    );
    appendReceivableEvent(transaction, {
      workspaceId: actor.workspaceId,
      receivableId: receivable.id,
      clientId: receivable.clientId,
      operation: "receivable.receipt_reversed",
      targetKey: movement.id,
      actorId: actor.uid,
      actorRole: loaded.role,
      intentId: loaded.intentId,
      requestHash: loaded.reservation.requestHash,
      requestId,
      correlationId: payload.correlationId ?? null,
      movementId: reversalId,
      before: receivableSnapshot(before),
      after: receivableSnapshot(next),
      reason: payload.reason,
      revision,
    });
    const result = {
      receivableId: receivable.id,
      movementId: reversalId,
      cashTransactionId,
      status: next.status,
      balanceCents: next.balanceCents,
    };
    completeActorIdempotency(transaction, loaded.reservation, {
      uid: actor.uid,
      operation: REVERSE_RECEIVABLE_RECEIPT_OPERATION,
      workspaceId: actor.workspaceId,
      requestId,
      result,
    });
    rateLimit.commit();
    options.beforeCommit?.();
    return {...result, replayed: false};
  });

// ------------------------------------------------------------- cancelamento

export const executeCancelReceivable = async (
  actor: WorkspaceActor,
  payload: CancelReceivablePayload,
  requestId: string,
  options: OperationOptions = {},
): Promise<ReceivableMutationResult> =>
  db().runTransaction(async (transaction) => {
    const outcome = await loadReceivableForMutation(
      transaction, actor, payload, CANCEL_RECEIVABLE_OPERATION,
      "receivable.cancelled");
    if ("replay" in outcome) return outcome.replay;
    const {loaded} = outcome;
    const {receivable} = loaded;
    if (receivable.status === "cancelled") {
      throw new ApplicationError("domain_precondition_failed",
        RECEIVABLE_ALREADY_CANCELLED_MESSAGE);
    }
    if (receivable.activeReceiptCount > 0) {
      throw new ApplicationError("domain_precondition_failed",
        CANCEL_WITH_RECEIPTS_MESSAGE);
    }
    const rateLimit = await reserveReceivableRateLimit(transaction, actor);

    const before = stateOf(receivable);
    // Sem recebimento ativo nada entrou no caixa: cancelar não grava caixa.
    const next: ReceivableFinancialState = {
      ...before,
      status: deriveReceivableStatus(true, before.balanceCents),
    };
    assertConsistent(next);
    const revision = receivable.revision + 1;
    transaction.update(loaded.receivableRef, {
      ...receivableStatePatch(next, actor.uid, revision),
      cancelReason: payload.reason,
      cancelledBy: actor.uid,
      cancelledAt: FieldValue.serverTimestamp(),
    });
    appendReceivableEvent(transaction, {
      workspaceId: actor.workspaceId,
      receivableId: receivable.id,
      clientId: receivable.clientId,
      operation: "receivable.cancelled",
      targetKey: receivable.id,
      actorId: actor.uid,
      actorRole: loaded.role,
      intentId: loaded.intentId,
      requestHash: loaded.reservation.requestHash,
      requestId,
      correlationId: payload.correlationId ?? null,
      movementId: null,
      before: receivableSnapshot(before),
      after: receivableSnapshot(next),
      reason: payload.reason,
      revision,
    });
    const result = {
      receivableId: receivable.id,
      status: next.status,
      balanceCents: next.balanceCents,
    };
    completeActorIdempotency(transaction, loaded.reservation, {
      uid: actor.uid,
      operation: CANCEL_RECEIVABLE_OPERATION,
      workspaceId: actor.workspaceId,
      requestId,
      result,
    });
    rateLimit.commit();
    options.beforeCommit?.();
    return {...result, replayed: false};
  });
