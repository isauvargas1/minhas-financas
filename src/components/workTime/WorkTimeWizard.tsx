import React, { useEffect, useMemo, useRef, useState } from 'react';

import { useWorkspace } from '../../contexts/WorkspaceContext';
import { monthPlan } from '../../modules/work-time/calendar';
import { workCalendarOf, type WorkTimePreference } from '../../modules/work-time/contract';
import { EXCEPTION_LABELS, describeLocalHoliday, formatDuration, monthLabel, validateDraft } from '../../modules/work-time/draft';
import { WORK_TIME_INTRO, WORK_TIME_INTRO_POINTS } from '../../modules/work-time/messages';
import { useIncomeEstimate } from '../../modules/work-time/useIncomeEstimate';
import { EstimateDetailsDialog, EstimateSummary } from './EstimateDetails';
import ExceptionsEditor from './ExceptionsEditor';
import HolidaysEditor from './HolidaysEditor';
import IncomeEditor, { IncomePanelDialog } from './IncomeEditor';
import RoutineEditor, { type RoutineEditorResult } from './RoutineEditor';
import {
  Switch,
  cardClass,
  errorTextClass,
  helpTextClass,
  linkButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from './ui';

const STEPS = [
  'Apresentação',
  'Rotina de trabalho',
  'Feriados e localização',
  'Exceções da jornada',
  'Receitas consideradas',
  'Resumo',
] as const;

/**
 * Assistente da primeira ativação e de "Refazer assistente" (P5-F.1). O
 * rascunho vive só aqui: cancelar não grava nada, e o que estava salvo
 * continua valendo até "Salvar e ativar" terminar com sucesso.
 */
const WorkTimeWizard: React.FC<{
  initial: WorkTimePreference;
  isRedo: boolean;
  isSaving: boolean;
  saveError: string | null;
  today: string;
  onCancel: () => void;
  onSave: (preference: WorkTimePreference) => void;
}> = ({ initial, isRedo, isSaving, saveError, today, onCancel, onSave }) => {
  const { workspaces } = useWorkspace();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<WorkTimePreference>(initial);
  const [routineResult, setRoutineResult] = useState<RoutineEditorResult>({ ok: true, routines: [...initial.routines] });
  const [stepError, setStepError] = useState<string | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  const calendar = useMemo(() => workCalendarOf(draft), [draft]);
  const currentMonth = today.slice(0, 7);
  const monthPreview = useMemo(() => (routineResult.ok ? monthPlan({ ...calendar, routines: routineResult.routines }, currentMonth) : null),
    [calendar, routineResult, currentMonth]);
  const estimate = useIncomeEstimate({
    workspaceId: draft.incomeWorkspaceId || null,
    mode: draft.estimateMode,
    historyMonths: draft.historyMonths,
    allowBusinessIncome: draft.allowBusinessIncome,
    calendar,
    excludedIds: draft.excludedIncomeIds,
    enabled: step >= 4 && draft.incomeWorkspaceId !== '',
  });
  const source = workspaces.find((workspace) => workspace.id === draft.incomeWorkspaceId) ?? null;
  const sourceName = source?.name ?? 'Espaço selecionado';

  const patch = (changes: Partial<WorkTimePreference>) => {
    setStepError(null);
    setDraft((current) => ({ ...current, ...changes }));
  };

  const next = () => {
    if (step === 1) {
      if ('message' in routineResult) {
        setStepError(routineResult.message);
        return;
      }
    }
    if (step === 4) {
      if (draft.incomeWorkspaceId === '') {
        setStepError('Escolha de qual espaço vem a sua renda.');
        return;
      }
      const business = source?.type === 'PJ' || (estimate.status === 'done' && estimate.estimate.workspaceType === 'PJ');
      if (business && !draft.allowBusinessIncome) {
        setStepError('Confirme que quer usar a receita deste espaço PJ, ou escolha um espaço PF.');
        return;
      }
    }
    const checked = validateDraft(draft, today);
    const sectionStep = { routines: 1, holidays: 2, exceptions: 3, income: 4 } as const;
    if ('section' in checked && sectionStep[checked.section] <= step) {
      setStepError(checked.message);
      return;
    }
    setStepError(null);
    setStep((current) => Math.min(current + 1, STEPS.length - 1));
  };

  const finish = () => {
    const checked = validateDraft(draft, today);
    if ('message' in checked) {
      setStepError(checked.message);
      return;
    }
    onSave({ ...draft, enabled: true });
  };

  return (
    <div className="space-y-6" data-testid="work-time-wizard">
      <div className={`${cardClass} min-w-0 space-y-3`}>
        <p className="text-xs font-bold uppercase text-muted" data-testid="work-time-wizard-progress">
          {isRedo ? 'Refazer assistente · ' : ''}Etapa {step + 1} de {STEPS.length}
        </p>
        <ol className="flex flex-wrap gap-1.5" aria-label="Etapas do assistente">
          {STEPS.map((label, index) => (
            <li key={label} aria-current={index === step ? 'step' : undefined}
              className={`h-1.5 w-8 rounded-full ${index <= step ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'}`}>
              <span className="sr-only">{label}{index < step ? ' (concluída)' : index === step ? ' (atual)' : ''}</span>
            </li>
          ))}
        </ol>
        <h3 ref={headingRef} tabIndex={-1} className="text-xl font-bold text-on-surface outline-none" data-testid="work-time-wizard-step">
          {STEPS[step]}
        </h3>
      </div>

      {step === 0 && (
        <div className={`${cardClass} min-w-0 space-y-3 text-sm text-on-surface`}>
          <p>{WORK_TIME_INTRO}</p>
          <ul className="list-disc space-y-1 pl-5">
            {WORK_TIME_INTRO_POINTS.map((point) => <li key={point}>{point}</li>)}
          </ul>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-3">
          <RoutineEditor idPrefix="wizard" routines={draft.routines} defaultReference={today}
            onChange={(result) => {
              setRoutineResult(result);
              if (result.ok) setDraft((current) => ({ ...current, routines: result.routines }));
            }} />
          {monthPreview && (
            <p className="text-sm text-on-surface" data-testid="work-time-wizard-month-hours">
              Horas previstas em {monthLabel(currentMonth)}, já sem os feriados nacionais: <strong>{formatDuration(monthPreview.minutes)}</strong> ({monthPreview.workDays} {monthPreview.workDays === 1 ? 'dia de trabalho' : 'dias de trabalho'}).
            </p>
          )}
        </div>
      )}

      {step === 2 && (
        <HolidaysEditor idPrefix="wizard" year={Number(today.slice(0, 4))}
          value={{ uf: draft.uf, municipality: draft.municipality, worksOnHolidays: draft.worksOnHolidays, localHolidays: draft.localHolidays }}
          onChange={(value) => patch(value)} />
      )}

      {step === 3 && (
        <div className="space-y-2">
          <p className={helpTextClass}>
            As horas de cada mês saem da rotina e dos feriados. Registre só o que foge dela; dá para pular esta etapa e incluir depois.
          </p>
          <ExceptionsEditor idPrefix="wizard-exceptions" calendar={calendar} exceptions={draft.exceptions}
            initialMonth={currentMonth} onChange={(exceptions) => patch({ exceptions })} />
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4">
          <p className="text-sm text-on-surface">
            As receitas vêm dos seus lançamentos oficiais, sem digitar renda. Confira a fonte, o período e o que entra no cálculo.
          </p>
          <IncomeEditor idPrefix="wizard-income" value={draft} onChange={patch} state={estimate} showCount />
          <div className={`${cardClass} min-w-0 space-y-3`}>
            <EstimateSummary state={estimate} sourceName={sourceName} onOpenDetails={() => setIsDetailsOpen(true)} testId="work-time-wizard-estimate" title="Prévia do valor da hora" />
            <button type="button" className={linkButtonClass} onClick={() => setIsPanelOpen(true)} data-testid="work-time-wizard-income-panel"
              disabled={draft.incomeWorkspaceId === ''}>
              Ver receitas consideradas
            </button>
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="space-y-4">
          <div className={`${cardClass} min-w-0 space-y-2 text-sm text-on-surface`}>
            <p><strong>Rotinas:</strong> {draft.routines.length} {draft.routines.length === 1 ? 'rotina' : 'rotinas'}{monthPreview ? `; ${formatDuration(monthPreview.minutes)} previstas em ${monthLabel(currentMonth)}` : ''}.</p>
            <p><strong>Feriados:</strong> nacionais automáticos{draft.worksOnHolidays ? ', trabalhados' : ''}{draft.localHolidays.length > 0 ? `; locais: ${draft.localHolidays.map(describeLocalHoliday).join(', ')}` : '; nenhum local'}.</p>
            <p><strong>Exceções:</strong> {draft.exceptions.length === 0 ? 'nenhuma' : [...new Set(draft.exceptions.map((entry) => EXCEPTION_LABELS[entry.kind]))].join(', ')}.</p>
            <p><strong>Renda:</strong> {sourceName}{draft.allowBusinessIncome ? ' (receita empresarial, por escolha sua)' : ''}.</p>
          </div>
          <div className={`${cardClass} min-w-0`}>
            <EstimateSummary state={estimate} sourceName={sourceName} onOpenDetails={() => setIsDetailsOpen(true)} testId="work-time-wizard-summary" title="Valor estimado da sua hora" />
          </div>
          <div className={`${cardClass} flex min-w-0 items-start justify-between gap-4`}>
            <div>
              <p id="wizard-display-label" className="text-sm font-bold text-on-surface">Mostrar os valores em tempo de trabalho agora</p>
              <p id="wizard-display-help" className={helpTextClass}>Desligado, tudo continua em reais; o botão do relógio no topo troca quando você quiser.</p>
            </div>
            <Switch checked={draft.displayMode === 'time'} labelledBy="wizard-display-label" describedBy="wizard-display-help"
              onChange={(value) => patch({ displayMode: value ? 'time' : 'money' })} testId="work-time-wizard-display" />
          </div>
        </div>
      )}

      {(stepError || saveError) && <p className={errorTextClass} role="alert">{stepError ?? saveError}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" className={secondaryButtonClass} onClick={onCancel} disabled={isSaving}>
          Cancelar
        </button>
        <div className="flex flex-wrap gap-3">
          {step > 0 && (
            <button type="button" className={secondaryButtonClass} disabled={isSaving}
              onClick={() => { setStepError(null); setStep((current) => current - 1); }}>
              Voltar
            </button>
          )}
          {step < STEPS.length - 1 ? (
            <button type="button" className={primaryButtonClass} onClick={next}>
              {step === 0 ? 'Começar' : 'Continuar'}
            </button>
          ) : (
            <button type="button" className={primaryButtonClass} onClick={finish} disabled={isSaving} data-testid="work-time-wizard-save">
              {isSaving ? 'Salvando...' : 'Salvar e ativar'}
            </button>
          )}
        </div>
      </div>

      <EstimateDetailsDialog isOpen={isDetailsOpen} onClose={() => setIsDetailsOpen(false)} state={estimate} sourceName={sourceName} />
      <IncomePanelDialog isOpen={isPanelOpen} onClose={() => setIsPanelOpen(false)} value={draft} onChange={patch} state={estimate} />
    </div>
  );
};

export default WorkTimeWizard;
