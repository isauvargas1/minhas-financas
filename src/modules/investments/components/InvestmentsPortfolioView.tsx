import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Goal } from '../../../types';
import { callInvestment, investmentRequestIds } from '../persistence/callableApi';
import { useFinancialIntent } from '../hooks/useIntentNonce';
import {
  getInvestmentSummary,
  listInvestmentAccounts,
  listInvestmentAssets,
  listInvestmentMovements,
  listInvestmentPositions,
  resolveInvestmentAccountNames,
  resolveInvestmentAssetNames,
  type InvestmentCursor,
  type MovementCursor,
} from '../persistence/readApi';
import { InvestmentAllocationSection } from './InvestmentAllocationSection';
import { Field, safeError } from './shared';
import type { InvestmentAccount, InvestmentAsset, InvestmentMovement, InvestmentPosition } from '../types';

type Tab = 'summary' | 'accounts' | 'positions' | 'allocation' | 'movements';
type Editor =
  | 'account' | 'asset' | 'contribution' | 'redemption' | 'settle'
  | 'cancel' | 'link' | 'reverse' | 'valuation' | 'archive' | null;

interface Props {
  workspaceId: string;
  profileType: 'PF' | 'PJ';
  canManage: boolean;
  goals: Goal[];
  onBack: () => void;
}

import { money } from './shared';
const date = (value?: { toDate(): Date }) => value
  ? new Intl.DateTimeFormat('pt-BR').format(value.toDate())
  : '—';
const cents = (value: FormDataEntryValue | null) => Math.round(Number(String(value ?? 0).replace(',', '.')) * 100);
const micros = (value: FormDataEntryValue | null) => Math.round(Number(String(value ?? 0).replace(',', '.')) * 1_000_000);

const EDITOR_TITLES: Record<Exclude<Editor, null>, string> = {
  account: 'Conta de investimento',
  asset: 'Ativo de investimento',
  contribution: 'Novo aporte',
  redemption: 'Solicitar resgate',
  settle: 'Liquidar resgate',
  cancel: 'Cancelar pedido pendente',
  link: 'Meta vinculada à posição',
  reverse: 'Reverter movimentação',
  valuation: 'Registrar valoração',
  archive: 'Inativar registro',
};

const movementStatusLabel = (status: string) =>
  status === 'pending' ? 'Pendente' : status === 'cancelled' ? 'Cancelada' : 'Liquidada';

const Modal: React.FC<{ title: string; open: boolean; onClose(): void; children: React.ReactNode }> = ({ title, open, onClose, children }) => {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open && !ref.current?.open) {
      opener.current = document.activeElement as HTMLElement;
      ref.current?.showModal();
    } else if (!open && ref.current?.open) ref.current.close();
  }, [open]);
  return (
    <dialog ref={ref} onCancel={(event) => { event.preventDefault(); onClose(); }} onClose={() => opener.current?.focus()}
      className="w-[min(94vw,36rem)] rounded-2xl bg-surface p-0 text-on-surface shadow-2xl backdrop:bg-black/50">
      <div className="flex items-center justify-between border-b border-outline/20 px-5 py-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        <button type="button" onClick={onClose} aria-label="Fechar janela" className="rounded-lg px-3 py-2 hover:bg-surface-variant">×</button>
      </div>
      <div className="p-5">{children}</div>
    </dialog>
  );
};

const State: React.FC<{ loading: boolean; error: boolean; empty?: boolean; emptyText?: string }> = ({ loading, error, empty, emptyText }) => {
  if (loading) return <p role="status" className="py-10 text-center">Carregando investimentos…</p>;
  if (error) return <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-800">Não foi possível carregar os investimentos. Tente novamente.</p>;
  if (empty) return <p className="rounded-lg border border-dashed border-outline/40 p-8 text-center text-on-surface-variant">{emptyText}</p>;
  return null;
};

