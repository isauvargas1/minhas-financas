/**
 * Rascunho do assistente e das Configurações do tempo de trabalho
 * equivalente (P5-F.1). Módulo PURO: sem React, sem Firebase, imports com
 * extensão `.ts`.
 *
 * O rascunho tem a forma da preferência. Nada é gravado enquanto a pessoa
 * edita: a prévia é calculada do rascunho, e só "Salvar" grava. Cada função
 * devolve o resultado pronto ou a mensagem em pt-BR do primeiro problema,
 * com o campo a que ela se refere. Nada é corrigido em silêncio.
 */
import {
  DAY_MINUTES,
  calendarAmbiguity,
  routinesAmbiguity,
  type CalendarAmbiguity,
  type CalendarAmbiguityCause,
  type DaySpec,
  type LocalHoliday,
  type RoutinesAmbiguity,
  type WorkException,
  type WorkExceptionKind,
  type WorkRoutine,
} from './calendar.ts';
import {
  WORK_TIME_DEFAULT_HISTORY_MONTHS,
  workCalendarOf,
  workTimePreferenceFields,
  type WorkTimePreference,
} from './contract.ts';
import { dayNumber, isCivilDate, parseCivilDate, weekdayIndex } from './dates.ts';
import {
  MAX_EXCEPTIONS,
  MAX_EXCEPTION_RANGE_DAYS,
  MAX_EXCLUDED_INCOME_IDS,
  MAX_LOCAL_HOLIDAYS,
  MAX_ROUTINES,
  exceptionSpan,
  isMunicipality,
  isRecordId,
  isValidDaySpec,
  minutesToTime,
  routineHasWork,
  sortExceptions,
  timeToMinutes,
} from './grammar.ts';

export const WEEKDAY_LABELS = ['Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado', 'Domingo'] as const;
export const WEEKDAY_SHORT_LABELS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'] as const;

const NBSP = ' ';

