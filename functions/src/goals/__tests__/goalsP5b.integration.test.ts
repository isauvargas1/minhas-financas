import assert from "node:assert/strict";
import test from "node:test";
import * as admin from "firebase-admin";
import {Timestamp} from "firebase-admin/firestore";
import {HttpsError} from "firebase-functions/v2/https";

import {executeCreateCashTransaction} from "../../cash/createTransaction";
import {
  create as createLoanCall,
  createPayload as loanCreatePayload,
  deliverMirror,
  pay as payLoanCall,
  payPayload as loanPayPayload,
  today,
} from "../../loans/testSupport/loanTestSupport";
import {
  newReceivable,
  receivablePayload,
  receive,
  receivePayload,
  seedClient,
  seedReceivableTenant,
} from "../../receivables/testSupport/receivableTestSupport";
import {ApplicationError} from "../../shared/errors";
import {
  callableRequest,
  defaultAccountOf,
  requireFirestoreEmulator,
  seedActiveAccount,
  seedMember,
  seedWorkspace,
} from "../../shared/testSupport/kernelTestSupport";
import type {WorkspaceActor} from "../../shared/workspaceAuth";
import {
  defaultCategoryIdFor,
  seedDefaultCategories,
} from "../../settingsCatalog/testSupport/categorySeeds";
import {call} from "../../workspaces/testSupport/p1TestSupport";
import {
  catalogSeedDocumentId,
  normalizeCatalogName,
} from "../../settingsCatalog/model";
import {
  executeChangeInvestmentGoal,
  executeCreateSimpleInvestment,
  executeLinkInvestmentToGoal,
  executeSettleInvestmentContribution,
  executeUnlinkInvestmentFromGoal,
  executeWithdrawSimpleInvestment,
  GOAL_ARCHIVED_FOR_INVESTMENT_MESSAGE,
  GOAL_NOT_INVESTMENT_MESSAGE,
} from "../../investments/operationsV2";
import {
  archiveGoal,
  createGoal,
  getGoalKpiProgress,
  getGoalsOverview,
  setGoalStatus,
  updateGoal,
  updateGoalManualProgress,
} from "../callables";
import {
  archiveGoalPayloadSchema,
  createGoalPayloadSchema,
  setGoalStatusPayloadSchema,
  updateGoalManualProgressPayloadSchema,
  updateGoalPayloadSchema,
} from "../contracts";
import {executeGetGoalKpiProgress, executeGetGoalsOverview} from "../kpi";
import {
  executeArchiveGoal,
  executeCreateGoal,
  executeSetGoalStatus,
  executeUpdateGoal,
  executeUpdateGoalManualProgress,
  GOAL_ARCHIVED_MESSAGE,
  GOAL_LINKED_ARCHIVE_MESSAGE,
  GOAL_LINKED_SOURCE_MESSAGE,
  GOAL_NOT_MANUAL_MESSAGE,
  GOAL_STALE_MESSAGE,
} from "../operations";

/**
 * P5-B (D-31) — domínio de Metas no Emulator.
 *
 * Cada teste prova uma regra do contrato pelo caminho real (callables e
 * operações com Admin SDK em transação), sem simular o que o backend faz:
 * metas manuais com valor validado e auditado; metas de investimentos com
 * progresso só da projeção patrimonial, nas duas bases; troca de fonte sem
 * reaproveitar progresso; status e arquivamento persistidos; vínculo
 * patrimonial recusado para meta arquivada ou não patrimonial, inclusive sob
 * concorrência; indicadores PJ sobre fontes oficiais; paginação acima de 100.
 */

const firestore = requireFirestoreEmulator();
const db = (): admin.firestore.Firestore => firestore;

const WS = "goals-p5b-pf";
const WS_OTHER = "goals-p5b-other";
const WS_PJ = "goals-p5b-pj";
const OWNER = "goals-p5b-owner";
const ADMIN = "goals-p5b-admin";
const MEMBER = "goals-p5b-member";
const VIEWER = "goals-p5b-viewer";
const OUTSIDER = "goals-p5b-outsider";
const OWNER_OTHER = "goals-p5b-owner-other";
const OWNER_PJ = "goals-p5b-owner-pj";

const INSTITUTION = "goals-p5b-institution";
const PORTFOLIO = "goals-p5b-portfolio";
const CATEGORY = catalogSeedDocumentId(
  "category", "investimento", "both", "Tesouro Direto",
);

const actor = (
  uid = OWNER,
  role: WorkspaceActor["role"] = "owner",
  workspaceId = WS,
): WorkspaceActor => ({workspaceId, uid, role});

let keySequence = 0;
const key = (label: string) =>
  `p5b-${label}-${String(++keySequence).padStart(10, "0")}`;

const visual = {color: "#6366f1", icon: "Target", progressBarType: "linear"};

const manualGoal = (overrides: Record<string, unknown> = {}) => ({
  name: "Reserva manual",
  category: "reserva_emergencia",
  priority: "alta",
  startDate: "2026-01-01",
  deadline: "2026-12-31",
  horizon: "curto",
  progressSource: "manual",
  targetAmountCents: 1_000_000,
  visual,
  ...overrides,
});

const investmentGoal = (overrides: Record<string, unknown> = {}) => manualGoal({
  name: "Reserva investida",
  progressSource: "investment",
  progressBasis: "net_contributions",
  ...overrides,
});

const kpiGoal = (
  businessType: string,
  overrides: Record<string, unknown> = {},
) =>
  manualGoal({
    name: `Indicador ${businessType}`,
    progressSource: "business_kpi",
    businessType,
    ...(businessType === "caixa_minimo" ? {} : {period: "mensal"}),
    ...(businessType === "margem" ?
      {targetAmountCents: undefined, targetBasisPoints: 2_500} : {}),
    ...overrides,
  });

/** Pelo schema, como a callable faz antes de executar. */
const create = (
  who: WorkspaceActor,
  goal: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) => executeCreateGoal(who, createGoalPayloadSchema.parse({
  workspaceId: who.workspaceId, idempotencyKey: key("create"), goal, ...extra,
}));

const createManual = async (manualProgressCents = 0, overrides = {}) =>
  String((await create(actor(), manualGoal(overrides), {manualProgressCents}))
    .goalId);

const createInvestment = async (overrides = {}, who = actor()) =>
  String((await create(who, investmentGoal(overrides))).goalId);

const update = (
  who: WorkspaceActor,
  goalId: string,
  expectedRevision: number,
  goal: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) => executeUpdateGoal(who, updateGoalPayloadSchema.parse({
  workspaceId: who.workspaceId, idempotencyKey: key("update"), goalId,
  expectedRevision, goal, ...extra,
}));

const updateManual = (
  goalId: string,
  expectedRevision: number,
  manualProgressCents: number,
  who = actor(),
  idempotencyKey = key("manual"),
) => executeUpdateGoalManualProgress(
  who,
  updateGoalManualProgressPayloadSchema.parse({
    workspaceId: who.workspaceId, idempotencyKey, goalId, expectedRevision,
    manualProgressCents,
  }),
);

const setStatus = (
  goalId: string,
  status: string,
  who = actor(),
  idempotencyKey = key("status"),
) => executeSetGoalStatus(who, setGoalStatusPayloadSchema.parse({
  workspaceId: who.workspaceId, idempotencyKey, goalId, status,
}));

const archive = (goalId: string, who = actor(), idempotencyKey = key("arch")) =>
  executeArchiveGoal(who, archiveGoalPayloadSchema.parse({
    workspaceId: who.workspaceId, idempotencyKey, goalId,
    reason: "Meta encerrada no teste",
  }));

const goalDoc = async (goalId: string, workspaceId = WS) =>
  (await db().doc(`workspaces/${workspaceId}/goals/${goalId}`).get()).data();

const countOf = async (workspaceId: string, collection: string) =>
  (await db().collection(`workspaces/${workspaceId}/${collection}`).count()
    .get()).data().count;