export const InvestmentsPortfolioView: React.FC<Props> = ({ workspaceId, profileType, canManage, goals, onBack }) => {
  const client = useQueryClient();
  const [tab, setTab] = useState<Tab>('summary');
  const [editor, setEditor] = useState<Editor>(null);
  const [selected, setSelected] = useState<InvestmentAccount | InvestmentAsset | InvestmentPosition | InvestmentMovement | null>(null);
  const [notice, setNotice] = useState('');
  const [accountStatus, setAccountStatus] = useState<'active' | 'archived'>('active');
  const [assetStatus, setAssetStatus] = useState<'active' | 'archived'>('active');
  const [accountCursor, setAccountCursor] = useState<InvestmentCursor>();
  const [assetCursor, setAssetCursor] = useState<InvestmentCursor>();
  const [positionCursor, setPositionCursor] = useState<InvestmentCursor>();
  const [movementCursor, setMovementCursor] = useState<MovementCursor>();
  const [positionAccount, setPositionAccount] = useState('');
  const [movementStatus, setMovementStatus] = useState('');
  const [movementOperation, setMovementOperation] = useState('');

  const summary = useQuery({ queryKey: ['investment-summary', workspaceId], queryFn: () => getInvestmentSummary(workspaceId), enabled: tab === 'summary' });
  const accounts = useQuery({ queryKey: ['investment-accounts', workspaceId, accountStatus, accountCursor?.id], queryFn: () => listInvestmentAccounts(workspaceId, accountStatus, accountCursor), enabled: tab === 'accounts' });
  const assets = useQuery({ queryKey: ['investment-assets', workspaceId, assetStatus, assetCursor?.id], queryFn: () => listInvestmentAssets(workspaceId, assetStatus, assetCursor), enabled: tab === 'positions' });
  const activeAccounts = useQuery({ queryKey: ['investment-accounts', workspaceId, 'active', undefined], queryFn: () => listInvestmentAccounts(workspaceId, 'active'), enabled: tab === 'positions' || editor === 'contribution' });
  const activeAssets = useQuery({ queryKey: ['investment-assets', workspaceId, 'active', undefined], queryFn: () => listInvestmentAssets(workspaceId, 'active'), enabled: tab === 'positions' || editor === 'contribution' });
  const positions = useQuery({ queryKey: ['investment-positions', workspaceId, positionAccount, positionCursor?.id], queryFn: () => listInvestmentPositions(workspaceId, positionAccount || undefined, positionCursor), enabled: tab === 'positions' });
  const movements = useQuery({ queryKey: ['investment-movements', workspaceId, movementStatus, movementOperation, movementCursor?.id], queryFn: () => listInvestmentMovements(workspaceId, { status: movementStatus || undefined, operation: movementOperation || undefined }, movementCursor), enabled: tab === 'movements' });
  // INV-P3-050 — os nomes das posições resolvem por ID, e não pelo mapa dos
  // registros ativos carregados: um ativo arquivado nunca aparece na lista de
  // ativos, e a tabela exibia um fragmento do ID no lugar do nome.
  const positionEntityIds = useMemo(() => {
    const items = positions.data?.items ?? [];
    return {
      accountIds: items.map((item) => item.accountId),
      assetIds: items.map((item) => item.assetId),
    };
  }, [positions.data]);
  const resolvedNames = useQuery({
    queryKey: [
      'investment-entity-names', workspaceId,
      positionEntityIds.accountIds.join(','), positionEntityIds.assetIds.join(','),
    ],
    enabled: positionEntityIds.assetIds.length > 0,
    queryFn: async () => {
      const [accountsById, assetsById] = await Promise.all([
        resolveInvestmentAccountNames(workspaceId, positionEntityIds.accountIds),
        resolveInvestmentAssetNames(workspaceId, positionEntityIds.assetIds),
      ]);
      return { accountsById, assetsById };
    },
  });
  const accountNames = resolvedNames.data?.accountsById ?? new Map<string, string>();
  const assetNames = resolvedNames.data?.assetsById ?? new Map<string, string>();

  /**
   * Identidade da intenção financeira aberta: o formulário e a entidade que
   * ele edita. A chave de idempotência deriva daqui, e não de um UUID novo por
   * clique (INV-P1-004).
   */
  const intent = useFinancialIntent(editor === null ? null : `${editor}:${selected?.id ?? 'novo'}`);

  // INV-P3-058 — o aviso de sucesso permanecia na tela ao trocar de aba ou
  // abrir outro editor, descrevendo uma operação que já não é a que o usuário
  // está vendo.
  const openEditor = (next: Exclude<Editor, null>, item: typeof selected = null) => {
    setNotice('');
    setSelected(item);
    setEditor(next);
  };
  const changeTab = (next: Tab) => {
    setNotice('');
    setTab(next);
  };
  const isoNow = intent.occurredAt;

  const mutation = useMutation({
    mutationFn: ({ name, payload }: { name: string; payload: Record<string, unknown> }) => {
      const body = { workspaceId, ...payload };
      return callInvestment(name, {
        ...body,
        ...investmentRequestIds(name, intent.nonce, body),
      });
    },
    onSuccess: async (_data, variables) => {
      setEditor(null); setSelected(null); setArchiveTarget(null);
      setNotice('Operação concluída com sucesso.');
      if (variables.name.includes('Account')) {
        await client.invalidateQueries({ queryKey: ['investment-accounts', workspaceId] });
      } else if (variables.name.includes('Asset')) {
        await client.invalidateQueries({ queryKey: ['investment-assets', workspaceId] });
      } else {
        await Promise.all([
          client.invalidateQueries({ queryKey: ['investment-summary', workspaceId] }),
          client.invalidateQueries({ queryKey: ['investment-positions', workspaceId] }),
          client.invalidateQueries({ queryKey: ['investment-movements', workspaceId] }),
          client.invalidateQueries({ queryKey: ['investment-allocations', workspaceId] }),
          variables.name.includes('Goal')
            ? client.invalidateQueries({ queryKey: ['goals', workspaceId] })
            : Promise.resolve(),
        ]);
      }
    },
    onError: (error) => setNotice(safeError(error)),
  });

  const submitEntity = (event: React.FormEvent<HTMLFormElement>, kind: 'account' | 'asset') => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    mutation.mutate({ name: kind === 'account' ? 'saveInvestmentAccount' : 'saveInvestmentAsset', payload: kind === 'account'
      ? { accountId: selected?.id, name: form.get('name'), institutionName: form.get('institutionName') }
      : { assetId: selected?.id, name: form.get('name'), symbol: form.get('symbol') || undefined, assetType: form.get('assetType'), allocationPurpose: form.get('allocationPurpose') } });
  };

  const submitMovement = (event: React.FormEvent<HTMLFormElement>, kind: 'contribution' | 'redemption') => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const position = selected as InvestmentPosition | null;
    if (kind === 'contribution') mutation.mutate({ name: 'createInvestmentContribution', payload: {
      accountId: form.get('accountId'), assetId: form.get('assetId'), goalId: form.get('goalId') || undefined,
      description: form.get('description'), principalCents: cents(form.get('principal')), quantityMicros: micros(form.get('quantity')),
      feesCents: cents(form.get('fees')), taxCents: cents(form.get('tax')), occurredAt: isoNow(),
    }});
    else {
      const principal = form.get('mode') === 'total' ? position?.principalCents : cents(form.get('principal'));
      const quantity = form.get('mode') === 'total' ? position?.quantityMicros : micros(form.get('quantity'));
      if (!principal || !quantity || !position || principal > position.principalCents || quantity > position.quantityMicros) {
        setNotice('Informe valores positivos que não ultrapassem o saldo disponível.');
        return;
      }
      mutation.mutate({ name: 'createInvestmentRedemption', payload: {
      accountId: position?.accountId, assetId: position?.assetId, description: form.get('description'),
      requestedPrincipalCents: principal,
      requestedQuantityMicros: quantity,
      requestedAt: isoNow(),
    }});
    }
  };

  // INV-P3-057 — a inativação usava `window.confirm`, enquanto Cadastros já
  // usava `<dialog>`: dois padrões de confirmação para a mesma ação, e o
  // `window.confirm` não é estilizável, não prende foco e é bloqueado por
  // alguns navegadores em contexto embutido.
  const [archiveTarget, setArchiveTarget] =
    useState<{ kind: 'account' | 'asset'; item: InvestmentAccount | InvestmentAsset } | null>(null);

  const archive = (kind: 'account' | 'asset', item: InvestmentAccount | InvestmentAsset) => {
    setArchiveTarget({ kind, item });
    setSelected(item);
    setEditor('archive');
  };

  const confirmArchive = () => {
    if (!archiveTarget) return;
    mutation.mutate({
      name: archiveTarget.kind === 'account' ? 'archiveInvestmentAccount' : 'archiveInvestmentAsset',
      payload: {
        [archiveTarget.kind === 'account' ? 'accountId' : 'assetId']: archiveTarget.item.id,
        reason: 'Inativação solicitada pela interface patrimonial.',
      },
    });
  };

  const tabs: Array<[Tab, string]> = [
    ['summary', 'Resumo'],
    ['accounts', 'Contas'],
    ['positions', 'Ativos e posições'],
    ['allocation', 'Alocação'],
    ['movements', 'Movimentações'],
  ];
  const pageButtons = (hasCursor: boolean, first: () => void, next: (() => void) | undefined) => <div className="flex gap-2">{hasCursor && <button className="rounded-lg border border-outline/30 px-3 py-2" onClick={first}>Primeira página</button>}{next && <button className="rounded-lg border border-outline/30 px-3 py-2" onClick={next}>Próxima página</button>}</div>;

  return <section className="mx-auto max-w-7xl space-y-5" aria-labelledby="investments-title">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><button onClick={onBack} className="mb-2 text-sm text-primary">← Voltar ao painel</button><h1 id="investments-title" className="text-2xl font-bold">Patrimônio e investimentos</h1></div>
      <button onClick={() => openEditor('contribution')} className="rounded-lg bg-primary px-4 py-2 font-semibold text-on-primary">Novo aporte</button>
    </div>
    {notice && <div role={notice.includes('sucesso') ? 'status' : 'alert'} className="rounded-lg bg-surface-variant p-3">{notice}</div>}
    {tab === 'summary' && summary.data === null && <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900">O resumo será disponibilizado após a primeira movimentação processada no domínio patrimonial.</div>}
    {tab === 'movements' && !!movements.data?.items.some((item) => item.status === 'pending') && <div className="rounded-lg border border-blue-300 bg-blue-50 p-3 text-blue-900">Há resgates aguardando liquidação. Eles ainda não alteram caixa nem patrimônio realizado.</div>}
    {/*
      Padrão ARIA de abas completo. Antes havia `role="tab"` e `aria-selected`
      sem `aria-controls`, sem `tabpanel` e sem foco itinerante: o leitor de
      tela anunciava "aba 1 de 4" e prometia uma navegação que não existia —
      pior do que não usar o papel. Agora só a aba ativa recebe foco por Tab, e
      as setas percorrem as demais.
    */}
    <div role="tablist" aria-label="Seções de investimentos" className="flex gap-2 overflow-x-auto border-b border-outline/20">
      {tabs.map(([id, label], index) => <button
        key={id}
        id={`investments-tab-${id}`}
        role="tab"
        type="button"
        aria-selected={tab === id}
        aria-controls={`investments-panel-${id}`}
        tabIndex={tab === id ? 0 : -1}
        onClick={() => changeTab(id)}
        onKeyDown={(event) => {
          const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
          if (step === 0) return;
          event.preventDefault();
          const next = tabs[(index + step + tabs.length) % tabs.length][0];
          changeTab(next);
          document.getElementById(`investments-tab-${next}`)?.focus();
        }}
        className={`whitespace-nowrap px-4 py-3 ${tab === id ? 'border-b-2 border-primary font-semibold text-primary' : ''}`}
      >{label}</button>)}
    </div>

    {tab === 'summary' && <div role="tabpanel" id="investments-panel-summary" aria-labelledby="investments-tab-summary"><State loading={summary.isLoading} error={summary.isError} />{summary.data && <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {[['Patrimônio atual', summary.data.currentValueCents], ['Principal investido', summary.data.principalCents], ['Valorização não realizada', summary.data.unrealizedAppreciationCents], ['Ganho realizado', summary.data.realizedGainCents]].map(([label, value]) => <article key={String(label)} className="rounded-xl border border-outline/20 bg-surface p-5"><p className="text-sm text-on-surface-variant">{label}</p><p className="mt-2 text-xl font-bold">{money(Number(value))}</p></article>)}
    </div>}</div>}

    {tab === 'accounts' && <div role="tabpanel" id="investments-panel-accounts" aria-labelledby="investments-tab-accounts" className="space-y-4">
      <div className="flex flex-wrap justify-between gap-3"><label className="text-sm">Situação <select value={accountStatus} onChange={(e) => { setAccountStatus(e.target.value as typeof accountStatus); setAccountCursor(undefined); }} className="ml-2 rounded-lg border px-3 py-2"><option value="active">Ativas</option><option value="archived">Inativas</option></select></label>{canManage && <button onClick={() => openEditor('account')} className="rounded-lg border px-3 py-2">Nova conta</button>}</div>
      <State loading={accounts.isLoading} error={accounts.isError} empty={!accounts.data?.items.length} emptyText="Nenhuma conta encontrada para este filtro." />
      <div className="grid gap-3 md:grid-cols-2">{accounts.data?.items.map((item) => <article key={item.id} className="rounded-xl border p-4"><h3 className="font-semibold">{item.name}</h3><p className="text-sm text-on-surface-variant">{item.institutionName}</p>{canManage && item.status === 'active' && <div className="mt-3 flex gap-2"><button onClick={() => openEditor('account', item)} className="text-primary">Editar</button><button onClick={() => archive('account', item)} className="text-red-700">Inativar</button></div>}</article>)}</div>
      {pageButtons(!!accountCursor, () => setAccountCursor(undefined), accounts.data?.nextCursor ? () => setAccountCursor(accounts.data!.nextCursor!) : undefined)}
    </div>}

    {tab === 'positions' && <div role="tabpanel" id="investments-panel-positions" aria-labelledby="investments-tab-positions" className="space-y-4">
      <div className="flex flex-wrap justify-between gap-3"><label className="text-sm">Conta <select value={positionAccount} onChange={(e) => { setPositionAccount(e.target.value); setPositionCursor(undefined); }} className="ml-2 rounded-lg border px-3 py-2"><option value="">Todas</option>{activeAccounts.data?.items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{canManage && <button onClick={() => openEditor('asset')} className="rounded-lg border px-3 py-2">Novo ativo</button>}</div>
      <section aria-labelledby="assets-title" className="space-y-3"><div className="flex items-center justify-between"><h2 id="assets-title" className="text-lg font-semibold">Cadastro de ativos</h2><select aria-label="Situação dos ativos" value={assetStatus} onChange={(e) => { setAssetStatus(e.target.value as typeof assetStatus); setAssetCursor(undefined); }} className="rounded-lg border px-3 py-2"><option value="active">Ativos</option><option value="archived">Inativos</option></select></div><State loading={assets.isLoading} error={assets.isError} empty={!assets.data?.items.length} emptyText="Nenhum ativo encontrado para este filtro." /><div className="grid gap-3 md:grid-cols-3">{assets.data?.items.map((item) => <article key={item.id} className="rounded-xl border p-3"><h3 className="font-semibold">{item.name}</h3><p className="text-sm text-on-surface-variant">{item.symbol || 'Sem código informado'}</p>{canManage && item.status === 'active' && <div className="mt-2 flex gap-2"><button onClick={() => openEditor('asset', item)} className="text-primary">Editar</button><button onClick={() => archive('asset', item)} className="text-red-700">Inativar</button></div>}</article>)}</div>{pageButtons(!!assetCursor, () => setAssetCursor(undefined), assets.data?.nextCursor ? () => setAssetCursor(assets.data!.nextCursor!) : undefined)}</section>
      <State loading={positions.isLoading || assets.isLoading} error={positions.isError || assets.isError} empty={!positions.data?.items.length} emptyText="Nenhuma posição encontrada. Cadastre conta e ativo antes de fazer um aporte." />
      <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left"><thead><tr className="border-b"><th className="p-3">Ativo</th><th>Conta</th><th>Principal</th><th>Valor atual</th><th>Meta</th><th>Ações</th></tr></thead><tbody>{positions.data?.items.map((item) => <tr key={item.id} className="border-b"><td className="p-3">{assetNames.get(item.assetId) ?? `Ativo ${item.assetId.slice(-6)}`}</td><td>{accountNames.get(item.accountId) ?? `Conta ${item.accountId.slice(-6)}`}</td><td>{money(item.principalCents)}</td><td>{money(item.currentValueCents)}</td><td>{goals.find((goal) => goal.id === item.goalId)?.name ?? 'Sem meta'}</td><td className="space-x-3"><button onClick={() => openEditor('redemption', item)} className="text-primary">Resgatar</button><button onClick={() => openEditor('link', item)} className="text-primary">{item.goalId ? 'Alterar meta' : 'Vincular meta'}</button>{canManage && <button onClick={() => openEditor('valuation', item)} className="text-primary">Valorar</button>}</td></tr>)}</tbody></table></div>
      {pageButtons(!!positionCursor, () => setPositionCursor(undefined), positions.data?.nextCursor ? () => setPositionCursor(positions.data!.nextCursor!) : undefined)}
    </div>}

    {tab === 'allocation' && <div role="tabpanel" id="investments-panel-allocation" aria-labelledby="investments-tab-allocation">
      <InvestmentAllocationSection workspaceId={workspaceId} profileType={profileType} />
    </div>}

    {tab === 'movements' && <div role="tabpanel" id="investments-panel-movements" aria-labelledby="investments-tab-movements" className="space-y-4">
      <div className="flex flex-wrap gap-3"><label>Situação <select value={movementStatus} onChange={(e) => { setMovementStatus(e.target.value); setMovementCursor(undefined); }} className="ml-2 rounded-lg border px-3 py-2"><option value="">Todas</option><option value="pending">Pendente</option><option value="settled">Liquidada</option><option value="cancelled">Cancelada</option></select></label><label>Operação <select value={movementOperation} onChange={(e) => { setMovementOperation(e.target.value); setMovementCursor(undefined); }} className="ml-2 rounded-lg border px-3 py-2"><option value="">Todas</option><option value="contribution">Aporte</option><option value="redemption">Resgate</option><option value="reversal">Reversão</option></select></label></div>
      <State loading={movements.isLoading} error={movements.isError} empty={!movements.data?.items.length} emptyText="Nenhuma movimentação encontrada para estes filtros." />
      <div className="space-y-3">{movements.data?.items.map((item) => <article key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"><div><h3 className="font-semibold">{item.description}</h3><p className="text-sm text-on-surface-variant">{item.operation === 'contribution' ? 'Aporte' : item.operation === 'redemption' ? 'Resgate' : item.operation === 'reversal' ? 'Reversão' : 'Vínculo com meta'} · {movementStatusLabel(item.status)} · {date(item.occurredAt)}</p></div><div className="text-right"><p className="font-semibold">{money(item.principalCents)}</p>{item.operation === 'redemption' && item.status === 'pending' && <button onClick={() => openEditor('settle', item)} className="text-sm text-primary">Liquidar</button>}{item.status === 'pending' && <button onClick={() => openEditor('cancel', item)} className="ml-3 text-sm text-red-700">Cancelar pedido</button>}{canManage && item.status === 'settled' && !item.reversedByMovementId && ['contribution', 'redemption'].includes(item.operation) && <button onClick={() => openEditor('reverse', item)} className="ml-3 text-sm text-red-700">Reverter</button>}</div></article>)}</div>
      {pageButtons(!!movementCursor, () => setMovementCursor(undefined), movements.data?.nextCursor ? () => setMovementCursor(movements.data!.nextCursor!) : undefined)}
    </div>}

    <Modal
      title={EDITOR_TITLES[editor ?? 'reverse']}
      open={editor !== null}
      onClose={() => { setEditor(null); setSelected(null); setArchiveTarget(null); }}
    >
      {editor === 'account' && <form onSubmit={(e) => submitEntity(e, 'account')} className="grid gap-4"><Field label="Nome da conta" name="name" required defaultValue={(selected as InvestmentAccount | null)?.name} /><Field label="Instituição" name="institutionName" required defaultValue={(selected as InvestmentAccount | null)?.institutionName} /><button disabled={mutation.isPending} className="rounded-lg bg-primary px-4 py-2 text-on-primary disabled:opacity-60">{mutation.isPending ? 'Processando…' : 'Salvar conta'}</button></form>}
      {editor === 'asset' && <form onSubmit={(e) => submitEntity(e, 'asset')} className="grid gap-4"><Field label="Nome do ativo" name="name" required defaultValue={(selected as InvestmentAsset | null)?.name} /><Field label="Código do ativo (opcional)" name="symbol" defaultValue={(selected as InvestmentAsset | null)?.symbol} /><label className="grid gap-1 text-sm font-medium">Tipo<select name="assetType" className="rounded-lg border px-3 py-2" defaultValue={(selected as InvestmentAsset | null)?.assetType ?? 'fixed_income'}><option value="fixed_income">Renda fixa</option><option value="fund">Fundo</option><option value="stock">Ação</option><option value="etf">ETF</option><option value="crypto">Criptoativo</option><option value="other">Outro</option></select></label><label className="grid gap-1 text-sm font-medium">Finalidade<select name="allocationPurpose" className="rounded-lg border px-3 py-2" defaultValue={(selected as InvestmentAsset | null)?.allocationPurpose ?? 'unassigned'}><option value="unassigned">Não classificado</option>{profileType === 'PF' ? <><option value="retirement">Aposentadoria</option><option value="goal">Objetivo</option></> : <><option value="reserve">Reserva</option><option value="financial_application">Aplicação financeira</option><option value="reinvestment">Reinvestimento</option><option value="fixed_asset">Imobilizado</option></>}</select></label><p className="text-xs text-on-surface-variant">A finalidade não poderá ser alterada depois do primeiro aporte, para preservar relatórios históricos.</p><button disabled={mutation.isPending} className="rounded-lg bg-primary px-4 py-2 text-on-primary disabled:opacity-60">{mutation.isPending ? 'Processando…' : 'Salvar ativo'}</button></form>}
      {editor === 'contribution' && <form onSubmit={(e) => submitMovement(e, 'contribution')} className="grid gap-4"><label>Conta<select name="accountId" required className="w-full rounded-lg border px-3 py-2"><option value="">Selecione</option>{activeAccounts.data?.items.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label><label>Ativo<select name="assetId" required className="w-full rounded-lg border px-3 py-2"><option value="">Selecione</option>{activeAssets.data?.items.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label><label>Meta (opcional)<select name="goalId" className="w-full rounded-lg border px-3 py-2"><option value="">Sem meta</option>{goals.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label><Field label="Descrição" name="description" required /><Field label="Valor principal (R$)" name="principal" type="number" min="0.01" step="0.01" required /><Field label="Quantidade" name="quantity" type="number" min="0.000001" step="0.000001" required /><Field label="Taxas (R$)" name="fees" type="number" min="0" step="0.01" defaultValue="0" /><Field label="Impostos (R$)" name="tax" type="number" min="0" step="0.01" defaultValue="0" /><button disabled={mutation.isPending} className="rounded-lg bg-primary px-4 py-2 text-on-primary disabled:opacity-60">{mutation.isPending ? 'Processando…' : 'Confirmar aporte'}</button></form>}
      {editor === 'redemption' && <form onSubmit={(e) => submitMovement(e, 'redemption')} className="grid gap-4"><label>Tipo de resgate<select name="mode" className="w-full rounded-lg border px-3 py-2"><option value="partial">Parcial</option><option value="total">Total</option></select></label><Field label="Descrição" name="description" required defaultValue="Resgate de investimento" /><Field label="Principal a resgatar (R$)" name="principal" type="number" min="0.01" step="0.01" /><Field label="Quantidade a resgatar" name="quantity" type="number" min="0.000001" step="0.000001" /><p className="text-sm text-on-surface-variant">O pedido fica pendente e não altera caixa ou patrimônio até a liquidação.</p><button disabled={mutation.isPending} className="rounded-lg bg-primary px-4 py-2 text-on-primary disabled:opacity-60">{mutation.isPending ? 'Processando…' : 'Solicitar resgate'}</button></form>}
      {editor === 'settle' && <form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); mutation.mutate({ name: 'settleInvestmentRedemption', payload: { movementId: selected?.id, settledAt: isoNow(), settlement: { principalCents: cents(form.get('principal')), quantityMicros: micros(form.get('quantity')), gainCents: cents(form.get('gain')), feesCents: cents(form.get('fees')), taxCents: cents(form.get('tax')) } } }); }} className="grid gap-4"><Field label="Principal liquidado (R$)" name="principal" type="number" min="0.01" step="0.01" required defaultValue={((selected as InvestmentMovement | null)?.principalCents ?? 0) / 100} /><Field label="Quantidade liquidada" name="quantity" type="number" min="0.000001" step="0.000001" required defaultValue={((selected as InvestmentMovement | null)?.quantityMicros ?? 0) / 1_000_000} /><Field label="Ganho realizado (R$)" name="gain" type="number" min="0" step="0.01" defaultValue="0" /><Field label="Taxas (R$)" name="fees" type="number" min="0" step="0.01" defaultValue="0" /><Field label="Impostos (R$)" name="tax" type="number" min="0" step="0.01" defaultValue="0" /><button disabled={mutation.isPending} className="rounded-lg bg-primary px-4 py-2 text-on-primary disabled:opacity-60">{mutation.isPending ? 'Processando…' : 'Confirmar liquidação'}</button></form>}
      {editor === 'cancel' && <form onSubmit={(event) => { event.preventDefault(); mutation.mutate({ name: 'cancelInvestmentMovement', payload: { movementId: selected?.id, occurredAt: isoNow(), reason: new FormData(event.currentTarget).get('reason') } }); }} className="grid gap-4"><Field label="Motivo do cancelamento" name="reason" minLength={3} required /><p className="text-sm text-on-surface-variant">O pedido pendente não alterou caixa, posição nem meta. O registro é preservado como cancelado, com autor e motivo.</p><button disabled={mutation.isPending} className="rounded-lg bg-red-700 px-4 py-2 text-white disabled:opacity-60">{mutation.isPending ? 'Processando…' : 'Confirmar cancelamento'}</button></form>}
      {editor === 'link' && <form onSubmit={(event) => {
        event.preventDefault();
        const goalId = String(new FormData(event.currentTarget).get('goalId') ?? '');
        const position = selected as InvestmentPosition;
        if (goalId === (position.goalId ?? '')) { setNotice('Selecione uma meta diferente da atual.'); return; }
        if (!goalId) {
          mutation.mutate({ name: 'unlinkInvestmentFromGoal', payload: {
            accountId: position.accountId, assetId: position.assetId, goalId: position.goalId,
            occurredAt: isoNow(), reason: 'Desvínculo solicitado pela interface patrimonial.',
          }});
          return;
        }
        // INV-P2-028 — trocar de meta é desvincular e vincular. O formulário
        // só oferecia a meta atual e o backend recusava revínculo, então
        // "Alterar meta" falhava sempre. As duas etapas são idempotentes e
        // cada uma tem chave de intenção própria.
        mutation.mutate({ name: 'changeInvestmentGoal', payload: {
          accountId: position.accountId, assetId: position.assetId,
          goalId, previousGoalId: position.goalId,
          occurredAt: isoNow(), reason: 'Troca de meta solicitada pela interface patrimonial.',
        }});
      }} className="grid gap-4">
        <label>Meta
          <select name="goalId" defaultValue={(selected as InvestmentPosition | null)?.goalId ?? ''} className="w-full rounded-lg border px-3 py-2">
            <option value="">Sem meta</option>
            {goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.name}</option>)}
          </select>
        </label>
        <p className="text-sm text-on-surface-variant">
          {(selected as InvestmentPosition | null)?.goalId
            ? 'Trocar de meta move o principal da posição inteira entre as duas metas, em uma única operação auditável. Escolher "Sem meta" desvincula.'
            : 'Vincular soma o principal da posição ao progresso da meta escolhida.'}
        </p>
        <button disabled={mutation.isPending} className="rounded-lg bg-primary px-4 py-2 text-on-primary disabled:opacity-60">{mutation.isPending ? 'Processando…' : 'Salvar vínculo'}</button>
      </form>}

      {/*
        INV-P1-007 — registro de valoração no produto.

        Sem esta superfície, nenhuma posição jamais recebia preço, e
        `currentValueForPosition` devolvia o próprio custo: patrimônio era
        idêntico a custo, o ganho não realizado ficava estruturalmente zero e
        três painéis do relatório permaneciam zerados. Valoração **não** gera
        fluxo de caixa — só marca a posição a mercado.
      */}
      {editor === 'valuation' && <form onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const position = selected as InvestmentPosition;
        const unitPrice = Number(String(form.get('unitPrice') ?? '0').replace(',', '.'));
        if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
          setNotice('Informe um preço unitário maior que zero.');
          return;
        }
        mutation.mutate({ name: 'recordInvestmentValuation', payload: {
          accountId: position.accountId,
          assetId: position.assetId,
          unitPriceMicros: Math.round(unitPrice * 1_000_000),
          source: 'manual',
          effectiveAt: isoNow(),
          reason: String(form.get('reason') ?? 'Marcação a mercado'),
        }});
      }} className="grid gap-4">
        <p className="text-sm text-on-surface-variant">
          Quantidade em carteira: {((selected as InvestmentPosition | null)?.quantityMicros ?? 0) / 1_000_000}.
          Custo de aquisição: {money((selected as InvestmentPosition | null)?.principalCents ?? 0)}.
        </p>
        <Field
          label="Preço unitário (R$)"
          name="unitPrice"
          type="number"
          min="0.000001"
          step="0.000001"
          required
          defaultValue={
            ((selected as InvestmentPosition | null)?.quantityMicros ?? 0) > 0
              ? (((selected as InvestmentPosition | null)?.currentValueCents ?? 0) / 100) /
                (((selected as InvestmentPosition | null)?.quantityMicros ?? 1) / 1_000_000)
              : undefined
          }
        />
        <Field label="Motivo" name="reason" minLength={3} required defaultValue="Marcação a mercado" />
        <p className="text-sm text-on-surface-variant">
          A valoração atualiza o valor de mercado da posição e a variação patrimonial do mês.
          Ela não movimenta caixa e não altera o custo de aquisição.
        </p>
        <button disabled={mutation.isPending} className="rounded-lg bg-primary px-4 py-2 text-on-primary disabled:opacity-60">{mutation.isPending ? 'Processando…' : 'Registrar valoração'}</button>
      </form>}

      {editor === 'archive' && <div className="grid gap-4">
        <p className="text-sm">Confirma a inativação de <strong>{archiveTarget?.item.name}</strong>?</p>
        <p className="text-sm text-on-surface-variant">
          O histórico é preservado: o registro deixa de aparecer entre os ativos e continua
          consultável pelo filtro de situação, como inativo.
        </p>
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={confirmArchive} disabled={mutation.isPending} className="rounded-lg bg-red-700 px-4 py-2 font-bold text-white disabled:opacity-60">{mutation.isPending ? 'Inativando…' : 'Confirmar inativação'}</button>
          <button type="button" onClick={() => { setEditor(null); setSelected(null); setArchiveTarget(null); }} className="rounded-lg border border-outline/30 px-4 py-2 font-semibold">Manter ativo</button>
        </div>
      </div>}

      {editor === 'reverse' && <form onSubmit={(event) => { event.preventDefault(); mutation.mutate({ name: 'reverseInvestmentMovement', payload: { movementId: selected?.id, reversedAt: isoNow(), reason: new FormData(event.currentTarget).get('reason') } }); }} className="grid gap-4"><Field label="Motivo da reversão" name="reason" minLength={3} required /><p className="text-sm text-on-surface-variant">A movimentação original será preservada e um evento compensatório será criado.</p><button disabled={mutation.isPending} className="rounded-lg bg-red-700 px-4 py-2 text-white disabled:opacity-60">{mutation.isPending ? 'Processando…' : 'Confirmar reversão'}</button></form>}
    </Modal>
  </section>;
};

export default InvestmentsPortfolioView;
