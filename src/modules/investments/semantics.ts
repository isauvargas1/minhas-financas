import type {Transaction, TransactionInvestmentEntry} from '../../types';

/*
 * Semântica de caixa dos lançamentos em `transactions`.
 *
 * Investimentos (D-15, P4-D): o patrimônio vive em `investment_movements` e
 * nas projeções dele (`investment_positions`, `investment_summaries`,
 * `investment_report_periods`). O espelho em `transactions` é **só** o efeito
 * de caixa, classificado pela marca backend-only `investmentEntry` — a mesma
 * regra de `investmentCashEffect` no backend:
 *
 * - aporte liquidado → saída para investimento;
 * - retirada recebida → entrada do principal mais o rendimento (resultado
 *   financeiro), nunca receita operacional;
 * - pendente e cancelado → zero;
 * - estorno → o efeito do original com sinal oposto.
 *
 * Documento `investimento` sem marca válida está fora do contrato e não tem
 * efeito: não há leitura de `value`, de metadado antigo nem do tipo sozinho.
 * Nada aqui alimenta patrimônio nem meta.
 */

const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

const isCents = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Marca do espelho de investimento, validada; `null` fora do contrato. */
export const investmentEntryOf = (
  transaction: Transaction,
): TransactionInvestmentEntry | null => {
  if (transaction.type !== 'investimento') return null;
  const entry = transaction.investmentEntry as unknown;
  if (typeof entry !== 'object' || entry === null) return null;
  const value = entry as Record<string, unknown>;
  if (
    value.domainVersion !== 1 ||
    !isText(value.movementId) ||
    (value.operation !== 'contribution' && value.operation !== 'redemption') ||
    typeof value.reversal !== 'boolean' ||
    (value.reversal ? !isText(value.reversalOf) : value.reversalOf !== null) ||
    (value.status !== 'pending' && value.status !== 'settled' && value.status !== 'cancelled') ||
    (value.reversal && value.status !== 'settled') ||
    !isCents(value.principalCents) || !isCents(value.gainCents) ||
    (value.operation === 'contribution' && value.gainCents !== 0) ||
    !isCents(value.amountCents) || value.amountCents === 0 ||
    value.amountCents !== (value.principalCents as number) + (value.gainCents as number) ||
    value.currency !== 'BRL'
  ) {
    return null;
  }
  return value as unknown as TransactionInvestmentEntry;
};

export interface InvestmentCashEffect {
  investmentOutflowCents: number;
  investmentInflowCents: number;
  financialIncomeCents: number;
  netCents: number;
}

const ZERO_INVESTMENT_EFFECT: InvestmentCashEffect = Object.freeze({
  investmentOutflowCents: 0,
  investmentInflowCents: 0,
  financialIncomeCents: 0,
  netCents: 0,
});

// `|| 0` normaliza `-0`.
const signed = (value: number, sign: number): number => value * sign || 0;

/** Efeito de caixa do espelho de investimento; zero fora do contrato. */
export const investmentCashEffectOf = (transaction: Transaction): InvestmentCashEffect => {
  const entry = investmentEntryOf(transaction);
  if (!entry || entry.status !== 'settled') return ZERO_INVESTMENT_EFFECT;
  const sign = entry.reversal ? -1 : 1;
  if (entry.operation === 'contribution') {
    return {
      ...ZERO_INVESTMENT_EFFECT,
      investmentOutflowCents: signed(entry.amountCents, sign),
      netCents: signed(entry.amountCents, -sign),
    };
  }
  return {
    ...ZERO_INVESTMENT_EFFECT,
    investmentInflowCents: signed(entry.principalCents, sign),
    financialIncomeCents: signed(entry.gainCents, sign),
    netCents: signed(entry.amountCents, sign),
  };
};

/** Retirada de investimento (o fato, não o estorno dela). */
export const isInvestmentRedemption = (transaction: Transaction): boolean => {
  const entry = investmentEntryOf(transaction);
  return entry !== null && entry.operation === 'redemption' && !entry.reversal;
};

