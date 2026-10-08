import {defineCallable} from "../shared/callable";
import {ApplicationError} from "../shared/errors";
import {DOMAIN_CALLABLE_OPTIONS} from "../shared/runtimeOptions";
import type {WorkspaceActor} from "../shared/workspaceAuth";
import {
  archiveSettingsCatalogItemPayloadSchema,
  createSettingsCatalogItemPayloadSchema,
  updateSettingsCatalogItemPayloadSchema,
} from "./contracts";
import {SETTINGS_CATALOG_ADMIN_ROLES} from "./model";
import {
  ARCHIVE_SETTINGS_CATALOG_ITEM_OPERATION,
  CREATE_SETTINGS_CATALOG_ITEM_OPERATION,
  UPDATE_SETTINGS_CATALOG_ITEM_OPERATION,
  executeArchiveSettingsCatalogItem,
  executeCreateSettingsCatalogItem,
  executeUpdateSettingsCatalogItem,
} from "./operations";

/**
 * Callables do catálogo de configurações (D-23, P4-E).
 *
 * A pré-checagem do kernel filtra o papel (owner/admin); a decisão que vale —
 * papel, membership ativo, workspace ativo, versão do item e reserva do nome —
 * é relida dentro da transação de cada operação. São o único caminho de
 * escrita do catálogo além do provisionamento do workspace: as Rules negam
 * ao cliente toda escrita em `settings_catalog` e todo acesso a
 * `settings_catalog_uniques` e `settings_catalog_events`. Reativar é editar
 * o status para ativo (`updateSettingsCatalogItem`).
 */
const INTERNAL_MESSAGE =
  "Não foi possível concluir a operação. Tente novamente.";

const requireActor = (actor: WorkspaceActor | null): WorkspaceActor => {
  if (!actor) throw new ApplicationError("internal", INTERNAL_MESSAGE);
  return actor;
};

export const createSettingsCatalogItem = defineCallable({
  operation: CREATE_SETTINGS_CATALOG_ITEM_OPERATION,
  schema: createSettingsCatalogItemPayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: SETTINGS_CATALOG_ADMIN_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeCreateSettingsCatalogItem(requireActor(actor), payload, requestId),
});

export const updateSettingsCatalogItem = defineCallable({
  operation: UPDATE_SETTINGS_CATALOG_ITEM_OPERATION,
  schema: updateSettingsCatalogItemPayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: SETTINGS_CATALOG_ADMIN_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeUpdateSettingsCatalogItem(requireActor(actor), payload, requestId),
});

export const archiveSettingsCatalogItem = defineCallable({
  operation: ARCHIVE_SETTINGS_CATALOG_ITEM_OPERATION,
  schema: archiveSettingsCatalogItemPayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: SETTINGS_CATALOG_ADMIN_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeArchiveSettingsCatalogItem(requireActor(actor), payload, requestId),
});
