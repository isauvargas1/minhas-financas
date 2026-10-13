import type { ReportRange, ReportSection } from './official.ts';
import type { ReportTimeRange } from './types.ts';

/**
 * Faixa pedida ao relatório oficial. O servidor resolve o período em datas
 * civis de `America/Sao_Paulo`; o cliente só nomeia a faixa.
 */

/** Faixa do seletor dos Relatórios → faixa do contrato. */
export const presetRange = (preset: ReportTimeRange): ReportRange =>
    ({ kind: 'preset', preset });

/**
 * Mês civil do seletor do Header (`AAAA-MM`). Usa os campos locais do `Date`
 * do seletor: `toISOString()` passaria o mês para UTC e, no fim do dia ou do
 * mês, mostraria o mês errado.
 */
export const monthRange = (selected: Date): ReportRange => {
    const year = String(selected.getFullYear()).padStart(4, '0');
    const month = String(selected.getMonth() + 1).padStart(2, '0');
    return { kind: 'month', month: `${year}-${month}` };
};

/** Parte da chave de cache que identifica a faixa. */
export const rangeKey = (range: ReportRange): string =>
    range.kind === 'preset' ? `preset:${range.preset}` : `month:${range.month}`;

/** Parte da chave de cache dos blocos pedidos (ausente = todos). */
export const sectionsKey = (sections?: readonly ReportSection[]): string =>
    sections && sections.length > 0 ? [...sections].sort().join(',') : 'all';

const PRESET_LABELS: Record<ReportTimeRange, string> = {
    '7d': 'Últimos 7 dias',
    '30d': 'Últimos 30 dias',
    '90d': 'Últimos 3 meses',
    '12m': 'Últimos 12 meses',
    'ytd': 'Ano Atual',
    'all': 'Todo o Período',
};

/** Rótulo do período, em pt-BR. */
export const rangeLabel = (range: ReportRange): string => {
    if (range.kind === 'preset') return PRESET_LABELS[range.preset];
    const [year, month] = range.month.split('-');
    return `Mês ${month}/${year}`;
};
