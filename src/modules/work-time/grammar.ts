/**
 * Gramáticas fechadas do documento privado v2 (P5-F.1). Módulo PURO: sem
 * React, sem Firebase, imports com extensão `.ts`.
 *
 * O documento não tem mapas nem listas: cada estrutura (rotinas, exceções,
 * feriados locais, exclusões) é um texto curto numa gramática fechada. As
 * Rules validam o mesmo texto com os mesmos padrões (montados com as mesmas
 * peças, `firestore.rules`), o tamanho máximo e a quantidade de itens; a guarda
 * `tests/unit/work-time-guard.test.ts` confere que as peças são idênticas.
 * O cliente valida, além da forma, o que as Rules não alcançam: intervalo
 * com fim antes do início, intervalo longo demais, sobreposição de itens do
 * mesmo tipo, duplicidade e intervalo de pausa maior que a janela.
 *
 * Formatos:
 *
 * - Rotinas (até 3, separadas por `;`):
 *   - semanal `W:` + 7 dias (segunda a domingo) separados por `,`;
 *   - escala cíclica `C:<data de referência>:<dias de trabalho>x<dias de folga>:<dia>`.
 *   - Dia: `-` (sem trabalho), `D<minutos>` (duração sem horário) ou
 *     `HH:MM-HH:MM/<pausa em minutos>` (janela; fim antes do início cruza a
 *     meia-noite; fim igual ao início é um turno de 24 h).
 * - Exceções (até 120, separadas por `;`):
 *   - `F`, `O`, `A` + data ou intervalo `<início>/<fim>`: férias, folga, ausência;
 *   - `H<data>`: feriado trabalhado;
 *   - `P<data>+<minutos>`, `E<data>+<minutos>`: plantão, hora extra (somam);
 *   - `R<data ou intervalo>=<minutos>`: jornada reduzida (limita os dias de trabalho);
 *   - `S<data>=<minutos>`: alteração de escala (define o dia).
 * - Feriados locais (até 40, separados por `;`): data `AAAA-MM-DD` ou anual `MM-DD`.
 * - Exclusões (até 50 ids de lançamento, separados por `,`).
 */
import {
  DAY_MINUTES,
  type DaySpec,
  type LocalHoliday,
  type RangeAbsenceKind,
  type WorkException,
  type WorkExceptionKind,
  type WorkRoutine,
} from './calendar.ts';
import { dayNumber, parseCivilDate } from './dates.ts';

// ------------------------------------------------------------- peças (Rules)

/** Data civil real de 2000 a 2099 (dias por mês e anos bissextos). */
export const DATE_PATTERN =
  '(?:20[0-9][0-9]-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12][0-9]|3[01])|(?:0[469]|11)-(?:0[1-9]|[12][0-9]|30)|02-(?:0[1-9]|1[0-9]|2[0-8]))|20(?:[02468][048]|[13579][26])-02-29)';
/** Dia e mês de um feriado anual (29 de fevereiro não é aceito: só existe em ano bissexto). */
export const ANNUAL_PATTERN =
  '(?:(?:0[13578]|1[02])-(?:0[1-9]|[12][0-9]|3[01])|(?:0[469]|11)-(?:0[1-9]|[12][0-9]|30)|02-(?:0[1-9]|1[0-9]|2[0-8]))';
