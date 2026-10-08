import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";

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
import type {
  ArchiveCashAccountPayload,
  CashAccountMutationResult,
  CreateCashAccountPayload,
  ReactivateCashAccountPayload,
  UpdateCashAccountPayload,
} from "./contracts";
import {postAccountMovements} from "./ledger";
import {
  CASH_ACCOUNT_EVENTS_COLLECTION,
  CASH_ACCOUNT_LIMIT_PER_WORKSPACE,
  accountIntentIdFor,
  appendCashAccountEvent,
  cashAccountDocument,
  cashAccountEventIdFor,
  cashAccountEventsRef,
  cashAccountIdFor,
  cashAccountsRef,
  openingBalanceMovementIdFor,
  readAuthoritativeCashAccount,
  type AuthoritativeCashAccount,
  type CashAccountEventOperation,
} from "./model";

/**
 * Operações autoritativas do cadastro de contas/carteiras (D-30, P3-J).
 *
 * - Só owner e admin criam, renomeiam, mudam o tipo, arquivam e reativam;
 *   member usa as contas ativas nas operações permitidas; viewer só lê.
 *   O papel é relido dentro da transação.
 * - O saldo inicial, quando diferente de zero, vira o movimento
 *   `opening_balance` no mesmo commit da criação. Não é receita nem despesa,
 *   não consome quota e não entra na projeção de caixa; compõe só o saldo.
 * - Depois da criação, o saldo nunca é editado: correção é movimento
 *   explícito do domínio de origem.
 * - Arquivar exige saldo zero (lido na transação). Conta arquivada não aceita
 *   movimento; reativar a devolve ao uso. Nenhuma exclusão.
 */
export const CREATE_CASH_ACCOUNT_OPERATION = "createCashAccount";
export const UPDATE_CASH_ACCOUNT_OPERATION = "updateCashAccount";
export const ARCHIVE_CASH_ACCOUNT_OPERATION = "archiveCashAccount";
export const REACTIVATE_CASH_ACCOUNT_OPERATION = "reactivateCashAccount";

export const CASH_ACCOUNT_ADMIN_ROLES: readonly WorkspaceRole[] =
  ["owner", "admin"];

/** Limite operacional do cadastro (não é quota comercial). */
export const CASH_ACCOUNT_MUTATION_RATE_LIMIT: RateLimitPolicy = {
  operation: "cashAccountMutation",
  limit: 60,
  windowSeconds: 10 * 60,
};

export const ACCOUNT_IDEMPOTENCY_CONFLICT_MESSAGE =
  "Esta chave de idempotência já foi usada com outros dados.";
export const ACCOUNT_CONFLICT_MESSAGE =
  "Esta conta foi alterada por outra operação depois que você a abriu. " +
  "Atualize e tente novamente.";
export const ACCOUNT_UNCHANGED_MESSAGE =
  "Nenhum dado foi alterado: os valores informados já são os atuais.";
export const ACCOUNT_ALREADY_ARCHIVED_MESSAGE = "Esta conta já está arquivada.";
export const ACCOUNT_LIMIT_MESSAGE =
  `Este espaço já tem o máximo de ${CASH_ACCOUNT_LIMIT_PER_WORKSPACE} contas ` +
  "(ativas e arquivadas). Reative uma conta arquivada em vez de criar outra.";
export const ACCOUNT_ALREADY_ACTIVE_MESSAGE = "Esta conta já está ativa.";
export const ACCOUNT_ARCHIVE_WITH_BALANCE_MESSAGE =
  "Só é possível arquivar uma conta com saldo zero. Transfira o saldo para " +
  "outra conta antes de arquivar.";
const ACCOUNT_NOT_FOUND_MESSAGE = "Conta não encontrada.";
const ACCOUNT_INCONSISTENT_MESSAGE =
  "Esta conta tem dados inconsistentes e não pode ser alterada.";
const ACCOUNT_INTERNAL_MESSAGE =
  "Não foi possível concluir a operação. Tente novamente.";

/** Relógio e ponto de falha injetáveis, só para os testes. */
export interface CashAccountOperationOptions {
  now?: () => number;
  /** Com todas as escritas enfileiradas, antes do commit. */
  beforeCommit?: () => void;
}

const db = () => admin.firestore();

const replayResult = (
  stored: Record<string, unknown>,
): CashAccountMutationResult => {
  if (typeof stored.accountId !== "string") {
    throw new ApplicationError("internal", ACCOUNT_INTERNAL_MESSAGE);
  }
  return {...(stored as unknown as CashAccountMutationResult), replayed: true};
};

