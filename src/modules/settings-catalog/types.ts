import type { Timestamp } from 'firebase/firestore';

export type SettingsCatalogGroup =
  | 'product_service'
  | 'expense_type'
  | 'category'
  | 'payment_method'
  | 'income_type'
  | 'cost_center'
  | 'investment_class'
  | 'investment_institution';

export type SettingsCatalogStatus = 'active' | 'inactive';

/**
 * Subtipos de `category` (D-23). A compra parcelada é do domínio de cartões
 * e usa categoria de despesa; não existe subtipo `parcelado`.
 */
export type SettingsCatalogTransactionSubtype =
  | 'receita'
  | 'despesa'
  | 'investimento';

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

/**
 * Intenção de criação enviada à callable (D-23). Escopo PF/PJ, nome
 * normalizado, chave de unicidade, autoria e datas são derivados pelo
 * backend e não fazem parte do contrato.
 */
export interface SettingsCatalogCreateInput {
  group: SettingsCatalogGroup;
  name: string;
  transactionSubtype?: SettingsCatalogTransactionSubtype;
  icon?: string | null;
  color?: string | null;
  stroke?: number | null;
  status?: SettingsCatalogStatus;
}
