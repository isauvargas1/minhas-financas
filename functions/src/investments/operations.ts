import {createHash} from "node:crypto";
import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";

import type {WorkspaceAuthorizationContext} from "../creditCards/auth";
import {CreditCardApplicationError} from "../creditCards/errors";
import {toMinorUnits} from "../goals/operations";
import type {
  CancelInvestmentRedemptionPayload,
  ReverseInvestmentRedemptionPayload,
  SaveInvestmentRedemptionPayload,
} from "./contracts";

type InvestmentOperation =
  | "saveInvestmentRedemption"
  | "cancelInvestmentRedemption"
  | "reverseInvestmentRedemption";

interface IdempotencyReservation {
  ref: admin.firestore.DocumentReference;
  replay?: Record<string, unknown>;
  record?: Record<string, unknown>;
}

const db = () => admin.firestore();
const workspacePath = (workspaceId: string) => `workspaces/${workspaceId}`;
const transactionRef = (workspaceId: string, transactionId: string) =>
  db().doc(`${workspacePath(workspaceId)}/transactions/${transactionId}`);
const goalRef = (workspaceId: string, goalId: string) =>
  db().doc(`${workspacePath(workspaceId)}/goals/${goalId}`);
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
};

const reserveIdempotency = async (
  transaction: admin.firestore.Transaction,
  auth: WorkspaceAuthorizationContext,
  operation: InvestmentOperation,
  idempotencyKey: string,
  payload: unknown,
): Promise<IdempotencyReservation> => {
  const id = `${operation}_${sha256(`${auth.uid}:${idempotencyKey}`).slice(0, 32)}`;
  const ref = db().doc(`${workspacePath(auth.workspaceId)}/investment_idempotency_keys/${id}`);
  const requestHash = sha256(stableStringify(payload));
  const snapshot = await transaction.get(ref);
  if (snapshot.exists) {
    const data = snapshot.data();
    if (data?.actorId !== auth.uid || data?.requestHash !== requestHash) {
      throw new CreditCardApplicationError(
        "idempotency_conflict",
        "Esta solicitação já foi usada com outros dados.",
      );
    }
    if (data?.status === "completed") {
      return {ref, replay: data.result as Record<string, unknown>};
    }
    throw new CreditCardApplicationError(
      "idempotency_conflict",
      "Esta solicitação já está em processamento.",
    );
  }
  return {
    ref,
    record: {
      workspaceId: auth.workspaceId,
      actorId: auth.uid,
      operation,
      requestHash,
      idempotencyKeyHash: sha256(idempotencyKey),
    },
  };
};

const completeIdempotency = (
  transaction: admin.firestore.Transaction,
  reservation: IdempotencyReservation,
  result: Record<string, unknown>,
) => {
  transaction.create(reservation.ref, {
    ...reservation.record,
    status: "completed",
    result,
    createdAt: FieldValue.serverTimestamp(),
    completedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
};

const writeAudit = (
  transaction: admin.firestore.Transaction,
  auth: WorkspaceAuthorizationContext,
  operation: InvestmentOperation,
  idempotencyRef: admin.firestore.DocumentReference,
  targetId: string,
  details: Record<string, unknown>,
) => {
  transaction.create(
    db().doc(`${workspacePath(auth.workspaceId)}/investment_audit_logs/${idempotencyRef.id}`),
    {
      workspaceId: auth.workspaceId,
      profileType: details.profileType,
      actorId: auth.uid,
      actorRole: auth.role,
      operation,
      targetId,
      correlationId: idempotencyRef.id,
      details,
      timestamp: FieldValue.serverTimestamp(),
    },
  );
};

const exactCents = (value: number) => toMinorUnits(value);
const fromCents = (value: number) => value / 100;
const safeCents = (value: unknown, fallback = 0): number =>
  Number.isSafeInteger(value) ? value as number : fallback;

const sourcePrincipalCents = (source: admin.firestore.DocumentData): number => {
  const metadataPrincipal = source.investmentMetadata?.principalCents;
  if (Number.isSafeInteger(metadataPrincipal)) return metadataPrincipal;
  if (Number.isSafeInteger(source.valueCents)) return source.valueCents;
  return exactCents(Number(source.value));
};

const assertEligibleSource = (
  sourceSnapshot: admin.firestore.DocumentSnapshot,
): admin.firestore.DocumentData => {
  const source = sourceSnapshot.data();
  if (!sourceSnapshot.exists || !source || source.type !== "investimento" || source.isPaid !== true) {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      "O investimento de origem não está liquidado ou não existe.",
    );
  }
  const operation = source.investmentMetadata?.investmentOperation;
  if (operation && operation !== "contribution") {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      "O movimento informado não pode ser usado como origem de resgate.",
    );
  }
  if (source.investmentMetadata && source.investmentMetadata.status !== "settled") {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      "O investimento de origem não está liquidado.",
    );
  }
  if (source.investmentMetadata?.currency && source.investmentMetadata.currency !== "BRL") {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      "A moeda do investimento de origem não é compatível com este fluxo legado.",
    );
  }
  return source;
};

