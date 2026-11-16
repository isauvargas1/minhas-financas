/**
 * Feriados do calendário de trabalho (P5-F.1). Módulo PURO: sem React, sem
 * Firebase, imports com extensão `.ts`.
 *
 * Automáticos são só os feriados NACIONAIS declarados em lei federal, cada um
 * com a lei e o primeiro ano de vigência na base:
 *
 * - Lei nº 662/1949, art. 1º, na redação da Lei nº 10.607/2002 (D.O.U. de
 *   20/12/2002): 1º de janeiro, 21 de abril, 1º de maio, 7 de setembro,
 *   2 de novembro, 15 de novembro e 25 de dezembro. Na base, a partir de 2003.
 * - Lei nº 6.802/1980: 12 de outubro (Nossa Senhora Aparecida). Na base, a
 *   partir de 2003, o início da base.
 * - Lei nº 14.759/2023 (D.O.U. de 22/12/2023): 20 de novembro (Dia Nacional
 *   de Zumbi e da Consciência Negra), a partir de 2024.
 *
 * Fora da base automática, de propósito:
 * - Sexta-feira da Paixão: feriado religioso declarado em lei municipal
 *   (Lei nº 9.093/1995, art. 2º), não nacional.
 * - Carnaval, Quarta-feira de Cinzas e Corpus Christi: pontos facultativos
 *   federais, que nunca são automáticos.
 * - Feriados estaduais e municipais: não há fonte oficial verificável
 *   integrada; o usuário os cadastra em "Feriados locais". A interface mostra
 *   essa limitação de cobertura.
 *
 * As datas móveis (Páscoa e derivadas) são calculadas pelo algoritmo
 * gregoriano anônimo (Meeus/Jones/Butcher) e só entram no calendário quando o
 * usuário as inclui como feriado local.
 */
import { WORK_TIME_MAX_YEAR, WORK_TIME_MIN_YEAR, addDays, formatCivilDate, parseCivilDate, weekdayIndex } from './dates.ts';

/** Primeiro ano coberto pela base de feriados nacionais. */
export const NATIONAL_HOLIDAY_BASE_FROM = 2003;
/** Data da conferência das leis da base (busca nos textos oficiais reproduzidos). */
export const NATIONAL_HOLIDAY_BASE_CHECKED_AT = '2026-11-04';

export interface NationalHolidayRule {
  month: number;
  day: number;
  name: string;
  law: string;
  /** Primeiro ano em que a data é feriado nesta base. */
  fromYear: number;
}

const LEI_662 = 'Lei nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)';

export const NATIONAL_HOLIDAY_RULES: readonly NationalHolidayRule[] = [
  { month: 1, day: 1, name: 'Confraternização Universal', law: LEI_662, fromYear: 2003 },
  { month: 4, day: 21, name: 'Tiradentes', law: LEI_662, fromYear: 2003 },
  { month: 5, day: 1, name: 'Dia do Trabalho', law: LEI_662, fromYear: 2003 },
  { month: 9, day: 7, name: 'Independência do Brasil', law: LEI_662, fromYear: 2003 },
  { month: 10, day: 12, name: 'Nossa Senhora Aparecida', law: 'Lei nº 6.802/1980', fromYear: 2003 },
  { month: 11, day: 2, name: 'Finados', law: LEI_662, fromYear: 2003 },
  { month: 11, day: 15, name: 'Proclamação da República', law: LEI_662, fromYear: 2003 },
  { month: 11, day: 20, name: 'Dia Nacional de Zumbi e da Consciência Negra', law: 'Lei nº 14.759/2023', fromYear: 2024 },
  { month: 12, day: 25, name: 'Natal', law: LEI_662, fromYear: 2003 },
];

export interface HolidayInfo {
  name: string;
  source: 'national' | 'local';
  /** Lei federal do feriado nacional; ausente no feriado local. */
  law?: string;
}

/** O ano está coberto pela base de feriados nacionais. */
export const isNationalHolidayBaseCovered = (year: number): boolean => year >= NATIONAL_HOLIDAY_BASE_FROM;

