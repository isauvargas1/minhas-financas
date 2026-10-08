import * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";

import {compareCommitTimes} from "../cash/periods";
import {parseIsoInstant} from "../shared/commitTime";
import {ApplicationError} from "../shared/errors";
import {settingsCatalogItemIdSchema} from "../shared/ids";
import {
  completeActorIdempotency,
  reserveActorIdempotency,
  type ActorIdempotencyReservation,
} from "../shared/idempotency";
import {reserveRateLimit, type RateLimitPolicy} from "../shared/rateLimit";
import {
  reassertWorkspaceActor,
  type WorkspaceActor,
  type WorkspaceRole,
} from "../shared/workspaceAuth";
import type {
  ArchiveSettingsCatalogItemPayload,
  CreateSettingsCatalogItemPayload,
  SettingsCatalogMutationResult,
  UpdateSettingsCatalogItemPayload,
} from "./contracts";
import {
  SETTINGS_CATALOG_ADMIN_ROLES,
  SETTINGS_CATALOG_ITEM_LIMIT_PER_WORKSPACE,
  appendSettingsCatalogEvent,
  catalogDedupeKey,
  catalogEventIdFor,
  catalogIntentIdFor,
  catalogItemDocument,
  catalogItemIdFor,
  catalogLockDocument,
  catalogScopeFor,
  catalogUniqueLockIdFor,
  normalizeCatalogName,
  readAuthoritativeCatalogItem,
  settingsCatalogEventsRef,
  settingsCatalogRef,
  settingsCatalogUniquesRef,
  type AuthoritativeSettingsCatalogItem,
  type CatalogAuditScalar,
  type SettingsCatalogEventOperation,
  type SettingsCatalogStatus,
  type WorkspaceType,
} from "./model";

/**
 * Operações autoritativas do catálogo de configurações (D-23, P4-E).
 *
 * - Só owner e admin criam, renomeiam, editam, inativam e reativam; o papel,
 *   o membership ativo e o workspace ativo são relidos dentro da transação.
 * - O escopo PF/PJ vem do grupo e do tipo do workspace lido na transação; o
 *   nome normalizado e a chave de unicidade são derivados aqui.
 * - Unicidade: o item e a reserva do nome (`settings_catalog_uniques`) nascem
 *   no mesmo commit; renomear reserva a chave nova, atualiza o mesmo
 *   documento e libera a antiga no mesmo commit; inativar mantém a reserva.
 *   Duas criações com o mesmo nome disputam o mesmo documento de reserva — a
 *   segunda transação é repetida pelo SDK, encontra a reserva e falha com a
 *   mensagem de nome repetido.
 * - Toda mutação de item existente exige a versão lida (`expectedUpdatedAt`):
 *   nada é sobrescrito por quem viu um estado antigo.
 * - Idempotência por ator e chave: mesma chave e mesmo conteúdo devolvem o
 *   resultado salvo; conteúdo diferente é conflito. Nenhuma exclusão.
 */
export const CREATE_SETTINGS_CATALOG_ITEM_OPERATION =
  "createSettingsCatalogItem";
export const UPDATE_SETTINGS_CATALOG_ITEM_OPERATION =
  "updateSettingsCatalogItem";
export const ARCHIVE_SETTINGS_CATALOG_ITEM_OPERATION =
  "archiveSettingsCatalogItem";

/** Limite operacional do cadastro (não é quota comercial). */
export const SETTINGS_CATALOG_MUTATION_RATE_LIMIT: RateLimitPolicy = {
  operation: "settingsCatalogMutation",
  limit: 120,
  windowSeconds: 10 * 60,
};

export const CATALOG_IDEMPOTENCY_CONFLICT_MESSAGE =
  "Esta chave de idempotência já foi usada com outros dados.";
export const CATALOG_DUPLICATE_MESSAGE =
  "Já existe um cadastro com esse nome neste grupo.";
export const CATALOG_DUPLICATE_INACTIVE_MESSAGE =
  "Já existe um cadastro inativo com esse nome neste grupo. Reative-o em " +
  "vez de criar outro.";
