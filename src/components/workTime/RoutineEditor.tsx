import React, { useEffect, useMemo, useRef, useState } from 'react';

import { DeleteIcon, PlusIcon } from '../Icons.tsx';
import { daySpecMinutes, type WorkRoutine } from '../../modules/work-time/calendar';
import {
  CYCLE_PRESETS,
  DEFAULT_WEEKLY_ROUTINE,
  WEEKDAY_LABELS,
  WEEKDAY_SHORT_LABELS,
  dayInputFromSpec,
  formatDuration,
  parseDayInput,
  type DayInput,
} from '../../modules/work-time/draft';
import { MAX_ROUTINES } from '../../modules/work-time/grammar';
import {
  applyTemplate,
  editorResultOf,
  modelOf,
  routineOf,
  routinesKey,
  type RoutineEditorResult,
  type RoutineModel,
} from '../../modules/work-time/routineModels';
import {
  cardClass,
  compactInputClass,
  errorTextClass,
  helpTextClass,
  labelClass,
  linkButtonClass,
  secondaryButtonClass,
} from './ui';

/**
 * Rotinas de trabalho (etapa B do assistente e Configurações). O editor
 * guarda o que a pessoa digita e devolve as rotinas válidas, ou a mensagem
 * do primeiro problema, a cada mudança. Nenhum dia é presumido de folga: a
 * semana começa como a pessoa marcar.
 */

// O modelo, a conversão para as rotinas e o resultado com `edited` ficam em `routineModels.ts` (P5-F.1-R2A, S03).
export type { RoutineEditorResult };

const DayFields: React.FC<{
  idPrefix: string;
  value: DayInput;
  onChange: (value: DayInput) => void;
  allowOff?: boolean;
  invalid?: boolean;
}> = ({ idPrefix, value, onChange, allowOff = false, invalid = false }) => {
  const parsed = parseDayInput(value);
  const minutes = parsed.ok ? daySpecMinutes(parsed.spec) : null;
  return (
    <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4">
      <div className="col-span-2 sm:col-span-1">
        <label htmlFor={`${idPrefix}-mode`} className="mb-1 block text-xs text-muted">Como informar</label>
        <select
          id={`${idPrefix}-mode`}
          value={value.mode}
          onChange={(event) => onChange({ ...value, mode: event.target.value as DayInput['mode'] })}
          className={compactInputClass}
        >
          {allowOff && <option value="off">Não trabalho</option>}
          <option value="window">Início e fim</option>
          <option value="duration">Só a duração</option>
        </select>
      </div>
      {value.mode === 'window' && (
        <>
          <div>
            <label htmlFor={`${idPrefix}-start`} className="mb-1 block text-xs text-muted">Início</label>
            <input id={`${idPrefix}-start`} type="time" step={60} value={value.start} aria-invalid={invalid || undefined}
              onChange={(event) => onChange({ ...value, start: event.target.value })} className={compactInputClass} />
          </div>
          <div>
            <label htmlFor={`${idPrefix}-end`} className="mb-1 block text-xs text-muted">Fim</label>
            <input id={`${idPrefix}-end`} type="time" step={60} value={value.end} aria-invalid={invalid || undefined}
              onChange={(event) => onChange({ ...value, end: event.target.value })} className={compactInputClass} />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label htmlFor={`${idPrefix}-break`} className="mb-1 block text-xs text-muted">Intervalo (min)</label>
            <input id={`${idPrefix}-break`} type="text" inputMode="numeric" autoComplete="off" value={value.breakMinutes}
              aria-invalid={invalid || undefined}
              onChange={(event) => onChange({ ...value, breakMinutes: event.target.value })} className={compactInputClass} />
          </div>
        </>
      )}
      {value.mode === 'duration' && (
        <>
          <div>
            <label htmlFor={`${idPrefix}-hours`} className="mb-1 block text-xs text-muted">Horas</label>
            <input id={`${idPrefix}-hours`} type="text" inputMode="numeric" autoComplete="off" value={value.hours}
              aria-invalid={invalid || undefined}
              onChange={(event) => onChange({ ...value, hours: event.target.value })} className={compactInputClass} />
          </div>
          <div>
            <label htmlFor={`${idPrefix}-minutes`} className="mb-1 block text-xs text-muted">Minutos</label>
            <input id={`${idPrefix}-minutes`} type="text" inputMode="numeric" autoComplete="off" value={value.minutes}
              aria-invalid={invalid || undefined}
              onChange={(event) => onChange({ ...value, minutes: event.target.value })} className={compactInputClass} />
          </div>
        </>
      )}
      {value.mode !== 'off' && (
        <p className="col-span-2 self-end text-xs text-muted sm:col-span-4" aria-live="polite">
          {minutes !== null ? `Horas efetivas: ${formatDuration(minutes)}` : 'Confira os campos deste dia.'}
          {value.mode === 'window' && parsed.ok && parsed.spec.kind === 'window' && parsed.spec.end <= parsed.spec.start && ' (termina no dia seguinte)'}
        </p>
      )}
    </div>
  );
};

