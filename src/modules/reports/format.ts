/**
 * Formatação do relatório oficial: centavos inteiros → texto em pt-BR e
 * pontos-base → percentual. Nada aqui calcula indicador — só apresenta o
 * número que o backend entregou.
 */

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const percent = new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

/** Centavos inteiros → "R$ 1.234,56". Único ponto onde o valor vira reais. */
export const formatCents = (cents: number): string => currency.format(cents / 100);

/** Percentual de exibição (12.34 → "12,34%"; duas casas, negativo com sinal). */
export const formatPercent = (value: number): string => `${percent.format(value)}%`;

/** Pontos-base → "12,34%" (duas casas; negativo com sinal). */
export const formatBasisPoints = (basisPoints: number): string =>
    formatPercent(basisPoints / 100);

/** Centavos → reais, só para entregar o número a gráficos e componentes de exibição. */
export const centsToDisplay = (cents: number): number => cents / 100;

/** Pontos-base → percentual de exibição (1234 → 12,34). */
export const basisPointsToDisplay = (basisPoints: number): number => basisPoints / 100;
