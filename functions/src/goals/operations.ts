import {createHash} from "node:crypto";
import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";

import {CreditCardApplicationError} from "../creditCards/errors";
import type {WorkspaceAuthorizationContext} from "../creditCards/auth";
import type {
  ArchiveGoalPayload,
  CreateGoalPayload,
  RebuildGoalProgressPayload,
  SaveGoalContributionPayload,
  SeedLegacyCatalogPayload,
  SetGoalLinksPayload,
  UpdateGoalPayload,
} from "./contracts";

type GoalOperation =
  | "createGoal"
  | "updateGoal"
  | "setGoalTransactionLinks"
  | "archiveGoal"
  | "rebuildGoalProgress"
  | "saveGoalContribution"
  | "seedLegacySettingsCatalog";

interface IdempotencyReservation {
  ref: admin.firestore.DocumentReference;
  replay?: Record<string, unknown>;
  record?: Record<string, unknown>;
}

const db = () => admin.firestore();
const workspacePath = (workspaceId: string) => `workspaces/${workspaceId}`;
const goalRef = (workspaceId: string, goalId: string) =>
  db().doc(`${workspacePath(workspaceId)}/goals/${goalId}`);
const transactionRef = (workspaceId: string, transactionId: string) =>
  db().doc(`${workspacePath(workspaceId)}/transactions/${transactionId}`);

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
};

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