const reserveAccountRateLimit = (
  transaction: admin.firestore.Transaction,
  actor: WorkspaceActor,
) => reserveRateLimit(
  transaction,
  actor.workspaceId,
  actor.uid,
  CASH_ACCOUNT_MUTATION_RATE_LIMIT,
);

const accountSnapshot = (account: {
  name: string;
  accountType: string;
  status: string;
  balanceCents: number;
}): Record<string, string | number> => ({
  accountType: account.accountType,
  status: account.status,
  balanceCents: account.balanceCents,
});

// ----------------------------------------------------------------- criação

export const executeCreateCashAccount = async (
  actor: WorkspaceActor,
  payload: CreateCashAccountPayload,
  requestId: string,
  options: CashAccountOperationOptions = {},
): Promise<CashAccountMutationResult> =>
  db().runTransaction(async (transaction) => {
    const {role} = await reassertWorkspaceActor(
      transaction, actor, CASH_ACCOUNT_ADMIN_ROLES);
    const openingCents = payload.openingBalanceCents ?? 0;
    const reservation = await reserveActorIdempotency(transaction, {
      uid: actor.uid,
      operation: CREATE_CASH_ACCOUNT_OPERATION,
      idempotencyKey: payload.idempotencyKey,
      payload,
    });
    if (reservation.replay) return replayResult(reservation.replay);

    const accountId = cashAccountIdFor(
      actor.workspaceId, actor.uid, payload.idempotencyKey);
    const accountRef = cashAccountsRef(actor.workspaceId).doc(accountId);
    const createdEventRef = cashAccountEventsRef(actor.workspaceId)
      .doc(cashAccountEventIdFor("cash_account.created", accountId));
    const [existing, createdEvent] = await transaction.getAll(
      accountRef, createdEventRef);
    if (existing.exists || createdEvent.exists) {
      // Chave expirada, conta preservada: o evento de criação decide.
      if (
        existing.exists &&
        createdEvent.get("requestHash") === reservation.requestHash &&
        createdEvent.get("actorId") === actor.uid &&
        existing.get("createdBy") === actor.uid
      ) {
        return {accountId, status: "active", replayed: true};
      }
      throw new ApplicationError("idempotency_conflict",
        ACCOUNT_IDEMPOTENCY_CONFLICT_MESSAGE);
    }
    // Teto de contas: contagem relida na transação (o replay já saiu acima).
    const accountCount = (await transaction.get(
      cashAccountsRef(actor.workspaceId).count())).data().count;
    if (accountCount >= CASH_ACCOUNT_LIMIT_PER_WORKSPACE) {
      throw new ApplicationError("domain_precondition_failed",
        ACCOUNT_LIMIT_MESSAGE);
    }
    const rateLimit = await reserveAccountRateLimit(transaction, actor);

    const intentId = accountIntentIdFor(actor.uid, payload.idempotencyKey);
    const today = saoPauloDayKey(new Date((options.now ?? Date.now)()));
    transaction.create(accountRef, cashAccountDocument({
      id: accountId,
      workspaceId: actor.workspaceId,
      name: payload.name,
      accountType: payload.accountType,
      actorUid: actor.uid,
    }));
    if (openingCents !== 0) {
      // A conta acabou de nascer neste commit: o saldo relido é zero.
      const accounts = new Map([[accountId, {
        id: accountId,
        workspaceId: actor.workspaceId,
        name: payload.name,
        accountType: payload.accountType,
        status: "active" as const,
        balanceCents: 0,
        createdBy: actor.uid,
        updatedAt: Timestamp.now(),
        ref: accountRef,
      }]]);
      postAccountMovements(transaction, accounts, [{
        id: openingBalanceMovementIdFor(accountId),
        accountId,
        kind: "opening_balance",
        amountCents: openingCents,
        effectiveDate: payload.openingBalanceDate ?? today,
        sourceDomain: "account",
        sourceId: accountId,
        sourceFactId: accountId,
        reversalOf: null,
      }], {
        workspaceId: actor.workspaceId,
        actorUid: actor.uid,
        operation: CREATE_CASH_ACCOUNT_OPERATION,
        requestId,
      });
    }
    appendCashAccountEvent(transaction, {
      workspaceId: actor.workspaceId,
      operation: "cash_account.created",
      targetKey: accountId,
      accountId,
      transferId: null,
      actorId: actor.uid,
      actorRole: role,
      intentId,
      requestHash: reservation.requestHash,
      requestId,
      correlationId: payload.correlationId ?? null,
      before: null,
      after: {
        accountType: payload.accountType,
        status: "active",
        balanceCents: openingCents,
        openingBalanceCents: openingCents,
      },
      changedFields: ["name", "accountType"],
      reason: null,
    });
    const result = {accountId, status: "active" as const,
      balanceCents: openingCents};
    completeActorIdempotency(transaction, reservation, {
      uid: actor.uid,
      operation: CREATE_CASH_ACCOUNT_OPERATION,
      workspaceId: actor.workspaceId,
      requestId,
      result,
    });
    rateLimit.commit();
    options.beforeCommit?.();
    return {...result, replayed: false};
  });