/** Duração por extenso curto: `8 h`, `7 h 30 min`, `45 min`, `0 h`. */
export const formatDuration = (minutes: number): string => {
  const magnitude = Math.max(0, Math.round(minutes));
  const hours = Math.floor(magnitude / 60);
  const rest = magnitude % 60;
  if (hours === 0 && rest === 0) return `0${NBSP}h`;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours.toLocaleString('pt-BR')}${NBSP}h`);
  if (rest > 0) parts.push(`${rest}${NBSP}min`);
  return parts.join(NBSP);
};

/** Data civil no formato brasileiro: `06/07/2026`. */
export const formatCivilDateBR = (date: string): string => {
  const parsed = parseCivilDate(date);
  if (!parsed) return date;
  return `${String(parsed.day).padStart(2, '0')}/${String(parsed.month).padStart(2, '0')}/${parsed.year}`;
};

// ------------------------------------------------------------- dia da rotina

export type DayInputMode = 'off' | 'window' | 'duration';

/** O que a tela edita para um dia: horário (início, fim, intervalo) ou duração. */
export interface DayInput {
  mode: DayInputMode;
  start: string;
  end: string;
  /** Intervalo em minutos, como digitado. */
  breakMinutes: string;
  /** Duração sem horário, em horas e minutos, como digitada. */
  hours: string;
  minutes: string;
}

export const OFF_DAY_INPUT: DayInput = { mode: 'off', start: '08:00', end: '17:00', breakMinutes: '60', hours: '8', minutes: '0' };

export const dayInputFromSpec = (spec: DaySpec): DayInput => {
  if (spec.kind === 'off') return { ...OFF_DAY_INPUT };
  if (spec.kind === 'duration') {
    return { ...OFF_DAY_INPUT, mode: 'duration', hours: String(Math.floor(spec.minutes / 60)), minutes: String(spec.minutes % 60) };
  }
  return {
    ...OFF_DAY_INPUT,
    mode: 'window',
    start: minutesToTime(spec.start),
    end: minutesToTime(spec.end),
    breakMinutes: String(spec.breakMinutes),
  };
};

const DIGITS = /^\d{1,4}$/;

export type DayInputResult = { ok: true; spec: DaySpec } | { ok: false; message: string };

/** Lê o dia como digitado. Fim antes do início é um turno que passa da meia-noite. */
export const parseDayInput = (input: DayInput): DayInputResult => {
  if (input.mode === 'off') return { ok: true, spec: { kind: 'off' } };
  if (input.mode === 'duration') {
    const hoursText = input.hours.trim();
    const minutesText = input.minutes.trim() === '' ? '0' : input.minutes.trim();
    if (!DIGITS.test(hoursText) || !DIGITS.test(minutesText) || Number(minutesText) > 59) {
      return { ok: false, message: 'Informe a duração em horas inteiras e minutos de 0 a 59.' };
    }
    const total = Number(hoursText) * 60 + Number(minutesText);
    if (total < 1) return { ok: false, message: 'A duração precisa ser maior que zero.' };
    if (total > DAY_MINUTES) return { ok: false, message: 'Um dia tem no máximo 24 horas.' };
    return { ok: true, spec: { kind: 'duration', minutes: total } };
  }
  const start = timeToMinutes(input.start.trim());
  const end = timeToMinutes(input.end.trim());
  if (start === null || end === null) return { ok: false, message: 'Use horários no formato 08:00.' };
  const pauseText = input.breakMinutes.trim() === '' ? '0' : input.breakMinutes.trim();
  if (!DIGITS.test(pauseText)) return { ok: false, message: 'Informe o intervalo em minutos inteiros.' };
  const spec: DaySpec = { kind: 'window', start, end, breakMinutes: Number(pauseText) };
  if (!isValidDaySpec(spec)) return { ok: false, message: 'O intervalo precisa ser menor que o tempo entre o início e o fim.' };
  return { ok: true, spec };
};

// ----------------------------------------------------------- escalas prontas

export interface CyclePreset {
  id: string;
  label: string;
  description: string;
  workDays: number;
  restDays: number;
  day: DaySpec;
}

const shift = (start: string, end: string, pause: number): DaySpec => ({
  kind: 'window', start: timeToMinutes(start) ?? 0, end: timeToMinutes(end) ?? 0, breakMinutes: pause,
});

/** Escalas comuns. O usuário ajusta horário e intervalo depois de escolher. */
export const CYCLE_PRESETS: readonly CyclePreset[] = [
  { id: '12x36', label: '12×36', description: '12 horas de trabalho e 36 de descanso (um dia sim, um dia não).', workDays: 1, restDays: 1, day: shift('07:00', '19:00', 60) },
  { id: '24x48', label: '24×48', description: '24 horas de trabalho e 48 de descanso.', workDays: 1, restDays: 2, day: shift('07:00', '07:00', 0) },
  { id: '24x72', label: '24×72', description: '24 horas de trabalho e 72 de descanso.', workDays: 1, restDays: 3, day: shift('07:00', '07:00', 0) },
  { id: '6x1', label: '6×1', description: 'Seis dias de trabalho e um de folga.', workDays: 6, restDays: 1, day: shift('08:00', '16:20', 60) },
  { id: '5x2', label: '5×2 em escala', description: 'Cinco dias de trabalho e dois de folga, girando na semana.', workDays: 5, restDays: 2, day: shift('08:00', '17:00', 60) },
  { id: '4x2', label: '4×2', description: 'Quatro dias de trabalho e dois de folga.', workDays: 4, restDays: 2, day: shift('07:00', '19:00', 60) },
];

/** Semana comercial: segunda a sexta, 08:00–17:00 com 1 h de intervalo. */
export const DEFAULT_WEEKLY_ROUTINE: WorkRoutine = {
  kind: 'weekly',
  days: [...Array(5).fill(shift('08:00', '17:00', 60)), { kind: 'off' }, { kind: 'off' }],
};

// ------------------------------------------------------------------ exceções

export const EXCEPTION_LABELS: Record<WorkExceptionKind, string> = {
  vacation: 'Férias',
  day_off: 'Folga',
  absence: 'Ausência',
  holiday_worked: 'Feriado trabalhado',
  on_call: 'Plantão',
  overtime: 'Hora extra',
  reduced: 'Jornada reduzida',
  schedule_change: 'Alteração de escala',
};

/** O que cada tipo pede: intervalo de datas, data única e minutos. */
export const EXCEPTION_SHAPES: Record<WorkExceptionKind, { range: boolean; minutes: 'none' | 'add' | 'limit' | 'set' }> = {
  vacation: { range: true, minutes: 'none' },
  day_off: { range: true, minutes: 'none' },
  absence: { range: true, minutes: 'none' },
  holiday_worked: { range: false, minutes: 'none' },
  on_call: { range: false, minutes: 'add' },
  overtime: { range: false, minutes: 'add' },
  reduced: { range: true, minutes: 'limit' },
  schedule_change: { range: false, minutes: 'set' },
};

export interface ExceptionInput {
  kind: WorkExceptionKind;
  start: string;
  end: string;
  hours: string;
  minutes: string;
}

export type ExceptionField = 'start' | 'end' | 'minutes' | 'list';
export type ExceptionResult =
  | { ok: true; entry: WorkException }
  | { ok: false; field: ExceptionField; message: string };

const readMinutes = (hoursText: string, minutesText: string, allowZero: boolean): number | string => {
  const hours = hoursText.trim() === '' ? '0' : hoursText.trim();
  const minutes = minutesText.trim() === '' ? '0' : minutesText.trim();
  if (!DIGITS.test(hours) || !DIGITS.test(minutes) || Number(minutes) > 59) {
    return 'Informe as horas inteiras e os minutos de 0 a 59.';
  }
  const total = Number(hours) * 60 + Number(minutes);
  if (total > DAY_MINUTES) return 'Um dia tem no máximo 24 horas.';
  if (total === 0 && !allowZero) return 'Informe um tempo maior que zero.';
  return total;
};

/** Monta a exceção como digitada. */
export const buildException = (input: ExceptionInput): ExceptionResult => {
  const shape = EXCEPTION_SHAPES[input.kind];
  if (!isCivilDate(input.start)) return { ok: false, field: 'start', message: 'Escolha uma data válida entre 2000 e 2099.' };
  const end = shape.range && input.end.trim() !== '' ? input.end : input.start;
  if (!isCivilDate(end)) return { ok: false, field: 'end', message: 'Escolha uma data final válida entre 2000 e 2099.' };
  if (end < input.start) return { ok: false, field: 'end', message: 'A data final precisa ser igual ou posterior à inicial.' };
  if (dayNumber(end) - dayNumber(input.start) + 1 > MAX_EXCEPTION_RANGE_DAYS) {
    return { ok: false, field: 'end', message: 'O intervalo pode ter no máximo 366 dias.' };
  }
  let minutes = 0;
  if (shape.minutes !== 'none') {
    const read = readMinutes(input.hours, input.minutes, shape.minutes === 'set');
    if (typeof read === 'string') return { ok: false, field: 'minutes', message: read };
    minutes = read;
  }
  switch (input.kind) {
    case 'vacation':
    case 'day_off':
    case 'absence':
      return { ok: true, entry: { kind: input.kind, start: input.start, end } };
    case 'holiday_worked':
      return { ok: true, entry: { kind: 'holiday_worked', date: input.start } };
    case 'on_call':
    case 'overtime':
      return { ok: true, entry: { kind: input.kind, date: input.start, minutes } };
    case 'reduced':
      return { ok: true, entry: { kind: 'reduced', start: input.start, end, minutes } };
    case 'schedule_change':
      return { ok: true, entry: { kind: 'schedule_change', date: input.start, minutes } };
  }
};

/** Inclui a exceção na lista, recusando a sobreposição com outra do mesmo tipo. */
export const addException = (
  entries: readonly WorkException[],
  entry: WorkException,
): { ok: true; entries: WorkException[] } | { ok: false; message: string } => {
  if (entries.length >= MAX_EXCEPTIONS) return { ok: false, message: `Você pode registrar até ${MAX_EXCEPTIONS} exceções.` };
  const span = exceptionSpan(entry);
  const clash = entries.find((other) => other.kind === entry.kind &&
    span.start <= exceptionSpan(other).end && exceptionSpan(other).start <= span.end);
  if (clash) return { ok: false, message: `Já existe ${EXCEPTION_LABELS[entry.kind].toLowerCase()} nessas datas.` };
  return { ok: true, entries: sortExceptions([...entries, entry]) };
};

/** Texto da exceção: `Férias de 06/07/2026 a 17/07/2026`, `Hora extra em 20/07/2026: 2 h`. */
export const describeException = (entry: WorkException): string => {
  const label = EXCEPTION_LABELS[entry.kind];
  const span = exceptionSpan(entry);
  const when = span.start === span.end
    ? `em ${formatCivilDateBR(span.start)}`
    : `de ${formatCivilDateBR(span.start)} a ${formatCivilDateBR(span.end)}`;
  switch (entry.kind) {
    case 'on_call':
    case 'overtime':
      return `${label} ${when}: mais ${formatDuration(entry.minutes)}`;
    case 'reduced':
      return `${label} ${when}: até ${formatDuration(entry.minutes)} por dia de trabalho`;
    case 'schedule_change':
      return `${label} ${when}: ${formatDuration(entry.minutes)} no dia`;
    default:
      return `${label} ${when}`;
  }
};

// ----------------------------------------------------------- feriados locais

/**
 * Município como a pessoa digita: acentos compostos (NFC), apóstrofos tipográficos (’ ‘ ʼ, comuns
 * no celular) trocados por ', espaços repetidos reduzidos e sem espaço inicial.
 */
export const normalizeMunicipalityInput = (text: string): string =>
  text.normalize('NFC').replace(/[\u2018\u2019\u02BC\u00B4`]/g, "'").replace(/\s+/g, ' ').trimStart();