const adjustGoalProgress = (
  transaction: admin.firestore.Transaction,
  goalSnapshot: admin.firestore.DocumentSnapshot | null,
  deltaNetContributionCents: number,
  deltaCurrentValueCents: number,
  actorId: string,
) => {
  if (!goalSnapshot?.exists ||
    (deltaNetContributionCents === 0 && deltaCurrentValueCents === 0)) return;
  const goal = goalSnapshot.data() ?? {};
  const legacyCurrentCents = safeCents(
    goal.currentAmountCents,
    typeof goal.currentAmount === "number" ? exactCents(goal.currentAmount) : 0,
  );
  const currentNet = safeCents(goal.netContributionCents, legacyCurrentCents);
  const nextNet = currentNet + deltaNetContributionCents;
  if (nextNet < 0) {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      "O resgate deixaria o progresso da meta inconsistente.",
    );
  }
  const progressBasis = goal.progressBasis ?? "net_contributions";
  const currentValueCents = safeCents(
    goal.currentValueCents,
    typeof goal.currentValue === "number" ? exactCents(goal.currentValue) : 0,
  );
  const nextCurrentValueCents = progressBasis === "current_value" ?
    currentValueCents + deltaCurrentValueCents : currentValueCents;
  if (nextCurrentValueCents < 0) {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      "O resgate supera o valor atual disponível na meta.",
    );
  }
  const progressCents = progressBasis === "current_value" ? nextCurrentValueCents : nextNet;
  transaction.update(goalSnapshot.ref, {
    netContributionCents: nextNet,
    ...(progressBasis === "current_value" ? {
      currentValueCents: nextCurrentValueCents,
      currentValue: fromCents(nextCurrentValueCents),
    } : {}),
    currentAmountCents: progressCents,
    currentAmount: fromCents(progressCents),
    updatedBy: actorId,
    updatedAt: FieldValue.serverTimestamp(),
  });
};

const getProfileType = (workspace: admin.firestore.DocumentData | undefined): "PF" | "PJ" =>
  workspace?.type === "PJ" ? "PJ" : "PF";

const assertLegacyCurrency = (workspace: admin.firestore.DocumentData | undefined) => {
  if (workspace?.currency && workspace.currency !== "BRL") {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      "Este fluxo legado de resgate aceita somente valores em BRL.",
    );
  }
};