export const CATALOG_CONFLICT_MESSAGE =
  "Este cadastro foi alterado por outra operação depois que você o abriu. " +
  "Atualize e tente novamente.";
export const CATALOG_UNCHANGED_MESSAGE =
  "Nenhum dado foi alterado: os valores informados já são os atuais.";
export const CATALOG_ALREADY_INACTIVE_MESSAGE =
  "Este cadastro já está inativo.";
export const CATALOG_COST_CENTER_PJ_ONLY_MESSAGE =
  "Centros de custo existem só em espaços PJ.";
export const CATALOG_SCOPE_MISMATCH_MESSAGE =
  "Este cadastro não pertence ao perfil deste espaço e não pode ser alterado.";
export const CATALOG_LIMIT_MESSAGE =
  "Este espaço já tem o máximo de " +
  `${SETTINGS_CATALOG_ITEM_LIMIT_PER_WORKSPACE.toLocaleString("pt-BR")} ` +
  "cadastros (ativos e inativos). Reative um cadastro inativo em vez de " +
  "criar outro.";
export const CATALOG_APPEARANCE_WITHOUT_ICON_MESSAGE =
  "Cor e espessura: só com um ícone escolhido.";
const CATALOG_NOT_FOUND_MESSAGE = "Cadastro não encontrado.";
const CATALOG_INCONSISTENT_MESSAGE =
  "Este cadastro tem dados inconsistentes e não pode ser alterado.";
const CATALOG_WORKSPACE_TYPE_MESSAGE =
  "O tipo deste espaço de trabalho é inválido. Fale com o suporte.";
const CATALOG_INTERNAL_MESSAGE =
  "Não foi possível concluir a operação. Tente novamente.";

/** Relógio e ponto de falha injetáveis, só para os testes. */
export interface SettingsCatalogOperationOptions {
  now?: () => number;
  /** Com todas as escritas enfileiradas, antes do commit. */
  beforeCommit?: () => void;
}

const db = () => admin.firestore();

const replayResult = (
  stored: Record<string, unknown>,
): SettingsCatalogMutationResult => {
  if (
    typeof stored.itemId !== "string" ||
    (stored.status !== "active" && stored.status !== "inactive")
  ) {
    throw new ApplicationError("internal", CATALOG_INTERNAL_MESSAGE);
  }
  return {
    ...(stored as unknown as SettingsCatalogMutationResult),
    replayed: true,
  };
};

const workspaceTypeOf = (
  workspace: admin.firestore.DocumentData,
): WorkspaceType => {
  if (workspace.type === "PF" || workspace.type === "PJ") {
    return workspace.type;
  }
  throw new ApplicationError("domain_precondition_failed",
    CATALOG_WORKSPACE_TYPE_MESSAGE);
};

const reserveCatalogRateLimit = (
  transaction: admin.firestore.Transaction,
  actor: WorkspaceActor,
) => reserveRateLimit(
  transaction,
  actor.workspaceId,
  actor.uid,
  SETTINGS_CATALOG_MUTATION_RATE_LIMIT,
);

/**
 * Erro de nome repetido. Lê o dono da reserva para dizer se o nome está num
 * item inativo — nesse caso, o caminho é reativá-lo, não criar outro.
 */
const duplicateError = async (
  transaction: admin.firestore.Transaction,
  workspaceId: string,
  lock: admin.firestore.DocumentSnapshot,
): Promise<ApplicationError> => {
  const owner = settingsCatalogItemIdSchema.safeParse(
    lock.get("catalogItemId"));
  const inactive = owner.success &&
    (await transaction.get(settingsCatalogRef(workspaceId).doc(owner.data)))
      .get("status") === "inactive";
  return new ApplicationError(
    "already_exists",
    inactive ? CATALOG_DUPLICATE_INACTIVE_MESSAGE : CATALOG_DUPLICATE_MESSAGE,
    {conflict: inactive ? "inactive_duplicate" : "duplicate"},
  );
};

/** Estado auditável do item: sem o nome (texto livre). */
const auditSnapshot = (item: {
  status: SettingsCatalogStatus;
  sortOrder: number;
  icon?: string;
  color?: string;
  stroke?: number;
}): Record<string, CatalogAuditScalar> => ({
  status: item.status,
  sortOrder: item.sortOrder,
  icon: item.icon ?? null,
  color: item.color ?? null,
  stroke: item.stroke ?? null,
});