const auditOf = async (
  goalId: string, operation?: string, workspaceId = WS,
) => {
  let query: admin.firestore.Query = db()
    .collection(`workspaces/${workspaceId}/goal_audit_logs`)
    .where("targetId", "==", goalId);
  if (operation) query = query.where("operation", "==", operation);
  return (await query.get()).docs.map((doc) => doc.data());
};

const isCode = (code: string, message?: string) => (error: unknown) =>
  error instanceof ApplicationError && error.code === code &&
  (message === undefined || error.message === message);

const isHttps = (code: string) => (error: unknown) =>
  error instanceof HttpsError && error.code === code;

const at = (iso: string) => Timestamp.fromDate(new Date(iso));

const catalogItem = async (
  workspaceId: string,
  id: string,
  group: string,
  name: string,
  transactionSubtype?: string,
) => {
  const normalizedName = normalizeCatalogName(name);
  await db().doc(`workspaces/${workspaceId}/settings_catalog/${id}`).set({
    workspaceId, group, name, normalizedName,
    dedupeKey: [group, transactionSubtype ?? "all", "both", normalizedName]
      .join("::"),
    workspaceScope: "both", sortOrder: 10, status: "active",
    ...(transactionSubtype ? {transactionSubtype} : {}),
    createdBy: "seed", updatedBy: "seed",
    createdAt: at("2026-08-01T00:00:00.000Z"),
    updatedAt: at("2026-08-01T00:00:00.000Z"),
  });
};

const seedInvestmentCatalog = (workspaceId: string) => Promise.all([
  catalogItem(workspaceId, INSTITUTION, "investment_institution", "BTG"),
  catalogItem(workspaceId, PORTFOLIO, "investment_class", "Aposentadoria"),
  catalogItem(workspaceId, CATEGORY, "category", "Tesouro Direto",
    "investimento"),
]);

const reset = async () => {
  await Promise.all([WS, WS_OTHER, WS_PJ].map((workspaceId) =>
    db().recursiveDelete(db().doc(`workspaces/${workspaceId}`))));
  await Promise.all([OWNER, ADMIN, MEMBER, VIEWER, OUTSIDER, OWNER_OTHER,
    OWNER_PJ].map((uid) => seedActiveAccount(uid)));
  await seedWorkspace({workspaceId: WS, ownerId: OWNER, type: "PF"});
  await seedWorkspace({workspaceId: WS_OTHER, ownerId: OWNER_OTHER,
    type: "PF"});
  await seedWorkspace({workspaceId: WS_PJ, ownerId: OWNER_PJ, type: "PJ"});
  await seedMember(WS, ADMIN, "admin");
  await seedMember(WS, MEMBER, "member");
  await seedMember(WS, VIEWER, "viewer");
  await seedInvestmentCatalog(WS);
};

/** Aporte simples, liquidado por padrão, opcionalmente já com meta. */
const contribute = (
  options: {goalId?: string; valueCents?: number; settled?: boolean;
    workspaceId?: string; uid?: string; idempotencyKey?: string;
    occurredAt?: string} = {},
) => {
  const workspaceId = options.workspaceId ?? WS;
  const settled = options.settled ?? true;
  return executeCreateSimpleInvestment(
    actor(options.uid ?? OWNER, "owner", workspaceId), {
      workspaceId,
      idempotencyKey: options.idempotencyKey ?? key("aporte"),
      correlationId: key("corr"),
      institutionId: INSTITUTION,
      classId: PORTFOLIO,
      typeId: CATEGORY,
      description: `Tesouro ${keySequence}`,
      valueCents: options.valueCents ?? 100_000,
      settled,
      occurredAt: options.occurredAt ?? "2026-08-10T12:00:00.000Z",
      ...(options.goalId ? {goalId: options.goalId} : {}),
      ...(settled ? {cashAccountId: defaultAccountOf(workspaceId)} : {}),
    });
};


const positionOf = async (positionId: string, workspaceId = WS) =>
  (await db()
    .doc(`workspaces/${workspaceId}/investment_positions/${positionId}`)
    .get()).data() ?? {};

const linkPayload = async (positionId: string, goalId: string) => {
  const position = await positionOf(positionId);
  return {
    workspaceId: WS, idempotencyKey: key("link"), correlationId: key("corr"),
    accountId: String(position.accountId), assetId: String(position.assetId),
    goalId, occurredAt: "2026-08-12T12:00:00.000Z", reason: "Compor a meta",
  };
};

const link = async (positionId: string, goalId: string) =>
  executeLinkInvestmentToGoal(actor(), await linkPayload(positionId, goalId));

const unlink = async (positionId: string, goalId: string) =>
  executeUnlinkInvestmentFromGoal(actor(), {
    ...(await linkPayload(positionId, goalId)), reason: "Sai da meta",
  });

const transfer = async (
  positionId: string,
  previousGoalId: string,
  goalId: string,
) => {
  const position = await positionOf(positionId);
  return executeChangeInvestmentGoal(actor(), {
    workspaceId: WS, idempotencyKey: key("move"), correlationId: key("corr"),
    accountId: String(position.accountId), assetId: String(position.assetId),
    previousGoalId, goalId, occurredAt: "2026-08-13T12:00:00.000Z",
    reason: "Troca de meta",
  });
};

const balanceOf = async (workspaceId: string) =>
  (await db().doc(
    `workspaces/${workspaceId}/cash_accounts/${defaultAccountOf(workspaceId)}`,
  ).get()).data()?.balanceCents;

// ---------------------------------------------------------------------------
// Metas manuais (D-31.1)
// ---------------------------------------------------------------------------

test("meta manual: criação persiste centavos, fonte, revisão e arquivamento",
  async () => {
    await reset();
    const balance = await balanceOf(WS);
    const quotaBefore = (await db()
      .doc(`workspaces/${WS}/quota_state/transactions`).get()).data();
    const result = await create(actor(MEMBER, "member"), manualGoal(), {
      manualProgressCents: 123_456,
    });
    assert.deepEqual(Object.keys(result).sort(),
      ["goalId", "revision", "success"]);
    const goal = await goalDoc(String(result.goalId));
    assert.equal(goal?.progressSource, "manual");
    assert.equal(goal?.manualProgressCents, 123_456);
    assert.equal(goal?.targetAmountCents, 1_000_000);
    assert.equal(goal?.archived, false, "archived: false desde a criação");
    assert.equal(goal?.revision, 1);
    assert.equal(goal?.priorityRank, 3);
    assert.equal(goal?.status, "em_andamento");
    assert.equal(goal?.workspaceId, WS);
    assert.equal(goal?.manualProgressUpdatedBy, MEMBER);
    assert.ok(goal?.manualProgressUpdatedAt instanceof Timestamp);
    for (const removed of [
      "targetAmount", "currentAmount", "currentAmountCents", "currentValue",
      "currentValueCents", "netContributionCents", "isAutomatic",
      "startDateTimestamp", "deadlineTimestamp", "investmentProgressCents",
      "progressBasis",
    ]) {
      assert.equal(goal?.[removed], undefined, `campo ${removed}`);
    }
    // Nenhum efeito fora da meta: sem lançamento, conta, investimento, quota.
    assert.equal(await countOf(WS, "transactions"), 0);
    assert.equal(await countOf(WS, "investment_movements"), 0);
    assert.equal(await balanceOf(WS), balance);
    assert.deepEqual((await db()
      .doc(`workspaces/${WS}/quota_state/transactions`).get()).data(),
    quotaBefore);
    const [audit] = await auditOf(String(result.goalId), "createGoal");
    assert.equal(audit.details.afterCents, 123_456);
    assert.equal(audit.actorId, MEMBER);
  });

