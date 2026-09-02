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

/**
 * Que documentos do catálogo servem a um papel do formulário simples.
 *
 * Um papel não é sinônimo de um grupo. A **categoria** do investimento passou
 * a ser cadastrada no catálogo genérico — `category` com
 * `transactionSubtype: "investimento"`, a mesma tela que já organiza receita e
 * despesa — e continua gravada, em todo ativo e todo movimento anterior, com
 * um identificador do grupo histórico `investment_type`. Amarrar a operação a
 * um grupo literal obrigaria a escolher entre recusar o cadastro novo e
 * quebrar o antigo; o seletor diz quais documentos são aceitáveis e mantém as
 * duas coisas verdadeiras ao mesmo tempo.
 *
 * O grupo histórico não é reexposto como cadastro na navegação comum: ele
 * permanece **legível**, que é coisa diferente de oferecido.
 */
export interface InvestmentCatalogSelector {
  /** Rótulo em pt-BR usado nas mensagens de recusa. */
  label: string;
  /** Grupos aceitos, do oficial ao histórico. */
  groups: readonly string[];
  /**
   * Subtipo exigido quando o documento está no grupo genérico `category`.
   *
   * Só `category` carrega `transactionSubtype` — as Rules o proíbem nos demais
   * grupos —, então a exigência se aplica a ele e a mais nenhum. É esta linha
   * que impede uma categoria de receita, despesa ou parcelado de ser aceita
   * como categoria de investimento por um chamador forjado.
   */
  categoryTransactionSubtype?: string;
}

export const INVESTMENT_INSTITUTION_SELECTOR: InvestmentCatalogSelector = {
  label: "Instituição",
  groups: ["investment_institution"],
};

export const INVESTMENT_CLASS_SELECTOR: InvestmentCatalogSelector = {
  label: "Carteira de investimento",
  groups: ["investment_class"],
};

/**
 * Categoria do investimento: catálogo genérico primeiro, grupo histórico
 * depois. Nenhuma equivalência por nome — a identidade é sempre o ID.
 */
export const INVESTMENT_CATEGORY_SELECTOR: InvestmentCatalogSelector = {
  label: "Categoria de investimento",
  groups: ["category", "investment_type"],
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
    investmentWorkspaceRef(workspaceId)
      .collection("settings_catalog")
      .doc(itemId),
  );
  const label = selector.label;
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
  const group = typeof data.group === "string" ? data.group : "";
  if (!selector.groups.includes(group)) {
    throw new CreditCardApplicationError(
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
    throw new CreditCardApplicationError(
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
 * Chave de deduplicação do catálogo, na forma que as duas semeaduras gravam.
 *
 * O segmento do subtipo é `"all"` quando o grupo não tem subtipo — é assim que
 * `settings-catalog/utils.ts` monta a chave no cliente e é assim que ambos os
 * seeds do servidor a montam.
 */
const catalogDedupeKey = (
  group: string,
  transactionSubtype: string | undefined,
  scope: "PF" | "PJ" | "both",
  name: string,
): string => [
  group, transactionSubtype ?? "all", scope, normalizeCatalogName(name),
].join("::");

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
): string =>
  `investment_default_${sha256(
    catalogDedupeKey(group, undefined, scope, name),
  ).slice(0, 24)}`;

/**
 * Identificador determinístico de um item semeado por
 * `seedLegacySettingsCatalog` (`legacy_<hash do dedupeKey>`).
 *
 * É o catálogo genérico — categorias de receita, despesa e **investimento**,
 * formas de pagamento, carteiras de caixa. Aqui interessa só o terceiro
 * conjunto: são esses IDs que dão classificação técnica às categorias padrão
 * de investimento agora que a fonte visível é `category`.
 */
export const legacyCatalogSeedDocumentId = (
  group: string,
  transactionSubtype: string | undefined,
  scope: "both" | "PJ",
  name: string,
): string =>
  `legacy_${sha256(
    catalogDedupeKey(group, transactionSubtype, scope, name),
  ).slice(0, 24)}`;

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

/**
 * Categorias padrão de investimento do catálogo genérico e a classificação
 * técnica de cada uma.
 *
 * Os nomes reproduzem, letra por letra, o que `seedLegacySettingsCatalog`
 * grava em `category` com `transactionSubtype: "investimento"`
 * (`functions/src/goals/operations.ts`). O vínculo continua sendo o
 * identificador determinístico, nunca o texto — e a suíte de integração semeia
 * de verdade e confere item a item, de modo que uma divergência entre as duas
 * listas aparece como `other` num teste vermelho, e não como classificação
 * silenciosamente errada em produção.
 */
export const INVESTMENT_CATEGORY_SEEDS = [
  {name: "Ações", assetType: "stock"},
  {name: "Fundos Imobiliários", assetType: "fund"},
  {name: "Tesouro Direto", assetType: "fixed_income"},
  {name: "CDB", assetType: "fixed_income"},
  {name: "Poupança", assetType: "fixed_income"},
] as const;

/**
 * Mapa de classificação técnica, cobrindo as duas origens.
 *
 * As entradas de `investment_type` **não** saem: um ativo antigo continua
 * sendo criado, editado e relido pelo mesmo identificador que sempre teve. As
 * de `category`/`investimento` entram porque é de lá que vem a categoria dos
 * lançamentos novos. Nenhuma das duas depende do rótulo.
 */
const SEEDED_ASSET_TYPE_BY_ITEM_ID = new Map<string, string>([
  ...INVESTMENT_TYPE_SEEDS.map((seed): [string, string] => [
    investmentCatalogSeedDocumentId("investment_type", "both", seed.name),
    seed.assetType,
  ]),
  ...INVESTMENT_CATEGORY_SEEDS.map((seed): [string, string] => [
    legacyCatalogSeedDocumentId("category", "investimento", "both", seed.name),
    seed.assetType,
  ]),
]);

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
 * identificador **aleatório** — o catálogo só gera ID determinístico para o
 * que ele mesmo semeia —, então ela nunca colide com o mapa, em nenhum dos
 * dois grupos. O catálogo tampouco tem um campo estável de classificação
 * técnica que o usuário preencha, e inventar um não é opção: `"other"` é a
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