// ----------------------------------------------------------------- criação

export const executeCreateSettingsCatalogItem = async (
  actor: WorkspaceActor,
  payload: CreateSettingsCatalogItemPayload,
  requestId: string,
  options: SettingsCatalogOperationOptions = {},
): Promise<SettingsCatalogMutationResult> =>
  db().runTransaction(async (transaction) => {
    const {workspace, role} = await reassertWorkspaceActor(
      transaction, actor, SETTINGS_CATALOG_ADMIN_ROLES);
    const reservation = await reserveActorIdempotency(transaction, {
      uid: actor.uid,
      operation: CREATE_SETTINGS_CATALOG_ITEM_OPERATION,
      idempotencyKey: payload.idempotencyKey,
      payload,
    });
    if (reservation.replay) return replayResult(reservation.replay);

    const workspaceScope = catalogScopeFor(
      payload.group, workspaceTypeOf(workspace));
    if (!workspaceScope) {
      throw new ApplicationError("domain_precondition_failed",
        CATALOG_COST_CENTER_PJ_ONLY_MESSAGE);
    }
    const transactionSubtype = payload.group === "category" ?
      payload.transactionSubtype : undefined;
    const dedupeKey = catalogDedupeKey(
      payload.group, transactionSubtype, workspaceScope, payload.name);

    const itemId = catalogItemIdFor(
      actor.workspaceId, actor.uid, payload.idempotencyKey);
    const itemRef = settingsCatalogRef(actor.workspaceId).doc(itemId);
    const createdEventRef = settingsCatalogEventsRef(actor.workspaceId)
      .doc(catalogEventIdFor("settings_catalog.created", itemId));
    const lockRef = settingsCatalogUniquesRef(actor.workspaceId)
      .doc(catalogUniqueLockIdFor(dedupeKey));
    const [existing, createdEvent, lock] = await transaction.getAll(
      itemRef, createdEventRef, lockRef);
    if (existing.exists || createdEvent.exists) {
      // Chave expirada, item preservado: o evento de criação decide.
      if (
        existing.exists &&
        createdEvent.get("requestHash") === reservation.requestHash &&
        createdEvent.get("actorId") === actor.uid &&
        existing.get("createdBy") === actor.uid
      ) {
        return {
          itemId,
          status: existing.get("status") === "inactive" ?
            "inactive" as const : "active" as const,
          replayed: true,
        };
      }
      throw new ApplicationError("idempotency_conflict",
        CATALOG_IDEMPOTENCY_CONFLICT_MESSAGE);
    }
    if (lock.exists) {
      throw await duplicateError(transaction, actor.workspaceId, lock);
    }
    // Teto de itens: contagem relida na transação (o replay já saiu acima).
    const itemCount = (await transaction.get(
      settingsCatalogRef(actor.workspaceId).count())).data().count;
    if (itemCount >= SETTINGS_CATALOG_ITEM_LIMIT_PER_WORKSPACE) {
      throw new ApplicationError("domain_precondition_failed",
        CATALOG_LIMIT_MESSAGE);
    }
    const rateLimit = await reserveCatalogRateLimit(transaction, actor);

    const status = payload.status ?? "active";
    const sortOrder = payload.sortOrder ?? (options.now ?? Date.now)();
    const appearance = {
      ...(payload.icon !== undefined ? {icon: payload.icon} : {}),
      ...(payload.color !== undefined ? {color: payload.color} : {}),
      ...(payload.stroke !== undefined ? {stroke: payload.stroke} : {}),
    };
    transaction.create(itemRef, catalogItemDocument({
      workspaceId: actor.workspaceId,
      group: payload.group,
      name: payload.name,
      workspaceScope,
      transactionSubtype,
      appearance,
      sortOrder,
      status,
      actorUid: actor.uid,
    }));
    transaction.create(lockRef, catalogLockDocument({
      workspaceId: actor.workspaceId,
      dedupeKey,
      catalogItemId: itemId,
      group: payload.group,
      actorUid: actor.uid,
    }));
    appendSettingsCatalogEvent(transaction, {
      workspaceId: actor.workspaceId,
      operation: "settings_catalog.created",
      targetKey: itemId,
      itemId,
      group: payload.group,
      transactionSubtype: transactionSubtype ?? null,
      workspaceScope,
      actorId: actor.uid,
      actorRole: role,
      intentId: catalogIntentIdFor(actor.uid, payload.idempotencyKey),
      requestHash: reservation.requestHash,
      requestId,
      correlationId: payload.correlationId ?? null,
      changedFields: ["name", ...Object.keys(appearance), "sortOrder",
        "status"],
      before: null,
      after: auditSnapshot({status, sortOrder, ...appearance}),
    });
    const result = {itemId, status};
    completeActorIdempotency(transaction, reservation, {
      uid: actor.uid,
      operation: CREATE_SETTINGS_CATALOG_ITEM_OPERATION,
      workspaceId: actor.workspaceId,
      requestId,
      result,
    });
    rateLimit.commit();
    options.beforeCommit?.();
    return {...result, replayed: false};
  });

