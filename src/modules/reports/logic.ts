
import { Transaction, Goal, CreditCard, Loan } from '../../types.ts';
import {
    filterReversedCreditCardInvoicePaymentCashTransactions,
    isCreditCardInvoiceCompatibleTransaction,
    isLegacyCreditCardInstallmentTransaction,
} from '../credit-cards/compatibility';
import { Receivable, Client } from '../clients/types.ts';
import { Workspace } from '../workspaces/types.ts';
import { 
    ReportTimeRange, 
    FinancialReportSnapshot, 
    FinancialKPI, 
    CashFlowSummary, 
    ExpenseCategoryBreakdown, 
    DebtProfile, 
    FinancialAlert,
    ClientMetric,
    ReceivableStatusMetric
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
    const investment = filtered.filter(t => t.type === 'investimento').reduce((sum, t) => sum + t.value, 0);
    
    const netResult = income - expense - investment;
    const savingsRate = income > 0 ? (investment / income) * 100 : 0;

    return [
        {
            id: 'kpi-income',
            label: 'Receitas Totais',
            value: income,
            formattedValue: formatCurrency(income),
            trend: 'stable',
            period: 'custom'
        },
        {
            id: 'kpi-expenses',
            label: 'Despesas Totais',
            value: expense,
            formattedValue: formatCurrency(expense),
            trend: 'stable',
            period: 'custom'
        },
        {
            id: 'kpi-investments',
            label: 'Investimentos',
            value: investment,
            formattedValue: formatCurrency(investment),
            trend: 'stable',
            period: 'custom'
        },
        {
            id: 'kpi-balance',
            label: 'Resultado Líquido',
            value: netResult,
            formattedValue: formatCurrency(netResult),
            trend: netResult >= 0 ? 'up' : 'down',
            period: 'custom'
        },
        {
            id: 'kpi-savings',
            label: 'Taxa de Poupança',
            value: savingsRate,
            formattedValue: `${savingsRate.toFixed(1)}%`,
            trend: 'stable',
            period: 'custom',
            description: 'Percentual da renda investida'
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
            if (t.type === 'receita') {
                history[key].totalIncome += t.value;
            } else if (t.type === 'despesa' || t.type === 'parcelado' || t.type === 'investimento') {
                history[key].totalExpenses += t.value;
            }
        }
    });

    return Object.values(history).map(item => ({
        ...item,
        netCashFlow: item.totalIncome - item.totalExpenses,
        savingsRate: item.totalIncome > 0 ? ((item.totalIncome - item.totalExpenses) / item.totalIncome) * 100 : 0
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

const getCreditCardUsedLimit = (card: CreditCard): number => {
    if (typeof card.limitUsed === 'number') {
        return card.limitUsed;
    }

    if (typeof card.limitAvailable === 'number') {
        return Math.max(card.limitTotal - card.limitAvailable, 0);
    }

    return 0;
};

export const calculateDebtProfile = (_transactions: Transaction[], creditCards: CreditCard[]): DebtProfile => {
    const activeCards = creditCards.filter((card) => card.status === 'active');
    const currentCardUsage = activeCards.reduce(
        (sum, card) => sum + getCreditCardUsedLimit(card),
        0,
    );

    const totalLimit = activeCards.reduce((sum, card) => sum + card.limitTotal, 0);
    const utilizationRate = totalLimit > 0 ? (currentCardUsage / totalLimit) * 100 : 0;

    return {
        totalCreditCardDebt: currentCardUsage,
        totalLoans: 0,
        totalInstallments: 0,
        utilizationRate,
        riskLevel: utilizationRate > 80 ? 'critico' : utilizationRate > 60 ? 'alto' : utilizationRate > 30 ? 'moderado' : 'baixo'
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
