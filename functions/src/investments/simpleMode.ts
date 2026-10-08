import * as admin from "firebase-admin";

import {
  catalogSeedDocumentId,
  settingsCatalogRef,
} from "../settingsCatalog/model";
import {
  INVESTMENT_CATEGORY_SEED_NAMES,
  type InvestmentCategorySeedName,
} from "../settingsCatalog/seeds";
import {ApplicationError} from "../shared/errors";
import {deterministicDocumentId} from "./infrastructure";

/**
 * Regime único do domínio patrimonial: por valor (D-15, P4-D).
 *
 * A experiência oferecida é a simples: o usuário informa quanto colocou e
 * quanto tirou, nunca quantidade ou preço unitário. Todo ativo nasce com
 * `trackingMode: "value"` (`createSimpleInvestment`) e não existe outro
 * regime — o cadastro quantitativo, a valoração a mercado e o resgate
 * detalhado saíram com a superfície profissional.
 *
 * A quantidade continua existindo no ledger porque a invariante de
 * encerramento em `applyPositionDeltas` a exige (quantidade zero com custo
 * diferente de zero é patrimônio fantasma). Ela é derivada do custo por uma
 * cota sintética de R$ 1,00 (`VALUE_MODE_MICROS_PER_CENT`):
 * `quantityMicros == principalCents * 10_000` é preservado por construção,
 * inclusive na retirada total, em que os dois zeram no mesmo movimento.
 */

/**
 * Micros de quantidade por centavo de custo, no regime por valor.
 *
 * 1 unidade sintética = R$ 1,00 de custo de aquisição. `quantityMicros` é
 * quantidade × 1e6 e `principalCents` é reais × 100, logo a razão é 1e6/100.
 */
export const VALUE_MODE_MICROS_PER_CENT = 10_000;

/** Ativo no regime por valor — o único do contrato. */
export const isValueModeAsset = (
  asset: admin.firestore.DocumentData | undefined,
): boolean => asset?.trackingMode === "value";

export const valueModeQuantityMicros = (principalCents: number): number => {
  const quantityMicros = principalCents * VALUE_MODE_MICROS_PER_CENT;
  if (!Number.isSafeInteger(quantityMicros)) {
    throw new ApplicationError(
      "domain_precondition_failed",
      "O valor informado excede a representação monetária permitida.",
    );
  }
  return quantityMicros;
};

/** Conta técnica de uma instituição: uma por item de catálogo, estável. */
export const institutionAccountId = (
  workspaceId: string,
  institutionId: string,
): string =>
  deterministicDocumentId("institution-account", workspaceId, institutionId);

export interface ResolvedCatalogItem {
  id: string;
  name: string;
}

/**
 * Que documentos do catálogo servem a um papel do formulário simples.
 *
 * A **categoria** do investimento é o catálogo genérico — `category` com
 * `transactionSubtype: "investimento"`, a mesma tela que organiza receita e
 * despesa (D-15, P4-D). Carteira de investimentos (`investment_class`) e
 * instituição (`investment_institution`) têm grupo próprio.
 */
export interface InvestmentCatalogSelector {
  /** Rótulo em pt-BR usado nas mensagens de recusa. */
  label: string;
  /** Grupo aceito. */
  groups: readonly string[];
  /**
   * Subtipo exigido quando o documento está no grupo genérico `category`.
   *
   * Só `category` carrega `transactionSubtype` — o catálogo
   * (`settingsCatalog/model.ts`) não o grava nos demais grupos —, então a
   * exigência se aplica a ele e a mais nenhum. É esta linha que impede uma
   * categoria de receita ou despesa de ser aceita como categoria de
   * investimento por um chamador forjado.
   */
  categoryTransactionSubtype?: string;
}

export const INVESTMENT_INSTITUTION_SELECTOR: InvestmentCatalogSelector = {
  label: "Instituição",
  groups: ["investment_institution"],
};

export const INVESTMENT_CLASS_SELECTOR: InvestmentCatalogSelector = {
  label: "Carteira de investimentos",
  groups: ["investment_class"],
};

