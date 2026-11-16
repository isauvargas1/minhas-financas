/**
 * Datas civis do tempo de trabalho equivalente (P5-F.1). Módulo PURO: sem
 * React, sem Firebase, imports com extensão `.ts` — roda direto no runner do
 * Node.
 *
 * Uma data é o texto `AAAA-MM-DD` do calendário civil, sem hora e sem fuso,
 * como a data `date` dos lançamentos (São Paulo, P5-C2). O cálculo usa
 * aritmética de dias em UTC, que não tem horário de verão: dia civil é dia
 * civil. O intervalo aceito vai de 2000-01-01 a 2099-12-31, o mesmo das
 * gramáticas do documento e das Rules.
 */

export const WORK_TIME_MIN_YEAR = 2000;
export const WORK_TIME_MAX_YEAR = 2099;

const DAY_MS = 86_400_000;
const DATE_SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_SHAPE = /^(\d{4})-(\d{2})$/;

export const isLeapYear = (year: number): boolean =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/** Dias do mês (`month` de 1 a 12). */
export const daysInMonth = (year: number, month: number): number => {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
};

const pad2 = (value: number): string => String(value).padStart(2, '0');

const inYearRange = (year: number): boolean => year >= WORK_TIME_MIN_YEAR && year <= WORK_TIME_MAX_YEAR;

export interface CivilDate {
  year: number;
  month: number;
  day: number;
}

/** Lê `AAAA-MM-DD` real (dia existente no mês) entre 2000 e 2099, ou `null`. */
export const parseCivilDate = (text: unknown): CivilDate | null => {
  if (typeof text !== 'string') return null;
  const match = DATE_SHAPE.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!inYearRange(year) || month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
};

export const isCivilDate = (text: unknown): text is string => parseCivilDate(text) !== null;

export const formatCivilDate = ({ year, month, day }: CivilDate): string =>
  `${year}-${pad2(month)}-${pad2(day)}`;

/** Número do dia (dias desde 1970-01-01), para diferenças e somas. */
export const dayNumber = (date: string): number => {
  const parsed = parseCivilDate(date);
  if (!parsed) throw new RangeError('Data civil inválida.');
  return Math.round(Date.UTC(parsed.year, parsed.month - 1, parsed.day) / DAY_MS);
};

/** Data do número de dia; `null` fora de 2000–2099. */
export const civilDateFromDayNumber = (value: number): string | null => {
  const instant = new Date(value * DAY_MS);
  const year = instant.getUTCFullYear();
  if (!inYearRange(year)) return null;
  return formatCivilDate({ year, month: instant.getUTCMonth() + 1, day: instant.getUTCDate() });
};

/** Soma dias a uma data; `null` quando sai de 2000–2099. */
export const addDays = (date: string, days: number): string | null =>
  civilDateFromDayNumber(dayNumber(date) + days);

/** Dia da semana: 0 = segunda-feira … 6 = domingo (ISO 8601). */
export const weekdayIndex = (date: string): number => {
  // 1970-01-01 foi uma quinta-feira (índice 3).
  const value = dayNumber(date);
  return (((value + 3) % 7) + 7) % 7;
};

/** Mês `AAAA-MM` entre 2000 e 2099. */
export const isMonthKey = (text: unknown): text is string => {
  if (typeof text !== 'string') return false;
  const match = MONTH_SHAPE.exec(text);
  if (!match) return false;
  const month = Number(match[2]);
  return inYearRange(Number(match[1])) && month >= 1 && month <= 12;
};

export const monthKeyOf = (date: string): string => date.slice(0, 7);

const splitMonthKey = (monthKey: string): { year: number; month: number } => {
  if (!isMonthKey(monthKey)) throw new RangeError('Mês inválido.');
  return { year: Number(monthKey.slice(0, 4)), month: Number(monthKey.slice(5, 7)) };
};

/** Mês deslocado de `offset` meses (negativo volta); `null` fora de 2000–2099. */
export const shiftMonthKey = (monthKey: string, offset: number): string | null => {
  const { year, month } = splitMonthKey(monthKey);
  const index = year * 12 + (month - 1) + offset;
  const nextYear = Math.floor(index / 12);
  if (!inYearRange(nextYear)) return null;
  return `${nextYear}-${pad2((index % 12) + 1)}`;
};

export const firstDayOfMonth = (monthKey: string): string => `${monthKey}-01`;

export const lastDayOfMonth = (monthKey: string): string => {
  const { year, month } = splitMonthKey(monthKey);
  return `${monthKey}-${pad2(daysInMonth(year, month))}`;
};

/** Todas as datas do mês, em ordem. */
export const datesOfMonth = (monthKey: string): string[] => {
  const { year, month } = splitMonthKey(monthKey);
  return Array.from({ length: daysInMonth(year, month) }, (_, index) => `${monthKey}-${pad2(index + 1)}`);
};

/** Datas de `start` a `end`, inclusive (vazio quando `end < start`). */
export const datesBetween = (start: string, end: string): string[] => {
  const first = dayNumber(start);
  const last = dayNumber(end);
  const result: string[] = [];
  for (let value = first; value <= last; value += 1) {
    const date = civilDateFromDayNumber(value);
    if (date) result.push(date);
  }
  return result;
};
