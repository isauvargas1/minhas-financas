import * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";

import {
  writeNewWorkspaceInvestmentDefaults,
} from "../investments/onboarding";
import {
  INVESTMENT_CATEGORY_SEEDS,
  catalogDedupeKey,
  legacyCatalogSeedDocumentId,
  normalizeCatalogName,
} from "../investments/simpleMode";
import {workspaceRef} from "../shared/workspaceAuth";

/**
 * Provisionamento de workspace novo (P1, PR-AUTH-03).
 *
 * `bootstrapAccount` e `createWorkspace` chamam `provisionWorkspaceDefaults`
 * **na mesma transação** que cria o workspace, o membership owner, o índice e
 * a auditoria. O workspace sai do backend já com os cadastros padrão; nada
 * depende de o cliente abrir, selecionar ou "preparar" o espaço depois.
 *
 * - Atomicidade: ou o workspace existe com todos os padrões, ou nada foi
 *   gravado. Uma falha de provisionamento aborta a criação e a callable
 *   responde com erro — nunca com sucesso parcial.
 * - Retry e concorrência: herdados da transação de criação. `createWorkspace`
 *   devolve o resultado salvo pela idempotência; `bootstrapAccount` disputa
 *   `users/{uid}` e a perdedora encontra o workspace já criado.
 * - Sem leituras: o ID do workspace acabou de ser gerado. Todas as escritas
 *   são `transaction.create`; uma colisão aborta em vez de sobrescrever.
 *
 * Volume: no pior caso (PJ) são 50 itens de catálogo e 50 chaves de
 * unicidade, mais conta e ativo de investimento — cerca de 110 escritas com
 * as da criação, abaixo do limite de 500 por transação.
 */

type WorkspaceType = "PF" | "PJ";

interface GeneralCatalogSeed {
  group: "category" | "payment_method" | "wallet" | "cost_center";
  name: string;
  transactionSubtype?: "despesa" | "receita" | "investimento";
  workspaceScope: "both" | "PJ";
}

/**
 * Catálogo geral padrão: categorias, formas de pagamento, carteiras de caixa
 * e, só em PJ, centros de custo.
 *
 * As categorias de investimento vêm de `INVESTMENT_CATEGORY_SEEDS`, a mesma
 * lista que dá a classificação técnica de cada uma: o ID determinístico
 * semeado aqui é o que o domínio de investimentos procura.
 */
const seedsOf = (
  names: readonly string[],
  seed: Omit<GeneralCatalogSeed, "name">,
): GeneralCatalogSeed[] => names.map((name) => ({...seed, name}));

export const GENERAL_CATALOG_SEEDS: readonly GeneralCatalogSeed[] = [
  ...seedsOf(
    [
      "Alimentação", "Moradia", "Transporte", "Saúde", "Lazer", "Educação",
      "Utilidades",
    ],
    {group: "category", transactionSubtype: "despesa", workspaceScope: "both"},
  ),
  ...seedsOf(
    ["Salário", "Honorários", "Venda de Produto", "Reembolso", "Dividendos"],
    {group: "category", transactionSubtype: "receita", workspaceScope: "both"},
  ),
  ...seedsOf(
    INVESTMENT_CATEGORY_SEEDS.map(({name}) => name),
    {
      group: "category",
      transactionSubtype: "investimento",
      workspaceScope: "both",
    },
  ),
  ...seedsOf(
    ["Dinheiro", "Cartão de Crédito", "Cartão de Débito", "Pix", "Boleto"],
    {group: "payment_method", workspaceScope: "both"},
  ),
  ...seedsOf(
    [
      "Carteira Principal", "Reserva de Emergência", "Investimentos Nubank",
      "Binance",
    ],
    {group: "wallet", workspaceScope: "both"},
  ),
  ...seedsOf(
    ["Operacional", "Comercial", "Administrativo"],
    {group: "cost_center", workspaceScope: "PJ"},
  ),
];

/** Catálogo geral padrão de um workspace recém-criado (só `create`). */
export const writeGeneralCatalogDefaults = (
  transaction: admin.firestore.Transaction,
  input: {workspaceId: string; type: WorkspaceType; uid: string},
): number => {
  const catalog = workspaceRef(input.workspaceId);
  const seeds = GENERAL_CATALOG_SEEDS.filter(
    (seed) => seed.workspaceScope === "both" || input.type === "PJ",
  );
  seeds.forEach((seed, index) => {
    const dedupeKey = catalogDedupeKey(
      seed.group, seed.transactionSubtype, seed.workspaceScope, seed.name,
    );
    const itemId = legacyCatalogSeedDocumentId(
      seed.group, seed.transactionSubtype, seed.workspaceScope, seed.name,
    );
    const normalizedName = normalizeCatalogName(seed.name);
    const stamp = {
      createdBy: input.uid,
      updatedBy: input.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    transaction.create(catalog.collection("settings_catalog").doc(itemId), {
      workspaceId: input.workspaceId,
      group: seed.group,
      name: seed.name,
      normalizedName,
      dedupeKey,
      workspaceScope: seed.workspaceScope,
      ...(seed.transactionSubtype ?
        {transactionSubtype: seed.transactionSubtype} :
        {}),
      sortOrder: (index + 1) * 10,
      status: "active",
      ...stamp,
    });
    transaction.create(
      catalog.collection("settings_catalog_uniques").doc(dedupeKey),
      {
        dedupeKey,
        catalogItemId: itemId,
        workspaceId: input.workspaceId,
        group: seed.group,
        normalizedName,
        ...stamp,
      },
    );
  });
  return seeds.length;
};

export interface WorkspaceProvisioningSummary {
  catalogItemCount: number;
  investmentAccountId: string;
  investmentAssetId: string;
}

/** Grava os padrões obrigatórios de um workspace recém-criado. */
export const provisionWorkspaceDefaults = (
  transaction: admin.firestore.Transaction,
  input: {workspaceId: string; type: WorkspaceType; uid: string},
): WorkspaceProvisioningSummary => {
  const generalCount = writeGeneralCatalogDefaults(transaction, input);
  const investments = writeNewWorkspaceInvestmentDefaults(transaction, {
    workspaceId: input.workspaceId,
    profileType: input.type,
    uid: input.uid,
  });
  return {
    catalogItemCount: generalCount + investments.catalogItemCount,
    investmentAccountId: investments.accountId,
    investmentAssetId: investments.assetId,
  };
};
