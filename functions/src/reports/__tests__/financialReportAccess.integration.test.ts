import assert from "node:assert/strict";
import test, {mock} from "node:test";

// Módulo cru (sem a namespace de getters do `import * as`), para o mock
// substituir `write` onde o logger do kernel o procura.
import functionsLogger = require("firebase-functions/logger");
import {HttpsError} from "firebase-functions/v2/https";

import {
  cashProjectionStateRef,
  readCashProjectionState,
} from "../../cash/periods";
import {executeRebuildCashPeriods} from "../../cash/rebuild";
import {
  executeCreateSimpleInvestment,
  executeWithdrawSimpleInvestment,
} from "../../investments/operationsV2";
import {executeCreateSettingsCatalogItem} from
  "../../settingsCatalog/operations";
import {seedCategory} from "../../settingsCatalog/testSupport/categorySeeds";
import {rateLimitDocumentId} from "../../shared/rateLimit";
import {workspaceMemberRef} from "../../shared/workspaceAuth";
import {
  seedActiveAccount,
  seedMember,
  seedWorkspace,
} from "../../shared/testSupport/kernelTestSupport";
import {call, db, idempotencyKey} from
  "../../workspaces/testSupport/p1TestSupport";
import {FINANCIAL_REPORT_RATE_LIMIT, getFinancialReport} from "../callables";
import type {FinancialReport} from "../contract";
import {
  actorOf,
  createEntry,
  daysAgo,
  exact,
  preset,
  report,
  seedReportTenant,
  sync,
  today,
  updateEntry,
  type ReportTenant,
} from "./reportSupport";

/**
 * P5-C1 — permissões, segurança multi-tenant e reconstrução do relatório.
 *
 * - investimentos na matriz das Rules: fluxos da janela e taxa de aportes
 *   para todo membro (agregado mensal legível por todos, D-15); patrimônio,
 *   evolução patrimonial e reconciliação só para owner/admin/member — para o
 *   viewer vêm `null`;
 * - a callable decide o papel no servidor: sem conta, sem membership, com
 *   membership removido, conta suspensa, workspace arquivado ou de outro
 *   tenant, nada é lido;
 * - limite de frequência;
 * - a reconstrução publica dias e categorias e troca a geração sem mudar
 *   nenhum número.
 */

db();

let requests = 0;

const catalogItem = async (
  tenant: ReportTenant,
  group: string,
  name: string,
  transactionSubtype?: string,
): Promise<string> => {
  const result = await executeCreateSettingsCatalogItem(actorOf(tenant), {
    workspaceId: tenant.workspaceId,
    idempotencyKey: idempotencyKey(),
    group,
    name,
    ...(transactionSubtype ? {transactionSubtype} : {}),
  } as Parameters<typeof executeCreateSettingsCatalogItem>[1],
  `req-rpt-cat-${++requests}`);
  return result.itemId;
};

// Meio-dia de São Paulo de hoje, nunca no futuro: antes do meio-dia (15h
// UTC) vale o instante atual, ainda no mesmo dia civil. A operação de
// investimento recusa `occurredAt` no futuro.
const noonToday = () => new Date(Math.min(
  Date.parse(`${today()}T15:00:00.000Z`), Date.now())).toISOString();

const investmentTenant = async (prefix: string) => {
  const t = await seedReportTenant("PF", prefix);
  const catalog = {
    institutionId: await catalogItem(t, "investment_institution", "Banco X"),
    classId: await catalogItem(t, "investment_class", "Reserva X"),
    typeId: await catalogItem(t, "category", "Renda fixa X", "investimento"),
  };
  return {t, catalog};
};

const invest = async (
  t: ReportTenant,
  catalog: {institutionId: string; classId: string; typeId: string},
  valueCents: number,
) => executeCreateSimpleInvestment(actorOf(t), {
  workspaceId: t.workspaceId,
  idempotencyKey: idempotencyKey(),
  correlationId: `corr-rpt-${idempotencyKey()}`,
  ...catalog,
  description: "Tesouro Selic",
  valueCents,
  settled: true,
  occurredAt: noonToday(),
  cashAccountId: t.accountId,
} as Parameters<typeof executeCreateSimpleInvestment>[1]);