// ---------------------------------------------------------------- mutações

interface ItemMutationPayload {
  idempotencyKey: string;
  itemId: string;
  expectedUpdatedAt: string;
  correlationId?: string;
}

interface LoadedItem {
  role: WorkspaceRole;
  reservation: ActorIdempotencyReservation;
  intentId: string;
  item: AuthoritativeSettingsCatalogItem;
  itemRef: admin.firestore.DocumentReference;
  lockRef: admin.firestore.DocumentReference;
}

type ItemLoadOutcome =
  | {replay: SettingsCatalogMutationResult}
  | {loaded: LoadedItem};

/**
 * Fase de leitura comum a editar e inativar: papel e workspace relidos,
 * idempotência, item autoritativo, versão lida, escopo coerente com o tipo do
 * workspace e reserva do nome apontando para o próprio item.
 *
 * A última conferência é o que impede um renomear de liberar a reserva de
 * **outro** item: a reserva só é removida quando é comprovadamente deste.
 */
const loadItemForMutation = async (
  transaction: admin.firestore.Transaction,
  actor: WorkspaceActor,
  payload: ItemMutationPayload,
  operation: string,
): Promise<ItemLoadOutcome> => {
  const {workspace, role} = await reassertWorkspaceActor(
    transaction, actor, SETTINGS_CATALOG_ADMIN_ROLES);
  const reservation = await reserveActorIdempotency(transaction, {
    uid: actor.uid,
    operation,
    idempotencyKey: payload.idempotencyKey,
    payload: payload as unknown as Record<string, unknown>,
  });
  if (reservation.replay) {
    return {replay: replayResult(reservation.replay)};
  }
  const itemRef = settingsCatalogRef(actor.workspaceId).doc(payload.itemId);
  const snapshot = await transaction.get(itemRef);
  if (!snapshot.exists) {
    throw new ApplicationError("not_found", CATALOG_NOT_FOUND_MESSAGE);
  }
  const item = readAuthoritativeCatalogItem(
    snapshot.id, snapshot.data(), actor.workspaceId);
  if (!item) {
    throw new ApplicationError("domain_precondition_failed",
      CATALOG_INCONSISTENT_MESSAGE, {ineligible: "inconsistent_item"});
  }
  if (
    compareCommitTimes(item.updatedAt,
      parseIsoInstant(payload.expectedUpdatedAt)) !== 0
  ) {
    throw new ApplicationError("concurrent_update", CATALOG_CONFLICT_MESSAGE);
  }
  if (
    catalogScopeFor(item.group, workspaceTypeOf(workspace)) !==
      item.workspaceScope
  ) {
    throw new ApplicationError("domain_precondition_failed",
      CATALOG_SCOPE_MISMATCH_MESSAGE);
  }
  const lockRef = settingsCatalogUniquesRef(actor.workspaceId)
    .doc(catalogUniqueLockIdFor(item.dedupeKey));
  const lock = await transaction.get(lockRef);
  if (
    !lock.exists ||
    lock.get("catalogItemId") !== item.id ||
    lock.get("dedupeKey") !== item.dedupeKey ||
    lock.get("workspaceId") !== actor.workspaceId
  ) {
    throw new ApplicationError("domain_precondition_failed",
      CATALOG_INCONSISTENT_MESSAGE, {ineligible: "inconsistent_item"});
  }
  return {
    loaded: {
      role,
      reservation,
      intentId: catalogIntentIdFor(actor.uid, payload.idempotencyKey),
      item,
      itemRef,
      lockRef,
    },
  };
};

