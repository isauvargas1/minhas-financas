/**
 * Distribuição do patrimônio investido (Etapa 3, §5, §6 e §7).
 *
 * O baseline tinha `AllocationAnalysis` (PF) e `BusinessAllocationAnalysis`
 * (PJ) acima da tabela de investimentos. A composição volta; a aritmética não
 * pode voltar. Aquela versão classificava por `transaction.category` comparando
 * strings — "Moradia" era essencial, "Marketing" era reinvestimento — e o que
 * não estivesse no mapa caía num balde padrão. Pior: investimento **sem meta**
 * era somado a "Aposentadoria", que é uma afirmação sobre a intenção do
 * usuário que ninguém fez.
 *
 * A fonte agora é `investment_allocation_summaries`, projeção que o backend
 * escreve a partir do estado das posições. Três consequências que o §5 exige e
 * que saem de graça daí:
 *
 * - **só liquidado entra**: movimento pendente tem todos os deltas em zero e
 *   nunca toca `PositionState`;
 * - **retirada reduz**: a liquidação decrementa a posição e, com ela, o corte;
 * - **cancelado não conta**: nunca virou posição.
 *
 * A autoridade do balde é o `key` do corte — `classId` do catálogo —, nunca o
 * rótulo, que o usuário pode renomear a qualquer momento.
 *
 * Módulo puro: sem React, sem SDK, testável pelo runner do Node.
 */

import type { InvestmentAllocationSummary, InvestmentSummary } from '../types';

export interface AllocationBucket {
  key: string;
  label: string;
  currentValueCents: number;
  principalCents: number;
  /** Fatia do patrimônio total, em pontos percentuais. */
  percentage: number;
}

export interface AllocationView {
  /** Patrimônio total do workspace, do resumo autoritativo. */
  totalCents: number;
  /** Capital aplicado (custo), do mesmo resumo. */
  principalCents: number;
  buckets: AllocationBucket[];
  /**
   * Não há patrimônio a distribuir.
   *
   * Estado vazio explícito, e não uma fatia de 100% num balde inventado: sem
   * posição liquidada, a única coisa verdadeira a dizer é que ainda não há
   * distribuição.
   */
  empty: boolean;
  /** O corte foi truncado pelo teto de leitura e há cauda agrupada. */
  truncated: boolean;
}

const OTHERS_KEY = '__outros__';

/** Diferença de arredondamento que não merece um balde próprio. */
const REMAINDER_FLOOR_CENTS = 1;

export interface AllocationViewOptions {
  /** Quantos baldes nomeados exibir antes de agrupar o resto. */
  maxBuckets?: number;
  truncated?: boolean;
  othersLabel?: string;
}

/**
 * Resumo + corte → faixa de alocação.
 *
 * O denominador é `summary.currentValueCents`, e não a soma dos baldes: o corte
 * vem limitado pelo teto de leitura, e dividir pela soma da página faria os
 * cinco maiores somarem 100% mesmo com cauda de fora. Com o denominador
 * autoritativo, o que sobra vira um balde "Outros" honesto.
 */
export const buildAllocationView = (
  summary: InvestmentSummary | null,
  items: InvestmentAllocationSummary[],
  options: AllocationViewOptions = {},
): AllocationView => {
  const maxBuckets = options.maxBuckets ?? 5;
  const totalCents = summary?.currentValueCents ?? 0;
  const principalCents = summary?.principalCents ?? 0;
  if (totalCents <= 0) {
    return {
      totalCents: Math.max(totalCents, 0),
      principalCents,
      buckets: [],
      empty: true,
      truncated: false,
    };
  }

  const ranked = items
    .filter((item) => item.currentValueCents > 0)
    .sort((left, right) => right.currentValueCents - left.currentValueCents);
  const named = ranked.slice(0, maxBuckets).map((item) => ({
    key: item.key,
    label: item.label,
    currentValueCents: item.currentValueCents,
    principalCents: item.principalCents,
    percentage: (item.currentValueCents / totalCents) * 100,
  }));

  const covered = named.reduce((total, bucket) => total + bucket.currentValueCents, 0);
  const remainder = totalCents - covered;
  const buckets = remainder >= REMAINDER_FLOOR_CENTS
    ? [...named, {
      key: OTHERS_KEY,
      label: options.othersLabel ?? 'Outros',
      currentValueCents: remainder,
      principalCents: Math.max(principalCents - named.reduce(
        (total, bucket) => total + bucket.principalCents, 0,
      ), 0),
      percentage: (remainder / totalCents) * 100,
    }]
    : named;

  return {
    totalCents,
    principalCents,
    buckets,
    empty: buckets.length === 0,
    truncated: Boolean(options.truncated) || ranked.length > maxBuckets,
  };
};

/**
 * Finalidade contábil informada, para o painel PJ.
 *
 * O corte por finalidade só diz algo quando alguém classificou o ativo. No modo
 * simples todo ativo nasce `unassigned` — "Não classificado" —, e uma faixa
 * inteira repetindo isso não é informação, é ruído. Esta função responde se há
 * finalidade explícita a mostrar; sem ela, o painel omite o corte em vez de
 * forçar o investimento da empresa em "reserva" ou "reinvestimento".
 */
export const hasExplicitPurpose = (items: InvestmentAllocationSummary[]): boolean =>
  items.some((item) => item.key !== 'unassigned' && item.currentValueCents > 0);
