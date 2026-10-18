import { useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import {
    deleteNotificationForMe, dismissNotification, getNotificationUnreadCount, listNotificationPage, markNotificationsAsRead,
} from './api';
import {
    useNotificationActions as useScopedNotificationActions,
    useNotificationFeed,
    useNotificationUnreadCount as useScopedNotificationUnreadCount,
    type NotificationApi,
} from './feed';
import { canDeleteNotifications, resolveNotificationScope } from './model';
import type { NotificationScope } from './types';

/**
 * Notificações do Header (P5-D1, PR-NOTIF-01): escopo da sessão (uid do
 * Firebase Auth + workspace ativo carregado para esse uid) ligado ao núcleo
 * do painel (`./feed.ts`) e à API do Firestore (`./api.ts`).
 */

const notificationApi: NotificationApi = {
    listPage: listNotificationPage,
    markAsRead: markNotificationsAsRead,
    dismiss: dismissNotification,
    deleteForMe: deleteNotificationForMe,
    getUnreadCount: getNotificationUnreadCount,
};

export const useNotificationScope = (): NotificationScope | null => {
    const { user } = useAuth();
    const { activeWorkspace, activeWorkspaceUid } = useWorkspace();
    const uid = user?.uid ?? null;
    const workspaceId = activeWorkspace?.id;
    return useMemo(
        () => resolveNotificationScope(uid, workspaceId, activeWorkspaceUid),
        [uid, workspaceId, activeWorkspaceUid],
    );
};

export const useNotifications = (scope: NotificationScope | null) =>
    useNotificationFeed(scope, notificationApi);

/** Total exato de não lidas (callable do backend) do escopo da sessão. */
export const useNotificationUnreadCount = (scope: NotificationScope | null) =>
    useScopedNotificationUnreadCount(scope, notificationApi);

export const useNotificationActions = (scope: NotificationScope | null) =>
    useScopedNotificationActions(scope, notificationApi);

/**
 * "Excluir para mim" só para owner, admin e member do workspace ativo
 * carregado para o mesmo uid do escopo (viewer arquiva, mas não exclui).
 * Enquanto o escopo é `null` ou o papel não é conhecido, `false`.
 */
export const useCanDeleteNotifications = (scope: NotificationScope | null): boolean => {
    const { activeWorkspaceUid, activeWorkspaceRole } = useWorkspace();
    return canDeleteNotifications(scope, activeWorkspaceUid, activeWorkspaceRole);
};
