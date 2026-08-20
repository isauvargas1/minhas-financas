import type { Timestamp } from 'firebase/firestore';

export type SettingsCatalogGroup =
  | 'product_service'
  | 'expense_type'
  | 'category'
  | 'payment_method'
  | 'income_type'
  | 'wallet'
  | 'cost_center'
  | 'investment_type'
  | 'investment_class'
  | 'investment_risk'
  | 'investment_liquidity'
  | 'investment_indexer'
  | 'investment_strategy';

export type SettingsCatalogStatus = 'active' | 'inactive';

export type SettingsCatalogTransactionSubtype =
  | 'receita'
  | 'despesa'
  | 'investimento'
  | 'parcelado';

export type SettingsCatalogWorkspaceScope = 'PF' | 'PJ' | 'both';

export interface SettingsCatalogItem {
  id: string;
  workspaceId: string;
  group: SettingsCatalogGroup;
  name: string;
  normalizedName: string;
  dedupeKey: string;
  workspaceScope: SettingsCatalogWorkspaceScope;
  transactionSubtype?: SettingsCatalogTransactionSubtype;
  icon?: string;
  color?: string;
  stroke?: number;
  sortOrder: number;
  status: SettingsCatalogStatus;
  createdBy: string;
  updatedBy: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface SettingsCatalogListFilters {
  group?: SettingsCatalogGroup;
  transactionSubtype?: SettingsCatalogTransactionSubtype;
  workspaceScope?: SettingsCatalogWorkspaceScope;
  includeInactive?: boolean;
}

export interface SettingsCatalogPageCursor {
  sortOrder: number;
  normalizedName: string;
  id: string;
}

export interface SettingsCatalogPage {
  items: SettingsCatalogItem[];
  nextCursor: SettingsCatalogPageCursor | null;
}

export interface SettingsCatalogCreateInput {
  group: SettingsCatalogGroup;
  name: string;
  transactionSubtype?: SettingsCatalogTransactionSubtype;
  workspaceScope?: SettingsCatalogWorkspaceScope;
  icon?: string | null;
  color?: string | null;
  stroke?: number | null;
  sortOrder?: number;
  status?: SettingsCatalogStatus;
}

export interface SettingsCatalogUpdateInput {
  name?: string;
  icon?: string | null;
  color?: string | null;
  stroke?: number | null;
  sortOrder?: number;
  status?: SettingsCatalogStatus;
}

export interface SettingsCatalogUniqueLock {
  dedupeKey: string;
  catalogItemId: string;
  workspaceId: string;
  group: SettingsCatalogGroup;
  normalizedName: string;
  createdBy: string;
  updatedBy: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}