// ------------------------------------------------------- investimentos

test("24 investimentos: aportes e retiradas do domínio, iguais ao caixa; " +
  "aporte não é despesa; taxa de aportes líquidos", async () => {
  const {t, catalog} = await investmentTenant("rpt24");
  await createEntry(t, {type: "receita", amountCents: 200_000});
  const contribution = await invest(t, catalog, 50_000);
  await executeWithdrawSimpleInvestment(actorOf(t), {
    workspaceId: t.workspaceId,
    idempotencyKey: idempotencyKey(),
    correlationId: `corr-rpt-${idempotencyKey()}`,
    positionId: String(contribution.positionId),
    valueCents: 20_000,
    received: true,
    occurredAt: noonToday(),
    cashAccountId: t.accountId,
  } as Parameters<typeof executeWithdrawSimpleInvestment>[1]);
  await sync(t.workspaceId);
  const r = await report(t, preset("7d"));
  const investments = exact(r.investments, "investimentos");
  assert.equal(investments.flows.contributionsCents, 50_000);
  assert.equal(investments.flows.redemptionsPrincipalCents, 20_000);
  assert.equal(investments.flows.netContributionsCents, 30_000);
  assert.equal(investments.patrimony?.currentValueCents, 30_000);
  const cash = exact(r.cash, "caixa");
  assert.equal(cash.paymentsCents, 0, "aporte não é despesa");
  assert.equal(cash.receiptsCents, 200_000, "retirada não é receita");
  assert.equal(cash.patrimonial.investmentOutflowCents,
    investments.flows.contributionsCents, "domínio = espelho de caixa");
  assert.equal(cash.patrimonial.investmentInflowCents,
    investments.flows.redemptionsPrincipalCents);
  assert.equal(exact(r.kpis, "kpis").netContributionRateBasisPoints, 1_500,
    "30.000 ÷ 200.000");
});

/** Mês `AAAA-MM` deslocado em meses inteiros (aritmética sobre a chave). */
const shiftMonth = (monthKey: string, delta: number): string => {
  const [year, monthNumber] = monthKey.split("-").map(Number);
  const index = year * 12 + (monthNumber - 1) + delta;
  return `${Math.floor(index / 12)}-` +
    String(index % 12 + 1).padStart(2, "0");
};

