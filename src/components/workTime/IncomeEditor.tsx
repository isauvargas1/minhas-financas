import React, { useMemo } from 'react';

import { formatCentsBRL } from '../../lib/money';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { useIncomeWindow } from '../../modules/transactions/hooks';
import type { WorkTimeEstimateMode, WorkTimeHistoryMonths } from '../../modules/work-time/contract';
import { WORK_TIME_HISTORY_MONTHS } from '../../modules/work-time/contract';
import { formatCivilDateBR, monthHeading } from '../../modules/work-time/draft';
import { estimateWindowMonths } from '../../modules/work-time/estimate';
import {
  buildIncomeItemViews,
  reconcileIncomeMonths,
  type IncomeDocument,
  type IncomeItemView,
} from '../../modules/work-time/incomeBasis';
import { MAX_EXCLUDED_INCOME_IDS } from '../../modules/work-time/grammar';
import { BUSINESS_INCOME_WARNING, INCOME_KIND_LABELS, incomeItemPresentation } from '../../modules/work-time/messages';
import type { IncomeEstimateState } from '../../modules/work-time/useIncomeEstimate';
import {
  WorkTimeDialog,
  cardClass,
  compactInputClass,
  errorTextClass,
  helpTextClass,
  labelClass,
  noticeClass,
  primaryButtonClass,
  secondaryButtonClass,
} from './ui';

export interface IncomeValue {
  incomeWorkspaceId: string;
  allowBusinessIncome: boolean;
  estimateMode: WorkTimeEstimateMode;
  historyMonths: WorkTimeHistoryMonths;
  excludedIncomeIds: readonly string[];
}

/** Janela que o painel lista: do primeiro mês do cálculo até hoje (no modo habitual, o mês corrente aparece como depois do período). */
const listingWindow = (value: IncomeValue, referenceDate: string | null) => {
  if (!referenceDate) return { since: null, until: null, months: [] as string[] };
  const months = estimateWindowMonths(value.estimateMode, value.historyMonths, referenceDate);
  return { since: months.length > 0 ? `${months[0]}-01` : null, until: referenceDate, months };
};

const referenceOf = (state: IncomeEstimateState) => (state.status === 'done' ? state.estimate.referenceDate : null);

/** Itens da janela, carregados só quando alguém os pede (etapa E e painel). */
export const useIncomeItems = (value: IncomeValue, state: IncomeEstimateState, enabled: boolean) => {
  const window = listingWindow(value, referenceOf(state));
  const query = useIncomeWindow(value.incomeWorkspaceId || null, window.since, window.until, { enabled });
  const items = useMemo(
    () => (query.data ? buildIncomeItemViews(query.data.items as unknown as IncomeDocument[], value.excludedIncomeIds) : null),
    [query.data, value.excludedIncomeIds],
  );
  return { query, items, months: window.months, truncated: query.data?.truncated === true };
};

const ItemRow: React.FC<{
  item: IncomeItemView;
  onToggle: (item: IncomeItemView) => void;
  limitReached: boolean;
  months: readonly string[];
}> = ({ item, onToggle, limitReached, months }) => {
  const label = item.description.trim() || INCOME_KIND_LABELS[item.classification.kind];
  const presentation = incomeItemPresentation(item, months);
  const contribution = item.classification.contributionCents;
  return (
    <li className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1 border-b border-gray-100 py-2 dark:border-gray-800" data-testid={`income-item-${item.id}`}>
      <div className="min-w-0 flex-1">
        <p className="break-words font-medium text-on-surface">{formatCivilDateBR(item.date)} · {label}</p>
        <p className="text-xs text-muted">
          {INCOME_KIND_LABELS[item.classification.kind]} · {formatCentsBRL(item.valueCents)}
          {contribution !== 0 && contribution !== item.valueCents && ` · entra ${contribution < 0 ? '−' : ''}${formatCentsBRL(Math.abs(contribution))}`}
        </p>
        <p className="text-xs text-muted">{presentation.status}</p>
        {presentation.reversalNote && (
          <p className="text-xs text-amber-800 dark:text-amber-300">{presentation.reversalNote}</p>
        )}
        {item.possibleDuplicate && <p className="text-xs text-amber-800 dark:text-amber-300">Possível lançamento em duplicidade (mesma data, valor e conta). Confira e desconsidere se for o caso.</p>}
      </div>
      {presentation.canToggle && (
        <label className="inline-flex shrink-0 cursor-pointer items-center gap-2 text-xs text-on-surface">
          <input
            type="checkbox"
            checked={!item.excludedByUser}
            disabled={!item.excludedByUser && limitReached}
            onChange={() => onToggle(item)}
            className="h-4 w-4 rounded text-primary focus:ring-primary"
            aria-label={`Considerar ${label} de ${formatCivilDateBR(item.date)} na estimativa`}
          />
          Considerar
        </label>
      )}
    </li>
  );
};

