
import { Transaction, Goal, CreditCard, Loan } from '../../types.ts';
import { isInvoiceOverdue } from '../cards/cycle.ts';
import type { CardInvoice } from '../cards/types.ts';
import type { ReceivableReportData } from '../clients/types.ts';
import {reportWindowStart, saoPauloDayKey} from './dateWindow.ts';

export {reportWindowStart} from './dateWindow.ts';
import { Workspace } from '../workspaces/types.ts';
import {
    investmentOutflowOf,
    // D-13 (P3-H): espelho de empréstimo fora de receita/despesa operacional.
    isOperationalExpense,
    operationalExpenseOf,
    operationalIncomeOf,
    transactionCashImpact,
} from '../investments/semantics.ts';
import {
    ReportTimeRange,
    FinancialReportSnapshot,
    FinancialKPI,
    CashFlowSummary,
    ExpenseCategoryBreakdown,
    DebtProfile,
    FinancialAlert,
    ClientMetric,
    ReceivableStatusMetric,
    CreditCardReportDomainData,
    CreditCardReportIndicator,
    CreditCardExpenseReportViews,
    CreditCardExpenseByPeriodItem,
} from './types.ts';

// --- Helpers ---

/**
 * Lançamentos que entram na contabilidade de caixa do relatório. Desde a
 * P4-A não há projeção de faturas em `transactions`: a compra no cartão vive
 * no domínio de cartões, e o espelho do pagamento de fatura é classificado
 * pela semântica (`creditCardPaymentEntry`: move o saldo, nunca é receita nem
 * despesa operacional). Nada a filtrar aqui.
 */
export const buildCashAccountingTransactions = (
    transactions: Transaction[],
): Transaction[] => transactions;

    export interface ReportDateRange {
    startDate?: string;
    endDate: string;
    isAllTime: boolean;
}

export const resolveReportDateRange = (range: ReportTimeRange): ReportDateRange => {
    const endDate = saoPauloDayKey();
    const startDate = reportWindowStart(range);
    return startDate
        ? { startDate, endDate, isAllTime: false }
        : { endDate, isAllTime: true };
};

export const filterTransactionsByRange = (transactions: Transaction[], range: ReportTimeRange): Transaction[] => {
    const startDate = reportWindowStart(range);
    if (!startDate) return transactions;
    // `t.date` já é `YYYY-MM-DD`: comparação lexicográfica é a mesma coisa que
    // comparação cronológica, e não passa por fuso nenhum.
    return transactions.filter(t => (t.date ?? '') >= startDate);
};

export const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
};

const calculateTrend = (current: number, previous: number): 'up' | 'down' | 'stable' => {
    if (previous === 0) return 'stable';
    const diff = ((current - previous) / previous) * 100;
    if (Math.abs(diff) < 2) return 'stable';
    return diff > 0 ? 'up' : 'down';
};

// --- KPI Builders ---