test("24b investimentos: rendimento e perda realizados com o sinal certo, " +
  "mês inteiro pelo total e mês parcial pelos dias; campo ausente é zero",
async () => {
  const t = await seedReportTenant("PF", "rpt24b");
  const current = today().slice(0, 7);
  const twoAgo = shiftMonth(current, -2);
  const lastMonth = shiftMonth(current, -1);
  const periods = db().collection(
    `workspaces/${t.workspaceId}/investment_report_periods`);
  // Agregado do domínio de investimentos (só o backend grava), na forma do
  // produtor: total do mês e `daily` que fecha com ele.
  await Promise.all([
    // Sem o campo de perda: lido como zero, nunca como indisponível.
    periods.doc(twoAgo).set({
      id: twoAgo, workspaceId: t.workspaceId, period: twoAgo,
      realizedGainCents: 3_000,
      daily: {[`${twoAgo}-10`]: {realizedGainCents: 3_000}},
      closingCurrentValueCents: 10_000,
    }),
    periods.doc(lastMonth).set({
      id: lastMonth, workspaceId: t.workspaceId, period: lastMonth,
      realizedGainCents: 0, realizedLossCents: 1_200,
      daily: {[`${lastMonth}-05`]: {realizedLossCents: 1_200}},
      closingCurrentValueCents: 8_800,
    }),
    periods.doc(current).set({
      id: current, workspaceId: t.workspaceId, period: current,
      realizedGainCents: 500, feesCents: 100, taxCents: 50,
      daily: {[today()]: {realizedGainCents: 500, feesCents: 100,
        taxCents: 50}},
      closingCurrentValueCents: 9_300,
    }),
  ]);
  const year = exact((await report(t, preset("12m"))).investments, "12m");
  assert.equal(year.flows.realizedGainCents, 3_500);
  assert.equal(year.flows.realizedLossCents, 1_200,
    "a perda é perda (positiva), nunca ganho negativo");
  assert.equal(year.flows.realizedResultCents, 2_300, "rendimento − perda");
  assert.equal(year.flows.feesCents, 100);
  assert.equal(year.flows.taxCents, 50);
  assert.equal(year.flows.contributionsCents, 0);
  assert.equal(year.flows.redemptionsPrincipalCents, 0,
    "rendimento não é retirada de principal");
  // Evolução: o fechamento de cada mês, não o patrimônio atual.
  assert.deepEqual(year.evolution, [
    {month: twoAgo, closingValueCents: 10_000},
    {month: lastMonth, closingValueCents: 8_800},
    {month: current, closingValueCents: 9_300},
  ]);
  // 7 dias: só o dia de hoje; o dia 5 do mês anterior nunca está em 7 dias
  // contados a partir de um dia do mês seguinte.
  const week = exact((await report(t, preset("7d"))).investments, "7d");
  assert.equal(week.flows.realizedGainCents, 500);
  assert.equal(week.flows.realizedLossCents, 0);
  assert.equal(week.flows.realizedResultCents, 500);
  assert.equal(week.flows.feesCents, 100);
});

test("25 viewer: fluxos de investimento como nas Rules (agregado mensal de " +
  "todo membro, D-15), sem patrimônio nem evolução; member lê tudo",
async () => {
  const {t, catalog} = await investmentTenant("rpt25");
  await createEntry(t, {type: "receita", amountCents: 10_000});
  await invest(t, catalog, 4_000);
  await sync(t.workspaceId);
  const viewer = await report(t, preset("all"),
    {uid: t.viewer, role: "viewer"});
  const member = await report(t, preset("all"),
    {uid: t.member, role: "member"});
  assert.equal(viewer.permissions.investments, false);
  assert.equal(member.permissions.investments, true);
  const viewerInvestments = exact(viewer.investments, "investimentos (viewer)");
  const memberInvestments = exact(member.investments, "investimentos (member)");
  // Patrimônio (`investment_summaries`, fora do viewer nas Rules) não sai.
  assert.equal(viewerInvestments.patrimony, null);
  assert.equal(viewerInvestments.reconciliationDifferenceCents, null);
  assert.equal(memberInvestments.patrimony?.currentValueCents, 4_000);
  assert.equal(memberInvestments.reconciliationDifferenceCents, 0);
  // Fluxos (`investment_report_periods`, legível por todo membro) são os
  // mesmos para os dois papéis.
  assert.deepEqual(viewerInvestments.flows, memberInvestments.flows);
  assert.equal(viewerInvestments.flows.contributionsCents, 4_000);
  // Fechamentos mensais são patrimônio: fora do viewer, como o resumo.
  assert.equal(viewerInvestments.evolution, null);
  const memberEvolution = memberInvestments.evolution ?? [];
  assert.equal(memberEvolution[memberEvolution.length - 1]?.closingValueCents,
    4_000);
  const viewerCash = exact(viewer.cash, "caixa (viewer)");
  assert.equal(viewerCash.patrimonial.investmentOutflowCents, 4_000);
  assert.deepEqual(viewerCash, exact(member.cash, "caixa (member)"));
  assert.equal(exact(viewer.kpis, "kpis").netContributionRateBasisPoints,
    exact(member.kpis, "kpis").netContributionRateBasisPoints);
  assert.equal(exact(viewer.kpis, "kpis").netContributionRateBasisPoints,
    4_000, "4.000 ÷ 10.000");
  assert.equal(exact(viewer.accounts, "contas").totalBalanceCents, 6_000);
});

