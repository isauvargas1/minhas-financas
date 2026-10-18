import {addDaysToDayKey, isDayKey} from "../shared/dateKeys";
import type {ReportPeriod, ReportRange} from "./contract";

/**
 * Janela civil do relatório (P5-C1, D-37.7), resolvida no servidor a partir
 * de "hoje" em `America/Sao_Paulo`. As duas pontas são **inclusivas**.
 *
 * - `7d`, `30d`, `90d`: exatamente 7, 30 e 90 datas civis, contando hoje
 *   (hoje − 6 … hoje; hoje − 29 … hoje; hoje − 89 … hoje).
 * - `12m`: o mês corrente e os 11 meses anteriores inteiros (do dia 1 do mês
 *   de 11 meses atrás até hoje) — janela móvel por mês, documentada.
 * - `ytd`: 1º de janeiro do ano corrente até hoje.
 * - `all`: do primeiro dia do mês mais antigo da projeção até hoje (a
 *   projeção tem no máximo 600 meses).
 * - mês `AAAA-MM`: do dia 1 ao último dia do mês, limitado a hoje; mês que
 *   ainda não começou é `future` (nada realizado por definição).
 *
 * Nenhum valor mensal é rateado: meses inteiros usam o total do mês e meses
 * parciais somam os dias da projeção diária.
 */

const pad = (value: number, size = 2): string =>
  String(value).padStart(size, "0");

export const lastDayOfMonth = (month: string): number => {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
};

export const monthEndKey = (month: string): string =>
  `${month}-${pad(lastDayOfMonth(month))}`;

const nextMonth = (month: string): string => {
  const [year, monthNumber] = month.split("-").map(Number);
  return monthNumber === 12 ?
    `${pad(year + 1, 4)}-01` :
    `${pad(year, 4)}-${pad(monthNumber + 1)}`;
};

export const shiftMonth = (month: string, delta: number): string => {
  const [year, monthNumber] = month.split("-").map(Number);
  const index = year * 12 + (monthNumber - 1) + delta;
  return `${pad(Math.floor(index / 12), 4)}-${pad((index % 12) + 1)}`;
};

/** Datas civis entre duas pontas, inclusivas. */
export const dayCountBetween = (start: string, end: string): number => {
  const toUtc = (day: string) => {
    const [y, m, d] = day.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(end) - toUtc(start)) / 86_400_000) + 1;
};

/** Um mês da janela, com o recorte de dias que entra. */
export interface WindowMonth {
  month: string;
  startDate: string;
  endDate: string;
  /** O mês inteiro está na janela: vale o total do mês. */
  full: boolean;
}

export interface ResolvedWindow {
  period: ReportPeriod;
  months: WindowMonth[];
}

/** Meses da janela `[start, end]`, com o recorte de cada um. */
export const windowMonths = (start: string, end: string): WindowMonth[] => {
  if (start > end) return [];
  const months: WindowMonth[] = [];
  let month = start.slice(0, 7);
  const last = end.slice(0, 7);
  for (;;) {
    const first = `${month}-01`;
    const monthEnd = monthEndKey(month);
    const startDate = start > first ? start : first;
    const endDate = end < monthEnd ? end : monthEnd;
    months.push({
      month,
      startDate,
      endDate,
      full: startDate === first && endDate === monthEnd,
    });
    if (month === last) break;
    month = nextMonth(month);
  }
  return months;
};

const PRESET_DAYS: Record<"7d" | "30d" | "90d", number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

/**
 * Resolve a janela. `firstMonth` é o mês mais antigo da projeção (só para
 * `all`; `null` quando não há nenhum dado).
 */
export const resolveReportWindow = (
  range: ReportRange,
  today: string,
  firstMonth: string | null = null,
): ResolvedWindow => {
  if (!isDayKey(today)) {
    throw new Error(`Data de referência inválida: ${today}`);
  }
  const build = (start: string | null, end: string, future = false) => ({
    period: {
      range,
      startDate: start,
      endDate: end,
      boundaries: "inclusive" as const,
      dayCount: start === null || future ? 0 : dayCountBetween(start, end),
      future,
    },
    months: start === null || future ? [] : windowMonths(start, end),
  });
  if (range.kind === "month") {
    const first = `${range.month}-01`;
    const monthEnd = monthEndKey(range.month);
    if (first > today) return build(first, monthEnd, true);
    return build(first, monthEnd < today ? monthEnd : today);
  }
  switch (range.preset) {
  case "7d":
  case "30d":
  case "90d":
    return build(addDaysToDayKey(today, -(PRESET_DAYS[range.preset] - 1)),
      today);
  case "12m":
    return build(`${shiftMonth(today.slice(0, 7), -11)}-01`, today);
  case "ytd":
    return build(`${today.slice(0, 4)}-01-01`, today);
  case "all":
    if (firstMonth === null || `${firstMonth}-01` > today) {
      return build(null, today);
    }
    return build(`${firstMonth}-01`, today);
  }
};

/** Dias `DD` de um mês dentro do recorte `[startDate, endDate]`. */
export const isDayInMonthSlice = (
  slice: WindowMonth,
  dd: string,
): boolean => {
  const day = `${slice.month}-${dd}`;
  return day >= slice.startDate && day <= slice.endDate;
};
