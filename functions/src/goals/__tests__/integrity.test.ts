import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import test from "node:test";

import {RETENTION_DAYS} from "../../shared/retention";

import {
  civilDateSchema,
  createGoalPayloadSchema,
  goalDefinitionSchema,
  MAX_GOAL_CENTS,
  updateGoalManualProgressPayloadSchema,
} from "../contracts";

/**
 * Contrato de entrada das metas (P5-B, D-31): centavos inteiros, datas civis
 * reais, uma fonte de progresso por meta e nenhum campo do modelo anterior.
 * Tudo aqui roda sem Emulator; a autoridade (transação, revisão, vínculo
 * patrimonial) está em `goalsP5b.integration.test.ts`.
 */

const visual = {color: "#6366f1", icon: "Target", progressBarType: "linear"};

const manual = (overrides: Record<string, unknown> = {}) => ({
  name: "Reserva",
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

const issuesOf = (result: {success: boolean; error?: {issues: unknown[]}}) =>
  result.success ? [] : (result.error?.issues ?? []) as {path: string[]}[];

test("data civil: só AAAA-MM-DD existente no calendário", () => {
  for (const valid of ["2026-01-01", "2024-02-29", "2026-12-31"]) {
    assert.equal(civilDateSchema.safeParse(valid).success, true, valid);
  }
  for (const invalid of [
    "2026-02-29", "2026-02-30", "2026-04-31", "2026-13-01", "2026-00-10",
    "2026-1-01", "01/02/2026", "2026-01-01T00:00:00Z", "1899-12-31",
    "3000-01-01", "",
  ]) {
    assert.equal(civilDateSchema.safeParse(invalid).success, false, invalid);
  }
});

test("valores em centavos inteiros e seguros, positivos no alvo", () => {
  const target = (targetAmountCents: unknown) =>
    goalDefinitionSchema.safeParse(manual({targetAmountCents})).success;
  assert.equal(target(1), true);
  assert.equal(target(MAX_GOAL_CENTS), true);
  assert.equal(target(0), false, "alvo zero");
  assert.equal(target(-100), false, "alvo negativo");
  assert.equal(target(10.5), false, "fração de centavo");
  assert.equal(target(MAX_GOAL_CENTS + 1), false, "acima do teto");
  assert.equal(target(Number.MAX_SAFE_INTEGER + 2), false, "inteiro inseguro");
  assert.equal(target("1000"), false, "texto");

  const progress = (manualProgressCents: unknown) =>
    updateGoalManualProgressPayloadSchema.safeParse({
      workspaceId: "ws",
      idempotencyKey: "progress-key-000001",
      goalId: "g1",
      expectedRevision: 1,
      manualProgressCents,
    }).success;
  assert.equal(progress(0), true, "zero é progresso válido");
  assert.equal(progress(123_456), true);
  assert.equal(progress(-1), false);
  assert.equal(progress(0.01), false);
  assert.equal(progress(Number.NaN), false);
});

test("prazo nunca antes do início", () => {
  assert.equal(goalDefinitionSchema.safeParse(
    manual({startDate: "2026-05-02", deadline: "2026-05-01"}),
  ).success, false);
  assert.equal(goalDefinitionSchema.safeParse(
    manual({startDate: "2026-05-01", deadline: "2026-05-01"}),
  ).success, true);
});

test("campos do modelo anterior são recusados (schema estrito)", () => {
  for (const legacy of [
    {targetAmount: 1000}, {currentAmount: 10}, {currentAmountCents: 10},
    {isAutomatic: true}, {status: "em_andamento"},
    {investmentProgressCents: 10}, {manualProgressCents: 10},
  ]) {
    assert.equal(
      goalDefinitionSchema.safeParse(manual(legacy)).success, false,
      JSON.stringify(legacy),
    );
  }
});

test("uma fonte por meta, com os campos que cada fonte exige", () => {
  const ok = (goal: Record<string, unknown>) =>
    goalDefinitionSchema.safeParse(goal).success;
  // Manual: sem base, sem indicador, sem período.
  assert.equal(ok(manual()), true);
  assert.equal(ok(manual({progressBasis: "net_contributions"})), false);
  assert.equal(ok(manual({businessType: "faturamento"})), false);
  assert.equal(ok(manual({period: "mensal"})), false);
  // Investimentos: base obrigatória; tipo só "investimento".
  const investment = manual({progressSource: "investment"});
  assert.equal(ok(investment), false, "sem base");
  assert.equal(ok({...investment, progressBasis: "current_value"}), true);
  assert.equal(ok({...investment, progressBasis: "net_contributions",
    businessType: "investimento"}), true);
  assert.equal(ok({...investment, progressBasis: "net_contributions",
    businessType: "faturamento"}), false);
  assert.equal(ok({...investment, progressBasis: "outra"}), false);
  // Indicador PJ: tipo e período; saldo sem período; margem em pontos-base.
  const kpi = manual({progressSource: "business_kpi"});
  assert.equal(ok(kpi), false, "sem indicador");
  assert.equal(ok({...kpi, businessType: "investimento"}), false);
  assert.equal(ok({...kpi, businessType: "faturamento"}), false, "sem período");
  assert.equal(
    ok({...kpi, businessType: "faturamento", period: "mensal"}), true,
  );
  assert.equal(ok({...kpi, businessType: "lucro", period: "semestral"}), true);
  assert.equal(ok({...kpi, businessType: "caixa_minimo"}), true);
  assert.equal(
    ok({...kpi, businessType: "caixa_minimo", period: "mensal"}), false,
  );
  assert.equal(ok({...kpi, businessType: "reducao_custos", period: "anual",
    progressBasis: "net_contributions"}), false);
  const margin = {
    ...kpi, businessType: "margem", period: "trimestral",
    targetAmountCents: undefined,
  };
  assert.equal(ok(margin), false, "margem sem percentual");
  assert.equal(ok({...margin, targetBasisPoints: 2_500}), true);
  assert.equal(ok({...margin, targetBasisPoints: 10_001}), false);
  assert.equal(ok({...margin, targetBasisPoints: 12.5}), false);
  assert.equal(
    ok({...margin, targetBasisPoints: 2_500, targetAmountCents: 100}), false,
  );
  assert.equal(ok(manual({targetBasisPoints: 100})), false);
});

test("criação: valor manual obrigatório só na meta manual", () => {
  const payload = (goal: Record<string, unknown>, extra = {}) =>
    createGoalPayloadSchema.safeParse({
      workspaceId: "ws", idempotencyKey: "create-key-0000001", goal, ...extra,
    });
  const missing = payload(manual());
  assert.equal(missing.success, false);
  assert.deepEqual(issuesOf(missing).map((issue) => issue.path.join(".")),
    ["manualProgressCents"]);
  const created = payload(manual(), {manualProgressCents: 0});
  assert.equal(created.success, true);
  assert.equal(created.success && created.data.status, "em_andamento");
  assert.equal(payload(
    manual({progressSource: "investment", progressBasis: "current_value"}),
    {manualProgressCents: 10},
  ).success, false);
  assert.equal(payload(manual(), {
    manualProgressCents: 10, archived: true,
  }).success, false, "arquivamento não entra pela criação");
});

test("reserva de idempotência das metas expira por TTL; a trilha não", () => {
  assert.equal(RETENTION_DAYS.idempotencyKeys, 90);
  // lib/goals/__tests__ → raiz do repositório.
  const indexes = JSON.parse(readFileSync(
    resolve(__dirname, "../../../../firestore.indexes.json"),
    "utf8",
  )) as {fieldOverrides: Array<Record<string, unknown>>};
  assert.deepEqual(
    indexes.fieldOverrides.filter((entry) =>
      entry.collectionGroup === "goal_idempotency_keys"),
    [{
      collectionGroup: "goal_idempotency_keys",
      fieldPath: "expiresAt",
      ttl: true,
      indexes: [],
    }],
  );
  // Fato e auditoria nunca expiram.
  for (const group of ["goals", "goal_audit_logs"]) {
    assert.equal(
      indexes.fieldOverrides.some((entry) => entry.collectionGroup === group),
      false,
      group,
    );
  }
});
