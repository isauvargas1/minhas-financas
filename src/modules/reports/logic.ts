
import { Transaction, Goal, CreditCard, Loan } from '../../types.ts';
import {
    filterReversedCreditCardInvoicePaymentCashTransactions,
    isCreditCardInvoiceCompatibleTransaction,
    isLegacyCreditCardInstallmentTransaction,
} from '../credit-cards/compatibility';
import { Receivable, Client } from '../clients/types.ts';
import { Workspace } from '../workspaces/types.ts';
import {
    contributionAllocation,
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

export const buildCashAccountingTransactions = (
    transactions: Transaction[],
): Transaction[] =>
    filterReversedCreditCardInvoicePaymentCashTransactions(
        transactions.filter((transaction) =>
            !isCreditCardInvoiceCompatibleTransaction(transaction) &&
            !isLegacyCreditCardInstallmentTransaction(transaction)
        )
    );

    export interface ReportDateRange {
    startDate?: string;
    endDate: string;
    isAllTime: boolean;
}

const toReportIsoDate = (date: Date): string => date.toISOString().slice(0, 10);

export const resolveReportDateRange = (range: ReportTimeRange): ReportDateRange => {
    const now = new Date();
    const endDate = toReportIsoDate(now);
    const startDate = new Date(now);

    switch (range) {
        case '7d':
            startDate.setDate(now.getDate() - 7);
            return { startDate: toReportIsoDate(startDate), endDate, isAllTime: false };
        case '30d':
            startDate.setDate(now.getDate() - 30);
            return { startDate: toReportIsoDate(startDate), endDate, isAllTime: false };
        case '90d':
            startDate.setDate(now.getDate() - 90);
            return { startDate: toReportIsoDate(startDate), endDate, isAllTime: false };
        case '12m':
            startDate.setFullYear(now.getFullYear() - 1);
            return { startDate: toReportIsoDate(startDate), endDate, isAllTime: false };
        case 'ytd':
            return {
                startDate: toReportIsoDate(new Date(now.getFullYear(), 0, 1)),
                endDate,
                isAllTime: false,
            };
        case 'all':
        default:
            return { endDate, isAllTime: true };
    }
};

export const filterTransactionsByRange = (transactions: Transaction[], range: ReportTimeRange): Transaction[] => {
    const now = new Date();
    let startDate = new Date();

    switch (range) {
        case '7d': startDate.setDate(now.getDate() - 7); break;
        case '30d': startDate.setDate(now.getDate() - 30); break;
        case '90d': startDate.setDate(now.getDate() - 90); break;
        case '12m': startDate.setFullYear(now.getFullYear() - 1); break;
        case 'ytd': startDate = new Date(now.getFullYear(), 0, 1); break;
        case 'all': return transactions;
        default: startDate.setDate(now.getDate() - 30);
    }

    return transactions.filter(t => new Date(t.date) >= startDate);
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

    const income = filtered.filter(t => t.type === 'receita').reduce((sum, t) => sum + t.value, 0);
    const expense = filtered.filter(t => t.type === 'despesa' || t.type === 'parcelado').reduce((sum, t) => sum + t.value, 0);
    const investment = filtered.reduce((sum, t) => sum + contributionAllocation(t), 0);

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
    receivables: Receivable[] = [],
    loans: Loan[] = []
): FinancialKPI[] {
    const cashAccountingTransactions = buildCashAccountingTransactions(transactions);
    const filtered = filterTransactionsByRange(cashAccountingTransactions, range);

    const grossRevenue = filtered.filter(t => t.type === 'receita').reduce((sum, t) => sum + t.value, 0);
    const operationalExpenses = filtered.filter(t => t.type === 'despesa' || t.type === 'parcelado').reduce((sum, t) => sum + t.value, 0);
    const netProfit = grossRevenue - operationalExpenses;
    const profitMargin = grossRevenue > 0 ? (netProfit / grossRevenue) * 100 : 0;

    const totalReceivable = receivables
        .filter(r => r.status === 'pending' || r.status === 'overdue')
        .reduce((sum, r) => sum + (r.value || 0), 0);

    const totalLiabilities = loans.filter(l => l.type === 'borrow' && l.status !== 'paid').reduce((a, b) => a + b.currentBalance, 0);

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
    receivables?: Receivable[],
    loans: Loan[] = []
): FinancialKPI[] => {
    if (workspace?.type === 'PJ') {
        return buildBusinessKPIs(transactions, range, receivables, loans);
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
            if (t.type === 'receita') {
                history[key].totalIncome += t.value;
            } else if (t.type === 'despesa' || t.type === 'parcelado') {
                history[key].totalExpenses += t.value;
            }
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
    const expenses = filtered.filter(t => t.type === 'despesa' || t.type === 'parcelado');
    const totalExpense = expenses.reduce((sum, t) => sum + t.value, 0);

    const byCategory: Record<string, number> = {};
    expenses.forEach(t => {
        byCategory[t.category] = (byCategory[t.category] || 0) + t.value;
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
    installments: [],
    payments: [],
};

const normalizeMoney = (value: number): number =>
    Math.round((value + Number.EPSILON) * 100) / 100;

const toIsoDate = (date: Date): string => date.toISOString().slice(0, 10);

const addDays = (isoDate: string, days: number): string => {
    const [year, month, day] = isoDate.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + days));

    return toIsoDate(date);
};

const isBetweenInclusive = (
    value: string,
    start: string,
    end: string,
): boolean => value >= start && value <= end;

const ACTIVE_INVOICE_STATUSES = new Set([
    'open',
    'closed',
    'partial_paid',
    'overdue',
]);

const ACTIVE_INSTALLMENT_STATUSES = new Set([
    'projected',
    'invoiced',
]);

const getCreditCardUsedLimit = (card: CreditCard): number => {
    if (typeof card.limitUsed === 'number') {
        return normalizeMoney(card.limitUsed);
    }

    if (typeof card.limitAvailable === 'number') {
        return normalizeMoney(Math.max(card.limitTotal - card.limitAvailable, 0));
    }

    return 0;
};

const getCreditCardAvailableLimit = (card: CreditCard): number => {
    if (typeof card.limitAvailable === 'number') {
        return normalizeMoney(card.limitAvailable);
    }

    return normalizeMoney(Math.max(card.limitTotal - getCreditCardUsedLimit(card), 0));
};

const sumInvoiceRemainingAmount = (
    invoices: CreditCardReportDomainData['invoices'],
): number =>
    normalizeMoney(
        invoices.reduce((sum, invoice) => sum + Number(invoice.remainingAmount || 0), 0)
    );

const sumPaymentAmount = (
    payments: CreditCardReportDomainData['payments'],
    status: 'posted' | 'reversed',
): number =>
    normalizeMoney(
        payments
            .filter((payment) => payment.status === status)
            .reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
    );

export const calculateCreditCardReportIndicators = (
    creditCards: CreditCard[],
    creditCardDomainData: CreditCardReportDomainData = EMPTY_CREDIT_CARD_REPORT_DOMAIN_DATA,
): CreditCardReportIndicator[] => {
    const today = toIsoDate(new Date());
    const next7Days = addDays(today, 7);
    const next15Days = addDays(today, 15);
    const next30Days = addDays(today, 30);

    return creditCards
        .filter((card) => card.status === 'active')
        .map((card) => {
            const cardInvoices = creditCardDomainData.invoices
                .filter((invoice) => String(invoice.cardId) === String(card.id));

            const activeInvoices = cardInvoices
                .filter((invoice) =>
                    ACTIVE_INVOICE_STATUSES.has(invoice.status) &&
                    Number(invoice.remainingAmount || 0) > 0
                )
                .sort((left, right) => left.dueDate.localeCompare(right.dueDate));

            const currentInvoice = activeInvoices[0];

            const futureInvoices = currentInvoice
                ? activeInvoices.filter((invoice) => invoice.id !== currentInvoice.id)
                : [];

            const invoiceIds = new Set(cardInvoices.map((invoice) => invoice.id));

            const projectedUnattachedInstallments = creditCardDomainData.installments
                .filter((installment) =>
                    String(installment.cardId) === String(card.id) &&
                    ACTIVE_INSTALLMENT_STATUSES.has(installment.status) &&
                    (!installment.invoiceId || !invoiceIds.has(installment.invoiceId)) &&
                    installment.dueDate >= today
                );

            const projectedUnattachedAmount = normalizeMoney(
                projectedUnattachedInstallments.reduce(
                    (sum, installment) => sum + Number(installment.amount || 0),
                    0,
                )
            );

            const openInvoiceBalance = currentInvoice
                ? normalizeMoney(Number(currentInvoice.remainingAmount || 0))
                : 0;

            const futureCommittedBalance = normalizeMoney(
                sumInvoiceRemainingAmount(futureInvoices) + projectedUnattachedAmount
            );

            const overdueAmount = sumInvoiceRemainingAmount(
                activeInvoices.filter((invoice) =>
                    invoice.status === 'overdue' || invoice.dueDate < today
                )
            );

            const dueNext7Days = sumInvoiceRemainingAmount(
                activeInvoices.filter((invoice) =>
                    isBetweenInclusive(invoice.dueDate, today, next7Days)
                )
            );

            const dueNext15Days = sumInvoiceRemainingAmount(
                activeInvoices.filter((invoice) =>
                    isBetweenInclusive(invoice.dueDate, today, next15Days)
                )
            );

            const dueNext30Days = sumInvoiceRemainingAmount(
                activeInvoices.filter((invoice) =>
                    isBetweenInclusive(invoice.dueDate, today, next30Days)
                )
            );

            const cardPayments = creditCardDomainData.payments
                .filter((payment) => String(payment.cardId) === String(card.id));

            const limitUsed = getCreditCardUsedLimit(card);
            const limitAvailable = getCreditCardAvailableLimit(card);
            const utilizationRate = card.limitTotal > 0
                ? (limitUsed / card.limitTotal) * 100
                : 0;

            return {
                cardId: String(card.id),
                cardName: card.name,
                status: card.status,

                limitTotal: card.limitTotal,
                limitUsed,
                limitAvailable,
                utilizationRate,

                openInvoiceBalance,
                futureCommittedBalance,
                overdueAmount,

                dueBuckets: {
                    next7Days: dueNext7Days,
                    next15Days: dueNext15Days,
                    next30Days: dueNext30Days,
                },

                registeredPaymentsAmount: sumPaymentAmount(cardPayments, 'posted'),
                reversedPaymentsAmount: sumPaymentAmount(cardPayments, 'reversed'),

                currentInvoiceId: currentInvoice?.id,
                currentInvoiceDueDate: currentInvoice?.dueDate,
                currentInvoiceStatus: currentInvoice?.status,
            };
        });
};


export const calculateDebtProfile = (
    _transactions: Transaction[],
    creditCards: CreditCard[],
    creditCardDomainData: CreditCardReportDomainData = EMPTY_CREDIT_CARD_REPORT_DOMAIN_DATA,
): DebtProfile => {
    const indicators = calculateCreditCardReportIndicators(
        creditCards,
        creditCardDomainData,
    );

    const totalLimit = indicators.reduce((sum, card) => sum + card.limitTotal, 0);
    const currentCardUsage = indicators.reduce((sum, card) => sum + card.limitUsed, 0);
    const totalAvailableLimit = indicators.reduce((sum, card) => sum + card.limitAvailable, 0);
    const openInvoiceBalance = indicators.reduce((sum, card) => sum + card.openInvoiceBalance, 0);
    const futureCommittedBalance = indicators.reduce((sum, card) => sum + card.futureCommittedBalance, 0);
    const overdueAmount = indicators.reduce((sum, card) => sum + card.overdueAmount, 0);
    const dueNext7Days = indicators.reduce((sum, card) => sum + card.dueBuckets.next7Days, 0);
    const dueNext15Days = indicators.reduce((sum, card) => sum + card.dueBuckets.next15Days, 0);
    const dueNext30Days = indicators.reduce((sum, card) => sum + card.dueBuckets.next30Days, 0);
    const registeredPaymentsAmount = indicators.reduce((sum, card) => sum + card.registeredPaymentsAmount, 0);
    const reversedPaymentsAmount = indicators.reduce((sum, card) => sum + card.reversedPaymentsAmount, 0);

    const utilizationRate = totalLimit > 0 ? (currentCardUsage / totalLimit) * 100 : 0;

    return {
        totalCreditCardDebt: normalizeMoney(currentCardUsage),
        totalLoans: 0,
        totalInstallments: normalizeMoney(futureCommittedBalance),
        utilizationRate,
        riskLevel: utilizationRate > 80 ? 'critico' : utilizationRate > 60 ? 'alto' : utilizationRate > 30 ? 'moderado' : 'baixo',

        creditCardTotalLimit: normalizeMoney(totalLimit),
        creditCardAvailableLimit: normalizeMoney(totalAvailableLimit),
        creditCardOpenInvoiceBalance: normalizeMoney(openInvoiceBalance),
        creditCardFutureCommittedBalance: normalizeMoney(futureCommittedBalance),
        creditCardOverdueAmount: normalizeMoney(overdueAmount),
        creditCardDueNext7Days: normalizeMoney(dueNext7Days),
        creditCardDueNext15Days: normalizeMoney(dueNext15Days),
        creditCardDueNext30Days: normalizeMoney(dueNext30Days),
        registeredInvoicePaymentsAmount: normalizeMoney(registeredPaymentsAmount),
        reversedInvoicePaymentsAmount: normalizeMoney(reversedPaymentsAmount),

        creditCardIndicators: indicators,
    };
};

const getRangeStartDate = (range: ReportTimeRange): Date | null => {
    const now = new Date();
    const startDate = new Date();

    switch (range) {
        case '7d':
            startDate.setDate(now.getDate() - 7);
            return startDate;
        case '30d':
            startDate.setDate(now.getDate() - 30);
            return startDate;
        case '90d':
            startDate.setDate(now.getDate() - 90);
            return startDate;
        case '12m':
            startDate.setFullYear(now.getFullYear() - 1);
            return startDate;
        case 'ytd':
            return new Date(now.getFullYear(), 0, 1);
        case 'all':
        default:
            return null;
    }
};

const isIsoDateInRange = (
    isoDate: string | undefined,
    range: ReportTimeRange,
): boolean => {
    if (!isoDate) return false;

    const startDate = getRangeStartDate(range);

    if (!startDate) return true;

    return new Date(`${isoDate}T12:00:00`) >= startDate;
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

export const calculateCreditCardExpenseReportViews = (
    creditCards: CreditCard[],
    creditCardDomainData: CreditCardReportDomainData = EMPTY_CREDIT_CARD_REPORT_DOMAIN_DATA,
    range: ReportTimeRange,
): CreditCardExpenseReportViews => {
    const cardNameById = new Map(
        creditCards.map((card) => [String(card.id), card.name])
    );

    const purchaseCompetenceByPeriod = new Map<string, CreditCardExpenseByPeriodItem>();

    creditCardDomainData.purchases
        .filter((purchase) =>
            purchase.status === 'active' &&
            isIsoDateInRange(purchase.purchaseDate, range)
        )
        .forEach((purchase) => {
            const period = purchase.purchaseDate.slice(0, 7);
            const current = purchaseCompetenceByPeriod.get(period) ?? {
                period,
                label: formatPeriodLabel(period),
                amount: 0,
                count: 0,
            };

            current.amount = normalizeMoney(current.amount + Number(purchase.totalAmount || 0));
            current.count += 1;

            purchaseCompetenceByPeriod.set(period, current);
        });

    const invoicePaymentDateByPeriod = new Map<string, CreditCardExpenseByPeriodItem>();

    creditCardDomainData.payments
        .filter((payment) =>
            payment.status === 'posted' &&
            isIsoDateInRange(payment.paymentDate, range)
        )
        .forEach((payment) => {
            const period = payment.paymentDate.slice(0, 7);
            const current = invoicePaymentDateByPeriod.get(period) ?? {
                period,
                label: formatPeriodLabel(period),
                amount: 0,
                count: 0,
            };

            current.amount = normalizeMoney(current.amount + Number(payment.amount || 0));
            current.count += 1;

            invoicePaymentDateByPeriod.set(period, current);
        });

    const indicators = calculateCreditCardReportIndicators(
        creditCards,
        creditCardDomainData,
    );

    const cardAnalytics = indicators.map((indicator) => {
        const cardPurchases = creditCardDomainData.purchases.filter(
            (purchase) =>
                String(purchase.cardId) === String(indicator.cardId) &&
                purchase.status === 'active' &&
                isIsoDateInRange(purchase.purchaseDate, range)
        );

        const cardPayments = creditCardDomainData.payments.filter(
            (payment) =>
                String(payment.cardId) === String(indicator.cardId) &&
                payment.status === 'posted' &&
                isIsoDateInRange(payment.paymentDate, range)
        );

        return {
            cardId: indicator.cardId,
            cardName: cardNameById.get(indicator.cardId) ?? indicator.cardName,
            purchaseAmount: normalizeMoney(
                cardPurchases.reduce((sum, purchase) => sum + Number(purchase.totalAmount || 0), 0)
            ),
            purchaseCount: cardPurchases.length,
            paidAmount: normalizeMoney(
                cardPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
            ),
            openInvoiceBalance: indicator.openInvoiceBalance,
            futureCommittedBalance: indicator.futureCommittedBalance,
            overdueAmount: indicator.overdueAmount,
            utilizationRate: indicator.utilizationRate,
        };
    });

    return {
        purchaseCompetence: sortPeriodItemsDesc(Array.from(purchaseCompetenceByPeriod.values())),
        invoicePaymentDate: sortPeriodItemsDesc(Array.from(invoicePaymentDateByPeriod.values())),
        cardAnalytics,
    };
};
export const calculateTopClients = (receivables: Receivable[], clients: Client[]): ClientMetric[] => {
    const byClient: Record<string, number> = {};
    let total = 0;
    receivables.forEach(r => {
        byClient[r.clientId] = (byClient[r.clientId] || 0) + (r.value || 0);
        total += (r.value || 0);
    });
    return Object.entries(byClient)
        .map(([id, value]) => ({
            clientId: id,
            clientName: clients.find(c => c.id === id)?.name || 'Cliente',
            totalValue: value,
            percentage: total > 0 ? (value / total) * 100 : 0
        }))
        .sort((a, b) => b.totalValue - a.totalValue).slice(0, 5);
};

export const calculateReceivablesStatus = (receivables: Receivable[]): ReceivableStatusMetric[] => {
    const map: Record<string, { count: number, total: number, color: string }> = {
        'pending': { count: 0, total: 0, color: '#f59e0b' },
        'paid': { count: 0, total: 0, color: '#10b981' },
        'overdue': { count: 0, total: 0, color: '#ef4444' }
    };
    receivables.forEach(r => {
        if (map[r.status]) {
            map[r.status].count++;
            map[r.status].total += (r.value || 0);
        }
    });
    return Object.entries(map).map(([k, v]) => ({ status: k, count: v.count, totalValue: v.total, color: v.color }));
};

export const generateAlerts = (
    kpis: FinancialKPI[],
    debt: DebtProfile,
    workspace?: Workspace,
    receivables?: Receivable[]
): FinancialAlert[] => {
    const alerts: FinancialAlert[] = [];
    const now = new Date().toISOString();

    if (workspace?.type === 'PJ') {
        const profitKPI = kpis.find(k => k.id === 'kpi-net-profit');
        if (profitKPI && profitKPI.value < 0) {
            alerts.push({ id: 'a1', title: 'Fluxo Negativo', message: 'Despesas superaram as receitas no período.', severity: 'critical', createdAt: now });
        }
        const overdue = receivables?.filter(r => r.status === 'overdue').length || 0;
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
