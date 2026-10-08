/**
 * Calendário de faturas (D-36), espelho puro das regras do backend
 * (`functions/src/cards/model.ts`). Só para exibir e avisar: quem decide a
 * competência, o fechamento e o vencimento é o backend. Sem fuso: aritmética
 * de calendário sobre datas civis de São Paulo.
 */
const pad2 = (value: number): string => String(value).padStart(2, '0');

const isLeapYear = (year: number): boolean =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

export const daysInMonth = (year: number, month: number): number =>
  [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];

export const addMonthsToMonthKey = (monthKey: string, months: number): string => {
  const [year, month] = monthKey.split('-').map(Number);
  const index = year * 12 + (month - 1) + months;
  return `${Math.floor(index / 12)}-${pad2((index % 12) + 1)}`;
};

/** Dia `day` do mês; mês sem esse dia usa o último dia. */
export const clampedDayKey = (monthKey: string, day: number): string => {
  const [year, month] = monthKey.split('-').map(Number);
  return `${monthKey}-${pad2(Math.min(day, daysInMonth(year, month)))}`;
};

export const closingDateOf = (monthKey: string, closingDay: number): string =>
  clampedDayKey(monthKey, closingDay);

/** Primeiro dia de vencimento estritamente depois do fechamento. */
export const dueDateOf = (monthKey: string, closingDay: number, dueDay: number): string => {
  const closing = closingDateOf(monthKey, closingDay);
  const sameMonth = clampedDayKey(monthKey, dueDay);
  return sameMonth > closing ? sameMonth : clampedDayKey(addMonthsToMonthKey(monthKey, 1), dueDay);
};

/** Competência natural: compra no dia do fechamento vai para a seguinte. */
export const naturalCompetenceOf = (dayKey: string, closingDay: number): string => {
  const month = dayKey.slice(0, 7);
  return dayKey < closingDateOf(month, closingDay) ? month : addMonthsToMonthKey(month, 1);
};

/** Primeira competência ainda aberta hoje. */
export const firstOpenCompetence = (today: string, closingDay: number): string =>
  naturalCompetenceOf(today, closingDay);

/**
 * Compra retroativa (D-36): a competência natural da primeira parcela já
 * fechou. Devolve a competência onde o backend publicará as parcelas
 * atrasadas, para o aviso antes de enviar; `null` se não é retroativa.
 */
export const retroactiveTarget = (
  purchaseDate: string,
  today: string,
  closingDay: number,
): string | null => {
  const natural = naturalCompetenceOf(purchaseDate, closingDay);
  const open = firstOpenCompetence(today, closingDay);
  return natural < open ? open : null;
};

/** `AAAA-MM` → `MM/AAAA`. */
export const formatCompetence = (monthKey: string): string =>
  /^\d{4}-\d{2}$/.test(monthKey) ? `${monthKey.slice(5, 7)}/${monthKey.slice(0, 4)}` : '—';

/** Ciclo efetivamente fechado: fechado ou com a data de fechamento alcançada. */
export const isCycleEffectivelyClosed = (
  invoice: { cycleStatus: 'open' | 'closed'; closingDate: string },
  today: string,
): boolean => invoice.cycleStatus === 'closed' || today >= invoice.closingDate;

/** Atraso derivado (nunca gravado): fechada, com saldo, vencimento passado. */
export const isInvoiceOverdue = (
  invoice: { cycleStatus: 'open' | 'closed'; remainingCents: number; dueDate: string },
  today: string,
): boolean => invoice.cycleStatus === 'closed' && invoice.remainingCents > 0 && invoice.dueDate < today;
