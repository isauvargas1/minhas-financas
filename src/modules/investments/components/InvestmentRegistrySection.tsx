import React, { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { callInvestment, investmentRequestIds } from '../persistence/callableApi';
import { useFinancialIntent } from '../hooks/useIntentNonce';
import {
  listInvestmentAccounts,
  listInvestmentAssets,
  type InvestmentCursor,
} from '../persistence/readApi';
import type { InvestmentAccount, InvestmentAsset } from '../types';

/**
 * Cadastro patrimonial em Configurações > Cadastros.
 *
 * Contas e ativos de investimento são registros próprios, distintos das
 * carteiras de caixa dos cadastros gerais: carteira é meio de pagamento e
 * saldo disponível; conta de investimento é onde o patrimônio fica custodiado.
 * Os dois nunca se misturam, e nenhum dos dois substitui o outro.
 *
 * Toda mutação passa por callable — não há escrita direta em coleção do
 * domínio. Inativar preserva o histórico: o registro sai de `active` para
 * `archived` e continua consultável pelo filtro de situação.
 */

interface Props {
  workspaceId: string;
  profileType: 'PF' | 'PJ';
  canManage: boolean;
}

type Entity = 'account' | 'asset';
type Status = 'active' | 'archived';

const ASSET_TYPES: Array<[string, string]> = [
  ['fixed_income', 'Renda fixa'],
  ['fund', 'Fundo'],
  ['stock', 'Ação'],
  ['etf', 'ETF'],
  ['crypto', 'Criptoativo'],
  ['other', 'Outro'],
];

const PURPOSES: Record<'PF' | 'PJ', Array<[string, string]>> = {
  PF: [
    ['unassigned', 'Não classificado'],
    ['retirement', 'Aposentadoria'],
    ['goal', 'Objetivo'],
  ],
  PJ: [
    ['unassigned', 'Não classificado'],
    ['reserve', 'Reserva'],
    ['financial_application', 'Aplicação financeira'],
    ['reinvestment', 'Reinvestimento'],
    ['fixed_asset', 'Imobilizado'],
  ],
};

const safeError = (error: unknown) => {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  if (code.includes('permission-denied')) return 'Você não tem permissão para concluir esta ação.';
  if (code.includes('invalid-argument')) return 'Revise os dados informados e tente novamente.';
  if (code.includes('failed-precondition')) return 'A operação não pôde ser concluída no estado atual.';
  if (code.includes('unauthenticated')) return 'Sua sessão expirou. Entre novamente para continuar.';
  return 'Não foi possível concluir a operação. Tente novamente.';
};

const Dialog: React.FC<{
  title: string;
  open: boolean;
  onClose(): void;
  children: React.ReactNode;
}> = ({ title, open, onClose, children }) => {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open && !ref.current?.open) {
      opener.current = document.activeElement as HTMLElement;
      ref.current?.showModal();
    } else if (!open && ref.current?.open) {
      ref.current.close();
    }
  }, [open]);
  return (
    <dialog
      ref={ref}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClose={() => opener.current?.focus()}
      className="w-[min(94vw,32rem)] rounded-2xl bg-surface p-0 text-on-surface shadow-2xl backdrop:bg-black/50"
    >
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h3 className="text-lg font-bold">{title}</h3>
        <button type="button" onClick={onClose} aria-label="Fechar janela" className="rounded-lg px-3 py-2 hover:bg-background">×</button>
      </div>
      <div className="p-5">{children}</div>
    </dialog>
  );
};

const Field: React.FC<React.InputHTMLAttributes<HTMLInputElement> & { label: string }> = ({ label, ...props }) => (
  <label className="grid gap-1 text-sm font-medium">
    {label}
    <input {...props} className="rounded-lg border border-border bg-surface px-3 py-2" />
  </label>
);

/** Abas do cadastro, na ordem de navegação por seta. */
const REGISTRY_TABS: Array<[Entity, string]> = [
  ['account', 'Contas'],
  ['asset', 'Ativos'],
];

