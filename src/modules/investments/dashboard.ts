import type { InvestmentReportPeriod } from './types';

/**
 * Card "Investimentos" do dashboard (D-15, P4-D).
 *
 * Significado (inalterado): o **aporte do mês** selecionado no cabeçalho — o
 * quanto foi aplicado em investimentos naquele mês. Antes ele era somado do
 * espelho em `transactions`; agora vem da projeção mensal oficial do domínio
 * patrimonial, `investment_report_periods/{AAAA-MM}.contributionCents`:
 *
 * - só aporte liquidado conta (pendente e cancelado não entram);
 * - o estorno de um aporte desconta no mês do estorno (antes o espelho do
 *   estorno não era subtraído, e o card continuava mostrando o aporte
 *   desfeito);
 * - retirada não reduz aporte — ela é outra grandeza;
 * - o mês é o da liquidação, em America/Sao_Paulo, a mesma chave que o
 *   backend grava.
 *
 * Uma leitura por mês (o documento do período), sem varrer movimentos.
 */

const pad = (value: number): string => String(value).padStart(2, '0');

/** Chave do período mensal (`AAAA-MM`) do mês exibido no cabeçalho. */
export const investmentMonthKey = (reference: Date): string =>
  `${reference.getFullYear()}-${pad(reference.getMonth() + 1)}`;

/** Aporte líquido do mês, em centavos; mês sem documento vale zero. */
export const monthContributionCents = (
  period: Pick<InvestmentReportPeriod, 'contributionCents'> | null | undefined,
): number => {
  const value = period?.contributionCents;
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : 0;
};
