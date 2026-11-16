import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';

import { ChevronLeftIcon, ChevronRightIcon, DeleteIcon } from '../Icons.tsx';
import {
  WORK_EXCEPTION_KINDS,
  holidayOn,
  monthPlan,
  type WorkCalendar,
  type WorkException,
  type WorkExceptionKind,
} from '../../modules/work-time/calendar';
import { addDays, monthKeyOf, shiftMonthKey, weekdayIndex } from '../../modules/work-time/dates';
import {
  EXCEPTION_LABELS,
  EXCEPTION_SHAPES,
  MONTH_NAMES,
  WEEKDAY_LABELS,
  WEEKDAY_SHORT_LABELS,
  addException,
  buildException,
  describeException,
  formatDuration,
  monthHeading,
  monthLabel,
  type ExceptionField,
} from '../../modules/work-time/draft';
import { exceptionSpan } from '../../modules/work-time/grammar';
import {
  cardClass,
  compactInputClass,
  errorTextClass,
  helpTextClass,
  labelClass,
  linkButtonClass,
  secondaryButtonClass,
} from './ui';

/** Texto curto da célula: `8h`, `7h30`, `24h`. */
const cellDuration = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h${String(rest).padStart(2, '0')}`;
};

const dayLabel = (date: string) =>
  `${Number(date.slice(8, 10))} de ${MONTH_NAMES[Number(date.slice(5, 7)) - 1]} de ${date.slice(0, 4)}, ${WEEKDAY_LABELS[weekdayIndex(date)].toLowerCase()}`;

/**
 * Exceções da jornada (etapa D e Configurações). O calendário mostra as
 * horas previstas de cada dia a partir da rotina, dos feriados e das
 * exceções já incluídas; a pessoa escolhe a data (ou o intervalo, com um
 * segundo clique) e o tipo. Só o tipo e as datas são guardados: nenhum
 * motivo, nenhum dado de saúde.
 */
const ExceptionsEditor: React.FC<{
  idPrefix: string;
  calendar: WorkCalendar;
  exceptions: readonly WorkException[];
  onChange: (exceptions: WorkException[]) => void;
  initialMonth: string;
}> = ({ idPrefix, calendar, exceptions, onChange, initialMonth }) => {
  const [month, setMonth] = useState(initialMonth);
  const [kind, setKind] = useState<WorkExceptionKind>('vacation');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [hours, setHours] = useState('');
  const [minutes, setMinutes] = useState('');
  const [error, setError] = useState<{ field: ExceptionField; message: string } | null>(null);
  const [focusDate, setFocusDate] = useState(`${initialMonth}-01`);
  const gridRef = useRef<HTMLDivElement>(null);

  const plan = useMemo(() => monthPlan({ ...calendar, exceptions }, month), [calendar, exceptions, month]);
  const shape = EXCEPTION_SHAPES[kind];
  const leading = weekdayIndex(`${month}-01`);

  const selectDate = (date: string) => {
    setError(null);
    if (shape.range && start && !end && date >= start) setEnd(date);
    else {
      setStart(date);
      setEnd('');
    }
  };

  // O foco segue o dia ativo logo depois da renderização (inclusive quando a seta muda o mês),
  // antes da tecla seguinte: segurar a seta anda dia a dia, sem perder passos.
  const pendingFocus = useRef(false);
  useLayoutEffect(() => {
    if (!pendingFocus.current) return;
    pendingFocus.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${focusDate}"]`)?.focus();
  }, [focusDate, month]);

  const moveFocus = (date: string | null) => {
    if (!date) return;
    if (monthKeyOf(date) !== month) setMonth(monthKeyOf(date));
    pendingFocus.current = true;
    setFocusDate(date);
  };

  const onDayKeyDown = (event: React.KeyboardEvent, date: string) => {
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (event.key in steps) {
      event.preventDefault();
      moveFocus(addDays(date, steps[event.key]));
    }
  };

  const include = () => {
    const built = buildException({ kind, start, end, hours, minutes });
    if ('message' in built) {
      setError({ field: built.field, message: built.message });
      return;
    }
    // Feriado trabalhado só faz sentido numa data com feriado (nacional ou local cadastrado).
    if (built.entry.kind === 'holiday_worked' && !holidayOn(calendar, built.entry.date)) {
      setError({ field: 'start', message: 'Nesta data não há feriado nacional nem local cadastrado: a marca de feriado trabalhado não mudaria nada.' });
      return;
    }
    const added = addException(exceptions, built.entry);
    if ('message' in added) {
      setError({ field: 'list', message: added.message });
      return;
    }
    setError(null);
    setStart('');
    setEnd('');
    onChange(added.entries);
  };

  const inSelection = (date: string) => !!start && (date === start || (!!end && date >= start && date <= end));
  const hasException = (date: string) => exceptions.some((entry) => {
    const span = exceptionSpan(entry);
    return date >= span.start && date <= span.end;
  });
  const errorFor = (field: ExceptionField) => (error?.field === field ? error.message : null);

  return (
    <div className="space-y-4">
      <div className={`${cardClass} min-w-0 space-y-3`}>
        <div className="flex items-center justify-between gap-2">
          <button type="button" aria-label="Mês anterior" className="rounded-lg border border-border p-2 text-muted hover:text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
            onClick={() => setMonth((current) => shiftMonthKey(current, -1) ?? current)}>
            <ChevronLeftIcon className="h-4 w-4" aria-hidden="true" />
          </button>
          <p className="text-sm font-bold text-on-surface" aria-live="polite" data-testid={`${idPrefix}-month`}>
            {monthHeading(month)} · {plan.ambiguousDays.length > 0 ? 'horas sem cálculo seguro' : `${formatDuration(plan.minutes)} previstas`}
          </p>
          <button type="button" aria-label="Próximo mês" className="rounded-lg border border-border p-2 text-muted hover:text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
            onClick={() => setMonth((current) => shiftMonthKey(current, 1) ?? current)}>
            <ChevronRightIcon className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div ref={gridRef} role="group" aria-label={`Calendário de ${monthLabel(month)}`} className="grid grid-cols-7 gap-1" data-testid={`${idPrefix}-calendar`}>
          {WEEKDAY_SHORT_LABELS.map((short) => (
            <span key={short} aria-hidden="true" className="text-center text-[11px] font-bold uppercase text-muted">{short}</span>
          ))}
          {Array.from({ length: leading }, (_, index) => <span key={`blank-${index}`} aria-hidden="true" />)}
          {plan.days.map((day) => {
            const selected = inSelection(day.date);
            const marked = hasException(day.date);
            // O nome acessível sai do próprio conteúdo, na ordem do que aparece: o dia, as horas e o resto em texto oculto.
            const tail = [
              day.ambiguous
                ? `horas sem cálculo seguro: ${day.reducedEve ? 'jornada reduzida na véspera' : 'rotinas que se cruzam com intervalo'}`
                : day.minutes > 0 ? 'previstas' : 'sem trabalho previsto',
              day.holiday ? `feriado: ${day.holiday.name}` : null,
              marked ? 'com exceção' : null,
            ].filter(Boolean).join(', ');
            return (
              <button
                key={day.date}
                type="button"
                data-date={day.date}
                tabIndex={day.date === focusDate || (monthKeyOf(focusDate) !== month && day.date === `${month}-01`) ? 0 : -1}
                aria-pressed={selected}
                onClick={() => { setFocusDate(day.date); selectDate(day.date); }}
                onKeyDown={(event) => onDayKeyDown(event, day.date)}
                className={`relative flex min-h-[2.75rem] min-w-0 flex-col items-center justify-center rounded-lg border text-xs focus:outline-none focus:ring-2 focus:ring-primary ${selected ? 'border-primary bg-primary text-white' : day.holiday ? 'border-amber-300 bg-amber-50 text-on-surface dark:border-amber-700 dark:bg-amber-900/20' : 'border-border text-on-surface'}`}
              >
                <span className="font-bold">{Number(day.date.slice(8, 10))}</span>
                <span className="sr-only">{dayLabel(day.date).slice(String(Number(day.date.slice(8, 10))).length)}, </span>
                {day.ambiguous ? (
                  <span aria-hidden="true" className={`text-[10px] leading-tight ${selected ? 'text-white' : 'text-muted'}`}>?</span>
                ) : day.minutes > 0 ? (
                  <span className={`text-[10px] leading-tight ${selected ? 'text-white' : 'text-muted'}`}>{cellDuration(day.minutes)}</span>
                ) : (
                  <span aria-hidden="true" className={`text-[10px] leading-tight ${selected ? 'text-white' : 'text-muted'}`}>–</span>
                )}
                <span className="sr-only"> {tail}</span>
                {marked && <span aria-hidden="true" className={`mt-0.5 h-1.5 w-1.5 rounded-full ${selected ? 'bg-white' : 'bg-primary'}`} />}
              </button>
            );
          })}
        </div>
        <p className={helpTextClass}>
          Clique numa data para escolhê-la; para um intervalo (férias, por exemplo), clique depois na data final. Com o teclado, use as setas.
        </p>
      </div>

      <div className={`${cardClass} min-w-0 space-y-3`}>
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`${idPrefix}-kind`} className={labelClass}>Tipo de exceção</label>
            <select id={`${idPrefix}-kind`} value={kind} className={compactInputClass}
              onChange={(event) => { setKind(event.target.value as WorkExceptionKind); setError(null); }}>
              {WORK_EXCEPTION_KINDS.map((item) => <option key={item} value={item}>{EXCEPTION_LABELS[item]}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor={`${idPrefix}-start`} className={labelClass}>{shape.range ? 'De' : 'Data'}</label>
              <input id={`${idPrefix}-start`} type="date" min="2000-01-01" max="2099-12-31" value={start} className={compactInputClass}
                aria-invalid={errorFor('start') ? true : undefined}
                onChange={(event) => setStart(event.target.value)} />
            </div>
            {shape.range && (
              <div>
                <label htmlFor={`${idPrefix}-end`} className={labelClass}>Até (opcional)</label>
                <input id={`${idPrefix}-end`} type="date" min="2000-01-01" max="2099-12-31" value={end} className={compactInputClass}
                  aria-invalid={errorFor('end') ? true : undefined}
                  onChange={(event) => setEnd(event.target.value)} />
              </div>
            )}
          </div>
        </div>
        {shape.minutes !== 'none' && (
          <fieldset className="min-w-0">
            <legend className={labelClass}>
              {shape.minutes === 'add' ? 'Tempo a mais no dia' : shape.minutes === 'limit' ? 'Jornada máxima de cada dia de trabalho' : 'Jornada do dia'}
            </legend>
            <div className="grid max-w-xs grid-cols-2 gap-2">
              <div>
                <label htmlFor={`${idPrefix}-hours`} className="mb-1 block text-xs text-muted">Horas</label>
                <input id={`${idPrefix}-hours`} type="text" inputMode="numeric" value={hours} className={compactInputClass}
                  aria-invalid={errorFor('minutes') ? true : undefined} onChange={(event) => setHours(event.target.value)} />
              </div>
              <div>
                <label htmlFor={`${idPrefix}-minutes`} className="mb-1 block text-xs text-muted">Minutos</label>
                <input id={`${idPrefix}-minutes`} type="text" inputMode="numeric" value={minutes} className={compactInputClass}
                  aria-invalid={errorFor('minutes') ? true : undefined} onChange={(event) => setMinutes(event.target.value)} />
              </div>
            </div>
          </fieldset>
        )}
        <p className={helpTextClass}>Só guardamos o tipo e as datas. Não informe motivos nem dados de saúde.</p>
        <button type="button" className={`${secondaryButtonClass} text-sm`} onClick={include}>Incluir exceção</button>
        {error && <p className={errorTextClass} role="alert">{error.message}</p>}
      </div>

      <div className={`${cardClass} min-w-0 space-y-2`}>
        <p className="text-sm font-bold text-on-surface">Exceções incluídas ({exceptions.length})</p>
        {exceptions.length === 0 ? (
          <p className="text-sm text-muted">Nenhuma exceção. As horas previstas seguem só a rotina e os feriados.</p>
        ) : (
          <ul className="space-y-1" aria-label="Exceções incluídas" data-testid={`${idPrefix}-list`}>
            {exceptions.map((entry) => (
              <li key={describeException(entry)} className="flex items-center justify-between gap-3 text-sm text-on-surface">
                <span className="min-w-0 break-words">{describeException(entry)}</span>
                <button type="button" className={`${linkButtonClass} inline-flex shrink-0 items-center gap-1`}
                  aria-label={`Remover: ${describeException(entry)}`}
                  onClick={() => onChange(exceptions.filter((item) => item !== entry))}>
                  <DeleteIcon className="h-4 w-4" aria-hidden="true" /> Remover
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default ExceptionsEditor;