export const MONTH_NAMES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** "novembro de 2026", para o meio de uma frase. */
export const monthLabel = (month: string) => `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} de ${month.slice(0, 4)}`;

/** "Novembro de 2026", para títulos: só a primeira letra maiúscula (nunca "Novembro De 2026"). */
export const monthHeading = (month: string) => {
  const label = monthLabel(month);
  return label.charAt(0).toUpperCase() + label.slice(1);
};

export const describeLocalHoliday = (holiday: LocalHoliday): string =>
  holiday.kind === 'date'
    ? formatCivilDateBR(holiday.date)
    : `${holiday.day} de ${MONTH_NAMES[holiday.month - 1]}, todo ano`;

const localKey = (holiday: LocalHoliday) =>
  holiday.kind === 'date' ? holiday.date : `${holiday.month}-${holiday.day}`;

export const addLocalHoliday = (
  holidays: readonly LocalHoliday[],
  holiday: LocalHoliday,
): { ok: true; holidays: LocalHoliday[] } | { ok: false; message: string } => {
  if (holiday.kind === 'date' && !isCivilDate(holiday.date)) return { ok: false, message: 'Escolha uma data válida entre 2000 e 2099.' };
  if (holiday.kind === 'annual') {
    const valid = Number.isInteger(holiday.month) && holiday.month >= 1 && holiday.month <= 12 &&
      Number.isInteger(holiday.day) && holiday.day >= 1 &&
      holiday.day <= [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][holiday.month - 1];
    if (!valid) return { ok: false, message: 'Escolha um dia e um mês válidos (29 de fevereiro não pode ser anual).' };
  }
  if (holidays.some((item) => localKey(item) === localKey(holiday))) return { ok: false, message: 'Esse feriado já está na lista.' };
  if (holidays.length >= MAX_LOCAL_HOLIDAYS) return { ok: false, message: `Você pode registrar até ${MAX_LOCAL_HOLIDAYS} feriados locais.` };
  return { ok: true, holidays: [...holidays, holiday] };
};

