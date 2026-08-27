import {createHash} from "node:crypto";
import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";

import {CreditCardApplicationError} from "../creditCards/errors";
import type {WorkspaceAuthorizationContext} from "../creditCards/auth";
import type {
  ArchiveGoalPayload,
  CreateGoalPayload,
  SeedLegacyCatalogPayload,
  UpdateGoalPayload,
} from "./contracts";

type GoalOperation =
  | "createGoal"
  | "updateGoal"
  | "archiveGoal"
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
const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
};

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/**
 * Conteúdo da **intenção**, para o `requestHash`.
 *
 * `correlationId` identifica a *tentativa*, não a intenção: a superfície
 * operacional gera um novo a cada envio, justamente para que um replay
 * apareça na trilha como replay. Se ele entrasse no hash, o segundo envio da
 * mesma intenção — duplo clique, retry de rede, timeout+retry — cairia em
 * `idempotency_conflict` em vez de devolver o resultado anterior, que é
 * exatamente o que a idempotência existe para evitar (INV-P1-004). O domínio
 * de investimentos já aplica a mesma exclusão.
 *
 * Payloads que não trazem o campo produzem o mesmo texto de antes, então
 * nenhum `requestHash` já persistido muda de valor.
 */
const intentContent = (payload: unknown): unknown => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }
  const {correlationId: _attempt, ...intent} =
    payload as Record<string, unknown>;
  return intent;
};

const reserveIdempotency = async (
  transaction: admin.firestore.Transaction,
  auth: WorkspaceAuthorizationContext,
  operation: GoalOperation,
  idempotencyKey: string,
  payload: unknown,
): Promise<IdempotencyReservation> => {
  const id = `${operation}_${sha256(`${auth.uid}:${idempotencyKey}`).slice(0, 32)}`;
  const ref = db().doc(`${workspacePath(auth.workspaceId)}/goal_idempotency_keys/${id}`);
  const requestHash = sha256(stableStringify(intentContent(payload)));
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
  // O progresso de meta com base em aportes é publicado pelo domínio
  // patrimonial em `investmentProgressCents`. Aqui só se resolve a base
  // `current_value`, informada pelo próprio usuário na edição da meta.
  const nextProgressCents = resolveGoalProgressCents(
    editable,
    Number(current.currentAmountCents ?? 0),
  );
  const result = {success: true, goalId: payload.goalId};
  transaction.update(ref, {
    ...editable,
    currentAmountCents: nextProgressCents,
    currentAmount: fromMinorUnits(nextProgressCents),
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

export const executeArchiveGoal = async (
  auth: WorkspaceAuthorizationContext,
  payload: ArchiveGoalPayload,
): Promise<Record<string, unknown>> => db().runTransaction(async (transaction) => {
  const reservation = await reserveIdempotency(
    transaction, auth, "archiveGoal", payload.idempotencyKey, payload,
  );
  if (reservation.replay) return reservation.replay;
  const ref = goalRef(auth.workspaceId, payload.goalId);
  const goalSnapshot = await transaction.get(ref);
  if (!goalSnapshot.exists) {
    throw new CreditCardApplicationError("not_found", "Meta não encontrada.");
  }
  // Arquivar não varre mais `transactions`. O progresso patrimonial da meta é
  // publicado por `updateGoalProjection` a partir das posições, então o estado
  // no momento do arquivamento já está no próprio documento: registrá-lo é
  // mais informativo que contar linhas de caixa e não custa leitura nenhuma.
  const archivedProgressCents = Number.isSafeInteger(
    goalSnapshot.data()?.investmentProgressCents,
  ) ? goalSnapshot.data()?.investmentProgressCents as number : 0;
  transaction.update(ref, {
    archived: true,
    archivedAt: FieldValue.serverTimestamp(),
    archivedBy: auth.uid,
    archiveReason: payload.reason,
    status: "cancelada",
    updatedAt: FieldValue.serverTimestamp(),
  });
  const result = {success: true, goalId: payload.goalId, archivedProgressCents};
  writeAudit(transaction, auth, "archiveGoal", reservation.ref, payload.goalId, {
    reason: payload.reason,
    archivedProgressCents,
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
