import * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";

import {ApplicationError} from "./errors";
import {sha256, stableStringify} from "./hashing";
import {RETENTION_DAYS, expiresInDays} from "./retention";
import {userProfileRef} from "./workspaceAuth";

/**
 * Idempotência por ator para as callables do kernel de P1.
 *
 * A chave pertence a quem a enviou: o documento vive em
 * `users/{uid}/idempotency_keys/{operation}_{hash(uid:key)}`, e não sob o
 * workspace, porque o aceite de convite ainda não conhece o workspace quando
 * reserva a chave. As Rules negam acesso do cliente.
 *
 * Reserva e conclusão acontecem **dentro** da transação da operação (a reserva
 * na fase de leitura, a conclusão na de escrita). Os domínios financeiros
 * mantêm a própria idempotência transacional; este helper não a substitui.
 */
export interface ActorIdempotencyReservation {
  ref: admin.firestore.DocumentReference;
  requestHash: string;
  replay?: Record<string, unknown>;
}

/** Campos que identificam a intenção: tudo, menos metadados de transporte. */
export const idempotencyIdentity = (
  payload: Record<string, unknown>,
): Record<string, unknown> => {
  const identity = {...payload};
  delete identity.idempotencyKey;
  delete identity.correlationId;
  return identity;
};

export const reserveActorIdempotency = async (
  transaction: admin.firestore.Transaction,
  input: {
    uid: string;
    operation: string;
    idempotencyKey: string;
    payload: Record<string, unknown>;
  },
): Promise<ActorIdempotencyReservation> => {
  const id = `${input.operation}_` +
    sha256(`${input.uid}:${input.idempotencyKey}`).slice(0, 32);
  const ref = userProfileRef(input.uid).collection("idempotency_keys").doc(id);
  const requestHash = sha256(
    stableStringify(idempotencyIdentity(input.payload)),
  );
  const snapshot = await transaction.get(ref);
  if (!snapshot.exists) return {ref, requestHash};
  const data = snapshot.data() ?? {};
  if (
    data.operation !== input.operation ||
    data.actorId !== input.uid ||
    data.requestHash !== requestHash
  ) {
    throw new ApplicationError(
      "idempotency_conflict",
      "Esta chave de idempotência já foi usada com outros dados.",
    );
  }
  if (typeof data.result !== "object" || data.result === null) {
    throw new ApplicationError(
      "idempotency_conflict",
      "Esta solicitação já está em processamento.",
    );
  }
  return {ref, requestHash, replay: data.result as Record<string, unknown>};
};

export const completeActorIdempotency = (
  transaction: admin.firestore.Transaction,
  reservation: ActorIdempotencyReservation,
  input: {
    uid: string;
    operation: string;
    workspaceId: string | null;
    requestId: string;
    result: Record<string, unknown>;
  },
): void => {
  transaction.create(reservation.ref, {
    id: reservation.ref.id,
    operation: input.operation,
    actorId: input.uid,
    workspaceId: input.workspaceId,
    requestHash: reservation.requestHash,
    requestId: input.requestId,
    status: "completed",
    result: input.result,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: expiresInDays(RETENTION_DAYS.idempotencyKeys),
  });
};
