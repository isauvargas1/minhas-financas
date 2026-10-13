import {
    collection,
    doc,
    documentId,
    getDocs,
    limit,
    orderBy,
    query,
    runTransaction,
    serverTimestamp,
    startAfter,
    where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../lib/firebase';
import { bindNotificationCallables, type NotificationInvoke } from './callables.ts';
import {
    NOTIFICATIONS_PAGE_SIZE,
    buildNotificationPage,
    chunkIds,
    markNotificationBatch,
    toNotificationUserState,
    type NotificationMark,
} from './model.ts';
import type {
    NotificationCursor,
    NotificationPage,
    NotificationScope,
    NotificationUserState,
} from './types.ts';

/**
 * Notificações (P5-D1, PR-NOTIF-01). O evento compartilhado é só lido; o
 * cliente grava apenas o estado privado do próprio usuário (lida, arquivada
 * ou excluída para si). Regras puras em
 * `./model.ts`; Rules em `firestore.rules` (`notifications` e
 * `notification_user_states`).
 */

const COLLECTION = 'notifications';
const STATES = 'notification_user_states';
const ENTRIES = 'notification_entries';

const notificationsRef = (scope: NotificationScope) =>
    collection(db, 'workspaces', scope.workspaceId, COLLECTION);

const statesRef = (scope: NotificationScope) =>
    collection(db, 'workspaces', scope.workspaceId, STATES, scope.uid, ENTRIES);

/** Estados privados de até 30 notificações, numa consulta só (limite do `in`). */
const readStates = async (
    scope: NotificationScope,
    ids: readonly string[],
): Promise<Map<string, NotificationUserState>> => {
    const states = new Map<string, NotificationUserState>();
    if (ids.length === 0) return states;
    const snapshot = await getDocs(query(
        statesRef(scope),
        where(documentId(), 'in', [...ids]),
        limit(ids.length),
    ));
    for (const entry of snapshot.docs) states.set(entry.id, toNotificationUserState(entry.data()));
    return states;
};

/**
 * Uma página do painel: mais recentes primeiro, desempate pelo ID, a partir
 * do cursor. Lê `NOTIFICATIONS_PAGE_SIZE + 1` eventos (o excedente só indica
 * que há mais) e o estado privado dos itens da página. Erros sobem para a
 * interface: falha de permissão não vira lista vazia.
 */
export const listNotificationPage = async (
    scope: NotificationScope,
    cursor: NotificationCursor | null,
): Promise<NotificationPage> => {
    const snapshot = await getDocs(query(
        notificationsRef(scope),
        orderBy('createdAt', 'desc'),
        orderBy(documentId(), 'desc'),
        ...(cursor ? [startAfter(cursor.createdAt, cursor.id)] : []),
        limit(NOTIFICATIONS_PAGE_SIZE + 1),
    ));
    const docs = snapshot.docs.map((entry) => ({ id: entry.id, data: entry.data() }));
    const states = await readStates(scope, docs.slice(0, NOTIFICATIONS_PAGE_SIZE).map((entry) => entry.id));
    return buildNotificationPage(docs, states, NOTIFICATIONS_PAGE_SIZE);
};

const eventRef = (scope: NotificationScope, id: string) =>
    doc(notificationsRef(scope), id);

/**
 * Marca (lida, arquivada ou excluída para si) no estado privado do usuário,
 * em transação por lote (`markNotificationBatch` em `./model.ts`): lê os
 * estados e, para os que serão criados, o evento compartilhado (de onde vem o
 * `expiresAt`), tudo antes da primeira escrita. Repetir é inofensivo e uma
 * aba desatualizada não falha por tentar remarcar. Devolve os IDs marcados
 * (incluídos os que já estavam marcados); evento ausente ou expirado não é
 * gravado nem devolvido.
 */
const applyMark = async (scope: NotificationScope, ids: readonly string[], mark: NotificationMark): Promise<string[]> => {
    const done: string[] = [];
    for (const chunk of chunkIds(ids)) {
        const marked = await runTransaction(db, (transaction) =>
            markNotificationBatch(
                transaction,
                chunk.map((id) => ({ id, stateRef: doc(statesRef(scope), id), eventRef: eventRef(scope, id) })),
                mark,
                Date.now(),
                serverTimestamp(),
            ));
        done.push(...marked);
    }
    return done;
};

export const markNotificationsAsRead = (scope: NotificationScope, ids: readonly string[]) =>
    applyMark(scope, ids, 'read');

/** Arquivar é só para o próprio usuário: o evento continua para os demais. */
export const dismissNotification = (scope: NotificationScope, id: string) =>
    applyMark(scope, [id], 'dismissed');

/** Excluir para mim (owner, admin e member): marca `deleted`; o evento fica para os demais. */
export const deleteNotificationForMe = (scope: NotificationScope, id: string) =>
    applyMark(scope, [id], 'deleted');

const invoke: NotificationInvoke = async <TResult>(name: string, payload: Record<string, unknown>) =>
    (await httpsCallable<Record<string, unknown>, TResult>(functions, name)(payload)).data;

const notificationCallables = bindNotificationCallables(invoke);

/**
 * Total exato de não lidas do usuário no workspace (callable do backend).
 * Erro ou resposta fora do contrato sobem: a contagem fica indisponível.
 */
export const getNotificationUnreadCount = (scope: NotificationScope): Promise<number> =>
    notificationCallables.getUnreadCount(scope);
