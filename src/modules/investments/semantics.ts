import type {Transaction} from '../../types';

/*
 * Semântica do espelho de caixa do domínio patrimonial em `transactions`.
 *
 * O patrimônio vive em `investment_movements`. Cada movimento que move
 * dinheiro projeta um espelho aqui, marcado com `investmentMetadata` — é isso
 * que estas funções classificam. `transactions` continua sendo o domínio de
 * receitas, despesas e fluxo de caixa; nunca é fonte de verdade patrimonial.
 *
 * O ramo sem `investmentMetadata` cobre documentos anteriores ao espelho e
 * mantém o fluxo de caixa correto sobre eles, sem nunca alimentar patrimônio.
 */

const centsFromReais = (value: number): number => Math.round(value * 100);

export const isInvestmentRedemption = (transaction: Transaction): boolean =>
  transaction.type === 'investimento' &&
  transaction.investmentMetadata?.investmentOperation === 'redemption';

const isInvestmentContribution = (transaction: Transaction): boolean =>
  transaction.type === 'investimento' &&
  (!transaction.investmentMetadata ||
    transaction.investmentMetadata.investmentOperation === 'contribution');

const isEffectiveInvestmentMovement = (transaction: Transaction): boolean => {
  if (transaction.type !== 'investimento') return false;
  if (!transaction.investmentMetadata) return transaction.isPaid !== false;
  return transaction.investmentMetadata.status === 'settled' ||
    transaction.investmentMetadata.status === 'reversed';
};

export const transactionCashImpactCents = (transaction: Transaction): number => {
  const valueCents = Number.isSafeInteger(transaction.valueCents)
    ? transaction.valueCents as number
    : centsFromReais(transaction.value);

  if (transaction.type === 'receita') return valueCents;
  if (transaction.type === 'despesa' || transaction.type === 'parcelado') {
    return transaction.isPaid === false ? 0 : -valueCents;
  }
  if (transaction.type !== 'investimento' || !isEffectiveInvestmentMovement(transaction)) return 0;

  const direction = transaction.investmentMetadata?.cashImpact;
  if (direction === 'inflow') return valueCents;
  if (direction === 'outflow') return -valueCents;
  if (direction === 'none') return 0;
  return -valueCents;
};

export const contributionAllocationCents = (transaction: Transaction): number => {
  if (!isInvestmentContribution(transaction) || !isEffectiveInvestmentMovement(transaction)) return 0;
  const principal = transaction.investmentMetadata?.principalCents;
  if (Number.isSafeInteger(principal)) return principal as number;
  if (Number.isSafeInteger(transaction.valueCents)) return transaction.valueCents as number;
  return centsFromReais(transaction.value);
};

export const goalInvestmentImpactCents = (transaction: Transaction): number => {
  if (transaction.type !== 'investimento' || !isEffectiveInvestmentMovement(transaction)) return 0;
  const metadata = transaction.investmentMetadata;
  if (!metadata) return transaction.goalId
    ? (Number.isSafeInteger(transaction.valueCents)
        ? transaction.valueCents as number
        : centsFromReais(transaction.value))
    : 0;
  if (!transaction.goalId) return 0;
  if (metadata.investmentOperation === 'contribution') return metadata.principalCents;
  if (metadata.investmentOperation === 'redemption') return -metadata.principalCents;
  if (metadata.investmentOperation === 'redemption_reversal') return metadata.principalCents;
  return 0;
};

export const realizedInvestmentGainCents = (transaction: Transaction): number => {
  if (!isEffectiveInvestmentMovement(transaction)) return 0;
  const metadata = transaction.investmentMetadata;
  if (!metadata) return 0;
  if (metadata.investmentOperation === 'redemption') return metadata.gainCents;
  if (metadata.investmentOperation === 'redemption_reversal') return -metadata.gainCents;
  return 0;
};

export const transactionCashImpact = (transaction: Transaction): number =>
  transactionCashImpactCents(transaction) / 100;

export const contributionAllocation = (transaction: Transaction): number =>
  contributionAllocationCents(transaction) / 100;

export const summarizeCashFlow = (transactions: Transaction[]) => ({
  income: transactions
    .filter(transaction => transaction.type === 'receita')
    .reduce((total, transaction) => total + transaction.value, 0),
  expenses: transactions
    .filter(transaction => transaction.type === 'despesa' || transaction.type === 'parcelado')
    .reduce((total, transaction) => total + transaction.value, 0),
  investments: transactions.reduce(
    (total, transaction) => total + contributionAllocation(transaction),
    0,
  ),
  balance: transactions.reduce(
    (total, transaction) => total + transactionCashImpact(transaction),
    0,
  ),
});
