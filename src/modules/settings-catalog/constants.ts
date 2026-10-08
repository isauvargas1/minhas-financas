import type {
  SettingsCatalogGroup,
  SettingsCatalogTransactionSubtype
} from './types';

/**
 * Coleção lida pelo cliente. As reservas de nome e a auditoria do catálogo
 * são internas do backend (D-23): o cliente não as conhece.
 */
export const SETTINGS_CATALOG_COLLECTION = 'settings_catalog';

export const SETTINGS_KEY_TO_CATALOG_GROUP = {
  productsServices: 'product_service',
  expenseTypes: 'expense_type',
  categories: 'category',
  paymentTypes: 'payment_method',
  incomeTypes: 'income_type',
  costCenters: 'cost_center'
} as const satisfies Record<string, SettingsCatalogGroup>;

/**
 * Forma de cada grupo no formulário. O escopo PF/PJ não está aqui: é
 * derivado pelo backend a partir do grupo e do tipo do workspace (D-23).
 */
export const SETTINGS_CATALOG_GROUP_CONFIG: Record<
  SettingsCatalogGroup,
  {
    requiresTransactionSubtype: boolean;
    allowedTransactionSubtypes: SettingsCatalogTransactionSubtype[];
  }
> = {
  product_service: {
    requiresTransactionSubtype: false,
    allowedTransactionSubtypes: []
  },
  expense_type: {
    requiresTransactionSubtype: false,
    allowedTransactionSubtypes: []
  },
  category: {
    requiresTransactionSubtype: true,
    allowedTransactionSubtypes: ['receita', 'despesa', 'investimento']
  },
  payment_method: {
    requiresTransactionSubtype: false,
    allowedTransactionSubtypes: []
  },
  income_type: {
    requiresTransactionSubtype: false,
    allowedTransactionSubtypes: []
  },
  cost_center: {
    requiresTransactionSubtype: false,
    allowedTransactionSubtypes: []
  },
  investment_class: { requiresTransactionSubtype: false, allowedTransactionSubtypes: [] },
  investment_institution: { requiresTransactionSubtype: false, allowedTransactionSubtypes: [] }
};
