
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from './api.ts';
import { useWorkspace } from '../../contexts/WorkspaceContext.tsx';

const keys = {
    all: (ws: string) => ['notifications', ws],
};

export const useNotifications = () => {
    const { activeWorkspace } = useWorkspace();
    return useQuery({
        queryKey: keys.all(activeWorkspace.id),
        queryFn: () => api.getNotifications(activeWorkspace.id),
        staleTime: 1000 * 60,
        enabled: !!activeWorkspace.id
    });
};

export const useUnreadNotificationCount = () => {
    const { data } = useNotifications();
    return data?.filter(n => n.status === 'unread').length || 0;
};

export const useCreateNotification = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (data: any) => api.createNotification(data, activeWorkspace.id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: keys.all(activeWorkspace.id) });
        }
    });
};

export const useMarkNotificationAsRead = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.markNotificationAsRead(id, activeWorkspace.id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: keys.all(activeWorkspace.id) });
        }
    });
};

export const useMarkAllNotificationsAsRead = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: () => api.markAllNotificationsAsRead(activeWorkspace.id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: keys.all(activeWorkspace.id) });
        }
    });
};

export const useArchiveNotification = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.archiveNotification(id, activeWorkspace.id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: keys.all(activeWorkspace.id) });
        }
    });
};
