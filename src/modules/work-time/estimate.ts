/**
 * Estimativa automática do valor da hora (P5-F.1). Módulo PURO: sem React,
 * sem Firebase, imports com extensão `.ts`.
 *
 *   valor da hora = Σ renda elegível dos meses ÷ Σ horas planejadas dos mesmos meses
 *
 * - **Habitual** (padrão): os últimos N meses completos (N = 1, 3, 6 ou 12;
 *   padrão 3). Meses do começo da janela sem nenhuma renda (antes da primeira
 *   receita) saem da conta; com menos meses que N, a estimativa é provisória;
 *   sem nenhum mês com renda, fica indisponível.
 * - **Mês atual**: a renda já recebida no mês corrente, até a data de
 *   referência do servidor, dividida pelas horas planejadas do mês inteiro.
 *   É sempre marcada como mês incompleto: receita futura não entra.
 *
 * Nada é inventado: sem relatório exato, sem renda ou sem horas, a resposta é
 * "indisponível" com o motivo, e a interface mostra os valores em reais.
 * Tudo é inteiro (centavos e minutos); a conversão final é a da P5-F
 * (`calculation.ts`), com a mesma validação de limites.
 */
import { checkWorkTimeConfig, workTimeHourlyRateCents, type WorkTimeConfig } from './calculation.ts';
import { monthPlan, type MonthPlan, type WorkCalendar } from './calendar.ts';
import type { WorkTimeEstimateMode, WorkTimeHistoryMonths } from './contract.ts';
import { isMonthKey, monthKeyOf, shiftMonthKey } from './dates.ts';
import { applyIncomeExclusions, type BasisMonth, type ExcludedIncomeItem, type MonthReceipts } from './incomeBasis.ts';

export type EstimateUnavailableReason =
  /** A fonte escolhida é PJ e o usuário não confirmou o uso da receita empresarial. */
  | 'business_not_confirmed'
  /** O relatório oficial não veio exato (indisponível, em reconstrução ou truncado). */
  | 'report_unavailable'
  /** Não deu para confirmar se um recebimento desconsiderado da janela foi estornado (B01): nada é mostrado. */
  | 'exclusion_unconfirmed'
  /** Nenhuma renda elegível nos meses da janela. */
  | 'no_income'
  /** A rotina não tem horas nos meses da janela. */
  | 'no_work_minutes'
  /** Rotinas com intervalo se cruzam em algum dia da janela: as horas dependem de onde cai a pausa (`calendar.ts`). */
  | 'ambiguous_routines'
  /**
   * Os únicos dias sem cálculo seguro da janela vêm depois de uma jornada reduzida que pode cortar um horário que
   * passa da meia-noite: as horas deles dependem da parte desse horário que aconteceu (`DayPlan.reducedEve`).
   */
  | 'ambiguous_reduced_eve'
  /** Renda abaixo de R$ 1,00 no período. */
  | 'income_too_low'
  /** Renda acima do limite seguro do período. */
  | 'income_too_high'
  /** Horas acima do limite do período. */
  | 'work_minutes_too_high'
  /** A hora daria menos de R$ 0,01. */
  | 'hourly_rate_too_low';

export type EstimateNote =
  | { kind: 'provisional'; monthsUsed: number; monthsRequested: number }
  | { kind: 'current_month_incomplete'; throughDate: string }
  | { kind: 'business_income' }
  | { kind: 'exclusions_skipped'; months: string[] }
  | { kind: 'exclusions_ignored'; count: number }
  | { kind: 'exclusions_reversed'; count: number }
  | { kind: 'holiday_base_not_covered'; months: string[] }
  | { kind: 'untimed_overlap'; days: number }
  | { kind: 'capped_days'; days: number };

export interface EstimateMonth extends BasisMonth {
  workMinutes: number;
  workDays: number;
  plan: MonthPlan;
}