/**
 * Categoria do investimento: só o catálogo genérico, recortado pelo subtipo.
 * Nenhuma equivalência por nome — a identidade é sempre o ID.
 */
export const INVESTMENT_CATEGORY_SELECTOR: InvestmentCatalogSelector = {
  label: "Categoria de investimento",
  groups: ["category"],
  categoryTransactionSubtype: "investimento",
};

/**
 * Tolerância explícita de item inativo, para **um** identificador.
 *
 * Cadastro inativo não serve a lançamento novo — é o que impede que uma
 * categoria aposentada volte a circular. Mas a correção de um pendente que
 * **já aponta** para esse item não é lançamento novo: o vínculo existe desde
 * antes da inativação, e exigir recategorização para corrigir uma data ou uma
 * descrição transformaria uma mudança de cadastro em perda operacional.
 *
 * A tolerância é sempre nominal e de tamanho um: quem a concede precisa
 * provar, dentro da mesma transação, de qual vínculo existente ela veio.
 * Nenhuma outra categoria inativa passa, e o grupo, o subtipo, o workspace e
 * o nome continuam sendo conferidos como em qualquer outra resolução.
 */
export interface InvestmentCatalogResolutionOptions {
  /** Identificador cuja inatividade é tolerada. Nenhum outro. */
  preservedInactiveItemId?: string;
}

/**
 * Resolve um item do catálogo do workspace, dentro da transação.
 *
 * O isolamento vem de duas camadas independentes: o caminho do documento já é
 * `workspaces/{workspaceId}/settings_catalog/{id}`, então um identificador de
 * outro tenant simplesmente não existe aqui; e o campo `workspaceId` do
 * documento é conferido, para que um documento gravado de forma incoerente
 * também seja recusado.
 */
export const resolveInvestmentCatalogItem = async (
  transaction: admin.firestore.Transaction,
  workspaceId: string,
  selector: InvestmentCatalogSelector,
  itemId: string,
  options?: InvestmentCatalogResolutionOptions,
): Promise<ResolvedCatalogItem> => {
  const snapshot = await transaction.get(
    settingsCatalogRef(workspaceId).doc(itemId),
  );
  const label = selector.label;
  if (!snapshot.exists) {
    throw new ApplicationError(
      "domain_precondition_failed",
      `${label} não encontrada no cadastro deste workspace.`,
    );
  }
  const data = snapshot.data() ?? {};
  if (data.workspaceId !== workspaceId) {
    throw new ApplicationError(
      "domain_precondition_failed",
      `${label} não pertence ao workspace autorizado.`,
    );
  }
  const group = typeof data.group === "string" ? data.group : "";
  if (!selector.groups.includes(group)) {
    throw new ApplicationError(
      "domain_precondition_failed",
      `O item informado não é uma ${label.toLowerCase()}.`,
    );
  }
  /*
   * Um item de `category` só serve se for do subtipo certo. Sem esta guarda,
   * o identificador de uma categoria de despesa — que o usuário vê e conhece
   * — seria aceito como categoria de investimento por qualquer chamador que
   * o enviasse.
   */
  const requiredSubtype = selector.categoryTransactionSubtype;
  if (
    group === "category" &&
    requiredSubtype !== undefined &&
    data.transactionSubtype !== requiredSubtype
  ) {
    throw new ApplicationError(
      "domain_precondition_failed",
      `A categoria informada não é do tipo ${requiredSubtype}.`,
    );
  }
  /*
   * A exceção é do vínculo já existente, e comparada contra o ID do próprio
   * documento lido — nunca contra o que o chamador pediu, e nunca por nome.
   */
  const preservesInactive =
    options?.preservedInactiveItemId !== undefined &&
    options.preservedInactiveItemId === snapshot.id;
  if (data.status !== "active" && !preservesInactive) {
    throw new ApplicationError(
      "domain_precondition_failed",
      `${label} inativa não pode ser usada em um novo lançamento.`,
    );
  }
  const name = typeof data.name === "string" ? data.name.trim() : "";
  if (name.length === 0) {
    throw new ApplicationError(
      "domain_precondition_failed",
      `${label} sem nome no cadastro.`,
    );
  }
  return {id: snapshot.id, name};
};

