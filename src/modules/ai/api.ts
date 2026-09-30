import { httpsCallable } from 'firebase/functions';

import { functions } from '../../lib/firebase';
import { createAiCallables, type Invoke } from './callables';

const invoke: Invoke = async <TResult>(name: string, payload: Record<string, unknown>) =>
  (await httpsCallable<Record<string, unknown>, TResult>(functions, name)(payload)).data;

/** Callables de IA (contrato em `callables.ts`), ligadas ao SDK. */
export const {
  analyzeFinancialQuestion,
  extractTransactionFromText,
  extractTransactionFromDocument,
} = createAiCallables(invoke);
