/**
 * Motor de calendário do tempo de trabalho equivalente (P5-F.1). Módulo
 * PURO: sem React, sem Firebase, imports com extensão `.ts`. O único estado é
 * a memória de uma chamada do conferidor (`callMemo`), criada e desfeita
 * dentro dela: fora da chamada, nada fica guardado.
 *
 * Calcula os minutos de trabalho planejados de cada dia e de cada mês a
 * partir do que o usuário informou: rotinas (semanais ou escalas cíclicas),
 * feriados e exceções. Nada aqui lê dado financeiro, e nada é gravado: o
 * resultado existe só em memória, para dividir a renda do mesmo período.
 *
 * Regras, nesta ordem, para cada dia:
 *
 * 1. **Rotina.** Cada janela (`08:00-17:00/60`) conta no dia em que começa;
 *    um turno que passa da meia-noite (`22:00-06:00`) é do dia em que começa,
 *    e `07:00-07:00` é um turno de 24 h. Janelas que se cruzam (no mesmo dia
 *    ou de um dia para o outro) contam o trecho em comum uma vez só, no dia da
 *    janela que começou antes (a véspera, só quando as janelas dela aconteceram:
 *    ela seguiu a rotina, ou teve jornada reduzida que não corta nada). Uma
 *    rotina repetida é a mesma janela e conta uma vez. O intervalo não tem
 *    horário: uma janela que não cruza nenhuma outra conta a duração menos o
 *    intervalo; uma janela com intervalo que cruza outra só tem cálculo seguro
 *    quando fica toda dentro de janelas sem intervalo (então o intervalo não
 *    tira tempo de trabalho). Em qualquer outro cruzamento com intervalo, as
 *    horas dependem de onde o intervalo cai: o dia fica **ambíguo**, sem
 *    número, e a configuração é recusada (`routinesAmbiguity`). Assim, entre
 *    as configurações com cálculo seguro, acrescentar uma rotina nunca tira
 *    horas: o tempo de trabalho é a união das janelas trabalhadas, que só
 *    cresce (ver `docs/production/evidence/p5f1-r1/`). Uma duração sem horário
 *    (`D480`) soma; duas rotinas sem horário no mesmo dia são sinalizadas,
 *    porque a sobreposição não pode ser medida.
 * 2. **Feriado.** Feriado nacional (base em `holidays.ts`) ou local zera o
 *    dia de trabalho, salvo quando o usuário trabalha em feriados ou marcou
 *    "feriado trabalhado" na data. Feriado em dia sem trabalho não reduz
 *    nada (não há desconto em dobro).
 * 3. **Definição do dia.** "Alteração de escala" define os minutos da data;
 *    "jornada reduzida" limita os minutos dos dias de trabalho do intervalo,
 *    sem dizer quando eles caem. Por isso, quando a redução pode cortar horas
 *    de um turno que passa da meia-noite, o dia seguinte só tem cálculo seguro
 *    se as horas dele forem as mesmas com o turno inteiro ou sem nada dele; senão
 *    fica **ambíguo** e a configuração é recusada (P5-F.1-R2A, S01).
 * 4. **Ausências.** Férias, folga e ausência zeram o dia.
 * 5. **Acréscimos.** Plantão e hora extra somam minutos.
 * 6. **Teto.** Os minutos sem horário (rotina sem horário, plantão, hora extra,
 *    alteração de escala) não levam o dia além de 24 h (1.440 min); o excesso
 *    é sinalizado. As janelas com horário nunca são cortadas: um turno que
 *    começa no dia e vai até o seguinte conta inteiro no dia em que começa,
 *    mesmo que, somado a outra janela do mesmo dia, passe de 24 h (o trecho do
 *    dia seguinte não conta de novo lá).
 *
 * Presença não é hora efetiva: o intervalo sai da janela, e as exceções
 * registram só o tipo e as datas, sem motivo nem dado de saúde.
 */
import { addDays, civilDateFromDayNumber, dayNumber, datesOfMonth, isCivilDate, monthKeyOf, parseCivilDate, shiftMonthKey, weekdayIndex } from './dates.ts';
import { isNationalHolidayBaseCovered, nationalHolidayOn, nationalHolidaysOfYear, type HolidayInfo } from './holidays.ts';

export const DAY_MINUTES = 1440;

export type DaySpec =
  | { kind: 'off' }
  | { kind: 'duration'; minutes: number }
  | { kind: 'window'; start: number; end: number; breakMinutes: number };

export type WorkRoutine =
  | { kind: 'weekly'; days: readonly DaySpec[] }
  | { kind: 'cyclic'; reference: string; workDays: number; restDays: number; day: DaySpec };

export type RangeAbsenceKind = 'vacation' | 'day_off' | 'absence';

export type WorkException =
  | { kind: RangeAbsenceKind; start: string; end: string }
  | { kind: 'holiday_worked'; date: string }
  | { kind: 'on_call' | 'overtime'; date: string; minutes: number }
  | { kind: 'reduced'; start: string; end: string; minutes: number }
  | { kind: 'schedule_change'; date: string; minutes: number };

export type WorkExceptionKind = WorkException['kind'];

export const WORK_EXCEPTION_KINDS: readonly WorkExceptionKind[] = [
  'vacation', 'day_off', 'absence', 'holiday_worked', 'on_call', 'overtime', 'reduced', 'schedule_change',
];

export type LocalHoliday =
  | { kind: 'annual'; month: number; day: number }
  | { kind: 'date'; date: string };

export interface WorkCalendar {
  routines: readonly WorkRoutine[];
  worksOnHolidays: boolean;
  localHolidays: readonly LocalHoliday[];
  exceptions: readonly WorkException[];
}

const OFF: DaySpec = { kind: 'off' };

/** Duração da janela em minutos: fim igual ao início é um turno de 24 h. */
export const windowLength = (start: number, end: number): number =>
  end > start ? end - start : DAY_MINUTES - start + end;

/** Minutos efetivos de uma especificação de dia, sozinha. */
export const daySpecMinutes = (spec: DaySpec): number => {
  if (spec.kind === 'off') return 0;
  if (spec.kind === 'duration') return spec.minutes;
  return Math.max(0, windowLength(spec.start, spec.end) - spec.breakMinutes);
};

/** Especificação da rotina para o dia `day` (`dayNumber`): a mesma regra de `routineSpecOn`, sem a data. */
const routineSpecOnDay = (routine: WorkRoutine, day: number): DaySpec => {
  if (routine.kind === 'weekly') return routine.days[(((day + 3) % 7) + 7) % 7] ?? OFF;
  const length = routine.workDays + routine.restDays;
  const diff = day - dayNumber(routine.reference);
  const position = ((diff % length) + length) % length;
  return position < routine.workDays ? routine.day : OFF;
};

