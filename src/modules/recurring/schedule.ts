/**
 * Agenda das despesas recorrentes (P4-B, D-12) — espelho da agenda do
 * backend (`functions/src/recurring/schedule.ts`), para a projeção da tela.
 *
 * A autoridade é o backend: é ele que gera as ocorrências. Esta cópia existe
 * para mostrar os próximos vencimentos sem materializar o futuro, e precisa
 * produzir exatamente a mesma sequência — os dois lados são verificados
 * contra os mesmos vetores escritos à mão
 * (`tests/fixtures/recurring-schedule-vectors.json`) e um contra o outro
 * (`tests/unit/recurring-schedule.test.ts`).
 *
 * Aritmética civil pura: datas são chaves `YYYY-MM-DD` e toda conta é feita
 * com o número de dias desde 1970-01-01, em inteiros. Nada de `Date`,
 * `setMonth`, fuso ou `toISOString`. Mês sem o dia de cobrança usa o último
 * dia dele, e o mês seguinte volta ao dia-âncora (31/01 → 28 ou 29/02 →
 * 31/03), sem deriva.
 */
export const RECURRING_FREQUENCIES = [
  'weekly',
  'biweekly',
  'monthly',
  'bimonthly',
  'quarterly',
  'semiannual',
  'annual',
] as const;
export type RecurringFrequency = typeof RECURRING_FREQUENCIES[number];

const DAY_STEPS: Partial<Record<RecurringFrequency, number>> = {
  weekly: 7,
  biweekly: 15,
};

const MONTH_STEPS: Partial<Record<RecurringFrequency, number>> = {
  monthly: 1,
  bimonthly: 2,
  quarterly: 3,
  semiannual: 6,
  annual: 12,
};

/** Frequências ancoradas no dia de cobrança (mensal ou mais longa). */
export const usesBillingDay = (frequency: RecurringFrequency): boolean =>
  MONTH_STEPS[frequency] !== undefined;

export interface ScheduleRule {
  frequency: RecurringFrequency;
  /** 1–31 nas frequências mensais; `null` na semanal e na quinzenal. */
  billingDay: number | null;
  startDate: string;
  endDate: string | null;
}

const DAY_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

interface CivilDate {
  year: number;
  month: number;
  day: number;
}

export const isLeapYear = (year: number): boolean =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

export const daysInMonth = (year: number, month: number): number => {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
};

const parseCivil = (dayKey: string): CivilDate | null => {
  const match = DAY_KEY_PATTERN.exec(dayKey);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return null;
  }
  return {year, month, day};
};

/** `YYYY-MM-DD` válido e existente no calendário. */
export const isCivilDayKey = (value: unknown): value is string =>
  typeof value === 'string' && parseCivil(value) !== null;

const civilOf = (dayKey: string): CivilDate => {
  const civil = parseCivil(dayKey);
  if (!civil) throw new Error(`Data civil inválida: ${dayKey}`);
  return civil;
};

const pad = (value: number, size: number): string =>
  String(value).padStart(size, '0');