/** Feriado nacional da data, ou `null` (também fora da cobertura da base). */
export const nationalHolidayOn = (date: string): HolidayInfo | null => {
  const parsed = parseCivilDate(date);
  if (!parsed) return null;
  const rule = NATIONAL_HOLIDAY_RULES.find((item) =>
    item.month === parsed.month && item.day === parsed.day && parsed.year >= item.fromYear);
  return rule ? { name: rule.name, source: 'national', law: rule.law } : null;
};

/** Feriados nacionais do ano, em ordem de data. */
export const nationalHolidaysOfYear = (year: number): Array<{ date: string } & HolidayInfo> =>
  NATIONAL_HOLIDAY_RULES
    .filter((rule) => year >= rule.fromYear)
    .map((rule) => ({
      date: formatCivilDate({ year, month: rule.month, day: rule.day }),
      name: rule.name,
      source: 'national' as const,
      law: rule.law,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

/** Domingo de Páscoa (algoritmo gregoriano anônimo). */
export const easterSunday = (year: number): string => {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return formatCivilDate({ year, month, day });
};

export type MovableObservanceId = 'carnival_monday' | 'carnival_tuesday' | 'good_friday' | 'corpus_christi';

export interface MovableObservance {
  id: MovableObservanceId;
  label: string;
  /** Natureza legal, para o texto da interface. */
  nature: string;
  /** Dias a partir do domingo de Páscoa. */
  offsetFromEaster: number;
}

/**
 * Datas móveis que o usuário pode incluir, uma a uma, como feriado local.
 * Nenhuma é automática.
 */
export const MOVABLE_OBSERVANCES: readonly MovableObservance[] = [
  { id: 'carnival_monday', label: 'Segunda-feira de Carnaval', nature: 'ponto facultativo federal', offsetFromEaster: -48 },
  { id: 'carnival_tuesday', label: 'Terça-feira de Carnaval', nature: 'ponto facultativo federal', offsetFromEaster: -47 },
  { id: 'good_friday', label: 'Sexta-feira da Paixão', nature: 'feriado religioso definido por lei municipal (Lei nº 9.093/1995, art. 2º)', offsetFromEaster: -2 },
  { id: 'corpus_christi', label: 'Corpus Christi', nature: 'ponto facultativo federal', offsetFromEaster: 60 },
];

/** Turno de eleição: 1º turno no primeiro domingo de outubro; 2º turno, onde houver, no último. */
export type ElectionRound = 'first' | 'second';

/**
 * Domingo de eleição de um ano par (Constituição Federal, arts. 28, 29, II, e 77): o primeiro
 * domingo de outubro e, para o 2º turno, o último. Não entra automaticamente na base: o 2º turno
 * depende de cada eleição e a natureza do dia não foi conferida numa fonte oficial nesta versão.
 * Serve de atalho para o usuário incluir a data em Feriados locais, se for folga para ele.
 * `null` em ano ímpar, fora de 2000–2099 e em 2020, quando a EC nº 107/2020 adiou as eleições
 * municipais para 15 e 29 de novembro (essas datas entram pela data única).
 */
export const ELECTIONS_POSTPONED_YEARS: readonly number[] = [2020];

export const electionSundayDate = (round: ElectionRound, year: number): string | null => {
  if (!Number.isInteger(year) || year < WORK_TIME_MIN_YEAR || year > WORK_TIME_MAX_YEAR || year % 2 !== 0) return null;
  if (ELECTIONS_POSTPONED_YEARS.includes(year)) return null;
  if (round === 'first') {
    const first = `${year}-10-01`;
    return addDays(first, (6 - weekdayIndex(first) + 7) % 7);
  }
  const last = `${year}-10-31`;
  return addDays(last, -((weekdayIndex(last) + 1) % 7));
};

/** Data da observância móvel no ano, ou `null` fora de 2000–2099. */
export const movableObservanceDate = (id: MovableObservanceId, year: number): string | null => {
  const observance = MOVABLE_OBSERVANCES.find((item) => item.id === id);
  if (!observance || !Number.isInteger(year) || year < WORK_TIME_MIN_YEAR || year > WORK_TIME_MAX_YEAR) return null;
  return addDays(easterSunday(year), observance.offsetFromEaster);
};
