
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from './api.ts';
import { ChatThread } from './types.ts';
import { useWorkspace } from '../../contexts/WorkspaceContext.tsx';

const keys = {
    threads: (ws: string) => ['chatThreads', ws],
    messages: (id: string, ws: string) => ['chatMessages', id, ws],
    users: (query: string) => ['chatUsers', query],
};

export const useChatThreads = () => {
    const { activeWorkspace } = useWorkspace();
    return useQuery({
        queryKey: keys.threads(activeWorkspace.id),
        queryFn: () => api.getChatThreads(activeWorkspace.id),
        staleTime: 1000 * 60,
        enabled: !!activeWorkspace.id
    });
};

export const useThreadMessages = (threadId: string | null) => {
    const { activeWorkspace } = useWorkspace();
    return useQuery({
        queryKey: keys.messages(threadId || '', activeWorkspace.id),
        queryFn: () => api.getThreadMessages(threadId!, activeWorkspace.id),
        enabled: !!threadId && !!activeWorkspace.id,
    });
};

export const useUnreadMessagesCount = () => {
    const { data } = useChatThreads();
    if (!data) return 0;
    return data.reduce((acc, thread) => acc + thread.unreadCount, 0);
};

export const useMarkThreadAsRead = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (threadId: string) => api.markThreadAsRead(threadId, activeWorkspace.id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: keys.threads(activeWorkspace.id) });
        }
    });
};

export const useSendMessage = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ threadId, content }: { threadId: string; content: string }) => 
            api.sendMessage(threadId, content, activeWorkspace.id),
        onSuccess: (newMessage, variables) => {
            // Update messages list
            queryClient.setQueryData(keys.messages(variables.threadId, activeWorkspace.id), (old: any) => {
                return old ? [...old, newMessage] : [newMessage];
            });
            // Invalidate threads to update last message preview and order
            queryClient.invalidateQueries({ queryKey: keys.threads(activeWorkspace.id) });
        }
    });
};

export const useCreateConversation = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ participantIds, name }: { participantIds: string[], name?: string }) =>
            api.createConversation(participantIds, name, activeWorkspace.id),
        onSuccess: (newThread) => {
            queryClient.setQueryData(keys.threads(activeWorkspace.id), (old: ChatThread[] | undefined) => {
                if (!old) return [newThread];
                const exists = old.some(t => t.id === newThread.id);
                if (exists) return old.map(t => t.id === newThread.id ? newThread : t);
                return [newThread, ...old];
            });
            queryClient.invalidateQueries({ queryKey: keys.threads(activeWorkspace.id) });
        }
    });
};

export const useSearchUsers = (query: string) => {
    return useQuery({
        queryKey: keys.users(query),
        queryFn: () => api.searchUsers(query),
        placeholderData: (prev) => prev,

    });
};
