import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";

import {sha256} from "../shared/hashing";
import {workspaceRef} from "../shared/workspaceAuth";
import type {WorkspaceRole} from "../shared/workspaceAuth";

/**
 * Catálogo de configurações do workspace (D-23, P4-E).
 *
 * Cadastros que organizam os fatos dos outros domínios: produtos e serviços,
 * tipos de despesa, categorias, formas de pagamento, tipos de receita, centros
 * de custo e os dois cadastros da experiência simples de investimentos.
 *
 * Este módulo é o dono do catálogo: grupos, subtipos, normalização, chave de
 * unicidade, escopo PF/PJ, formato dos documentos e IDs das sementes. As
 * callables (`operations.ts`) e o provisionamento do workspace são os únicos
 * escritores; Investimentos e os demais domínios só leem. As Rules negam ao
 * cliente toda escrita em `settings_catalog` e todo acesso a
 * `settings_catalog_uniques` e `settings_catalog_events`.
 *
 * Inativar não é excluir: o documento e a reserva do nome permanecem, os
 * fatos antigos continuam apontando para o mesmo ID e o mesmo nome só volta a
 * circular pela reativação do item original.
 */
export const SETTINGS_CATALOG_SCHEMA_VERSION = 1;

export const SETTINGS_CATALOG_COLLECTION = "settings_catalog";
export const SETTINGS_CATALOG_UNIQUES_COLLECTION = "settings_catalog_uniques";
export const SETTINGS_CATALOG_EVENTS_COLLECTION = "settings_catalog_events";

/**
 * Grupos canônicos. `wallet` (D-30: carteira de caixa é conta), o tipo
 * técnico de investimento e os cadastros de risco, liquidez, indexador e
 * estratégia (D-15: superfície profissional) não existem.
 */
export const SETTINGS_CATALOG_GROUPS = [
  "product_service",
  "expense_type",
  "category",
  "payment_method",
  "income_type",
  "cost_center",
  "investment_class",
  "investment_institution",
] as const;

export type SettingsCatalogGroup = typeof SETTINGS_CATALOG_GROUPS[number];

/**
 * Subtipos de `category`. A compra parcelada é do domínio de cartões
 * (`createCreditCardPurchase`) e usa categoria de despesa; não há subtipo
 * `parcelado`.
 */
export const CATEGORY_TRANSACTION_SUBTYPES = [
  "receita",
  "despesa",
  "investimento",
] as const;

export type CategoryTransactionSubtype =
  typeof CATEGORY_TRANSACTION_SUBTYPES[number];

export type SettingsCatalogStatus = "active" | "inactive";
export type SettingsCatalogScope = "PF" | "PJ" | "both";
export type WorkspaceType = "PF" | "PJ";

/** Só owner e admin administram o catálogo; member e viewer leem. */
export const SETTINGS_CATALOG_ADMIN_ROLES: readonly WorkspaceRole[] =
  ["owner", "admin"];

export const SETTINGS_CATALOG_NAME_MAX_LENGTH = 120;
export const SETTINGS_CATALOG_ICON_MAX_LENGTH = 80;
export const SETTINGS_CATALOG_STROKE_MIN = 1;
export const SETTINGS_CATALOG_STROKE_MAX = 4;
/** Teto da ordenação: cabe no padrão `Date.now()` por milênios. */
export const SETTINGS_CATALOG_SORT_ORDER_MAX = 9_999_999_999_999;

/**
 * Teto operacional de itens por workspace, ativos e inativos (não é quota
 * comercial). É o mesmo teto da leitura completa do frontend
 * (`SETTINGS_CATALOG_READ_LIMIT`): com o backend impedindo que o catálogo
 * passe disso, a lista lida pelos seletores cobre o catálogo inteiro por
 * construção. A contagem é relida na transação da criação.
 */
export const SETTINGS_CATALOG_ITEM_LIMIT_PER_WORKSPACE = 2000;

export const isSettingsCatalogGroup = (
  value: unknown,
): value is SettingsCatalogGroup =>
  typeof value === "string" &&
  (SETTINGS_CATALOG_GROUPS as readonly string[]).includes(value);

export const isCategoryTransactionSubtype = (
  value: unknown,
): value is CategoryTransactionSubtype =>
  typeof value === "string" &&
  (CATEGORY_TRANSACTION_SUBTYPES as readonly string[]).includes(value);

