import { httpsCallable } from 'firebase/functions';
import { functions } from '../../../lib/firebase';
import {
  investmentCorrelationId,
  investmentIdempotencyKey,
} from './intent';

export {
  intentDigest,
  investmentCorrelationId,
  investmentIdempotencyKey,
  newIntentNonce,
} from './intent';

export type CallablePayload = Record<string, unknown> & {
  workspaceId: string;
  idempotencyKey: string;
  correlationId: string;
};

export const callInvestment = async <T extends CallablePayload>(name: string, payload: T) => {
  const callable = httpsCallable<T, Record<string, unknown>>(functions, name);
  const normalized = Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  ) as T;
  return (await callable(normalized)).data;
};

/**
 * Monta o par de identificadores de uma chamada do domínio.
 *
 * `intentPayload` deve conter tudo que caracteriza a intenção financeira — e
 * nada que mude entre tentativas (nada de `Date.now()`, nada de UUID novo).
 */
export const investmentRequestIds = (
  operation: string,
  nonce: string,
  intentPayload: unknown,
) => ({
  idempotencyKey: investmentIdempotencyKey(operation, nonce, intentPayload),
  correlationId: investmentCorrelationId(),
});

export const onboardInvestmentWorkspace = async (workspaceId: string) => {
  // Onboarding é idempotente por workspace, não por intenção: semear duas
  // vezes é sempre a mesma operação.
  const requestId = `investment-onboarding-v1:${workspaceId}`;
  return callInvestment('onboardInvestmentWorkspace', {
    workspaceId,
    idempotencyKey: requestId,
    correlationId: investmentCorrelationId(),
  });
};
