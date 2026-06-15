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
import { GoogleGenerativeAI } from "@google/generative-ai";
import { Workspace } from '../workspaces/types';
import { Receivable, Client } from '../clients/types';
import { listLoans } from '../loans/api';

export const getFinancialReportSnapshot = async (
    transactions: Transaction[],
    goals: Goal[],
    creditCards: CreditCard[],
    range: ReportTimeRange = '30d',
    workspace?: Workspace,
    receivables?: Receivable[],
    clients?: Client[],
    creditCardDomainData?: CreditCardReportDomainData
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
        kpis,
        cashFlow,
        expenseCategories,
        debtProfile,
        creditCardIndicators: debtProfile.creditCardIndicators,
        creditCardExpenseReportViews,
        investmentOverview: undefined,
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

export const askFinanceAI = async (
    question: string,
    contextSnapshot: FinancialReportSnapshot
): Promise<FinanceAIAnswer> => {

    // Use VITE_ prefix for Vite environment variables if applicable, or fallback to process.env
    const apiKey = import.meta.env?.VITE_GOOGLE_AI_KEY || process.env.API_KEY;

    if (!apiKey) {
        console.warn("API Key not found. Please set VITE_GOOGLE_AI_KEY in .env");
        return {
            id: Date.now().toString(),
            answer: "Erro de configuração: Chave da IA não encontrada. Verifique suas variáveis de ambiente.",
            createdAt: new Date().toISOString()
        };
    }

    try {
        // CORRECTED INITIALIZATION
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

        const isPJ = contextSnapshot.kpis.some(k => k.id === 'kpi-net-profit');

        const kpiSummary = contextSnapshot.kpis.map(k => `${k.label}: ${k.formattedValue}`).join('; ');
        const topCategories = contextSnapshot.expenseCategories.slice(0, 5).map(c => `${c.categoryName} (${c.percentageOfTotal.toFixed(1)}%)`).join(', ');
        const alertsSummary = contextSnapshot.alerts.map(a => `[${a.severity.toUpperCase()}] ${a.title}: ${a.message}`).join('\n');

        const debtVal = contextSnapshot.kpis.find(k => k.id === 'kpi-debt-total')?.value || 0;
        const finExpVal = contextSnapshot.kpis.find(k => k.id === 'kpi-financial-exp')?.value || 0;

        const systemPrompt = `
            Contexto do Sistema:
            Você é uma IA integrada a um painel financeiro empresarial.
            
            ${isPJ ? `
            --- MODO CONSULTOR ESTRATÉGICO (PJ) ---
            Persona: CFO Virtual sênior focado em eficiência operacional e liquidez.
            
            Dados Financeiros da Empresa (Período: ${contextSnapshot.periodLabel}):
            - KPIs Principais: ${kpiSummary}
            - Endividamento Bancário Atual: R$ ${debtVal.toFixed(2)}
            - Despesas Financeiras (Juros Pagos): R$ ${finExpVal.toFixed(2)}
            - Maiores Saídas de Caixa: ${topCategories}
            - Alertas Críticos: ${alertsSummary || 'Estabilidade operacional detectada.'}

            Instruções de Análise PJ:
            1. Avalie se o lucro é suficiente para cobrir os juros da dívida.
            2. Analise a sustentabilidade do fluxo de caixa frente ao endividamento.
            3. Sugira estratégias de redução de alavancagem se o custo financeiro ultrapassar 5% da receita bruta.
            4. Fale sobre ROI, EBITDA, Liquidez Corrente e Alavancagem Financeira.
            ` : `
            --- MODO FINANÇAS PESSOAIS (PF) ---
            Persona: Consultor financeiro pessoal amigável.
            Resumo: ${kpiSummary}
            Alertas: ${alertsSummary || 'Nenhum.'}
            `}

            Pergunta do Usuário: "${question}"
            
            Responda em Markdown profissional. Use bullets para recomendações.
        `;

        const result = await model.generateContent([systemPrompt]); // Assuming question is part of the flow or separate
        // To include the user question explicitly if needed by the prompt logic:
        // const result = await model.generateContent([systemPrompt, question]); 

        // Note: The prompt construction above embeds the question, so sending just systemPrompt string is fine if it contains everything.

        const response = await result.response;
        const text = response.text();

        return {
            id: Date.now().toString(),
            answer: text || "Não foi possível processar a análise.",
            createdAt: new Date().toISOString()
        };
    } catch (error) {
        console.error("AI Error:", error);
        return {
            id: Date.now().toString(),
            answer: "Desculpe, ocorreu um erro ao consultar a IA. Tente novamente mais tarde.",
            createdAt: new Date().toISOString()
        };
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