/**
 * Normalização do nome: acentos removidos, espaços colapsados, minúsculas.
 * É a base da unicidade — "Alimentação", "alimentacao" e " ALIMENTAÇÃO "
 * são o mesmo nome.
 */
export const normalizeCatalogName = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

/**
 * Escopo do item, derivado do grupo e do tipo do workspace — nunca do
 * cliente.
 *
 * - `cost_center`: só PJ; um workspace PF não tem centro de custo.
 * - `investment_class`: o perfil do workspace (as carteiras de investimento
 *   de PF e PJ são conjuntos distintos).
 * - demais grupos: `both`.
 *
 * Devolve `null` quando o grupo não existe para o tipo do workspace.
 */
export const catalogScopeFor = (
  group: SettingsCatalogGroup,
  workspaceType: WorkspaceType,
): SettingsCatalogScope | null => {
  if (group === "cost_center") return workspaceType === "PJ" ? "PJ" : null;
  if (group === "investment_class") return workspaceType;
  return "both";
};

/**
 * Chave de unicidade: `grupo::subtipo|all::escopo::nome normalizado`. Duas
 * categorias com o mesmo nome em subtipos diferentes (uma receita e uma
 * despesa "Reembolso") não colidem; o mesmo nome no mesmo recorte colide.
 */
export const catalogDedupeKey = (
  group: SettingsCatalogGroup,
  transactionSubtype: CategoryTransactionSubtype | undefined,
  scope: SettingsCatalogScope,
  name: string,
): string => [
  group, transactionSubtype ?? "all", scope, normalizeCatalogName(name),
].join("::");

const hash40 = (value: string): string => sha256(value).slice(0, 40);

/**
 * ID da reserva de nome em `settings_catalog_uniques`: hash da chave de
 * unicidade. A chave carrega o nome digitado, que pode conter `/` e não pode
 * virar segmento de caminho; o hash é estável, curto e sempre válido.
 */
export const catalogUniqueLockIdFor = (dedupeKey: string): string =>
  `lock_${hash40(dedupeKey)}`;

/** ID do item criado por callable: hash de `(workspace, ator, chave)`. */
export const catalogItemIdFor = (
  workspaceId: string,
  uid: string,
  idempotencyKey: string,
): string => `cat_${hash40(`${workspaceId}:${uid}:${idempotencyKey}`)}`;

/**
 * ID determinístico de um item semeado pelo provisionamento: hash da chave de
 * unicidade. O mesmo item padrão tem o mesmo ID em todo workspace — é por ele
 * que Investimentos classifica as categorias padrão de investimento, nunca
 * pelo nome. Renomear um item semeado não muda o ID.
 */
export const catalogSeedDocumentId = (
  group: SettingsCatalogGroup,
  transactionSubtype: CategoryTransactionSubtype | undefined,
  scope: SettingsCatalogScope,
  name: string,
): string =>
  `seed_${sha256(catalogDedupeKey(group, transactionSubtype, scope, name))
    .slice(0, 24)}`;

/** Intenção do ator: âncora dos eventos de uma mesma chave. */
export const catalogIntentIdFor = (uid: string, idempotencyKey: string) =>
  sha256(`${uid}:${idempotencyKey}`).slice(0, 32);

export type SettingsCatalogEventOperation =
  | "settings_catalog.created"
  | "settings_catalog.updated"
  | "settings_catalog.renamed"
  | "settings_catalog.archived"
  | "settings_catalog.reactivated";

/** ID determinístico do evento: uma intenção gera no máximo um de cada. */
export const catalogEventIdFor = (
  operation: SettingsCatalogEventOperation,
  targetKey: string,
): string =>
  `${operation.replace(".", "_")}_${sha256(`${operation}:${targetKey}`)
    .slice(0, 32)}`;

export const settingsCatalogRef = (workspaceId: string) =>
  workspaceRef(workspaceId).collection(SETTINGS_CATALOG_COLLECTION);
export const settingsCatalogUniquesRef = (workspaceId: string) =>
  workspaceRef(workspaceId).collection(SETTINGS_CATALOG_UNIQUES_COLLECTION);
export const settingsCatalogEventsRef = (workspaceId: string) =>
  workspaceRef(workspaceId).collection(SETTINGS_CATALOG_EVENTS_COLLECTION);

// --------------------------------------------------------------------- item