test("25b investimentos com soma diária divergente do mês: aguardando " +
  "reconstrução; a taxa diz que o motivo são os investimentos", async () => {
  const {t, catalog} = await investmentTenant("rpt25b");
  await createEntry(t, {type: "receita", amountCents: 10_000});
  await invest(t, catalog, 4_000);
  await sync(t.workspaceId);
  const ok = await report(t, preset("7d"));
  assert.equal(exact(ok.investments, "investimentos").flows
    .contributionsCents, 4_000);
  // Total do mês adulterado: Σ daily deixa de fechar com o mês.
  const ref = db().doc(`workspaces/${t.workspaceId}/` +
    `investment_report_periods/${today().slice(0, 7)}`);
  await ref.update({contributionCents: 9_999});
  const r = await report(t, preset("7d"));
  assert.equal(r.investments.status, "rebuild_needed");
  assert.equal(r.investments.reason, "investment_daily_parity");
  assert.equal(r.investments.data, null);
  const kpis = exact(r.kpis, "kpis");
  assert.equal(kpis.netContributionRateBasisPoints, null);
  assert.equal(kpis.netContributionRateReason, "investments_unavailable");
  // O caixa não depende da projeção de investimentos.
  assert.equal(exact(r.cash, "caixa").receiptsCents, 10_000);
});

// --------------------------------------------------- segurança (callable)

const payloadFor = (workspaceId: string) =>
  ({workspaceId, range: {kind: "preset", preset: "30d"}});

const httpsCode = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
    return "ok";
  } catch (error) {
    assert.ok(error instanceof HttpsError, String(error));
    return error.code;
  }
};

test("26 callable: papel decidido no servidor; isolamento entre tenants",
  async () => {
    const a = await seedReportTenant("PF", "rpt26a");
    const b = await seedReportTenant("PF", "rpt26b");
    await createEntry(a, {type: "receita", amountCents: 1_234});
    await sync(a.workspaceId);
    for (const uid of [a.owner, a.admin, a.member, a.viewer]) {
      const result = await call<FinancialReport>(getFinancialReport, uid,
        payloadFor(a.workspaceId));
      assert.equal(exact(result.cash, uid).receiptsCents, 1_234);
    }
    assert.equal(await httpsCode(call(getFinancialReport, null,
      payloadFor(a.workspaceId))), "unauthenticated");
    // Membro de B não lê A, e membro de A não lê B.
    assert.equal(await httpsCode(call(getFinancialReport, b.owner,
      payloadFor(a.workspaceId))), "permission-denied");
    assert.equal(await httpsCode(call(getFinancialReport, a.owner,
      payloadFor(b.workspaceId))), "permission-denied");
    // Membership removido.
    await seedMember(a.workspaceId, a.otherMember, "member", "removed");
    assert.equal(await httpsCode(call(getFinancialReport, a.otherMember,
      payloadFor(a.workspaceId))), "permission-denied");
    // Conta suspensa.
    await seedActiveAccount(a.member, {status: "suspended"});
    assert.notEqual(await httpsCode(call(getFinancialReport, a.member,
      payloadFor(a.workspaceId))), "ok");
    // Papel no payload é recusado (contrato estrito); payload inválido.
    assert.equal(await httpsCode(call(getFinancialReport, a.owner,
      {...payloadFor(a.workspaceId), role: "owner"})), "invalid-argument");
    assert.equal(await httpsCode(call(getFinancialReport, a.owner,
      {workspaceId: a.workspaceId, range: {kind: "preset",
        preset: "1y"}})), "invalid-argument");
    // Viewer pela callable (papel relido no servidor): fluxos sim,
    // patrimônio e evolução não.
    const viewer = await call<FinancialReport>(getFinancialReport, a.viewer,
      payloadFor(a.workspaceId));
    assert.equal(viewer.permissions.investments, false);
    const viewerInvestments = exact(viewer.investments, "investimentos");
    assert.equal(viewerInvestments.patrimony, null);
    assert.equal(viewerInvestments.evolution, null);
    assert.equal(viewerInvestments.reconciliationDifferenceCents, null);
  });

