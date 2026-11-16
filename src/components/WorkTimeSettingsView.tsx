import React, { useEffect, useMemo, useRef, useState } from 'react';

import { BackIcon, ClockIcon } from './Icons.tsx';
import ConfirmationModal from './ConfirmationModal.tsx';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { formatCentsBRL } from '../lib/money';
import { saoPauloDayKey } from '../modules/reports/dateWindow';
import { loadWorkspace } from '../modules/workspaces/api';
import { workCalendarOf, type WorkTimePreference } from '../modules/work-time/contract';
import { initialDraft, isSameAsSaved, validateDraft } from '../modules/work-time/draft';
import { WORK_TIME_INTRO, WORK_TIME_INTRO_POINTS } from '../modules/work-time/messages';
import { useIncomeEstimate } from '../modules/work-time/useIncomeEstimate';
import { useWorkTime } from '../modules/work-time/WorkTimeContext';
import { EstimateDetailsDialog, EstimateSummary } from './workTime/EstimateDetails';
import ExceptionsEditor from './workTime/ExceptionsEditor';
import HolidaysEditor from './workTime/HolidaysEditor';
import IncomeEditor, { IncomePanelDialog } from './workTime/IncomeEditor';
import RoutineEditor, { type RoutineEditorResult } from './workTime/RoutineEditor';
import WorkTimeWizard from './workTime/WorkTimeWizard';
import {
  Switch,
  cardClass,
  dangerButtonClass,
  errorTextClass,
  helpTextClass,
  labelClass,
  linkButtonClass,
  noticeClass,
  primaryButtonClass,
  secondaryButtonClass,
} from './workTime/ui';

const logCode = (label: string, error: unknown) => {
  // Só o código: a configuração, a renda e as horas nunca vão para o log.
  const code = (error as { code?: unknown } | null)?.code;
  console.error(label, typeof code === 'string' ? code : 'desconhecido');
};

type Feedback = { kind: 'success' | 'error' | 'pending'; message: string } | null;

/**
 * Sem rede, o SDK guarda a escrita e só resolve quando o servidor confirma: a
 * tela ficaria presa em "Salvando..." e uma recarga perderia a exclusão. Com o
 * navegador sabidamente offline, a tela recusa antes de começar.
 */
const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;
const OFFLINE_MESSAGE = 'Sem conexão com a internet. Conecte-se e tente de novo.';
/** Quantos espaços PF, no máximo, são consultados para sugerir a fonte da renda (2 leituras cada). */
const DEFAULT_SOURCE_LOOKUPS = 5;
const SAVE_FAILED_MESSAGE = 'Não foi possível salvar agora. A configuração anterior continua valendo. Confira sua conexão e tente de novo.';

const Section: React.FC<{ id: string; title: string; description?: string; children: React.ReactNode }> = ({ id, title, description, children }) => (
  <section aria-labelledby={id} className="min-w-0 space-y-3">
    <div>
      <h3 id={id} className="text-base font-bold text-on-surface">{title}</h3>
      {description && <p className={helpTextClass}>{description}</p>}
    </div>
    {children}
  </section>
);

/**
 * Configurações → Tempo de trabalho equivalente (P5-F, REQ-FUT-01; P5-F.1).
 *
 * A preferência é privada e do usuário (vale em PF e PJ, em qualquer papel).
 * Na primeira ativação abre o assistente; depois, tudo é editável aqui, com
 * prévia antes de salvar. A renda vem das receitas oficiais e só aparece
 * nesta tela, da própria pessoa; as telas financeiras nunca a mostram.
 */