// -------------------------------------------------------------- rascunho todo

/** Rascunho inicial do assistente: semana comercial e renda do workspace escolhido. */
export const initialDraft = (incomeWorkspaceId: string): WorkTimePreference => ({
  enabled: true,
  displayMode: 'money',
  estimateMode: 'habitual',
  historyMonths: WORK_TIME_DEFAULT_HISTORY_MONTHS,
  incomeWorkspaceId,
  allowBusinessIncome: false,
  excludedIncomeIds: [],
  routines: [DEFAULT_WEEKLY_ROUTINE],
  worksOnHolidays: false,
  uf: '',
  municipality: '',
  localHolidays: [],
  exceptions: [],
});

/**
 * Rotinas que se cruzam com intervalo no trecho em comum (`routinesAmbiguity`): a mensagem diz quais e
 * um dia em que acontece, e como resolver, sem número de horas (não há cálculo seguro).
 */
const dayOfWeekAndDate = (date: string): string =>
  `${WEEKDAY_LABELS[weekdayIndex(date)].toLowerCase()}, ${formatCivilDateBR(date)}`;

/** "A Rotina 1 e a Rotina 2 se cruzam em segunda-feira, 05/10/2026" (ou a rotina que se cruza com ela mesma). */
const whoCrosses = (ambiguity: RoutinesAmbiguity): string => {
  const names = ambiguity.routines.map((index) => `Rotina ${index + 1}`);
  const when = `em ${dayOfWeekAndDate(ambiguity.date)}`;
  return names.length <= 1
    ? `A ${names[0] ?? 'rotina'} se cruza com ela mesma de um dia para o outro ${when}`
    : `${names.slice(0, -1).map((name, index) => `${index === 0 ? 'A' : 'a'} ${name}`).join(', ')} e a ${names[names.length - 1]} se cruzam ${when}`;
};

