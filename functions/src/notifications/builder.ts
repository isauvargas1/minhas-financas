import * as admin from "firebase-admin";

import {hasControlCharacter, workspaceIdSchema} from "../shared/ids";
import {RETENTION_DAYS, expiresAfterDays} from "../shared/retention";
import {
  NOTIFICATION_ENTITY_FIELDS,
  NOTIFICATION_EVENT_DOMAIN,
  NOTIFICATION_LINKS,
  NOTIFICATION_MESSAGE_MAX,
  NOTIFICATION_SOURCE_BY_DOMAIN,
  NOTIFICATION_TITLE_MAX,
  NOTIFICATION_TYPES,
  NotificationContractError,
  NotificationEventType,
  NotificationInput,
} from "./contract";

/**
 * Builder único do documento de notificação (P5-D2, PR-NOTIF-01).
 *
 * Todo produtor passa por aqui: a entrada é validada de forma estrita contra
 * o contrato (`contract.ts`) e qualquer violação lança
 * `NotificationContractError` com um código curto, sem gravar nada. O
 * `actionLabel`, a `source` e o `domain` são sempre derivados do contrato,
 * nunca informados pelo chamador, e `entity` carrega exatamente os
 * identificadores do domínio do evento (nenhum dado pessoal).
 *
 * Determinístico: `createdAt` e `expiresAt` partem de `createdAtMs`, capturado
 * uma única vez pelo produtor; o mesmo instante dá sempre o mesmo documento.
 */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const ENTITY_VALUE_MAX = 256;

const has = (object: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(object, key);

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const assertText = (
  value: unknown,
  max: number,
  reason: string,
): string => {
  if (typeof value !== "string" ||
    value.length < 1 ||
    value.length > max ||
    value.trim() !== value ||
    hasControlCharacter(value)) {
    throw new NotificationContractError(reason);
  }
  return value;
};

export const buildNotificationDocument = (
  input: NotificationInput,
): admin.firestore.DocumentData => {
  if (!isPlainObject(input)) {
    throw new NotificationContractError("invalid_input");
  }

  const {id, workspaceId, eventType, type, link, createdAtMs} = input;
  if (typeof id !== "string" || !ID_PATTERN.test(id)) {
    throw new NotificationContractError("invalid_id");
  }
  if (typeof workspaceId !== "string" ||
    !workspaceIdSchema.safeParse(workspaceId).success) {
    throw new NotificationContractError("invalid_workspace");
  }
  if (typeof eventType !== "string" ||
    !has(NOTIFICATION_EVENT_DOMAIN, eventType)) {
    throw new NotificationContractError("unknown_event_type");
  }
  const domain = NOTIFICATION_EVENT_DOMAIN[eventType as NotificationEventType];
  const source = NOTIFICATION_SOURCE_BY_DOMAIN[domain];

  const title = assertText(
    input.title, NOTIFICATION_TITLE_MAX, "invalid_title");
  const message = assertText(
    input.message, NOTIFICATION_MESSAGE_MAX, "invalid_message");

  if (typeof type !== "string" ||
    !(NOTIFICATION_TYPES as readonly string[]).includes(type)) {
    throw new NotificationContractError("invalid_type");
  }
  if (typeof link !== "string" || !has(NOTIFICATION_LINKS, link)) {
    throw new NotificationContractError("invalid_link");
  }
  const actionLabel = NOTIFICATION_LINKS[link];

  if (typeof createdAtMs !== "number" ||
    !Number.isSafeInteger(createdAtMs) ||
    createdAtMs <= 0) {
    throw new NotificationContractError("invalid_created_at");
  }

  const entity: unknown = input.entity;
  if (!isPlainObject(entity)) {
    throw new NotificationContractError("invalid_entity");
  }
  const expectedFields: readonly string[] = NOTIFICATION_ENTITY_FIELDS[domain];
  const ownKeys = Reflect.ownKeys(entity);
  if (ownKeys.length !== expectedFields.length ||
    !ownKeys.every((key) =>
      typeof key === "string" && expectedFields.includes(key))) {
    throw new NotificationContractError("invalid_entity");
  }
  const entityFields: Record<string, string> = {};
  for (const field of expectedFields) {
    const value = entity[field];
    if (typeof value !== "string" ||
      value.length < 1 ||
      value.length > ENTITY_VALUE_MAX ||
      value.trim() !== value ||
      value.includes("/")) {
      throw new NotificationContractError("invalid_entity");
    }
    entityFields[field] = value;
  }

  return {
    id,
    workspaceId,
    title,
    message,
    type,
    link,
    actionLabel,
    createdAt: new Date(createdAtMs).toISOString(),
    expiresAt: expiresAfterDays(createdAtMs, RETENTION_DAYS.notifications),
    source,
    domain,
    domainEventType: eventType,
    ...entityFields,
  };
};