/** Especificação da rotina para a data (escala cíclica conta a partir da data de referência). */
export const routineSpecOn = (routine: WorkRoutine, date: string): DaySpec => {
  if (routine.kind === 'weekly') return routine.days[weekdayIndex(date)] ?? OFF;
  return routineSpecOnDay(routine, dayNumber(date));
};

type Interval = readonly [number, number];

const mergeIntervals = (intervals: readonly Interval[]): Interval[] => {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Array<[number, number]> = [];
  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1];
    if (last && start < last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
};

const totalLength = (intervals: readonly Interval[]): number =>
  intervals.reduce((sum, [start, end]) => sum + (end - start), 0);

/** Comprimento da interseção de duas listas já unidas e ordenadas. */
const intersectionLength = (a: readonly Interval[], b: readonly Interval[]): number => {
  let i = 0;
  let j = 0;
  let total = 0;
  while (i < a.length && j < b.length) {
    const start = Math.max(a[i][0], b[j][0]);
    const end = Math.min(a[i][1], b[j][1]);
    if (end > start) total += end - start;
    if (a[i][1] < b[j][1]) i += 1;
    else j += 1;
  }
  return total;
};

/** Uma janela de rotina no eixo de minutos contínuo (`dayNumber` × 1.440 + minuto do dia). */
interface Occurrence {
  start: number;
  end: number;
  breakMinutes: number;
  /** Posição da (primeira) rotina que tem esta janela. */
  routine: number;
}

interface RoutineDay {
  /** Janelas que começam no dia, sem repetição: a mesma janela com o mesmo intervalo é uma só. */
  windows: Occurrence[];
  durations: number[];
}

const routineDayOf = (routines: readonly WorkRoutine[], day: number): RoutineDay => {
  const windows: Occurrence[] = [];
  const durations: number[] = [];
  routines.forEach((routine, index) => {
    const spec = routineSpecOnDay(routine, day);
    if (spec.kind === 'duration') durations.push(spec.minutes);
    if (spec.kind !== 'window') return;
    const start = day * DAY_MINUTES + spec.start;
    const end = start + windowLength(spec.start, spec.end);
    if (windows.some((other) => other.start === start && other.end === end && other.breakMinutes === spec.breakMinutes)) return;
    windows.push({ start, end, breakMinutes: spec.breakMinutes, routine: index });
  });
  return { windows, durations };
};

const overlaps = (a: Occurrence, b: Occurrence): boolean => Math.min(a.end, b.end) > Math.max(a.start, b.start);

const intervalsOf = (occurrences: readonly Occurrence[]): Interval[] =>
  mergeIntervals(occurrences.map((occurrence): Interval => [occurrence.start, occurrence.end]));

/** A janela fica toda dentro das janelas sem intervalo das outras: o intervalo dela não tira tempo de trabalho. */
const coveredWithoutBreak = (target: Occurrence, others: readonly Occurrence[]): boolean =>
  intersectionLength([[target.start, target.end]], intervalsOf(others.filter((other) => other.breakMinutes === 0))) ===
    target.end - target.start;

interface WindowWork {
  /** Minutos das janelas que contam neste dia. */
  minutes: number;
  /** Minutos das janelas do dia que já contaram na véspera. */
  overlap: number;
  /** As horas dependem de onde cai o intervalo de uma janela que cruza outra: sem cálculo seguro. */
  ambiguous: boolean;
  /**
   * Alguma janela com intervalo cruza outra e só tem cálculo seguro porque fica dentro de janelas sem
   * intervalo (das outras rotinas, da véspera ou do dia seguinte). Só um dia assim pode ficar ambíguo quando
   * um vizinho deixa de seguir a rotina ou o dia abre o período: tirar janelas não cria cruzamento novo.
   */
  covered: boolean;
}

/**
 * Tempo de trabalho das janelas que começam no dia (`own`), com a vizinhança que pode cruzá-las:
 * `previous` e `next` (as janelas da véspera e do dia seguinte que aconteceram, `NeighborWindows`) e
 * `beforePrevious` (a antevéspera, idem), que decide a cobertura das janelas da véspera.
 *
 * O tempo de trabalho é a união das janelas trabalhadas: janela sem intervalo, inteira; janela com
 * intervalo, ela menos um trecho de `breakMinutes` em posição desconhecida. Essa união só não depende
 * da posição dos intervalos quando cada janela com intervalo (a) não cruza nenhuma outra — conta a
 * duração menos o intervalo — ou (b) fica toda dentro das janelas sem intervalo das outras — o
 * intervalo não tira nada, e a janela some na união. Fora disso, as horas variam com a posição do
 * intervalo, e o dia fica ambíguo. O trecho em comum com a véspera conta na véspera (no dia da janela
 * que começou antes), por isso as janelas da véspera que avançam sobre o dia também são conferidas.
 * `involved` recebe as rotinas das janelas que deixaram o dia ambíguo.
 */
const windowWorkOf = (
  own: readonly Occurrence[],
  previous: readonly Occurrence[],
  next: readonly Occurrence[],
  beforePrevious: readonly Occurrence[],
  involved?: Set<number>,
): WindowWork => {
  let ambiguous = false;
  let covered = false;
  const flag = (occurrence: Occurrence, others: readonly Occurrence[]) => {
    ambiguous = true;
    involved?.add(occurrence.routine);
    for (const other of others) if (overlaps(occurrence, other)) involved?.add(other.routine);
  };
  let isolatedMinutes = 0;
  const crossing: Occurrence[] = [];
  const around = [...previous, ...own, ...next];
  for (const occurrence of own) {
    const others = around.filter((other) => other !== occurrence);
    if (!others.some((other) => overlaps(occurrence, other))) {
      isolatedMinutes += occurrence.end - occurrence.start - occurrence.breakMinutes;
      continue;
    }
    if (occurrence.breakMinutes > 0) {
      if (coveredWithoutBreak(occurrence, others)) covered = true;
      else flag(occurrence, others);
    }
    crossing.push(occurrence);
  }
  const previousAround = [...beforePrevious, ...previous, ...own];
  for (const occurrence of previous) {
    if (occurrence.breakMinutes === 0 || !own.some((other) => overlaps(occurrence, other))) continue;
    const others = previousAround.filter((other) => other !== occurrence);
    if (coveredWithoutBreak(occurrence, others)) covered = true;
    else flag(occurrence, others);
  }
  const previousIntervals = intervalsOf(previous);
  const crossingIntervals = intervalsOf(crossing);
  return {
    minutes: isolatedMinutes + totalLength(crossingIntervals) - intersectionLength(crossingIntervals, previousIntervals),
    overlap: intersectionLength(intervalsOf(own), previousIntervals),
    ambiguous,
    covered,
  };
};

