import type { OfficialInvestmentReportData } from '../investments/types';
import type { InvestmentOverview, ReportTimeRange } from './types';

const fromCents = (value = 0) => value / 100;

const rangeStart = (range: ReportTimeRange): string | undefined => {
  if (range === 'all') return undefined;
  const now = new Date();
  const start = new Date(now);
  if (range === '7d') start.setUTCDate(now.getUTCDate() - 6);
  if (range === '30d') start.setUTCDate(now.getUTCDate() - 29);
  if (range === '90d') start.setUTCDate(now.getUTCDate() - 89);
  if (range === '12m') {
    start.setUTCFullYear(now.getUTCFullYear() - 1);
    start.setUTCDate(start.getUTCDate() + 1);
  }
  if (range === 'ytd') start.setUTCMonth(0, 1);
  return start.toISOString().slice(0, 10);
};

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
