import type { QueryClient } from '@tanstack/react-query';

/**
 * Prefixo de toda consulta do relatório financeiro oficial. Módulo sem SDK:
 * os módulos de domínio o importam para invalidar o relatório depois de uma
 * mutação financeira bem-sucedida.
 */
export const FINANCIAL_REPORT_KEY = 'financialReport';

export const financialReportKey = (
    uid: string,
    workspaceId: string,
    role: string,
    rangeKey: string,
    sectionsKey: string,
) => [FINANCIAL_REPORT_KEY, uid, workspaceId, role, rangeKey, sectionsKey] as const;

export const invalidateFinancialReports = (
    queryClient: Pick<QueryClient, 'invalidateQueries'>,
): Promise<void> => queryClient.invalidateQueries({ queryKey: [FINANCIAL_REPORT_KEY] });