/**
 * Barreira controlada (I07): roda `between` uma única vez, imediatamente
 * antes da próxima transação do Firestore e depois devolve a execução à
 * transação real. Na callable, a primeira transação é a de admissão
 * (releitura do ator + limite de frequência), que vem depois da
 * pré-checagem do kernel (`resolveWorkspaceActor`, sem transação) e antes de
 * qualquer leitura do relatório: a escrita de `between` cai exatamente na
 * janela entre as duas verificações. Nada é simulado além dessa ordem.
 */
/**
 * Barreira do I07: a primeira transação da chamada é a de admissão (a
 * pré-checagem do kernel usa `getAll`, sem transação). A escrita concorrente
 * roda nesse ponto, uma vez só. O papel que a pré-checagem leu é registrado
 * (`getAll` antes da barreira) para provar que ela viu o papel antigo — se
 * um dia surgir transação antes da pré-checagem, a barreira dispara cedo e o
 * teste falha em vez de passar sem exercitar a corrida.
 */
const raceBeforeAdmission = (
  memberPath: string,
  between: () => Promise<void>,
) => {
  type Snapshots =
    Array<{ref: {path: string}; get: (field: string) => unknown}>;
  const firestore = db() as unknown as {
    runTransaction: (...args: unknown[]) => Promise<unknown>;
    getAll: (...args: unknown[]) => Promise<Snapshots>;
  };
  const originalRun = firestore.runTransaction;
  const originalGetAll = firestore.getAll;
  let fired = 0;
  const precheckRoles: unknown[] = [];
  firestore.getAll = (...args: unknown[]) =>
    originalGetAll.apply(firestore, args).then((snapshots) => {
      if (fired === 0) {
        for (const snapshot of snapshots) {
          if (snapshot.ref.path === memberPath) {
            precheckRoles.push(snapshot.get("role"));
          }
        }
      }
      return snapshots;
    });
  firestore.runTransaction = (...args: unknown[]) => {
    firestore.runTransaction = originalRun;
    fired += 1;
    return between().then(() => originalRun.apply(firestore, args));
  };
  return {
    fired: () => fired,
    precheckRoles: () => precheckRoles,
    restore: () => {
      firestore.runTransaction = originalRun;
      firestore.getAll = originalGetAll;
    },
  };
};

