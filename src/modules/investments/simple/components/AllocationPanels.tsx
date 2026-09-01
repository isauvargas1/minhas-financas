import React from 'react';

import { ChartBarIcon, TrendingUpIcon } from '../../../../components/Icons';
import type { InvestmentAllocationDimension } from '../../types';
import { useInvestmentAllocation } from '../api';
import {
    buildAllocationView,
    hasExplicitPurpose,
    type AllocationBucket,
    type AllocationView,
} from '../allocation';

/**
 * Faixa de alocação da tela de Investimentos (Etapa 3, §5, §6 e §7).
 *
 * Ocupa o lugar que `AllocationAnalysis` (PF) e `BusinessAllocationAnalysis`
 * (PJ) ocupavam no baseline: acima dos cards por meta, abaixo de nada. Duas
 * diferenças em relação àquela versão, ambas exigidas pelo §5:
 *
 * - **a fonte é o domínio**, `investment_allocation_summaries`, e não
 *   `transaction.category`. Só posição liquidada chega até aqui;
 * - **não há alvo inventado.** O baseline comparava a carteira com modelos
 *   fixos ("70/30", "50/30/20") que descreviam orçamento doméstico, não
 *   alocação de investimento, e pintava de vermelho quem fugisse deles. Sem um
 *   alvo que o usuário tenha declarado, a faixa mostra a distribuição real e
 *   se cala sobre o que deveria ser.
 *
 * PF e PJ são componentes distintos, como no baseline, e nunca aparecem
 * juntos: quem escolhe é o `profileType` do workspace.
 */

const formatCurrency = (cents: number): string =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);

const cardClasses = 'bg-white dark:bg-dark-100 rounded-xl shadow-md p-6';

const BUCKET_COLORS = [
    '#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#a855f7', '#64748b',
];

const BucketCards: React.FC<{ view: AllocationView; emptyLabel: string }> = ({ view, emptyLabel }) => {
    if (view.empty) {
        return (
            <p className="text-sm text-gray-500 dark:text-gray-400">{emptyLabel}</p>
        );
    }
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            {view.buckets.map((bucket: AllocationBucket, index: number) => (
                <div
                    key={bucket.key}
                    className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/70 dark:bg-dark-200/60 p-4"
                >
                    <div className="flex items-start justify-between gap-2 mb-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 truncate">
                            {bucket.label}
                        </span>
                        <span
                            className="mt-0.5 h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: BUCKET_COLORS[index % BUCKET_COLORS.length] }}
                        />
                    </div>
                    <p className="text-lg font-bold text-gray-800 dark:text-white">
                        {bucket.percentage.toFixed(1)}%
                    </p>
                    <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400 truncate">
                        {formatCurrency(bucket.currentValueCents)}
                    </p>
                    <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-dark-300">
                        <div
                            className="h-full rounded-full transition-all duration-700"
                            style={{
                                width: `${Math.min(100, bucket.percentage)}%`,
                                backgroundColor: BUCKET_COLORS[index % BUCKET_COLORS.length],
                            }}
                        />
                    </div>
                </div>
            ))}
        </div>
    );
};

const SecondaryStrip: React.FC<{ title: string; view: AllocationView }> = ({ title, view }) => {
    if (view.empty) return null;
    return (
        <div className="mt-5 border-t border-gray-100 dark:border-gray-800 pt-4">
            <h4 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                {title}
            </h4>
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {view.buckets.map((bucket) => (
                    <li
                        key={bucket.key}
                        className="flex items-center justify-between gap-3 rounded-lg bg-gray-50 dark:bg-dark-200/60 px-3 py-2 text-sm"
                    >
                        <span className="truncate text-gray-600 dark:text-gray-300">{bucket.label}</span>
                        <span className="whitespace-nowrap font-semibold text-gray-800 dark:text-gray-100">
                            {formatCurrency(bucket.currentValueCents)} · {bucket.percentage.toFixed(1)}%
                        </span>
                    </li>
                ))}
            </ul>
        </div>
    );
};

interface PanelShellProps {
    heading: string;
    subtitle: string;
    icon: React.ReactNode;
    totalLabel: string;
    view: AllocationView;
    principalLabel: string;
    children?: React.ReactNode;
    emptyLabel: string;
    truncatedLabel: string;
}

const PanelShell: React.FC<PanelShellProps> = ({
    heading, subtitle, icon, totalLabel, view, principalLabel, children, emptyLabel, truncatedLabel,
}) => (
    <section aria-labelledby="investment-allocation-title" className={cardClasses}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-5">
            <div className="flex items-start gap-3">
                <div className="rounded-lg bg-indigo-50 dark:bg-indigo-900/20 p-2.5 text-indigo-600 dark:text-indigo-300">
                    {icon}
                </div>
                <div>
                    <h3 id="investment-allocation-title" className="text-lg font-bold text-gray-800 dark:text-white">
                        {heading}
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>
                </div>
            </div>
            <div className="sm:text-right">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    {totalLabel}
                </span>
                <span className="text-2xl font-bold text-gray-800 dark:text-white">
                    {formatCurrency(view.totalCents)}
                </span>
                <span className="block text-xs text-gray-500 dark:text-gray-400">
                    {principalLabel} {formatCurrency(view.principalCents)}
                </span>
            </div>
        </div>

        <BucketCards view={view} emptyLabel={emptyLabel} />
        {children}
        {view.truncated && !view.empty && (
            <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">{truncatedLabel}</p>
        )}
    </section>
);

