import { normalizeSettingsCatalogName } from './utils';
import type {
  SettingsCatalogGroup,
  SettingsCatalogItem,
  SettingsCatalogTransactionSubtype
} from './types';

export type SettingsCatalogSectionKey =
  | 'productsServices'
  | 'expenseTypes'
  | 'categories'
  | 'paymentTypes'
  | 'incomeTypes'
  | 'wallets'
  | 'costCenters';

export interface SettingsCatalogSectionDefinition {
  key: SettingsCatalogSectionKey;
  group: SettingsCatalogGroup;
  title: string;
  shortTitle: string;
  description: string;
  emptyTitle: string;
  emptyDescription: string;
  searchPlaceholder: string;
  supportsTransactionSubtype: boolean;
  defaultTransactionSubtype?: SettingsCatalogTransactionSubtype;
  workspaceTypes: Array<'PF' | 'PJ'>;
}

export const SETTINGS_CATALOG_SECTION_LIST: SettingsCatalogSectionDefinition[] = [
  {
    key: 'productsServices',
    group: 'product_service',
    title: 'Produtos e serviços',
    shortTitle: 'Produtos',
    description: 'Catálogo base para descrições recorrentes e padronização de lançamentos.',
    emptyTitle: 'Nenhum produto ou serviço cadastrado',
    emptyDescription: 'Crie os itens mais usados para acelerar lançamentos e manter consistência.',
    searchPlaceholder: 'Buscar produto ou serviço',
    supportsTransactionSubtype: false,
    workspaceTypes: ['PF', 'PJ']
  },
  {
    key: 'expenseTypes',
    group: 'expense_type',
    title: 'Tipos de despesa',
    shortTitle: 'Despesas',
    description: 'Classificações auxiliares para detalhar gastos e melhorar relatórios.',
    emptyTitle: 'Nenhum tipo de despesa cadastrado',
    emptyDescription: 'Cadastre tipos de despesa para enriquecer filtros e análises.',
    searchPlaceholder: 'Buscar tipo de despesa',
    supportsTransactionSubtype: false,
    workspaceTypes: ['PF', 'PJ']
  },
  {
    key: 'categories',
    group: 'category',
    title: 'Categorias',
    shortTitle: 'Categorias',
    description: 'Categorias por tipo de transação para organizar receitas, despesas e investimentos.',
    emptyTitle: 'Nenhuma categoria cadastrada',
    emptyDescription: 'Crie categorias para estruturar o plano financeiro do workspace.',
    searchPlaceholder: 'Buscar categoria',
    supportsTransactionSubtype: true,
    defaultTransactionSubtype: 'despesa',
    workspaceTypes: ['PF', 'PJ']
  },
  {
    key: 'paymentTypes',
    group: 'payment_method',
    title: 'Formas de pagamento',
    shortTitle: 'Pagamentos',
    description: 'Métodos usados nos lançamentos, pagamentos e conciliações.',
    emptyTitle: 'Nenhuma forma de pagamento cadastrada',
    emptyDescription: 'Cadastre os meios de pagamento usados com frequência.',
    searchPlaceholder: 'Buscar forma de pagamento',
    supportsTransactionSubtype: false,
    workspaceTypes: ['PF', 'PJ']
  },
  {
    key: 'incomeTypes',
    group: 'income_type',
    title: 'Tipos de receita',
    shortTitle: 'Receitas',
    description: 'Classificações auxiliares para entradas e fontes de receita.',
    emptyTitle: 'Nenhum tipo de receita cadastrado',
    emptyDescription: 'Cadastre tipos de receita para detalhar a origem dos valores.',
    searchPlaceholder: 'Buscar tipo de receita',
    supportsTransactionSubtype: false,
    workspaceTypes: ['PF', 'PJ']
  },
  {
    key: 'wallets',
    group: 'wallet',
    title: 'Carteiras e contas',
    shortTitle: 'Carteiras',
    description: 'Locais de alocação financeira como conta, caixa, reserva ou carteira.',
    emptyTitle: 'Nenhuma carteira cadastrada',
    emptyDescription: 'Cadastre carteiras para organizar saldos e origem dos recursos.',
    searchPlaceholder: 'Buscar carteira',
    supportsTransactionSubtype: false,
    workspaceTypes: ['PF', 'PJ']
  },
  {
    key: 'costCenters',
    group: 'cost_center',
    title: 'Centros de custo',
    shortTitle: 'Centros',
    description: 'Estrutura gerencial para empresas acompanharem custos por área ou operação.',
    emptyTitle: 'Nenhum centro de custo cadastrado',
    emptyDescription: 'Cadastre centros de custo para análise gerencial do workspace PJ.',
    searchPlaceholder: 'Buscar centro de custo',
    supportsTransactionSubtype: false,
    workspaceTypes: ['PJ']
  }
];

export const getSettingsCatalogSectionByKey = (
  key: SettingsCatalogSectionKey
) => {
  return SETTINGS_CATALOG_SECTION_LIST.find((section) => section.key === key);
};

export const getSettingsCatalogSectionByGroup = (
  group: SettingsCatalogGroup
) => {
  return SETTINGS_CATALOG_SECTION_LIST.find((section) => section.group === group);
};

export const filterSectionsByWorkspaceType = (
  workspaceType?: 'PF' | 'PJ'
) => {
  if (!workspaceType) return SETTINGS_CATALOG_SECTION_LIST;
  return SETTINGS_CATALOG_SECTION_LIST.filter((section) =>
    section.workspaceTypes.includes(workspaceType)
  );
};

export const matchesSettingsCatalogSearch = (
  item: SettingsCatalogItem,
  search: string
) => {
  const normalizedSearch = normalizeSettingsCatalogName(search);

  if (!normalizedSearch) return true;

  return (
    item.normalizedName.includes(normalizedSearch) ||
    item.name.toLowerCase().includes(normalizedSearch) ||
    item.group.toLowerCase().includes(normalizedSearch)
  );
};

export const sortSettingsCatalogForDisplay = (
  items: SettingsCatalogItem[]
) => {
  return [...items].sort((a, b) => {
    if (a.status !== b.status) {
      return a.status === 'active' ? -1 : 1;
    }

    if (a.sortOrder !== b.sortOrder) {
      return a.sortOrder - b.sortOrder;
    }

    return a.name.localeCompare(b.name, 'pt-BR', {
      sensitivity: 'base'
    });
  });
};

export const buildSettingsCatalogStats = (items: SettingsCatalogItem[]) => {
  const total = items.length;
  const active = items.filter((item) => item.status === 'active').length;
  const inactive = total - active;

  return {
    total,
    active,
    inactive
  };
};