/**
 * Trechos de relógio que uma janela trabalhada ocupa, só para o teto de 24 h dos minutos sem horário. O
 * intervalo de uma janela que não cruza outra tem posição desconhecida; aqui ele fica no fim do trecho do
 * dia em que a janela começa (convenção fixa, a mesma em toda configuração). Uma janela com intervalo dentro
 * de janelas sem intervalo não ocupa nada além delas; a que cruza outra sem ficar dentro delas deixa o dia
 * ambíguo, sem horas.
 */
const occupancyPieces = (occurrence: Occurrence): Interval[] => {
  if (occurrence.breakMinutes === 0) return [[occurrence.start, occurrence.end]];
  const midnight = (Math.floor(occurrence.start / DAY_MINUTES) + 1) * DAY_MINUTES;
  const ownEnd = Math.min(occurrence.end, midnight);
  if (occurrence.breakMinutes <= ownEnd - occurrence.start) {
    return [[occurrence.start, ownEnd - occurrence.breakMinutes], [ownEnd, occurrence.end]];
  }
  return [[occurrence.start + occurrence.breakMinutes, occurrence.end]];
};

/**
 * Tempo do dia civil `day` (das 00:00 às 24:00) ocupado pelas janelas `own` (as do próprio dia) e pelo trecho
 * depois da meia-noite das janelas `previous` (as da véspera). Os minutos sem horário (duração, alteração de
 * escala, jornada reduzida, plantão, hora extra) só ocupam o tempo livre que sobra.
 */
const civilOccupancy = (day: number, own: readonly Occurrence[], previous: readonly Occurrence[]): number =>
  intersectionLength(
    mergeIntervals([...own, ...previous].flatMap(occupancyPieces).filter(([start, end]) => end > start)),
    [[day * DAY_MINUTES, (day + 1) * DAY_MINUTES]],
  );

const covers = (start: string, end: string, date: string): boolean => date >= start && date <= end;

/** Feriado da data: nacional da base ou local cadastrado pelo usuário. */
export const holidayOn = (calendar: Pick<WorkCalendar, 'localHolidays'>, date: string): HolidayInfo | null => {
  const national = nationalHolidayOn(date);
  if (national) return national;
  const parsed = parseCivilDate(date);
  if (!parsed) return null;
  const local = calendar.localHolidays.some((holiday) =>
    holiday.kind === 'date'
      ? holiday.date === date
      : holiday.month === parsed.month && holiday.day === parsed.day);
  return local ? { name: 'Feriado local', source: 'local' } : null;
};

interface DayFlags {
  holiday: HolidayInfo | null;
  holidayWorked: boolean;
  scheduleChange: number | null;
  reduced: number | null;
  absence: RangeAbsenceKind | null;
  additions: Array<{ kind: 'on_call' | 'overtime'; minutes: number }>;
}

/**
 * Memória de uma chamada do conferidor (`calendarAmbiguity`, P5-F.1-R2A): ele lê os mesmos dias muitas vezes (cada dia é
 * véspera, dia e dia seguinte de outros), e as bandeiras e as janelas de vizinho de um dia só dependem do calendário e da
 * data. Vale só para o mesmo objeto de calendário e só durante a chamada, que é síncrona: é criada na entrada e desfeita
 * na saída, também com exceção. Fora dela, nada é guardado, e o resultado é o mesmo com ou sem ela.
 */
let callMemo: { calendar: WorkCalendar; flags: Map<string, DayFlags>; neighbors: Map<string, NeighborWindows> } | null = null;

const flagsOf = (calendar: WorkCalendar, date: string): DayFlags => {
  const memo = callMemo !== null && callMemo.calendar === calendar ? callMemo.flags : null;
  const cached = memo?.get(date);
  if (cached) return cached;
  const flags = computeFlags(calendar, date);
  memo?.set(date, flags);
  return flags;
};

const computeFlags = (calendar: WorkCalendar, date: string): DayFlags => {
  const flags: DayFlags = {
    holiday: holidayOn(calendar, date),
    holidayWorked: false,
    scheduleChange: null,
    reduced: null,
    absence: null,
    additions: [],
  };
  for (const entry of calendar.exceptions) {
    switch (entry.kind) {
      case 'vacation':
      case 'day_off':
      case 'absence':
        if (flags.absence === null && covers(entry.start, entry.end, date)) flags.absence = entry.kind;
        break;
      case 'holiday_worked':
        if (entry.date === date) flags.holidayWorked = true;
        break;
      case 'on_call':
      case 'overtime':
        if (entry.date === date) flags.additions.push({ kind: entry.kind, minutes: entry.minutes });
        break;
      case 'reduced':
        if (covers(entry.start, entry.end, date)) flags.reduced = entry.minutes;
        break;
      case 'schedule_change':
        if (entry.date === date) flags.scheduleChange = entry.minutes;
        break;
    }
  }
  return flags;
};

/** A rotina acontece no dia, inteira ou com jornada reduzida (sem feriado de folga, alteração de escala ou ausência). */
const happensWith = (calendar: WorkCalendar, flags: DayFlags): boolean =>
  !(flags.holiday && !calendar.worksOnHolidays && !flags.holidayWorked) &&
  flags.scheduleChange === null &&
  flags.absence === null;

/** O dia seguiu a rotina (sem feriado de folga, definição do dia ou ausência). */
const followsRoutine = (calendar: WorkCalendar, flags: DayFlags): boolean =>
  happensWith(calendar, flags) && flags.reduced === null;

/**
 * Primeiro dia de um mês: o único dia que pode abrir o período da estimativa, e então é contado sem a véspera
 * (`monthPlan` com `periodStart`; o conferidor confere essa vista no início de cada mês).
 */
const opensMonth = (date: string): boolean => date.slice(8, 10) === '01';

/** Janelas da data quando o dia seguiu a rotina; nenhuma, fora disso. */
const followedWindowsOn = (calendar: WorkCalendar, date: string | null): Occurrence[] =>
  date !== null && followsRoutine(calendar, flagsOf(calendar, date)) ? routineDayOf(calendar.routines, dayNumber(date)).windows : [];

