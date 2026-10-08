import { normalizeSettingsCatalogName } from './utils.ts';
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
  | 'costCenters'
  | 'investmentClasses'
  | 'investmentInstitutions';

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
  /*
   * Cadastros de investimento do usuário comum (Etapa 2, §3).
   *
   * São dois: a carteira de investimento e a instituição. A **categoria** não
   * está aqui — ela é cadastrada em `Categorias`, na aba "Investimentos", pelo
   * mesmo caminho de receita e despesa. Havia dois cadastros de categoria de
   * investimento na navegação comum, ambos semeados no primeiro acesso, e só
   * um deles chegava a algum formulário; a fonte visível passou a ser uma só.
   *
   * "Carteiras de investimento" não é a carteira de caixa: aquela classifica
   * o patrimônio, esta é onde o dinheiro do dia a dia circula — hoje a conta
   * autoritativa de Configurações › Contas e carteiras (D-30, P3-J), fora do
   * catálogo.
   */
  {
    key: 'investmentClasses', group: 'investment_class', title: 'Carteiras de investimento', shortTitle: 'Carteiras de investimento',
    description: 'Para que serve cada investimento: aposentadoria, reserva de emergência, reserva de oportunidade, objetivos. Não confunda com as carteiras de caixa do dia a dia.',
    emptyTitle: 'Nenhuma carteira de investimento cadastrada',
    emptyDescription: 'Crie carteiras como Aposentadoria, Reserva de emergência ou Objetivos.',
    searchPlaceholder: 'Buscar carteira de investimento', supportsTransactionSubtype: false, workspaceTypes: ['PF', 'PJ']
  },
  {
    key: 'investmentInstitutions', group: 'investment_institution', title: 'Instituições', shortTitle: 'Instituições',
    description: 'Bancos e corretoras onde o dinheiro fica aplicado. A instituição é o vínculo estável do investimento: renomeá-la preserva todo o histórico.',
    emptyTitle: 'Nenhuma instituição cadastrada',
    emptyDescription: 'Cadastre as instituições usadas pelo workspace, como BTG, Banco do Brasil ou XP.',
    searchPlaceholder: 'Buscar instituição', supportsTransactionSubtype: false, workspaceTypes: ['PF', 'PJ']
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

/** Seções oferecidas em Configurações › Cadastros, pelo perfil PF/PJ. */
export const listCommonSettingsCatalogSections = (
  workspaceType?: 'PF' | 'PJ'
) => filterSectionsByWorkspaceType(workspaceType);

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
