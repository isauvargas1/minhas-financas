import { httpsCallable } from 'firebase/functions';
import { functions } from '../../../lib/firebase';

export type CallablePayload = Record<string, unknown> & {
  workspaceId: string;
  idempotencyKey: string;
  correlationId: string;
};

export const investmentRequestIds = () => {
  const id = crypto.randomUUID();
  return { idempotencyKey: `investment-ui-${id}`, correlationId: `investment-ui-${id}` };
};

export const callInvestment = async <T extends CallablePayload>(name: string, payload: T) => {
  const callable = httpsCallable<T, Record<string, unknown>>(functions, name);
  const normalized = Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  ) as T;
  return (await callable(normalized)).data;
};