interface EstimateBase {
  mode: WorkTimeEstimateMode;
  historyMonths: WorkTimeHistoryMonths;
  /** Hoje no fuso oficial, como veio do servidor. */
  referenceDate: string;
  workspaceType: 'PF' | 'PJ';
  /** Meses considerados, do mais antigo ao mais recente. */
  months: EstimateMonth[];
  incomeCents: number;
  workMinutes: number;
  excludedCents: number;
  excludedCount: number;
  notes: EstimateNote[];
}

export type WorkTimeEstimate =
  | (EstimateBase & {
    status: 'ready';
    /** Menos meses que o pedido, ou mês atual incompleto. */
    provisional: boolean;
    hourlyRateCents: number;
    config: WorkTimeConfig;
  })
  | (EstimateBase & { status: 'unavailable'; reason: EstimateUnavailableReason });

export interface EstimateInput {
  mode: WorkTimeEstimateMode;
  historyMonths: WorkTimeHistoryMonths;
  allowBusinessIncome: boolean;
  calendar: WorkCalendar;
  referenceDate: string;
  workspaceType: 'PF' | 'PJ';
  /** Todos os blocos usados vieram com estado `exact` ou `zero`. */
  reportExact: boolean;
  /** Totais oficiais por mês (série do relatório e, se preciso, o 12º mês). */
  receipts: readonly MonthReceipts[];
  excluded: readonly ExcludedIncomeItem[];
}

/** Meses da janela pedida, do mais antigo ao mais recente. */
export const estimateWindowMonths = (
  mode: WorkTimeEstimateMode,
  historyMonths: WorkTimeHistoryMonths,
  referenceDate: string,
): string[] => {
  const current = monthKeyOf(referenceDate);
  if (!isMonthKey(current)) return [];
  if (mode === 'current_month') return [current];
  const months: string[] = [];
  for (let offset = historyMonths; offset >= 1; offset -= 1) {
    const month = shiftMonthKey(current, -offset);
    if (month) months.push(month);
  }
  return months;
};

/**
 * Mês completo que a série do preset `12m` (mês corrente e os 11 anteriores)
 * não traz e que a janela habitual de 12 meses exige, ou `null`.
 */
export const extraMonthNeeded = (
  mode: WorkTimeEstimateMode,
  historyMonths: WorkTimeHistoryMonths,
  currentMonth: string,
): string | null => (mode === 'habitual' && historyMonths === 12 ? shiftMonthKey(currentMonth, -12) : null);

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

const unavailable = (base: EstimateBase, reason: EstimateUnavailableReason): WorkTimeEstimate =>
  ({ ...base, status: 'unavailable', reason });

