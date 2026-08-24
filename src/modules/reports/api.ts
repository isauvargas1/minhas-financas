import { httpsCallable } from 'firebase/functions';
import { functions } from '../../lib/firebase';
import {
    FinancialReportSnapshot,
    ReportTimeRange,
    FinanceAIAnswer,
    FinancialAlert,
    CreditCardReportDomainData,
} from './types';
import {
    calculateKPIs,
    calculateCashFlow,
    calculateCategoryBreakdown,
    calculateDebtProfile,
    generateAlerts,
    calculateTopClients,
    calculateReceivablesStatus,
    calculateCreditCardExpenseReportViews,
} from './logic';
import { Transaction, Goal, CreditCard, Loan } from '../../types';
// CORRECTED IMPORT
import { Workspace } from '../workspaces/types';
import { Receivable, Client } from '../clients/types';
import { listLoans } from '../loans/api';
import type { OfficialInvestmentReportData } from '../investments/types';
import { buildInvestmentOverview } from './investments';

export const getFinancialReportSnapshot = async (
    transactions: Transaction[],
    goals: Goal[],
    creditCards: CreditCard[],
    range: ReportTimeRange = '30d',
    workspace?: Workspace,
    receivables?: Receivable[],
    clients?: Client[],
    creditCardDomainData?: CreditCardReportDomainData,
    officialInvestmentData?: OfficialInvestmentReportData,
): Promise<FinancialReportSnapshot> => {

    // Simulate network delay (optional)
    await new Promise(resolve => setTimeout(resolve, 600));

    // Load loans for context if workspace exists
    let loans: Loan[] = [];
    if (workspace?.id) {
        try {
            loans = await listLoans(workspace.id);
        } catch (error) {
            console.error("Error fetching loans:", error);
        }
    }

    const kpis = calculateKPIs(transactions, range, workspace, receivables, loans);
    const cashFlow = calculateCashFlow(transactions);
    const expenseCategories = calculateCategoryBreakdown(transactions, range);
    const debtProfile = calculateDebtProfile(
        transactions,
        creditCards,
        creditCardDomainData
    );

    const creditCardExpenseReportViews = calculateCreditCardExpenseReportViews(
    creditCards,
    creditCardDomainData,
    range
);

    const alerts = generateAlerts(kpis, debtProfile, workspace, receivables);
    const investmentOverview = officialInvestmentData
        ? buildInvestmentOverview(officialInvestmentData, range)
        : undefined;
    const effectiveKpis = investmentOverview
        ? kpis.map((kpi) => kpi.id === 'kpi-investments' ? {
            ...kpi,
            value: investmentOverview.contributions,
            formattedValue: new Intl.NumberFormat('pt-BR', {
                style: 'currency',
                currency: 'BRL',
            }).format(investmentOverview.contributions),
            description: 'Aportes liquidados no domínio patrimonial oficial.',
        } : kpi)
        : kpis;

    if (officialInvestmentData && !investmentOverview) {
        alerts.push({
            id: 'investment-report-projection-unavailable',
            title: 'Resumo patrimonial indisponível',
            message: 'A projeção patrimonial ainda não foi criada. Processe ou reconstrua uma posição antes de analisar este relatório.',
            severity: 'warning',
            createdAt: new Date().toISOString(),
        });
    }
    if (investmentOverview?.periodsTruncated) {
        alerts.push({
            id: 'investment-report-periods-truncated',
            title: 'Histórico patrimonial limitado',
            message: 'O histórico atingiu o limite seguro de leitura. Selecione um período menor para uma análise completa.',
            severity: 'warning',
            createdAt: new Date().toISOString(),
        });
    }
    if (investmentOverview && Math.abs(investmentOverview.reconciliationDifference) >= 0.01) {
        alerts.push({
            id: 'investment-report-reconciliation',
            title: 'Reconciliação patrimonial necessária',
            message: 'O resumo atual e a evolução histórica apresentam diferença. Solicite a reconstrução das projeções antes de tomar decisões.',
            severity: 'critical',
            createdAt: new Date().toISOString(),
        });
    }

        if (creditCardDomainData?.meta?.isTruncated) {
        const labels: Record<string, string> = {
            purchases: 'compras',
            invoices: 'faturas',
            installments: 'parcelas',
            payments: 'pagamentos',
        };

        const truncatedCollections = Object.entries(creditCardDomainData.meta.truncated)
            .filter(([, isTruncated]) => isTruncated)
            .map(([collection]) => labels[collection] ?? collection)
            .join(', ');

        alerts.push({
            id: 'credit-card-report-domain-truncated',
            title: 'Relatório de cartões limitado',
            message: `O relatório atingiu o limite de leitura para ${truncatedCollections}. Filtre um período menor para evitar dados incompletos.`,
            severity: 'warning',
            createdAt: new Date().toISOString(),
        });
    }

    let topClients = undefined;
    let receivablesStatus = undefined;

    if (workspace?.type === 'PJ' && receivables && clients) {
        topClients = calculateTopClients(receivables, clients);
        receivablesStatus = calculateReceivablesStatus(receivables);
    }

    return {
        generatedAt: new Date().toISOString(),
        periodLabel: mapRangeToLabel(range),
        kpis: effectiveKpis,
        cashFlow,
        expenseCategories,
        debtProfile,
        creditCardIndicators: debtProfile.creditCardIndicators,
        creditCardExpenseReportViews,
        investmentOverview,
        topClients,
        receivablesStatus,
        alerts
    };
};

