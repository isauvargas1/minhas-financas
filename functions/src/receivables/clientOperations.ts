import * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";

import {ApplicationError} from "../shared/errors";
import {
  completeActorIdempotency,
  reserveActorIdempotency,
  type ActorIdempotencyReservation,
} from "../shared/idempotency";
import {reserveRateLimit} from "../shared/rateLimit";
import {
  reassertWorkspaceActor,
  type WorkspaceActor,
  type WorkspaceRole,
} from "../shared/workspaceAuth";
import {
  CLIENT_ADMIN_ROLES,
  CLIENT_MUTATION_RATE_LIMIT,
  IDEMPOTENCY_CONFLICT_MESSAGE,
  INTERNAL_MESSAGE,
  assertPjWorkspace,
  assertVersion,
  findIntentAnchor,
  type OperationOptions,
} from "./common";
import {
  CLIENT_PRIVATE_FIELDS,
  type ArchiveClientPayload,
  type ClientMutationResult,
  type CreateClientPayload,
  type UpdateClientPayload,
} from "./contracts";
import {
  CLIENT_EVENTS_COLLECTION,
  CLIENT_SCHEMA_VERSION,
  appendClientEvent,
  clientEventIdFor,
  clientEventsRef,
  clientIdFor,
  clientPrivateRef,
  clientsRef,
  intentIdFor,
  readAuthoritativeClient,
  receivablesRef,
  type AuthoritativeClient,
  type ClientEventOperation,
} from "./model";

/**
 * Operações autoritativas do cadastro de clientes (D-24, P3-I).
 *
 * Cada uma é uma transação que faz tudo ou nada: relê a autorização (conta,
 * membership, papel owner/admin, workspace ativo e PJ), reserva a chave de
 * idempotência do ator, procura a âncora durável da intenção, valida o estado
 * relido e só então grava cadastro, dados privados, evento e idempotência.
 *
 * O documento compartilhado (`clients`) só tem o nome e o estado; os dados
 * pessoais vão para `client_private`, que member e viewer não leem. O evento
 * de auditoria guarda só nomes de campos, nunca valores. Nenhuma exclusão:
 * arquivar é a única forma de tirar um cliente de uso, e é recusado enquanto
 * houver recebível em aberto.
 */
export const CREATE_CLIENT_OPERATION = "createClient";
export const UPDATE_CLIENT_OPERATION = "updateClient";
export const ARCHIVE_CLIENT_OPERATION = "archiveClient";

export const CLIENT_NOT_FOUND_MESSAGE = "Cliente não encontrado.";
export const INCONSISTENT_CLIENT_MESSAGE =
  "Este cliente tem dados inconsistentes e não pode ser alterado.";
export const CLIENT_CONFLICT_MESSAGE =
  "Este cliente foi alterado por outra operação depois que você o abriu. " +
  "Atualize e tente novamente.";
export const CLIENT_UNCHANGED_MESSAGE =
  "Nenhum dado foi alterado: os valores informados já são os atuais.";
export const CLIENT_ALREADY_ARCHIVED_MESSAGE =
  "Este cliente já está arquivado.";
export const CLIENT_HAS_OPEN_RECEIVABLES_MESSAGE =
  "Este cliente tem recebíveis em aberto. Receba ou cancele esses " +
  "recebíveis antes de arquivar o cliente.";

const db = () => admin.firestore();

const replayResult = (
  stored: Record<string, unknown>,
): ClientMutationResult => {
  if (typeof stored.clientId !== "string") {
    throw new ApplicationError("internal", INTERNAL_MESSAGE);
  }
  return {...(stored as unknown as ClientMutationResult), replayed: true};
};

const reserveClientRateLimit = (
  transaction: admin.firestore.Transaction,
  actor: WorkspaceActor,
) => reserveRateLimit(
  transaction,
  actor.workspaceId,
  actor.uid,
  CLIENT_MUTATION_RATE_LIMIT,
);