const WorkTimeSettingsView: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const workTime = useWorkTime();
  const { preference, status, ownerUid, hasPendingWrites } = workTime;
  const { workspaces, activeWorkspace } = useWorkspace();
  const today = saoPauloDayKey();
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [draft, setDraft] = useState<WorkTimePreference | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [resetNonce, setResetNonce] = useState(0);
  const [routineResult, setRoutineResult] = useState<RoutineEditorResult>({ ok: true, routines: [] });
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [wizardError, setWizardError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [savedChangedElsewhere, setSavedChangedElsewhere] = useState(false);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const backButtonRef = useRef<HTMLButtonElement>(null);
  // Respostas de gravação de outra conta (troca no meio do caminho) são ignoradas.
  const ownerRef = useRef(ownerUid);
  ownerRef.current = ownerUid;
  const editBaseRef = useRef<WorkTimePreference | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // Outra conta: nada do rascunho anterior permanece.
  useEffect(() => {
    setDraft(null);
    setIsDirty(false);
    setIsWizardOpen(false);
    setFeedback(null);
    setWizardError(null);
    setSavedChangedElsewhere(false);
  }, [ownerUid]);

  // Sem edição em andamento, o rascunho acompanha a preferência salva
  // (inclusive mudanças feitas em outra aba ou outro dispositivo). Com edição
  // em andamento, nada é sobrescrito: a tela avisa que o salvo mudou. A
  // gravação desta própria aba, ainda sem confirmação do servidor, não conta
  // como mudança de outra aba (e, se falhar, o salvo volta a ser o de antes).
  useEffect(() => {
    if (status !== 'ready') return;
    if (!isDirty) {
      setDraft(preference);
      setResetNonce((value) => value + 1);
      setSavedChangedElsewhere(false);
      return;
    }
    if (hasPendingWrites) return;
    // O modo de exibição também muda pelo alternador do topo. Se a pessoa não o mudou nesta tela, o
    // salvo vale para o rascunho e para a base: salvar não desfaz o clique e não há aviso de conflito.
    const base = editBaseRef.current ?? preference;
    const current = draftRef.current;
    if (preference && base && current && base.displayMode !== preference.displayMode && current.displayMode === base.displayMode) {
      editBaseRef.current = { ...base, displayMode: preference.displayMode };
      setDraft({ ...current, displayMode: preference.displayMode });
    }
    setSavedChangedElsewhere(!isSameAsSaved(editBaseRef.current ?? preference ?? ({} as WorkTimePreference), preference));
  }, [status, preference, isDirty, hasPendingWrites]);

  // Fonte sugerida na primeira ativação: o espaço PF de que a pessoa é dona (o ativo primeiro). O
  // índice de espaços não traz o papel; ele é lido do membership, só dos PF e no máximo
  // DEFAULT_SOURCE_LOOKUPS, até achar o primeiro. A escolha aparece no assistente e pode ser trocada;
  // PF de outra pessoa nunca é sugerido.
  const activeId = activeWorkspace?.id ?? null;
  const activeRole = activeWorkspace?.type === 'PF' ? activeWorkspace.myRole ?? null : null;
  const personalCandidates = useMemo(() => [
    ...(activeWorkspace?.type === 'PF' ? [activeWorkspace.id] : []),
    ...workspaces.filter((workspace) => workspace.type === 'PF' && workspace.id !== activeWorkspace?.id).map((workspace) => workspace.id),
  ].slice(0, DEFAULT_SOURCE_LOOKUPS).join(','), [workspaces, activeWorkspace?.id, activeWorkspace?.type]);
  const [defaultWorkspaceId, setDefaultWorkspaceId] = useState<string | null>(null);
  // Outra conta: a sugestão da anterior não vale.
  useEffect(() => { setDefaultWorkspaceId(null); }, [ownerUid]);
  useEffect(() => {
    if (status !== 'ready' || preference || !ownerUid) return undefined;
    let cancelled = false;
    const owner = ownerUid;
    const candidates = personalCandidates ? personalCandidates.split(',') : [];
    void (async () => {
      let chosen = '';
      for (const workspaceId of candidates) {
        const role = workspaceId === activeId && activeRole
          ? activeRole
          : await loadWorkspace(workspaceId, owner).then((loaded) => loaded.myRole).catch(() => undefined);
        if (cancelled) return;
        if (role === 'owner') {
          chosen = workspaceId;
          break;
        }
      }
      // Sem PF próprio, nada é pré-selecionado: a pessoa escolhe a fonte no assistente.
      if (!cancelled) setDefaultWorkspaceId(chosen);
    })();
    return () => { cancelled = true; };
  }, [status, preference, ownerUid, personalCandidates, activeId, activeRole]);

  const edit = (changes: Partial<WorkTimePreference>) => {
    if (!draft) return;
    if (!isDirty) editBaseRef.current = preference;
    setDraft({ ...draft, ...changes });
    setIsDirty(true);
    setFeedback(null);
  };

  const calendar = useMemo(() => (draft ? workCalendarOf(draft) : null), [draft]);
  const draftEstimate = useIncomeEstimate({
    workspaceId: draft?.incomeWorkspaceId || null,
    mode: draft?.estimateMode ?? 'habitual',
    historyMonths: draft?.historyMonths ?? 3,
    allowBusinessIncome: draft?.allowBusinessIncome ?? false,
    calendar: calendar ?? { routines: [], worksOnHolidays: false, localHolidays: [], exceptions: [] },
    excludedIds: draft?.excludedIncomeIds ?? [],
    enabled: draft !== null && !isWizardOpen,
  });
  const sourceName = workspaces.find((workspace) => workspace.id === draft?.incomeWorkspaceId)?.name ?? 'Espaço selecionado';

  const save = async (next: WorkTimePreference, fromWizard: boolean) => {
    if (isSaving) return;
    setFeedback(null);
    setWizardError(null);
    const checked = validateDraft(next, today);
    const routineMessage = !fromWizard && 'message' in routineResult ? routineResult.message : null;
    if ('message' in checked || routineMessage !== null) {
      const message = 'message' in checked ? checked.message : routineMessage ?? '';
      if (fromWizard) setWizardError(message);
      else setFeedback({ kind: 'error', message });
      return;
    }
    if (isOffline()) {
      if (fromWizard) setWizardError(OFFLINE_MESSAGE);
      else setFeedback({ kind: 'error', message: OFFLINE_MESSAGE });
      return;
    }
    const owner = ownerRef.current;
    setIsSaving(true);
    try {
      await workTime.savePreference(next);
      if (ownerRef.current !== owner) return;
      setIsDirty(false);
      setIsWizardOpen(false);
      setSavedChangedElsewhere(false);
      setFeedback({ kind: 'success', message: fromWizard ? 'Tudo pronto: a configuração foi salva.' : 'Alterações salvas.' });
    } catch (error) {
      logCode('Falha ao salvar a preferência de tempo de trabalho', error);
      if (ownerRef.current === owner) {
        if (fromWizard) setWizardError(SAVE_FAILED_MESSAGE);
        else setFeedback({ kind: 'error', message: SAVE_FAILED_MESSAGE });
      }
    } finally {
      if (ownerRef.current === owner) setIsSaving(false);
    }
  };

  const discard = () => {
    setDraft(preference);
    setIsDirty(false);
    setResetNonce((value) => value + 1);
    setFeedback(null);
    setSavedChangedElsewhere(false);
  };

  const handleDelete = async () => {
    if (isDeleting) return;
    if (isOffline()) {
      setIsConfirmingDelete(false);
      setFeedback({ kind: 'error', message: OFFLINE_MESSAGE });
      return;
    }
    const owner = ownerRef.current;
    setIsDeleting(true);
    // O modal pode ser fechado enquanto o servidor não confirma; o aviso fica na tela.
    setFeedback({ kind: 'pending', message: 'Excluindo seus dados. A exclusão termina quando o servidor confirmar.' });
    try {
      await workTime.deletePreference();
      if (ownerRef.current !== owner) return;
      setIsConfirmingDelete(false);
      setDraft(null);
      setIsDirty(false);
      setFeedback({ kind: 'success', message: 'Seus dados de tempo de trabalho foram excluídos.' });
    } catch (error) {
      logCode('Falha ao excluir a preferência de tempo de trabalho', error);
      if (ownerRef.current === owner) {
        setIsConfirmingDelete(false);
        setFeedback({ kind: 'error', message: 'Não foi possível excluir agora. Tente de novo.' });
      }
    } finally {
      if (ownerRef.current === owner) setIsDeleting(false);
    }
  };

  const hasStoredDocument = preference !== null || workTime.isStoredInvalid;
  const isLoading = status === 'idle' || status === 'loading';
  const savedEstimate = workTime.estimate;
  // Uma vez por rascunho (o conferidor do calendário inteiro percorre as rotinas, os feriados e as exceções).
  const draftCheck = useMemo(() => (draft === null ? null : validateDraft(draft, today)), [draft, today]);
  const draftIsValid = draftCheck !== null && draftCheck.ok && routineResult.ok;
  // Configuração sem cálculo seguro por causa de um feriado, de uma exceção ou do primeiro dia de um mês: o
  // editor de rotinas só avisa das rotinas sozinhas, então o aviso fica junto do botão de salvar.
  const calendarProblem = draftCheck !== null && 'message' in draftCheck && draftCheck.ambiguity !== undefined && draftCheck.ambiguity !== 'routines'
    ? draftCheck.message
    : null;

  const feedbackView = feedback && (
    <p
      role={feedback.kind === 'error' ? 'alert' : 'status'}
      data-testid="work-time-feedback"
      className={`text-sm ${feedback.kind === 'error' ? 'text-red-600 dark:text-red-400' : feedback.kind === 'pending' ? 'text-muted' : 'text-emerald-700 dark:text-emerald-300'}`}
    >
      {feedback.message}
    </p>
  );

  return (
    <div className="animate-fade-in max-w-5xl mx-auto min-w-0" data-testid="work-time-settings">
      <div className="flex items-center gap-4 mb-8">
        <button
          ref={backButtonRef}
          type="button"
          onClick={onBack}
          aria-label="Voltar para Configurações"
          className="p-2 rounded-lg bg-surface border border-border text-muted hover:text-on-surface transition-colors"
        >
          <BackIcon className="h-5 w-5" />
        </button>
        <div className="min-w-0">
          <h2 className="text-2xl font-bold text-on-surface">Tempo de trabalho equivalente</h2>
          <p className="text-sm text-muted">
            Veja quanto do seu tempo de trabalho um valor representa. É opcional e só você vê.
          </p>
        </div>
      </div>

      {isLoading && (
        <p className="text-sm text-muted" role="status">Carregando sua preferência...</p>
      )}

      {status === 'error' && (
        <div className="bg-surface rounded-card border border-border p-6 shadow-sm space-y-3" role="alert">
          <p className="text-sm text-on-surface">
            Não foi possível carregar sua preferência agora. Enquanto isso, os valores continuam em reais.
          </p>
          <button type="button" onClick={workTime.retry} className="text-sm font-medium text-primary dark:text-primary-on-dark hover:underline">
            Tentar de novo
          </button>
        </div>
      )}

      {status === 'ready' && isWizardOpen && (
        <WorkTimeWizard
          initial={preference ?? initialDraft(defaultWorkspaceId ?? '')}
          isRedo={preference !== null}
          isSaving={isSaving}
          saveError={wizardError}
          today={today}
          onCancel={() => { setIsWizardOpen(false); setWizardError(null); }}
          onSave={(next) => void save(next, true)}
        />
      )}

      {status === 'ready' && !isWizardOpen && !preference && (
        <div className="space-y-4">
          {workTime.isStoredInvalid && (
            <p className={noticeClass} role="alert">
              A preferência salva está num formato que não reconhecemos e foi ignorada. Configure de novo ou exclua.
            </p>
          )}
          <div className={`${cardClass} min-w-0 space-y-3 text-sm text-on-surface`} data-testid="work-time-intro">
            <div className="w-12 h-12 bg-primary rounded-2xl flex items-center justify-center text-white shadow-lg">
              <ClockIcon className="w-7 h-7" aria-hidden="true" />
            </div>
            <p>{WORK_TIME_INTRO}</p>
            <ul className="list-disc space-y-1 pl-5">
              {WORK_TIME_INTRO_POINTS.map((point) => <li key={point}>{point}</li>)}
            </ul>
            <button type="button" className={primaryButtonClass} onClick={() => { setFeedback(null); setIsWizardOpen(true); }}
              disabled={defaultWorkspaceId === null} data-testid="work-time-start">
              {defaultWorkspaceId === null ? 'Preparando...' : 'Configurar agora'}
            </button>
          </div>
          {hasStoredDocument && (
            <button ref={deleteButtonRef} type="button" className={dangerButtonClass}
              onClick={() => { setFeedback(null); setIsConfirmingDelete(true); }} disabled={isDeleting}>
              Excluir meus dados
            </button>
          )}
          {feedbackView}
        </div>
      )}

      {status === 'ready' && !isWizardOpen && preference && draft && (
        <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
          <div className="min-w-0 space-y-8 md:col-span-2">
            <Section id="wt-display" title="Exibição">
              <div className={`${cardClass} min-w-0 space-y-4`}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p id="work-time-enabled-label" className="text-sm font-bold text-on-surface">Ativar tempo de trabalho equivalente</p>
                    <p id="work-time-enabled-help" className={helpTextClass}>
                      Ativado, o botão do relógio no topo alterna entre reais e tempo nas telas financeiras. Desativar guarda a configuração.
                    </p>
                  </div>
                  <Switch checked={draft.enabled} labelledBy="work-time-enabled-label" describedBy="work-time-enabled-help"
                    onChange={(enabled) => edit({ enabled })} testId="work-time-enabled" />
                </div>
                <fieldset>
                  <legend className={labelClass}>Exibir valores em</legend>
                  <div className="flex flex-wrap gap-4">
                    {([['money', 'Reais (R$)'], ['time', 'Tempo de trabalho']] as const).map(([mode, label]) => (
                      <label key={mode} className="inline-flex items-center gap-2 text-sm text-on-surface cursor-pointer">
                        <input type="radio" name="work-time-display-mode" value={mode} checked={draft.displayMode === mode}
                          onChange={() => edit({ displayMode: mode })} className="h-4 w-4 text-primary focus:ring-primary" />
                        {label}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>
            </Section>

            <Section id="wt-routine" title="Rotina de trabalho" description="Dias, horários, intervalos e escalas. As horas de cada mês saem daqui.">
              <RoutineEditor key={`routines-${resetNonce}`} idPrefix="settings" routines={draft.routines} defaultReference={today}
                onChange={(result) => {
                  setRoutineResult(result);
                  if (result.ok && JSON.stringify(result.routines) !== JSON.stringify(draft.routines)) edit({ routines: result.routines });
                  // Só uma mudança da pessoa põe a tela em edição. A configuração gravada que o editor recusa ao montar
                  // não é alteração não salva: sem o título da prévia, a nota e "Descartar alterações", e o rascunho
                  // continua seguindo o salvo (revisão 4 da R1, Q02).
                  else if ('message' in result && result.edited) {
                    if (!isDirty) editBaseRef.current = preference;
                    setIsDirty(true);
                  }
                }} />
            </Section>

            <Section id="wt-holidays" title="Feriados e localização">
              <HolidaysEditor key={`holidays-${resetNonce}`} idPrefix="settings" year={Number(today.slice(0, 4))}
                value={{ uf: draft.uf, municipality: draft.municipality, worksOnHolidays: draft.worksOnHolidays, localHolidays: draft.localHolidays }}
                onChange={(value) => edit(value)} />
            </Section>

            <Section id="wt-exceptions" title="Exceções da jornada" description="Férias, folgas, plantões, horas extras e mudanças pontuais.">
              <ExceptionsEditor key={`exceptions-${resetNonce}`} idPrefix="settings-exceptions" calendar={calendar ?? workCalendarOf(draft)}
                exceptions={draft.exceptions} initialMonth={today.slice(0, 7)} onChange={(exceptions) => edit({ exceptions })} />
            </Section>

            <Section id="wt-income" title="Renda considerada" description="As receitas vêm dos seus lançamentos oficiais; nada é digitado.">
              <IncomeEditor idPrefix="settings-income" value={draft} onChange={(changes) => edit(changes)} state={draftEstimate} showCount={false} />
              <button type="button" className={secondaryButtonClass} onClick={() => setIsPanelOpen(true)} data-testid="work-time-income-panel-open">
                Receitas consideradas
              </button>
            </Section>

            <div className={`${cardClass} min-w-0 space-y-3 text-sm text-on-surface`}>
              <h3 className="text-base font-bold text-on-surface">Como funciona</h3>
              <p>
                O valor é dividido pelo que uma hora da sua renda representa: soma das receitas elegíveis ÷ soma das horas previstas dos mesmos meses. Exemplo: R$ 3.520,00 em 176 horas dão R$ 20,00 por hora, e R$ 482,35 equivalem a cerca de 24 h 7 min.
              </p>
              <p>
                É uma estimativa aproximada e informativa, arredondada ao minuto mais próximo. Não é custo contábil, preço do seu trabalho, salário líquido, produtividade nem retorno. Seus registros, saldos e relatórios continuam em reais, e pagamentos, formulários e confirmações sempre mostram reais.
              </p>
              <p>
                Sua rotina, seus feriados, suas exceções e o valor da sua hora ficam só na sua conta. Ninguém dos seus espaços consegue vê-los, inclusive proprietários e administradores, e eles não vão para o assistente de IA, notificações nem relatórios. Você pode excluir esses dados quando quiser.
              </p>
            </div>
          </div>

          <div className="min-w-0 space-y-4">
            <div className="bg-primary/5 rounded-card border border-primary/20 p-4 sm:p-6 space-y-4 md:sticky md:top-4">
              <div className="w-12 h-12 bg-primary rounded-2xl flex items-center justify-center text-white shadow-lg">
                <ClockIcon className="w-7 h-7" aria-hidden="true" />
              </div>
              <EstimateSummary state={draftEstimate} sourceName={sourceName} onOpenDetails={() => setIsDetailsOpen(true)}
                testId="work-time-preview" title={isDirty ? 'Prévia com as alterações' : 'Valor estimado da sua hora'} />
              {isDirty && (
                <p className="text-xs text-muted" data-testid="work-time-unsaved">
                  Nada foi salvo ainda.
                  {savedEstimate.status === 'done' && savedEstimate.estimate.status === 'ready'
                    ? ` Valor em uso agora: ${formatCentsBRL(savedEstimate.estimate.hourlyRateCents)} por hora.`
                    : ''}
                </p>
              )}
              {savedChangedElsewhere && (
                <p className={noticeClass} role="status">
                  A configuração foi alterada em outra aba ou dispositivo. Salvar substitui pela versão desta tela; Descartar alterações carrega a versão salva.
                </p>
              )}
            </div>

            {calendarProblem !== null && (
              <p className={errorTextClass} role="alert" data-testid="work-time-calendar-ambiguity">{calendarProblem}</p>
            )}
            <button type="button" className={`${primaryButtonClass} w-full`} onClick={() => void save(draft, false)}
              disabled={isSaving || isDeleting || !isDirty || !draftIsValid} data-testid="work-time-save">
              {isSaving ? 'Salvando...' : 'Salvar alterações'}
            </button>
            {isDirty && (
              <button type="button" className={`${secondaryButtonClass} w-full`} onClick={discard} disabled={isSaving}>
                Descartar alterações
              </button>
            )}
            <button type="button" className={`${secondaryButtonClass} w-full`} onClick={() => { discard(); setIsWizardOpen(true); }}
              disabled={isSaving || isDeleting} data-testid="work-time-redo">
              Refazer assistente
            </button>
            {hasStoredDocument && (
              <button ref={deleteButtonRef} type="button" className={`${dangerButtonClass} w-full`}
                onClick={() => { setFeedback(null); setIsConfirmingDelete(true); }} disabled={isSaving || isDeleting}>
                Excluir meus dados
              </button>
            )}
            {feedbackView}
            <button type="button" className={linkButtonClass} onClick={() => setIsDetailsOpen(true)}>
              Consultar a memória de cálculo
            </button>
          </div>
        </div>
      )}

      {draft && (
        <>
          <EstimateDetailsDialog isOpen={isDetailsOpen} onClose={() => setIsDetailsOpen(false)} state={draftEstimate} sourceName={sourceName} />
          <IncomePanelDialog isOpen={isPanelOpen} onClose={() => setIsPanelOpen(false)} value={draft}
            onChange={(changes) => edit(changes)} state={draftEstimate} />
        </>
      )}

      <ConfirmationModal
        isOpen={isConfirmingDelete}
        onClose={() => setIsConfirmingDelete(false)}
        onConfirm={() => void handleDelete()}
        title="Excluir dados do tempo de trabalho"
        message="A rotina, os feriados locais, as exceções e as escolhas de renda serão apagados, e os valores voltarão a aparecer em reais. Seus lançamentos não mudam. Esta ação não pode ser desfeita."
        confirmLabel="Excluir"
        isBusy={isDeleting}
        manageFocus
        returnFocus={() => deleteButtonRef.current ?? backButtonRef.current}
      />
    </div>
  );
};

export default WorkTimeSettingsView;
