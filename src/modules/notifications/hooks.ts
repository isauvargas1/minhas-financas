import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listNotifications, createNotification, markAsRead, markAllAsRead, deleteNotification } from './api';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { AppNotification } from '../../types';

const KEYS = {
    all: (ws: string) => ['notifications', ws]
};

export const useNotifications = () => {
    const { activeWorkspace } = useWorkspace();
    return useQuery({
        queryKey: KEYS.all(activeWorkspace.id),
        queryFn: () => listNotifications(activeWorkspace.id),
        enabled: !!activeWorkspace.id,
        refetchInterval: 30000, // Atualiza a cada 30s para ver se tem novidade
    });
};

// Hook para gerar notificações de dentro do sistema
export const useCreateNotification = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (data: Omit<AppNotification, 'id' | 'read' | 'createdAt'>) => 
            createNotification(data, activeWorkspace.id),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: KEYS.all(activeWorkspace.id) })
    });
};

export const useMarkAsRead = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => markAsRead(id, activeWorkspace.id),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: KEYS.all(activeWorkspace.id) })
    });
};

export const useMarkAllAsRead = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (ids: string[]) => markAllAsRead(ids, activeWorkspace.id),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: KEYS.all(activeWorkspace.id) })
    });
};

export const useDeleteNotification = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => deleteNotification(id, activeWorkspace.id),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: KEYS.all(activeWorkspace.id) })
    });
};

// Adicionado para compatibilidade com o Header
export const useArchiveNotification = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    
    return useMutation({
        // Para simplificar, estamos tratando "arquivar" como "deletar" da caixa de entrada
        mutationFn: (id: string) => deleteNotification(id, activeWorkspace.id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: KEYS.all(activeWorkspace.id) });
        }
    });
};

// Adicionado para compatibilidade com o nome esperado pelo Header
export const useMarkAllNotificationsAsRead = useMarkAllAsRead;
// Adicionado para compatibilidade com o nome esperado pelo Header
export const useMarkNotificationAsRead = useMarkAsRead;

// Adicionado para calcular a quantidade de notificações não lidas para o Header
export const useUnreadNotificationCount = () => {
    const { data: notifications = [] } = useNotifications();
    return notifications.filter(n => !n.read).length;
};