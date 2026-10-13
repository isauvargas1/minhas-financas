import * as admin from "firebase-admin";
import {AggregateField} from "firebase-admin/firestore";

import {CASH_ACCOUNTS_COLLECTION} from "../accounts/model";
import {
  CASH_PERIODS_COLLECTION,
  cashProjectionStateRef,
  readCashProjectionState,
} from "../cash/periods";
import {saoPauloDayKey} from "../shared/dateKeys";
import {ApplicationError} from "../shared/errors";
import type {WorkspaceActor} from "../shared/workspaceAuth";
import {
  addExact,
  marginBasisPoints,
  sumPeriods,
  type PeriodTotals,
} from "../reports/formulas";
import type {
  BusinessKpiType,
  GetGoalKpiProgressPayload,
  GoalPeriod,
} from "./contracts";

/**
 * Indicadores das metas PJ automáticas (P5-B, D-31.3), calculados no servidor
 * sobre fontes oficiais, em regime de caixa realizado:
 *
 * - recebimentos e despesas operacionais: `cash_report_periods/{AAAA-MM}`
 *   (`incomeCents`, `expenseCents`). A projeção já exclui pendentes e
 *   agendados, principal de empréstimo (`loanPrincipal*`), juros e
 *   rendimentos (`financial*`), pagamento de fatura (`creditCardPaymentCents`)
 *   e aportes/retiradas de investimento — e cada recebimento entra uma vez,
 *   pelo espelho do recebível. Compras no cartão são reconhecidas no domínio
 *   de cartões e não entram aqui: o tratamento delas nos indicadores é da
 *   D-37 (P5-C).
 * - saldo disponível em contas: soma de `cash_accounts.balanceCents` (o mesmo
 *   "Saldo geral" da tela de contas), saldo atual e não fluxo do mês; contas
 *   negativas entram com o sinal.
 *
 * Períodos no calendário civil de São Paulo. O período personalizado só é
 * calculado quando cobre meses inteiros: a projeção é mensal, e uma janela
 * parcial exigiria dados diários que a fonte oficial não tem — nesse caso o
 * resultado é "indisponível", nunca uma estimativa apresentada como exata.
 * Pelo mesmo motivo, enquanto a projeção de caixa estiver marcada para
 * reconstrução (`needsRebuild`), os indicadores que dependem dela ficam
 * indisponíveis: a fonte pode estar divergente.
 */

/** Meses lidos por meta (36 = três anos) e por chamada. */
export const MAX_KPI_MONTHS = 36;
export const MAX_KPI_MONTHS_PER_CALL = 60;

export interface KpiWindow {
  startDate: string;
  endDate: string;
  months: string[];
}

export type KpiWindowResult =
  | {ok: true; window: KpiWindow}
  | {ok: false; reason: string; message: string};

const pad = (value: number) => String(value).padStart(2, "0");

const lastDayOfMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