// ----------------------------------------------------------------- criação

export const executeCreateClient = async (
  actor: WorkspaceActor,
  payload: CreateClientPayload,
  requestId: string,
  options: OperationOptions = {},
): Promise<ClientMutationResult> =>
  db().runTransaction(async (transaction) => {
    const {workspace, role} = await reassertWorkspaceActor(
      transaction, actor, CLIENT_ADMIN_ROLES);
    assertPjWorkspace(workspace);
    const reservation = await reserveActorIdempotency(transaction, {
      uid: actor.uid,
      operation: CREATE_CLIENT_OPERATION,
      idempotencyKey: payload.idempotencyKey,
      payload,
    });
    if (reservation.replay) return replayResult(reservation.replay);

    const clientId = clientIdFor(
      actor.workspaceId, actor.uid, payload.idempotencyKey);
    const clientRef = clientsRef(actor.workspaceId).doc(clientId);
    // Âncora durável: o evento de criação (owner/admin), não o cadastro
    // compartilhado — o hash da intenção cobre os dados pessoais (D-24).
    const createdEventRef = clientEventsRef(actor.workspaceId)
      .doc(clientEventIdFor("client.created", clientId));
    const [existing, createdEvent] = await transaction.getAll(
      clientRef, createdEventRef);
    if (existing.exists || createdEvent.exists) {
      // Chave expirada, cadastro preservado: a âncora durável decide.
      if (
        existing.exists &&
        createdEvent.get("requestHash") === reservation.requestHash &&
        createdEvent.get("actorId") === actor.uid &&
        existing.get("createdBy") === actor.uid
      ) {
        return {clientId, replayed: true};
      }
      throw new ApplicationError("idempotency_conflict",
        IDEMPOTENCY_CONFLICT_MESSAGE);
    }
    const rateLimit = await reserveClientRateLimit(transaction, actor);

    const intentId = intentIdFor(actor.uid, payload.idempotencyKey);
    const privateValues = Object.fromEntries(CLIENT_PRIVATE_FIELDS
      .filter((field) => payload[field] !== undefined)
      .map((field) => [field, payload[field]]));
    transaction.create(clientRef, {
      clientId,
      schemaVersion: CLIENT_SCHEMA_VERSION,
      workspaceId: actor.workspaceId,
      name: payload.name,
      status: "active",
      createdBy: actor.uid,
      updatedBy: actor.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(clientPrivateRef(actor.workspaceId).doc(clientId), {
      id: clientId,
      schemaVersion: CLIENT_SCHEMA_VERSION,
      workspaceId: actor.workspaceId,
      clientId,
      ...privateValues,
      updatedBy: actor.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    appendClientEvent(transaction, {
      workspaceId: actor.workspaceId,
      clientId,
      operation: "client.created",
      targetKey: clientId,
      actorId: actor.uid,
      actorRole: role,
      intentId,
      requestHash: reservation.requestHash,
      requestId,
      correlationId: payload.correlationId ?? null,
      statusBefore: null,
      statusAfter: "active",
      changedFields: ["name", ...Object.keys(privateValues)],
    });
    const result = {clientId, status: "active"};
    completeActorIdempotency(transaction, reservation, {
      uid: actor.uid,
      operation: CREATE_CLIENT_OPERATION,
      workspaceId: actor.workspaceId,
      requestId,
      result,
    });
    rateLimit.commit();
    options.beforeCommit?.();
    return {...result, replayed: false};
  });

// ---------------------------------------------------------------- mutações

interface ClientMutationPayload {
  idempotencyKey: string;
  clientId: string;
  expectedUpdatedAt: string;
}

interface LoadedClient {
  role: WorkspaceRole;
  reservation: ActorIdempotencyReservation;
  intentId: string;
  client: AuthoritativeClient;
  clientRef: admin.firestore.DocumentReference;
  privateRef: admin.firestore.DocumentReference;
  privateData: admin.firestore.DocumentData;
}

type ClientLoadOutcome =
  | {replay: ClientMutationResult}
  | {loaded: LoadedClient};

const loadClientForMutation = async (
  transaction: admin.firestore.Transaction,
  actor: WorkspaceActor,
  payload: ClientMutationPayload,
  operation: string,
  eventOperation: ClientEventOperation,
): Promise<ClientLoadOutcome> => {
  const {workspace, role} = await reassertWorkspaceActor(
    transaction, actor, CLIENT_ADMIN_ROLES);
  assertPjWorkspace(workspace);
  const reservation = await reserveActorIdempotency(transaction, {
    uid: actor.uid,
    operation,
    idempotencyKey: payload.idempotencyKey,
    payload: payload as unknown as Record<string, unknown>,
  });
  if (reservation.replay) {
    return {replay: replayResult(reservation.replay)};
  }
  const intentId = intentIdFor(actor.uid, payload.idempotencyKey);
  const clientRef = clientsRef(actor.workspaceId).doc(payload.clientId);
  const privateRef = clientPrivateRef(actor.workspaceId).doc(payload.clientId);
  const [snapshot, privateSnapshot] = await transaction.getAll(
    clientRef, privateRef);
  const anchor = await findIntentAnchor(
    transaction, CLIENT_EVENTS_COLLECTION, intentId, eventOperation);
  if (anchor) {
    if (
      anchor.get("requestHash") !== reservation.requestHash ||
      anchor.get("actorId") !== actor.uid ||
      anchor.get("workspaceId") !== actor.workspaceId ||
      anchor.get("clientId") !== payload.clientId
    ) {
      throw new ApplicationError("idempotency_conflict",
        IDEMPOTENCY_CONFLICT_MESSAGE);
    }
    return {
      replay: {
        clientId: payload.clientId,
        ...(eventOperation === "client.updated" ? {changed: true} : {}),
        ...(eventOperation === "client.archived" ? {status: "archived"} : {}),
        replayed: true,
      },
    };
  }
  if (!snapshot.exists) {
    throw new ApplicationError("not_found", CLIENT_NOT_FOUND_MESSAGE);
  }
  const client = readAuthoritativeClient(
    snapshot.id, snapshot.data(), actor.workspaceId);
  if (!client) {
    throw new ApplicationError("domain_precondition_failed",
      INCONSISTENT_CLIENT_MESSAGE, {ineligible: "inconsistent"});
  }
  assertVersion(client.updatedAt, payload.expectedUpdatedAt,
    CLIENT_CONFLICT_MESSAGE);
  return {
    loaded: {
      role,
      reservation,
      intentId,
      client,
      clientRef,
      privateRef,
      privateData: privateSnapshot.data() ?? {},
    },
  };
};

// ----------------------------------------------------------------- edição

export const executeUpdateClient = async (
  actor: WorkspaceActor,
  payload: UpdateClientPayload,
  requestId: string,
  options: OperationOptions = {},
): Promise<ClientMutationResult> =>
  db().runTransaction(async (transaction) => {
    const outcome = await loadClientForMutation(
      transaction, actor, payload, UPDATE_CLIENT_OPERATION, "client.updated");
    if ("replay" in outcome) return outcome.replay;
    const {loaded} = outcome;
    const {client, privateData} = loaded;
    const {changes} = payload;

    const changedFields: string[] = [];
    if (changes.name !== undefined && changes.name !== client.name) {
      changedFields.push("name");
    }
    const privatePatch: Record<string, unknown> = {};
    for (const field of CLIENT_PRIVATE_FIELDS) {
      const next = changes[field];
      if (next === undefined) continue;
      const current = privateData[field];
      if (next === null) {
        if (current !== undefined && current !== null) {
          privatePatch[field] = FieldValue.delete();
          changedFields.push(field);
        }
      } else if (next !== current) {
        privatePatch[field] = next;
        changedFields.push(field);
      }
    }
    if (changedFields.length === 0) {
      throw new ApplicationError("domain_precondition_failed",
        CLIENT_UNCHANGED_MESSAGE);
    }
    const rateLimit = await reserveClientRateLimit(transaction, actor);

    transaction.update(loaded.clientRef, {
      ...(changedFields.includes("name") ? {name: changes.name} : {}),
      updatedBy: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (Object.keys(privatePatch).length > 0) {
      transaction.set(loaded.privateRef, {
        id: client.id,
        schemaVersion: CLIENT_SCHEMA_VERSION,
        workspaceId: actor.workspaceId,
        clientId: client.id,
        ...privatePatch,
        updatedBy: actor.uid,
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
    }
    appendClientEvent(transaction, {
      workspaceId: actor.workspaceId,
      clientId: client.id,
      operation: "client.updated",
      targetKey: loaded.intentId,
      actorId: actor.uid,
      actorRole: loaded.role,
      intentId: loaded.intentId,
      requestHash: loaded.reservation.requestHash,
      requestId,
      correlationId: payload.correlationId ?? null,
      statusBefore: client.status,
      statusAfter: client.status,
      changedFields: changedFields.sort(),
    });
    const result = {clientId: client.id, changed: true};
    completeActorIdempotency(transaction, loaded.reservation, {
      uid: actor.uid,
      operation: UPDATE_CLIENT_OPERATION,
      workspaceId: actor.workspaceId,
      requestId,
      result,
    });
    rateLimit.commit();
    options.beforeCommit?.();
    return {...result, replayed: false};
  });

// ---------------------------------------------------------- arquivamento

export const executeArchiveClient = async (
  actor: WorkspaceActor,
  payload: ArchiveClientPayload,
  requestId: string,
  options: OperationOptions = {},
): Promise<ClientMutationResult> =>
  db().runTransaction(async (transaction) => {
    const outcome = await loadClientForMutation(
      transaction, actor, payload, ARCHIVE_CLIENT_OPERATION, "client.archived");
    if ("replay" in outcome) return outcome.replay;
    const {loaded} = outcome;
    const {client} = loaded;
    if (client.status === "archived") {
      throw new ApplicationError("domain_precondition_failed",
        CLIENT_ALREADY_ARCHIVED_MESSAGE);
    }
    // Lido na transação: um recebível criado em paralelo lê o cliente (ativo)
    // na própria transação, e a escrita do arquivamento invalida essa leitura
    // — uma das duas é repetida e vê o estado novo.
    const open = await transaction.get(
      receivablesRef(actor.workspaceId)
        .where("clientId", "==", client.id)
        .where("status", "==", "open")
        .limit(1),
    );
    if (!open.empty) {
      throw new ApplicationError("domain_precondition_failed",
        CLIENT_HAS_OPEN_RECEIVABLES_MESSAGE);
    }
    const rateLimit = await reserveClientRateLimit(transaction, actor);

    // Quem arquivou e quando: `updatedBy`/`updatedAt` e o evento.
    transaction.update(loaded.clientRef, {
      status: "archived",
      updatedBy: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    appendClientEvent(transaction, {
      workspaceId: actor.workspaceId,
      clientId: client.id,
      operation: "client.archived",
      targetKey: client.id,
      actorId: actor.uid,
      actorRole: loaded.role,
      intentId: loaded.intentId,
      requestHash: loaded.reservation.requestHash,
      requestId,
      correlationId: payload.correlationId ?? null,
      statusBefore: "active",
      statusAfter: "archived",
    });
    const result = {clientId: client.id, status: "archived"};
    completeActorIdempotency(transaction, loaded.reservation, {
      uid: actor.uid,
      operation: ARCHIVE_CLIENT_OPERATION,
      workspaceId: actor.workspaceId,
      requestId,
      result,
    });
    rateLimit.commit();
    options.beforeCommit?.();
    return {...result, replayed: false};
  });