/** Minutos de 0 a 1.440, sem zero à esquerda. */
export const MINUTES_0_PATTERN = '(?:0|[1-9][0-9]{0,2}|1[0-3][0-9][0-9]|14[0-3][0-9]|1440)';
/** Minutos de 1 a 1.440, sem zero à esquerda. */
export const MINUTES_1_PATTERN = '(?:[1-9][0-9]{0,2}|1[0-3][0-9][0-9]|14[0-3][0-9]|1440)';
/** Hora `HH:MM` de 00:00 a 23:59. */
export const TIME_PATTERN = '(?:[01][0-9]|2[0-3]):[0-5][0-9]';
/** Dias de trabalho ou de folga de uma escala cíclica: 1 a 28. */
export const CYCLE_COUNT_PATTERN = '(?:[1-9]|1[0-9]|2[0-8])';
/** Id de lançamento ou de workspace aceito no documento. */
export const RECORD_ID_PATTERN = '[A-Za-z0-9_-]{1,128}';
/** Município: começa com letra; letras, espaço, ponto, apóstrofo e hífen; até 60 caracteres. */
export const MUNICIPALITY_PATTERN = "(?:\\p{L}[\\p{L} .'-]{0,59})?";

// --------------------------------------------------------------- composição

const WINDOW_PATTERN = `${TIME_PATTERN}-${TIME_PATTERN}/${MINUTES_0_PATTERN}`;
export const DAY_PATTERN = `(?:-|D${MINUTES_1_PATTERN}|${WINDOW_PATTERN})`;
export const WORK_DAY_PATTERN = `(?:D${MINUTES_1_PATTERN}|${WINDOW_PATTERN})`;
export const ROUTINE_PATTERN =
  `(?:W:${DAY_PATTERN}(?:,${DAY_PATTERN}){6}|C:${DATE_PATTERN}:${CYCLE_COUNT_PATTERN}x${CYCLE_COUNT_PATTERN}:${WORK_DAY_PATTERN})`;
const RANGE_PATTERN = `${DATE_PATTERN}(?:/${DATE_PATTERN})?`;
export const EXCEPTION_PATTERN =
  `(?:[FOA]${RANGE_PATTERN}|H${DATE_PATTERN}|[PE]${DATE_PATTERN}[+]${MINUTES_1_PATTERN}|R${RANGE_PATTERN}=${MINUTES_1_PATTERN}|S${DATE_PATTERN}=${MINUTES_0_PATTERN})`;
export const LOCAL_HOLIDAY_PATTERN = `(?:${DATE_PATTERN}|${ANNUAL_PATTERN})`;

/*
 * Listas. As Rules limitam a 100 agrupamentos por expressão, e repetir o
 * item (`item(;item)*`) passaria disso nas exceções. Por isso a lista é
 * conferida com uma cópia só do item, sobre o texto com o separador no fim:
 * `texto + ';'` precisa casar `(?:item;)+`. Como nenhum item contém o
 * separador, a linguagem aceita é exatamente a de `item(;item)*`. A lista
 * vazia (`''`) é aceita à parte, onde o contrato permite.
 */
export const ROUTINES_LIST_PATTERN = `(?:${ROUTINE_PATTERN};){1,3}`;
export const EXCEPTIONS_LIST_PATTERN = `(?:${EXCEPTION_PATTERN};)+`;
export const LOCAL_HOLIDAYS_LIST_PATTERN = `(?:${LOCAL_HOLIDAY_PATTERN};)+`;
export const EXCLUDED_IDS_LIST_PATTERN = `(?:${RECORD_ID_PATTERN},)+`;

// ------------------------------------------------------------------- limites

export const MAX_ROUTINES = 3;
export const MAX_EXCEPTIONS = 120;
export const MAX_LOCAL_HOLIDAYS = 40;
export const MAX_EXCLUDED_INCOME_IDS = 50;
/** Intervalo mais longo de uma exceção: um ano bissexto inteiro. */
export const MAX_EXCEPTION_RANGE_DAYS = 366;
export const MAX_MUNICIPALITY_LENGTH = 60;

/** Tamanho máximo de cada texto (as Rules exigem os mesmos). */
export const MAX_ROUTINES_LENGTH = 400;
export const MAX_EXCEPTIONS_LENGTH = 3400;
export const MAX_LOCAL_HOLIDAYS_LENGTH = 440;
export const MAX_EXCLUDED_IDS_LENGTH = 6449;