const monthKeysBetween = (
  startYear: number,
  startMonth: number,
  endYear: number,
  endMonth: number,
): string[] => {
  const keys: string[] = [];
  let year = startYear;
  let month = startMonth;
  while (year < endYear || (year === endYear && month <= endMonth)) {
    keys.push(`${year}-${pad(month)}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    if (keys.length > MAX_KPI_MONTHS) break;
  }
  return keys;
};

const windowOf = (
  startYear: number,
  startMonth: number,
  endYear: number,
  endMonth: number,
): KpiWindow => ({
  startDate: `${startYear}-${pad(startMonth)}-01`,
  endDate:
    `${endYear}-${pad(endMonth)}-${pad(lastDayOfMonth(endYear, endMonth))}`,
  months: monthKeysBetween(startYear, startMonth, endYear, endMonth),
});

/**
 * Janela do indicador. Mensal, trimestral, semestral e anual: o período civil
 * corrente em São Paulo (`todayKey`). Personalizado: de `startDate` a
 * `deadline`, se e só se cobrirem meses inteiros e no máximo 36 meses.
 */
export const kpiWindowFor = (
  goal: {period?: GoalPeriod; startDate: string; deadline: string},
  todayKey: string,
): KpiWindowResult => {
  const [year, month] = todayKey.split("-").map(Number);
  switch (goal.period) {
  case "mensal":
    return {ok: true, window: windowOf(year, month, year, month)};
  case "trimestral": {
    const first = Math.floor((month - 1) / 3) * 3 + 1;
    return {ok: true, window: windowOf(year, first, year, first + 2)};
  }
  case "semestral": {
    const first = month <= 6 ? 1 : 7;
    return {ok: true, window: windowOf(year, first, year, first + 5)};
  }
  case "anual":
    return {ok: true, window: windowOf(year, 1, year, 12)};
  case "custom": {
    const [sy, sm, sd] = goal.startDate.split("-").map(Number);
    const [ey, em, ed] = goal.deadline.split("-").map(Number);
    if (sd !== 1 || ed !== lastDayOfMonth(ey, em)) {
      return {
        ok: false,
        reason: "custom_period_not_month_aligned",
        message: "O período personalizado precisa começar no primeiro dia e " +
          "terminar no último dia de um mês para ser calculado com exatidão.",
      };
    }
    const window = windowOf(sy, sm, ey, em);
    if (window.months.length > MAX_KPI_MONTHS) {
      return {
        ok: false,
        reason: "period_too_long",
        message: "O período personalizado passa de 36 meses e não pode ser " +
          "calculado.",
      };
    }
    return {ok: true, window};
  }
  default:
    return {
      ok: false,
      reason: "period_missing",
      message: "A meta não tem período de indicador definido.",
    };
  }
};

/*
 * Fórmulas compartilhadas com o relatório financeiro (P5-C1): uma definição
 * por indicador. Reexportadas aqui para os consumidores das metas.
 */
export {marginBasisPoints, sumPeriods};
export type {PeriodTotals};

export type GoalKpiResult =
  | {
      goalId: string;
      status: "ok";
      businessType: Exclude<BusinessKpiType, "margem" | "caixa_minimo">;
      unit: "cents";
      valueCents: number;
      window: {startDate: string; endDate: string};
      components: {receiptsCents: number; expensesCents: number};
    }
  | {
      goalId: string;
      status: "ok";
      businessType: "margem";
      unit: "basis_points";
      valueBasisPoints: number;
      window: {startDate: string; endDate: string};
      components: {receiptsCents: number; expensesCents: number};
    }
  | {
      goalId: string;
      status: "ok";
      businessType: "caixa_minimo";
      unit: "cents";
      valueCents: number;
      asOf: string;
    }
  | {goalId: string; status: "unavailable"; reason: string; message: string};

const unavailable = (
  goalId: string,
  reason: string,
  message: string,
): GoalKpiResult => ({goalId, status: "unavailable", reason, message});

const KPI_TYPES = new Set<string>([
  "faturamento", "lucro", "margem", "caixa_minimo", "reducao_custos",
]);

/**
 * Avaliação pura de uma meta, dados a janela, os totais mensais e o saldo
 * das contas. Sem leitura: testável sem Emulator.
 */
export const evaluateGoalKpi = (
  goalId: string,
  goal: admin.firestore.DocumentData | undefined,
  context: {
    todayKey: string;
    periods: ReadonlyMap<string, PeriodTotals>;
    accountsBalanceCents: number | null;
    asOf: string;
    /** Projeção de caixa marcada para reconstrução (`needsRebuild`). */
    periodsNeedRebuild?: boolean;
  },
): GoalKpiResult => {
  if (!goal) return unavailable(goalId, "not_found", "Meta não encontrada.");
  if (
    goal.progressSource !== "business_kpi" ||
    !KPI_TYPES.has(goal.businessType)
  ) {
    return unavailable(
      goalId, "not_business_kpi",
      "Esta meta não é medida por indicador empresarial.",
    );
  }
  const businessType = goal.businessType as BusinessKpiType;
  if (businessType === "caixa_minimo") {
    if (context.accountsBalanceCents === null) {
      return unavailable(goalId, "accounts_unavailable",
        "Não foi possível ler o saldo das contas.");
    }
    return {
      goalId, status: "ok", businessType, unit: "cents",
      valueCents: context.accountsBalanceCents, asOf: context.asOf,
    };
  }
  const windowResult = kpiWindowFor(
    {period: goal.period, startDate: goal.startDate, deadline: goal.deadline},
    context.todayKey,
  );
  if (!windowResult.ok) {
    return unavailable(goalId, windowResult.reason, windowResult.message);
  }
  if (context.periodsNeedRebuild) {
    return unavailable(
      goalId, "projection_needs_rebuild",
      "Os totais de caixa precisam ser reconciliados; o indicador fica " +
        "indisponível até a reconciliação terminar.",
    );
  }
  const {window} = windowResult;
  const components = sumPeriods(window.months, context.periods);
  const resultCents =
    addExact(components.receiptsCents, -components.expensesCents);
  const windowDates = {startDate: window.startDate, endDate: window.endDate};
  switch (businessType) {
  case "faturamento":
    return {
      goalId, status: "ok", businessType, unit: "cents",
      valueCents: components.receiptsCents, window: windowDates, components,
    };
  case "lucro":
    return {
      goalId, status: "ok", businessType, unit: "cents",
      valueCents: resultCents, window: windowDates, components,
    };
  case "reducao_custos":
    return {
      goalId, status: "ok", businessType, unit: "cents",
      valueCents: components.expensesCents, window: windowDates, components,
    };
  case "margem": {
    const basisPoints =
      marginBasisPoints(resultCents, components.receiptsCents);
    if (basisPoints === null) {
      return unavailable(
        goalId, "no_receipts",
        "Sem recebimentos operacionais no período: a margem não pode ser " +
          "calculada.",
      );
    }
    if (!Number.isSafeInteger(basisPoints)) {
      return unavailable(
        goalId, "margin_out_of_range",
        "A margem do período está fora do intervalo que pode ser calculado.",
      );
    }
    return {
      goalId, status: "ok", businessType, unit: "basis_points",
      valueBasisPoints: basisPoints, window: windowDates, components,
    };
  }
  }
};

const db = () => admin.firestore();

const readPeriodTotals = (
  data: admin.firestore.DocumentData | undefined,
): PeriodTotals => {
  const incomeCents = data?.incomeCents ?? 0;
  const expenseCents = data?.expenseCents ?? 0;
  if (
    !Number.isSafeInteger(incomeCents) ||
    !Number.isSafeInteger(expenseCents)
  ) {
    throw new ApplicationError(
      "internal",
      "A projeção de caixa do período está fora do formato esperado.",
    );
  }
  return {incomeCents, expenseCents};
};

/**
 * Indicadores de até 25 metas numa chamada (uma página do painel). Leituras
 * limitadas: as metas pedidas, os meses distintos das janelas (até 60) e uma
 * agregação de saldo das contas, só se alguma meta for de saldo.
 */
export const executeGetGoalKpiProgress = async (
  actor: WorkspaceActor,
  payload: GetGoalKpiProgressPayload,
  now: Date = new Date(),
): Promise<{results: GoalKpiResult[]}> => {
  const workspaceRef = db().doc(`workspaces/${actor.workspaceId}`);
  const goalSnapshots = await db().getAll(
    ...payload.goalIds.map((goalId) =>
      workspaceRef.collection("goals").doc(goalId)),
  );
  const todayKey = saoPauloDayKey(now);
  const goals = goalSnapshots.map((snapshot) => {
    const data = snapshot.exists ? snapshot.data() : undefined;
    return data?.workspaceId === actor.workspaceId ? data : undefined;
  });

  // Orçamento de meses lidos por chamada: cada meta entra na ordem pedida
  // enquanto os meses distintos couberem; a que estourar fica indisponível
  // sozinha (aberta no detalhe, cabe), sem derrubar as demais.
  const monthSet = new Set<string>();
  const overBudget = new Set<number>();
  let needsAccounts = false;
  let needsPeriods = false;
  goals.forEach((goal, index) => {
    if (goal?.progressSource !== "business_kpi") return;
    if (goal.businessType === "caixa_minimo") {
      needsAccounts = true;
      return;
    }
    const window = kpiWindowFor(
      {period: goal.period, startDate: goal.startDate, deadline: goal.deadline},
      todayKey,
    );
    if (!window.ok) return;
    const fresh = window.window.months.filter((month) => !monthSet.has(month));
    if (monthSet.size + fresh.length > MAX_KPI_MONTHS_PER_CALL) {
      overBudget.add(index);
      return;
    }
    needsPeriods = true;
    for (const month of fresh) monthSet.add(month);
  });
  const months = [...monthSet].sort();
  const periods = new Map<string, PeriodTotals>();
  let periodsNeedRebuild = false;
  if (needsPeriods) {
    const [stateSnapshot, ...periodSnapshots] = await db().getAll(
      cashProjectionStateRef(actor.workspaceId),
      ...months.map((month) =>
        workspaceRef.collection(CASH_PERIODS_COLLECTION).doc(month)),
    );
    periodsNeedRebuild = stateSnapshot.exists &&
      readCashProjectionState(stateSnapshot).needsRebuild;
    periodSnapshots.forEach((snapshot, index) => {
      if (snapshot.exists) {
        periods.set(months[index], readPeriodTotals(snapshot.data()));
      }
    });
  }

  let accountsBalanceCents: number | null = null;
  if (needsAccounts) {
    const aggregate = await workspaceRef
      .collection(CASH_ACCOUNTS_COLLECTION)
      .aggregate({total: AggregateField.sum("balanceCents")})
      .get();
    const total = aggregate.data().total ?? 0;
    accountsBalanceCents = Number.isSafeInteger(total) ? (total || 0) : null;
  }
  const asOf = now.toISOString();
  return {
    results: payload.goalIds.map((goalId, index) => overBudget.has(index) ?
      unavailable(
        goalId, "too_many_periods",
        "Metas demais com períodos diferentes nesta página. Abra a meta " +
          "para ver o indicador.",
      ) :
      evaluateGoalKpi(goalId, goals[index], {
        todayKey, periods, accountsBalanceCents, asOf, periodsNeedRebuild,
      })),
  };
};

/**
 * Contagem exata das metas ativas por status, no servidor (agregação
 * `count`, que lê entradas de índice e não documentos). Os contadores do
 * painel não dependem da página carregada.
 */
export const executeGetGoalsOverview = async (
  actor: WorkspaceActor,
): Promise<{activeCount: number; byStatus: Record<string, number>}> => {
  const goals = db().collection(`workspaces/${actor.workspaceId}/goals`)
    .where("archived", "==", false);
  const statuses =
    ["em_andamento", "alcancada", "pausada", "cancelada"] as const;
  const [active, ...byStatus] = await Promise.all([
    goals.count().get(),
    ...statuses.map((status) =>
      goals.where("status", "==", status).count().get()),
  ]);
  return {
    activeCount: active.data().count,
    byStatus: Object.fromEntries(
      statuses.map((status, index) => [status, byStatus[index].data().count]),
    ),
  };
};