const reserveIdempotency = async (
  transaction: admin.firestore.Transaction,
  auth: WorkspaceAuthorizationContext,
  operation: GoalOperation,
  idempotencyKey: string,
  payload: unknown,
): Promise<IdempotencyReservation> => {
  const id = `${operation}_${sha256(`${auth.uid}:${idempotencyKey}`).slice(0, 32)}`;
  const ref = db().doc(`${workspacePath(auth.workspaceId)}/goal_idempotency_keys/${id}`);
  const requestHash = sha256(stableStringify(payload));
  const snapshot = await transaction.get(ref);

  if (snapshot.exists) {
    const data = snapshot.data();
    if (data?.requestHash !== requestHash || data?.actorId !== auth.uid) {
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
  operation: GoalOperation,
  idempotencyRef: admin.firestore.DocumentReference,
  targetId: string,
  details: Record<string, unknown>,
) => {
  const ref = db().doc(
    `${workspacePath(auth.workspaceId)}/goal_audit_logs/${idempotencyRef.id}`,
  );
  transaction.set(ref, {
    workspaceId: auth.workspaceId,
    actorId: auth.uid,
    actorRole: auth.role,
    operation,
    targetId,
    correlationId: idempotencyRef.id,
    details,
    timestamp: FieldValue.serverTimestamp(),
  });
};

export const toMinorUnits = (value: number): number => {
  const cents = Math.round(value * 100);
  if (!Number.isSafeInteger(cents) || Math.abs(value - cents / 100) > 1e-9) {
    throw new CreditCardApplicationError(
      "invalid_payload",
      "Valores monetários devem ter no máximo duas casas decimais.",
    );
  }
  return cents;
};

const fromMinorUnits = (value: number): number => value / 100;

export const isSettledGoalContribution = (
  data: admin.firestore.DocumentData,
): boolean => data.type === "investimento" &&
  data.isPaid === true &&
  Boolean(data.goalId) &&
  (!data.investmentMetadata ||
    data.investmentMetadata.investmentOperation === "contribution") &&
  (!data.investmentMetadata || data.investmentMetadata.status === "settled");

export const contributionMinorUnits = (
  data: admin.firestore.DocumentData,
): number => {
  if (data.type !== "investimento" || !data.goalId) return 0;
  const metadata = data.investmentMetadata;
  if (!metadata) {
    if (!isSettledGoalContribution(data)) return 0;
    if (Number.isSafeInteger(data.valueCents)) return data.valueCents as number;
    return toMinorUnits(Number(data.value));
  }
  if (metadata.status !== "settled" && metadata.status !== "reversed") return 0;
  if (!Number.isSafeInteger(metadata.principalCents)) {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      "Movimento de investimento sem principal válido.",
    );
  }
  if (metadata.investmentOperation === "contribution") return metadata.principalCents as number;
  if (metadata.investmentOperation === "redemption") return -(metadata.principalCents as number);
  if (metadata.investmentOperation === "redemption_reversal") return metadata.principalCents as number;
  return 0;
};

const resolveGoalProgressCents = (
  goal: admin.firestore.DocumentData,
  netContributionCents: number,
): number => {
  if ((goal.progressBasis ?? "net_contributions") === "current_value") {
    if (Number.isSafeInteger(goal.currentValueCents)) return goal.currentValueCents as number;
    if (typeof goal.currentValue === "number") return toMinorUnits(goal.currentValue);
  }
  return netContributionCents;
};

const sumGoalContributions = (
  snapshot: admin.firestore.QuerySnapshot,
): number => snapshot.docs.reduce(
  (total, contribution) => total + contributionMinorUnits(contribution.data()),
  0,
);

const goalContributionsQuery = (workspaceId: string, goalId: string) =>
  db().collection(`${workspacePath(workspaceId)}/transactions`).where("goalId", "==", goalId);

const buildGoalPersistence = (
  input: CreateGoalPayload["goal"],
  auth: WorkspaceAuthorizationContext,
) => {
  const targetAmountCents = toMinorUnits(input.targetAmount);
  const currentValueCents = input.currentValue === undefined ? undefined : toMinorUnits(input.currentValue);
  return {
    ...input,
    startDateTimestamp: Timestamp.fromDate(new Date(`${input.startDate}T12:00:00.000Z`)),
    deadlineTimestamp: Timestamp.fromDate(new Date(`${input.deadline}T12:00:00.000Z`)),
    progressBasis: input.progressBasis ?? "net_contributions",
    targetAmountCents,
    ...(currentValueCents !== undefined ? {currentValueCents} : {}),
    currentAmountCents: input.progressBasis === "current_value" ? currentValueCents ?? 0 : 0,
    currentAmount: input.progressBasis === "current_value" ? input.currentValue ?? 0 : 0,
    workspaceId: auth.workspaceId,
    profileId: input.profileId ?? auth.workspaceId,
  };
};

export const executeCreateGoal = async (
  auth: WorkspaceAuthorizationContext,
  payload: CreateGoalPayload,
): Promise<Record<string, unknown>> => db().runTransaction(async (transaction) => {
  const reservation = await reserveIdempotency(
    transaction, auth, "createGoal", payload.idempotencyKey, payload,
  );
  if (reservation.replay) return reservation.replay;

  const ref = db().collection(`${workspacePath(auth.workspaceId)}/goals`).doc();
  const persisted = buildGoalPersistence(payload.goal, auth);
  const result = {success: true, goalId: ref.id};

  transaction.create(ref, {
    ...persisted,
    createdBy: auth.uid,
    updatedBy: auth.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  writeAudit(transaction, auth, "createGoal", reservation.ref, ref.id, {
    after: persisted,
  });
  completeIdempotency(transaction, reservation, result);
  return result;
});

export const executeUpdateGoal = async (
  auth: WorkspaceAuthorizationContext,
  payload: UpdateGoalPayload,
): Promise<Record<string, unknown>> => db().runTransaction(async (transaction) => {
  const reservation = await reserveIdempotency(
    transaction, auth, "updateGoal", payload.idempotencyKey, payload,
  );
  if (reservation.replay) return reservation.replay;
  const ref = goalRef(auth.workspaceId, payload.goalId);
  const snapshot = await transaction.get(ref);
  if (!snapshot.exists || snapshot.data()?.archived === true) {
    throw new CreditCardApplicationError("not_found", "Meta não encontrada.");
  }
  const current = snapshot.data() ?? {};
  const editable = buildGoalPersistence(payload.goal, auth);
  const nextProgressCents = resolveGoalProgressCents(
    editable,
    Number(current.netContributionCents ?? 0),
  );
  const result = {success: true, goalId: payload.goalId};
  transaction.update(ref, {
    ...editable,
    currentAmountCents: nextProgressCents,
    currentAmount: fromMinorUnits(nextProgressCents),
    netContributionCents: Number(current.netContributionCents ?? 0),
    updatedBy: auth.uid,
    updatedAt: FieldValue.serverTimestamp(),
  });
  writeAudit(transaction, auth, "updateGoal", reservation.ref, payload.goalId, {
    before: current,
    after: editable,
  });
  completeIdempotency(transaction, reservation, result);
  return result;
});

export const executeSetGoalTransactionLinks = async (
  auth: WorkspaceAuthorizationContext,
  payload: SetGoalLinksPayload,
): Promise<Record<string, unknown>> => db().runTransaction(async (transaction) => {
  const reservation = await reserveIdempotency(
    transaction, auth, "setGoalTransactionLinks", payload.idempotencyKey, payload,
  );
  if (reservation.replay) return reservation.replay;
  const goalDocument = goalRef(auth.workspaceId, payload.goalId);
  const [goalSnapshot, linkedSnapshot] = await Promise.all([
    transaction.get(goalDocument),
    transaction.get(goalContributionsQuery(auth.workspaceId, payload.goalId)),
  ]);
  if (!goalSnapshot.exists || goalSnapshot.data()?.archived === true) {
    throw new CreditCardApplicationError("not_found", "Meta não encontrada.");
  }

  const selectedIds = [...new Set(payload.transactionIds)];
  const linkedContributions = linkedSnapshot.docs.filter((item) => {
    const operation = item.data().investmentMetadata?.investmentOperation;
    return !operation || operation === "contribution";
  });
  const linkedInvestmentAdjustments = linkedSnapshot.docs.filter((item) => {
    const operation = item.data().investmentMetadata?.investmentOperation;
    return operation === "redemption" || operation === "redemption_reversal";
  });
  const linkedById = new Map<string, admin.firestore.DocumentSnapshot>(
    linkedContributions.map((item) => [item.id, item]),
  );
  const missingRefs = selectedIds
    .filter((id) => !linkedById.has(id))
    .map((id) => transactionRef(auth.workspaceId, id));
  const missingSnapshots = missingRefs.length > 0 ? await transaction.getAll(...missingRefs) : [];
  const selectedById = new Map<string, admin.firestore.DocumentSnapshot>(linkedById);
  missingSnapshots.forEach((item) => selectedById.set(item.id, item));

  for (const id of selectedIds) {
    const snapshot = selectedById.get(id);
    const data = snapshot?.data();
    if (!snapshot?.exists || !data || data.type !== "investimento" ||
      (data.investmentMetadata &&
        data.investmentMetadata.investmentOperation !== "contribution")) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "Um dos aportes selecionados não está disponível.",
      );
    }
    if (data.goalId && data.goalId !== payload.goalId) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "Um dos aportes já está vinculado a outra meta.",
      );
    }
  }

  linkedContributions.forEach((snapshot) => {
    if (!selectedIds.includes(snapshot.id)) {
      if (Number(snapshot.data().redeemedPrincipalCents ?? 0) > 0) {
        throw new CreditCardApplicationError(
          "domain_precondition_failed",
          "Um aporte com principal resgatado não pode ser desvinculado da meta.",
        );
      }
      transaction.update(snapshot.ref, {
        goalId: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: auth.uid,
      });
    }
  });
  selectedIds.forEach((id) => {
    const snapshot = selectedById.get(id)!;
    if (snapshot.data()?.goalId !== payload.goalId) {
      transaction.update(snapshot.ref, {
        goalId: payload.goalId,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: auth.uid,
      });
    }
  });

  const selectedContributionCents = selectedIds.reduce((total, id) => {
    const data = selectedById.get(id)!.data()!;
    return total + contributionMinorUnits({...data, goalId: payload.goalId});
  }, 0);
  const adjustmentCents = linkedInvestmentAdjustments.reduce(
    (total, item) => total + contributionMinorUnits(item.data()),
    0,
  );
  const netContributionCents = selectedContributionCents + adjustmentCents;
  if (netContributionCents < 0) {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      "Os vínculos deixariam o progresso da meta inconsistente.",
    );
  }
  const progressCents = resolveGoalProgressCents(goalSnapshot.data()!, netContributionCents);
  transaction.update(goalDocument, {
    netContributionCents,
    currentAmountCents: progressCents,
    currentAmount: fromMinorUnits(progressCents),
    updatedBy: auth.uid,
    updatedAt: FieldValue.serverTimestamp(),
  });
  const result = {
    success: true,
    goalId: payload.goalId,
    linkedCount: selectedIds.length,
    currentAmount: fromMinorUnits(progressCents),
  };
  writeAudit(transaction, auth, "setGoalTransactionLinks", reservation.ref, payload.goalId, {
    beforeTransactionIds: linkedContributions.map((item) => item.id),
    afterTransactionIds: selectedIds,
    netContributionCents,
  });
  completeIdempotency(transaction, reservation, result);
  return result;
});