function buildPersonalKPIs(
    transactions: Transaction[],
    range: ReportTimeRange
): FinancialKPI[] {
    const cashAccountingTransactions = buildCashAccountingTransactions(transactions);
    const filtered = filterTransactionsByRange(cashAccountingTransactions, range);

    const income = filtered.reduce((sum, t) => sum + operationalIncomeOf(t), 0);
    const expense = filtered.reduce((sum, t) => sum + operationalExpenseOf(t), 0);
    // Caixa aplicado em investimentos no período (espelho de caixa: aporte
    // liquidado menos estorno). Patrimônio e aporte oficial vêm da projeção
    // do domínio (`buildInvestmentOverview`); dívida P5 registrada.
    const investment = filtered.reduce((sum, t) => sum + investmentOutflowOf(t), 0);

    const netResult = filtered.reduce((sum, transaction) => sum + transactionCashImpact(transaction), 0);
    const savingsRate = income > 0 ? (investment / income) * 100 : 0;

    return [
        {
            id: 'kpi-income',
            label: 'Receitas Totais',
            value: income,
            formattedValue: formatCurrency(income),
            trend: 'stable',
            period: 'custom',
            nature: 'caixa'
        },
        {
            id: 'kpi-expenses',
            label: 'Despesas Totais',
            value: expense,
            formattedValue: formatCurrency(expense),
            trend: 'stable',
            period: 'custom',
            nature: 'caixa'
        },
        {
            id: 'kpi-investments',
            label: 'Investimentos',
            value: investment,
            formattedValue: formatCurrency(investment),
            trend: 'stable',
            period: 'custom',
            // Aportes são saída de caixa direcionada a investimento, não
            // patrimônio acumulado — por isso `contribuicao`, e é o que
            // mantém este indicador comparável com receitas e despesas.
            nature: 'contribuicao'
        },
        {
            id: 'kpi-balance',
            label: 'Fluxo de Caixa Líquido',
            value: netResult,
            formattedValue: formatCurrency(netResult),
            trend: netResult >= 0 ? 'up' : 'down',
            // Sinal do valor, não comparação com o período anterior.
            trendBasis: 'sign',
            period: 'custom',
            nature: 'caixa'
        },
        {
            id: 'kpi-savings',
            label: 'Taxa de Poupança',
            value: savingsRate,
            formattedValue: `${savingsRate.toFixed(1)}%`,
            trend: 'stable',
            period: 'custom',
            description: 'Percentual da renda investida',
            nature: 'indicador'
        }
    ];
}

function buildBusinessKPIs(
    transactions: Transaction[],
    range: ReportTimeRange,
    receivableData?: ReceivableReportData | null,
    bankDebtTotal = 0
): FinancialKPI[] {
    const cashAccountingTransactions = buildCashAccountingTransactions(transactions);
    const filtered = filterTransactionsByRange(cashAccountingTransactions, range);

    const grossRevenue = filtered.reduce((sum, t) => sum + operationalIncomeOf(t), 0);
    const operationalExpenses = filtered.reduce((sum, t) => sum + operationalExpenseOf(t), 0);
    const netProfit = grossRevenue - operationalExpenses;
    const profitMargin = grossRevenue > 0 ? (netProfit / grossRevenue) * 100 : 0;

    /*
     * P3-I — saldo em aberto (em dia + em atraso) somado pelo servidor sobre
     * `balanceCents`; recebidos e cancelados ficam fora. Centavos → reais só
     * para exibição.
     */
    const totalReceivable = receivableData
        ? (receivableData.openNotOverdue.balanceCents + receivableData.overdue.balanceCents) / 100
        : 0;

    /*
     * A dívida bancária chega pronta, somada pelo servidor.
     *
     * Antes o relatório recebia a coleção **inteira** de contratos só para
     * reduzi-la a este número. Como é relatório, o array não podia ser
     * paginado sem tornar o indicador silenciosamente parcial — a saída é o
     * agregado (`getLoanTotals`), que é exato e não lê documento nenhum.
     */
    const totalLiabilities = bankDebtTotal;

    return [
        {
            id: 'kpi-gross-revenue',
            label: 'Faturamento',
            value: grossRevenue,
            formattedValue: formatCurrency(grossRevenue),
            trend: 'stable',
            period: 'custom'
        },
        {
            id: 'kpi-profit-margin',
            label: 'Margem Líquida',
            value: profitMargin,
            formattedValue: `${profitMargin.toFixed(1)}%`,
            trend: profitMargin > 15 ? 'up' : 'stable',
            period: 'custom',
            description: 'Lucro sobre faturamento'
        },
        {
            id: 'kpi-receivables-total',
            label: 'Contas a Receber',
            value: totalReceivable,
            formattedValue: formatCurrency(totalReceivable),
            trend: 'stable',
            period: 'custom'
        },
        {
            id: 'kpi-debt-total',
            label: 'Dívida Bancária',
            value: totalLiabilities,
            formattedValue: formatCurrency(totalLiabilities),
            trend: 'stable',
            period: 'custom'
        }
    ];
}

// --- Core Calculations ---

export const calculateKPIs = (
    transactions: Transaction[],
    range: ReportTimeRange,
    workspace?: Workspace,
    receivableData?: ReceivableReportData | null,
    bankDebtTotal = 0
): FinancialKPI[] => {
    if (workspace?.type === 'PJ') {
        return buildBusinessKPIs(transactions, range, receivableData, bankDebtTotal);
    }
    return buildPersonalKPIs(transactions, range);
};

