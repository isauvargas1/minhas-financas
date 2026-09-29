import { useState } from 'react';

import { useAuth } from '../../contexts/AuthContext';
import { workspaceErrorMessage } from '../workspaces/errors';
import { createBillingPortalSession, createCheckoutSession } from './api';
import type { PaidPlanId } from './types';

const CHECKOUT_FALLBACK = 'Não foi possível iniciar o pagamento. Tente novamente.';
const PORTAL_FALLBACK = 'Não foi possível abrir o gerenciamento da assinatura. Tente novamente.';

const errorCode = (error: unknown): string => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : 'desconhecido';
};

/** Ações de cobrança: redirecionam para o Checkout ou o portal do provedor. */
export const useBillingActions = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();

  const redirectTo = async (
    request: () => Promise<{ url: string }>,
    fallback: string,
  ) => {
    if (!user) {
      setError('Entre na sua conta para assinar um plano.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const { url } = await request();
      if (!url) throw new Error('url-ausente');
      window.location.assign(url);
    } catch (err) {
      console.error('Falha na ação de cobrança', errorCode(err));
      setError(workspaceErrorMessage(err, fallback));
    } finally {
      setIsLoading(false);
    }
  };

  const startCheckout = (planId: PaidPlanId) =>
    redirectTo(
      () => createCheckoutSession({ planId, returnUrl: window.location.origin }),
      CHECKOUT_FALLBACK,
    );

  const openPortal = () =>
    redirectTo(
      () => createBillingPortalSession({ returnUrl: window.location.origin }),
      PORTAL_FALLBACK,
    );

  return { startCheckout, openPortal, isLoading, error };
};