export const executeSaveInvestmentRedemption = async (
  auth: WorkspaceAuthorizationContext,
  payload: SaveInvestmentRedemptionPayload,
): Promise<Record<string, unknown>> => db().runTransaction(async (transaction) => {
  const reservation = await reserveIdempotency(
    transaction,
    auth,
    "saveInvestmentRedemption",
    payload.idempotencyKey,
    payload,
  );
  if (reservation.replay) return reservation.replay;

  const redemptionId = payload.transactionId ?? db()
    .collection(`${workspacePath(auth.workspaceId)}/transactions`).doc().id;
  const redemptionDocument = transactionRef(auth.workspaceId, redemptionId);
  const sourceDocument = transactionRef(auth.workspaceId, payload.redemption.sourceMovementId);
  const workspaceDocument = db().doc(workspacePath(auth.workspaceId));
  const [redemptionSnapshot, sourceSnapshot, workspaceSnapshot] = await Promise.all([
    transaction.get(redemptionDocument),
    transaction.get(sourceDocument),
    transaction.get(workspaceDocument),
  ]);
  const source = assertEligibleSource(sourceSnapshot);
  assertLegacyCurrency(workspaceSnapshot.data());
  const existing = redemptionSnapshot.data();
  if (existing) {
    const metadata = existing.investmentMetadata;
    if (metadata?.investmentOperation !== "redemption" || metadata.status !== "pending") {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "Somente um resgate pendente pode ser editado.",
      );
    }
  }

  const principalCents = exactCents(payload.redemption.principal);
  const gainCents = exactCents(payload.redemption.gain);
  const feesCents = exactCents(payload.redemption.fees);
  const taxCents = exactCents(payload.redemption.tax);
  if (taxCents > gainCents) {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      "O imposto não pode superar o ganho realizado.",
    );
  }
  const grossCents = principalCents + gainCents;
  const netCashCents = grossCents - feesCents - taxCents;
  if (!Number.isSafeInteger(grossCents) || !Number.isSafeInteger(netCashCents) || netCashCents <= 0) {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      "Os valores do resgate são inconsistentes.",
    );
  }

  const totalPrincipalCents = sourcePrincipalCents(source);
  if (source.redeemedPrincipalCents !== undefined &&
    !Number.isSafeInteger(source.redeemedPrincipalCents)) {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      "O saldo resgatado do investimento de origem é inválido.",
    );
  }
  if (source.remainingPrincipalCents !== undefined &&
    !Number.isSafeInteger(source.remainingPrincipalCents)) {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      "O saldo disponível do investimento de origem é inválido.",
    );
  }
  const redeemedPrincipalCents = safeCents(source.redeemedPrincipalCents);
  const remainingPrincipalCents = totalPrincipalCents - redeemedPrincipalCents;
  const persistedRemainingPrincipalCents = source.remainingPrincipalCents;
  if (redeemedPrincipalCents < 0 || redeemedPrincipalCents > totalPrincipalCents ||
    (persistedRemainingPrincipalCents !== undefined &&
      persistedRemainingPrincipalCents !== remainingPrincipalCents) ||
    principalCents > remainingPrincipalCents) {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      "O principal do resgate supera o saldo disponível do investimento.",
      {remainingPrincipalCents},
    );
  }

  const isSettled = payload.redemption.status === "settled";
  const goalId = typeof source.goalId === "string" ? source.goalId : undefined;
  const goalSnapshot = goalId ? await transaction.get(goalRef(auth.workspaceId, goalId)) : null;
  if (goalId && !goalSnapshot?.exists) {
    throw new CreditCardApplicationError("not_found", "A meta vinculada não foi encontrada.");
  }
  const profileType = getProfileType(workspaceSnapshot.data());
  const settlementTimestamp = Timestamp.fromDate(
    new Date(`${payload.redemption.settlementDate}T12:00:00.000Z`),
  );
  const metadata = {
    currency: "BRL",
    investmentOperation: "redemption",
    cashImpact: isSettled ? "inflow" : "none",
    investmentImpact: isSettled ? "decrease" : "none",
    principalCents,
    gainCents,
    feesCents,
    taxCents,
    settlementDate: settlementTimestamp,
    status: payload.redemption.status,
    sourceMovementId: payload.redemption.sourceMovementId,
    idempotencyKey: payload.idempotencyKey,
  };
  const persisted = {
    type: "investimento",
    description: payload.redemption.description,
    category: String(source.category ?? "Outros"),
    value: fromCents(netCashCents),
    valueCents: netCashCents,
    date: payload.redemption.settlementDate,
    transactionDate: settlementTimestamp,
    settlementDate: settlementTimestamp,
    isPaid: isSettled,
    workspaceId: auth.workspaceId,
    profileId: auth.workspaceId,
    profileType,
    userId: existing?.userId ?? auth.uid,
    ...(source.walletId !== undefined ? {walletId: String(source.walletId)} : {}),
    ...(goalId ? {goalId} : {}),
    ...(typeof source.costCenter === "string" ? {costCenter: source.costCenter} : {}),
    ...(typeof source.supplier === "string" ? {supplier: source.supplier} : {}),
    ...(source.displaySnapshots && typeof source.displaySnapshots === "object" ?
      {displaySnapshots: source.displaySnapshots} : {}),
    investmentMetadata: metadata,
    updatedBy: auth.uid,
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (redemptionSnapshot.exists) {
    transaction.update(redemptionDocument, persisted);
  } else {
    transaction.create(redemptionDocument, {
      ...persisted,
      createdBy: auth.uid,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  if (isSettled) {
    transaction.update(sourceDocument, {
      redeemedPrincipalCents: redeemedPrincipalCents + principalCents,
      remainingPrincipalCents: remainingPrincipalCents - principalCents,
      updatedBy: auth.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    adjustGoalProgress(
      transaction,
      goalSnapshot,
      -principalCents,
      -grossCents,
      auth.uid,
    );
  }

  const result = {
    success: true,
    transactionId: redemptionId,
    sourceMovementId: payload.redemption.sourceMovementId,
    status: payload.redemption.status,
    principalCents,
    gainCents,
    feesCents,
    taxCents,
    netCashCents,
    remainingPrincipalCents: remainingPrincipalCents - (isSettled ? principalCents : 0),
  };
  writeAudit(transaction, auth, "saveInvestmentRedemption", reservation.ref, redemptionId, {
    profileType,
    before: existing ?? null,
    after: persisted,
    sourceMovementId: payload.redemption.sourceMovementId,
    goalId: goalId ?? null,
  });
  completeIdempotency(transaction, reservation, result);
  return result;
});

export const executeCancelInvestmentRedemption = async (
  auth: WorkspaceAuthorizationContext,
  payload: CancelInvestmentRedemptionPayload,
): Promise<Record<string, unknown>> => db().runTransaction(async (transaction) => {
  const reservation = await reserveIdempotency(
    transaction, auth, "cancelInvestmentRedemption", payload.idempotencyKey, payload,
  );
  if (reservation.replay) return reservation.replay;
  const ref = transactionRef(auth.workspaceId, payload.transactionId);
  const workspaceRef = db().doc(workspacePath(auth.workspaceId));
  const [snapshot, workspaceSnapshot] = await Promise.all([
    transaction.get(ref),
    transaction.get(workspaceRef),
  ]);
  const current = snapshot.data();
  if (!snapshot.exists || current?.investmentMetadata?.investmentOperation !== "redemption") {
    throw new CreditCardApplicationError("not_found", "Resgate não encontrado.");
  }
  if (current.investmentMetadata.status !== "pending") {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      "Somente um resgate pendente pode ser cancelado.",
    );
  }
  const profileType = getProfileType(workspaceSnapshot.data());
  transaction.update(
    ref,
    "investmentMetadata.status", "cancelled",
    "investmentMetadata.cashImpact", "none",
    "investmentMetadata.investmentImpact", "none",
    "cancelledAt", FieldValue.serverTimestamp(),
    "cancelledBy", auth.uid,
    "cancellationReason", payload.reason,
    "updatedAt", FieldValue.serverTimestamp(),
  );
  const result = {success: true, transactionId: payload.transactionId, status: "cancelled"};
  writeAudit(transaction, auth, "cancelInvestmentRedemption", reservation.ref, payload.transactionId, {
    profileType,
    before: current,
    afterStatus: "cancelled",
    reason: payload.reason,
  });
  completeIdempotency(transaction, reservation, result);
  return result;
});

export const executeReverseInvestmentRedemption = async (
  auth: WorkspaceAuthorizationContext,
  payload: ReverseInvestmentRedemptionPayload,
): Promise<Record<string, unknown>> => db().runTransaction(async (transaction) => {
  const reservation = await reserveIdempotency(
    transaction, auth, "reverseInvestmentRedemption", payload.idempotencyKey, payload,
  );
  if (reservation.replay) return reservation.replay;
  const redemptionDocument = transactionRef(auth.workspaceId, payload.transactionId);
  const workspaceDocument = db().doc(workspacePath(auth.workspaceId));
  const [redemptionSnapshot, workspaceSnapshot] = await Promise.all([
    transaction.get(redemptionDocument),
    transaction.get(workspaceDocument),
  ]);
  const redemption = redemptionSnapshot.data();
  const metadata = redemption?.investmentMetadata;
  if (!redemptionSnapshot.exists || metadata?.investmentOperation !== "redemption") {
    throw new CreditCardApplicationError("not_found", "Resgate não encontrado.");
  }
  const redemptionData = redemption as admin.firestore.DocumentData;
  assertLegacyCurrency(workspaceSnapshot.data());
  if (metadata.status !== "settled" || metadata.reversalMovementId) {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      "O resgate não está disponível para estorno.",
    );
  }
  const sourceDocument = transactionRef(auth.workspaceId, String(metadata.sourceMovementId));
  const sourceSnapshot = await transaction.get(sourceDocument);
  const source = assertEligibleSource(sourceSnapshot);
  const goalId = typeof redemptionData.goalId === "string" ? redemptionData.goalId : undefined;
  const goalSnapshot = goalId ? await transaction.get(goalRef(auth.workspaceId, goalId)) : null;
  const principalCents = safeCents(metadata.principalCents);
  const redeemedPrincipalCents = safeCents(source.redeemedPrincipalCents);
  const totalPrincipalCents = sourcePrincipalCents(source);
  const remainingPrincipalCents = totalPrincipalCents - redeemedPrincipalCents;
  if (!Number.isSafeInteger(source.redeemedPrincipalCents) ||
    !Number.isSafeInteger(source.remainingPrincipalCents) ||
    source.remainingPrincipalCents !== remainingPrincipalCents ||
    principalCents <= 0 || redeemedPrincipalCents < principalCents) {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      "O saldo do investimento não permite estornar este resgate.",
    );
  }
  const reversalId = db().collection(`${workspacePath(auth.workspaceId)}/transactions`).doc().id;
  const reversalDocument = transactionRef(auth.workspaceId, reversalId);
  const reversalTimestamp = Timestamp.fromDate(new Date(`${payload.reversalDate}T12:00:00.000Z`));
  const profileType = getProfileType(workspaceSnapshot.data());
  const reversalMetadata = {
    currency: "BRL",
    investmentOperation: "redemption_reversal",
    cashImpact: "outflow",
    investmentImpact: "increase",
    principalCents,
    gainCents: safeCents(metadata.gainCents),
    feesCents: safeCents(metadata.feesCents),
    taxCents: safeCents(metadata.taxCents),
    settlementDate: reversalTimestamp,
    status: "settled",
    sourceMovementId: payload.transactionId,
    idempotencyKey: payload.idempotencyKey,
  };
  transaction.create(reversalDocument, {
    type: "investimento",
    description: `Estorno: ${String(redemptionData.description ?? "resgate")}`,
    category: String(redemptionData.category ?? source.category ?? "Outros"),
    value: Number(redemptionData.value),
    valueCents: safeCents(redemptionData.valueCents, exactCents(Number(redemptionData.value))),
    date: payload.reversalDate,
    transactionDate: reversalTimestamp,
    settlementDate: reversalTimestamp,
    isPaid: true,
    workspaceId: auth.workspaceId,
    profileId: auth.workspaceId,
    profileType,
    userId: auth.uid,
    ...(redemptionData.walletId !== undefined ? {walletId: String(redemptionData.walletId)} : {}),
    ...(goalId ? {goalId} : {}),
    ...(typeof redemptionData.costCenter === "string" ? {costCenter: redemptionData.costCenter} : {}),
    ...(typeof redemptionData.supplier === "string" ? {supplier: redemptionData.supplier} : {}),
    ...(redemptionData.displaySnapshots && typeof redemptionData.displaySnapshots === "object" ?
      {displaySnapshots: redemptionData.displaySnapshots} : {}),
    investmentMetadata: reversalMetadata,
    reversalReason: payload.reason,
    createdBy: auth.uid,
    updatedBy: auth.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  transaction.update(
    redemptionDocument,
    "investmentMetadata.status", "reversed",
    "investmentMetadata.reversalMovementId", reversalId,
    "reversedAt", FieldValue.serverTimestamp(),
    "reversedBy", auth.uid,
    "updatedAt", FieldValue.serverTimestamp(),
  );
  transaction.update(sourceDocument, {
    redeemedPrincipalCents: redeemedPrincipalCents - principalCents,
    remainingPrincipalCents: totalPrincipalCents - (redeemedPrincipalCents - principalCents),
    updatedBy: auth.uid,
    updatedAt: FieldValue.serverTimestamp(),
  });
  adjustGoalProgress(
    transaction,
    goalSnapshot,
    principalCents,
    principalCents + safeCents(metadata.gainCents),
    auth.uid,
  );
  const result = {
    success: true,
    transactionId: payload.transactionId,
    reversalMovementId: reversalId,
    status: "reversed",
  };
  writeAudit(transaction, auth, "reverseInvestmentRedemption", reservation.ref, payload.transactionId, {
    profileType,
    sourceMovementId: metadata.sourceMovementId,
    reversalMovementId: reversalId,
    principalCents,
    reason: payload.reason,
  });
  completeIdempotency(transaction, reservation, result);
  return result;
});
