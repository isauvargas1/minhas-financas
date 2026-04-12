import type {
  SettingsCatalogGroup,
  SettingsCatalogTransactionSubtype,
  SettingsCatalogWorkspaceScope
} from './types';

export const SETTINGS_CATALOG_COLLECTION = 'settings_catalog';
export const SETTINGS_CATALOG_UNIQUES_COLLECTION = 'settings_catalog_uniques';

export const SETTINGS_CATALOG_DEFAULT_SORT_ORDER_STEP = 10;

export const SETTINGS_KEY_TO_CATALOG_GROUP = {
  productsServices: 'product_service',
  expenseTypes: 'expense_type',
  categories: 'category',
  paymentTypes: 'payment_method',
  incomeTypes: 'income_type',
  wallets: 'wallet',
  costCenters: 'cost_center'
} as const satisfies Record<string, SettingsCatalogGroup>;

export const SETTINGS_CATALOG_GROUP_CONFIG: Record<
  SettingsCatalogGroup,
  {
    workspaceScope: SettingsCatalogWorkspaceScope;
    requiresTransactionSubtype: boolean;
    allowedTransactionSubtypes: SettingsCatalogTransactionSubtype[];
  }
> = {
  product_service: {
    workspaceScope: 'both',
    requiresTransactionSubtype: false,
    allowedTransactionSubtypes: []
  },
  expense_type: {
    workspaceScope: 'both',
    requiresTransactionSubtype: false,
    allowedTransactionSubtypes: []
  },
  category: {
    workspaceScope: 'both',
    requiresTransactionSubtype: true,
    allowedTransactionSubtypes: ['receita', 'despesa', 'investimento', 'parcelado']
  },
  payment_method: {
    workspaceScope: 'both',
    requiresTransactionSubtype: false,
    allowedTransactionSubtypes: []
  },
  income_type: {
    workspaceScope: 'both',
    requiresTransactionSubtype: false,
    allowedTransactionSubtypes: []
  },
  wallet: {
    workspaceScope: 'both',
    requiresTransactionSubtype: false,
    allowedTransactionSubtypes: []
  },
  cost_center: {
    workspaceScope: 'PJ',
    requiresTransactionSubtype: false,
    allowedTransactionSubtypes: []
  }
};