test("26b callable: papel rebaixado ou acesso removido entre a " +
  "pré-checagem e a admissão — vale o papel relido, sem dado indevido",
async () => {
  const {t, catalog} = await investmentTenant("rpt26b");
  await createEntry(t, {type: "receita", amountCents: 10_000});
  await invest(t, catalog, 4_000);
  await sync(t.workspaceId);
  const limitRef = (uid: string) => db().doc(
    `workspaces/${t.workspaceId}/rate_limits/` +
    rateLimitDocumentId(FINANCIAL_REPORT_RATE_LIMIT, uid));
  const countOf = async (uid: string): Promise<number> =>
    Number((await limitRef(uid).get()).get("count") ?? 0);

  // Controle, sem corrida: o member lê o patrimônio.
  const control = await call<FinancialReport>(getFinancialReport, t.member,
    payloadFor(t.workspaceId));
  assert.equal(control.permissions.investments, true);
  assert.equal(exact(control.investments, "investimentos (member)")
    .patrimony?.currentValueCents, 4_000);

  // 1. Member na pré-checagem, rebaixado a viewer antes da admissão.
  let countAtBarrier = -1;
  let barrier = raceBeforeAdmission(
    workspaceMemberRef(t.workspaceId, t.member).path, async () => {
      countAtBarrier = await countOf(t.member);
      await seedMember(t.workspaceId, t.member, "viewer");
    });
  let downgraded: FinancialReport;
  const logged: Array<Record<string, unknown>> = [];
  const logSpy = mock.method(functionsLogger, "write",
    (entry: Record<string, unknown>) => {
      logged.push(entry);
    });
  try {
    downgraded = await call<FinancialReport>(getFinancialReport, t.member,
      payloadFor(t.workspaceId));
  } finally {
    barrier.restore();
    logSpy.mock.restore();
  }
  assert.equal(barrier.fired(), 1, "a escrita concorrente aconteceu");
  assert.deepEqual(barrier.precheckRoles(), ["member"],
    "a pré-checagem leu o papel antigo, antes da barreira");
  assert.equal(await countOf(t.member), countAtBarrier + 1,
    "a barreira rodou antes da admissão, que reservou a chamada");
  assert.equal(downgraded.permissions.investments, false,
    "o papel relido (viewer) decide, não o da pré-checagem");
  assert.equal(logged.find((entry) => entry.event === "callable.end")
    ?.actorRole, "viewer", "o log da chamada registra o papel relido");
  const viewerInvestments = exact(downgraded.investments,
    "investimentos (rebaixado)");
  assert.equal(viewerInvestments.patrimony, null);
  assert.equal(viewerInvestments.evolution, null);
  assert.equal(viewerInvestments.reconciliationDifferenceCents, null);
  // Os direitos do viewer em Investimentos ficam (D-15): fluxos e taxa.
  assert.equal(viewerInvestments.flows.contributionsCents, 4_000);
  assert.equal(exact(downgraded.kpis, "kpis").netContributionRateBasisPoints,
    4_000);

  // 2. Admin na pré-checagem, removido antes da admissão: recusa, sem
  // relatório e sem consumo do limite.
  const adminCount = await countOf(t.admin);
  barrier = raceBeforeAdmission(
    workspaceMemberRef(t.workspaceId, t.admin).path, () =>
      seedMember(t.workspaceId, t.admin, "admin", "removed"));
  let code: string;
  try {
    code = await httpsCode(call(getFinancialReport, t.admin,
      payloadFor(t.workspaceId)));
  } finally {
    barrier.restore();
  }
  assert.equal(barrier.fired(), 1, "a remoção aconteceu na janela");
  assert.deepEqual(barrier.precheckRoles(), ["admin"],
    "a pré-checagem leu o admin ativo, antes da remoção");
  assert.equal(code, "permission-denied");
  assert.equal(await countOf(t.admin), adminCount,
    "admissão recusada não consome o limite");
});

test("27 callable: workspace arquivado não é lido", async () => {
  const owner = `rpt27-owner-${Date.now()}`;
  const workspaceId = `rpt27-ws-${Date.now()}`;
  await seedActiveAccount(owner);
  await seedWorkspace({workspaceId, ownerId: owner, type: "PF",
    status: "archived"});
  assert.notEqual(await httpsCode(call(getFinancialReport, owner,
    payloadFor(workspaceId))), "ok");
});

test("28 callable: limite de frequência por usuário e workspace", async () => {
  const t = await seedReportTenant("PF", "rpt28");
  const ref = db().doc(`workspaces/${t.workspaceId}/rate_limits/` +
    rateLimitDocumentId(FINANCIAL_REPORT_RATE_LIMIT, t.owner));
  await call(getFinancialReport, t.owner, payloadFor(t.workspaceId));
  assert.equal((await ref.get()).get("count"), 1, "consumo registrado");
  await ref.set({count: FINANCIAL_REPORT_RATE_LIMIT.limit}, {merge: true});
  // Convenção do kernel: limite atingido é pré-condição, em pt-BR.
  await assert.rejects(
    call(getFinancialReport, t.owner, payloadFor(t.workspaceId)),
    (error: unknown) => error instanceof HttpsError &&
      error.code === "failed-precondition" &&
      /Muitas solicitações em pouco tempo/.test(error.message),
  );
  // Outro usuário do mesmo workspace tem o próprio limite.
  assert.equal(await httpsCode(call(getFinancialReport, t.member,
    payloadFor(t.workspaceId))), "ok");
});

