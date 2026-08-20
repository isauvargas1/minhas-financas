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
  | 'costCenters'
  | 'investmentTypes'
  | 'investmentClasses'
  | 'investmentRisks'
  | 'investmentLiquidity'
  | 'investmentIndexers'
  | 'investmentStrategies';

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
    title: 'Carteiras de caixa',
    shortTitle: 'Carteiras',
    description: 'Origens e destinos de caixa usados nos lançamentos. Contas de investimento são cadastradas separadamente.',
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
  },
  {
    key: 'investmentTypes', group: 'investment_type', title: 'Tipos de investimento', shortTitle: 'Tipos de investimento',
    description: 'Tipos customizáveis para classificar ativos, sem substituir o cadastro do ativo.', emptyTitle: 'Nenhum tipo de investimento cadastrado',
    emptyDescription: 'Crie um tipo para organizar os ativos do workspace.', searchPlaceholder: 'Buscar tipo de investimento', supportsTransactionSubtype: false, workspaceTypes: ['PF', 'PJ']
  },
  {
    key: 'investmentClasses', group: 'investment_class', title: 'Classes patrimoniais', shortTitle: 'Classes patrimoniais',
    description: 'Classes adequadas ao contexto PF ou PJ.', emptyTitle: 'Nenhuma classe patrimonial cadastrada',
    emptyDescription: 'Crie uma classe para estruturar o patrimônio.', searchPlaceholder: 'Buscar classe patrimonial', supportsTransactionSubtype: false, workspaceTypes: ['PF', 'PJ']
  },
  {
    key: 'investmentRisks', group: 'investment_risk', title: 'Níveis de risco', shortTitle: 'Risco',
    description: 'Níveis usados para comunicar o risco dos ativos.', emptyTitle: 'Nenhum nível de risco cadastrado',
    emptyDescription: 'Crie níveis de risco claros para o workspace.', searchPlaceholder: 'Buscar nível de risco', supportsTransactionSubtype: false, workspaceTypes: ['PF', 'PJ']
  },
  {
    key: 'investmentLiquidity', group: 'investment_liquidity', title: 'Liquidez', shortTitle: 'Liquidez',
    description: 'Prazos de disponibilidade dos recursos.', emptyTitle: 'Nenhum prazo de liquidez cadastrado',
    emptyDescription: 'Crie opções de liquidez para os ativos.', searchPlaceholder: 'Buscar liquidez', supportsTransactionSubtype: false, workspaceTypes: ['PF', 'PJ']
  },
  {
    key: 'investmentIndexers', group: 'investment_indexer', title: 'Indexadores', shortTitle: 'Indexadores',
    description: 'Referências de remuneração dos investimentos.', emptyTitle: 'Nenhum indexador cadastrado',
    emptyDescription: 'Crie os indexadores utilizados pelo workspace.', searchPlaceholder: 'Buscar indexador', supportsTransactionSubtype: false, workspaceTypes: ['PF', 'PJ']
  },
  {
    key: 'investmentStrategies', group: 'investment_strategy', title: 'Estratégias', shortTitle: 'Estratégias',
    description: 'Estratégias patrimoniais adequadas ao contexto PF ou PJ.', emptyTitle: 'Nenhuma estratégia cadastrada',
    emptyDescription: 'Crie estratégias para orientar a organização patrimonial.', searchPlaceholder: 'Buscar estratégia', supportsTransactionSubtype: false, workspaceTypes: ['PF', 'PJ']
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