test("valores inválidos são recusados na callable, sem escrita", async () => {
  await reset();
  const attempt = (goal: Record<string, unknown>, extra = {}) =>
    assert.rejects(() => createGoal.run(callableRequest(OWNER, {
      workspaceId: WS, idempotencyKey: key("invalid"), goal, ...extra,
    })), isHttps("invalid-argument"));
  await attempt(manualGoal({targetAmountCents: 10.5}),
    {manualProgressCents: 0});
  await attempt(manualGoal(), {manualProgressCents: -1});
  await attempt(manualGoal(), {manualProgressCents: 0.5});
  await attempt(manualGoal(), {});
  await attempt(manualGoal({startDate: "2026-02-30"}),
    {manualProgressCents: 0});
  await attempt(manualGoal({targetAmount: 1000}), {manualProgressCents: 0});
  await attempt(manualGoal({progressBasis: "current_value"}),
    {manualProgressCents: 0});
  await attempt(investmentGoal(), {manualProgressCents: 10});
  for (const goalId of ["__reservado__", ".", ".."]) {
    await assert.rejects(() => setGoalStatus.run(callableRequest(OWNER, {
      workspaceId: WS, idempotencyKey: key("reserved"), goalId,
      status: "pausada",
    })), isHttps("invalid-argument"));
  }
  assert.equal(await countOf(WS, "goals"), 0);
  assert.equal(await countOf(WS, "goal_idempotency_keys"), 0);
  assert.equal(await countOf(WS, "goal_audit_logs"), 0);
});

test("progresso manual: revisão, auditoria antes/depois e nada fora da meta",
  async () => {
    await reset();
    const goalId = await createManual(10_000);
    const balance = await balanceOf(WS);
    const result = await updateManual(goalId, 1, 250_000);
    assert.equal(result.revision, 2);
    assert.equal(result.manualProgressCents, 250_000);
    const goal = await goalDoc(goalId);
    assert.equal(goal?.manualProgressCents, 250_000);
    assert.equal(goal?.revision, 2);
    const [audit] = await auditOf(goalId, "updateGoalManualProgress");
    assert.deepEqual(audit.details, {beforeCents: 10_000, afterCents: 250_000});
    assert.equal(await countOf(WS, "transactions"), 0);
    assert.equal(await balanceOf(WS), balance);

    // Revisão antiga (formulário desatualizado): recusa sem escrever.
    await assert.rejects(() => updateManual(goalId, 1, 1),
      isCode("concurrent_update", GOAL_STALE_MESSAGE));
    assert.equal((await goalDoc(goalId))?.manualProgressCents, 250_000);
    // Zero é valor válido.
    await updateManual(goalId, 2, 0);
    assert.equal((await goalDoc(goalId))?.manualProgressCents, 0);
  });

test("concorrência: duas atualizações manuais na mesma revisão, só uma vence",
  async () => {
    await reset();
    const goalId = await createManual(0);
    const outcomes = await Promise.allSettled([
      updateManual(goalId, 1, 111_100),
      updateManual(goalId, 1, 222_200),
    ]);
    const fulfilled = outcomes.filter((entry) => entry.status === "fulfilled");
    assert.equal(fulfilled.length, 1);
    const rejected = outcomes.find((entry) => entry.status === "rejected");
    assert.ok(rejected && isCode("concurrent_update")(rejected.reason));
    const winner = (fulfilled[0] as PromiseFulfilledResult<{
      manualProgressCents: number;
    }>).value.manualProgressCents;
    const goal = await goalDoc(goalId);
    assert.equal(goal?.manualProgressCents, winner);
    assert.equal(goal?.revision, 2);
    assert.equal((await auditOf(goalId, "updateGoalManualProgress")).length, 1);
  });

test("meta não manual recusa valor informado à mão", async () => {
  await reset();
  const goalId = await createInvestment();
  await assert.rejects(() => updateManual(goalId, 1, 5_000),
    isCode("domain_precondition_failed", GOAL_NOT_MANUAL_MESSAGE));
  assert.equal((await goalDoc(goalId))?.manualProgressCents, undefined);
  // Edição também não aceita valor manual fora da troca para manual.
  await assert.rejects(() => update(actor(), goalId, 1, investmentGoal(),
    {manualProgressCents: 1}), isCode("invalid_payload"));
});

// ---------------------------------------------------------------------------
// Edição e troca de fonte (§7)
// ---------------------------------------------------------------------------

test(
  "edição: altera a definição, incrementa a revisão e " +
  "preserva valor e status",
  async () => {
    await reset();
    const goalId = await createManual(40_000, {description: "Antes"});
    await setStatus(goalId, "pausada");
    const result = await update(actor(ADMIN, "admin"), goalId, 1, manualGoal({
      name: "Reserva renomeada", priority: "baixa",
      targetAmountCents: 2_000_000,
    }));
    assert.equal(result.revision, 2);
    const goal = await goalDoc(goalId);
    assert.equal(goal?.name, "Reserva renomeada");
    assert.equal(goal?.priorityRank, 1);
    assert.equal(goal?.targetAmountCents, 2_000_000);
    assert.equal(goal?.description, undefined, "campo omitido é apagado");
    assert.equal(goal?.manualProgressCents, 40_000);
    assert.equal(goal?.status, "pausada", "edição não toca status");
    const [audit] = await auditOf(goalId, "updateGoal");
    assert.deepEqual(audit.details.changedFields,
      ["description", "name", "priority", "priorityRank", "targetAmountCents"]);
  });

test("troca manual → investimentos descarta o valor manual e audita",
  async () => {
    await reset();
    const goalId = await createManual(70_000);
    await update(actor(), goalId, 1, investmentGoal());
    const goal = await goalDoc(goalId);
    assert.equal(goal?.progressSource, "investment");
    assert.equal(goal?.manualProgressCents, undefined);
    assert.equal(goal?.manualProgressUpdatedAt, undefined);
    assert.equal(goal?.investmentProgressCents, 0,
      "o progresso anterior nunca vira progresso de investimentos");
    assert.equal(goal?.investmentNetContributionCents, 0);
    const [audit] = await auditOf(goalId, "updateGoal");
    assert.equal(audit.details.progressSourceFrom, "manual");
    assert.equal(audit.details.progressSourceTo, "investment");
    assert.equal(audit.details.discardedManualProgressCents, 70_000);
  });

test(
  "troca investimentos → manual exige valor novo e recusa com " +
  "posição vinculada",
  async () => {
    await reset();
    const goalId = await createInvestment();
    await assert.rejects(() => update(actor(), goalId, 1, manualGoal()),
      isCode("invalid_payload"));
    const aporte = await contribute({goalId, valueCents: 30_000});
    await assert.rejects(
      () => update(actor(), goalId, 1, manualGoal(), {manualProgressCents: 0}),
      isCode("domain_precondition_failed", GOAL_LINKED_SOURCE_MESSAGE),
    );
    await unlink(String(aporte.positionId), goalId);
    await update(actor(), goalId, 1, manualGoal(),
      {manualProgressCents: 5_000});
    const goal = await goalDoc(goalId);
    assert.equal(goal?.progressSource, "manual");
    assert.equal(goal?.manualProgressCents, 5_000,
      "valor novo informado; nada somado da fonte anterior");
    assert.equal(goal?.investmentProgressCents, undefined);
    assert.equal(goal?.investmentNetContributionCents, undefined);
    for (const field of ["investmentProjectionVersion",
      "investmentCalculationVersion", "investmentProjectionDirty",
      "investmentUpdatedBy", "investmentUpdatedAt"]) {
      assert.equal(goal?.[field], undefined, `metadado ${field} ficou`);
    }
    // Posição e movimentos permanecem (nunca apagados).
    const position = await positionOf(String(aporte.positionId));
    assert.equal(position.principalCents, 30_000);
    assert.equal(position.goalId, undefined);
    assert.ok(await countOf(WS, "investment_movements") >= 2);
  });

test("indicador empresarial e centro de custo só em workspace PJ", async () => {
  await reset();
  await assert.rejects(() => create(actor(), kpiGoal("faturamento")),
    isCode("invalid_payload"));
  await assert.rejects(() => create(actor(), manualGoal({costCenter: "Loja"}),
    {manualProgressCents: 0}), isCode("invalid_payload"));
  const pj = actor(OWNER_PJ, "owner", WS_PJ);
  const kpi = await create(pj, kpiGoal("faturamento", {costCenter: "Loja"}));
  const goal = await goalDoc(String(kpi.goalId), WS_PJ);
  assert.equal(goal?.progressSource, "business_kpi");
  assert.equal(goal?.manualProgressCents, undefined);
  assert.equal(goal?.investmentProgressCents, undefined);
});

