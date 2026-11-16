import React from 'react';

import { formatCentsBRL } from '../../lib/money';
import { presentWorkTime } from '../../modules/work-time/calculation';
import { WORK_EXCEPTION_KINDS } from '../../modules/work-time/calendar';
import type { WorkTimeEstimate } from '../../modules/work-time/estimate';
import { EXCEPTION_LABELS, formatCivilDateBR, formatDuration, monthHeading, monthLabel } from '../../modules/work-time/draft';
import {
  DETAILS_CALENDAR_NOT_APPLIED,
  DETAILS_EXCLUSIONS_NOT_APPLIED,
  ESTIMATE_DISCLAIMER,
  ESTIMATE_REFRESH_FAILED,
  STANDING_LIMITATIONS,
  UNAVAILABLE_REASON_TEXT,
  calculationReachedMonths,
  estimateNoteText,
} from '../../modules/work-time/messages';
import type { IncomeEstimateState } from '../../modules/work-time/useIncomeEstimate';
import { WorkTimeDialog, linkButtonClass, noticeClass, primaryButtonClass } from './ui';

/** Valor fixo da prévia: não vem dos dados da pessoa. */
export const PREVIEW_AMOUNT_CENTS = 15_000;


const updatedLabel = (updatedAt: number) =>
  new Date(updatedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });

export const modeLabel = (estimate: Pick<WorkTimeEstimate, 'mode' | 'historyMonths'>) =>
  estimate.mode === 'current_month'
    ? 'Mês atual: receitas já efetivadas neste mês ÷ horas previstas do mês inteiro'
    : `Habitual: ${estimate.historyMonths === 1 ? 'último mês completo' : `últimos ${estimate.historyMonths} meses completos`}`;

/**
 * Cartão da estimativa: valor da hora (ou o motivo de não haver), modo,
 * meses e o acesso à memória de cálculo. Mostra reais: é a tela da própria
 * pessoa, e a renda não aparece fora daqui.
 */
export const EstimateSummary: React.FC<{
  state: IncomeEstimateState;
  sourceName: string;
  onOpenDetails: () => void;
  testId: string;
  title?: string;
}> = ({ state, sourceName, onOpenDetails, testId, title = 'Valor estimado da sua hora' }) => {
  if (state.status === 'idle') return null;
  if (state.status === 'loading') {
    return <p className="text-sm text-muted" role="status" data-testid={`${testId}-loading`}>Lendo as receitas oficiais e calculando...</p>;
  }
  if (state.status === 'error') {
    return (
      <div className="space-y-2" role="alert" data-testid={`${testId}-error`}>
        <p className="text-sm text-on-surface">{state.message}</p>
        <button type="button" className={linkButtonClass} onClick={state.retry}>Tentar de novo</button>
      </div>
    );
  }
  const { estimate } = state;
  const preview = estimate.status === 'ready' ? presentWorkTime(PREVIEW_AMOUNT_CENTS, estimate.config) : null;
  return (
    <div className="space-y-3" data-testid={testId}>
      <div>
        <p className="mb-1 text-xs font-bold uppercase text-primary dark:text-primary-on-dark">{title}</p>
        {estimate.status === 'ready' ? (
          <p className="text-lg font-bold text-on-surface" data-testid={`${testId}-hourly`}>
            {formatCentsBRL(estimate.hourlyRateCents)}
            {estimate.provisional && (
              <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 align-middle text-xs font-bold text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
                {estimate.mode === 'current_month' ? 'mês incompleto' : 'provisória'}
              </span>
            )}
          </p>
        ) : (
          <p className="text-sm text-on-surface" data-testid={`${testId}-unavailable`}>
            Estimativa indisponível. {UNAVAILABLE_REASON_TEXT[estimate.reason]}
          </p>
        )}
        {estimate.status === 'unavailable' && estimate.reason === 'report_unavailable' && !state.refreshFailed && (
          <button type="button" className={linkButtonClass} onClick={state.retry} data-testid={`${testId}-retry`}>Tentar de novo</button>
        )}
      </div>
      {state.refreshFailed && (
        <div className="space-y-1" role="status" data-testid={`${testId}-refresh-failed`}>
          <p className="text-sm text-on-surface">{ESTIMATE_REFRESH_FAILED}</p>
          <button type="button" className={linkButtonClass} onClick={state.retry}>Tentar de novo</button>
        </div>
      )}
      <dl className="space-y-1 text-xs text-muted">
        <div><dt className="inline font-bold">Fonte: </dt><dd className="inline">{sourceName} ({estimate.workspaceType})</dd></div>
        <div><dt className="inline font-bold">Modo: </dt><dd className="inline">{modeLabel(estimate)}</dd></div>
        {estimate.months.length > 0 && (
          <div>
            <dt className="inline font-bold">Período: </dt>
            <dd className="inline">
              {estimate.months.length === 1
                ? monthLabel(estimate.months[0].month)
                : `${monthLabel(estimate.months[0].month)} a ${monthLabel(estimate.months[estimate.months.length - 1].month)}`}
            </dd>
          </div>
        )}
        {estimate.status === 'ready' && (
          <>
            <div><dt className="inline font-bold">Receitas elegíveis: </dt><dd className="inline">{formatCentsBRL(estimate.incomeCents)}</dd></div>
            <div><dt className="inline font-bold">Horas previstas: </dt><dd className="inline">{formatDuration(estimate.workMinutes)}</dd></div>
          </>
        )}
      </dl>
      {preview && (
        <p className="text-sm text-on-surface" data-testid={`${testId}-preview`}>
          Uma compra de {formatCentsBRL(PREVIEW_AMOUNT_CENTS)} equivale a {preview.short} de trabalho.
        </p>
      )}
      <button type="button" className={linkButtonClass} onClick={onOpenDetails} data-testid={`${testId}-details`}>
        Como este valor foi calculado?
      </button>
    </div>
  );
};

