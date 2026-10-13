import * as admin from "firebase-admin";
import type {Timestamp} from "firebase-admin/firestore";
import {z} from "zod";

import {defineCallable} from "../shared/callable";
import {ApplicationError} from "../shared/errors";
import {workspaceIdSchema} from "../shared/ids";
import {reserveRateLimit, type RateLimitPolicy} from "../shared/rateLimit";
import {DOMAIN_CALLABLE_OPTIONS} from "../shared/runtimeOptions";
import {
  WORKSPACE_ROLES,
  evaluateWorkspaceAccess,
  userProfileRef,
  workspaceMemberRef,
  workspaceRef,
  type WorkspaceActor,
} from "../shared/workspaceAuth";
import {notificationsRef} from "./publish";

/**
 * `getNotificationUnreadCount` (P5-D2, PR-NOTIF-01): total exato de
 * notificações não lidas do usuário no workspace.
 *
 * Definição: eventos de `workspaces/{ws}/notifications` ainda não expirados
 * (todo evento é visível a todo membro ativo) sem nenhuma marca do usuário
 * (lida, arquivada ou excluída para si).
 *
 *   não_lidas(u, ws, t) = |eventos com expiresAt > t|
 *                         − |estados de u com expiresAt > t|
 *
 Tudo é lido numa única transação somente leitura, que lê um único
 * instante do banco: primeiro o ator (perfil, workspace e membership), cujo
 * `readTime` — dado pelo servidor — passa a ser `t`; depois as duas
 * agregações `count()`, filtradas por `expiresAt > t` no mesmo instante
 * (conferido: o `readTime` das agregações tem de ser igual a `t`). Como `t`
 * é o instante do próprio banco, nada que já expirou em `t` entra na conta e
 * nada que ainda vale em `t` pode ter sido removido pelo TTL (que só remove
 * depois de `expiresAt`); o atraso e a ordem da remoção física não afetam o
 * resultado. E toda escrita confirmada antes da chamada (uma marca de
 * leitura, um evento publicado, um membership recém-aceito) já está em `t`.
 * A subtração é exata porque as Rules e o produtor garantem:
 *
 * 1. todo estado tem o evento de mesmo ID e mesmo `expiresAt` (a criação lê
 *    o evento e exige igualdade; a atualização não muda `expiresAt`; nenhum
 *    papel apaga estado);
 * 2. todo estado tem ao menos uma marca, monotônica, e qualquer marca tira o
 *    evento das não lidas;
 * 3. um estado por (usuário, evento): o ID do documento é o ID do evento;
 * 4. nenhum evento é alterado nem apagado antes de expirar (só o backend
 *    grava, com `create`; só o TTL remove);
 * 5. não existe evento dirigido: o builder único valida o contrato de todo
 *    produtor (`contract.ts`).
 *
 * Um resultado negativo significa invariante violado: a contagem é
 * recusada (indisponível) e o desvio vai para o log — nunca `Math.max(0, …)`.
 *
 * Autorização: pré-checagem do kernel (conta ativa, workspace ativo,
 * membership real, papel do servidor) e releitura do ator dentro da
 * transação das contagens, no mesmo instante `t`. O uid vem só do token.
 * Somente leitura: a única escrita é o contador de frequência, numa
 * transação própria antes das contagens (uma agregação dentro de transação
 * de escrita travaria os produtores).
 *
 * Custo por chamada: 3 leituras da pré-checagem, 1 leitura + 1 escrita do
 * limite, 3 leituras da releitura e 1 leitura por bloco de até 1.000
 * entradas de índice em cada agregação (índice ascendente de `expiresAt`
 * declarado nos overrides de TTL de `firestore.indexes.json`).
 */
export const NOTIFICATION_UNREAD_COUNT_OPERATION = "getNotificationUnreadCount";

export const NOTIFICATION_UNREAD_COUNT_RATE_LIMIT: RateLimitPolicy = {
  operation: NOTIFICATION_UNREAD_COUNT_OPERATION,
  limit: 600,
  windowSeconds: 60 * 60,
};

/** Todo membro ativo lê as notificações do workspace, inclusive viewer. */
export const NOTIFICATION_READER_ROLES = WORKSPACE_ROLES;

export const UNREAD_COUNT_UNAVAILABLE_MESSAGE =
  "Não foi possível obter o total de notificações não lidas agora. " +
  "Tente novamente em instantes.";

