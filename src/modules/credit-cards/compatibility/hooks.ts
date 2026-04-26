import { useQuery } from '@tanstack/react-query';

import {
  listCreditCardInvoiceViewsForExpenseCompatibility,
} from '../persistence/readApi.ts';

import {
  buildCreditCardInvoiceTransactionProjections,
} from './transactionProjection.ts';

const isWorkspaceReady = (workspaceId: string): boolean =>
  Boolean(workspaceId) && workspaceId !== 'loading';

export const CREDIT_CARD_COMPATIBILITY_KEYS = {
  invoiceTransactionProjections: (workspaceId: string) =>
    ['creditCardInvoiceTransactionProjections', workspaceId] as const,
};

export const useCreditCardInvoiceTransactionProjections = (
  workspaceId: string
) =>
  useQuery({
    queryKey: CREDIT_CARD_COMPATIBILITY_KEYS.invoiceTransactionProjections(workspaceId),
    queryFn: async () => {
      const invoiceViews = await listCreditCardInvoiceViewsForExpenseCompatibility(
        workspaceId,
        { limit: 200 }
      );

      return buildCreditCardInvoiceTransactionProjections(invoiceViews);
    },
    enabled: isWorkspaceReady(workspaceId),
    staleTime: 1000 * 60 * 5,
  });