test(
  "PJ: meta manual com centro de custo — criar, valor, editar, trocar e " +
  "arquivar, sem lançamento nem conta",
  async () => {
    await reset();
    const pj = actor(OWNER_PJ, "owner", WS_PJ);
    // Meta manual não leva indicador nem base patrimonial, também em PJ.
    assert.throws(() => createGoalPayloadSchema.parse({
      workspaceId: WS_PJ, idempotencyKey: key("create"),
      goal: manualGoal({businessType: "faturamento"}), manualProgressCents: 0,
    }));
    assert.throws(() => createGoalPayloadSchema.parse({
      workspaceId: WS_PJ, idempotencyKey: key("create"),
      goal: manualGoal({progressBasis: "net_contributions"}),
      manualProgressCents: 0,
    }));

    const created = await create(pj, manualGoal({costCenter: "Comercial"}),
      {manualProgressCents: 0});
    const goalId = String(created.goalId);
    let goal = await goalDoc(goalId, WS_PJ);
    assert.equal(goal?.progressSource, "manual");
    assert.equal(goal?.manualProgressCents, 0, "zero vale como valor inicial");
    assert.equal(goal?.costCenter, "Comercial");
    assert.equal(goal?.businessType, undefined);
    assert.equal(goal?.progressBasis, undefined);
    assert.equal(goal?.archived, false);
    assert.equal(goal?.revision, 1);

    const transactionsBefore = await countOf(WS_PJ, "transactions");
    const movementsBefore = await countOf(WS_PJ, "cash_account_movements");
    await updateManual(goalId, 1, 123_456, pj);
    goal = await goalDoc(goalId, WS_PJ);
    assert.equal(goal?.manualProgressCents, 123_456);
    assert.equal(goal?.revision, 2);
    const [progressAudit] = await auditOf(goalId, "updateGoalManualProgress",
      WS_PJ);
    assert.deepEqual(progressAudit.details,
      {beforeCents: 0, afterCents: 123_456});

    await update(pj, goalId, 2,
      manualGoal({name: "Reserva da empresa", costCenter: "Comercial"}));
    goal = await goalDoc(goalId, WS_PJ);
    assert.equal(goal?.name, "Reserva da empresa");
    assert.equal(goal?.manualProgressCents, 123_456, "edição preserva o valor");
    assert.equal(goal?.revision, 3);

    // Manual → indicador: nada aproveitado, trilha registra o descarte.
    await update(pj, goalId, 3,
      kpiGoal("faturamento", {costCenter: "Comercial"}));
    goal = await goalDoc(goalId, WS_PJ);
    assert.equal(goal?.progressSource, "business_kpi");
    assert.equal(goal?.manualProgressCents, undefined);
    const switchAudit = (await auditOf(goalId, "updateGoal", WS_PJ))
      .find((entry) => entry.details?.progressSourceTo === "business_kpi");
    assert.equal(switchAudit?.details.progressSourceFrom, "manual");
    assert.equal(switchAudit?.details.discardedManualProgressCents, 123_456);

    // Indicador → manual: exige valor novo.
    await assert.rejects(() => update(pj, goalId, 4, manualGoal()),
      isCode("invalid_payload"));
    await update(pj, goalId, 4, manualGoal({costCenter: "Comercial"}),
      {manualProgressCents: 5_000});
    goal = await goalDoc(goalId, WS_PJ);
    assert.equal(goal?.progressSource, "manual");
    assert.equal(goal?.manualProgressCents, 5_000);
    assert.equal(goal?.businessType, undefined);
    assert.equal(goal?.period, undefined);

    await setStatus(goalId, "pausada", pj);
    await archive(goalId, pj);
    goal = await goalDoc(goalId, WS_PJ);
    assert.equal(goal?.archived, true);
    assert.equal(goal?.status, "pausada", "arquivar preserva o status");
    await assert.rejects(() => updateManual(goalId, 5, 9_000, pj),
      isCode("domain_precondition_failed", GOAL_ARCHIVED_MESSAGE));

    // Nenhum lançamento, movimento de conta ou aporte em todo o ciclo.
    assert.equal(await countOf(WS_PJ, "transactions"), transactionsBefore);
    assert.equal(await countOf(WS_PJ, "cash_account_movements"),
      movementsBefore);
    assert.equal(await countOf(WS_PJ, "investment_positions"), 0);
  });

// ---------------------------------------------------------------------------
// Metas de investimentos (D-31.2)
// ---------------------------------------------------------------------------

test(
  "investimentos: progresso da projeção nas duas bases, " +
  "recalculado na troca",
  async () => {
    await reset();
    const goalId = await createInvestment();
    await contribute({goalId, valueCents: 80_000});
    let goal = await goalDoc(goalId);
    assert.equal(goal?.investmentNetContributionCents, 80_000);
    assert.equal(goal?.investmentProgressCents, 80_000);
    // Valorização publicada pelo domínio patrimonial (fora do escopo deste
    // teste produzi-la): a base "valor atual" passa a divergir dos aportes.
    await db().doc(`workspaces/${WS}/goals/${goalId}`)
      .update({investmentCurrentValueCents: 95_000});

    await update(actor(), goalId, 1,
      investmentGoal({progressBasis: "current_value"}));
    goal = await goalDoc(goalId);
    assert.equal(goal?.investmentProgressCents, 95_000,
      "trocar a base recalcula na mesma transação (PR-GOAL-01)");
    await update(actor(), goalId, 2,
      investmentGoal({progressBasis: "net_contributions"}));
    goal = await goalDoc(goalId);
    assert.equal(goal?.investmentProgressCents, 80_000);
    // Retirada reduz o principal na base de aportes.
    const [position] = (await db()
      .collection(`workspaces/${WS}/investment_positions`).get()).docs;
    await executeWithdrawSimpleInvestment(actor(), {
      workspaceId: WS, idempotencyKey: key("withdraw"),
      correlationId: key("corr"), positionId: position.id, valueCents: 30_000,
      received: true, occurredAt: "2026-08-20T12:00:00.000Z",
      cashAccountId: defaultAccountOf(WS),
    });
    assert.equal((await goalDoc(goalId))?.investmentProgressCents, 50_000);
  });

test("vínculo, troca e aporte recusam meta manual (uma fonte por meta)",
  async () => {
    await reset();
    const manualId = await createManual(0);
    const investmentId = await createInvestment();
    await assert.rejects(() => contribute({goalId: manualId}),
      isCode("domain_precondition_failed", GOAL_NOT_INVESTMENT_MESSAGE));
    const free = await contribute();
    await assert.rejects(() => link(String(free.positionId), manualId),
      isCode("domain_precondition_failed", GOAL_NOT_INVESTMENT_MESSAGE));
    const linked = await contribute({goalId: investmentId});
    await assert.rejects(
      () => transfer(String(linked.positionId), investmentId, manualId),
      isCode("domain_precondition_failed", GOAL_NOT_INVESTMENT_MESSAGE),
    );
    const manual = await goalDoc(manualId);
    assert.equal(manual?.investmentProgressCents, undefined);
    assert.equal(manual?.manualProgressCents, 0);
  });

