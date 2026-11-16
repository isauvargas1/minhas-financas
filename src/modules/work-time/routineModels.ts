/**
 * Modelo do editor de rotinas (etapa B do assistente e Configurações), sem React: o que a pessoa digita em cada
 * rotina, a conversão para as rotinas do motor de calendário e se houve edição desde a montagem do editor.
 * Módulo PURO, imports com extensão `.ts`: os testes de unidade usam as mesmas funções que a tela
 * (P5-F.1-R2A, S03; antes ficavam dentro de `RoutineEditor.tsx`).
 */
import type { DaySpec, WorkRoutine } from './calendar.ts';
import { isCivilDate } from './dates.ts';
import { OFF_DAY_INPUT, WEEKDAY_LABELS, dayInputFromSpec, parseDayInput, routinesAmbiguityProblem, type DayInput } from './draft.ts';

export type WeeklyModel = { kind: 'weekly'; days: DayInput[]; template: DayInput };
export type CyclicModel = { kind: 'cyclic'; reference: string; workDays: string; restDays: string; day: DayInput };
export type RoutineModel = WeeklyModel | CyclicModel;

const WORK_TEMPLATE: DayInput = { ...OFF_DAY_INPUT, mode: 'window' };

export const modelOf = (routine: WorkRoutine): RoutineModel => {
  if (routine.kind === 'weekly') {
    const firstWorking = routine.days.find((day) => day.kind !== 'off');
    return {
      kind: 'weekly',
      days: routine.days.map((day) => dayInputFromSpec(day)),
      template: firstWorking ? dayInputFromSpec(firstWorking) : { ...WORK_TEMPLATE },
    };
  }
  return {
    kind: 'cyclic',
    reference: routine.reference,
    workDays: String(routine.workDays),
    restDays: String(routine.restDays),
    day: dayInputFromSpec(routine.day),
  };
};

const COUNT = /^\d{1,2}$/;

export type RoutineResult = { ok: true; routine: WorkRoutine } | { ok: false; message: string };

export const routineOf = (model: RoutineModel, index: number): RoutineResult => {
  const label = `Rotina ${index + 1}`;
  if (model.kind === 'weekly') {
    const days: DaySpec[] = [];
    for (let day = 0; day < 7; day += 1) {
      const parsed = parseDayInput(model.days[day]);
      if ('message' in parsed) return { ok: false, message: `${label}, ${WEEKDAY_LABELS[day].toLowerCase()}: ${parsed.message}` };
      days.push(parsed.spec);
    }
    if (days.every((day) => day.kind === 'off')) return { ok: false, message: `${label}: marque pelo menos um dia de trabalho.` };
    return { ok: true, routine: { kind: 'weekly', days } };
  }
  if (!isCivilDate(model.reference)) return { ok: false, message: `${label}: escolha a data de referência da escala.` };
  if (!COUNT.test(model.workDays) || !COUNT.test(model.restDays)) {
    return { ok: false, message: `${label}: informe os dias de trabalho e de folga do ciclo em números inteiros.` };
  }
  const workDays = Number(model.workDays);
  const restDays = Number(model.restDays);
  if (workDays < 1 || workDays > 28 || restDays < 1 || restDays > 28) {
    return { ok: false, message: `${label}: o ciclo vai de 1 a 28 dias de trabalho e de 1 a 28 dias de folga.` };
  }
  const parsed = parseDayInput(model.day.mode === 'off' ? { ...model.day, mode: 'window' } : model.day);
  if ('message' in parsed) return { ok: false, message: `${label}: ${parsed.message}` };
  return { ok: true, routine: { kind: 'cyclic', reference: model.reference, workDays, restDays, day: parsed.spec } };
};

// `edited`: a pessoa mudou os dias ou a escala de alguma rotina desde a montagem do editor. Uma configuração já
// gravada que o editor recusa ao montar (rotinas que se cruzam com intervalo) não é uma edição (revisão 4 da R1, Q02).
export type RoutineEditorResult = { ok: true; routines: WorkRoutine[] } | { ok: false; message: string; edited: boolean };

// O que define as rotinas: os dias de cada semana ou a escala. A jornada para aplicar a vários dias só vale
// quando é aplicada, então mudá-la sozinha não é uma edição das rotinas.
export const routinesKey = (models: readonly RoutineModel[]) =>
  JSON.stringify(models.map((model) => (model.kind === 'weekly' ? { kind: model.kind, days: model.days } : model)));

/** "Aplicar aos dias marcados": a jornada para aplicar a vários dias passa a valer em cada dia de trabalho marcado. */
export const applyTemplate = (model: WeeklyModel): WeeklyModel => ({
  ...model,
  days: model.days.map((input) => (input.mode === 'off' ? input : { ...model.template })),
});

/**
 * O que o editor devolve à tela a cada mudança: as rotinas válidas, ou a mensagem do primeiro problema (digitação
 * inválida ou rotinas que se cruzam com intervalo, sem cálculo seguro das horas), com `edited` comparando com a
 * chave da montagem (`initialKey`). `ambiguity` é o aviso das rotinas que se cruzam, para a tela mostrar.
 */
export const editorResultOf = (
  models: readonly RoutineModel[],
  initialKey: string,
  defaultReference: string,
): { result: RoutineEditorResult; ambiguity: string | null } => {
  const edited = routinesKey(models) !== initialKey;
  const results = models.map(routineOf);
  const failure = results.find((result): result is { ok: false; message: string } => 'message' in result);
  if (failure) return { result: { ok: false, message: failure.message, edited }, ambiguity: null };
  const parsed = results.map((result) => (result as { routine: WorkRoutine }).routine);
  const ambiguity = routinesAmbiguityProblem(parsed, defaultReference);
  return {
    result: ambiguity !== null ? { ok: false, message: ambiguity, edited } : { ok: true, routines: parsed },
    ambiguity,
  };
};