/** Estimativa a partir do relatório oficial, das exclusões e do calendário. */
export const computeWorkTimeEstimate = (input: EstimateInput): WorkTimeEstimate => {
  const window = estimateWindowMonths(input.mode, input.historyMonths, input.referenceDate);
  const receiptsByMonth = new Map(input.receipts.map((item) => [item.month, item]));
  const notes: EstimateNote[] = [];
  const emptyBase: EstimateBase = {
    mode: input.mode,
    historyMonths: input.historyMonths,
    referenceDate: input.referenceDate,
    workspaceType: input.workspaceType,
    months: [],
    incomeCents: 0,
    workMinutes: 0,
    excludedCents: 0,
    excludedCount: 0,
    notes,
  };

  if (input.workspaceType === 'PJ') {
    if (!input.allowBusinessIncome) return unavailable(emptyBase, 'business_not_confirmed');
    notes.push({ kind: 'business_income' });
  }
  const official = window.map((month) => receiptsByMonth.get(month));
  if (!input.reportExact || window.length === 0 || official.some((item) => item === undefined)) {
    return unavailable(emptyBase, 'report_unavailable');
  }

  // Um recebimento desconsiderado sem o estado de estorno confirmado deixaria a conta incerta: suspensa.
  if (input.excluded.some((item) => item.unconfirmed && item.month !== null && window.includes(item.month))) {
    return unavailable(emptyBase, 'exclusion_unconfirmed');
  }
  const { months: basis, ignored, reversed } = applyIncomeExclusions(official as MonthReceipts[], input.excluded);
  if (ignored > 0) notes.push({ kind: 'exclusions_ignored', count: ignored });
  if (reversed > 0) notes.push({ kind: 'exclusions_reversed', count: reversed });
  const skipped = basis.filter((month) => month.exclusionsSkipped).map((month) => month.month);
  if (skipped.length > 0) notes.push({ kind: 'exclusions_skipped', months: skipped });

  // Habitual: meses do começo da janela antes da primeira renda não contam.
  const firstWithIncome = basis.findIndex((month) => month.eligibleCents !== 0);
  const used = input.mode === 'habitual' && firstWithIncome > 0 ? basis.slice(firstWithIncome) : basis;

  // O primeiro mês usado abre o período: o que começou na véspera dele fica fora (monotonia, B02).
  const months: EstimateMonth[] = used.map((month, index) => {
    const plan = monthPlan(input.calendar, month.month, { periodStart: index === 0 });
    return { ...month, workMinutes: plan.minutes, workDays: plan.workDays, plan };
  });
  // Um dia sem cálculo seguro deixa o mês sem horas: nada é dividido, e nenhum mês (com horas que não
  // valem) vai para a memória de cálculo.
  if (months.some((month) => month.plan.ambiguousDays.length > 0)) {
    const byBreaks = months.some((month) => month.plan.ambiguousDays.length > month.plan.reducedEveDays.length);
    return unavailable(emptyBase, byBreaks ? 'ambiguous_routines' : 'ambiguous_reduced_eve');
  }
  const base: EstimateBase = {
    ...emptyBase,
    months,
    incomeCents: sum(months.map((month) => month.eligibleCents)),
    workMinutes: sum(months.map((month) => month.workMinutes)),
    excludedCents: sum(months.map((month) => month.excludedCents)),
    excludedCount: sum(months.map((month) => month.excludedCount)),
  };

  const uncovered = months.filter((month) => !month.plan.nationalHolidayBaseCovered).map((month) => month.month);
  if (uncovered.length > 0) notes.push({ kind: 'holiday_base_not_covered', months: uncovered });
  const untimed = sum(months.map((month) => month.plan.untimedOverlapDays.length));
  if (untimed > 0) notes.push({ kind: 'untimed_overlap', days: untimed });
  const capped = sum(months.map((month) => month.plan.cappedDays.length));
  if (capped > 0) notes.push({ kind: 'capped_days', days: capped });

  if (firstWithIncome < 0 || base.incomeCents <= 0) return unavailable(base, 'no_income');
  if (base.workMinutes <= 0) return unavailable(base, 'no_work_minutes');

  const config: WorkTimeConfig = { incomeCents: base.incomeCents, workMinutes: base.workMinutes };
  switch (checkWorkTimeConfig(config)) {
    case null:
      break;
    case 'income_too_low':
    case 'income_invalid':
      return unavailable(base, 'income_too_low');
    case 'income_too_high':
      return unavailable(base, 'income_too_high');
    case 'minutes_too_low':
    case 'minutes_invalid':
      return unavailable(base, 'no_work_minutes');
    case 'minutes_too_high':
      return unavailable(base, 'work_minutes_too_high');
    case 'hourly_rate_too_low':
      return unavailable(base, 'hourly_rate_too_low');
  }

  let provisional = false;
  if (input.mode === 'current_month') {
    provisional = true;
    notes.push({ kind: 'current_month_incomplete', throughDate: input.referenceDate });
  } else if (months.length < input.historyMonths) {
    provisional = true;
    notes.push({ kind: 'provisional', monthsUsed: months.length, monthsRequested: input.historyMonths });
  }

  return {
    ...base,
    status: 'ready',
    provisional,
    hourlyRateCents: workTimeHourlyRateCents(config) ?? 0,
    config,
  };
};
