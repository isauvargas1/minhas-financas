import { analyzeFinancialQuestion } from '../ai/api';
import { aiErrorMessage } from '../ai/callables';
import {
    FinancialReportSnapshot,
    ReportTimeRange,
    FinanceAIAnswer,
} from './types';

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

/**
 * Análise por IA — executada exclusivamente no backend (P5-E1).
 *
 * O navegador envia só o workspace, a pergunta, o período do relatório e a
 * chave de idempotência da intenção (gerada na confirmação de envio). Nenhum
 * valor financeiro sai daqui: o servidor lê o relatório oficial. A chave vem
 * do chamador para que uma repetição de transporte reuse a mesma intenção.
 */
export const askFinanceAI = async (
    question: string,
    contextSnapshot: FinancialReportSnapshot,
    workspaceId: string,
    idempotencyKey: string,
): Promise<FinanceAIAnswer> => {
    try {
        const result = await analyzeFinancialQuestion({
            workspaceId,
            question,
            range: contextSnapshot.range,
            idempotencyKey,
        });
        return {
            id: Date.now().toString(),
            answer: result.answer,
            createdAt: result.createdAt,
        };
    } catch (error) {
        return {
            id: Date.now().toString(),
            answer: aiErrorMessage(error),
            createdAt: new Date().toISOString(),
        };
    }
};
