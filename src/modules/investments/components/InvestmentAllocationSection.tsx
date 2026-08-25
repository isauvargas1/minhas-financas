import React from 'react';
import { useQuery } from '@tanstack/react-query';

import { getOfficialInvestmentReportData } from '../persistence/readApi';
import type { InvestmentAllocationDimension } from '../types';
import { money } from './shared';

/**
 * Diagnóstico de alocação PF e PJ na tela patrimonial (INV-P1-008).
 *
 * Ligar a flag **removia do produto** os dois diagnósticos de alocação: eles
 * só montavam dentro de `TransactionsView` com `viewType === 'investimento'`,
 * e essa tela deixa de ser montada quando o domínio patrimonial assume. Era
 * regressão funcional visível ao usuário — grave em PJ, onde a classificação
 * contábil é o principal valor do módulo.
 *
 * A fonte agora é `investment_allocation_summaries`, que o backend já
 * calculava com exatamente estes cortes e que ninguém consumia. Nada é
 * derivado de `transactions`: com a flag ligada, a projeção oficial existe e é
 * a única fonte.
 */

interface Props {
  workspaceId: string;
  profileType: 'PF' | 'PJ';
}

interface DimensionSpec {
  dimension: InvestmentAllocationDimension;
  title: string;
  description: string;
}

/**
 * Cortes de PF.
 *
 * `purpose` distingue aposentadoria, objetivo e não classificado — e nunca
 * presume aposentadoria para investimento sem meta, que é justamente o
 * diagnóstico que o usuário precisa ver para corrigir.
 */
const PF_DIMENSIONS: DimensionSpec[] = [
  {
    dimension: 'purpose',
    title: 'Por finalidade',
    description:
      'Aposentadoria, objetivo e não classificado. Um investimento sem meta vinculada aparece como não classificado — não é presumido como aposentadoria.',
  },
  {
    dimension: 'goal',
    title: 'Por meta',
    description: 'Quanto do patrimônio está vinculado a cada meta, e quanto está sem meta.',
  },
  {
    dimension: 'class',
    title: 'Por classe',
    description: 'Distribuição entre renda fixa, fundos, ações e demais classes cadastradas.',
  },
  {
    dimension: 'liquidity',
    title: 'Por liquidez',
    description: 'Quanto do patrimônio está disponível em cada prazo de resgate.',
  },
];

/**
 * Cortes de PJ.
 *
 * `purpose` distingue reserva, aplicação financeira, reinvestimento e ativo
 * imobilizado — a classificação contábil que o legado nunca soube fazer,
 * porque classificava por `category` da transação.
 */
const PJ_DIMENSIONS: DimensionSpec[] = [
  {
    dimension: 'purpose',
    title: 'Por finalidade contábil',
    description:
      'Reserva, aplicação financeira, reinvestimento, ativo imobilizado e não classificado.',
  },
  {
    dimension: 'class',
    title: 'Por classe',
    description: 'Distribuição entre as classes de ativo cadastradas.',
  },
  {
    dimension: 'liquidity',
    title: 'Por liquidez',
    description: 'Quanto da reserva está disponível em cada prazo de resgate.',
  },
  {
    dimension: 'account',
    title: 'Por instituição',
    description: 'Concentração do patrimônio por conta de custódia.',
  },
];

/** Itens exibidos por faixa. O restante é agregado em "Outros". */
const VISIBLE_ITEMS = 5;

export const InvestmentAllocationSection: React.FC<Props> = ({ workspaceId, profileType }) => {
  const report = useQuery({
    queryKey: ['investment-allocations', workspaceId],
    queryFn: () => getOfficialInvestmentReportData(workspaceId, {
      // Só as alocações interessam aqui; a série mensal é da tela de
      // relatórios. `periodLimit: 1` mantém a consulta barata.
      periodLimit: 1,
      includeAllocations: true,
    }),
  });

  const dimensions = profileType === 'PF' ? PF_DIMENSIONS : PJ_DIMENSIONS;
  const totalCents = report.data?.summary?.currentValueCents ?? 0;

  if (report.isLoading) {
    return <p role="status" className="py-8 text-center">Carregando alocação…</p>;
  }
  if (report.isError) {
    return (
      <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-800">
        Não foi possível carregar a alocação do patrimônio. Tente novamente.
      </p>
    );
  }
  if (totalCents <= 0) {
    return (
      <p className="rounded-lg border border-dashed border-outline/40 p-8 text-center text-on-surface-variant">
        A alocação aparece depois do primeiro aporte processado no domínio patrimonial.
      </p>
    );
  }

  return (
    <section aria-labelledby="allocation-title" className="space-y-4">
      <div>
        <h2 id="allocation-title" className="text-lg font-semibold">
          {profileType === 'PF' ? 'Diagnóstico de alocação' : 'Alocação contábil do patrimônio'}
        </h2>
        <p className="text-sm text-on-surface-variant">
          Percentuais sobre o patrimônio atual de {money(totalCents)}, calculados pelo
          domínio patrimonial oficial.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {dimensions.map((spec) => {
          const entries = report.data?.allocations[spec.dimension] ?? [];
          const truncated = report.data?.truncatedDimensions.includes(spec.dimension) ?? false;
          const visible = entries.slice(0, VISIBLE_ITEMS);
          // INV-P2-045 — "Outros" cobre tudo que não está visível: tanto as
          // faixas carregadas além do teto de exibição quanto as que a
          // consulta truncou. A versão anterior calculava o resto sobre as 10
          // faixas carregadas, exibia 5 e nunca chegava a renderizar a linha.
          const visibleCents = visible.reduce(
            (total, item) => total + item.currentValueCents,
            0,
          );
          const otherCents = Math.max(totalCents - visibleCents, 0);
          const hiddenCount = Math.max(entries.length - visible.length, 0);

          return (
            <article
              key={spec.dimension}
              aria-label={`Alocação ${spec.title.toLowerCase()}`}
              className="rounded-xl border border-outline/20 bg-surface p-4"
            >
              <h3 className="font-semibold">{spec.title}</h3>
              <p className="mt-1 text-xs text-on-surface-variant">{spec.description}</p>

              {visible.length === 0 ? (
                <p className="mt-3 text-sm text-on-surface-variant">
                  Nenhuma faixa com patrimônio nesta dimensão. Classifique os ativos em
                  Configurações &gt; Cadastros para ver este corte.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {visible.map((item) => {
                    const percentage = totalCents > 0
                      ? (item.currentValueCents / totalCents) * 100
                      : 0;
                    return (
                      <li key={item.id}>
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="font-medium">{item.label}</span>
                          <span className="tabular-nums">
                            {money(item.currentValueCents)} · {percentage.toFixed(1)}%
                          </span>
                        </div>
                        <div
                          role="presentation"
                          className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-variant"
                        >
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${Math.min(percentage, 100)}%` }}
                          />
                        </div>
                      </li>
                    );
                  })}

                  {otherCents > 0 && (
                    <li className="flex items-baseline justify-between gap-3 text-sm text-on-surface-variant">
                      <span>
                        Outros
                        {hiddenCount > 0 ? ` (${hiddenCount} faixas)` : ''}
                        {truncated ? ' e faixas além do limite consultado' : ''}
                      </span>
                      <span className="tabular-nums">
                        {money(otherCents)} · {((otherCents / totalCents) * 100).toFixed(1)}%
                      </span>
                    </li>
                  )}
                </ul>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
};

export default InvestmentAllocationSection;
