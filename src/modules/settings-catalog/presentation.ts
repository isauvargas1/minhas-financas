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
  | 'wallets'
  | 'costCenters'
  | 'investmentTypes'
  | 'investmentClasses'
  | 'investmentRisks'
  | 'investmentLiquidity'
  | 'investmentIndexers'
  | 'investmentStrategies'
  | 'investmentInstitutions';

/**
 * Onde a seção aparece.
 *
 * `common` é Configurações › Cadastros, o catálogo que o usuário do dia a dia
 * administra. `advanced` continua definida, tipada e consultável pelo domínio
 * e pelas telas profissionais — só não é oferecida na navegação comum, por um
 * de dois motivos: ou é vocabulário técnico que não pertence a quem entra ali
 * para renomear uma categoria (risco, liquidez, indexador, estratégia), ou é
 * um cadastro que foi **substituído** e permanece apenas para o histórico
 * (`investment_type`, hoje representado por Categorias › Investimentos).
 * Esconder não é remover: os grupos, os schemas e os documentos já gravados
 * seguem intactos, e o backend continua aceitando os identificadores antigos.
 */
export type SettingsCatalogSectionAudience = 'common' | 'advanced';

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
  audience: SettingsCatalogSectionAudience;
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
    workspaceTypes: ['PF', 'PJ'],
    audience: 'common'
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
    workspaceTypes: ['PF', 'PJ'],
    audience: 'common'
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
    workspaceTypes: ['PF', 'PJ'],
    audience: 'common'
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
    workspaceTypes: ['PF', 'PJ'],
    audience: 'common'
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
    workspaceTypes: ['PF', 'PJ'],
    audience: 'common'
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
    workspaceTypes: ['PF', 'PJ'],
    audience: 'common'
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
    workspaceTypes: ['PJ'],
    audience: 'common'
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
   * Os rótulos mudaram, os **grupos técnicos não**: `investment_class`
   * continua sendo `investment_class` e `investment_type` continua sendo
   * `investment_type`. Renomear campo técnico por causa de rótulo quebraria
   * todo documento já gravado e toda faixa de alocação já publicada.
   *
   * "Carteiras de investimento" não é "Carteiras de caixa": aquela classifica
   * o patrimônio, esta é onde o dinheiro do dia a dia circula. Os dois nomes
   * ficam por extenso justamente para não se confundirem na navegação.
   */
  {
    key: 'investmentClasses', group: 'investment_class', title: 'Carteiras de investimento', shortTitle: 'Carteiras de investimento',
    description: 'Para que serve cada investimento: aposentadoria, reserva de emergência, reserva de oportunidade, objetivos. Não confunda com as carteiras de caixa do dia a dia.',
    emptyTitle: 'Nenhuma carteira de investimento cadastrada',
    emptyDescription: 'Crie carteiras como Aposentadoria, Reserva de emergência ou Objetivos.',
    searchPlaceholder: 'Buscar carteira de investimento', supportsTransactionSubtype: false, workspaceTypes: ['PF', 'PJ'],
    audience: 'common'
  },
  {
    key: 'investmentInstitutions', group: 'investment_institution', title: 'Instituições', shortTitle: 'Instituições',
    description: 'Bancos e corretoras onde o dinheiro fica aplicado. A instituição é o vínculo estável do investimento: renomeá-la preserva todo o histórico.',
    emptyTitle: 'Nenhuma instituição cadastrada',
    emptyDescription: 'Cadastre as instituições usadas pelo workspace, como BTG, Banco do Brasil ou XP.',
    searchPlaceholder: 'Buscar instituição', supportsTransactionSubtype: false, workspaceTypes: ['PF', 'PJ'],
    audience: 'common'
  },
  /*
   * Cadastros técnicos e históricos, fora da navegação comum
   * (`audience: 'advanced'`).
   *
   * Continuam definidos, tipados e gravados: o domínio, as telas
   * profissionais e os documentos já existentes seguem íntegros. O que muda é
   * só o que Configurações › Cadastros oferece.
   *
   * `investment_type` está aqui por um motivo diferente dos outros quatro: ele
   * não é vocabulário técnico, é o cadastro **anterior** de categoria de
   * investimento. Todo ativo e todo movimento gravado antes da unificação
   * aponta para um item dele, o backend continua aceitando esses
   * identificadores e a listagem continua desenhando o chip a partir deles.
   * Esconder não é remover: oferecê-lo de novo como cadastro é que recriaria
   * as duas fontes.
   */
  {
    key: 'investmentTypes', group: 'investment_type', title: 'Categorias de investimento', shortTitle: 'Categorias de investimento',
    description: 'Cadastro anterior de categorias de investimento, preservado para o histórico. Novas categorias são criadas em Categorias › Investimentos.',
    emptyTitle: 'Nenhuma categoria de investimento cadastrada',
    emptyDescription: 'Cadastro histórico. Crie categorias novas em Categorias › Investimentos.',
    searchPlaceholder: 'Buscar categoria de investimento', supportsTransactionSubtype: false, workspaceTypes: ['PF', 'PJ'],
    audience: 'advanced'
  },
  {
    key: 'investmentRisks', group: 'investment_risk', title: 'Níveis de risco', shortTitle: 'Risco',
    description: 'Níveis usados para comunicar o risco dos ativos.', emptyTitle: 'Nenhum nível de risco cadastrado',
    emptyDescription: 'Crie níveis de risco claros para o workspace.', searchPlaceholder: 'Buscar nível de risco', supportsTransactionSubtype: false, workspaceTypes: ['PF', 'PJ'],
    audience: 'advanced'
  },
  {
    key: 'investmentLiquidity', group: 'investment_liquidity', title: 'Liquidez', shortTitle: 'Liquidez',
    description: 'Prazos de disponibilidade dos recursos.', emptyTitle: 'Nenhum prazo de liquidez cadastrado',
    emptyDescription: 'Crie opções de liquidez para os ativos.', searchPlaceholder: 'Buscar liquidez', supportsTransactionSubtype: false, workspaceTypes: ['PF', 'PJ'],
    audience: 'advanced'
  },
  {
    key: 'investmentIndexers', group: 'investment_indexer', title: 'Indexadores', shortTitle: 'Indexadores',
    description: 'Referências de remuneração dos investimentos.', emptyTitle: 'Nenhum indexador cadastrado',
    emptyDescription: 'Crie os indexadores utilizados pelo workspace.', searchPlaceholder: 'Buscar indexador', supportsTransactionSubtype: false, workspaceTypes: ['PF', 'PJ'],
    audience: 'advanced'
  },
  {
    key: 'investmentStrategies', group: 'investment_strategy', title: 'Estratégias', shortTitle: 'Estratégias',
    description: 'Estratégias patrimoniais adequadas ao contexto PF ou PJ.', emptyTitle: 'Nenhuma estratégia cadastrada',
    emptyDescription: 'Crie estratégias para orientar a organização patrimonial.', searchPlaceholder: 'Buscar estratégia', supportsTransactionSubtype: false, workspaceTypes: ['PF', 'PJ'],
    audience: 'advanced'
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

export const isCommonSettingsCatalogSection = (
  section: SettingsCatalogSectionDefinition
) => section.audience === 'common';

/**
 * Seções oferecidas em Configurações › Cadastros.
 *
 * A visibilidade é declarada na própria definição da seção, e não espalhada em
 * condições dentro da tela: quem acrescentar um cadastro novo decide ali mesmo
 * se ele pertence à experiência comum, e a tela continua só listando o que
 * recebe.
 */
export const listCommonSettingsCatalogSections = (
  workspaceType?: 'PF' | 'PJ'
) => filterSectionsByWorkspaceType(workspaceType)
  .filter(isCommonSettingsCatalogSection);

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
