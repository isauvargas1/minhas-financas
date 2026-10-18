import * as admin from "firebase-admin";

import {INVESTMENT_COLLECTIONS} from "../investments/paths";
import {MAX_CASH_PERIODS} from "../cash/rebuild";
import {addExact, subtractExact} from "./formulas";
import type {InvestmentsReport, ReportSectionResult} from "./contract";
import type {WindowMonth} from "./window";

/**
 * Investimentos no relatório (P5-C1, D-37.5), só do domínio de
 * investimentos — nunca do espelho de caixa:
 *
 * - patrimônio atual: `investment_summaries/current` (valor atual, custo e
 *   valorização não realizada);
 * - fluxos da janela: `investment_report_periods/{AAAA-MM}`, total do mês
 *   nos meses inteiros e `daily.{AAAA-MM-DD}` nos parciais — aportes,
 *   retiradas de principal, rendimento e perda realizados, taxas e impostos;
 * - evolução: fechamento cumulativo do valor atual em cada mês com período.
 *
 * Um mês só entra se a soma dos dias fechar com o total do mês em todos os
 * fluxos; senão o bloco fica "aguardando reconstrução" (D-37.10).
 */

const FLOW_FIELDS = [
  "contributionCents",
  "redemptionPrincipalCents",
  "realizedGainCents",
  "realizedLossCents",
  "feesCents",
  "taxCents",
] as const;

type FlowField = typeof FLOW_FIELDS[number];
type Flows = Record<FlowField, number>;

const emptyFlows = (): Flows => ({
  contributionCents: 0,
  redemptionPrincipalCents: 0,
  realizedGainCents: 0,
  realizedLossCents: 0,
  feesCents: 0,
  taxCents: 0,
});

const intOrZero = (value: unknown): number =>
  Number.isSafeInteger(value) ? value as number : 0;

const flowsOf = (value: unknown): Flows => {
  const source = (typeof value === "object" && value !== null ?
    value : {}) as Record<string, unknown>;
  const flows = emptyFlows();
  for (const field of FLOW_FIELDS) flows[field] = intOrZero(source[field]);
  return flows;
};

const addFlows = (left: Flows, right: Flows): Flows => {
  const result = emptyFlows();
  for (const field of FLOW_FIELDS) {
    result[field] = addExact(left[field], right[field]);
  }
  return result;
};

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

interface StoredInvestmentMonth {
  month: string;
  totals: Flows;
  daily: Record<string, Flows>;
  closingCents: number;
  consistent: boolean;
}

const readInvestmentMonth = (
  month: string,
  data: admin.firestore.DocumentData,
): StoredInvestmentMonth => {
  const totals = flowsOf(data);
  const daily: Record<string, Flows> = {};
  const rawDaily = (typeof data.daily === "object" && data.daily !== null ?
    data.daily : {}) as Record<string, unknown>;
  let sum = emptyFlows();
  for (const [day, value] of Object.entries(rawDaily)) {
    if (!DAY_KEY.test(day) || day.slice(0, 7) !== month) continue;
    daily[day] = flowsOf(value);
    sum = addFlows(sum, daily[day]);
  }
  return {
    month,
    totals,
    daily,
    closingCents: intOrZero(data.closingCurrentValueCents),
    consistent: FLOW_FIELDS.every((field) => sum[field] === totals[field]),
  };
};

const periodsRef = (workspaceId: string) =>
  admin.firestore().collection(
    `workspaces/${workspaceId}/${INVESTMENT_COLLECTIONS.reportPeriods}`);

export const readInvestmentsSection = async (input: {
  workspaceId: string;
  months: readonly WindowMonth[];
  /** Janela "tudo": lê todos os meses e confere a reconciliação. */
  allTime: boolean;
  /** Lê o patrimônio (`investment_summaries/current`): não para viewer. */
  includePatrimony: boolean;
}): Promise<ReportSectionResult<InvestmentsReport>> => {
  const {workspaceId, months} = input;
  const summaryRef = admin.firestore().doc(
    `workspaces/${workspaceId}/${INVESTMENT_COLLECTIONS.summaries}/current`);

  const stored = new Map<string, StoredInvestmentMonth>();
  let summary: admin.firestore.DocumentData | null = null;
  if (input.allTime) {
    const [summarySnapshot, snapshot] = await Promise.all([
      input.includePatrimony ? summaryRef.get() : Promise.resolve(null),
      periodsRef(workspaceId).orderBy("periodStart")
        .limit(MAX_CASH_PERIODS + 1).get(),
    ]);
    if (snapshot.size > MAX_CASH_PERIODS) {
      return {status: "unavailable", reason: "too_many_periods", data: null};
    }
    summary = summarySnapshot ? summarySnapshot.data() ?? {} : null;
    for (const doc of snapshot.docs) {
      stored.set(doc.id, readInvestmentMonth(doc.id, doc.data()));
    }
  } else {
    const offset = input.includePatrimony ? 1 : 0;
    const refs = [
      ...(input.includePatrimony ? [summaryRef] : []),
      ...months.map((slice) => periodsRef(workspaceId).doc(slice.month)),
    ];
    const snapshots = refs.length > 0 ?
      await admin.firestore().getAll(...refs) : [];
    if (input.includePatrimony) summary = snapshots[0].data() ?? {};
    snapshots.slice(offset).forEach((snapshot, index) => {
      if (snapshot.exists) {
        const month = months[index].month;
        stored.set(month, readInvestmentMonth(month, snapshot.data() ?? {}));
      }
    });
  }

  let flows = emptyFlows();
  const evolution: InvestmentsReport["evolution"] = [];
  for (const slice of months) {
    const month = stored.get(slice.month);
    if (!month) continue;
    if (!month.consistent) {
      return {
        status: "rebuild_needed", reason: "investment_daily_parity",
        data: null,
      };
    }
    if (slice.full) {
      flows = addFlows(flows, month.totals);
    } else {
      for (const [day, dayFlows] of Object.entries(month.daily)) {
        if (day >= slice.startDate && day <= slice.endDate) {
          flows = addFlows(flows, dayFlows);
        }
      }
    }
    evolution.push({month: slice.month, closingValueCents: month.closingCents});
  }

  const patrimony: InvestmentsReport["patrimony"] = summary === null ? null : {
    currentValueCents: intOrZero(summary.currentValueCents),
    costCents: intOrZero(summary.principalCents),
    unrealizedResultCents: intOrZero(summary.unrealizedAppreciationCents),
  };
  const lastClosing = evolution[evolution.length - 1]?.closingValueCents;
  const data: InvestmentsReport = {
    patrimony,
    flows: {
      contributionsCents: flows.contributionCents,
      redemptionsPrincipalCents: flows.redemptionPrincipalCents,
      netContributionsCents:
        subtractExact(flows.contributionCents, flows.redemptionPrincipalCents),
      realizedGainCents: flows.realizedGainCents,
      realizedLossCents: flows.realizedLossCents,
      realizedResultCents:
        subtractExact(flows.realizedGainCents, flows.realizedLossCents),
      feesCents: flows.feesCents,
      taxCents: flows.taxCents,
    },
    evolution: input.includePatrimony ? evolution : null,
    reconciliationDifferenceCents:
      input.allTime && patrimony !== null && lastClosing !== undefined ?
        subtractExact(patrimony.currentValueCents, lastClosing) :
        null,
  };
  const empty = (patrimony === null ||
    (patrimony.currentValueCents === 0 && patrimony.costCents === 0)) &&
    FLOW_FIELDS.every((field) => flows[field] === 0);
  return {status: empty ? "zero" : "exact", data};
};
