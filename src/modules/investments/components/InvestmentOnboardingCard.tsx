import React from 'react';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';

import {onboardInvestmentWorkspace} from '../persistence/callableApi';
import {listInvestmentAccounts, listInvestmentAssets} from '../persistence/readApi';

interface Props { workspaceId: string; profileType: 'PF' | 'PJ'; isOwner: boolean }

const safeMessage = (error: unknown) => {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  if (code.includes('permission-denied')) return 'Somente a pessoa proprietária pode preparar os padrões.';
  return 'Não foi possível preparar os cadastros de investimentos. Tente novamente.';
};

export const InvestmentOnboardingCard: React.FC<Props> = ({workspaceId, profileType, isOwner}) => {
  const client = useQueryClient();
  const accounts = useQuery({queryKey: ['investment-accounts', workspaceId, 'active', undefined], queryFn: () => listInvestmentAccounts(workspaceId, 'active')});
  const assets = useQuery({queryKey: ['investment-assets', workspaceId, 'active', undefined], queryFn: () => listInvestmentAssets(workspaceId, 'active')});
  const onboarding = useMutation({
    mutationFn: () => onboardInvestmentWorkspace(workspaceId),
    onSuccess: async () => Promise.all([
      client.invalidateQueries({queryKey: ['investment-accounts', workspaceId]}),
      client.invalidateQueries({queryKey: ['investment-assets', workspaceId]}),
      client.invalidateQueries({queryKey: ['settingsCatalog', workspaceId]}),
    ]),
  });
  const loading = accounts.isLoading || assets.isLoading;
  const error = accounts.isError || assets.isError;
  return <section aria-labelledby="investment-onboarding-title" className="rounded-2xl border border-primary/20 bg-primary/5 p-5">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div><p className="text-xs font-bold uppercase tracking-wide text-primary">Investimentos · {profileType}</p><h3 id="investment-onboarding-title" className="mt-1 text-lg font-bold text-on-surface">Cadastros patrimoniais</h3><p className="mt-1 max-w-2xl text-sm text-muted">Carteiras de caixa continuam nos cadastros gerais. Contas e ativos de investimento possuem registros próprios e preservam o histórico quando inativados.</p></div>
      {isOwner && <button type="button" disabled={onboarding.isPending} onClick={() => onboarding.mutate()} className="rounded-xl bg-primary px-4 py-2.5 font-bold text-white disabled:cursor-wait disabled:opacity-60">{onboarding.isPending ? 'Preparando padrões…' : 'Preparar padrões de investimentos'}</button>}
    </div>
    {loading && <p role="status" className="mt-4 text-sm text-muted">Carregando cadastros patrimoniais…</p>}
    {error && <p role="alert" className="mt-4 text-sm text-red-700">Não foi possível carregar contas e ativos de investimento.</p>}
    {onboarding.isError && <p role="alert" className="mt-4 text-sm text-red-700">{safeMessage(onboarding.error)}</p>}
    {onboarding.isSuccess && <p role="status" className="mt-4 text-sm text-green-700">Padrões de investimentos preparados com sucesso, sem duplicar cadastros existentes.</p>}
    {!loading && !error && <div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="rounded-xl border border-border bg-surface p-4"><p className="text-sm text-muted">Contas ativas nesta página</p><p className="mt-1 text-2xl font-bold text-on-surface">{accounts.data?.items.length ?? 0}{accounts.data?.nextCursor ? '+' : ''}</p></div><div className="rounded-xl border border-border bg-surface p-4"><p className="text-sm text-muted">Ativos nesta página</p><p className="mt-1 text-2xl font-bold text-on-surface">{assets.data?.items.length ?? 0}{assets.data?.nextCursor ? '+' : ''}</p></div></div>}
  </section>;
};
