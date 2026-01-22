
export interface ChatUser {
    id: string;
    name: string;
    avatar?: string; // emoji or url
    status?: 'online' | 'offline' | 'busy';
}

export interface ChatMessage {
    id: string;
    threadId: string;
    senderId: string;
    content: string;
    timestamp: string;
    isRead: boolean;
    status?: 'sending' | 'sent' | 'error'; // Optimistic updates
}

export interface ChatThread {
    id: string;
    participants: ChatUser[]; // Excludes current user usually, or list all
    lastMessage: ChatMessage;
    unreadCount: number;
    isGroup: boolean;
    groupName?: string;
    relatedGroupId?: string; // Links to Split Expenses Group ID
    updatedAt: string; // Helper for sorting
}