const eventBase = (
  actor: WorkspaceActor,
  loaded: LoadedItem,
  payload: ItemMutationPayload,
  requestId: string,
) => ({
  workspaceId: actor.workspaceId,
  targetKey: loaded.intentId,
  itemId: loaded.item.id,
  group: loaded.item.group,
  transactionSubtype: loaded.item.transactionSubtype ?? null,
  workspaceScope: loaded.item.workspaceScope,
  actorId: actor.uid,
  actorRole: loaded.role,
  intentId: loaded.intentId,
  requestHash: loaded.reservation.requestHash,
  requestId,
  correlationId: payload.correlationId ?? null,
});

const statusEventOf = (
  target: SettingsCatalogStatus,
): SettingsCatalogEventOperation => target === "inactive" ?
  "settings_catalog.archived" : "settings_catalog.reactivated";

// ----------------------------------------------------------------- edição

export const executeUpdateSettingsCatalogItem = async (
  actor: WorkspaceActor,
  payload: UpdateSettingsCatalogItemPayload,
  requestId: string,
  options: SettingsCatalogOperationOptions = {},
): Promise<SettingsCatalogMutationResult> =>
  db().runTransaction(async (transaction) => {
    const outcome = await loadItemForMutation(transaction, actor, payload,
      UPDATE_SETTINGS_CATALOG_ITEM_OPERATION);
    if ("replay" in outcome) return outcome.replay;
    const {loaded} = outcome;
    const {item} = loaded;
    const {changes} = payload;

    const name = changes.name ?? item.name;
    const icon = changes.icon === undefined ? item.icon :
      changes.icon ?? undefined;
    if (
      icon === undefined &&
      ((changes.color !== undefined && changes.color !== null) ||
        (changes.stroke !== undefined && changes.stroke !== null))
    ) {
      throw new ApplicationError("invalid_payload",
        CATALOG_APPEARANCE_WITHOUT_ICON_MESSAGE);
    }
    // Sem ícone, cor e espessura saem junto.
    const color = icon === undefined ? undefined :
      changes.color === undefined ? item.color : changes.color ?? undefined;
    const stroke = icon === undefined ? undefined :
      changes.stroke === undefined ? item.stroke : changes.stroke ?? undefined;
    const sortOrder = changes.sortOrder ?? item.sortOrder;
    const status = changes.status ?? item.status;

    const renamed = name !== item.name;
    const appearanceFields = [
      ...(icon !== item.icon ? ["icon"] : []),
      ...(color !== item.color ? ["color"] : []),
      ...(stroke !== item.stroke ? ["stroke"] : []),
      ...(sortOrder !== item.sortOrder ? ["sortOrder"] : []),
    ];
    const statusChanged = status !== item.status;
    if (!renamed && appearanceFields.length === 0 && !statusChanged) {
      throw new ApplicationError("domain_precondition_failed",
        CATALOG_UNCHANGED_MESSAGE);
    }

    // Renomear para outra chave: a nova precisa estar livre.
    const dedupeKey = catalogDedupeKey(
      item.group, item.transactionSubtype, item.workspaceScope, name);
    const nextLockRef = dedupeKey === item.dedupeKey ? null :
      settingsCatalogUniquesRef(actor.workspaceId)
        .doc(catalogUniqueLockIdFor(dedupeKey));
    if (nextLockRef) {
      const nextLock = await transaction.get(nextLockRef);
      if (nextLock.exists) {
        throw await duplicateError(transaction, actor.workspaceId, nextLock);
      }
    }
    const rateLimit = await reserveCatalogRateLimit(transaction, actor);

    const orDelete = (value: string | number | undefined) =>
      value === undefined ? FieldValue.delete() : value;
    transaction.update(loaded.itemRef, {
      ...(renamed ? {
        name,
        normalizedName: normalizeCatalogName(name),
        dedupeKey,
      } : {}),
      ...(appearanceFields.includes("icon") ? {icon: orDelete(icon)} : {}),
      ...(appearanceFields.includes("color") ? {color: orDelete(color)} : {}),
      ...(appearanceFields.includes("stroke") ?
        {stroke: orDelete(stroke)} : {}),
      ...(appearanceFields.includes("sortOrder") ? {sortOrder} : {}),
      ...(statusChanged ? {status} : {}),
      updatedBy: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (nextLockRef) {
      transaction.create(nextLockRef, catalogLockDocument({
        workspaceId: actor.workspaceId,
        dedupeKey,
        catalogItemId: item.id,
        group: item.group,
        actorUid: actor.uid,
      }));
      transaction.delete(loaded.lockRef);
    }

    const base = eventBase(actor, loaded, payload, requestId);
    const before = auditSnapshot(item);
    const after = auditSnapshot({status, sortOrder, icon, color, stroke});
    if (renamed) {
      appendSettingsCatalogEvent(transaction, {
        ...base,
        operation: "settings_catalog.renamed",
        changedFields: ["name"],
        before,
        // A chave de unicidade mudou (reserva movida) ou só a grafia.
        after: {...after, nameKeyChanged: nextLockRef !== null},
      });
    }
    if (statusChanged) {
      appendSettingsCatalogEvent(transaction, {
        ...base,
        operation: statusEventOf(status),
        changedFields: ["status"],
        before,
        after,
      });
    }
    if (appearanceFields.length > 0) {
      appendSettingsCatalogEvent(transaction, {
        ...base,
        operation: "settings_catalog.updated",
        changedFields: appearanceFields,
        before,
        after,
      });
    }
    const result = {itemId: item.id, status, changed: true};
    completeActorIdempotency(transaction, loaded.reservation, {
      uid: actor.uid,
      operation: UPDATE_SETTINGS_CATALOG_ITEM_OPERATION,
      workspaceId: actor.workspaceId,
      requestId,
      result,
    });
    rateLimit.commit();
    options.beforeCommit?.();
    return {...result, replayed: false};
  });

// ------------------------------------------------------------- inativação

/**
 * Inativar: o item sai dos seletores de lançamento novo, mas o documento, o
 * ID e a reserva do nome permanecem — os fatos antigos continuam resolvendo
 * o mesmo cadastro, e o mesmo nome só volta pela reativação dele.
 */
export const executeArchiveSettingsCatalogItem = async (
  actor: WorkspaceActor,
  payload: ArchiveSettingsCatalogItemPayload,
  requestId: string,
  options: SettingsCatalogOperationOptions = {},
): Promise<SettingsCatalogMutationResult> =>
  db().runTransaction(async (transaction) => {
    const outcome = await loadItemForMutation(transaction, actor, payload,
      ARCHIVE_SETTINGS_CATALOG_ITEM_OPERATION);
    if ("replay" in outcome) return outcome.replay;
    const {loaded} = outcome;
    const {item} = loaded;
    if (item.status === "inactive") {
      throw new ApplicationError("domain_precondition_failed",
        CATALOG_ALREADY_INACTIVE_MESSAGE);
    }
    const rateLimit = await reserveCatalogRateLimit(transaction, actor);
    transaction.update(loaded.itemRef, {
      status: "inactive",
      updatedBy: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    appendSettingsCatalogEvent(transaction, {
      ...eventBase(actor, loaded, payload, requestId),
      operation: "settings_catalog.archived",
      changedFields: ["status"],
      before: auditSnapshot(item),
      after: auditSnapshot({...item, status: "inactive"}),
    });
    const result = {itemId: item.id, status: "inactive" as const};
    completeActorIdempotency(transaction, loaded.reservation, {
      uid: actor.uid,
      operation: ARCHIVE_SETTINGS_CATALOG_ITEM_OPERATION,
      workspaceId: actor.workspaceId,
      requestId,
      result,
    });
    rateLimit.commit();
    options.beforeCommit?.();
    return {...result, replayed: false};
  });