/** Aparência opcional do item: ícone, e cor e traço só com ícone. */
export interface SettingsCatalogAppearance {
  icon?: string;
  color?: string;
  stroke?: number;
}

export interface AuthoritativeSettingsCatalogItem
  extends SettingsCatalogAppearance {
  id: string;
  workspaceId: string;
  group: SettingsCatalogGroup;
  name: string;
  normalizedName: string;
  dedupeKey: string;
  workspaceScope: SettingsCatalogScope;
  transactionSubtype?: CategoryTransactionSubtype;
  sortOrder: number;
  status: SettingsCatalogStatus;
  createdBy: string;
  updatedAt: Timestamp;
}

const isText = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

export const CATALOG_COLOR_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
export const CATALOG_ICON_PATTERN = /^[A-Za-z][A-Za-z0-9]{0,79}$/;

export const isCatalogStroke = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= SETTINGS_CATALOG_STROKE_MIN &&
  value <= SETTINGS_CATALOG_STROKE_MAX &&
  Number.isInteger(value * 2);

export const isCatalogSortOrder = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= SETTINGS_CATALOG_SORT_ORDER_MAX;

/**
 * Lê um item do catálogo como fonte autoritativa, ou `null` se o documento
 * não estiver no formato que as callables gravam.
 *
 * Confere tudo o que a mutação vai usar: workspace, grupo canônico, nome e
 * a normalização dele, a chave de unicidade recomputada, escopo coerente com
 * o grupo, subtipo só em `category`, aparência, ordenação, estado, autoria e
 * versão. Um documento incoerente é recusado em vez de corrigido.
 */
export const readAuthoritativeCatalogItem = (
  id: string,
  data: admin.firestore.DocumentData | undefined,
  workspaceId: string,
): AuthoritativeSettingsCatalogItem | null => {
  if (
    !data ||
    data.schemaVersion !== SETTINGS_CATALOG_SCHEMA_VERSION ||
    data.workspaceId !== workspaceId ||
    !isSettingsCatalogGroup(data.group) ||
    !isText(data.name) ||
    data.name.length > SETTINGS_CATALOG_NAME_MAX_LENGTH ||
    data.normalizedName !== normalizeCatalogName(data.name) ||
    (data.workspaceScope !== "PF" && data.workspaceScope !== "PJ" &&
      data.workspaceScope !== "both") ||
    (data.status !== "active" && data.status !== "inactive") ||
    !isCatalogSortOrder(data.sortOrder) ||
    !isText(data.createdBy) ||
    !(data.updatedAt instanceof Timestamp)
  ) {
    return null;
  }
  const group = data.group;
  const scope = data.workspaceScope as SettingsCatalogScope;
  const subtype = data.transactionSubtype;
  if (group === "category" ? !isCategoryTransactionSubtype(subtype) :
    subtype !== undefined) {
    return null;
  }
  if (
    (group === "cost_center" && scope !== "PJ") ||
    (group === "investment_class" && scope === "both") ||
    (group !== "cost_center" && group !== "investment_class" &&
      scope !== "both")
  ) {
    return null;
  }
  const transactionSubtype = group === "category" ?
    subtype as CategoryTransactionSubtype : undefined;
  if (
    data.dedupeKey !==
      catalogDedupeKey(group, transactionSubtype, scope, data.name)
  ) {
    return null;
  }
  if (data.icon !== undefined && !(typeof data.icon === "string" &&
    CATALOG_ICON_PATTERN.test(data.icon))) {
    return null;
  }
  if (data.color !== undefined && !(typeof data.color === "string" &&
    CATALOG_COLOR_PATTERN.test(data.color))) {
    return null;
  }
  if (data.stroke !== undefined && !isCatalogStroke(data.stroke)) return null;
  if (data.icon === undefined &&
    (data.color !== undefined || data.stroke !== undefined)) {
    return null;
  }
  return {
    id,
    workspaceId,
    group,
    name: data.name,
    normalizedName: data.normalizedName,
    dedupeKey: data.dedupeKey,
    workspaceScope: scope,
    ...(transactionSubtype ? {transactionSubtype} : {}),
    ...(data.icon !== undefined ? {icon: data.icon} : {}),
    ...(data.color !== undefined ? {color: data.color} : {}),
    ...(data.stroke !== undefined ? {stroke: data.stroke} : {}),
    sortOrder: data.sortOrder,
    status: data.status,
    createdBy: data.createdBy,
    updatedAt: data.updatedAt,
  };
};

