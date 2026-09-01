/**
 * Cards e chips da tela simples (Etapa 2, §12).
 *
 * O layout é o do baseline. A aritmética **não pode** ser: o baseline somava o
 * valor de toda transação de investimento do mês, pago ou não, porque naquele
 * modelo não existia retirada nem cancelamento e um aporte pendente era só uma
 * linha com `isPaid: false`. Com o domínio autoritativo existem quatro estados
 * a mais, e somar tudo produziria número falso.
 *
 * As invariantes que este módulo garante:
 *
 * - pendente não conta como capital efetivamente investido;
 * - retirada não aumenta o total de aportes — ela tem seu próprio chip;
 * - cancelado e desfeito não entram em total nenhum;
 * - o card de meta mostra **capital líquido**: aportes liquidados menos o
 *   capital retirado. Rendimento retirado não reduz capital, porque nunca foi
 *   aporte.
 *
 * Os dois resumos têm fontes diferentes de propósito, e é a mesma divisão do
 * baseline: os **chips** descrevem a seleção visível e por isso somam as linhas
 * filtradas; os **cards** descrevem a carteira e por isso vêm da projeção de
 * alocação, que nenhum filtro de tabela estreita.
 */

import type { InvestmentAllocationSummary } from '../types';
import type { SimpleInvestmentRow } from './rows';

export interface SimpleInvestmentChips {
  /** Total aportado e liquidado, na seleção filtrada. */
  contributionCents: number;
  /** Total efetivamente retirado — capital mais rendimento informado. */
  withdrawalCents: number;
  /** Média por aporte liquidado. Zero quando não há nenhum. */
  averageContributionCents: number;
  /** Quantidade de aportes já depositados. */
  depositedCount: number;
}

const isEffectiveContribution = (row: SimpleInvestmentRow): boolean =>
  row.effective && row.kind === 'contribution';

const isEffectiveWithdrawal = (row: SimpleInvestmentRow): boolean =>
  row.effective && row.kind === 'withdrawal';

export const summarizeSimpleInvestmentChips = (
  rows: SimpleInvestmentRow[],
): SimpleInvestmentChips => {
  const contributions = rows.filter(isEffectiveContribution);
  const contributionCents = contributions.reduce((total, row) => total + row.valueCents, 0);
  return {
    contributionCents,
    withdrawalCents: rows.filter(isEffectiveWithdrawal)
      .reduce((total, row) => total + row.valueCents, 0),
    averageContributionCents: contributions.length > 0
      ? Math.round(contributionCents / contributions.length)
      : 0,
    depositedCount: rows.filter((row) => row.status === 'deposited').length,
  };
};

export interface SimpleGoalCard {
  goalId: string | null;
  name: string;
  totalCents: number;
  color?: string;
  icon?: string;
}

export interface SimpleGoalCardSource {
  id: string;
  name: string;
  color?: string;
  icon?: string;
}

/**
 * Chave da faixa de alocação que representa investimento sem meta.
 *
 * É o mesmo valor que o backend grava em `allocationDescriptors`; repeti-lo
 * aqui é o preço de o cliente não importar o módulo do domínio.
 */
const UNASSIGNED_ALLOCATION_KEY = 'unassigned';

/**
 * Cards por meta, no formato do baseline.
 *
 * O primeiro card é sempre "Sem Meta Definida" — inclusive vazio, como no
 * baseline. Uma faixa cuja meta não existe mais cai nele: o card do baseline
 * fazia exatamente isso, e inventar um card órfão para uma meta arquivada
 * seria pior.
 *
 * ## Por que a fonte não é a página do ledger
 *
 * Os cards descrevem a carteira; a tabela descreve o filtro — é a divisão do
 * baseline, em que o resumo percorria todas as transações do período e só a
 * tabela via o recorte. Somá-los a partir das linhas carregadas quebrava isso
 * de duas formas: o filtro de estado desce ao servidor, de modo que escolher
 * "Pendentes" zerava todo card enquanto a carteira seguia intacta; e a lista é
 * paginada, de modo que o total dependia de quantas páginas alguém tinha
 * rolado.
 *
 * `investment_allocation_summaries` no corte `goal` é a projeção que o backend
 * já mantém por delta a partir das posições. Dela saem de graça as mesmas
 * invariantes que a versão anterior perseguia à mão — pendente nunca tocou
 * posição, cancelado nunca virou posição, retirada liquidada decrementa — e
 * mais duas que a soma de linhas não alcançava: nenhuma dependência de página
 * e nenhuma dependência de filtro.
 *
 * `principalCents` é capital aplicado. Rendimento retirado não o reduz, porque
 * rendimento nunca foi aporte.
 */
export const buildSimpleGoalCards = (
  items: InvestmentAllocationSummary[],
  goals: SimpleGoalCardSource[],
): SimpleGoalCard[] => {
  const byId = new Map(goals.map((goal) => [goal.id, goal]));
  const cards: SimpleGoalCard[] = [];
  let noGoalCents = 0;

  items.forEach((item) => {
    const goal = item.key === UNASSIGNED_ALLOCATION_KEY
      ? undefined
      : byId.get(item.key);
    if (!goal) {
      noGoalCents += item.principalCents;
      return;
    }
    cards.push({
      goalId: goal.id,
      name: goal.name,
      totalCents: item.principalCents,
      color: goal.color,
      icon: goal.icon,
    });
  });

  return [
    { goalId: null, name: 'Sem Meta Definida', totalCents: noGoalCents },
    ...cards,
  ];
};