/**
 * As janelas de um dia como os vizinhos as veem (`planDay` de outro dia as lê como véspera, dia seguinte ou
 * antevéspera): `windows`, as que podem ter acontecido, e `certain`, se aconteceram mesmo, inteiras.
 * - O dia segue a rotina: todas aconteceram.
 * - Feriado de folga, alteração de escala ou ausência: nenhuma aconteceu (lista vazia).
 * - Jornada reduzida (P5-F.1-R2A, S01): o dia conta o menor entre as horas da rotina e o limite, e o limite não
 *   diz quando elas caem. Se nem o máximo que a rotina dá ao dia passa do limite, a redução não corta nada, e o
 *   dia é o da rotina: todas aconteceram. O máximo são as janelas mais as durações. No primeiro dia de um mês, sem
 *   descontar a véspera: é o que o dia conta quando abre o período (`planDay` sem véspera), e com a véspera ele só
 *   conta menos. Nos outros dias, que nunca abrem o período, descontando só a véspera que segue a rotina (essa
 *   aconteceu com certeza; uma véspera incerta pode não ter levado nada). Assim, a redução que não corta não corta em
 *   nenhum cálculo do dia (revisão independente da R2A, R2A-01 e T13). Fora disso, não se sabe que parte delas
 *   aconteceu (`certain: false`): qualquer parte, de nenhuma a todas.
 */
interface NeighborWindows {
  windows: Occurrence[];
  certain: boolean;
}

const NO_WINDOWS: NeighborWindows = { windows: [], certain: true };

const neighborWindowsOn = (calendar: WorkCalendar, date: string | null): NeighborWindows => {
  if (date === null) return NO_WINDOWS;
  const memo = callMemo !== null && callMemo.calendar === calendar ? callMemo.neighbors : null;
  const cached = memo?.get(date);
  if (cached) return cached;
  const neighbor = computeNeighborWindows(calendar, date);
  memo?.set(date, neighbor);
  return neighbor;
};

const computeNeighborWindows = (calendar: WorkCalendar, date: string): NeighborWindows => {
  const flags = flagsOf(calendar, date);
  if (!happensWith(calendar, flags)) return NO_WINDOWS;
  const routineDay = routineDayOf(calendar.routines, dayNumber(date));
  if (flags.reduced === null || routineDay.windows.length === 0) return { windows: routineDay.windows, certain: true };
  // O máximo das janelas. No primeiro dia de um mês, sem descontar a véspera: no dia que abre o período, `planDay`
  // não tem véspera e conta as janelas inteiras, e com a véspera o dia só conta menos; um máximo com o desconto daria
  // "não corta" num cálculo em que a redução corta (R2A-01). Nos outros dias, sempre contados com a véspera, só a
  // véspera que segue a rotina é descontada (descontar só tira minutos, e uma véspera incerta pode não ter levado
  // nada; T13). O dia seguinte entra só quando segue a rotina: ele não muda os minutos das janelas com cálculo seguro,
  // só pode deixá-las ambíguas, e então a redução fica incerta. Sem a antevéspera, a cobertura das janelas da véspera
  // pode faltar: também deixa a redução incerta, nunca certa a mais.
  const eveWindows = opensMonth(date) ? [] : followedWindowsOn(calendar, addDays(date, -1));
  const most = windowWorkOf(routineDay.windows, eveWindows, followedWindowsOn(calendar, addDays(date, 1)), []);
  const durations = routineDay.durations.reduce((sum, value) => sum + value, 0);
  return { windows: routineDay.windows, certain: !most.ambiguous && most.minutes + durations <= flags.reduced };
};

/** Só as janelas que com certeza aconteceram: as de um vizinho incerto não entram (nem cobrem, nem cruzam). */
const certainWindows = (neighbor: NeighborWindows): Occurrence[] => (neighbor.certain ? neighbor.windows : []);

export type DayOutcome = 'work' | 'rest' | 'holiday_off' | 'absent';

/** Efeito do feriado no dia: tirou trabalho, caiu em dia sem trabalho ou foi trabalhado. */
export type HolidayEffect = 'none' | 'removed_work' | 'rest_day' | 'worked';

export interface DayPlan {
  date: string;
  /** Minutos planejados finais do dia. */
  minutes: number;
  /** Minutos da rotina antes de feriados e exceções. */
  routineMinutes: number;
  /** Minutos que já contaram no turno da véspera. */
  overlapMinutes: number;
  /** Rotinas sem horário que somaram no dia (duas ou mais: sobreposição não medida). */
  untimedRoutines: number;
  /**
   * As horas do dia dependem de onde cai o intervalo de uma janela que cruza outra (`windowWorkOf`), ou de
   * que parte do turno da véspera em jornada reduzida aconteceu (`reducedEve`): sem cálculo seguro. `minutes`
   * e `routineMinutes` não devem ser usados: o mês fica sem horas (`MonthPlan.ambiguousDays`). Pelo intervalo,
   * só marca o dia cujas horas dependem da rotina (não o feriado que tira o dia, a alteração de escala nem a
   * ausência); pela véspera reduzida, também esses, quando o que a véspera ocupa no dia civil muda o teto.
   */
  ambiguous: boolean;
  /**
   * Sem cálculo seguro por causa da véspera (P5-F.1-R2A, S01): ela tem jornada reduzida que pode cortar horas
   * (`NeighborWindows`), e as horas do dia não são as mesmas com o turno dela inteiro e sem nada dele (os dois
   * extremos de qualquer parte que tenha acontecido). Só com `ambiguous`.
   */
  reducedEve: boolean;
  holiday: HolidayInfo | null;
  holidayEffect: HolidayEffect;
  outcome: DayOutcome;
  /** Exceções que mudaram o dia. */
  applied: WorkExceptionKind[];
  /**
   * Os minutos do dia passariam do que cabe nele e foram limitados. Cabem os minutos das janelas do próprio
   * dia depois da meia-noite (até os minutos da rotina que contam, também com a jornada reduzida) e, no resto,
   * o tempo do dia civil (das 00:00 às 24:00) que o trecho depois da meia-noite das janelas da véspera não
   * ocupa. Num dia que segue a rotina, isso é o mesmo que somar aos minutos das janelas o tempo livre do dia
   * civil: minutos de janelas nunca são cortados; os sem horário (duração, alteração de escala, plantão, hora
   * extra) só ocupam o tempo livre.
   */
  capped: boolean;
}

const holidayEffectOf = (calendar: WorkCalendar, flags: DayFlags, routineMinutes: number): HolidayEffect => {
  if (!flags.holiday) return 'none';
  if (routineMinutes === 0) return 'rest_day';
  if (calendar.worksOnHolidays || flags.holidayWorked) return 'worked';
  return 'removed_work';
};