test("vínculo de posição zerada ainda escreve a meta (serializa com arquivar)",
  async () => {
    await reset();
    const goalId = await createInvestment();
    const free = await contribute({valueCents: 40_000});
    const positionId = String(free.positionId);
    await executeWithdrawSimpleInvestment(actor(), {
      workspaceId: WS, idempotencyKey: key("withdraw"),
      correlationId: key("corr"), positionId, valueCents: 40_000,
      received: true, occurredAt: "2026-08-11T12:00:00.000Z",
      cashAccountId: defaultAccountOf(WS),
    });
    assert.equal((await positionOf(positionId)).principalCents, 0);
    const before = (await goalDoc(goalId))?.investmentProjectionVersion ?? 0;
    await link(positionId, goalId);
    const after = await goalDoc(goalId);
    assert.equal(after?.investmentProjectionVersion, before + 1,
      "o vínculo sem valor também escreve o documento da meta");
    assert.equal(after?.investmentProgressCents, 0);
    await assert.rejects(() => archive(goalId),
      isCode("domain_precondition_failed", GOAL_LINKED_ARCHIVE_MESSAGE));
    await unlink(positionId, goalId);
    assert.equal((await goalDoc(goalId))?.investmentProjectionVersion,
      before + 2, "o desvínculo sem valor também escreve a meta");
    await archive(goalId);
    assert.equal((await goalDoc(goalId))?.archived, true);
  });

test("troca de fonte com indicador PJ: nada aproveitado e tudo auditado",
  async () => {
    await reset();
    const pj = actor(OWNER_PJ, "owner", WS_PJ);
    const goalId = String((await create(pj, kpiGoal("lucro"))).goalId);
    await update(pj, goalId, 1, manualGoal({name: "Agora manual"}),
      {manualProgressCents: 4_200});
    let goal = await goalDoc(goalId, WS_PJ);
    assert.equal(goal?.progressSource, "manual");
    assert.equal(goal?.manualProgressCents, 4_200);
    assert.equal(goal?.businessType, undefined);
    assert.equal(goal?.period, undefined);
    await update(pj, goalId, 2, kpiGoal("faturamento", {period: "anual"}));
    goal = await goalDoc(goalId, WS_PJ);
    assert.equal(goal?.progressSource, "business_kpi");
    assert.equal(goal?.manualProgressCents, undefined);
    assert.equal(goal?.manualProgressUpdatedAt, undefined);
    assert.equal(goal?.businessType, "faturamento");
    const audits = (await auditOf(goalId, "updateGoal", WS_PJ))
      .map((entry) => entry.details);
    assert.ok(audits.some((details) =>
      details.progressSourceFrom === "business_kpi" &&
      details.progressSourceTo === "manual" && details.afterCents === 4_200));
    assert.ok(audits.some((details) =>
      details.progressSourceFrom === "manual" &&
      details.progressSourceTo === "business_kpi" &&
      details.discardedManualProgressCents === 4_200));
  });

test("projeção patrimonial não zerada sem vínculo bloqueia a troca de fonte",
  async () => {
    await reset();
    const goalId = await createInvestment();
    // Deriva publicada sem posição vinculada (não ocorre pelo fluxo normal).
    await db().doc(`workspaces/${WS}/goals/${goalId}`)
      .update({investmentNetContributionCents: 500});
    await assert.rejects(
      () => update(actor(), goalId, 1, manualGoal(), {manualProgressCents: 0}),
      (error: unknown) => isCode("domain_precondition_failed")(error) &&
        /não está zerada/.test((error as Error).message),
    );
    assert.equal((await goalDoc(goalId))?.progressSource, "investment");
  });

// ---------------------------------------------------------------------------
// Status (D-31.5)
// ---------------------------------------------------------------------------

test("status persiste, é auditado e não invalida edição aberta", async () => {
  await reset();
  const goalId = await createManual(0);
  for (const status of ["pausada", "em_andamento", "alcancada", "cancelada",
    "em_andamento"]) {
    const result = await setStatus(goalId, status, actor(MEMBER, "member"));
    assert.equal(result.status, status);
    assert.equal(result.revision, 1, "status não incrementa a revisão");
    assert.equal((await goalDoc(goalId))?.status, status);
  }
  const audits = await auditOf(goalId, "setGoalStatus");
  assert.equal(audits.length, 5);
  // Formulário aberto na revisão 1 continua válido depois dos cliques.
  await update(actor(), goalId, 1, manualGoal({name: "Depois do status"}));
  assert.equal((await goalDoc(goalId))?.status, "em_andamento");
});

test("concorrência: status e edição simultâneos preservam os dois",
  async () => {
    await reset();
    const goalId = await createManual(0);
    await Promise.all([
      setStatus(goalId, "pausada"),
      update(actor(), goalId, 1, manualGoal({name: "Renomeada em paralelo"})),
    ]);
    const goal = await goalDoc(goalId);
    assert.equal(goal?.status, "pausada");
    assert.equal(goal?.name, "Renomeada em paralelo");
    assert.equal(goal?.revision, 2);
  });

// ---------------------------------------------------------------------------
// Arquivamento (D-31.4)
// ---------------------------------------------------------------------------

test(
  "arquivar sem vínculo: lógico, preserva status, metadados e " +
  "bloqueia escrita",
  async () => {
    await reset();
    const goalId = await createManual(15_000);
    await setStatus(goalId, "pausada");
    const result = await archive(goalId, actor(MEMBER, "member"));
    assert.equal(result.revision, 2);
    const goal = await goalDoc(goalId);
    assert.ok(goal, "arquivar nunca apaga a meta");
    assert.equal(goal?.archived, true);
    assert.equal(goal?.status, "pausada", "arquivar não força cancelada");
    assert.equal(goal?.archivedBy, MEMBER);
    assert.equal(goal?.archiveReason, "Meta encerrada no teste");
    assert.ok(goal?.archivedAt instanceof Timestamp);
    assert.equal(goal?.manualProgressCents, 15_000);
    const archivedError = isCode("domain_precondition_failed",
      GOAL_ARCHIVED_MESSAGE);
    await assert.rejects(() => updateManual(goalId, 2, 1), archivedError);
    await assert.rejects(() => update(actor(), goalId, 2, manualGoal()),
      archivedError);
    await assert.rejects(() => setStatus(goalId, "em_andamento"),
      archivedError);
    await assert.rejects(() => archive(goalId), archivedError);
  });

test("arquivar com posição vinculada é recusado; desvincular libera",
  async () => {
    await reset();
    const goalId = await createInvestment();
    const aporte = await contribute({goalId, valueCents: 60_000});
    const keysBefore = await countOf(WS, "goal_idempotency_keys");
    const goalBefore = await goalDoc(goalId);
    await assert.rejects(() => archive(goalId),
      isCode("domain_precondition_failed", GOAL_LINKED_ARCHIVE_MESSAGE));
    // Recusa no meio da transação: nada parcial (meta, reserva nem trilha).
    assert.deepEqual(await goalDoc(goalId), goalBefore);
    assert.equal(await countOf(WS, "goal_idempotency_keys"), keysBefore);
    assert.equal((await auditOf(goalId, "archiveGoal")).length, 0);
    assert.equal((await goalDoc(goalId))?.archived, false);
    await unlink(String(aporte.positionId), goalId);
    await archive(goalId);
    const goal = await goalDoc(goalId);
    assert.equal(goal?.archived, true);
    assert.equal(goal?.investmentProgressCents, 0);
    // A posição e os movimentos continuam; só o vínculo saiu.
    const position = await positionOf(String(aporte.positionId));
    assert.equal(position.goalId, undefined);
    assert.equal(position.principalCents, 60_000);
  });

test("transferir para outra meta libera o arquivamento da anterior",
  async () => {
    await reset();
    const from = await createInvestment({name: "Origem"});
    const to = await createInvestment({name: "Destino"});
    const aporte = await contribute({goalId: from, valueCents: 25_000});
    await transfer(String(aporte.positionId), from, to);
    await archive(from);
    assert.equal((await goalDoc(from))?.archived, true);
    assert.equal((await goalDoc(to))?.investmentProgressCents, 25_000);
  });