// ----------------------------------------------------------- reconstrução

const rebuildToEnd = async (t: ReportTenant) => {
  for (let call = 0; call < 30; call += 1) {
    const result = await executeRebuildCashPeriods(t.workspaceId, t.owner, {
      workspaceId: t.workspaceId,
      idempotencyKey: `rebuild-${t.workspaceId}`,
      correlationId: "corr-rebuild",
      pageSize: 3,
      reason: "teste do relatório",
      dryRun: false,
    });
    if (result.completed === true) return result;
  }
  assert.fail("a reconstrução não concluiu");
};

const comparable = (r: FinancialReport) => ({
  cash: r.cash,
  kpis: r.kpis,
  series: r.series,
  categories: r.categories,
});

test("29 reconstrução publica dias e categorias e troca a geração sem " +
  "mudar números", async () => {
  const t = await seedReportTenant("PF", "rpt29");
  const moradia = await seedCategory(t.workspaceId,
    {name: "Moradia", subtype: "despesa"});
  await createEntry(t, {type: "receita", amountCents: 90_000,
    date: daysAgo(40)});
  await createEntry(t, {type: "despesa", amountCents: 10_000,
    date: daysAgo(3)});
  const moved = await createEntry(t, {type: "despesa", amountCents: 5_000,
    date: daysAgo(20)});
  await updateEntry(t, moved, {date: daysAgo(1), categoryId: moradia});
  await sync(t.workspaceId);
  const before = await report(t, preset("90d"));
  assert.equal(before.categories.status, "exact");
  await rebuildToEnd(t);
  const state = readCashProjectionState(
    await cashProjectionStateRef(t.workspaceId).get());
  assert.notEqual(state.categoryGeneration, "g0", "geração trocada");
  assert.equal(state.categoryStaging, null);
  const after = await report(t, preset("90d"));
  assert.deepEqual(comparable(after), comparable(before),
    "reconstrução idêntica ao incremental");
  // Geração descartada é limpa: nada de "g0" sobra depois da próxima rodada.
  await rebuildToEnd(t);
  const leftovers = await db()
    .collection(`workspaces/${t.workspaceId}/cash_category_years`)
    .where("generation", "==", "g0").get();
  assert.equal(leftovers.size, 0);
  assert.deepEqual(comparable(await report(t, preset("90d"))),
    comparable(before));
});

test("30 reconstrução com escrita depois do corte: entra uma vez nos " +
  "dias e nas categorias", async () => {
  const t = await seedReportTenant("PF", "rpt30");
  for (let index = 0; index < 4; index += 1) {
    await createEntry(t, {type: "despesa", amountCents: 1_000 + index,
      date: daysAgo(index)});
  }
  await sync(t.workspaceId);
  // Primeira página (checkpoint e corte), depois uma escrita nova.
  await executeRebuildCashPeriods(t.workspaceId, t.owner, {
    workspaceId: t.workspaceId,
    idempotencyKey: `rebuild-${t.workspaceId}`,
    correlationId: "corr-rebuild",
    pageSize: 2,
    reason: "teste do relatório",
    dryRun: false,
  });
  await createEntry(t, {type: "despesa", amountCents: 50_000,
    date: daysAgo(2)});
  await sync(t.workspaceId);
  await rebuildToEnd(t);
  const r = await report(t, preset("7d"));
  assert.equal(exact(r.cash, "caixa").paymentsCents,
    1_000 + 1_001 + 1_002 + 1_003 + 50_000);
  const expense = exact(r.categories, "categorias").expense;
  assert.equal(expense.length, 1);
  assert.equal(expense[0].amountCents, 54_006);
  assert.equal(expense[0].transactionCount, 5);
});