// ---------------------------------------------------------------- mutações

interface AccountMutationPayload {
  idempotencyKey: string;
  accountId: string;
  expectedUpdatedAt: string;
  correlationId?: string;
}

interface LoadedAccount {
  role: WorkspaceRole;
  reservation: ActorIdempotencyReservation;
  intentId: string;
  account: AuthoritativeCashAccount;
  accountRef: admin.firestore.DocumentReference;
}

type AccountLoadOutcome =
  | {replay: CashAccountMutationResult}
  | {loaded: LoadedAccount};

const loadAccountForMutation = async (
  transaction: admin.firestore.Transaction,
  actor: WorkspaceActor,
  payload: AccountMutationPayload,
  operation: string,
  eventOperation: CashAccountEventOperation,
): Promise<AccountLoadOutcome> => {
  const {role} = await reassertWorkspaceActor(
    transaction, actor, CASH_ACCOUNT_ADMIN_ROLES);
  const reservation = await reserveActorIdempotency(transaction, {
    uid: actor.uid,
    operation,
    idempotencyKey: payload.idempotencyKey,
    payload: payload as unknown as Record<string, unknown>,
  });
  if (reservation.replay) {
    return {replay: replayResult(reservation.replay)};
  }
  const intentId = accountIntentIdFor(actor.uid, payload.idempotencyKey);
  const accountRef = cashAccountsRef(actor.workspaceId).doc(payload.accountId);
  const snapshot = await transaction.get(accountRef);
  // Âncora durável: o evento desta intenção, em qualquer workspace.
  const anchors = await transaction.get(
    db().collectionGroup(CASH_ACCOUNT_EVENTS_COLLECTION)
      .where("intentId", "==", intentId)
      .where("operation", "==", eventOperation)
      .limit(1),
  );
  const anchor = anchors.docs[0];
  if (anchor) {
    if (
      anchor.get("requestHash") !== reservation.requestHash ||
      anchor.get("actorId") !== actor.uid ||
      anchor.get("workspaceId") !== actor.workspaceId ||
      anchor.get("accountId") !== payload.accountId
    ) {
      throw new ApplicationError("idempotency_conflict",
        ACCOUNT_IDEMPOTENCY_CONFLICT_MESSAGE);
    }
    return {
      replay: {
        accountId: payload.accountId,
        ...(eventOperation === "cash_account.updated" ? {changed: true} : {}),
        ...(eventOperation === "cash_account.archived" ?
          {status: "archived" as const} : {}),
        ...(eventOperation === "cash_account.reactivated" ?
          {status: "active" as const} : {}),
        replayed: true,
      },
    };
  }
  if (!snapshot.exists) {
    throw new ApplicationError("not_found", ACCOUNT_NOT_FOUND_MESSAGE);
  }
  const account = readAuthoritativeCashAccount(
    snapshot.id, snapshot.data(), actor.workspaceId);
  if (!account) {
    throw new ApplicationError("domain_precondition_failed",
      ACCOUNT_INCONSISTENT_MESSAGE, {ineligible: "inconsistent_account"});
  }
  if (
    compareCommitTimes(account.updatedAt,
      parseIsoInstant(payload.expectedUpdatedAt)) !== 0
  ) {
    throw new ApplicationError("concurrent_update", ACCOUNT_CONFLICT_MESSAGE);
  }
  return {loaded: {role, reservation, intentId, account, accountRef}};
};

// ----------------------------------------------------------------- edição