test("meta arquivada recusa vínculo, transferência, aporte e liquidação",
  async () => {
    await reset();
    const archivedId = await createInvestment({name: "Arquivada"});
    const activeId = await createInvestment({name: "Ativa"});
    // Aporte pendente registrado antes do arquivamento, apontando a meta.
    const pending = await contribute({goalId: archivedId, settled: false,
      valueCents: 12_000});
    await archive(archivedId);
    const refused = isCode("domain_precondition_failed",
      GOAL_ARCHIVED_FOR_INVESTMENT_MESSAGE);
    const free = await contribute();
    await assert.rejects(() => link(String(free.positionId), archivedId),
      refused);
    const linked = await contribute({goalId: activeId});
    await assert.rejects(
      () => transfer(String(linked.positionId), activeId, archivedId), refused,
    );
    await assert.rejects(() => contribute({goalId: archivedId}), refused);
    await assert.rejects(() => contribute({goalId: archivedId, settled: false}),
      refused);
    await assert.rejects(() => executeSettleInvestmentContribution(actor(), {
      workspaceId: WS, idempotencyKey: key("settle"),
      correlationId: key("corr"), movementId: String(pending.movementId),
      settledAt: "2026-08-15T12:00:00.000Z",
      cashAccountId: defaultAccountOf(WS),
    }), refused);
    const goal = await goalDoc(archivedId);
    assert.equal(goal?.investmentProgressCents, 0);
    assert.equal((await positionOf(String(free.positionId))).goalId, undefined);
    assert.equal((await positionOf(String(linked.positionId))).goalId,
      activeId);
  });

test("concorrência: arquivar × vincular, × aportar e × transferir",
  async () => {
    await reset();
    for (let round = 0; round < 4; round += 1) {
      const goalId = await createInvestment({name: `Corrida ${round}`});
      const other = await createInvestment({name: `Outra ${round}`});
      const free = await contribute({valueCents: 10_000});
      const zero = await contribute({valueCents: 7_000});
      await executeWithdrawSimpleInvestment(actor(), {
        workspaceId: WS, idempotencyKey: key("withdraw"),
        correlationId: key("corr"), positionId: String(zero.positionId),
        valueCents: 7_000, received: true,
        occurredAt: "2026-08-11T12:00:00.000Z",
        cashAccountId: defaultAccountOf(WS),
      });
      const elsewhere = await contribute({goalId: other, valueCents: 10_000});
      const linkArgs = await linkPayload(String(free.positionId), goalId);
      const zeroArgs = await linkPayload(String(zero.positionId), goalId);
      const elsewherePosition = await positionOf(String(elsewhere.positionId));
      const contenders = [
        archive(goalId),
        executeLinkInvestmentToGoal(actor(), zeroArgs),
        executeLinkInvestmentToGoal(actor(), linkArgs),
        contribute({goalId, valueCents: 5_000}),
        executeChangeInvestmentGoal(actor(), {
          workspaceId: WS, idempotencyKey: key("move"),
          correlationId: key("corr"),
          accountId: String(elsewherePosition.accountId),
          assetId: String(elsewherePosition.assetId),
          previousGoalId: other, goalId,
          occurredAt: "2026-08-13T12:00:00.000Z", reason: "Corrida",
        }),
      ];
      const outcomes = await Promise.allSettled(contenders);
      for (const outcome of outcomes) {
        if (outcome.status === "rejected") {
          assert.ok(
            outcome.reason instanceof ApplicationError &&
              ["domain_precondition_failed", "concurrent_update"]
                .includes(outcome.reason.code),
            `falha inesperada: ${String(outcome.reason)}`,
          );
        }
      }
      const goal = await goalDoc(goalId);
      const linkedCount = (await db()
        .collection(`workspaces/${WS}/investment_positions`)
        .where("goalId", "==", goalId).get()).size;
      if (goal?.archived === true) {
        assert.equal(linkedCount, 0, `rodada ${round}: arquivada com vínculo`);
        assert.equal(goal?.investmentNetContributionCents, 0);
      } else {
        assert.ok(linkedCount > 0,
          `rodada ${round}: nada venceu o arquivamento`);
      }
    }
  });

// ---------------------------------------------------------------------------
// Idempotência, RBAC e isolamento
// ---------------------------------------------------------------------------

test("idempotência: replay devolve o mesmo resultado; dados novos conflitam",
  async () => {
    await reset();
    const payload = createGoalPayloadSchema.parse({
      workspaceId: WS, idempotencyKey: "p5b-replay-key-0001",
      goal: manualGoal(), manualProgressCents: 1_000,
    });
    // Duplo clique: as duas chamadas concorrentes devolvem a mesma meta.
    const [first, second] = await Promise.all([
      executeCreateGoal(actor(), payload),
      executeCreateGoal(actor(), payload),
    ]);
    assert.deepEqual(first, second);
    const [reservation] = (await db()
      .collection(`workspaces/${WS}/goal_idempotency_keys`).get()).docs;
    const expiresAt = reservation.get("expiresAt");
    assert.ok(expiresAt instanceof Timestamp, "reserva sem expiresAt");
    const days = (expiresAt.toMillis() - Date.now()) / 86_400_000;
    assert.ok(days > 89 && days <= 90, `expiração em ${days} dias`);
    assert.equal(await countOf(WS, "goals"), 1);
    assert.equal(await countOf(WS, "goal_audit_logs"), 1);
    await assert.rejects(() => executeCreateGoal(actor(), {
      ...payload, manualProgressCents: 2_000,
    }), isCode("idempotency_conflict"));
    // A mesma chave de outro ator é outra intenção.
    await executeCreateGoal(actor(ADMIN, "admin"), payload);
    assert.equal(await countOf(WS, "goals"), 2);

    const goalId = String(first.goalId);
    const statusKey = "p5b-status-key-00001";
    const statusFirst = await setStatus(goalId, "pausada", actor(), statusKey);
    await setStatus(goalId, "em_andamento");
    const statusReplay = await setStatus(goalId, "pausada", actor(), statusKey);
    assert.deepEqual(statusReplay, statusFirst);
    assert.equal((await goalDoc(goalId))?.status, "em_andamento",
      "replay não reaplica o status antigo");
    // A mesma chave em outra operação é outra intenção (reserva por operação).
    const sharedKey = "p5b-shared-key-00001";
    const sharedGoal = await create(actor(), manualGoal(),
      {manualProgressCents: 0});
    await executeCreateGoal(actor(), createGoalPayloadSchema.parse({
      workspaceId: WS, idempotencyKey: sharedKey, goal: manualGoal(),
      manualProgressCents: 0,
    }));
    const sharedStatus = await setStatus(String(sharedGoal.goalId), "pausada",
      actor(), sharedKey);
    assert.equal(sharedStatus.status, "pausada");
    const archiveKey = "p5b-archive-key-0001";
    const archived = await archive(goalId, actor(), archiveKey);
    assert.deepEqual(await archive(goalId, actor(), archiveKey), archived);
    assert.equal((await auditOf(goalId, "archiveGoal")).length, 1);
  });

test("RBAC: owner, admin e member gerenciam; viewer só lê; de fora, nada",
  async () => {
    await reset();
    for (const uid of [OWNER, ADMIN, MEMBER]) {
      const created = await call(createGoal, uid, {
        workspaceId: WS, idempotencyKey: key("rbac"), goal: manualGoal(),
        manualProgressCents: 0,
      }) as {goalId: string};
      await call(setGoalStatus, uid, {
        workspaceId: WS, idempotencyKey: key("rbac"),
        goalId: created.goalId, status: "pausada",
      });
    }
    const goalId = await createManual(0);
    const writes: [unknown, Record<string, unknown>][] = [
      [createGoal, {workspaceId: WS, idempotencyKey: key("v"),
        goal: manualGoal(), manualProgressCents: 0}],
      [updateGoal, {workspaceId: WS, idempotencyKey: key("v"), goalId,
        expectedRevision: 1, goal: manualGoal()}],
      [updateGoalManualProgress, {workspaceId: WS, idempotencyKey: key("v"),
        goalId, expectedRevision: 1, manualProgressCents: 1}],
      [setGoalStatus, {workspaceId: WS, idempotencyKey: key("v"), goalId,
        status: "pausada"}],
      [archiveGoal, {workspaceId: WS, idempotencyKey: key("v"), goalId,
        reason: "Tentativa"}],
    ];
    const goalsBefore = await countOf(WS, "goals");
    for (const [fn, data] of writes) {
      await assert.rejects(() => call(fn, VIEWER, data),
        isHttps("permission-denied"), "viewer escreveu");
      await assert.rejects(() => call(fn, OUTSIDER, data),
        isHttps("permission-denied"), "não membro escreveu");
      await assert.rejects(() => call(fn, OWNER_OTHER, data),
        isHttps("permission-denied"), "dono de outro workspace escreveu");
    }
    assert.equal(await countOf(WS, "goals"), goalsBefore);
    const goal = await goalDoc(goalId);
    assert.equal(goal?.revision, 1);
    assert.equal(goal?.status, "em_andamento");
    assert.equal(goal?.archived, false);
    // Leitura: viewer pode; não membro não.
    const overview = await call(getGoalsOverview, VIEWER, {workspaceId: WS}) as
      {activeCount: number};
    assert.equal(overview.activeCount, goalsBefore);
    await call(getGoalKpiProgress, VIEWER,
      {workspaceId: WS, goalIds: [goalId]});
    await assert.rejects(() => call(getGoalsOverview, OUTSIDER,
      {workspaceId: WS}), isHttps("permission-denied"));
    await assert.rejects(() => call(getGoalKpiProgress, OWNER_OTHER,
      {workspaceId: WS, goalIds: [goalId]}), isHttps("permission-denied"));
  });