const RoutineEditor: React.FC<{
  idPrefix: string;
  routines: readonly WorkRoutine[];
  onChange: (result: RoutineEditorResult) => void;
  defaultReference: string;
}> = ({ idPrefix, routines, onChange, defaultReference }) => {
  const [initialModels] = useState<RoutineModel[]>(() => routines.map(modelOf));
  const [models, setModels] = useState<RoutineModel[]>(initialModels);
  const initialKey = useMemo(() => routinesKey(initialModels), [initialModels]);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // As rotinas, todas válidas, que se cruzam com intervalo no trecho em comum: sem cálculo seguro das
  // horas (`routinesAmbiguity`), a combinação é recusada com a mensagem, em vez de um número.
  const combined = useMemo(() => editorResultOf(models, initialKey, defaultReference), [models, defaultReference, initialKey]);

  useEffect(() => {
    onChangeRef.current(combined.result);
  }, [combined]);

  const update = (index: number, model: RoutineModel) =>
    setModels((current) => current.map((item, position) => (position === index ? model : item)));

  return (
    <div className="space-y-4">
      {models.map((model, index) => {
        const result = routineOf(model, index);
        const prefix = `${idPrefix}-r${index}`;
        const weeklyMinutes = model.kind === 'weekly' && result.ok && result.routine.kind === 'weekly'
          ? result.routine.days.reduce((sum, day) => sum + daySpecMinutes(day), 0)
          : null;
        return (
          <fieldset key={index} className={`${cardClass} min-w-0 space-y-4`} data-testid={`routine-${index}`}>
            <legend className="sr-only">Rotina {index + 1}</legend>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-bold text-on-surface" aria-hidden="true">Rotina {index + 1}</p>
              <div role="radiogroup" aria-label={`Tipo da rotina ${index + 1}`} className="flex flex-wrap gap-4">
                {([['weekly', 'Semanal'], ['cyclic', 'Escala cíclica']] as const).map(([kind, label]) => (
                  <label key={kind} className="inline-flex cursor-pointer items-center gap-2 text-sm text-on-surface">
                    <input
                      type="radio"
                      name={`${prefix}-kind`}
                      checked={model.kind === kind}
                      onChange={() => update(index, kind === 'weekly'
                        ? modelOf(DEFAULT_WEEKLY_ROUTINE)
                        : { kind: 'cyclic', reference: defaultReference, workDays: '1', restDays: '1', day: dayInputFromSpec(CYCLE_PRESETS[0].day) })}
                      className="h-4 w-4 text-primary focus:ring-primary"
                    />
                    {label}
                  </label>
                ))}
              </div>
              {models.length > 1 && (
                <button type="button" className={`${linkButtonClass} inline-flex items-center gap-1`}
                  onClick={() => setModels((current) => current.filter((_, position) => position !== index))}>
                  <DeleteIcon className="h-4 w-4" aria-hidden="true" /> Remover rotina {index + 1}
                </button>
              )}
            </div>

            {model.kind === 'weekly' && (
              <>
                <fieldset className="min-w-0">
                  <legend className={labelClass}>Quais dias da semana você costuma trabalhar?</legend>
                  <div className="flex flex-wrap gap-2">
                    {WEEKDAY_SHORT_LABELS.map((short, day) => {
                      const checked = model.days[day].mode !== 'off';
                      return (
                        <label key={short}
                          className={`relative inline-flex min-w-[3.25rem] cursor-pointer items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-sm focus-within:ring-2 focus-within:ring-primary ${checked ? 'border-primary bg-primary/10 font-bold text-on-surface' : 'border-border text-muted'}`}>
                          {/* O controle cobre o chip: recebe o clique e o teclado; o texto visível é só a abreviação. */}
                          <input
                            type="checkbox"
                            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                            checked={checked}
                            aria-label={WEEKDAY_LABELS[day]}
                            onChange={() => update(index, {
                              ...model,
                              days: model.days.map((input, position) => (position === day
                                ? (checked ? { ...input, mode: 'off' } : { ...model.template })
                                : input)),
                            })}
                          />
                          <span aria-hidden="true">{short}</span>
                        </label>
                      );
                    })}
                  </div>
                  <p className={helpTextClass}>Nenhum dia é presumido de folga: marque também sábado ou domingo, se trabalhar.</p>
                </fieldset>

                <div className="rounded-lg border border-dashed border-border p-3" role="group" aria-labelledby={`${prefix}-template-label`}>
                  <p id={`${prefix}-template-label`} className="mb-2 text-xs font-bold uppercase text-muted">Jornada para aplicar a vários dias</p>
                  <DayFields idPrefix={`${prefix}-template`} value={model.template}
                    onChange={(template) => update(index, { ...model, template: template.mode === 'off' ? { ...template, mode: 'window' } : template })} />
                  <button
                    type="button"
                    className={`${secondaryButtonClass} mt-3 text-sm`}
                    disabled={!parseDayInput(model.template).ok || model.days.every((day) => day.mode === 'off')}
                    onClick={() => update(index, applyTemplate(model))}
                  >
                    Aplicar aos dias marcados
                  </button>
                </div>

                <div className="space-y-3">
                  {model.days.map((input, day) => (input.mode === 'off' ? null : (
                    <div key={day} className="min-w-0 border-t border-border pt-3" role="group" aria-labelledby={`${prefix}-d${day}-label`}>
                      <p id={`${prefix}-d${day}-label`} className="mb-2 text-sm font-medium text-on-surface">{WEEKDAY_LABELS[day]}</p>
                      <DayFields idPrefix={`${prefix}-d${day}`} value={input} allowOff
                        invalid={!parseDayInput(input).ok}
                        onChange={(value) => update(index, {
                          ...model,
                          days: model.days.map((item, position) => (position === day ? value : item)),
                        })} />
                    </div>
                  )))}
                </div>
                {weeklyMinutes !== null && (
                  <p className="text-sm text-on-surface" data-testid={`routine-${index}-weekly-total`}>
                    Semana típica desta rotina: <strong>{formatDuration(weeklyMinutes)}</strong>
                  </p>
                )}
              </>
            )}

            {model.kind === 'cyclic' && (
              <>
                <fieldset className="min-w-0">
                  <legend className={labelClass}>Escalas comuns</legend>
                  <div className="flex flex-wrap gap-2">
                    {CYCLE_PRESETS.map((preset) => (
                      <button key={preset.id} type="button" title={preset.description}
                        className="rounded-lg border border-border px-3 py-1.5 text-sm text-on-surface hover:bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                        onClick={() => update(index, {
                          ...model,
                          workDays: String(preset.workDays),
                          restDays: String(preset.restDays),
                          day: dayInputFromSpec(preset.day),
                        })}>
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label htmlFor={`${prefix}-reference`} className="mb-1 block text-xs text-muted">Primeiro dia de trabalho do ciclo</label>
                    <input id={`${prefix}-reference`} type="date" min="2000-01-01" max="2099-12-31" value={model.reference}
                      onChange={(event) => update(index, { ...model, reference: event.target.value })} className={compactInputClass} />
                  </div>
                  <div>
                    <label htmlFor={`${prefix}-work`} className="mb-1 block text-xs text-muted">Dias de trabalho seguidos</label>
                    <input id={`${prefix}-work`} type="text" inputMode="numeric" value={model.workDays}
                      onChange={(event) => update(index, { ...model, workDays: event.target.value })} className={compactInputClass} />
                  </div>
                  <div>
                    <label htmlFor={`${prefix}-rest`} className="mb-1 block text-xs text-muted">Dias de folga seguidos</label>
                    <input id={`${prefix}-rest`} type="text" inputMode="numeric" value={model.restDays}
                      onChange={(event) => update(index, { ...model, restDays: event.target.value })} className={compactInputClass} />
                  </div>
                </div>
                <div role="group" aria-labelledby={`${prefix}-day-label`}>
                  <p id={`${prefix}-day-label`} className="mb-2 text-sm font-medium text-on-surface">Jornada de cada dia de trabalho</p>
                  <DayFields idPrefix={`${prefix}-day`} value={model.day.mode === 'off' ? { ...model.day, mode: 'window' } : model.day}
                    onChange={(day) => update(index, { ...model, day })} />
                </div>
                <p className={helpTextClass}>
                  Exemplo: 12×36 é um dia de trabalho de 12 horas e um dia de folga. Um turno que passa da meia-noite conta no dia em que começa.
                </p>
              </>
            )}

            {'message' in result && <p className={errorTextClass} role="alert">{result.message}</p>}
          </fieldset>
        );
      })}

      {combined.ambiguity !== null && (
        <p className={errorTextClass} role="alert" data-testid="routines-ambiguity">{combined.ambiguity}</p>
      )}

      {models.length < MAX_ROUTINES && (
        <button type="button" className={`${secondaryButtonClass} inline-flex items-center gap-2 text-sm`}
          onClick={() => setModels((current) => [...current, modelOf(DEFAULT_WEEKLY_ROUTINE)])}>
          <PlusIcon className="h-4 w-4" aria-hidden="true" /> Adicionar outra rotina
        </button>
      )}
      <p className={helpTextClass}>
        Use mais de uma rotina para atividades diferentes (por exemplo, dois trabalhos). Se os horários se cruzarem, o tempo em comum conta uma vez só. Informe horas efetivas: o intervalo é descontado uma vez. Uma rotina com intervalo só pode cruzar outra se ficar inteira dentro de horários sem intervalo, porque não dá para saber onde cai a pausa.
      </p>
    </div>
  );
};

export default RoutineEditor;