const NO_SAFE_HOURS = 'não dá para saber onde cai a pausa, então as horas não podem ser calculadas com segurança';

export const routinesAmbiguityMessage = (ambiguity: RoutinesAmbiguity): string =>
  `${whoCrosses(ambiguity)}, e há intervalo no trecho em comum: ${NO_SAFE_HOURS}. Ajuste os horários para que não se cruzem ou deixe sem intervalo as rotinas que se cruzam.`;

/** O dia vizinho sem a rotina que tira a cobertura (`CalendarAmbiguityCause`, `neighbor`). */
const SUSPENSION_PHRASES: Record<Extract<CalendarAmbiguityCause, { kind: 'neighbor' }>['reason'], string> = {
  holiday: 'o feriado',
  vacation: 'as férias',
  day_off: 'a folga',
  absence: 'a ausência',
  reduced: 'a jornada reduzida',
  schedule_change: 'a alteração de escala',
  holiday_worked: 'o feriado trabalhado',
  on_call: 'o plantão',
  overtime: 'a hora extra',
};

/** "Rotina 1", "Rotina 1 e Rotina 3", "Rotina 1, Rotina 2 e Rotina 3". */
const routineNames = (routines: readonly number[]): string => {
  const names = routines.map((index) => `Rotina ${index + 1}`);
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
};

/**
 * Mensagem da configuração sem cálculo seguro (`calendarAmbiguity`): as rotinas sozinhas, o primeiro dia de
 * um mês (que pode abrir o período da estimativa, sem a véspera), um dia vizinho de feriado ou exceção
 * que tira o horário sem intervalo que cobria o trecho, ou o dia seguinte a uma jornada reduzida que pode
 * cortar um horário que passa da meia-noite. Diz quando, por quê e como resolver.
 */
export const calendarAmbiguityMessage = (ambiguity: CalendarAmbiguity): string => {
  const cause = ambiguity.cause;
  if (cause.kind === 'routines') return routinesAmbiguityMessage(ambiguity);
  if (cause.kind === 'period_start') {
    return `${whoCrosses(ambiguity)}, e há intervalo no trecho em comum. É o primeiro dia de um mês, que pode abrir o período da estimativa, e o horário da véspera que cobria esse trecho fica fora dele: ${NO_SAFE_HOURS}. Ajuste os horários para que não se cruzem ou deixe sem intervalo as rotinas que se cruzam.`;
  }
  if (cause.kind === 'reduced_eve') {
    const which = ambiguity.routines.length > 0 ? ` (${routineNames(ambiguity.routines)})` : '';
    return `Com a jornada reduzida de ${dayOfWeekAndDate(cause.date)}, não dá para confirmar que parte do horário que passa da meia-noite${which} foi trabalhada, e por isso as horas de ${dayOfWeekAndDate(ambiguity.date)}, não podem ser calculadas com segurança. Troque a jornada reduzida desse dia por uma alteração de escala ou ajuste os horários das rotinas.`;
  }
  const what = `${SUSPENSION_PHRASES[cause.reason]}${cause.reason === 'holiday' && cause.holiday ? ` (${cause.holiday})` : ''}`;
  const fix = cause.reason === 'holiday' ? 'ou marque esse feriado como trabalhado' : 'ou essa exceção';
  return `${whoCrosses(ambiguity)}, e há intervalo no trecho em comum. Com ${what} de ${dayOfWeekAndDate(cause.date)}, o horário sem intervalo que cobria esse trecho não acontece: ${NO_SAFE_HOURS}. Ajuste os horários das rotinas ${fix}.`;
};

/** Mensagem das rotinas sem cálculo seguro a partir de `today` (o primeiro dia assim), ou `null`. */
export const routinesAmbiguityProblem = (routines: readonly WorkRoutine[], today: string): string | null => {
  const ambiguity = routinesAmbiguity(routines, today);
  return ambiguity ? routinesAmbiguityMessage(ambiguity) : null;
};

export type DraftSection = 'routines' | 'holidays' | 'exceptions' | 'income';
export type DraftResult =
  | { ok: true }
  | {
    ok: false;
    section: DraftSection;
    message: string;
    /** Configuração sem cálculo seguro (`calendarAmbiguity`): a causa, para a tela mostrar o aviso. */
    ambiguity?: CalendarAmbiguityCause['kind'];
  };