/**
 * `previous`: a véspera, ou `null` no primeiro dia de um período (a janela da estimativa): nada da véspera
 * é descontado nem ocupa o dia, porque o que começou nela fica fora do período.
 *
 * Véspera com jornada reduzida incerta (`NeighborWindows`, P5-F.1-R2A, S01): o dia é calculado com os dois
 * extremos do que dela aconteceu, nenhuma janela e todas. As horas só diminuem quando a véspera ocupa mais
 * (o trecho em comum sai do dia, e o teto dos minutos sem horário fica menor), então qualquer parte que tenha
 * acontecido dá um valor entre os dois. Iguais e com cálculo seguro, o dia vale esse número; senão, fica sem
 * cálculo seguro (`reducedEve`), em vez de um número que poderia contar o mesmo tempo duas vezes.
 */
const planDay = (calendar: WorkCalendar, date: string, previous: string | null): DayPlan => {
  const routineDay = routineDayOf(calendar.routines, dayNumber(date));
  const flags = flagsOf(calendar, date);
  const eve = neighborWindowsOn(calendar, previous);
  const nextWindows = certainWindows(neighborWindowsOn(calendar, addDays(date, 1)));
  const beforeEveWindows = certainWindows(neighborWindowsOn(calendar, previous === null ? null : addDays(previous, -1)));
  const plan = (eveWindows: readonly Occurrence[]) =>
    planDayWith(calendar, date, routineDay, flags, eveWindows, nextWindows, beforeEveWindows);
  if (eve.certain) return plan(eve.windows);
  const none = plan([]);
  const all = plan(eve.windows);
  if (!none.ambiguous && !all.ambiguous && none.minutes === all.minutes) return none;
  // Ambíguo nos dois extremos: o dia já não tinha cálculo seguro pelas próprias janelas.
  return { ...none, ambiguous: true, reducedEve: !(none.ambiguous && all.ambiguous) };
};

/** O plano do dia com as janelas da vizinhança já escolhidas (as da véspera, do dia seguinte e da antevéspera). */
const planDayWith = (
  calendar: WorkCalendar,
  date: string,
  routineDay: RoutineDay,
  flags: DayFlags,
  previousWindows: readonly Occurrence[],
  nextWindows: readonly Occurrence[],
  beforePreviousWindows: readonly Occurrence[],
): DayPlan => {
  // As janelas do dia contam como se o dia seguisse a rotina (são os minutos da rotina antes das
  // exceções); as da vizinhança, só as que aconteceram.
  const work = windowWorkOf(routineDay.windows, previousWindows, nextWindows, beforePreviousWindows);
  const overlap = work.overlap;
  const durationMinutes = routineDay.durations.reduce((sum, value) => sum + value, 0);
  const routineMinutes = work.minutes + durationMinutes;

  // Com o feriado que tira o dia, a alteração de escala ou a ausência, as horas finais não dependem dos
  // minutos da rotina; com a jornada reduzida (o menor dos dois) e nos demais dias, dependem.
  const happens = happensWith(calendar, flags);
  const ambiguous = work.ambiguous && happens;
  // Para o teto: o que o trecho depois da meia-noite das janelas da véspera ocupa no dia civil e os minutos
  // das janelas do próprio dia depois da meia-noite (no dia civil seguinte), quando a rotina acontece (também
  // num dia de jornada reduzida).
  const previousOccupancy = civilOccupancy(dayNumber(date), [], previousWindows);
  const afterMidnight = happens
    ? work.minutes - (civilOccupancy(dayNumber(date), routineDay.windows, previousWindows) - previousOccupancy)
    : 0;
  const holidayEffect = holidayEffectOf(calendar, flags, routineMinutes);
  const applied: WorkExceptionKind[] = [];
  let minutes = routineMinutes;

  if (holidayEffect === 'removed_work') {
    minutes = 0;
  }
  // "Feriado trabalhado" marcado na data (sem a opção de trabalhar em todos os feriados).
  const markedWorked = holidayEffect === 'worked' && !calendar.worksOnHolidays;

  if (flags.scheduleChange !== null) {
    minutes = flags.scheduleChange;
    applied.push('schedule_change');
  } else if (flags.reduced !== null && minutes > flags.reduced) {
    minutes = flags.reduced;
    applied.push('reduced');
  }

  let absent = false;
  if (flags.absence !== null && minutes > 0) {
    minutes = 0;
    absent = true;
    applied.push(flags.absence);
  }
  // Os minutos da rotina que contam (a jornada reduzida inclusive) cabem primeiro no trecho das janelas
  // depois da meia-noite; o resto e os acréscimos, no tempo do dia civil que a véspera não ocupa.
  const windowPart = happens ? Math.min(minutes, afterMidnight) : 0;

  for (const addition of flags.additions) {
    minutes += addition.minutes;
    applied.push(addition.kind);
  }

  // Teto (`DayPlan.capped`). Num dia que segue a rotina, é o mesmo que os minutos das janelas mais o tempo
  // livre do dia civil: as janelas contam sempre, e os sem horário e os acréscimos só até o tempo livre.
  const limit = windowPart + Math.max(0, DAY_MINUTES - previousOccupancy);
  const capped = minutes > limit;
  if (capped) minutes = limit;

  let outcome: DayOutcome = 'rest';
  if (minutes > 0) outcome = 'work';
  else if (absent) outcome = 'absent';
  else if (holidayEffect === 'removed_work' && flags.scheduleChange === null) outcome = 'holiday_off';

  // A classificação do feriado segue os minutos finais do dia, para a memória de cálculo não
  // contradizer as horas: com trabalho no fim (rotina, alteração de escala, plantão ou hora extra),
  // feriado trabalhado; sem trabalho, feriado que tirou o dia só quando foi ele que zerou a rotina,
  // e feriado num dia sem trabalho nos demais casos (folga da rotina, ausência, escala zerada).
  let finalHolidayEffect: HolidayEffect = holidayEffect;
  if (holidayEffect !== 'none') {
    if (minutes > 0) finalHolidayEffect = 'worked';
    else if (holidayEffect === 'removed_work' && flags.scheduleChange === null) finalHolidayEffect = 'removed_work';
    else finalHolidayEffect = 'rest_day';
  }
  // A marca "feriado trabalhado" só conta entre as exceções do mês quando o dia terminou com trabalho.
  if (markedWorked && minutes > 0) applied.push('holiday_worked');

  return {
    date,
    minutes,
    routineMinutes,
    overlapMinutes: overlap,
    untimedRoutines: routineDay.durations.length,
    ambiguous,
    reducedEve: false,
    holiday: flags.holiday,
    holidayEffect: finalHolidayEffect,
    outcome,
    applied,
    capped,
  };
};

/** Plano de uma data. */
export const dayPlan = (calendar: WorkCalendar, date: string): DayPlan => planDay(calendar, date, addDays(date, -1));

