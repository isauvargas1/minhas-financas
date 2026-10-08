import * as admin from "firebase-admin";

import {
  catalogDedupeKey,
  catalogItemDocument,
  catalogLockDocument,
  catalogScopeFor,
  catalogSeedDocumentId,
  catalogUniqueLockIdFor,
  settingsCatalogRef,
  settingsCatalogUniquesRef,
  type CategoryTransactionSubtype,
  type SettingsCatalogGroup,
  type WorkspaceType,
} from "./model";

/**
 * Cadastros padrão de um workspace novo (D-23, P4-E).
 *
 * `provisionWorkspaceDefaults` chama `writeCatalogDefaults` na mesma transação
 * que cria o workspace: ou o workspace nasce com todos os padrões, ou nada é
 * gravado. Cada item nasce com a reserva do nome no mesmo commit, pelo mesmo
 * formato das callables, e com ID determinístico (`catalogSeedDocumentId`).
 * Só `create`: uma colisão aborta em vez de sobrescrever.
 */
export interface CatalogSeed {
  group: SettingsCatalogGroup;
  name: string;
  transactionSubtype?: CategoryTransactionSubtype;
}

const seedsOf = (
  names: readonly string[],
  seed: Omit<CatalogSeed, "name">,
): CatalogSeed[] => names.map((name) => ({...seed, name}));

/**
 * Categorias padrão de investimento (`category` com subtipo `investimento`).
 * Investimentos classifica cada uma pelo ID determinístico do item semeado,
 * nunca pelo nome (`investments/simpleMode.ts`).
 */
export const INVESTMENT_CATEGORY_SEED_NAMES = [
  "Ações",
  "Fundos Imobiliários",
  "Tesouro Direto",
  "CDB",
  "Poupança",
] as const;

export type InvestmentCategorySeedName =
  typeof INVESTMENT_CATEGORY_SEED_NAMES[number];

/**
 * Catálogo geral padrão: categorias de despesa, receita e investimento,
 * formas de pagamento e — só em PJ, pelo escopo do grupo — centros de custo.
 * A carteira de caixa não é item de catálogo (D-30): é a conta autoritativa
 * semeada por `writeDefaultCashAccount`.
 */
export const GENERAL_CATALOG_SEEDS: readonly CatalogSeed[] = [
  ...seedsOf(
    [
      "Alimentação", "Moradia", "Transporte", "Saúde", "Lazer", "Educação",
      "Utilidades",
    ],
    {group: "category", transactionSubtype: "despesa"},
  ),
  ...seedsOf(
    ["Salário", "Honorários", "Venda de Produto", "Reembolso", "Dividendos"],
    {group: "category", transactionSubtype: "receita"},
  ),
  ...seedsOf(INVESTMENT_CATEGORY_SEED_NAMES,
    {group: "category", transactionSubtype: "investimento"}),
  ...seedsOf(
    ["Dinheiro", "Cartão de Crédito", "Cartão de Débito", "Pix", "Boleto"],
    {group: "payment_method"},
  ),
  ...seedsOf(
    ["Operacional", "Comercial", "Administrativo"],
    {group: "cost_center"},
  ),
];

/**
 * Carteiras de investimento padrão (`investment_class`), por perfil (D-15).
 * A instituição é cadastrada pelo usuário; o workspace nasce sem conta,
 * ativo ou posição de investimento.
 */
export const INVESTMENT_CLASS_SEEDS: Readonly<
  Record<WorkspaceType, readonly string[]>
> = {
  PF: ["Reserva de emergência", "Aposentadoria", "Objetivos"],
  PJ: ["Caixa e liquidez", "Reserva operacional", "Expansão"],
};

/**
 * Sementes que valem para o tipo do workspace, com a ordenação de cada uma:
 * a posição na lista geral e, nas carteiras de investimento, a posição na
 * lista do perfil.
 */
export const catalogSeedsFor = (
  type: WorkspaceType,
): Array<CatalogSeed & {sortOrder: number}> => [
  ...GENERAL_CATALOG_SEEDS
    .filter((seed) => catalogScopeFor(seed.group, type) !== null)
    .map((seed, index) => ({...seed, sortOrder: (index + 1) * 10})),
  ...seedsOf(INVESTMENT_CLASS_SEEDS[type], {group: "investment_class"})
    .map((seed, index) => ({...seed, sortOrder: (index + 1) * 10})),
];

/** ID determinístico do item semeado para um tipo de workspace. */
export const catalogSeedItemIdFor = (
  seed: CatalogSeed,
  type: WorkspaceType,
): string => {
  const scope = catalogScopeFor(seed.group, type);
  if (!scope) throw new Error("Semente fora do escopo do workspace.");
  return catalogSeedDocumentId(
    seed.group, seed.transactionSubtype, scope, seed.name);
};

/** Grava os cadastros padrão (só `create`) e devolve quantos itens. */
export const writeCatalogDefaults = (
  transaction: admin.firestore.Transaction,
  input: {workspaceId: string; type: WorkspaceType; uid: string},
): number => {
  const seeds = catalogSeedsFor(input.type);
  for (const seed of seeds) {
    const scope = catalogScopeFor(seed.group, input.type);
    if (!scope) continue;
    const itemId = catalogSeedDocumentId(
      seed.group, seed.transactionSubtype, scope, seed.name);
    const dedupeKey = catalogDedupeKey(
      seed.group, seed.transactionSubtype, scope, seed.name);
    transaction.create(settingsCatalogRef(input.workspaceId).doc(itemId),
      catalogItemDocument({
        workspaceId: input.workspaceId,
        group: seed.group,
        name: seed.name,
        workspaceScope: scope,
        transactionSubtype: seed.transactionSubtype,
        sortOrder: seed.sortOrder,
        status: "active",
        actorUid: input.uid,
      }));
    transaction.create(
      settingsCatalogUniquesRef(input.workspaceId)
        .doc(catalogUniqueLockIdFor(dedupeKey)),
      catalogLockDocument({
        workspaceId: input.workspaceId,
        dedupeKey,
        catalogItemId: itemId,
        group: seed.group,
        actorUid: input.uid,
      }));
  }
  return seeds.length;
};