export const getNotificationUnreadCountPayloadSchema = z.object({
  workspaceId: workspaceIdSchema,
}).strict();

export interface NotificationUnreadCount {
  unreadCount: number;
  /**
   * Instante exato do banco em que ator e contagens foram lidos, em RFC 3339
   * com nanossegundos (ex.: `2026-10-11T15:59:31.932750000Z`): toda escrita
   * confirmada até ele está no total; nenhuma posterior está.
   */
  asOf: string;
}

/** `Timestamp` em RFC 3339 com nanossegundos, sem perder precisão. */
export const exactInstant = (time: Timestamp): string =>
  new Date(time.seconds * 1000).toISOString().replace(".000Z",
    `.${String(time.nanoseconds).padStart(9, "0")}Z`);

const userStatesRef = (workspaceId: string, uid: string) =>
  workspaceRef(workspaceId).collection("notification_user_states").doc(uid)
    .collection("notification_entries");

/** Diferença validada; `null` quando o invariante não se sustenta. */
export const unreadFromCounts = (
  events: number,
  states: number,
): number | null => {
  if (!Number.isSafeInteger(events) || !Number.isSafeInteger(states)) {
    return null;
  }
  if (events < 0 || states < 0) return null;
  const unread = events - states;
  return unread >= 0 ? unread : null;
};

export interface UnreadCountSnapshot {
  events: number;
  states: number;
  /** Instante único do banco em que ator e contagens foram lidos. */
  readTime: Timestamp;
}

/** Releitura do ator e as duas contagens, num único instante do banco. */
export const readUnreadCount = async (
  actor: WorkspaceActor,
): Promise<UnreadCountSnapshot> =>
  admin.firestore().runTransaction(async (transaction) => {
    const [profile, workspace, member] = await transaction.getAll(
      userProfileRef(actor.uid),
      workspaceRef(actor.workspaceId),
      workspaceMemberRef(actor.workspaceId, actor.uid),
    );
    evaluateWorkspaceAccess({profile, workspace, member},
      NOTIFICATION_READER_ROLES);
    const readTime = profile.readTime;
    const [events, states] = await Promise.all([
      transaction.get(notificationsRef(actor.workspaceId)
        .where("expiresAt", ">", readTime).count()),
      transaction.get(userStatesRef(actor.workspaceId, actor.uid)
        .where("expiresAt", ">", readTime).count()),
    ]);
    if (!events.readTime.isEqual(readTime) ||
      !states.readTime.isEqual(readTime)) {
      // A transação somente leitura garante um único instante; se não, as
      // duas contagens não são comparáveis e nenhum número é exato.
      throw new Error("unread_count_snapshot_mismatch");
    }
    return {
      events: events.data().count,
      states: states.data().count,
      readTime,
    };
  }, {readOnly: true});

const requireActor = (actor: WorkspaceActor | null): WorkspaceActor => {
  if (!actor) throw new Error("notification_unread_count_without_actor");
  return actor;
};

export const getNotificationUnreadCount = defineCallable({
  operation: NOTIFICATION_UNREAD_COUNT_OPERATION,
  schema: getNotificationUnreadCountPayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: NOTIFICATION_READER_ROLES,
  internalMessage: UNREAD_COUNT_UNAVAILABLE_MESSAGE,
  handler: async ({actor: resolved, log}): Promise<NotificationUnreadCount> => {
    const actor = requireActor(resolved);
    await admin.firestore().runTransaction(async (transaction) => {
      const reservation = await reserveRateLimit(transaction,
        actor.workspaceId, actor.uid, NOTIFICATION_UNREAD_COUNT_RATE_LIMIT);
      reservation.commit();
    });
    const {events, states, readTime} = await readUnreadCount(actor);
    const unread = unreadFromCounts(events, states);
    if (unread === null) {
      // Estado sem evento, evento apagado antes de expirar ou contrato
      // violado: não há número exato a entregar.
      log.error("notification_unread_count_invariant_violated",
        new Error("unread_count_negative"), {events, states});
      throw new ApplicationError("internal", UNREAD_COUNT_UNAVAILABLE_MESSAGE);
    }
    log.info("notification_unread_count", {events, states, unread});
    return {unreadCount: unread, asOf: exactInstant(readTime)};
  },
});