export interface HolidayOnDate extends HolidayInfo {
  date: string;
}

export interface MonthPlan {
  month: string;
  /** Minutos planejados do mês inteiro. */
  minutes: number;
  days: DayPlan[];
  /** Dias com trabalho planejado. */
  workDays: number;
  /** Feriados que tiraram um dia de trabalho. */
  holidaysOff: HolidayOnDate[];
  /** Feriados em dia sem trabalho: não reduzem nada. */
  holidaysOnRestDays: HolidayOnDate[];
  /** Feriados que terminaram com trabalho: rotina de quem trabalha em feriados, marca de feriado trabalhado, alteração de escala, plantão ou hora extra. */
  holidaysWorked: HolidayOnDate[];
  /** Dias em que cada exceção mudou o plano. */
  exceptionDays: Record<WorkExceptionKind, number>;
  cappedDays: string[];
  /** Minutos que não contaram em dobro (turno da véspera sobre janela do dia). */
  overlapMinutes: number;
  /** Dias com duas ou mais rotinas sem horário (sobreposição não medida). */
  untimedOverlapDays: string[];
  /**
   * Dias sem cálculo seguro (`DayPlan.ambiguous`): com algum, `minutes` não vale, e o mês não tem horas
   * (a estimativa fica indisponível; a interface não mostra o total).
   */
  ambiguousDays: string[];
  /** Dos dias sem cálculo seguro, os que o são por causa da véspera em jornada reduzida (`DayPlan.reducedEve`). */
  reducedEveDays: string[];
  /** O ano do mês está coberto pela base de feriados nacionais. */
  nationalHolidayBaseCovered: boolean;
}

const emptyExceptionDays = (): Record<WorkExceptionKind, number> =>
  Object.fromEntries(WORK_EXCEPTION_KINDS.map((kind) => [kind, 0])) as Record<WorkExceptionKind, number>;

/**
 * Plano do mês `AAAA-MM` inteiro, dia a dia. `periodStart`: o mês abre um período (o primeiro mês da janela
 * da estimativa); o primeiro dia não desconta o que começou na véspera, que fica fora do período, e o total
 * do período nunca cai quando uma rotina válida é acrescentada (P5-F.1-R1, B02).
 */
export const monthPlan = (calendar: WorkCalendar, monthKey: string, options: { periodStart?: boolean } = {}): MonthPlan => {
  const days = datesOfMonth(monthKey).map((date, index) =>
    planDay(calendar, date, index === 0 && options.periodStart === true ? null : addDays(date, -1)));
  const plan: MonthPlan = {
    month: monthKey,
    minutes: 0,
    days,
    workDays: 0,
    holidaysOff: [],
    holidaysOnRestDays: [],
    holidaysWorked: [],
    exceptionDays: emptyExceptionDays(),
    cappedDays: [],
    overlapMinutes: 0,
    untimedOverlapDays: [],
    ambiguousDays: [],
    reducedEveDays: [],
    nationalHolidayBaseCovered: isNationalHolidayBaseCovered(Number(monthKey.slice(0, 4))),
  };
  for (const day of days) {
    plan.minutes += day.minutes;
    if (day.minutes > 0) plan.workDays += 1;
    if (day.holiday) {
      const entry = { date: day.date, ...day.holiday };
      if (day.holidayEffect === 'removed_work') plan.holidaysOff.push(entry);
      else if (day.holidayEffect === 'worked') plan.holidaysWorked.push(entry);
      else plan.holidaysOnRestDays.push(entry);
    }
    for (const kind of day.applied) plan.exceptionDays[kind] += 1;
    if (day.capped) plan.cappedDays.push(day.date);
    plan.overlapMinutes += day.overlapMinutes;
    if (day.untimedRoutines >= 2) plan.untimedOverlapDays.push(day.date);
    if (day.ambiguous) plan.ambiguousDays.push(day.date);
    if (day.ambiguous && day.reducedEve) plan.reducedEveDays.push(day.date);
  }
  return plan;
};

// ------------------------------------------------------------------ rotinas sem cálculo seguro