export const calculateCashFlow = (transactions: Transaction[]): CashFlowSummary[] => {
    const cashAccountingTransactions = buildCashAccountingTransactions(transactions);
    const history: Record<string, CashFlowSummary> = {};
    const now = new Date();

    // Pegar últimos 6 meses
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = d.toISOString().slice(0, 7);
        history[key] = { month: key, totalIncome: 0, totalExpenses: 0, netCashFlow: 0, savingsRate: 0 };
    }

    cashAccountingTransactions.forEach(t => {
        const key = t.date.slice(0, 7);
        if (history[key]) {
            history[key].netCashFlow += transactionCashImpact(t);
            history[key].totalIncome += operationalIncomeOf(t);
            history[key].totalExpenses += operationalExpenseOf(t);
        }
    });

    return Object.values(history).map(item => ({
        ...item,
        savingsRate: item.totalIncome > 0 ? (item.netCashFlow / item.totalIncome) * 100 : 0
    })).sort((a, b) => b.month.localeCompare(a.month));
};

export const calculateCategoryBreakdown = (transactions: Transaction[], range: ReportTimeRange): ExpenseCategoryBreakdown[] => {
    const cashAccountingTransactions = buildCashAccountingTransactions(transactions);
    const filtered = filterTransactionsByRange(cashAccountingTransactions, range);
    const expenses = filtered.filter(isOperationalExpense);
    // `operationalExpenseOf`: a compensação da Divisão de contas (P4-C)
    // entra com sinal negativo na categoria do fato original.
    const totalExpense = expenses.reduce((sum, t) => sum + operationalExpenseOf(t), 0);

    const byCategory: Record<string, number> = {};
    expenses.forEach(t => {
        byCategory[t.category] = (byCategory[t.category] || 0) + operationalExpenseOf(t);
    });

    return Object.entries(byCategory)
        .map(([name, amount]) => ({
            categoryId: name,
            categoryName: name,
            totalAmount: amount,
            percentageOfTotal: totalExpense > 0 ? (amount / totalExpense) * 100 : 0
        }))
        .sort((a, b) => b.totalAmount - a.totalAmount);
};

const EMPTY_CREDIT_CARD_REPORT_DOMAIN_DATA: CreditCardReportDomainData = {
    purchases: [],
    invoices: [],
    payments: [],
};

// Centavos → reais só para exibição (a soma é sempre em centavos inteiros).
const toReais = (cents: number): number => cents / 100;

const addDays = (dayKey: string, days: number): string => {
    const [year, month, day] = dayKey.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
};

const isBetweenInclusive = (
    value: string,
    start: string,
    end: string,
): boolean => value >= start && value <= end;

/** Saldo a pagar da fatura: aberta pelo total positivo; fechada pelo restante. */
const payableCentsOf = (invoice: CardInvoice): number =>
    invoice.cycleStatus === 'open' ? Math.max(invoice.totalCents, 0) : Math.max(invoice.remainingCents, 0);

const sumPayableCents = (invoices: CardInvoice[]): number =>
    invoices.reduce((sum, invoice) => sum + payableCentsOf(invoice), 0);

interface CardIndicatorCents {
    cardId: string;
    cardName: string;
    status: string;
    limitTotalCents: number;
    limitUsedCents: number;
    limitAvailableCents: number;
    utilizationRate: number;
    openInvoiceCents: number;
    futureCommittedCents: number;
    overdueCents: number;
    due7Cents: number;
    due15Cents: number;
    due30Cents: number;
    paidCents: number;
    reversedCents: number;
    currentInvoice?: CardInvoice;
}

/**
 * Indicadores por cartão ativo (P4-A), em centavos: fatura atual e
 * comprometido futuro (faturas com saldo), atraso derivado (fechada, com
 * saldo e vencida — nunca gravado), vencimentos próximos e pagamentos do
 * período. Hoje é o dia civil de São Paulo.
 */