export const InvestmentRegistrySection: React.FC<Props> = ({ workspaceId, profileType, canManage }) => {
  const client = useQueryClient();
  const [entity, setEntity] = useState<Entity>('account');
  const [status, setStatus] = useState<Status>('active');
  const [cursor, setCursor] = useState<InvestmentCursor>();
  const [editing, setEditing] = useState<InvestmentAccount | InvestmentAsset | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [archiving, setArchiving] = useState<InvestmentAccount | InvestmentAsset | null>(null);
  const [notice, setNotice] = useState('');

  const accounts = useQuery({
    queryKey: ['investment-accounts', workspaceId, status, cursor?.id],
    queryFn: () => listInvestmentAccounts(workspaceId, status, cursor),
    enabled: workspaceId.length > 0 && entity === 'account',
  });
  const assets = useQuery({
    queryKey: ['investment-assets', workspaceId, status, cursor?.id],
    queryFn: () => listInvestmentAssets(workspaceId, status, cursor),
    enabled: workspaceId.length > 0 && entity === 'asset',
  });
  const current = entity === 'account' ? accounts : assets;

  // Idempotência por intenção, não por clique (INV-P1-004): a identidade é o
  // editor aberto mais a entidade em edição.
  const intent = useFinancialIntent(
    editorOpen ? `${entity}:${editing?.id ?? 'novo'}` : archiving ? `archive:${archiving.id}` : null,
  );

  const mutation = useMutation({
    mutationFn: ({ name, payload }: { name: string; payload: Record<string, unknown> }) => {
      const body = { workspaceId, ...payload };
      return callInvestment(name, {
        ...body,
        ...investmentRequestIds(name, intent.nonce, body),
      });
    },
    onSuccess: async () => {
      setEditorOpen(false);
      setEditing(null);
      setArchiving(null);
      setNotice('Cadastro patrimonial atualizado com sucesso.');
      await client.invalidateQueries({
        queryKey: [entity === 'account' ? 'investment-accounts' : 'investment-assets', workspaceId],
      });
    },
    onError: (error) => setNotice(safeError(error)),
  });

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (entity === 'account') {
      mutation.mutate({
        name: 'saveInvestmentAccount',
        payload: {
          accountId: editing?.id,
          name: form.get('name'),
          institutionName: form.get('institutionName'),
        },
      });
      return;
    }
    mutation.mutate({
      name: 'saveInvestmentAsset',
      payload: {
        assetId: editing?.id,
        name: form.get('name'),
        symbol: form.get('symbol') || undefined,
        assetType: form.get('assetType'),
        allocationPurpose: form.get('allocationPurpose'),
      },
    });
  };

  /**
   * A confirmação vive dentro do próprio `dialog` do componente, e não em
   * `window.confirm`: o modal nativo não é estilizável, não devolve foco de
   * forma previsível e fica fora da árvore acessível da seção.
   */
  const confirmArchive = () => {
    const item = archiving;
    if (!item) return;
    mutation.mutate({
      name: entity === 'account' ? 'archiveInvestmentAccount' : 'archiveInvestmentAsset',
      payload: {
        [entity === 'account' ? 'accountId' : 'assetId']: item.id,
        reason: entity === 'account'
          ? 'Inativação de conta solicitada em Configurações > Cadastros.'
          : 'Inativação de ativo solicitada em Configurações > Cadastros.',
      },
    });
  };

  const openEditor = (item: InvestmentAccount | InvestmentAsset | null) => {
    setNotice('');
    setEditing(item);
    setEditorOpen(true);
  };
  // Trocar de aba ou de filtro parte de um estado limpo: um aviso de sucesso
  // remanescente da ação anterior mascararia a falha da próxima.
  const switchEntity = (next: Entity) => { setEntity(next); setCursor(undefined); setNotice(''); };
  const switchStatus = (next: Status) => { setStatus(next); setCursor(undefined); setNotice(''); };

  const entityLabel = entity === 'account' ? 'conta' : 'ativo';

  return (
    <section aria-labelledby="investment-registry-title" className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 id="investment-registry-title" className="text-lg font-bold text-on-surface">Contas e ativos de investimento</h3>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Registros patrimoniais próprios, separados das carteiras de caixa dos cadastros gerais.
            Carteira é meio de pagamento; conta de investimento é onde o patrimônio fica custodiado.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => openEditor(null)}
            className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-2.5 font-bold text-primary"
          >
            {entity === 'account' ? 'Nova conta' : 'Novo ativo'}
          </button>
        )}
      </div>

      {notice && (
        <p role={notice.includes('sucesso') ? 'status' : 'alert'} className="mt-4 rounded-lg bg-background p-3 text-sm">
          {notice}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {/*
          `role="tab"` sem `aria-controls`, sem painel e sem foco itinerante
          anuncia uma navegação por setas que não existe. O padrão completo:
          só a aba ativa é alcançável por Tab, as setas trocam de aba.
        */}
        <div role="tablist" aria-label="Tipo de cadastro patrimonial" className="flex gap-1 rounded-xl bg-background p-1">
          {REGISTRY_TABS.map(([id, label], index) => (
            <button
              key={id}
              id={`investment-registry-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={entity === id}
              aria-controls="investment-registry-panel"
              tabIndex={entity === id ? 0 : -1}
              onClick={() => switchEntity(id)}
              onKeyDown={(event) => {
                const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
                if (step === 0) return;
                event.preventDefault();
                const next = REGISTRY_TABS[(index + step + REGISTRY_TABS.length) % REGISTRY_TABS.length][0];
                switchEntity(next);
                document.getElementById(`investment-registry-tab-${next}`)?.focus();
              }}
              className={`rounded-lg px-4 py-2 text-sm font-semibold ${entity === id ? 'bg-surface text-primary shadow-sm' : 'text-muted'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="text-sm text-muted">
          Situação
          <select
            aria-label="Situação do cadastro patrimonial"
            value={status}
            onChange={(event) => switchStatus(event.target.value as Status)}
            className="ml-2 rounded-lg border border-border bg-surface px-3 py-2 text-on-surface"
          >
            <option value="active">Ativos</option>
            <option value="archived">Inativos</option>
          </select>
        </label>
      </div>

      <div
        role="tabpanel"
        id="investment-registry-panel"
        aria-labelledby={`investment-registry-tab-${entity}`}
      >
      {current.isLoading && <p role="status" className="mt-4 text-sm text-muted">Carregando cadastros patrimoniais…</p>}
      {current.isError && <p role="alert" className="mt-4 text-sm text-red-700">Não foi possível carregar contas e ativos de investimento.</p>}
      {!current.isLoading && !current.isError && !current.data?.items.length && (
        <p className="mt-4 rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">
          {status === 'active'
            ? `Nenhuma ${entityLabel} ativa. Use “Preparar padrões de investimentos” ou crie manualmente.`
            : `Nenhum registro inativo de ${entityLabel}.`}
        </p>
      )}

      <ul className="mt-4 grid gap-3 md:grid-cols-2">
        {entity === 'account' && accounts.data?.items.map((item) => (
          <li key={item.id} className="rounded-xl border border-border bg-background p-4">
            <p className="font-semibold text-on-surface">{item.name}</p>
            <p className="text-sm text-muted">{item.institutionName}</p>
            <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-muted">
              {item.status === 'active' ? 'Ativa' : 'Inativa'}
            </p>
            {canManage && item.status === 'active' && (
              <div className="mt-3 flex gap-4 text-sm">
                <button type="button" onClick={() => openEditor(item)} className="font-semibold text-primary">Editar</button>
                <button type="button" onClick={() => { setNotice(''); setArchiving(item); }} className="font-semibold text-red-700">Inativar</button>
              </div>
            )}
          </li>
        ))}
        {entity === 'asset' && assets.data?.items.map((item) => (
          <li key={item.id} className="rounded-xl border border-border bg-background p-4">
            <p className="font-semibold text-on-surface">{item.name}</p>
            <p className="text-sm text-muted">{item.symbol || 'Sem código informado'}</p>
            <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-muted">
              {item.status === 'active' ? 'Ativo' : 'Inativo'}
            </p>
            {canManage && item.status === 'active' && (
              <div className="mt-3 flex gap-4 text-sm">
                <button type="button" onClick={() => openEditor(item)} className="font-semibold text-primary">Editar</button>
                <button type="button" onClick={() => { setNotice(''); setArchiving(item); }} className="font-semibold text-red-700">Inativar</button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {(cursor || current.data?.nextCursor) && (
        <div className="mt-4 flex gap-2">
          {cursor && (
            <button type="button" onClick={() => setCursor(undefined)} className="rounded-lg border border-border px-3 py-2 text-sm">
              Primeira página
            </button>
          )}
          {current.data?.nextCursor && (
            <button type="button" onClick={() => setCursor(current.data!.nextCursor!)} className="rounded-lg border border-border px-3 py-2 text-sm">
              Próxima página
            </button>
          )}
        </div>
      )}
      </div>

      <Dialog
        title={entity === 'account' ? 'Inativar conta de investimento' : 'Inativar ativo de investimento'}
        open={archiving !== null}
        onClose={() => setArchiving(null)}
      >
        <div className="grid gap-4">
          <p className="text-sm text-on-surface">
            Confirma a inativação de <strong>{archiving?.name}</strong>?
          </p>
          <p className="text-sm text-muted">
            O histórico é preservado: o registro deixa de aparecer entre os ativos e
            continua consultável pelo filtro de situação, como inativo.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={confirmArchive}
              disabled={mutation.isPending}
              className="rounded-xl bg-red-700 px-4 py-2.5 font-bold text-white disabled:opacity-60"
            >
              {mutation.isPending ? 'Inativando…' : 'Confirmar inativação'}
            </button>
            <button
              type="button"
              onClick={() => setArchiving(null)}
              className="rounded-xl border border-border px-4 py-2.5 font-semibold"
            >
              Manter ativo
            </button>
          </div>
        </div>
      </Dialog>

      <Dialog
        title={entity === 'account'
          ? (editing ? 'Editar conta de investimento' : 'Nova conta de investimento')
          : (editing ? 'Editar ativo de investimento' : 'Novo ativo de investimento')}
        open={editorOpen}
        onClose={() => { setEditorOpen(false); setEditing(null); }}
      >
        <form onSubmit={submit} className="grid gap-4">
          <Field label={entity === 'account' ? 'Nome da conta' : 'Nome do ativo'} name="name" required defaultValue={editing?.name} />
          {entity === 'account' ? (
            <Field
              label="Instituição"
              name="institutionName"
              required
              defaultValue={(editing as InvestmentAccount | null)?.institutionName}
            />
          ) : (
            <>
              <Field label="Código do ativo (opcional)" name="symbol" defaultValue={(editing as InvestmentAsset | null)?.symbol} />
              <label className="grid gap-1 text-sm font-medium">
                Tipo
                <select name="assetType" defaultValue={(editing as InvestmentAsset | null)?.assetType ?? 'fixed_income'} className="rounded-lg border border-border bg-surface px-3 py-2">
                  {ASSET_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-sm font-medium">
                Finalidade
                <select name="allocationPurpose" defaultValue={(editing as InvestmentAsset | null)?.allocationPurpose ?? 'unassigned'} className="rounded-lg border border-border bg-surface px-3 py-2">
                  {PURPOSES[profileType].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <p className="text-xs text-muted">
                A finalidade não poderá ser alterada depois do primeiro aporte, para preservar relatórios históricos.
              </p>
            </>
          )}
          <button type="submit" disabled={mutation.isPending} className="rounded-xl bg-primary px-4 py-2.5 font-bold text-white disabled:opacity-60">
            {mutation.isPending ? 'Salvando…' : `Salvar ${entity === 'account' ? 'conta' : 'ativo'}`}
          </button>
        </form>
      </Dialog>
    </section>
  );
};

export default InvestmentRegistrySection;
