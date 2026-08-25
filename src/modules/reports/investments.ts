import type { OfficialInvestmentReportData } from '../investments/types.ts';
import type { InvestmentOverview, ReportTimeRange } from './types.ts';
import {
  shiftSaoPauloDays,
  startOfSaoPauloTwelveMonths,
  startOfSaoPauloYear,
} from './dateWindow.ts';

const fromCents = (value = 0) => value / 100;

/**
 * Início da janela, no fuso oficial do produto (INV-P2-048).
 *
 * O domínio materializa toda chave de período em `America/Sao_Paulo`. O
 * recorte usava `getUTCDate()`/`toISOString()`: entre 21:00 e 23:59 BRT a data
 * UTC já é a do dia seguinte, e na virada do mês é o mês seguinte — a janela
 * do relatório incluía ou excluía um dia inteiro em relação ao que o backend
 * gravou.
 */
const rangeStart = (
  range: ReportTimeRange,
  reference = new Date(),
): string | undefined => {
  if (range === 'all') return undefined;
  if (range === '7d') return shiftSaoPauloDays(-6, reference);
  if (range === '30d') return shiftSaoPauloDays(-29, reference);
  if (range === '90d') return shiftSaoPauloDays(-89, reference);
  if (range === '12m') return startOfSaoPauloTwelveMonths(reference);
  if (range === 'ytd') return startOfSaoPauloYear(reference);
  return shiftSaoPauloDays(0, reference);
};

export const investmentRangeStartForTest = rangeStart;

const inSelectedRange = (period: string, range: ReportTimeRange): boolean => {
  const start = rangeStart(range);
  return !start || period >= start.slice(0, 7);
};

const DIMENSION_LABELS: Record<InvestmentOverview['allocations'][number]['dimension'], string> = {
  account: 'Conta',
  class: 'Classe',
  asset: 'Ativo',
  goal: 'Meta',
  risk: 'Risco',
  liquidity: 'Liquidez',
  indexer: 'Indexador',
  purpose: 'Finalidade',
};

export const buildInvestmentOverview = (
  data: OfficialInvestmentReportData,
  range: ReportTimeRange,
): InvestmentOverview | undefined => {
  if (!data.summary) return undefined;
  const start = rangeStart(range);
  const sum = (field: 'contributionCents' | 'redemptionPrincipalCents' | 'realizedGainCents' | 'realizedLossCents' | 'feesCents' | 'taxCents' | 'cashDeltaCents' | 'settledMovementCount') => data.periods.reduce(
    (total, period) => {
      if (!start) return total + (period[field] ?? 0);
      if (period.daily) {
        return total + Object.entries(period.daily).reduce(
          (dailyTotal, [day, values]) => day >= start ? dailyTotal + (values[field] ?? 0) : dailyTotal,
          0,
        );
      }
      return period.period >= start.slice(0, 7) ? total + (period[field] ?? 0) : total;
    },
    0,
  );
  const currentValueCents = data.summary.currentValueCents ?? 0;
  // Cada ponto vem do fechamento materializado do próprio mês. A reconstrução
  // anterior partia do patrimônio atual e subtraía os deltas para trás, o que
  // dependia da janela carregada: com períodos anteriores ausentes, o
  // histórico saía errado. Períodos gravados antes deste campo existir não
  // têm fechamento e são omitidos da série até a reconstrução publicá-lo.
  const evolution = data.periods
    .filter((period) => Number.isFinite(period.closingCurrentValueCents))
    .map((period) => ({
      period: period.period,
      currentValue: fromCents(period.closingCurrentValueCents as number),
    }))
    .filter((item) => inSelectedRange(item.period, range));
  // Sinaliza quando **qualquer** período da janela não tem fechamento: uma
  // série mista descartaria meses em silêncio, sem o usuário perceber.
  const evolutionIncomplete = data.periods.some(
    (period) => !Number.isFinite(period.closingCurrentValueCents),
  );
  const latestClosingCents = [...data.periods]
    .filter((period) => Number.isFinite(period.closingCurrentValueCents))
    .sort((left, right) => left.period.localeCompare(right.period))
    .at(-1)?.closingCurrentValueCents;
  const allocations = Object.entries(DIMENSION_LABELS).map(([dimension, label]) => {
    const typedDimension = dimension as InvestmentOverview['allocations'][number]['dimension'];
    const entries = data.allocations[typedDimension] ?? [];
    const visibleTotal = entries.reduce((total, item) => total + item.currentValueCents, 0);
    const truncated = data.truncatedDimensions.includes(typedDimension);
    const items = entries.map((item) => ({
      key: item.key,
      label: item.label,
      amount: fromCents(item.currentValueCents),
      percentage: currentValueCents > 0 ? item.currentValueCents / currentValueCents * 100 : 0,
    }));
    if (truncated && currentValueCents > visibleTotal) {
      items.push({
        key: 'other',
        label: 'Outros',
        amount: fromCents(currentValueCents - visibleTotal),
        percentage: currentValueCents > 0 ? (currentValueCents - visibleTotal) / currentValueCents * 100 : 0,
      });
    }
    return { dimension: typedDimension, label, items, truncated };
  });
  const contributionCents = sum('contributionCents');
  const principalCents = sum('redemptionPrincipalCents');
  const gainCents = sum('realizedGainCents');
  // INV-P1-009 — a perda realizada tem campo próprio. O resultado realizado
  // com sinal é derivado, nunca armazenado: `ganho − perda`.
  const lossCents = sum('realizedLossCents');
  const realizedResultCents = gainCents - lossCents;
  const feesCents = sum('feesCents');
  const taxCents = sum('taxCents');
  return {
    source: 'official-v2',
    contributions: fromCents(contributionCents),
    redemptionGross: fromCents(principalCents + realizedResultCents),
    redemptionNet: fromCents(principalCents + realizedResultCents - feesCents - taxCents),
    redeemedPrincipal: fromCents(principalCents),
    realizedGain: fromCents(gainCents),
    realizedLoss: fromCents(lossCents),
    realizedResult: fromCents(realizedResultCents),
    investmentIncome: fromCents(realizedResultCents - feesCents - taxCents),
    fees: fromCents(feesCents),
    taxes: fromCents(taxCents),
    cost: fromCents(data.summary.principalCents),
    currentValue: fromCents(currentValueCents),
    unrealizedGain: fromCents(data.summary.unrealizedAppreciationCents),
    cashImpact: fromCents(sum('cashDeltaCents')),
    settledMovementCount: sum('settledMovementCount'),
    evolution,
    evolutionUnavailable: evolutionIncomplete,
    allocations,
    // Reconciliação entre as duas projeções oficiais: o estado atual
    // (`investment_positions` → resumo) precisa bater com o fechamento do
    // último mês da série temporal. Divergência indica deriva e pede rebuild.
    reconciliationDifference:
      range === 'all' && !data.periodsTruncated && latestClosingCents !== undefined ?
        fromCents(currentValueCents - latestClosingCents) : 0,
    periodsTruncated: data.periodsTruncated,
  };
};