const computeCardIndicatorsCents = (
    creditCards: CreditCard[],
    data: CreditCardReportDomainData,
): CardIndicatorCents[] => {
    const today = saoPauloDayKey();
    const next7Days = addDays(today, 7);
    const next15Days = addDays(today, 15);
    const next30Days = addDays(today, 30);
    const dueBetween = (invoices: CardInvoice[], end: string) =>
        sumPayableCents(invoices.filter((invoice) => isBetweenInclusive(invoice.dueDate, today, end)));

    return creditCards
        .filter((card) => card.status === 'active')
        .map((card) => {
            const withBalance = data.invoices
                .filter((invoice) => invoice.cardId === card.id && payableCentsOf(invoice) > 0)
                .sort((left, right) => left.dueDate.localeCompare(right.dueDate));
            const currentInvoice = withBalance[0];
            const cardPayments = data.payments.filter((payment) => payment.cardId === card.id);
            return {
                cardId: card.id,
                cardName: card.name,
                status: card.status,
                limitTotalCents: card.limitTotalCents,
                limitUsedCents: card.limitUsedCents,
                limitAvailableCents: card.limitAvailableCents,
                utilizationRate: card.limitTotalCents > 0
                    ? (Math.max(card.limitUsedCents, 0) / card.limitTotalCents) * 100
                    : 0,
                openInvoiceCents: currentInvoice ? payableCentsOf(currentInvoice) : 0,
                futureCommittedCents: sumPayableCents(withBalance.slice(1)),
                overdueCents: sumPayableCents(withBalance.filter((invoice) => isInvoiceOverdue(invoice, today))),
                due7Cents: dueBetween(withBalance, next7Days),
                due15Cents: dueBetween(withBalance, next15Days),
                due30Cents: dueBetween(withBalance, next30Days),
                paidCents: cardPayments.filter((payment) => payment.kind === 'payment')
                    .reduce((sum, payment) => sum + payment.amountCents, 0),
                reversedCents: cardPayments.filter((payment) => payment.kind === 'reversal')
                    .reduce((sum, payment) => sum + payment.amountCents, 0),
                currentInvoice,
            };
        });
};

export const calculateCreditCardReportIndicators = (
    creditCards: CreditCard[],
    creditCardDomainData: CreditCardReportDomainData = EMPTY_CREDIT_CARD_REPORT_DOMAIN_DATA,
): CreditCardReportIndicator[] =>
    computeCardIndicatorsCents(creditCards, creditCardDomainData).map((card) => ({
        cardId: card.cardId,
        cardName: card.cardName,
        status: card.status,
        limitTotal: toReais(card.limitTotalCents),
        limitUsed: toReais(card.limitUsedCents),
        limitAvailable: toReais(card.limitAvailableCents),
        utilizationRate: card.utilizationRate,
        openInvoiceBalance: toReais(card.openInvoiceCents),
        futureCommittedBalance: toReais(card.futureCommittedCents),
        overdueAmount: toReais(card.overdueCents),
        dueBuckets: {
            next7Days: toReais(card.due7Cents),
            next15Days: toReais(card.due15Cents),
            next30Days: toReais(card.due30Cents),
        },
        registeredPaymentsAmount: toReais(card.paidCents),
        reversedPaymentsAmount: toReais(card.reversedCents),
        currentInvoiceId: card.currentInvoice?.id,
        currentInvoiceDueDate: card.currentInvoice?.dueDate,
        currentInvoiceStatus: card.currentInvoice
            ? (card.currentInvoice.cycleStatus === 'open' ? 'open' : card.currentInvoice.paymentStatus)
            : undefined,
    }));

const sumOf = (cards: CardIndicatorCents[], pick: (card: CardIndicatorCents) => number): number =>
    cards.reduce((sum, card) => sum + pick(card), 0);