/** Documento de um item novo (callable ou semente). */
export const catalogItemDocument = (input: {
  workspaceId: string;
  group: SettingsCatalogGroup;
  name: string;
  workspaceScope: SettingsCatalogScope;
  transactionSubtype?: CategoryTransactionSubtype;
  appearance?: SettingsCatalogAppearance;
  sortOrder: number;
  status: SettingsCatalogStatus;
  actorUid: string;
}): admin.firestore.DocumentData => ({
  schemaVersion: SETTINGS_CATALOG_SCHEMA_VERSION,
  workspaceId: input.workspaceId,
  group: input.group,
  name: input.name,
  normalizedName: normalizeCatalogName(input.name),
  dedupeKey: catalogDedupeKey(
    input.group, input.transactionSubtype, input.workspaceScope, input.name),
  workspaceScope: input.workspaceScope,
  ...(input.transactionSubtype ?
    {transactionSubtype: input.transactionSubtype} : {}),
  ...(input.appearance?.icon !== undefined ?
    {icon: input.appearance.icon} : {}),
  ...(input.appearance?.icon !== undefined &&
    input.appearance.color !== undefined ?
    {color: input.appearance.color} : {}),
  ...(input.appearance?.icon !== undefined &&
    input.appearance.stroke !== undefined ?
    {stroke: input.appearance.stroke} : {}),
  sortOrder: input.sortOrder,
  status: input.status,
  createdBy: input.actorUid,
  updatedBy: input.actorUid,
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
});

/**
 * Reserva do nome: um documento por chave de unicidade, apontando para o
 * item dono dela. Criada no mesmo commit do item (ou do renomear) e removida
 * só quando o próprio dono troca de chave. Inativar a mantém.
 */
export const catalogLockDocument = (input: {
  workspaceId: string;
  dedupeKey: string;
  catalogItemId: string;
  group: SettingsCatalogGroup;
  actorUid: string;
}): admin.firestore.DocumentData => ({
  schemaVersion: SETTINGS_CATALOG_SCHEMA_VERSION,
  workspaceId: input.workspaceId,
  dedupeKey: input.dedupeKey,
  catalogItemId: input.catalogItemId,
  group: input.group,
  createdBy: input.actorUid,
  createdAt: FieldValue.serverTimestamp(),
});

// ------------------------------------------------------------------ auditoria

export type CatalogAuditScalar = string | number | boolean | null;

export interface SettingsCatalogEventInput {
  workspaceId: string;
  operation: SettingsCatalogEventOperation;
  targetKey: string;
  itemId: string;
  group: SettingsCatalogGroup;
  transactionSubtype: CategoryTransactionSubtype | null;
  workspaceScope: SettingsCatalogScope;
  actorId: string;
  actorRole: WorkspaceRole;
  intentId: string;
  requestHash: string;
  requestId: string;
  correlationId: string | null;
  changedFields: string[];
  before: Record<string, CatalogAuditScalar> | null;
  after: Record<string, CatalogAuditScalar>;
}

/**
 * Trilha de auditoria do catálogo. Sem texto livre: o nome digitado não entra
 * no evento (só `changedFields` diz que mudou); ficam IDs, grupo, subtipo,
 * escopo, ator, papel e o estado. Não expira — é trilha de domínio, não dado
 * operacional.
 */
export const appendSettingsCatalogEvent = (
  transaction: admin.firestore.Transaction,
  input: SettingsCatalogEventInput,
): string => {
  const ref = settingsCatalogEventsRef(input.workspaceId)
    .doc(catalogEventIdFor(input.operation, input.targetKey));
  transaction.create(ref, {
    id: ref.id,
    schemaVersion: SETTINGS_CATALOG_SCHEMA_VERSION,
    workspaceId: input.workspaceId,
    operation: input.operation,
    itemId: input.itemId,
    group: input.group,
    transactionSubtype: input.transactionSubtype,
    workspaceScope: input.workspaceScope,
    actorId: input.actorId,
    actorRole: input.actorRole,
    intentId: input.intentId,
    requestHash: input.requestHash,
    requestId: input.requestId,
    correlationId: input.correlationId,
    changedFields: input.changedFields,
    before: input.before,
    after: input.after,
    createdAt: FieldValue.serverTimestamp(),
  });
  return ref.id;
};