/** Seção que resolve a configuração sem cálculo seguro: as rotinas, os feriados ou as exceções. */
const ambiguitySection = (cause: CalendarAmbiguityCause): DraftSection => {
  if (cause.kind === 'reduced_eve') return 'exceptions';
  if (cause.kind !== 'neighbor') return 'routines';
  return cause.reason === 'holiday' ? 'holidays' : 'exceptions';
};

/**
 * Valida o rascunho inteiro com as mesmas regras do documento e recusa a configuração sem cálculo seguro
 * (`calendarAmbiguity`: as rotinas sozinhas, com os feriados e as exceções, e o primeiro dia de cada mês,
 * de 12 meses antes do mês de `today`, a data de hoje, até 2099; a mensagem cita o primeiro dia assim a
 * partir de hoje).
 */
export const validateDraft = (draft: WorkTimePreference, today: string): DraftResult => {
  if (draft.routines.length === 0) return { ok: false, section: 'routines', message: 'Informe pelo menos uma rotina de trabalho.' };
  if (draft.routines.length > MAX_ROUTINES) return { ok: false, section: 'routines', message: `Você pode ter até ${MAX_ROUTINES} rotinas.` };
  for (const routine of draft.routines) {
    const days = routine.kind === 'weekly' ? routine.days : [routine.day];
    if (!days.every(isValidDaySpec)) return { ok: false, section: 'routines', message: 'Confira os horários: o intervalo precisa ser menor que a jornada.' };
    if (routine.kind === 'cyclic' && !isCivilDate(routine.reference)) {
      return { ok: false, section: 'routines', message: 'Escolha a data de referência da escala.' };
    }
  }
  if (!draft.routines.some(routineHasWork)) return { ok: false, section: 'routines', message: 'A rotina precisa ter pelo menos um dia de trabalho.' };
  if (draft.municipality !== '' && !isMunicipality(draft.municipality)) {
    return { ok: false, section: 'holidays', message: 'Município: use só letras, espaços, ponto, apóstrofo e hífen, começando por uma letra (até 60 caracteres).' };
  }
  if (draft.localHolidays.length > MAX_LOCAL_HOLIDAYS) {
    return { ok: false, section: 'holidays', message: `Você pode registrar até ${MAX_LOCAL_HOLIDAYS} feriados locais.` };
  }
  if (draft.exceptions.length > MAX_EXCEPTIONS) {
    return { ok: false, section: 'exceptions', message: `Você pode registrar até ${MAX_EXCEPTIONS} exceções.` };
  }
  let ambiguity: CalendarAmbiguity | null;
  try {
    ambiguity = calendarAmbiguity(workCalendarOf(draft), today);
  } catch {
    // Uma data fora do formato (a interface não deixa digitar; vale para um rascunho de outra origem) dá a mensagem
    // do formato, e não uma exceção sem tratamento (revisão independente 2, M06).
    return { ok: false, section: 'exceptions', message: 'Há exceções sobrepostas ou fora do formato. Revise a lista.' };
  }
  if (ambiguity !== null) {
    return { ok: false, section: ambiguitySection(ambiguity.cause), message: calendarAmbiguityMessage(ambiguity), ambiguity: ambiguity.cause.kind };
  }
  if (!isRecordId(draft.incomeWorkspaceId)) return { ok: false, section: 'income', message: 'Escolha de qual espaço vem a sua renda.' };
  if (draft.excludedIncomeIds.length > MAX_EXCLUDED_INCOME_IDS) {
    return { ok: false, section: 'income', message: `Você pode tirar até ${MAX_EXCLUDED_INCOME_IDS} receitas da estimativa.` };
  }
  try {
    workTimePreferenceFields(draft);
  } catch {
    return { ok: false, section: 'exceptions', message: 'Há exceções sobrepostas ou fora do formato. Revise a lista.' };
  }
  return { ok: true };
};

/** O rascunho é igual ao que está salvo (nada a salvar). */
export const isSameAsSaved = (draft: WorkTimePreference, saved: WorkTimePreference | null): boolean => {
  if (!saved) return false;
  try {
    return JSON.stringify(workTimePreferenceFields(draft)) === JSON.stringify(workTimePreferenceFields(saved));
  } catch {
    return false;
  }
};