export const calculateDebtProfile = (
    _transactions: Transaction[],
    creditCards: CreditCard[],
    creditCardDomainData: CreditCardReportDomainData = EMPTY_CREDIT_CARD_REPORT_DOMAIN_DATA,
): DebtProfile => {
    const cards = computeCardIndicatorsCents(creditCards, creditCardDomainData);
    const totalLimitCents = sumOf(cards, (card) => card.limitTotalCents);
    const usageCents = sumOf(cards, (card) => Math.max(card.limitUsedCents, 0));
    const utilizationRate = totalLimitCents > 0 ? (usageCents / totalLimitCents) * 100 : 0;

    return {
        totalCreditCardDebt: toReais(usageCents),
        totalLoans: 0,
        totalInstallments: toReais(sumOf(cards, (card) => card.futureCommittedCents)),
        utilizationRate,
        riskLevel: utilizationRate > 80 ? 'critico' : utilizationRate > 60 ? 'alto' : utilizationRate > 30 ? 'moderado' : 'baixo',

        creditCardTotalLimit: toReais(totalLimitCents),
        creditCardAvailableLimit: toReais(sumOf(cards, (card) => card.limitAvailableCents)),
        creditCardOpenInvoiceBalance: toReais(sumOf(cards, (card) => card.openInvoiceCents)),
        creditCardFutureCommittedBalance: toReais(sumOf(cards, (card) => card.futureCommittedCents)),
        creditCardOverdueAmount: toReais(sumOf(cards, (card) => card.overdueCents)),
        creditCardDueNext7Days: toReais(sumOf(cards, (card) => card.due7Cents)),
        creditCardDueNext15Days: toReais(sumOf(cards, (card) => card.due15Cents)),
        creditCardDueNext30Days: toReais(sumOf(cards, (card) => card.due30Cents)),
        registeredInvoicePaymentsAmount: toReais(sumOf(cards, (card) => card.paidCents)),
        reversedInvoicePaymentsAmount: toReais(sumOf(cards, (card) => card.reversedCents)),

        creditCardIndicators: calculateCreditCardReportIndicators(creditCards, creditCardDomainData),
    };
};

const formatPeriodLabel = (period: string): string => {
    const [year, month] = period.split('-').map(Number);

    if (!year || !month) return period;

    return new Date(year, month - 1, 2).toLocaleDateString('pt-BR', {
        month: 'short',
        year: 'numeric',
    });
};

const sortPeriodItemsDesc = <T extends { period: string }>(items: T[]): T[] =>
    [...items].sort((left, right) => right.period.localeCompare(left.period));

/**
 * Visões de gasto no cartão (P4-A), em centavos: compras ativas pela data da
 * compra (competência de consumo) e pagamentos líquidos (pagamento − estorno)
 * pela data do pagamento. O pagamento de fatura nunca é somado como despesa:
 * é a liquidação do cartão (dependência P5: DRE por competência).
 */
