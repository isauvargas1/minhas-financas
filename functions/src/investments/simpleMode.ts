import * as admin from "firebase-admin";

import {CreditCardApplicationError} from "../creditCards/errors";
import {deterministicDocumentId, sha256} from "./infrastructure";
import {investmentWorkspaceRef} from "./paths";

/**
 * Modo simples do domínio patrimonial (Etapa 1 da reestruturação).
 *
 * O domínio nasceu quantitativo: toda posição tem `quantityMicros` e todo
 * aporte precisa informá-la. Isso é correto para quem acompanha cotas e preço
 * unitário, e é ruído puro para quem só quer saber quanto colocou e quanto
 * tirou. A UX simples precisa operar **por valor**.
 *
 * A separação escolhida é a menor possível: um campo tipado no ativo,
 * `trackingMode`, com duas leituras:
 *
 * - `"quantity"` — regime histórico. Quantidade e preço são informados pelo
 *   chamador; valoração a mercado é permitida. É o **default de ausência**,
 *   então todo ativo já gravado continua exatamente como estava.
 * - `"value"` — regime monetário. A quantidade nunca vem do chamador: é
 *   derivada do custo por uma cota sintética de R$ 1,00
 *   (`VALUE_MODE_MICROS_PER_CENT`), e valoração quantitativa é recusada.
 *
 * Por que uma cota sintética em vez de largar `quantityMicros` em zero: o
 * domínio tem uma invariante de encerramento em `applyPositionDeltas` —
 * quantidade zero com custo diferente de zero é patrimônio fantasma e é
 * rejeitada. Um regime por valor precisa, portanto, de **alguma** quantidade
 * que se mova junto com o custo. Amarrá-la ao próprio custo mantém a
 * proporcionalidade exata em qualquer sequência de aportes e resgates:
 * `quantityMicros == principalCents * 10_000` é preservado por construção,
 * inclusive no resgate total, em que os dois zeram no mesmo movimento.
 */

export type InvestmentTrackingMode = "value" | "quantity";

/**
 * Micros de quantidade por centavo de custo, no regime por valor.
 *
 * 1 unidade sintética = R$ 1,00 de custo de aquisição. `quantityMicros` é
 * quantidade × 1e6 e `principalCents` é reais × 100, logo a razão é 1e6/100.
 */
export const VALUE_MODE_MICROS_PER_CENT = 10_000;

/**
 * Regime do ativo, com ausência valendo `"quantity"`.
 *
 * Retrocompatibilidade não é opcional aqui: todo ativo gravado antes desta
 * etapa não tem o campo, e interpretá-lo como regime por valor reescreveria o
 * significado da quantidade já persistida em posições reais.
 */
export const assetTrackingMode = (
  asset: admin.firestore.DocumentData | undefined,
): InvestmentTrackingMode =>
  asset?.trackingMode === "value" ? "value" : "quantity";

export const valueModeQuantityMicros = (principalCents: number): number => {
  const quantityMicros = principalCents * VALUE_MODE_MICROS_PER_CENT;
  if (!Number.isSafeInteger(quantityMicros)) {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      "O valor informado excede a representação monetária permitida.",
    );
  }
  return quantityMicros;
};

/**
 * Recusa uma operação quantitativa sobre um ativo de regime por valor.
 *
 * É esta guarda que impede o pior defeito silencioso da convenção: uma
 * valoração a mercado num ativo simples reinterpretaria a cota sintética como
 * quantidade real e publicaria um patrimônio inventado.
 */
export const assertQuantityOperationAllowed = (
  asset: admin.firestore.DocumentData | undefined,
  what: string,
): void => {
  if (assetTrackingMode(asset) === "value") {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      `${what} não se aplica a um investimento controlado por valor. ` +
        "Converta o ativo para controle por quantidade antes de usar " +
        "operações quantitativas.",
    );
  }
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

export type InvestmentCatalogGroup =
  | "investment_institution"
  | "investment_class"
  | "investment_type";

const GROUP_LABEL: Record<InvestmentCatalogGroup, string> = {
  investment_institution: "Instituição",
  investment_class: "Carteira de investimento",
  investment_type: "Categoria de investimento",
};

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
  group: InvestmentCatalogGroup,
  itemId: string,
): Promise<ResolvedCatalogItem> => {
  const snapshot = await transaction.get(
    investmentWorkspaceRef(workspaceId)
      .collection("settings_catalog")
      .doc(itemId),
  );
  const label = GROUP_LABEL[group];
  if (!snapshot.exists) {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      `${label} não encontrada no cadastro deste workspace.`,
    );
  }
  const data = snapshot.data() ?? {};
  if (data.workspaceId !== workspaceId) {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      `${label} não pertence ao workspace autorizado.`,
    );
  }
  if (data.group !== group) {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      `O item informado não é uma ${label.toLowerCase()}.`,
    );
  }
  if (data.status !== "active") {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      `${label} inativa não pode ser usada em um novo lançamento.`,
    );
  }
  const name = typeof data.name === "string" ? data.name.trim() : "";
  if (name.length === 0) {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      `${label} sem nome no cadastro.`,
    );
  }
  return {id: snapshot.id, name};
};

/**
 * Normalização de nome usada pelo catálogo do workspace.
 *
 * É a mesma do `settings_catalog`: acentos removidos, espaços colapsados,
 * minúsculas. Vive aqui porque o `dedupeKey` das sementes — e portanto o
 * identificador determinístico dos itens padrão — depende dela.
 */
export const normalizeCatalogName = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

/**
 * Identificador determinístico de um item semeado do catálogo.
 *
 * Reproduz exatamente o que o onboarding grava
 * (`investment_default_<hash do dedupeKey>`). É **este** identificador, e não
 * o nome exibido, que amarra a classificação técnica: o documento nunca muda
 * de ID, e renomear um item só reescreve `name`, `normalizedName` e
 * `dedupeKey`.
 */
export const investmentCatalogSeedDocumentId = (
  group: string,
  scope: "PF" | "PJ" | "both",
  name: string,
): string => {
  const dedupeKey = [
    group, "all", scope, normalizeCatalogName(name),
  ].join("::");
  return `investment_default_${sha256(dedupeKey).slice(0, 24)}`;
};

/**
 * Categorias padrão de investimento e a classificação técnica de cada uma.
 *
 * Esta é a única fonte da lista: o onboarding semeia a partir dela e o
 * domínio resolve `assetType` a partir dela. Duas listas independentes
 * divergiriam no primeiro item acrescentado.
 */
export const INVESTMENT_TYPE_SEEDS = [
  {name: "Renda fixa", assetType: "fixed_income"},
  {name: "Fundos", assetType: "fund"},
  {name: "Ações", assetType: "stock"},
  {name: "ETF", assetType: "etf"},
  {name: "Criptoativos", assetType: "crypto"},
  {name: "Outros", assetType: "other"},
] as const;

const SEEDED_ASSET_TYPE_BY_ITEM_ID = new Map<string, string>(
  INVESTMENT_TYPE_SEEDS.map((seed) => [
    investmentCatalogSeedDocumentId("investment_type", "both", seed.name),
    seed.assetType,
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
 * Caem em `"other"`. O catálogo não tem, hoje, nenhum campo estável de
 * classificação técnica que o usuário preencha, e inventar uma não é opção:
 * `"other"` é a única resposta honesta, e a faixa de alocação por classe
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