/**
 * Memória de cálculo ("Como este valor foi calculado?"). Fica só nas
 * Configurações da própria pessoa: nada daqui vai para relatório, IA,
 * notificação ou para os membros dos espaços.
 */
export const EstimateDetailsDialog: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  state: IncomeEstimateState;
  sourceName: string;
}> = ({ isOpen, onClose, state, sourceName }) => {
  const done = state.status === 'done' ? state : null;
  const estimate = done?.estimate ?? null;
  const exceptionTotals = WORK_EXCEPTION_KINDS
    .map((kind) => ({ kind, days: estimate ? estimate.months.reduce((sum, month) => sum + month.plan.exceptionDays[kind], 0) : 0 }))
    .filter((item) => item.days > 0);
  const holidaysOff = estimate ? estimate.months.flatMap((month) => month.plan.holidaysOff) : [];
  const holidaysRest = estimate ? estimate.months.flatMap((month) => month.plan.holidaysOnRestDays) : [];
  const holidaysWorked = estimate ? estimate.months.flatMap((month) => month.plan.holidaysWorked) : [];
  return (
    <WorkTimeDialog
      isOpen={isOpen}
      onClose={onClose}
      title="Como este valor foi calculado?"
      titleId="work-time-details-title"
      testId="work-time-details"
      footer={<button type="button" className={primaryButtonClass} onClick={onClose}>Entendi</button>}
    >
      <div className="space-y-4">
        <p className={noticeClass} data-testid="work-time-disclaimer">{ESTIMATE_DISCLAIMER}</p>
        {!estimate && <p>A estimativa ainda não está pronta. {state.status === 'error' ? state.message : ''}</p>}
        {estimate && done && (
          <>
            <section aria-labelledby="wt-details-summary" className="space-y-1">
              <h4 id="wt-details-summary" className="font-bold text-on-surface">Resumo</h4>
              <p><strong>Modo de cálculo:</strong> {modeLabel(estimate)}.</p>
              <p><strong>Fonte das receitas:</strong> {sourceName} ({estimate.workspaceType}).</p>
              <p><strong>Fórmula:</strong> valor da hora = soma das receitas elegíveis ÷ soma das horas previstas dos mesmos meses (não é média de valores por hora).</p>
              {estimate.status === 'ready' ? (
                <p data-testid="work-time-details-hourly"><strong>Estimativa do valor por hora:</strong> {formatCentsBRL(estimate.incomeCents)} ÷ {formatDuration(estimate.workMinutes)} = {formatCentsBRL(estimate.hourlyRateCents)} por hora.</p>
              ) : (
                <p><strong>Estimativa indisponível:</strong> {UNAVAILABLE_REASON_TEXT[estimate.reason]}</p>
              )}
              <p><strong>Atualizado em:</strong> {updatedLabel(done.updatedAt)} (data de referência do relatório oficial: {formatCivilDateBR(estimate.referenceDate)}).</p>
            </section>

            {estimate.months.length > 0 && (
              <section aria-labelledby="wt-details-months" className="space-y-2">
                <h4 id="wt-details-months" className="font-bold text-on-surface">Meses considerados</h4>
                {/* Em telas estreitas a tabela rola na horizontal: a região recebe foco para rolar pelo teclado. */}
                <div
                  className="overflow-x-auto rounded outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  tabIndex={0}
                  role="region"
                  aria-label="Tabela dos meses considerados"
                >
                  <table className="w-full min-w-[32rem] text-left text-xs">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700">
                        <th scope="col" className="py-1 pr-2">Mês</th>
                        <th scope="col" className="py-1 pr-2 text-right">Receitas oficiais</th>
                        <th scope="col" className="py-1 pr-2 text-right">Desconsideradas</th>
                        <th scope="col" className="py-1 pr-2 text-right">Elegíveis</th>
                        <th scope="col" className="py-1 text-right">Horas previstas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {estimate.months.map((month) => (
                        <tr key={month.month} className="border-b border-gray-100 dark:border-gray-800">
                          <th scope="row" className="py-1 pr-2 font-normal">{monthHeading(month.month)}{month.partial ? ' (incompleto)' : ''}</th>
                          <td className="py-1 pr-2 text-right">{formatCentsBRL(month.receiptsCents)}</td>
                          <td className="py-1 pr-2 text-right">{month.excludedCount > 0 ? `−${formatCentsBRL(month.excludedCents)}` : '—'}</td>
                          <td className="py-1 pr-2 text-right">{formatCentsBRL(month.eligibleCents)}</td>
                          <td className="py-1 text-right">{formatDuration(month.workMinutes)} ({month.workDays} {month.workDays === 1 ? 'dia' : 'dias'})</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p><strong>Total de receitas elegíveis:</strong> {formatCentsBRL(estimate.incomeCents)}. <strong>Horas previstas:</strong> {formatDuration(estimate.workMinutes)}.</p>
              </section>
            )}

            <section aria-labelledby="wt-details-excluded" className="space-y-1">
              <h4 id="wt-details-excluded" className="font-bold text-on-surface">Receitas desconsideradas</h4>
              <p>
                {!calculationReachedMonths(estimate)
                  ? DETAILS_EXCLUSIONS_NOT_APPLIED
                  : estimate.excludedCount > 0
                  ? `Você desconsiderou ${estimate.excludedCount} ${estimate.excludedCount === 1 ? 'receita' : 'receitas'} (${formatCentsBRL(estimate.excludedCents)}). Elas continuam nos seus lançamentos e relatórios; só saem desta estimativa.`
                  : 'Você não desconsiderou nenhuma receita.'}
              </p>
              <p>Ficam fora automaticamente, pelas marcas do sistema: transferências entre contas, empréstimos, aportes e resgates de investimento, pagamentos de fatura, reembolsos da divisão de contas, receitas previstas e lançamentos anulados. O estorno de um recebimento fica na data do recebimento e anula o valor dele naquele mês; juros e multas de recebimentos são resultado financeiro e não entram.</p>
            </section>

            <section aria-labelledby="wt-details-holidays" className="space-y-1">
              <h4 id="wt-details-holidays" className="font-bold text-on-surface">Feriados e exceções</h4>
              {!calculationReachedMonths(estimate) ? <p>{DETAILS_CALENDAR_NOT_APPLIED}</p> : <>
              <p><strong>Feriados que tiraram dias de trabalho:</strong> {holidaysOff.length > 0 ? holidaysOff.map((item) => `${formatCivilDateBR(item.date)} (${item.name})`).join('; ') : 'nenhum'}.</p>
              {holidaysRest.length > 0 && <p><strong>Feriados em dias sem trabalho (sem desconto):</strong> {holidaysRest.map((item) => formatCivilDateBR(item.date)).join(', ')}.</p>}
              {holidaysWorked.length > 0 && <p><strong>Feriados trabalhados:</strong> {holidaysWorked.map((item) => formatCivilDateBR(item.date)).join(', ')}.</p>}
              <p>
                <strong>Férias, folgas e exceções:</strong>{' '}
                {exceptionTotals.length > 0
                  ? exceptionTotals.map((item) => `${EXCEPTION_LABELS[item.kind]}: ${item.days} ${item.days === 1 ? 'dia' : 'dias'}`).join('; ')
                  : 'nenhuma no período'}.
              </p>
              </>}
            </section>

            <section aria-labelledby="wt-details-limits" className="space-y-1">
              <h4 id="wt-details-limits" className="font-bold text-on-surface">Limitações</h4>
              <ul className="list-disc space-y-1 pl-5">
                {estimate.notes.map((note) => <li key={note.kind} data-testid={`work-time-note-${note.kind}`}>{estimateNoteText(note)}</li>)}
                {STANDING_LIMITATIONS.map((text) => <li key={text}>{text}</li>)}
              </ul>
            </section>
          </>
        )}
      </div>
    </WorkTimeDialog>
  );
};