export const executeArchiveGoal = async (
  auth: WorkspaceAuthorizationContext,
  payload: ArchiveGoalPayload,
): Promise<Record<string, unknown>> => db().runTransaction(async (transaction) => {
  const reservation = await reserveIdempotency(
    transaction, auth, "archiveGoal", payload.idempotencyKey, payload,
  );
  if (reservation.replay) return reservation.replay;
  const ref = goalRef(auth.workspaceId, payload.goalId);
  const [goalSnapshot, historySnapshot] = await Promise.all([
    transaction.get(ref),
    transaction.get(goalContributionsQuery(auth.workspaceId, payload.goalId)),
  ]);
  if (!goalSnapshot.exists) {
    throw new CreditCardApplicationError("not_found", "Meta não encontrada.");
  }
  transaction.update(ref, {
    archived: true,
    archivedAt: FieldValue.serverTimestamp(),
    archivedBy: auth.uid,
    archiveReason: payload.reason,
    status: "cancelada",
    updatedAt: FieldValue.serverTimestamp(),
  });
  const result = {success: true, goalId: payload.goalId, historyCount: historySnapshot.size};
  writeAudit(transaction, auth, "archiveGoal", reservation.ref, payload.goalId, {
    reason: payload.reason,
    historyCount: historySnapshot.size,
  });
  completeIdempotency(transaction, reservation, result);
  return result;
});