/**
 * Classificação técnica das categorias padrão de investimento.
 *
 * As categorias são semeadas pelo catálogo (`settingsCatalog/seeds.ts`, dono
 * da lista e dos IDs); aqui fica só o que Investimentos sabe sobre cada uma.
 * O tipo do registro exige uma classificação para cada nome semeado — uma
 * categoria padrão nova sem classificação não compila.
 */
const INVESTMENT_CATEGORY_ASSET_TYPES: Readonly<
  Record<InvestmentCategorySeedName, string>
> = {
  "Ações": "stock",
  "Fundos Imobiliários": "fund",
  "Tesouro Direto": "fixed_income",
  "CDB": "fixed_income",
  "Poupança": "fixed_income",
};

/**
 * Mapa de classificação técnica das categorias semeadas, pelo identificador
 * determinístico do item — nunca pelo rótulo.
 */
const SEEDED_ASSET_TYPE_BY_ITEM_ID = new Map<string, string>(
  INVESTMENT_CATEGORY_SEED_NAMES.map((name): [string, string] => [
    catalogSeedDocumentId("category", "investimento", "both", name),
    INVESTMENT_CATEGORY_ASSET_TYPES[name],
  ]),
);

/**
 * Classificação técnica do ativo a partir da categoria do catálogo.
 *
 * ## Por que não pelo nome
 *
 * O nome é mutável. Renomear "Ações" para "Bolsa brasileira" não pode
 * reclassificar o ativo, e uma categoria criada pelo usuário chamada "Ações"
 * não pode **ganhar** classificação só por causa do texto — seriam duas
 * formas de a autoridade técnica depender de um rótulo que o usuário edita
 * livremente. O vínculo é com o identificador do item, que nunca muda.
 *
 * ## Categorias personalizadas
 *
 * Caem em `"other"`. Uma categoria criada pelo usuário nasce com
 * identificador `cat_<hash>` (`catalogItemIdFor`), de prefixo distinto do
 * `seed_<hash>` das sementes, então ela nunca colide com o mapa. O catálogo
 * tampouco tem um campo estável de classificação técnica que o usuário
 * preencha, e inventar um não é opção: `"other"` é a
 * única resposta honesta, e a faixa de alocação por classe
 * (`investment_class`) não depende disso.
 *
 * A autoridade da categoria continua sendo `typeId`; `assetType` é apenas a
 * projeção técnica dela.
 */
export const assetTypeForCatalogItemId = (itemId: string): string =>
  SEEDED_ASSET_TYPE_BY_ITEM_ID.get(itemId) ?? "other";

export interface MovementPresentationSnapshot {
  institutionId?: string;
  institutionName?: string;
  classId?: string;
  className?: string;
  typeId?: string;
  typeName?: string;
  assetName?: string;
}

/**
 * Fotografia de apresentação gravada no movimento (Etapa 1, §10).
 *
 * A listagem simples precisa de instituição, carteira, categoria e nome do
 * ativo por linha. Resolvê-los na leitura custaria N leituras por página e
 * ainda mostraria o rótulo **atual** num histórico que já mudou de nome. Os
 * identificadores continuam sendo a autoridade; os nomes ficam congelados no
 * instante da escrita, exatamente como `className` já é fotografado no ativo.
 *
 * Não faz nenhuma leitura: consome os documentos de conta e ativo que a
 * operação já carregou.
 */
export const movementPresentationSnapshot = (
  account: admin.firestore.DocumentData | undefined,
  asset: admin.firestore.DocumentData | undefined,
): MovementPresentationSnapshot => {
  const snapshot: MovementPresentationSnapshot = {};
  const copy = <K extends keyof MovementPresentationSnapshot>(
    key: K,
    value: unknown,
  ) => {
    if (typeof value === "string" && value.length > 0) snapshot[key] = value;
  };
  copy("institutionId", account?.institutionId);
  copy("institutionName", account?.institutionName);
  copy("classId", asset?.classId);
  copy("className", asset?.className);
  copy("typeId", asset?.typeId);
  copy("typeName", asset?.typeName);
  copy("assetName", asset?.name);
  return snapshot;
};