/** Painel "Receitas consideradas". Desconsiderar afeta só esta estimativa. */
export const IncomePanelDialog: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  value: IncomeValue;
  onChange: (patch: Partial<IncomeValue>) => void;
  state: IncomeEstimateState;
}> = ({ isOpen, onClose, value, onChange, state }) => {
  const { query, items, months, truncated } = useIncomeItems(value, state, isOpen);
  const official = state.status === 'done'
    ? state.estimate.months.map((month) => ({ month: month.month, receiptsCents: month.receiptsCents, partial: month.partial }))
    : [];
  const reconciliation = items ? reconcileIncomeMonths(items, official) : [];
  const limitReached = value.excludedIncomeIds.length >= MAX_EXCLUDED_INCOME_IDS;
  const toggle = (item: IncomeItemView) => {
    const ids = item.excludedByUser
      ? value.excludedIncomeIds.filter((id) => id !== item.id)
      : [...value.excludedIncomeIds, item.id];
    onChange({ excludedIncomeIds: ids });
  };
  return (
    <WorkTimeDialog
      isOpen={isOpen}
      onClose={onClose}
      title="Receitas consideradas"
      titleId="work-time-income-title"
      testId="work-time-income-panel"
      footer={(
        <>
          <button type="button" className={secondaryButtonClass} disabled={value.excludedIncomeIds.length === 0}
            onClick={() => onChange({ excludedIncomeIds: [] })}>
            Restaurar padrão
          </button>
          <button type="button" className={primaryButtonClass} onClick={onClose}>Concluir</button>
        </>
      )}
    >
      <div className="space-y-3">
        <p>Desconsiderar tira o item só desta estimativa: o lançamento continua igual nos seus registros, saldos e relatórios.</p>
        <p className={noticeClass}>
          Receitas comuns entram como renda. Se alguma for aporte, empréstimo informal, transferência entre contas suas ou reembolso, desconsidere-a: o sistema não lê descrições para decidir.
        </p>
        <p className="text-xs text-muted">
          Aqui aparecem as receitas e os estornos de recebimento do período. Transferências entre contas, aportes e resgates de investimento, empréstimos, pagamentos de fatura e divisões de contas não são receita: ficam fora da renda automaticamente e não são listados.
        </p>
        {value.incomeWorkspaceId === '' && <p role="note">Escolha de qual espaço vem a sua renda para ver as receitas do período.</p>}
        {value.incomeWorkspaceId !== '' && (state.status === 'idle' || state.status === 'loading') && <p role="status">Carregando as receitas do período...</p>}
        {state.status === 'error' && <p role="alert">A estimativa não carregou, então a lista ainda não pode ser montada. Feche e tente de novo.</p>}
        {query.isLoading && <p role="status">Carregando as receitas do período...</p>}
        {query.isError && <p role="alert">Não foi possível carregar as receitas agora. Feche e tente de novo.</p>}
        {truncated && <p className={noticeClass} role="note">Há receitas demais no período para listar todas aqui. A estimativa continua usando os totais oficiais.</p>}
        {items && months.length > 0 && [...months].reverse().map((month) => {
          const own = items.filter((item) => item.month === month);
          const check = reconciliation.find((entry) => entry.month === month);
          return (
            <section key={month} aria-labelledby={`income-month-${month}`} className="space-y-1">
              <h4 id={`income-month-${month}`} className="font-bold text-on-surface">{monthHeading(month)}</h4>
              {check && (
                <p className="text-xs text-muted" data-testid={`income-reconciliation-${month}`}>
                  {check.matches
                    ? `Confere com o relatório oficial: ${formatCentsBRL(check.officialCents)}.`
                    : `A lista soma ${formatCentsBRL(check.listedCents)} e o relatório oficial, ${formatCentsBRL(check.officialCents)}: o relatório pode estar se atualizando. A estimativa usa o total oficial.`}
                  {' '}{check.considered} {check.considered === 1 ? 'considerada' : 'consideradas'}, {check.excludedByUser} {check.excludedByUser === 1 ? 'desconsiderada' : 'desconsideradas'} por você, {check.automatic} fora pelas regras.
                </p>
              )}
              {own.length === 0 ? <p className="text-xs text-muted">Nenhuma receita neste mês.</p> : (
                <ul>{own.map((item) => <ItemRow key={item.id} item={item} onToggle={toggle} limitReached={limitReached} months={months} />)}</ul>
              )}
            </section>
          );
        })}
        {items && items.some((item) => !months.includes(item.month)) && (
          <section className="space-y-1">
            <h4 className="font-bold text-on-surface">Depois do período</h4>
            <ul>{items.filter((item) => !months.includes(item.month)).map((item) => <ItemRow key={item.id} item={item} onToggle={toggle} limitReached={limitReached} months={months} />)}</ul>
          </section>
        )}
        {limitReached && <p className={errorTextClass}>Você chegou ao limite de {MAX_EXCLUDED_INCOME_IDS} receitas desconsideradas.</p>}
      </div>
    </WorkTimeDialog>
  );
};

