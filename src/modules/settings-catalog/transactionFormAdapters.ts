import type { EntityItem, WorkspaceType } from '../../types.ts';
import type {
  SettingsCatalogItem,
  SettingsCatalogTransactionSubtype,
} from './types';

export interface LegacyTransactionCatalogOptions {
  productsServices: EntityItem[];
  settingsCategories: EntityItem[];
  wallets: EntityItem[];
  expenseTypes: EntityItem[];
  paymentTypes: EntityItem[];
  incomeTypes: EntityItem[];
  costCenters: EntityItem[];
}

const isVisibleForWorkspaceType = (
  item: SettingsCatalogItem,
  workspaceType?: WorkspaceType
) => {
  if (!workspaceType) return true;
  if (item.workspaceScope === 'both') return true;
  return item.workspaceScope === workspaceType;
};

const stableNumericIdFromString = (value: string): number => {
  let hash = 0;

  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }

  return Math.abs(hash) || 1;
};

const toLegacyEntityItem = (item: SettingsCatalogItem): EntityItem => {
  return {
    id: stableNumericIdFromString(item.id),
    name: item.name,
    type: item.transactionSubtype,
    icon: item.icon,
    iconColor: item.color,
    iconStroke: item.stroke,
  };
};

const toLegacyWalletEntityItem = (item: SettingsCatalogItem): EntityItem => {
  return {
    id: stableNumericIdFromString(item.id),
    name: item.name,
    icon: item.icon,
    iconColor: item.color,
    iconStroke: item.stroke,
  };
};

export const buildLegacyTransactionCatalogOptions = (params: {
  items: SettingsCatalogItem[];
  workspaceType?: WorkspaceType;
  transactionType?: SettingsCatalogTransactionSubtype | null;
}): LegacyTransactionCatalogOptions => {
  const { items, workspaceType, transactionType } = params;

  const visibleItems = items.filter((item) =>
    isVisibleForWorkspaceType(item, workspaceType)
  );

  const activeItems = visibleItems.filter((item) => item.status === 'active');

  const productsServices = activeItems
    .filter((item) => item.group === 'product_service')
    .map(toLegacyEntityItem);

  const settingsCategories = activeItems
    .filter(
      (item) =>
        item.group === 'category' &&
        (!transactionType || item.transactionSubtype === transactionType)
    )
    .map(toLegacyEntityItem);

  const wallets = activeItems
    .filter((item) => item.group === 'wallet')
    .map(toLegacyWalletEntityItem);

  const expenseTypes = activeItems
    .filter((item) => item.group === 'expense_type')
    .map(toLegacyEntityItem);

  const paymentTypes = activeItems
    .filter((item) => item.group === 'payment_method')
    .map(toLegacyEntityItem);

  const incomeTypes = activeItems
    .filter((item) => item.group === 'income_type')
    .map(toLegacyEntityItem);

  const costCenters = activeItems
    .filter(
      (item) =>
        item.group === 'cost_center' &&
        (workspaceType === 'PJ' || item.workspaceScope === 'both')
    )
    .map(toLegacyEntityItem);

  return {
    productsServices,
    settingsCategories,
    wallets,
    expenseTypes,
    paymentTypes,
    incomeTypes,
    costCenters,
  };
};