const full = (pattern: string, flags = '') => new RegExp(`^${pattern}$`, flags);
const ROUTINES_RE = full(ROUTINES_LIST_PATTERN);
const EXCEPTIONS_RE = full(EXCEPTIONS_LIST_PATTERN);
const LOCAL_HOLIDAYS_RE = full(LOCAL_HOLIDAYS_LIST_PATTERN);
const EXCLUDED_IDS_RE = full(EXCLUDED_IDS_LIST_PATTERN);
const RECORD_ID_RE = full(RECORD_ID_PATTERN);
const MUNICIPALITY_RE = full(MUNICIPALITY_PATTERN, 'u');

/** Mesma conferência das Rules: o texto com o separador no fim casa a lista de itens. */
const matchesList = (text: string, list: RegExp, separator: string, allowEmpty: boolean): boolean =>
  (allowEmpty && text === '') || list.test(text + separator);

export const isRecordId = (value: unknown): value is string => typeof value === 'string' && RECORD_ID_RE.test(value);

export const isMunicipality = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= MAX_MUNICIPALITY_LENGTH && MUNICIPALITY_RE.test(value);

// ------------------------------------------------------------------- rotinas

const pad2 = (value: number) => String(value).padStart(2, '0');

export const minutesToTime = (minutes: number): string => `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;

export const timeToMinutes = (time: string): number | null => {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

const windowLengthOf = (start: number, end: number) => (end > start ? end - start : DAY_MINUTES - start + end);

/** A especificação do dia é coerente: duração de 1 a 1.440 e pausa menor que a janela. */
export const isValidDaySpec = (spec: DaySpec): boolean => {
  if (spec.kind === 'off') return true;
  if (spec.kind === 'duration') return Number.isInteger(spec.minutes) && spec.minutes >= 1 && spec.minutes <= DAY_MINUTES;
  const integers = [spec.start, spec.end, spec.breakMinutes].every(Number.isInteger);
  if (!integers || spec.start < 0 || spec.start >= DAY_MINUTES || spec.end < 0 || spec.end >= DAY_MINUTES) return false;
  return spec.breakMinutes >= 0 && spec.breakMinutes < windowLengthOf(spec.start, spec.end);
};

const formatDay = (spec: DaySpec): string => {
  if (spec.kind === 'off') return '-';
  if (spec.kind === 'duration') return `D${spec.minutes}`;
  return `${minutesToTime(spec.start)}-${minutesToTime(spec.end)}/${spec.breakMinutes}`;
};

const parseDay = (text: string): DaySpec | null => {
  if (text === '-') return { kind: 'off' };
  if (text.startsWith('D')) return { kind: 'duration', minutes: Number(text.slice(1)) };
  const [times, pause] = text.split('/');
  const [startText, endText] = times.split('-');
  const start = timeToMinutes(startText);
  const end = timeToMinutes(endText);
  if (start === null || end === null) return null;
  return { kind: 'window', start, end, breakMinutes: Number(pause) };
};

/** A rotina é coerente (7 dias, escala com data real e dia de trabalho válido). */
export const isValidRoutine = (routine: WorkRoutine): boolean => {
  if (routine.kind === 'weekly') {
    return routine.days.length === 7 && routine.days.every(isValidDaySpec);
  }
  const counts = [routine.workDays, routine.restDays];
  return parseCivilDate(routine.reference) !== null &&
    counts.every((count) => Number.isInteger(count) && count >= 1 && count <= 28) &&
    routine.day.kind !== 'off' &&
    isValidDaySpec(routine.day);
};

/** A rotina tem algum trabalho (uma semana inteira de folga não serve de base). */
export const routineHasWork = (routine: WorkRoutine): boolean =>
  routine.kind === 'cyclic' || routine.days.some((day) => day.kind !== 'off');

export const formatRoutines = (routines: readonly WorkRoutine[]): string =>
  routines.map((routine) => (routine.kind === 'weekly'
    ? `W:${routine.days.map(formatDay).join(',')}`
    : `C:${routine.reference}:${routine.workDays}x${routine.restDays}:${formatDay(routine.day)}`)).join(';');

/** Partes de uma escala já validada pela gramática: referência, trabalho, folga e dia. */
const CYCLIC_PARTS = /^C:(\d{4}-\d{2}-\d{2}):(\d{1,2})x(\d{1,2}):(.+)$/;

export const parseRoutines = (text: unknown): WorkRoutine[] | null => {
  if (typeof text !== 'string' || text.length > MAX_ROUTINES_LENGTH || !matchesList(text, ROUTINES_RE, ';', false)) return null;
  const routines: WorkRoutine[] = [];
  for (const item of text.split(';')) {
    if (item.startsWith('W:')) {
      const days = item.slice(2).split(',').map(parseDay);
      if (days.some((day) => day === null)) return null;
      routines.push({ kind: 'weekly', days: days as DaySpec[] });
    } else {
      const match = CYCLIC_PARTS.exec(item);
      if (!match) return null;
      const day = parseDay(match[4]);
      if (!day) return null;
      routines.push({ kind: 'cyclic', reference: match[1], workDays: Number(match[2]), restDays: Number(match[3]), day });
    }
  }
  if (routines.length === 0 || routines.length > MAX_ROUTINES) return null;
  if (!routines.every(isValidRoutine) || !routines.some(routineHasWork)) return null;
  return formatRoutines(routines) === text ? routines : null;
};

// ------------------------------------------------------------------ exceções

const ABSENCE_CODES: Record<RangeAbsenceKind, string> = { vacation: 'F', day_off: 'O', absence: 'A' };
const ABSENCE_KINDS: Record<string, RangeAbsenceKind> = { F: 'vacation', O: 'day_off', A: 'absence' };

const formatRange = (start: string, end: string) => (start === end ? start : `${start}/${end}`);

const formatException = (entry: WorkException): string => {
  switch (entry.kind) {
    case 'vacation':
    case 'day_off':
    case 'absence':
      return `${ABSENCE_CODES[entry.kind]}${formatRange(entry.start, entry.end)}`;
    case 'holiday_worked':
      return `H${entry.date}`;
    case 'on_call':
      return `P${entry.date}+${entry.minutes}`;
    case 'overtime':
      return `E${entry.date}+${entry.minutes}`;
    case 'reduced':
      return `R${formatRange(entry.start, entry.end)}=${entry.minutes}`;
    case 'schedule_change':
      return `S${entry.date}=${entry.minutes}`;
  }
};

/** Primeira e última data da exceção. */
export const exceptionSpan = (entry: WorkException): { start: string; end: string } =>
  'date' in entry ? { start: entry.date, end: entry.date } : { start: entry.start, end: entry.end };

const exceptionOrder = (a: WorkException, b: WorkException): number => {
  const spanA = exceptionSpan(a);
  const spanB = exceptionSpan(b);
  if (spanA.start !== spanB.start) return spanA.start < spanB.start ? -1 : 1;
  if (spanA.end !== spanB.end) return spanA.end < spanB.end ? -1 : 1;
  return formatException(a) < formatException(b) ? -1 : 1;
};

/** Ordem canônica: por data de início, data de fim e texto. */
export const sortExceptions = (entries: readonly WorkException[]): WorkException[] => [...entries].sort(exceptionOrder);

export const formatExceptions = (entries: readonly WorkException[]): string =>
  sortExceptions(entries).map(formatException).join(';');

const parseRange = (text: string): { start: string; end: string } => {
  const [start, end] = text.split('/');
  return { start, end: end ?? start };
};

const parseException = (text: string): WorkException => {
  const code = text[0];
  const body = text.slice(1);
  if (code in ABSENCE_KINDS) return { kind: ABSENCE_KINDS[code], ...parseRange(body) };
  if (code === 'H') return { kind: 'holiday_worked', date: body };
  if (code === 'P' || code === 'E') {
    const [date, minutes] = body.split('+');
    return { kind: code === 'P' ? 'on_call' : 'overtime', date, minutes: Number(minutes) };
  }
  const [range, minutes] = body.split('=');
  if (code === 'R') return { kind: 'reduced', ...parseRange(range), minutes: Number(minutes) };
  return { kind: 'schedule_change', date: range, minutes: Number(minutes) };
};

export type ExceptionIssue = 'range_order' | 'range_too_long' | 'overlap';

/** Problema semântico de uma lista de exceções, ou `null`. */
export const checkExceptions = (entries: readonly WorkException[]): ExceptionIssue | null => {
  for (const entry of entries) {
    const { start, end } = exceptionSpan(entry);
    if (end < start) return 'range_order';
    if (dayNumber(end) - dayNumber(start) + 1 > MAX_EXCEPTION_RANGE_DAYS) return 'range_too_long';
  }
  const byKind = new Map<WorkExceptionKind, Array<{ start: string; end: string }>>();
  for (const entry of entries) {
    const spans = byKind.get(entry.kind) ?? [];
    const span = exceptionSpan(entry);
    if (spans.some((other) => span.start <= other.end && other.start <= span.end)) return 'overlap';
    spans.push(span);
    byKind.set(entry.kind, spans);
  }
  return null;
};

export const parseExceptions = (text: unknown): WorkException[] | null => {
  if (typeof text !== 'string' || text.length > MAX_EXCEPTIONS_LENGTH || !matchesList(text, EXCEPTIONS_RE, ';', true)) return null;
  if (text === '') return [];
  const entries = text.split(';').map(parseException);
  if (entries.length > MAX_EXCEPTIONS || checkExceptions(entries) !== null) return null;
  return formatExceptions(entries) === text ? entries : null;
};

// ----------------------------------------------------------- feriados locais

const formatLocalHoliday = (holiday: LocalHoliday): string =>
  holiday.kind === 'date' ? holiday.date : `${pad2(holiday.month)}-${pad2(holiday.day)}`;

/** Ordem canônica: anuais por mês e dia, depois datas, sem repetição. */
export const formatLocalHolidays = (holidays: readonly LocalHoliday[]): string =>
  [...new Set(holidays.map(formatLocalHoliday))]
    .sort((a, b) => (a.length !== b.length ? a.length - b.length : a < b ? -1 : 1))
    .join(';');

export const parseLocalHolidays = (text: unknown): LocalHoliday[] | null => {
  if (typeof text !== 'string' || text.length > MAX_LOCAL_HOLIDAYS_LENGTH || !matchesList(text, LOCAL_HOLIDAYS_RE, ';', true)) return null;
  if (text === '') return [];
  const holidays = text.split(';').map((item): LocalHoliday => (item.length === 10
    ? { kind: 'date', date: item }
    : { kind: 'annual', month: Number(item.slice(0, 2)), day: Number(item.slice(3, 5)) }));
  if (holidays.length > MAX_LOCAL_HOLIDAYS) return null;
  return formatLocalHolidays(holidays) === text ? holidays : null;
};

// ----------------------------------------------------------------- exclusões

/** Ordem canônica: ids em ordem, sem repetição. */
export const formatExcludedIds = (ids: readonly string[]): string => [...new Set(ids)].sort().join(',');

export const parseExcludedIds = (text: unknown): string[] | null => {
  if (typeof text !== 'string' || text.length > MAX_EXCLUDED_IDS_LENGTH || !matchesList(text, EXCLUDED_IDS_RE, ',', true)) return null;
  if (text === '') return [];
  const ids = text.split(',');
  if (ids.length > MAX_EXCLUDED_INCOME_IDS) return null;
  return formatExcludedIds(ids) === text ? ids : null;
};
