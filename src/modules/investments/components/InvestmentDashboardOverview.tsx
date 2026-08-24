import React, { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getOfficialInvestmentReportData } from '../persistence/readApi';

const money = (value: number) => new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL',
}).format(value / 100);

export const InvestmentDashboardOverview: React.FC<{ workspaceId: string }> = ({ workspaceId }) => {
  const report = useQuery({
    queryKey: ['investment-dashboard-report', workspaceId],
    queryFn: () => getOfficialInvestmentReportData(workspaceId, {
      periodLimit: 7,
      includeAllocations: false,
    }),
    staleTime: 1000 * 60 * 2,
    enabled: workspaceId.length > 0,
  });
  const evolution = useMemo(() => {
    let current = report.data?.summary?.currentValueCents ?? 0;
    return [...(report.data?.periods ?? [])].reverse().map((period) => {
      const point = { period: period.period, value: current };
      current -= period.currentValueDeltaCents ?? 0;
      return point;
    }).reverse().slice(-6);
  }, [report.data]);
  useEffect(() => {
    if (report.error) console.error('Falha ao carregar projeções patrimoniais:', report.error);
  }, [report.error]);
  if (report.isLoading) return <section aria-label="Resumo patrimonial" className="rounded-card border border-border bg-surface p-5"><p role="status">Carregando resumo patrimonial…</p></section>;
  if (report.isError) return <section aria-label="Resumo patrimonial" className="rounded-card border border-red-300 bg-red-50 p-5 text-red-800"><p role="alert">Não foi possível carregar o resumo patrimonial.</p></section>;
  const summary = report.data?.summary;
  if (!summary) return <section aria-label="Resumo patrimonial" className="rounded-card border border-amber-300 bg-amber-50 p-5 text-amber-900"><h2 className="font-semibold">Patrimônio de investimentos</h2><p className="text-sm">A projeção ficará disponível após a primeira movimentação processada.</p></section>;
  const hasReconciliationAlert =
    summary.currentValueCents !== 0 && report.data?.periods.length === 0;
  return <section aria-labelledby="dashboard-investments-title" className="space-y-4 rounded-card border border-border bg-surface p-5 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="dashboard-investments-title" className="font-bold text-on-surface">Patrimônio de investimentos</h2><p className="text-xs text-muted">Visão patrimonial separada do saldo em caixa.</p></div>{(hasReconciliationAlert || report.data?.periodsTruncated) && <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">A projeção histórica requer reconciliação antes de apoiar decisões.</p>}</div>
    <div className="grid gap-3 sm:grid-cols-3"><article className="rounded-xl bg-background p-4"><p className="text-xs text-muted">Patrimônio atual</p><p className="mt-1 text-lg font-bold">{money(summary.currentValueCents)}</p></article><article className="rounded-xl bg-background p-4"><p className="text-xs text-muted">Custo atual</p><p className="mt-1 text-lg font-bold">{money(summary.principalCents)}</p></article><article className="rounded-xl bg-background p-4"><p className="text-xs text-muted">Resultado total</p><p className="mt-1 text-lg font-bold">{money(summary.realizedGainCents + summary.unrealizedAppreciationCents - summary.feesCents - summary.taxCents)}</p></article></div>
    <div><h3 className="text-sm font-semibold">Evolução recente</h3>{evolution.length ? <ol className="mt-2 grid grid-cols-2 gap-2 text-sm md:grid-cols-6">{evolution.map((item) => <li key={item.period} className="rounded-lg border border-border p-2"><span className="block text-xs text-muted">{new Date(`${item.period}-02T12:00:00`).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })}</span><span className="font-medium">{money(item.value)}</span></li>)}</ol> : <p className="mt-2 text-sm text-muted">Ainda não há evolução mensal disponível.</p>}</div>
  </section>;
};

export default InvestmentDashboardOverview;
