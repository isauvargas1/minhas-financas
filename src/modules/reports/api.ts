
import { 
    FinancialReportSnapshot, 
    ReportTimeRange, 
    FinanceAIAnswer, 
    FinancialAlert 
} from './types.ts';
import { 
    calculateKPIs, 
    calculateCashFlow, 
    calculateCategoryBreakdown, 
    calculateDebtProfile, 
    generateAlerts,
    calculateTopClients,
    calculateReceivablesStatus 
} from './logic.ts';
import { Transaction, Goal, CreditCard, Loan } from '../../types.ts';
import { GoogleGenAI } from "@google/genai";
import { Workspace } from '../workspaces/types.ts';
import { Receivable, Client } from '../clients/types.ts';
import { listLoans } from '../loans/api.ts';

export const getFinancialReportSnapshot = async (
    transactions: Transaction[],
    goals: Goal[],
    creditCards: CreditCard[],
    range: ReportTimeRange = '30d',
    workspace?: Workspace,
    receivables?: Receivable[],
    clients?: Client[]
): Promise<FinancialReportSnapshot> => {
    
    await new Promise(resolve => setTimeout(resolve, 600));

    // Load loans for context if workspace exists
    let loans: Loan[] = [];
    if (workspace?.id) {
        loans = await listLoans(workspace.id);
    }

    // Fix: Removed creditCards argument to match the signature in logic.ts (expected 2-5 arguments)
    const kpis = calculateKPIs(transactions, range, workspace, receivables, loans);
    const cashFlow = calculateCashFlow(transactions);
    const expenseCategories = calculateCategoryBreakdown(transactions, range);
    const debtProfile = calculateDebtProfile(transactions, creditCards);
    
    // Fix: Removed goals, transactions, and loans arguments to match the signature in logic.ts (expected 2-4 arguments)
    const alerts = generateAlerts(kpis, debtProfile, workspace, receivables);

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
    
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
        throw new Error("API Key not found.");
    }

    const ai = new GoogleGenAI({ apiKey });
    const isPJ = contextSnapshot.kpis.some(k => k.id === 'kpi-net-profit');
    
    const kpiSummary = contextSnapshot.kpis.map(k => `${k.label}: ${k.formattedValue}`).join('; ');
    const topCategories = contextSnapshot.expenseCategories.slice(0, 5).map(c => `${c.categoryName} (${c.percentageOfTotal.toFixed(1)}%)`).join(', ');
    const alertsSummary = contextSnapshot.alerts.map(a => `[${a.severity.toUpperCase()}] ${a.title}: ${a.message}`).join('\n');
    
    const revenueVal = contextSnapshot.kpis.find(k => k.id === 'kpi-gross-revenue')?.value || 0;
    const profitVal = contextSnapshot.kpis.find(k => k.id === 'kpi-net-profit')?.value || 0;
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

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: question,
            config: {
                systemInstruction: systemPrompt,
                temperature: 0.6,
            }
        });

        return {
            id: Date.now().toString(),
            answer: response.text || "Não foi possível processar a análise.",
            createdAt: new Date().toISOString()
        };
    } catch (error) {
        throw new Error("Falha na consulta IA.");
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