test("isolamento: ID de meta de outro workspace não é alcançável", async () => {
  await reset();
  const foreign = await create(actor(OWNER_OTHER, "owner", WS_OTHER),
    manualGoal(), {manualProgressCents: 9_999});
  const foreignId = String(foreign.goalId);
  await assert.rejects(() => updateManual(foreignId, 1, 1),
    isCode("not_found"));
  await assert.rejects(() => setStatus(foreignId, "pausada"),
    isCode("not_found"));
  await assert.rejects(() => archive(foreignId), isCode("not_found"));
  await assert.rejects(() => update(actor(), foreignId, 1, manualGoal()),
    isCode("not_found"));
  const kpi = await executeGetGoalKpiProgress(actor(), {
    workspaceId: WS, goalIds: [foreignId],
  });
  assert.equal(kpi.results[0].status, "unavailable");
  // Vínculo patrimonial com meta de outro workspace também não passa.
  const free = await contribute();
  await assert.rejects(() => link(String(free.positionId), foreignId),
    isCode("not_found", "Meta não encontrada."));
  const untouched = await goalDoc(foreignId, WS_OTHER);
  assert.equal(untouched?.manualProgressCents, 9_999);
  assert.equal(untouched?.status, "em_andamento");
  assert.equal(untouched?.archived, false);
  assert.equal(untouched?.investmentProgressCents, undefined);
});

test("workspace arquivado e membro rebaixado não escrevem", async () => {
  await reset();
  const goalId = await createManual(0);
  await seedMember(WS, MEMBER, "viewer");
  await assert.rejects(
    () => updateManual(goalId, 1, 5, actor(MEMBER, "member")),
    isCode("workspace_role_denied"),
  );
  await db().doc(`workspaces/${WS}`).update({status: "archived"});
  await assert.rejects(() => setStatus(goalId, "pausada"),
    isCode("workspace_archived"));
  assert.equal((await goalDoc(goalId))?.status, "em_andamento");
});

// ---------------------------------------------------------------------------
// Paginação e contagem (D-31.5)
// ---------------------------------------------------------------------------

test("mais de 100 metas: páginas por cursor sem repetição e contagem exata",
  async () => {
    await reset();
    const priorities = ["alta", "media", "baixa"];
    const statuses = ["em_andamento", "alcancada", "pausada", "cancelada"];
    const ids: string[] = [];
    for (let index = 0; index < 105; index += 1) {
      const result = await create(actor(), manualGoal({
        name: `Meta ${index}`, priority: priorities[index % 3],
      }), {manualProgressCents: 0, status: statuses[index % 4]});
      ids.push(String(result.goalId));
    }
    await archive(ids[0]);
    const goals = db().collection(`workspaces/${WS}/goals`);
    const seen: string[] = [];
    let cursor: admin.firestore.QueryDocumentSnapshot | undefined;
    let pages = 0;
    for (;;) {
      let query = goals.where("archived", "==", false)
        .orderBy("priorityRank", "desc").orderBy("createdAt", "desc")
        .orderBy(admin.firestore.FieldPath.documentId(), "desc");
      if (cursor) query = query.startAfter(cursor);
      const page = await query.limit(26).get();
      pages += 1;
      const docs = page.docs.slice(0, 25);
      seen.push(...docs.map((doc) => doc.id));
      if (page.size <= 25) break;
      cursor = docs[docs.length - 1];
    }
    assert.equal(pages, 5);
    assert.equal(seen.length, 104);
    assert.equal(new Set(seen).size, 104, "nenhuma meta repetida");
    assert.ok(!seen.includes(ids[0]), "arquivada fora da lista");
    const ranks = await Promise.all(seen.map(async (id) =>
      (await goalDoc(id))?.priorityRank as number));
    for (let index = 1; index < ranks.length; index += 1) {
      assert.ok(ranks[index - 1] >= ranks[index], "ordem por prioridade");
    }
    const overview = await executeGetGoalsOverview(actor());
    assert.equal(overview.activeCount, 104);
    const expected: Record<string, number> = {
      em_andamento: 0, alcancada: 0, pausada: 0, cancelada: 0,
    };
    for (let index = 1; index < 105; index += 1) {
      expected[statuses[index % 4]] += 1;
    }
    assert.deepEqual(overview.byStatus, expected);
  });

// ---------------------------------------------------------------------------
// Indicadores PJ (D-31.3)
// ---------------------------------------------------------------------------

test(
  "PJ: indicadores sobre fontes oficiais, sem pendentes, " +
  "empréstimos, juros nem investimentos",
  async () => {
    const tenant = await seedReceivableTenant("goal-kpi");
    const ws = tenant.workspaceId;
    const owner = actor(tenant.owner, "owner", ws);
    await seedInvestmentCatalog(ws);
    await seedDefaultCategories(ws);
    const day = today();
    const account = defaultAccountOf(ws);
    const entry = (type: string, amountCents: number, extra = {}) =>
      executeCreateCashTransaction(owner, {
        workspaceId: ws, cashAccountId: account, idempotencyKey: key("cash"),
        type, description: `${type} ${amountCents}`,
        categoryId: defaultCategoryIdFor(
          type === "despesa" ? "despesa" : "receita"),
        amountCents, date: day, ...extra,
      } as never, key("req"));
    await entry("receita", 50_000);
    await entry("despesa", 20_000);
    // Pendente: não é caixa realizado.
    await entry("receita", 99_900, {status: "pending", date: undefined,
      dueDate: day});
    // Empréstimo tomado e parcela com juros: principal e juros fora.
    const loan = await createLoanCall(tenant.owner, loanCreatePayload(ws));
    await payLoanCall(tenant.owner,
      await loanPayPayload(ws, String(loan.loanId)));
    // Recebível: emitido não conta; recebido entra uma vez (principal).
    const clientId = await seedClient(tenant);
    const receivable = await newReceivable(tenant.owner,
      receivablePayload(ws, String(clientId), {amountCents: 100_000}));
    await receive(tenant.owner, await receivePayload(ws,
      String(receivable.receivableId),
      {principalCents: 40_000, interestCents: 5_000}));
    // Aporte em investimento: patrimonial, fora dos indicadores.
    await contribute({workspaceId: ws, uid: tenant.owner, valueCents: 33_300,
      occurredAt: new Date(Date.now() - 60_000).toISOString()});
    // Entrega de cada espelho ao gatilho real da projeção mensal.
    for (const doc of (await db().collection(`workspaces/${ws}/transactions`)
      .get()).docs) {
      await deliverMirror(ws, doc.id);
    }
    const period = (await db()
      .doc(`workspaces/${ws}/cash_report_periods/${day.slice(0, 7)}`).get())
      .data();
    assert.ok(period, "projeção mensal existe");
    assert.ok((period?.loanPrincipalInflowCents ?? 0) > 0);
    assert.ok((period?.financialExpenseCents ?? 0) > 0);
    assert.ok((period?.investmentOutflowCents ?? 0) > 0);

    const goals: Record<string, string> = {};
    for (const type of ["faturamento", "lucro", "margem", "caixa_minimo",
      "reducao_custos"]) {
      goals[type] = String((await create(owner, kpiGoal(type))).goalId);
    }
    const {results} = await executeGetGoalKpiProgress(owner, {
      workspaceId: ws, goalIds: Object.values(goals),
    });
    const byType = Object.fromEntries(Object.keys(goals).map((type, index) =>
      [type, results[index]])) as Record<string, Record<string, unknown>>;
    assert.equal(byType.faturamento.valueCents, 90_000,
      "receita confirmada + principal recebido, uma vez");
    assert.equal(byType.lucro.valueCents, 70_000);
    assert.equal(byType.reducao_custos.valueCents, 20_000);
    assert.equal(byType.margem.valueBasisPoints, 7_778);
    assert.deepEqual(byType.faturamento.components,
      {receiptsCents: 90_000, expensesCents: 20_000});
    // Saldo disponível = soma dos saldos das contas (o "Saldo geral").
    const accounts = await db().collection(`workspaces/${ws}/cash_accounts`)
      .get();
    const balance = accounts.docs.reduce((sum, doc) =>
      sum + Number(doc.data().balanceCents ?? 0), 0);
    assert.equal(byType.caixa_minimo.valueCents, balance);
    assert.notEqual(balance, 70_000, "saldo não é o fluxo do mês");
    // Nada é persistido como progresso nas metas PJ.
    for (const goalId of Object.values(goals)) {
      const goal = await goalDoc(goalId, ws);
      assert.equal(goal?.manualProgressCents, undefined);
      assert.equal(goal?.investmentProgressCents, undefined);
    }
  });