export const executeUpdateCashAccount = async (
  actor: WorkspaceActor,
  payload: UpdateCashAccountPayload,
  requestId: string,
  options: CashAccountOperationOptions = {},
): Promise<CashAccountMutationResult> =>
  db().runTransaction(async (transaction) => {
    const outcome = await loadAccountForMutation(transaction, actor, payload,
      UPDATE_CASH_ACCOUNT_OPERATION, "cash_account.updated");
    if ("replay" in outcome) return outcome.replay;
    const {loaded} = outcome;
    const {account} = loaded;
    const {changes} = payload;
    const changedFields: string[] = [];
    if (changes.name !== undefined && changes.name !== account.name) {
      changedFields.push("name");
    }
    if (
      changes.accountType !== undefined &&
      changes.accountType !== account.accountType
    ) {
      changedFields.push("accountType");
    }
    if (changedFields.length === 0) {
      throw new ApplicationError("domain_precondition_failed",
        ACCOUNT_UNCHANGED_MESSAGE);
    }
    const rateLimit = await reserveAccountRateLimit(transaction, actor);
    const next = {
      ...account,
      name: changes.name ?? account.name,
      accountType: changes.accountType ?? account.accountType,
    };
    transaction.update(loaded.accountRef, {
      ...(changedFields.includes("name") ? {name: next.name} : {}),
      ...(changedFields.includes("accountType") ?
        {accountType: next.accountType} : {}),
      updatedBy: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    appendCashAccountEvent(transaction, {
      workspaceId: actor.workspaceId,
      operation: "cash_account.updated",
      targetKey: loaded.intentId,
      accountId: account.id,
      transferId: null,
      actorId: actor.uid,
      actorRole: loaded.role,
      intentId: loaded.intentId,
      requestHash: loaded.reservation.requestHash,
      requestId,
      correlationId: payload.correlationId ?? null,
      before: accountSnapshot(account),
      after: accountSnapshot(next),
      changedFields,
      reason: null,
    });
    const result = {accountId: account.id, changed: true};
    completeActorIdempotency(transaction, loaded.reservation, {
      uid: actor.uid,
      operation: UPDATE_CASH_ACCOUNT_OPERATION,
      workspaceId: actor.workspaceId,
      requestId,
      result,
    });
    rateLimit.commit();
    options.beforeCommit?.();
    return {...result, replayed: false};
  });

// -------------------------------------------------- arquivamento/reativação

const executeStatusChange = async (
  actor: WorkspaceActor,
  payload: ArchiveCashAccountPayload | ReactivateCashAccountPayload,
  requestId: string,
  target: "archived" | "active",
  options: CashAccountOperationOptions,
): Promise<CashAccountMutationResult> =>
  db().runTransaction(async (transaction) => {
    const operation = target === "archived" ?
      ARCHIVE_CASH_ACCOUNT_OPERATION : REACTIVATE_CASH_ACCOUNT_OPERATION;
    const eventOperation: CashAccountEventOperation = target === "archived" ?
      "cash_account.archived" : "cash_account.reactivated";
    const outcome = await loadAccountForMutation(transaction, actor, payload,
      operation, eventOperation);
    if ("replay" in outcome) return outcome.replay;
    const {loaded} = outcome;
    const {account} = loaded;
    if (account.status === target) {
      throw new ApplicationError("domain_precondition_failed",
        target === "archived" ?
          ACCOUNT_ALREADY_ARCHIVED_MESSAGE : ACCOUNT_ALREADY_ACTIVE_MESSAGE);
    }
    // O saldo relido nesta transação: um movimento concorrente sobre a
    // conta escreve o mesmo documento, e uma das duas é repetida.
    if (target === "archived" && account.balanceCents !== 0) {
      throw new ApplicationError("domain_precondition_failed",
        ACCOUNT_ARCHIVE_WITH_BALANCE_MESSAGE);
    }
    const rateLimit = await reserveAccountRateLimit(transaction, actor);
    transaction.update(loaded.accountRef, {
      status: target,
      updatedBy: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    appendCashAccountEvent(transaction, {
      workspaceId: actor.workspaceId,
      operation: eventOperation,
      targetKey: loaded.intentId,
      accountId: account.id,
      transferId: null,
      actorId: actor.uid,
      actorRole: loaded.role,
      intentId: loaded.intentId,
      requestHash: loaded.reservation.requestHash,
      requestId,
      correlationId: payload.correlationId ?? null,
      before: accountSnapshot(account),
      after: accountSnapshot({...account, status: target}),
      changedFields: ["status"],
      reason: null,
    });
    const result = {accountId: account.id, status: target};
    completeActorIdempotency(transaction, loaded.reservation, {
      uid: actor.uid,
      operation,
      workspaceId: actor.workspaceId,
      requestId,
      result,
    });
    rateLimit.commit();
    options.beforeCommit?.();
    return {...result, replayed: false};
  });

export const executeArchiveCashAccount = (
  actor: WorkspaceActor,
  payload: ArchiveCashAccountPayload,
  requestId: string,
  options: CashAccountOperationOptions = {},
): Promise<CashAccountMutationResult> =>
  executeStatusChange(actor, payload, requestId, "archived", options);

export const executeReactivateCashAccount = (
  actor: WorkspaceActor,
  payload: ReactivateCashAccountPayload,
  requestId: string,
  options: CashAccountOperationOptions = {},
): Promise<CashAccountMutationResult> =>
  executeStatusChange(actor, payload, requestId, "active", options);