const keyOf = ({year, month, day}: CivilDate): string =>
  `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;

/** Dias desde 1970-01-01 (proléptico gregoriano), só com inteiros. */
const daysFromCivil = ({year, month, day}: CivilDate): number => {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (month + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
};

const civilFromDays = (days: number): CivilDate => {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) -
      Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return {year: yoe + era * 400 + (month <= 2 ? 1 : 0), month, day};
};

/** Soma dias corridos a uma data civil. */
export const addCivilDays = (dayKey: string, days: number): string =>
  keyOf(civilFromDays(daysFromCivil(civilOf(dayKey)) + days));

/** Dias corridos de `from` até `to` (negativo se `to` for anterior). */
export const civilDaysBetween = (from: string, to: string): number =>
  daysFromCivil(civilOf(to)) - daysFromCivil(civilOf(from));

/** Índice absoluto de mês (ano × 12 + mês − 1). */
const monthIndexOf = (civil: CivilDate): number =>
  civil.year * 12 + civil.month - 1;

/** Dia de cobrança no mês de índice absoluto, limitado ao último dia. */
const billingDateInMonth = (monthIndex: number, billingDay: number): string => {
  const year = Math.floor(monthIndex / 12);
  const month = monthIndex - year * 12 + 1;
  const day = Math.min(billingDay, daysInMonth(year, month));
  return keyOf({year, month, day});
};

/** Competência `YYYY-MM` de uma data civil. */
export const competenceOf = (dayKey: string): string => dayKey.slice(0, 7);

const assertRule = (rule: ScheduleRule): void => {
  civilOf(rule.startDate);
  if (rule.endDate !== null) civilOf(rule.endDate);
  if (usesBillingDay(rule.frequency)) {
    if (
      rule.billingDay === null ||
      !Number.isSafeInteger(rule.billingDay) ||
      rule.billingDay < 1 ||
      rule.billingDay > 31
    ) {
      throw new Error('Dia de cobrança inválido.');
    }
  } else if (DAY_STEPS[rule.frequency] === undefined) {
    throw new Error(`Frequência inválida: ${String(rule.frequency)}`);
  }
};

/** Mês (índice absoluto) do primeiro vencimento mensal. */
const firstBillingMonth = (rule: ScheduleRule): number => {
  const start = civilOf(rule.startDate);
  const startMonth = monthIndexOf(start);
  const candidate = billingDateInMonth(startMonth, rule.billingDay as number);
  return candidate >= rule.startDate ? startMonth : startMonth + 1;
};

/**
 * Vencimento de índice `n` (0 = primeiro), sem considerar o término.
 * Calculado sempre a partir da âncora.
 */
export const dueDateAt = (rule: ScheduleRule, n: number): string => {
  assertRule(rule);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('Índice inválido.');
  const dayStep = DAY_STEPS[rule.frequency];
  if (dayStep !== undefined) return addCivilDays(rule.startDate, n * dayStep);
  const monthStep = MONTH_STEPS[rule.frequency] as number;
  return billingDateInMonth(firstBillingMonth(rule) + n * monthStep,
    rule.billingDay as number);
};

const withinEnd = (rule: ScheduleRule, dueDate: string): string | null =>
  rule.endDate !== null && dueDate > rule.endDate ? null : dueDate;

/**
 * Primeiro vencimento em `day` ou depois dele, respeitando o término;
 * `null` quando não há mais vencimentos.
 */
export const nextDueOnOrAfter = (
  rule: ScheduleRule,
  day: string,
): string | null => {
  assertRule(rule);
  civilOf(day);
  if (day <= rule.startDate) return withinEnd(rule, dueDateAt(rule, 0));
  const dayStep = DAY_STEPS[rule.frequency];
  if (dayStep !== undefined) {
    const n = Math.ceil(civilDaysBetween(rule.startDate, day) / dayStep);
    return withinEnd(rule, dueDateAt(rule, n));
  }
  const monthStep = MONTH_STEPS[rule.frequency] as number;
  const months = monthIndexOf(civilOf(day)) - firstBillingMonth(rule);
  let n = Math.max(0, Math.floor(months / monthStep));
  // No máximo dois passos: o mês do dia e o seguinte da sequência.
  while (dueDateAt(rule, n) < day) n += 1;
  return withinEnd(rule, dueDateAt(rule, n));
};

/** Primeiro vencimento estritamente depois de `day`. */
export const nextDueAfter = (
  rule: ScheduleRule,
  day: string,
): string | null => nextDueOnOrAfter(rule, addCivilDays(day, 1));

/**
 * Vencimentos em `[from, to]`, em ordem, até `limit` itens. Para a projeção
 * da tela e para os testes; o agendador avança um vencimento por vez.
 */
export const dueDatesBetween = (
  rule: ScheduleRule,
  from: string,
  to: string,
  limit: number,
): string[] => {
  const result: string[] = [];
  let next = nextDueOnOrAfter(rule, from);
  while (next !== null && next <= to && result.length < limit) {
    result.push(next);
    next = nextDueAfter(rule, next);
  }
  return result;
};
