import { useMemo } from 'react';

import { useWorkspace } from '../../contexts/WorkspaceContext.tsx';
import { categorySubtypeForTransactionType } from './callables';
import { useSettingsCatalog } from './hooks';
import { buildLegacyTransactionCatalogOptions } from './transactionFormAdapters';
import type { TransactionFormType } from '../../types.ts';

export const useTransactionCatalogOptions = (
  transactionType?: TransactionFormType | null
) => {
  const { activeWorkspace } = useWorkspace();

  const query = useSettingsCatalog({
    includeInactive: false,
  });

  const options = useMemo(() => {
    return buildLegacyTransactionCatalogOptions({
      items: query.data ?? [],
      workspaceType: activeWorkspace.type,
      // A aba Parcelado (compra no cartão) usa as categorias de despesa.
      transactionType: categorySubtypeForTransactionType(transactionType),
    });
  }, [query.data, activeWorkspace.type, transactionType]);

  return {
    ...query,
    options,
  };
};