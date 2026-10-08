import { httpsCallable } from 'firebase/functions';

import { functions } from '../../lib/firebase';
import { createCashCallables, type CashInvoke } from './cashCallables';

const invoke: CashInvoke = async <TResult>(name: string, payload: Record<string, unknown>) =>
  (await httpsCallable<Record<string, unknown>, TResult>(functions, name)(payload)).data;

/** Callables de caixa (contrato em `cashCallables.ts`), ligadas ao SDK. */
export const {
  createCashTransaction,
  updateCashTransaction,
  confirmCashTransaction,
  voidCashTransaction,
} = createCashCallables(invoke);