export const calculateCreditCardExpenseReportViews = (
    creditCards: CreditCard[],
    creditCardDomainData: CreditCardReportDomainData = EMPTY_CREDIT_CARD_REPORT_DOMAIN_DATA,
    range: ReportTimeRange,
): CreditCardExpenseReportViews => {
    const startDate = resolveReportDateRange(range).startDate;
    const inRange = (dayKey: string) => !startDate || dayKey >= startDate;
    const cardNameById = new Map(creditCards.map((card) => [card.id, card.name]));
    const activePurchases = creditCardDomainData.purchases
        .filter((purchase) => purchase.status === 'active' && inRange(purchase.purchaseDate));
    const payments = creditCardDomainData.payments
        .filter((payment) => inRange(payment.paymentDate));
    const signedPayment = (kind: 'payment' | 'reversal', cents: number) =>
        kind === 'payment' ? cents : -cents;

    const byPeriod = <T,>(
        items: T[],
        dayOf: (item: T) => string,
        centsOf: (item: T) => number,
        counts: (item: T) => boolean,
    ): CreditCardExpenseByPeriodItem[] => {
        const map = new Map<string, { cents: number; count: number }>();
        for (const item of items) {
            const period = dayOf(item).slice(0, 7);
            const current = map.get(period) ?? { cents: 0, count: 0 };
            current.cents += centsOf(item);
            if (counts(item)) current.count += 1;
            map.set(period, current);
        }
        return sortPeriodItemsDesc(Array.from(map.entries()).map(([period, value]) => ({
            period,
            label: formatPeriodLabel(period),
            amount: toReais(value.cents),
            count: value.count,
        })));
    };

    const indicators = computeCardIndicatorsCents(creditCards, creditCardDomainData);
    const cardAnalytics = indicators.map((indicator) => {
        const cardPurchases = activePurchases.filter((purchase) => purchase.cardId === indicator.cardId);
        const cardPayments = payments.filter((payment) => payment.cardId === indicator.cardId);
        return {
            cardId: indicator.cardId,
            cardName: cardNameById.get(indicator.cardId) ?? indicator.cardName,
            purchaseAmount: toReais(cardPurchases.reduce((sum, purchase) => sum + purchase.totalCents, 0)),
            purchaseCount: cardPurchases.length,
            paidAmount: toReais(cardPayments.reduce((sum, payment) =>
                sum + signedPayment(payment.kind, payment.amountCents), 0)),
            openInvoiceBalance: toReais(indicator.openInvoiceCents),
            futureCommittedBalance: toReais(indicator.futureCommittedCents),
            overdueAmount: toReais(indicator.overdueCents),
            utilizationRate: indicator.utilizationRate,
        };
    });

    return {
        purchaseCompetence: byPeriod(activePurchases, (purchase) => purchase.purchaseDate,
            (purchase) => purchase.totalCents, () => true),
        invoicePaymentDate: byPeriod(payments, (payment) => payment.paymentDate,
            (payment) => signedPayment(payment.kind, payment.amountCents),
            (payment) => payment.kind === 'payment'),
        cardAnalytics,
    };
};
/**
 * P3-I — ranking de clientes pelo valor original dos recebíveis não
 * cancelados (amostra com teto, ver `getReceivableReportData`). Centavos →
 * reais só para exibição.
 */
export const calculateTopClients = (data: ReceivableReportData): ClientMetric[] => {
    const total = data.topClients.reduce((sum, client) => sum + client.amountCents, 0);
    return data.topClients.map((client) => ({
        clientId: client.clientId,
        clientName: client.clientName,
        totalValue: client.amountCents / 100,
        percentage: total > 0 ? (client.amountCents / total) * 100 : 0,
    }));
};

/**
 * P3-I — situação dos recebíveis por agregados do servidor: em aberto e em
 * atraso pelo saldo; recebido pelo principal recebido. "Em atraso" é
 * derivado (aberto com vencimento antes de hoje), nunca um status gravado.
 */
export const calculateReceivablesStatus = (data: ReceivableReportData): ReceivableStatusMetric[] => [
    { status: 'Em aberto', count: data.openNotOverdue.count, totalValue: data.openNotOverdue.balanceCents / 100, color: '#f59e0b' },
    { status: 'Recebido', count: data.received.count, totalValue: data.received.principalCents / 100, color: '#10b981' },
    { status: 'Em atraso', count: data.overdue.count, totalValue: data.overdue.balanceCents / 100, color: '#ef4444' },
];

export const generateAlerts = (
    kpis: FinancialKPI[],
    debt: DebtProfile,
    workspace?: Workspace,
    receivableData?: ReceivableReportData | null
): FinancialAlert[] => {
    const alerts: FinancialAlert[] = [];
    const now = new Date().toISOString();

    if (workspace?.type === 'PJ') {
        const profitKPI = kpis.find(k => k.id === 'kpi-net-profit');
        if (profitKPI && profitKPI.value < 0) {
            alerts.push({ id: 'a1', title: 'Fluxo Negativo', message: 'Despesas superaram as receitas no período.', severity: 'critical', createdAt: now });
        }
        const overdue = receivableData?.overdue.count ?? 0;
        if (overdue > 0) {
            alerts.push({ id: 'a2', title: 'Inadimplência', message: `Existem ${overdue} faturas de clientes em atraso.`, severity: 'warning', createdAt: now });
        }
    } else {
        if (debt.utilizationRate > 80) {
            alerts.push({ id: 'a3', title: 'Cartão de Crédito', message: 'Limite de cartões próximo ao máximo.', severity: 'critical', createdAt: now });
        }
    }
    return alerts;
};