export interface RoutinesAmbiguity {
  /** Um dia em que as rotinas ficam sem cálculo seguro (o primeiro a partir da data pedida). */
  date: string;
  /** Posições (a partir de 0) das rotinas com janelas que se cruzam nesse dia. */
  routines: number[];
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** Primeiro e último dia conferidos: a vizinhança (antevéspera e dia seguinte) fica dentro de 2000–2099. */
const FIRST_CHECKED_DAY = dayNumber('2000-01-03');
const LAST_CHECKED_DAY = dayNumber('2099-12-30');

/**
 * Varredura das rotinas sozinhas num período inteiro (`mmc(7, ciclos)` dias ou todo o intervalo 2000–2099):
 * o primeiro dia ambíguo a partir de `from` e se algum dia tem janela com intervalo coberta (`covered`).
 */
const scanRoutines = (routines: readonly WorkRoutine[], from: string): { ambiguity: RoutinesAmbiguity | null; covered: boolean } => {
  const specs = routines.map((routine) => (routine.kind === 'weekly' ? routine.days : [routine.day]));
  if (!specs.some((days) => days.some((spec) => spec.kind === 'window' && spec.breakMinutes > 0))) return { ambiguity: null, covered: false };
  const period = routines.reduce((length, routine) => {
    const cycle = routine.kind === 'weekly' ? 7 : routine.workDays + routine.restDays;
    return (length / gcd(length, cycle)) * cycle;
  }, 1);
  const span = LAST_CHECKED_DAY - FIRST_CHECKED_DAY + 1;
  const start = Math.min(Math.max(isCivilDate(from) ? dayNumber(from) : FIRST_CHECKED_DAY, FIRST_CHECKED_DAY), LAST_CHECKED_DAY);
  const days = new Map<number, Occurrence[]>();
  const windowsOf = (day: number): Occurrence[] => {
    let windows = days.get(day);
    if (!windows) {
      windows = routineDayOf(routines, day).windows;
      days.set(day, windows);
      if (days.size > 8) days.delete(days.keys().next().value as number);
    }
    return windows;
  };
  let covered = false;
  for (let offset = 0; offset < Math.min(period, span); offset += 1) {
    const day = FIRST_CHECKED_DAY + ((start - FIRST_CHECKED_DAY + offset) % span);
    const own = windowsOf(day);
    if (own.length === 0) continue;
    const involved = new Set<number>();
    const work = windowWorkOf(own, windowsOf(day - 1), windowsOf(day + 1), windowsOf(day - 2), involved);
    if (work.ambiguous) {
      const date = civilDateFromDayNumber(day) as string;
      return { ambiguity: { date, routines: [...involved].sort((a, b) => a - b) }, covered };
    }
    if (work.covered) covered = true;
  }
  return { ambiguity: null, covered };
};

/**
 * As rotinas, sozinhas (todos os dias seguindo a rotina, sem feriados nem exceções), deixam algum dia
 * sem cálculo seguro? A combinação de rotinas semanais e escalas se repete a cada
 * `mmc(7, ciclos)` dias, então basta conferir um período inteiro (ou todo o intervalo 2000–2099,
 * quando o período é maior), começando em `from`. Sem cruzamento entre janelas, nem com rotina de
 * intervalo, nada a conferir. Devolve o primeiro dia ambíguo, ou `null`.
 */
export const routinesAmbiguity = (routines: readonly WorkRoutine[], from: string): RoutinesAmbiguity | null =>
  scanRoutines(routines, from).ambiguity;

/** Por que um dia fica sem cálculo seguro com o calendário inteiro (rotinas, feriados e exceções). */
export type CalendarAmbiguityCause =
  /** As rotinas sozinhas (`routinesAmbiguity`). */
  | { kind: 'routines' }
  /** O primeiro dia do período da estimativa: o que começou na véspera fica fora dele. */
  | { kind: 'period_start' }
  /** Um dia vizinho sem a rotina (feriado de folga ou exceção) tira a janela que cobria o intervalo. */
  | { kind: 'neighbor'; date: string; reason: 'holiday' | WorkExceptionKind; holiday: string | null }
  /**
   * A véspera (`date`) tem jornada reduzida que pode cortar horas de um turno que passa da meia-noite, e as horas
   * do dia mudam conforme a parte desse turno que aconteceu (`DayPlan.reducedEve`, P5-F.1-R2A, S01). Aqui,
   * `routines` são as rotinas das janelas da véspera que passam da meia-noite.
   */
  | { kind: 'reduced_eve'; date: string };

export interface CalendarAmbiguity extends RoutinesAmbiguity {
  cause: CalendarAmbiguityCause;
}

/** Rotinas das janelas que deixam a data ambígua, com as entradas de `planDay` (a véspera incerta, sem as janelas dela). */
const involvedOn = (calendar: WorkCalendar, date: string, previous: string | null): number[] => {
  const involved = new Set<number>();
  windowWorkOf(
    routineDayOf(calendar.routines, dayNumber(date)).windows,
    certainWindows(neighborWindowsOn(calendar, previous)),
    certainWindows(neighborWindowsOn(calendar, addDays(date, 1))),
    certainWindows(neighborWindowsOn(calendar, previous === null ? null : addDays(previous, -1))),
    involved,
  );
  return [...involved].sort((a, b) => a - b);
};

/** Janelas do dia `day` que passam da meia-noite (ocupam o dia civil seguinte). */
const passingMidnight = (windows: readonly Occurrence[], day: number): Occurrence[] =>
  windows.filter((occurrence) => occurrence.end > (day + 1) * DAY_MINUTES);

/** Alguma rotina tem janela que passa da meia-noite (termina depois das 24:00 do dia em que começa). */
const routinesPassMidnight = (routines: readonly WorkRoutine[]): boolean =>
  routines.some((routine) => (routine.kind === 'weekly' ? routine.days : [routine.day])
    .some((spec) => spec.kind === 'window' && spec.start + windowLength(spec.start, spec.end) > DAY_MINUTES));

/** Motivo de a data não seguir a rotina (para a mensagem), ou `null` quando segue. */
const suspensionOf = (calendar: WorkCalendar, date: string): { reason: 'holiday' | WorkExceptionKind; holiday: string | null } | null => {
  const flags = flagsOf(calendar, date);
  if (followsRoutine(calendar, flags)) return null;
  if (flags.absence !== null) return { reason: flags.absence, holiday: null };
  if (flags.scheduleChange !== null) return { reason: 'schedule_change', holiday: null };
  if (flags.reduced !== null) return { reason: 'reduced', holiday: null };
  return { reason: 'holiday', holiday: flags.holiday?.name ?? null };
};

/** Rotinas das janelas da véspera `eve` que passam da meia-noite: as do turno que pode ter acontecido só em parte. */
const eveRoutinesOn = (calendar: WorkCalendar, eve: string): number[] => {
  const day = dayNumber(eve);
  return [...new Set(passingMidnight(routineDayOf(calendar.routines, day).windows, day).map((occurrence) => occurrence.routine))]
    .sort((a, b) => a - b);
};

/**
 * A configuração inteira deixa algum dia sem cálculo seguro? Além das rotinas sozinhas
 * (`routinesAmbiguity`), as horas de um dia só dependem do resto do calendário em três casos:
 * - o dia abre o período da estimativa (o primeiro dia do primeiro mês): a véspera fica de fora;
 * - um dos vizinhos que `planDay` lê (a antevéspera, a véspera e o dia seguinte) não segue a rotina
 *   (feriado de folga, alteração de escala, jornada reduzida, férias, folga ou ausência) e tira uma janela
 *   que cobria o intervalo de outra (só com janela com intervalo coberta, `WindowWork.covered`);
 * - a véspera tem jornada reduzida incerta com janela que passa da meia-noite (`DayPlan.reducedEve`): as
 *   horas do dia podem mudar com a parte dessa janela que aconteceu, mesmo sem intervalo nenhum.
 * Nos demais dias, as entradas de `planDay` são as mesmas que `routinesAmbiguity` já conferiu. Por isso
 * basta conferir, com o próprio `planDay`, o primeiro dia de cada mês, os dias vizinhos de cada dia sem a
 * rotina e o dia seguinte a cada jornada reduzida, de 12 meses antes do mês de `today` (a janela mais longa
 * da estimativa) até 2099. Devolve o primeiro dia ambíguo a partir de `today` (ou, sem nenhum, o primeiro
 * antes dele), ou `null`.
 */
export const calendarAmbiguity = (calendar: WorkCalendar, today: string): CalendarAmbiguity | null => {
  const outer = callMemo;
  callMemo = { calendar, flags: new Map(), neighbors: new Map() };
  try {
    return checkCalendar(calendar, today);
  } finally {
    callMemo = outer;
  }
};

const checkCalendar = (calendar: WorkCalendar, today: string): CalendarAmbiguity | null => {
  const scan = scanRoutines(calendar.routines, today);
  if (scan.ambiguity !== null) return { ...scan.ambiguity, cause: { kind: 'routines' } };
  // A véspera reduzida só pesa no dia seguinte quando alguma janela passa da meia-noite (`reducedEve`).
  const reducedEves = calendar.exceptions.some((entry) => entry.kind === 'reduced') && routinesPassMidnight(calendar.routines);
  // Sem janela com intervalo coberta, tirar vizinhos não cria ambiguidade (`WindowWork.covered`).
  if (!scan.covered && !reducedEves) return null;
  const routineWindows = (day: number) => routineDayOf(calendar.routines, day).windows;
  // O dia pode mudar só se, com as rotinas sozinhas, tem janela com intervalo coberta.
  const mayChange = (day: number): boolean =>
    windowWorkOf(routineWindows(day), routineWindows(day - 1), routineWindows(day + 1), routineWindows(day - 2)).covered;
  const todayDay = Math.min(Math.max(isCivilDate(today) ? dayNumber(today) : FIRST_CHECKED_DAY, FIRST_CHECKED_DAY), LAST_CHECKED_DAY);
  const todayDate = civilDateFromDayNumber(todayDay) as string;
  const firstMonth = shiftMonthKey(monthKeyOf(todayDate), -12) ?? monthKeyOf(todayDate);
  const first = Math.max(FIRST_CHECKED_DAY, dayNumber(`${firstMonth}-01`));
  const last = LAST_CHECKED_DAY;
  const happens = (date: string): boolean => happensWith(calendar, flagsOf(calendar, date));
  let found: CalendarAmbiguity | null = null;
  const consider = (day: number, result: () => CalendarAmbiguity) => {
    if (found !== null) {
      const foundDay = dayNumber(found.date);
      const better = (day >= todayDay) === (foundDay >= todayDay) ? day < foundDay : day >= todayDay;
      if (!better) return;
    }
    found = result();
  };
  /** A causa na véspera reduzida, com as rotinas do turno dela que passa da meia-noite. */
  const reducedEveAt = (date: string): CalendarAmbiguity => {
    const eve = addDays(date, -1) as string;
    return { date, routines: eveRoutinesOn(calendar, eve), cause: { kind: 'reduced_eve', date: eve } };
  };
  if (scan.covered) {
    // Dias sem a rotina que podem mudar as entradas de `planDay` de um dia de [first, last].
    const suspended = new Set<number>();
    const addRange = (start: number, end: number) => {
      for (let day = Math.max(start, first - 2); day <= Math.min(end, last + 1); day += 1) suspended.add(day);
    };
    if (!calendar.worksOnHolidays) {
      const firstYear = Number(civilDateFromDayNumber(first)?.slice(0, 4));
      const lastYear = Number(civilDateFromDayNumber(last)?.slice(0, 4));
      for (let year = firstYear; year <= lastYear; year += 1) {
        for (const holiday of nationalHolidaysOfYear(year)) addRange(dayNumber(holiday.date), dayNumber(holiday.date));
        for (const holiday of calendar.localHolidays) {
          const date = holiday.kind === 'date'
            ? (Number(holiday.date.slice(0, 4)) === year ? holiday.date : null)
            : `${year}-${String(holiday.month).padStart(2, '0')}-${String(holiday.day).padStart(2, '0')}`;
          if (date !== null && isCivilDate(date)) addRange(dayNumber(date), dayNumber(date));
        }
      }
    }
    for (const entry of calendar.exceptions) {
      if (entry.kind === 'schedule_change') addRange(dayNumber(entry.date), dayNumber(entry.date));
      else if (entry.kind === 'reduced' || entry.kind === 'vacation' || entry.kind === 'day_off' || entry.kind === 'absence') {
        addRange(dayNumber(entry.start), dayNumber(entry.end));
      }
    }
    const candidates = new Set<number>();
    for (const day of suspended) {
      if (suspensionOf(calendar, civilDateFromDayNumber(day) as string) === null) continue;
      for (const near of [day - 1, day + 1, day + 2]) if (near >= first && near <= last) candidates.add(near);
    }
    for (const day of [...candidates].sort((a, b) => a - b)) {
      const date = civilDateFromDayNumber(day) as string;
      if (!mayChange(day) || !happens(date)) continue;
      const plan = planDay(calendar, date, addDays(date, -1));
      if (!plan.ambiguous) continue;
      consider(day, () => {
        if (plan.reducedEve) return reducedEveAt(date);
        const near = [day - 1, day + 1, day - 2]
          .map((other) => ({ date: civilDateFromDayNumber(other) as string }))
          .map((other) => ({ ...other, suspension: suspensionOf(calendar, other.date) }))
          .find((other) => other.suspension !== null);
        const cause: CalendarAmbiguityCause = near?.suspension
          ? { kind: 'neighbor', date: near.date, reason: near.suspension.reason, holiday: near.suspension.holiday }
          : { kind: 'routines' };
        return { date, routines: involvedOn(calendar, date, addDays(date, -1)), cause };
      });
    }
    for (let month = monthKeyOf(civilDateFromDayNumber(first) as string); month !== null && dayNumber(`${month}-01`) <= last; month = shiftMonthKey(month, 1)) {
      const date = `${month}-01`;
      const day = dayNumber(date);
      if (day < first || !mayChange(day) || !happens(date) || !planDay(calendar, date, null).ambiguous) continue;
      if (planDay(calendar, date, addDays(date, -1)).ambiguous) continue; // já entre os vizinhos ou as vésperas reduzidas
      consider(day, () => ({ date, routines: involvedOn(calendar, date, null), cause: { kind: 'period_start' } }));
    }
  }
  if (reducedEves) {
    // O dia seguinte a cada jornada reduzida com janela que passa da meia-noite (P5-F.1-R2A, S01). Aqui não há
    // atalho por intervalo: o caso acontece com janelas sem intervalo. Nem filtro pelo dia seguinte: até um dia sem
    // a rotina muda, quando o que a véspera ocupa no dia civil dele muda o teto dos minutos sem horário.
    const eves = new Set<number>();
    for (const entry of calendar.exceptions) {
      if (entry.kind !== 'reduced') continue;
      for (let day = Math.max(dayNumber(entry.start), first - 1); day <= Math.min(dayNumber(entry.end), last - 1); day += 1) eves.add(day);
    }
    for (const eveDay of [...eves].sort((a, b) => a - b)) {
      if (passingMidnight(routineDayOf(calendar.routines, eveDay).windows, eveDay).length === 0) continue;
      const eve = civilDateFromDayNumber(eveDay) as string;
      if (neighborWindowsOn(calendar, eve).certain) continue;
      const date = civilDateFromDayNumber(eveDay + 1) as string;
      const plan = planDay(calendar, date, eve);
      if (plan.ambiguous && plan.reducedEve) consider(eveDay + 1, () => reducedEveAt(date));
    }
  }
  return found;
};