test("PJ: períodos civis de São Paulo, fronteira do mês e margem sem receita",
  async () => {
    await reset();
    const pj = actor(OWNER_PJ, "owner", WS_PJ);
    const periods = db().collection(`workspaces/${WS_PJ}/cash_report_periods`);
    const projection = (incomeCents: number, expenseCents: number) => ({
      incomeCents, expenseCents,
      // Campos que nunca entram nos indicadores, com valores chamativos.
      loanPrincipalInflowCents: 7_000_000, loanPrincipalOutflowCents: 6_000_000,
      financialIncomeCents: 500_000, financialExpenseCents: 400_000,
      creditCardPaymentCents: 3_000_000, investmentOutflowCents: 2_000_000,
      investmentInflowCents: 1_000_000, netCents: 0, transactionCount: 9,
    });
    await Promise.all([
      periods.doc("2026-07").set(projection(10_000, 1_000)),
      periods.doc("2026-08").set(projection(20_000, 2_000)),
      periods.doc("2026-09").set(projection(40_000, 4_000)),
    ]);
    const ids = {
      mensal: String((await create(pj, kpiGoal("faturamento"))).goalId),
      trimestral: String((await create(pj,
        kpiGoal("faturamento", {period: "trimestral"}))).goalId),
      semestral: String((await create(pj,
        kpiGoal("reducao_custos", {period: "semestral"}))).goalId),
      anual: String((await create(pj,
        kpiGoal("lucro", {period: "anual"}))).goalId),
      custom: String((await create(pj, kpiGoal("faturamento", {
        period: "custom", startDate: "2026-07-01", deadline: "2026-08-31",
      }))).goalId),
      partial: String((await create(pj, kpiGoal("faturamento", {
        period: "custom", startDate: "2026-07-15", deadline: "2026-08-31",
      }))).goalId),
      margemSemReceita: String((await create(pj, kpiGoal("margem", {
        period: "custom", startDate: "2026-01-01", deadline: "2026-01-31",
      }))).goalId),
    };
    // 02:30 UTC de 1º de setembro = 31 de agosto em São Paulo.
    const {results} = await executeGetGoalKpiProgress(pj, {
      workspaceId: WS_PJ, goalIds: Object.values(ids),
    }, new Date("2026-09-01T02:30:00.000Z"));
    const [mensal, trimestral, semestral, anual, custom, partial, margem] =
      results as Record<string, unknown>[];
    assert.equal(mensal.valueCents, 20_000, "agosto, não setembro");
    assert.deepEqual(mensal.window,
      {startDate: "2026-08-01", endDate: "2026-08-31"});
    assert.equal(trimestral.valueCents, 70_000, "julho a setembro, 3º tri");
    assert.equal(semestral.valueCents, 7_000, "despesas do 2º semestre");
    assert.equal(anual.valueCents, 63_000, "70.000 − 7.000");
    assert.equal(custom.valueCents, 30_000);
    assert.equal(partial.status, "unavailable");
    assert.equal(partial.reason, "custom_period_not_month_aligned");
    assert.equal(margem.status, "unavailable");
    assert.equal(margem.reason, "no_receipts");
    assert.match(String(margem.message), /margem não pode ser calculada/);
    // Orçamento de 60 meses distintos por chamada: a meta que estoura fica
    // indisponível sozinha; as outras são calculadas.
    const budget = [
      String((await create(pj, kpiGoal("faturamento", {
        period: "custom", startDate: "2022-01-01", deadline: "2024-12-31",
      }))).goalId),
      String((await create(pj, kpiGoal("faturamento", {
        period: "custom", startDate: "2027-01-01", deadline: "2028-12-31",
      }))).goalId),
      ids.mensal,
      String((await create(pj, kpiGoal("caixa_minimo"))).goalId),
    ];
    const budgeted = (await executeGetGoalKpiProgress(pj, {
      workspaceId: WS_PJ, goalIds: budget,
    }, new Date("2026-09-01T02:30:00.000Z"))).results;
    assert.equal(budgeted[0].status, "ok");
    assert.equal(budgeted[1].status, "ok");
    assert.equal(budgeted[2].status, "unavailable");
    assert.equal((budgeted[2] as {reason: string}).reason, "too_many_periods");
    assert.equal(budgeted[3].status, "ok", "saldo não usa meses");
    // Sozinha (como no detalhe), a mesma meta é calculada.
    const alone = (await executeGetGoalKpiProgress(pj, {
      workspaceId: WS_PJ, goalIds: [ids.mensal],
    }, new Date("2026-09-01T02:30:00.000Z"))).results[0];
    assert.equal(alone.status, "ok");

    // Projeção de caixa marcada para reconstrução: indicadores de período
    // indisponíveis; o saldo das contas continua.
    await db().doc(`workspaces/${WS_PJ}/cash_period_events/projection_state`)
      .set({needsRebuild: true});
    const stale = (await executeGetGoalKpiProgress(pj, {
      workspaceId: WS_PJ, goalIds: [ids.mensal, budget[3]],
    }, new Date("2026-09-01T02:30:00.000Z"))).results;
    assert.equal(stale[0].status, "unavailable");
    assert.equal((stale[0] as {reason: string}).reason,
      "projection_needs_rebuild");
    assert.equal(stale[1].status, "ok");
    await db().doc(`workspaces/${WS_PJ}/cash_period_events/projection_state`)
      .set({needsRebuild: false});
    assert.equal((await executeGetGoalKpiProgress(pj, {
      workspaceId: WS_PJ, goalIds: [ids.mensal],
    }, new Date("2026-09-01T02:30:00.000Z"))).results[0].status, "ok");

    // Limite de metas por chamada e IDs repetidos: recusa na callable.
    await assert.rejects(() => Promise.resolve(getGoalKpiProgress.run(
      callableRequest(OWNER_PJ, {workspaceId: WS_PJ,
        goalIds: Array.from({length: 26}, (_, index) => `g${index}`)}),
    )), isHttps("invalid-argument"));
    await assert.rejects(() => Promise.resolve(getGoalKpiProgress.run(
      callableRequest(OWNER_PJ, {workspaceId: WS_PJ,
        goalIds: [ids.mensal, ids.mensal]}),
    )), isHttps("invalid-argument"));
  });