/**
 * Receita ou despesa ainda não liquidada (D-29, P3-F): pendente, agendada ou
 * vencida sem confirmação (`isPaid: false`). Não move o caixa realizado.
 * Mesma regra de `isUnsettledCashEntry` na projeção do backend.
 */
export const isUnsettledEntry = (transaction: Transaction): boolean =>
  (transaction.type === 'receita' || transaction.type === 'despesa') &&
  transaction.isPaid === false;

const centsFromReais = (value: number): number => Math.round(value * 100);

export const transactionCashImpactCents = (transaction: Transaction): number => {
  if (transaction.type === 'investimento') return investmentCashEffectOf(transaction).netCents;
  const valueCents = Number.isSafeInteger(transaction.valueCents)
    ? transaction.valueCents as number
    : centsFromReais(transaction.value);

  if (isUnsettledEntry(transaction)) return 0;
  if (transaction.type === 'receita') return valueCents;
  if (transaction.type === 'despesa' || transaction.type === 'parcelado') {
    // `parcelado` mantém a regra do domínio de cartões (P4).
    return transaction.isPaid === false ? 0 : -valueCents;
  }
  return 0;
};

/**
 * Saída líquida de caixa para investimentos, em centavos: aporte liquidado
 * soma, estorno de aporte subtrai. Classificação de **caixa** (o quanto saiu
 * do caixa para investir no período), nunca patrimônio — o patrimônio e o
 * aporte mensal oficial vêm de `investment_report_periods`.
 */
export const investmentOutflowCentsOf = (transaction: Transaction): number =>
  investmentCashEffectOf(transaction).investmentOutflowCents;

export const transactionCashImpact = (transaction: Transaction): number =>
  transactionCashImpactCents(transaction) / 100;

export const investmentOutflowOf = (transaction: Transaction): number =>
  investmentOutflowCentsOf(transaction) / 100;

/**
 * Espelho de empréstimo do backend (P3-G, D-13): move o saldo (pelo sinal do
 * tipo), mas o principal e os juros não são receita nem despesa operacional
 * — a projeção os separa em fluxo de principal e resultado financeiro.
 */
export const isLoanCashMirror = (transaction: Transaction): boolean =>
  typeof transaction.loanEntry === 'object' && transaction.loanEntry !== null;

/**
 * Espelho de caixa de recebimento de recebível (P3-I, D-39): o dinheiro
 * recebido (principal + juros + multa) move o saldo; o principal é receita
 * operacional, juros e multa são resultado financeiro — a mesma separação da
 * projeção do backend (`incomeCents` × `financialIncomeCents`). O estorno
 * (tipo `despesa`) desfaz o recebimento: não é despesa operacional.
 */
export const isReceivableCashMirror = (transaction: Transaction): boolean =>
  typeof transaction.receivableEntry === 'object' && transaction.receivableEntry !== null;

/**
 * Espelho de caixa do pagamento de fatura de cartão (P4-A): liquidação do
 * cartão. Move o saldo (o pagamento sai, o estorno volta), mas nunca é
 * despesa nem receita operacional — a despesa de consumo é a compra, no
 * domínio de cartões. Mesma regra da projeção do backend
 * (`creditCardPaymentCents`).
 */
export const isCreditCardPaymentCashMirror = (transaction: Transaction): boolean =>
  typeof transaction.creditCardPaymentEntry === 'object' &&
  transaction.creditCardPaymentEntry !== null;

/** Espelhos de domínio gravados pelo backend com classificação própria. */
const isDomainCashMirror = (transaction: Transaction): boolean =>
  isLoanCashMirror(transaction) || isReceivableCashMirror(transaction) ||
  isCreditCardPaymentCashMirror(transaction);

/**
 * Espelho de caixa da Divisão de contas (P4-C): título pago pelo Caixa e
 * pagamento de reembolso PJ são despesa operacional; a compensação (tipo
 * `receita`) desfaz a despesa — nunca é receita. Mesma regra da projeção do
 * backend (`splitCashEffect`).
 */
export const isSplitCashMirror = (transaction: Transaction): boolean =>
  typeof transaction.splitEntry === 'object' && transaction.splitEntry !== null;