/**
 * Fonte e período da renda (etapa E e Configurações). PF é o padrão; PJ
 * exige confirmação expressa, com o aviso de que faturamento não é renda
 * pessoal. Uma fonte por vez: nada é somado entre espaços.
 */
const IncomeEditor: React.FC<{
  idPrefix: string;
  value: IncomeValue;
  onChange: (patch: Partial<IncomeValue>) => void;
  state: IncomeEstimateState;
  showCount: boolean;
}> = ({ idPrefix, value, onChange, state, showCount }) => {
  const { workspaces, hasMoreWorkspaces, loadMoreWorkspaces } = useWorkspace();
  const selected = workspaces.find((workspace) => workspace.id === value.incomeWorkspaceId) ?? null;
  const isBusiness = selected?.type === 'PJ' || (state.status === 'done' && state.estimate.workspaceType === 'PJ');
  const { query, items, months, truncated } = useIncomeItems(value, state, showCount && value.incomeWorkspaceId !== '');
  const considered = items?.filter((item) => item.excludable && !item.excludedByUser && months.includes(item.month)) ?? null;
  const excludedCount = value.excludedIncomeIds.length;
  const countText = (() => {
    if (value.incomeWorkspaceId === '') return 'Escolha o espaço da renda para contar os lançamentos de receita.';
    if (state.status === 'error') return 'Não foi possível contar os lançamentos agora: a estimativa não carregou.';
    if (query.isError) return 'Não foi possível contar os lançamentos de receita agora.';
    if (considered === null) return 'Contando os lançamentos de receita do período...';
    const counted = `${considered.length} ${considered.length === 1 ? 'lançamento de receita considerado' : 'lançamentos de receita considerados'}`;
    const excluded = excludedCount > 0 ? `; ${excludedCount} ${excludedCount === 1 ? 'desconsiderado' : 'desconsiderados'} por você` : '';
    const partial = truncated ? ' (contagem parcial: há receitas demais no período para listar todas; a estimativa usa os totais oficiais)' : '';
    return `${counted}${excluded}${partial}.`;
  })();
  return (
    <div className={`${cardClass} min-w-0 space-y-4`}>
      <div>
        <label htmlFor={`${idPrefix}-workspace`} className={labelClass}>De qual espaço vem a sua renda?</label>
        <select id={`${idPrefix}-workspace`} value={value.incomeWorkspaceId} className={compactInputClass}
          onChange={(event) => onChange({ incomeWorkspaceId: event.target.value, allowBusinessIncome: false, excludedIncomeIds: [] })}>
          {value.incomeWorkspaceId === '' && <option value="">Escolha um espaço</option>}
          {!selected && value.incomeWorkspaceId !== '' && <option value={value.incomeWorkspaceId}>Espaço salvo</option>}
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name} · {workspace.type === 'PJ' ? 'PJ (empresa)' : 'PF (pessoal)'}
            </option>
          ))}
        </select>
        {hasMoreWorkspaces && (
          <button type="button" className="mt-1 text-xs font-medium text-primary hover:underline dark:text-primary-on-dark" onClick={() => void loadMoreWorkspaces()}>
            Carregar mais espaços
          </button>
        )}
        <p className={helpTextClass}>Uma fonte por vez: receitas de espaços diferentes nunca são somadas.</p>
      </div>
      {isBusiness && (
        <div className="space-y-2">
          <p className={noticeClass} role="note">{BUSINESS_INCOME_WARNING}</p>
          <label className="inline-flex cursor-pointer items-start gap-2 text-sm text-on-surface">
            <input type="checkbox" checked={value.allowBusinessIncome} className="mt-0.5 h-4 w-4 rounded text-primary focus:ring-primary"
              onChange={(event) => onChange({ allowBusinessIncome: event.target.checked })} data-testid={`${idPrefix}-allow-business`} />
            Quero usar a receita deste espaço PJ como referência da minha renda.
          </label>
        </div>
      )}
      <fieldset className="min-w-0">
        <legend className={labelClass}>Como estimar</legend>
        <div className="space-y-2">
          <label className="flex cursor-pointer items-start gap-2 text-sm text-on-surface">
            <input type="radio" name={`${idPrefix}-mode`} checked={value.estimateMode === 'habitual'} className="mt-0.5 h-4 w-4 text-primary focus:ring-primary"
              onChange={() => onChange({ estimateMode: 'habitual' })} />
            <span><strong>Habitual (recomendado):</strong> últimos meses completos. Mais estável para comissões e renda variável.</span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-sm text-on-surface">
            <input type="radio" name={`${idPrefix}-mode`} checked={value.estimateMode === 'current_month'} className="mt-0.5 h-4 w-4 text-primary focus:ring-primary"
              onChange={() => onChange({ estimateMode: 'current_month' })} />
            <span><strong>Mês atual:</strong> receitas já efetivadas neste mês ÷ horas previstas do mês inteiro. Muda até o fim do mês.</span>
          </label>
        </div>
      </fieldset>
      {value.estimateMode === 'habitual' && (
        <div className="max-w-xs">
          <label htmlFor={`${idPrefix}-history`} className={labelClass}>Meses completos considerados</label>
          <select id={`${idPrefix}-history`} value={String(value.historyMonths)} className={compactInputClass}
            onChange={(event) => onChange({ historyMonths: Number(event.target.value) as WorkTimeHistoryMonths })}>
            {WORK_TIME_HISTORY_MONTHS.map((months) => (
              <option key={months} value={String(months)}>{months === 1 ? '1 mês' : `${months} meses`}{months === 3 ? ' (recomendado)' : ''}</option>
            ))}
          </select>
        </div>
      )}
      {showCount && (
        <p className="text-sm text-on-surface" data-testid={`${idPrefix}-count`} aria-live="polite">
          {countText}
        </p>
      )}
    </div>
  );
};

export default IncomeEditor;