export const executeRebuildGoalProgress = async (
  auth: WorkspaceAuthorizationContext,
  payload: RebuildGoalProgressPayload,
): Promise<Record<string, unknown>> => db().runTransaction(async (transaction) => {
  const reservation = await reserveIdempotency(
    transaction, auth, "rebuildGoalProgress", payload.idempotencyKey, payload,
  );
  if (reservation.replay) return reservation.replay;
  const ref = goalRef(auth.workspaceId, payload.goalId);
  const [goalSnapshot, contributions] = await Promise.all([
    transaction.get(ref),
    transaction.get(goalContributionsQuery(auth.workspaceId, payload.goalId)),
  ]);
  if (!goalSnapshot.exists) {
    throw new CreditCardApplicationError("not_found", "Meta não encontrada.");
  }
  const netContributionCents = sumGoalContributions(contributions);
  const progressCents = resolveGoalProgressCents(goalSnapshot.data()!, netContributionCents);
  transaction.update(ref, {
    progressBasis: goalSnapshot.data()?.progressBasis ?? "net_contributions",
    netContributionCents,
    currentAmountCents: progressCents,
    currentAmount: fromMinorUnits(progressCents),
    lastProgressRebuildAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  const result = {success: true, goalId: payload.goalId, currentAmount: fromMinorUnits(progressCents)};
  writeAudit(transaction, auth, "rebuildGoalProgress", reservation.ref, payload.goalId, {
    reason: payload.reason,
    contributionCount: contributions.size,
    netContributionCents,
  });
  completeIdempotency(transaction, reservation, result);
  return result;
});

export const executeSaveGoalContribution = async (
  auth: WorkspaceAuthorizationContext,
  payload: SaveGoalContributionPayload,
): Promise<Record<string, unknown>> => db().runTransaction(async (transaction) => {
  const reservation = await reserveIdempotency(
    transaction, auth, "saveGoalContribution", payload.idempotencyKey, payload,
  );
  if (reservation.replay) return reservation.replay;
  const contributionId = payload.transactionId ?? db()
    .collection(`${workspacePath(auth.workspaceId)}/transactions`).doc().id;
  const contributionDocument = transactionRef(auth.workspaceId, contributionId);
  const goalDocument = goalRef(auth.workspaceId, payload.contribution.goalId);
  const contributionSnapshot = await transaction.get(contributionDocument);
  const [goalSnapshot, linkedSnapshot] = await Promise.all([
    transaction.get(goalDocument),
    transaction.get(goalContributionsQuery(auth.workspaceId, payload.contribution.goalId)),
  ]);
  if (!goalSnapshot.exists || goalSnapshot.data()?.archived === true) {
    throw new CreditCardApplicationError("not_found", "Meta não encontrada.");
  }
  const previous = contributionSnapshot.data();
  if (previous && (previous.type !== "investimento" ||
    (previous.investmentMetadata &&
      previous.investmentMetadata.investmentOperation !== "contribution") ||
    (previous.goalId && previous.goalId !== payload.contribution.goalId))) {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      "O aporte não pode ser movido entre metas durante a edição.",
    );
  }
  const valueCents = toMinorUnits(payload.contribution.value);
  const previousRedeemedPrincipalCents = previous?.redeemedPrincipalCents;
  const redeemedPrincipalCents = Number.isSafeInteger(previousRedeemedPrincipalCents) ?
    previousRedeemedPrincipalCents as number : 0;
  if (valueCents < redeemedPrincipalCents) {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      "O aporte não pode ficar abaixo do principal já resgatado.",
    );
  }
  if (redeemedPrincipalCents > 0 && !payload.contribution.isPaid) {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      "Um aporte com principal resgatado deve permanecer liquidado.",
    );
  }
  const settlementTimestamp = Timestamp.fromDate(
    new Date(`${payload.contribution.date}T12:00:00.000Z`),
  );
  const persisted = {
    ...payload.contribution,
    type: "investimento",
    valueCents,
    workspaceId: auth.workspaceId,
    profileId: auth.workspaceId,
    userId: previous?.userId ?? auth.uid,
    transactionDate: settlementTimestamp,
    redeemedPrincipalCents,
    remainingPrincipalCents: valueCents - redeemedPrincipalCents,
    investmentMetadata: {
      currency: "BRL",
      investmentOperation: "contribution",
      cashImpact: payload.contribution.isPaid ? "outflow" : "none",
      investmentImpact: payload.contribution.isPaid ? "increase" : "none",
      principalCents: valueCents,
      gainCents: 0,
      feesCents: 0,
      taxCents: 0,
      ...(payload.contribution.isPaid ? {settlementDate: settlementTimestamp} : {}),
      status: payload.contribution.isPaid ? "settled" : "pending",
      sourceMovementId: contributionId,
      idempotencyKey: payload.idempotencyKey,
    },
    updatedBy: auth.uid,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (contributionSnapshot.exists) {
    transaction.update(contributionDocument, persisted);
  } else {
    transaction.create(contributionDocument, {
      ...persisted,
      createdBy: auth.uid,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  let netContributionCents = sumGoalContributions(linkedSnapshot);
  if (previous && isSettledGoalContribution(previous)) {
    netContributionCents -= contributionMinorUnits(previous);
  }
  if (payload.contribution.isPaid) netContributionCents += valueCents;
  const progressCents = resolveGoalProgressCents(goalSnapshot.data()!, netContributionCents);
  transaction.update(goalDocument, {
    netContributionCents,
    currentAmountCents: progressCents,
    currentAmount: fromMinorUnits(progressCents),
    updatedAt: FieldValue.serverTimestamp(),
  });
  const result = {
    success: true,
    goalId: payload.contribution.goalId,
    transactionId: contributionId,
    currentAmount: fromMinorUnits(progressCents),
  };
  writeAudit(transaction, auth, "saveGoalContribution", reservation.ref, contributionId, {
    goalId: payload.contribution.goalId,
    before: previous ?? null,
    after: persisted,
  });
  completeIdempotency(transaction, reservation, result);
  return result;
});

interface LegacyCatalogSeed {
  group: string;
  name: string;
  transactionSubtype?: string;
  workspaceScope: "both" | "PJ";
}

const LEGACY_CATALOG_SEEDS: LegacyCatalogSeed[] = [
  ...["Alimentação", "Moradia", "Transporte", "Saúde", "Lazer", "Educação", "Utilidades"]
    .map((name) => ({group: "category", name, transactionSubtype: "despesa", workspaceScope: "both" as const})),
  ...["Salário", "Honorários", "Venda de Produto", "Reembolso", "Dividendos"]
    .map((name) => ({group: "category", name, transactionSubtype: "receita", workspaceScope: "both" as const})),
  ...["Ações", "Fundos Imobiliários", "Tesouro Direto", "CDB", "Poupança"]
    .map((name) => ({group: "category", name, transactionSubtype: "investimento", workspaceScope: "both" as const})),
  ...["Dinheiro", "Cartão de Crédito", "Cartão de Débito", "Pix", "Boleto"]
    .map((name) => ({group: "payment_method", name, workspaceScope: "both" as const})),
  ...["Carteira Principal", "Reserva de Emergência", "Investimentos Nubank", "Binance"]
    .map((name) => ({group: "wallet", name, workspaceScope: "both" as const})),
  ...["Operacional", "Comercial", "Administrativo"]
    .map((name) => ({group: "cost_center", name, workspaceScope: "PJ" as const})),
];

const normalizeName = (name: string) => name.normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ").toLowerCase();

export const executeSeedLegacySettingsCatalog = async (
  auth: WorkspaceAuthorizationContext,
  payload: SeedLegacyCatalogPayload,
): Promise<Record<string, unknown>> => db().runTransaction(async (transaction) => {
  const reservation = await reserveIdempotency(
    transaction, auth, "seedLegacySettingsCatalog", payload.idempotencyKey, payload,
  );
  if (reservation.replay) return reservation.replay;
  const workspaceSnapshot = await transaction.get(db().doc(workspacePath(auth.workspaceId)));
  if (!workspaceSnapshot.exists) {
    throw new CreditCardApplicationError("workspace_not_found", "Workspace não encontrado.");
  }
  const workspaceType = workspaceSnapshot.data()?.type === "PJ" ? "PJ" : "PF";
  const seeds = LEGACY_CATALOG_SEEDS.filter(
    (item) => item.workspaceScope === "both" || workspaceType === "PJ",
  );
  const prepared = seeds.map((item, index) => {
    const normalizedName = normalizeName(item.name);
    const dedupeKey = [
      item.group,
      item.transactionSubtype ?? "all",
      item.workspaceScope,
      normalizedName,
    ].join("::");
    return {
      item,
      index,
      normalizedName,
      dedupeKey,
      uniqueRef: db().doc(`${workspacePath(auth.workspaceId)}/settings_catalog_uniques/${dedupeKey}`),
    };
  });
  const uniqueSnapshots = await transaction.getAll(...prepared.map((item) => item.uniqueRef));
  let createdCount = 0;
  prepared.forEach((entry, index) => {
    if (uniqueSnapshots[index].exists) return;
    const itemId = `legacy_${sha256(entry.dedupeKey).slice(0, 24)}`;
    const itemRef = db().doc(`${workspacePath(auth.workspaceId)}/settings_catalog/${itemId}`);
    const auditFields = {
      createdBy: auth.uid,
      updatedBy: auth.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    const itemData = {
      workspaceId: auth.workspaceId,
      group: entry.item.group,
      name: entry.item.name,
      normalizedName: entry.normalizedName,
      dedupeKey: entry.dedupeKey,
      workspaceScope: entry.item.workspaceScope,
      ...(entry.item.transactionSubtype ? {transactionSubtype: entry.item.transactionSubtype} : {}),
      ...auditFields,
    };
    transaction.create(itemRef, {
      ...itemData,
      sortOrder: (entry.index + 1) * 10,
      status: "active",
    });
    transaction.create(entry.uniqueRef, {
      dedupeKey: entry.dedupeKey,
      catalogItemId: itemId,
      workspaceId: auth.workspaceId,
      group: entry.item.group,
      normalizedName: entry.normalizedName,
      ...auditFields,
    });
    createdCount += 1;
  });
  const result = {
    success: true,
    workspaceId: auth.workspaceId,
    workspaceType,
    createdCount,
    existingCount: seeds.length - createdCount,
  };
  writeAudit(transaction, auth, "seedLegacySettingsCatalog", reservation.ref, auth.workspaceId, result);
  completeIdempotency(transaction, reservation, result);
  return result;
});