export const getAvailableReportPeriods = (): { label: string, value: ReportTimeRange }[] => {
    return [
        { label: 'Últimos 7 dias', value: '7d' },
        { label: 'Últimos 30 dias', value: '30d' },
        { label: 'Últimos 3 meses', value: '90d' },
        { label: 'Último Ano', value: '12m' },
        { label: 'Ano Atual (YTD)', value: 'ytd' },
        { label: 'Todo o Período', value: 'all' },
    ];
};

export const markAlertAsRead = async (alertId: string): Promise<void> => {
    console.log(`Alert ${alertId} marked as read`);
};

/**
 * Análise por IA — executada exclusivamente no backend.
 *
 * O cliente Gemini já foi instanciado aqui, no navegador, com a chave vinda de
 * `VITE_GOOGLE_AI_KEY`. Variável `VITE_*` entra no bundle, então a credencial
 * ficava legível para qualquer visitante. Agora o navegador só envia a
 * pergunta e um resumo já agregado; a chave existe apenas no servidor.
 */
export const askFinanceAI = async (
    question: string,
    contextSnapshot: FinancialReportSnapshot,
    workspaceId: string,
): Promise<FinanceAIAnswer> => {
    const isPJ = contextSnapshot.kpis.some(k => k.id === 'kpi-net-profit');
    try {
        const callable = httpsCallable<Record<string, unknown>, {
            answer: string;
            createdAt: string;
        }>(functions, 'analyzeFinancialQuestion');
        const result = await callable({
            workspaceId,
            question,
            context: {
                profileType: isPJ ? 'PJ' : 'PF',
                periodLabel: contextSnapshot.periodLabel,
                kpis: contextSnapshot.kpis.map((kpi) => ({
                    label: kpi.label,
                    formattedValue: kpi.formattedValue,
                })),
                topCategories: contextSnapshot.expenseCategories
                    .slice(0, 5)
                    .map((c) => `${c.categoryName} (${c.percentageOfTotal.toFixed(1)}%)`),
                alerts: contextSnapshot.alerts.map(
                    (a) => `[${a.severity.toUpperCase()}] ${a.title}: ${a.message}`,
                ),
            },
        });
        return {
            id: Date.now().toString(),
            answer: result.data.answer,
            createdAt: result.data.createdAt,
        };
    } catch (error) {
        const code = typeof error === 'object' && error && 'code' in error
            ? String(error.code)
            : '';
        const answer = code.includes('failed-precondition')
            ? 'A análise por IA está indisponível no momento. Se o limite de uso foi atingido, tente novamente mais tarde.'
            : code.includes('permission-denied')
                ? 'Você não tem permissão para usar a análise por IA neste workspace.'
                : 'Não foi possível consultar a IA agora. Tente novamente mais tarde.';
        return {id: Date.now().toString(), answer, createdAt: new Date().toISOString()};
    }
};

const mapRangeToLabel = (range: ReportTimeRange): string => {
    const map: Record<ReportTimeRange, string> = {
        '7d': 'Últimos 7 dias',
        '30d': 'Últimos 30 dias',
        '90d': 'Últimos 3 meses',
        '12m': 'Últimos 12 meses',
        'ytd': 'Ano Atual',
        'all': 'Todo o Período'
    };
    return map[range];
};
