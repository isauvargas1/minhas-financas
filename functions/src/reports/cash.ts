import * as admin from "firebase-admin";

import {
  CASH_PERIODS_COLLECTION,
  CASH_PERIOD_SCHEMA_VERSION,
  addCashPeriodDelta,
  cashDaysMatchMonth,
  emptyCashPeriodDelta,
  normalizeCashPeriodDelta,
  readCashDayDeltas,
  type CashDayDeltas,
  type CashPeriodDelta,
} from "../cash/periods";
import {MAX_CASH_PERIODS} from "../cash/rebuild";
import {subtractExact} from "./formulas";
import type {CashReport, SeriesPoint} from "./contract";
import {isDayInMonthSlice, type WindowMonth} from "./window";

/**
 * Caixa realizado da janela (P5-C1, D-37.2/37.7), lido só da projeção
 * oficial `cash_report_periods`: meses inteiros pelo total do mês, meses
 * parciais pela soma dos dias (`days`). Nenhuma transação é lida.
 *
 * Um mês só entra se for da versão 5 e a soma dos dias fechar com o total em
 * todos os campos; senão o bloco inteiro fica "aguardando reconstrução" —
 * nunca um número parcial apresentado como exato (D-37.10).
 */

export interface StoredMonth {
  month: string;
  totals: CashPeriodDelta;
  days: CashDayDeltas;
  /** Versão 5 e Σ dias = total. */
  consistent: boolean;
}

const db = () => admin.firestore();

const periodsRef = (workspaceId: string) =>
  db().collection(`workspaces/${workspaceId}/${CASH_PERIODS_COLLECTION}`);

const MONTH_ID = /^\d{4}-(0[1-9]|1[0-2])$/;

export const readStoredMonth = (
  month: string,
  data: admin.firestore.DocumentData,
): StoredMonth => {
  const totals = normalizeCashPeriodDelta(data);
  const days = readCashDayDeltas(data.days);
  const consistent =
    Number.isSafeInteger(data.schemaVersion) &&
    (data.schemaVersion as number) >= CASH_PERIOD_SCHEMA_VERSION &&
    cashDaysMatchMonth(days, totals);
  return {month, totals, days, consistent};
};

/** Meses pedidos, por ID (janelas limitadas). */
export const readMonths = async (
  workspaceId: string,
  months: readonly string[],
): Promise<Map<string, StoredMonth>> => {
  const result = new Map<string, StoredMonth>();
  if (months.length === 0) return result;
  const snapshots = await db().getAll(
    ...months.map((month) => periodsRef(workspaceId).doc(month)));
  snapshots.forEach((snapshot, index) => {
    if (snapshot.exists) {
      result.set(months[index],
        readStoredMonth(months[index], snapshot.data() ?? {}));
    }
  });
  return result;
};

const isNonZero = (delta: CashPeriodDelta): boolean =>
  Object.values(delta).some((value) => value !== 0);

/**
 * Todos os meses da projeção, para "tudo" (no máximo 600; acima disso a
 * leitura é recusada, nunca truncada). Os documentos de checkpoint da
 * reconstrução não têm `periodStart` e ficam fora da consulta ordenada.
 */
export const readAllMonths = async (
  workspaceId: string,
): Promise<
  | {ok: true; months: Map<string, StoredMonth>; firstMonth: string | null}
  | {ok: false}
> => {
  const snapshot = await periodsRef(workspaceId)
    .orderBy("periodStart")
    .limit(MAX_CASH_PERIODS + 1)
    .get();
  if (snapshot.size > MAX_CASH_PERIODS) return {ok: false};
  const months = new Map<string, StoredMonth>();
  let firstMonth: string | null = null;
  for (const doc of snapshot.docs) {
    if (!MONTH_ID.test(doc.id)) continue;
    const stored = readStoredMonth(doc.id, doc.data());
    months.set(doc.id, stored);
    if (firstMonth === null && isNonZero(stored.totals)) firstMonth = doc.id;
  }
  return {ok: true, months, firstMonth};
};

/** Totais do recorte de um mês: o mês inteiro ou a soma dos dias dele. */
export const sliceTotals = (
  slice: WindowMonth,
  stored: StoredMonth | undefined,
): CashPeriodDelta => {
  if (!stored) return emptyCashPeriodDelta();
  if (slice.full) return stored.totals;
  let total = emptyCashPeriodDelta();
  for (const [dd, delta] of Object.entries(stored.days)) {
    if (isDayInMonthSlice(slice, dd)) {
      total = addCashPeriodDelta(total, normalizeCashPeriodDelta(delta));
    }
  }
  return total;
};

export interface CashWindow {
  consistent: boolean;
  totals: CashPeriodDelta;
  slices: Array<{slice: WindowMonth; totals: CashPeriodDelta}>;
}

/** Soma da janela, mês a mês, com a conferência de consistência. */
export const cashWindowOf = (
  slices: readonly WindowMonth[],
  months: ReadonlyMap<string, StoredMonth>,
): CashWindow => {
  let consistent = true;
  let totals = emptyCashPeriodDelta();
  const result: CashWindow["slices"] = [];
  for (const slice of slices) {
    const stored = months.get(slice.month);
    if (stored && !stored.consistent) consistent = false;
    const sliced = sliceTotals(slice, stored);
    totals = addCashPeriodDelta(totals, sliced);
    result.push({slice, totals: sliced});
  }
  return {consistent, totals, slices: result};
};

/** Bloco de caixa do DTO (D-37.2): componentes separados e fluxo total. */
export const cashReportOf = (totals: CashPeriodDelta): CashReport => ({
  receiptsCents: totals.incomeCents,
  paymentsCents: totals.expenseCents,
  operationalResultCents:
    subtractExact(totals.incomeCents, totals.expenseCents),
  financial: {
    incomeCents: totals.financialIncomeCents,
    expenseCents: totals.financialExpenseCents,
    resultCents: subtractExact(
      totals.financialIncomeCents, totals.financialExpenseCents),
  },
  patrimonial: {
    investmentOutflowCents: totals.investmentOutflowCents,
    investmentInflowCents: totals.investmentInflowCents,
    loanPrincipalInflowCents: totals.loanPrincipalInflowCents,
    loanPrincipalOutflowCents: totals.loanPrincipalOutflowCents,
  },
  cardPaymentsCents: totals.creditCardPaymentCents,
  netFlowCents: totals.netCents,
  transactionCount: totals.transactionCount,
});

export const isZeroCash = (totals: CashPeriodDelta): boolean =>
  !isNonZero(totals);

/** Pontos mensais da série (mês parcial marcado). */
export const seriesPointsOf = (window: CashWindow): SeriesPoint[] =>
  window.slices.map(({slice, totals}) => ({
    month: slice.month,
    startDate: slice.startDate,
    endDate: slice.endDate,
    partial: !slice.full,
    receiptsCents: totals.incomeCents,
    paymentsCents: totals.expenseCents,
    operationalResultCents:
      subtractExact(totals.incomeCents, totals.expenseCents),
    cardPaymentsCents: totals.creditCardPaymentCents,
    netFlowCents: totals.netCents,
  }));
