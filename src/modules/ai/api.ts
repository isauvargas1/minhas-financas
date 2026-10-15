import { httpsCallable } from 'firebase/functions';

import { functions } from '../../lib/firebase';
import { AI_CLIENT_TIMEOUT_MS, createAiCallables, type Invoke } from './callables';

const invoke: Invoke = async <TResult>(name: string, payload: Record<string, unknown>) =>
  (await httpsCallable<Record<string, unknown>, TResult>(functions, name, {
    timeout: AI_CLIENT_TIMEOUT_MS,
  })(payload)).data;

/** Callables de IA (contrato em `callables.ts`), ligadas ao SDK. */
export const {
  analyzeFinancialQuestion,
  extractTransactionFromText,
  extractTransactionFromDocument,
} = createAiCallables(invoke);