/** Despesa do espelho da Divisão, com o sinal da compensação, em centavos. */
const splitExpenseCents = (transaction: Transaction): number => {
  const entry = transaction.splitEntry;
  if (!entry || !Number.isSafeInteger(entry.amountCents) || entry.amountCents < 0) return 0;
  return entry.reversal ? -entry.amountCents : entry.amountCents;
};

/**
 * Lançamento inteiramente operacional (D-13, P3-H, P3-I): receita ou despesa
 * comum. Os espelhos de domínio ficam fora — o de empréstimo é movimento de
 * passivo/ativo e resultado financeiro; o de recebível entra só pelo
 * principal (`operationalIncomeOf`) — e continuam no fluxo líquido de caixa
 * (`transactionCashImpact`).
 */
export const isOperationalIncome = (transaction: Transaction): boolean =>
  transaction.type === 'receita' && !isDomainCashMirror(transaction) &&
  !isSplitCashMirror(transaction);

export const isOperationalExpense = (transaction: Transaction): boolean =>
  isSplitCashMirror(transaction) ||
  ((transaction.type === 'despesa' || transaction.type === 'parcelado') &&
    !isDomainCashMirror(transaction));

/** Principal do espelho de recebível, com o sinal do estorno, em centavos. */
const receivablePrincipalCents = (transaction: Transaction): number => {
  const entry = transaction.receivableEntry;
  if (!entry || !Number.isSafeInteger(entry.principalCents) || entry.principalCents < 0) return 0;
  return entry.reversal ? -entry.principalCents : entry.principalCents;
};

/**
 * Receita operacional do lançamento, em reais: o valor da receita comum ou o
 * principal (com sinal) do espelho de recebível. Empréstimo não conta.
 */
export const operationalIncomeOf = (transaction: Transaction): number => {
  if (isReceivableCashMirror(transaction)) return receivablePrincipalCents(transaction) / 100;
  return isOperationalIncome(transaction) ? transaction.value : 0;
};

/**
 * Despesa operacional do lançamento, em reais: o valor da despesa comum ou,
 * no espelho da Divisão de contas, a despesa com o sinal da compensação.
 */
export const operationalExpenseOf = (transaction: Transaction): number => {
  if (isSplitCashMirror(transaction)) return splitExpenseCents(transaction) / 100;
  return isOperationalExpense(transaction) ? transaction.value : 0;
};

/**
 * Resumo do caixa realizado (D-29): receitas e despesas pendentes ou agendadas
 * ficam fora de "Receitas", "Despesas" e do saldo — são previsão, não fato.
 * `parcelado` não é mais gravado por nenhum fluxo (P4-A/B/C: a compra
 * parcelada vive no domínio de cartões); um documento fora do contrato segue
 * a regra anterior. Espelhos de empréstimo (P3-G) e de pagamento de fatura
 * de cartão (P4-A) ficam fora de "Receitas" e "Despesas" e dentro do saldo;
 * o de recebível (P3-I) entra em "Receitas" só pelo principal; o da Divisão
 * de contas (P4-C) entra em "Despesas" com o sinal da compensação. O espelho
 * de investimento (P4-D) entra só no saldo; o card "Investimentos" lê o
 * aporte do mês da projeção oficial do domínio (`investment_report_periods`).
 */
export const summarizeCashFlow = (transactions: Transaction[]) => ({
  income: transactions
    .filter(transaction => !isUnsettledEntry(transaction))
    .reduce((total, transaction) => total + operationalIncomeOf(transaction), 0),
  expenses: transactions
    .filter(transaction =>
      isSplitCashMirror(transaction) ||
      (transaction.type === 'despesa' && !isUnsettledEntry(transaction) &&
        !isDomainCashMirror(transaction)) ||
      transaction.type === 'parcelado')
    .reduce((total, transaction) => total + (isSplitCashMirror(transaction)
      ? operationalExpenseOf(transaction)
      : transaction.value), 0),
  balance: transactions.reduce(
    (total, transaction) => total + transactionCashImpact(transaction),
    0,
  ),
});
