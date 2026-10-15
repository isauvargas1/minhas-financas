import { httpsCallable } from 'firebase/functions';

import { functions } from '../../lib/firebase';
import {
    createReportCallables,
    reportErrorMessage,
    type FinancialReport,
    type GetFinancialReportPayload,
    type ReportInvoke,
} from './official';

const invoke: ReportInvoke = async <TResult>(name: string, payload: Record<string, unknown>) =>
    (await httpsCallable<Record<string, unknown>, TResult>(functions, name)(payload)).data;

/** Callables do relatório (contrato em `official.ts`), ligadas ao SDK. */
export const reportCallables = createReportCallables(invoke);

/** Lê o relatório oficial; a falha sobe já com a mensagem em pt-BR. */
export const fetchFinancialReport = async (
    payload: GetFinancialReportPayload,
): Promise<FinancialReport> => {
    try {
        return await reportCallables.getFinancialReport(payload);
    } catch (error) {
        throw new Error(reportErrorMessage(error));
    }
};
