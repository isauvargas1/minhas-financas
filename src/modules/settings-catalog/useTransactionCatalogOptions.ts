import { useMemo } from 'react';

import { useWorkspace } from '../../contexts/WorkspaceContext.tsx';
import { useSettingsCatalog } from './hooks';
import { buildLegacyTransactionCatalogOptions } from './transactionFormAdapters';
import type { TransactionType } from '../../types.ts';

export const useTransactionCatalogOptions = (
  transactionType?: TransactionType | null
) => {
  const { activeWorkspace } = useWorkspace();

  const query = useSettingsCatalog({
    includeInactive: false,
  });

  const options = useMemo(() => {
    return buildLegacyTransactionCatalogOptions({
      items: query.data ?? [],
      workspaceType: activeWorkspace.type,
      transactionType: transactionType ?? null,
    });
  }, [query.data, activeWorkspace.type, transactionType]);

  return {
    ...query,
    options,
  };
};