const LoadingPanel: React.FC = () => (
    <section aria-label="Alocação de investimentos" className={cardClasses}>
        <p className="text-sm text-gray-500 dark:text-gray-400">Carregando a distribuição dos investimentos...</p>
    </section>
);

export interface AllocationPanelProps {
    workspaceId: string;
}

const PF_DIMENSIONS: InvestmentAllocationDimension[] = ['class', 'goal'];
const PJ_DIMENSIONS: InvestmentAllocationDimension[] = ['class', 'purpose'];

/** Faixa de alocação de pessoa física. */
export const InvestmentAllocationPanel: React.FC<AllocationPanelProps> = ({ workspaceId }) => {
    const allocation = useInvestmentAllocation(workspaceId, PF_DIMENSIONS);
    if (allocation.isLoading) return <LoadingPanel />;
    // Sem projeção legível, a faixa some em silêncio: a tela de investimentos
    // continua inteira, e um aviso vermelho no topo por causa de um painel
    // secundário assustaria sem informar.
    if (allocation.isError || !allocation.data) return null;

    const [classSlice, goalSlice] = allocation.data.slices;
    const view = buildAllocationView(allocation.data.summary, classSlice.items, {
        truncated: classSlice.truncated,
    });
    const byGoal = buildAllocationView(allocation.data.summary, goalSlice.items, {
        maxBuckets: 5,
        truncated: goalSlice.truncated,
        othersLabel: 'Outras metas',
    });

    return (
        <PanelShell
            heading="Distribuição dos investimentos"
            subtitle="Como o dinheiro já depositado está dividido entre as suas carteiras."
            icon={<TrendingUpIcon className="h-5 w-5" />}
            totalLabel="Total investido"
            principalLabel="Capital aplicado:"
            view={view}
            emptyLabel="Ainda não há investimento depositado para distribuir. Registre o primeiro aporte para ver a divisão por carteira."
            truncatedLabel="As carteiras menores foram agrupadas em Outros."
        >
            <SecondaryStrip title="Por meta" view={byGoal} />
        </PanelShell>
    );
};

/** Faixa de alocação de pessoa jurídica. */
export const BusinessInvestmentAllocationPanel: React.FC<AllocationPanelProps> = ({ workspaceId }) => {
    const allocation = useInvestmentAllocation(workspaceId, PJ_DIMENSIONS);
    if (allocation.isLoading) return <LoadingPanel />;
    if (allocation.isError || !allocation.data) return null;

    const [classSlice, purposeSlice] = allocation.data.slices;
    const view = buildAllocationView(allocation.data.summary, classSlice.items, {
        truncated: classSlice.truncated,
    });
    /*
     * Finalidade contábil só entra quando alguém a declarou. No modo simples
     * todo ativo nasce "Não classificado", e uma faixa inteira repetindo isso
     * não informa nada — pior, sugeriria que a empresa classificou o capital
     * quando ninguém classificou.
     */
    const byPurpose = hasExplicitPurpose(purposeSlice.items)
        ? buildAllocationView(allocation.data.summary, purposeSlice.items, {
            maxBuckets: 5,
            truncated: purposeSlice.truncated,
            othersLabel: 'Outras finalidades',
        })
        : null;

    return (
        <PanelShell
            heading="Alocação do capital da empresa"
            subtitle="Como o capital já aplicado está dividido entre as carteiras da empresa."
            icon={<ChartBarIcon className="h-5 w-5" />}
            totalLabel="Capital aplicado"
            principalLabel="Custo de aquisição:"
            view={view}
            emptyLabel="Ainda não há capital aplicado para distribuir. Registre o primeiro investimento para ver a divisão por carteira."
            truncatedLabel="As carteiras menores foram agrupadas em Outros."
        >
            {byPurpose
                ? <SecondaryStrip title="Por finalidade contábil" view={byPurpose} />
                : null}
        </PanelShell>
    );
};

/** Faixa correta para o perfil do workspace — nunca as duas juntas. */
const InvestmentAllocationBand: React.FC<AllocationPanelProps & { profileType: 'PF' | 'PJ' }> = ({
    workspaceId, profileType,
}) => (profileType === 'PJ'
    ? <BusinessInvestmentAllocationPanel workspaceId={workspaceId} />
    : <InvestmentAllocationPanel workspaceId={workspaceId} />);

export default InvestmentAllocationBand;
