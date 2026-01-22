
import { ChatThread, ChatMessage, ChatUser } from './types.ts';

// Mock Data remains globally available for 'personal' context simulation
const MOCK_THREADS: ChatThread[] = [
    {
        id: 't1',
        isGroup: true,
        groupName: 'Casa Dividida',
        relatedGroupId: '1', 
        participants: [
            { id: '2', name: 'Alice', avatar: '👩' },
            { id: '3', name: 'Bruno', avatar: '👨' }
        ],
        unreadCount: 2,
        lastMessage: {
            id: 'm1',
            threadId: 't1',
            senderId: '2',
            content: 'Alguém já pagou a conta de luz?',
            timestamp: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
            isRead: false
        },
        updatedAt: new Date(Date.now() - 1000 * 60 * 15).toISOString()
    },
    // ... other mocks can be omitted for brevity or kept if full file is rewritten
];

// Helper to get key
const getKey = (base: string, workspaceId?: string) => {
    if (!workspaceId || workspaceId === 'personal') return base;
    return `${base}_${workspaceId}`;
};

const KEY_THREADS = 'app_chat_threads';
const KEY_MESSAGES = 'app_chat_messages';

// Loaders
const loadThreads = (workspaceId?: string): ChatThread[] => {
    const key = getKey(KEY_THREADS, workspaceId);
    const stored = localStorage.getItem(key);
    if (stored) return JSON.parse(stored);
    
    // Only return mocks for personal workspace
    if (key === KEY_THREADS) {
        localStorage.setItem(key, JSON.stringify(MOCK_THREADS));
        return MOCK_THREADS;
    }
    return [];
};

const loadMessages = (workspaceId?: string): Record<string, ChatMessage[]> => {
    const key = getKey(KEY_MESSAGES, workspaceId);
    const stored = localStorage.getItem(key);
    if (stored) return JSON.parse(stored);
    // Init empty for others
    return {};
}

const saveThreads = (threads: ChatThread[], workspaceId?: string) => {
    localStorage.setItem(getKey(KEY_THREADS, workspaceId), JSON.stringify(threads));
};

const saveMessages = (messages: Record<string, ChatMessage[]>, workspaceId?: string) => {
    localStorage.setItem(getKey(KEY_MESSAGES, workspaceId), JSON.stringify(messages));
}

// API
export const getChatThreads = async (workspaceId?: string): Promise<ChatThread[]> => {
    await new Promise(resolve => setTimeout(resolve, 300));
    return loadThreads(workspaceId).sort((a, b) => 
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
};

export const getThreadMessages = async (threadId: string, workspaceId?: string): Promise<ChatMessage[]> => {
    await new Promise(resolve => setTimeout(resolve, 200));
    const all = loadMessages(workspaceId);
    return all[threadId] || [];
};

export const sendMessage = async (threadId: string, content: string, workspaceId?: string): Promise<ChatMessage> => {
    await new Promise(resolve => setTimeout(resolve, 300));
    
    const timestamp = new Date().toISOString();
    const newMessage: ChatMessage = {
        id: Date.now().toString(),
        threadId,
        senderId: 'me',
        content,
        timestamp,
        isRead: true,
        status: 'sent'
    };

    // Update Messages
    const allMessages = loadMessages(workspaceId);
    const threadMessages = allMessages[threadId] || [];
    allMessages[threadId] = [...threadMessages, newMessage];
    saveMessages(allMessages, workspaceId);

    // Update Threads
    const allThreads = loadThreads(workspaceId);
    const updatedThreads = allThreads.map(t => {
        if (t.id === threadId) {
            return {
                ...t,
                lastMessage: newMessage,
                updatedAt: timestamp
            };
        }
        return t;
    });
    
    saveThreads(updatedThreads, workspaceId);

    return newMessage;
};

export const markThreadAsRead = async (threadId: string, workspaceId?: string): Promise<void> => {
    await new Promise(resolve => setTimeout(resolve, 100));
    const all = loadThreads(workspaceId);
    const updated = all.map(t => {
        if (t.id === threadId) {
            return {
                ...t,
                unreadCount: 0,
                lastMessage: { ...t.lastMessage, isRead: true }
            };
        }
        return t;
    });
    saveThreads(updated, workspaceId);
};

export const createConversation = async (participantIds: string[], name?: string, workspaceId?: string): Promise<ChatThread> => {
    await new Promise(resolve => setTimeout(resolve, 600));
    const allThreads = loadThreads(workspaceId);

    // Check if 1:1 already exists
    if (participantIds.length === 1 && !name) {
        const existing = allThreads.find(t => !t.isGroup && t.participants.some(p => p.id === participantIds[0]));
        if (existing) return existing;
    }

    // Mock User Database access (Simulated)
    // Ideally this should also be workspace aware or global users
    const MOCK_USERS = [
        { id: '2', name: 'Alice', avatar: '👩' },
        { id: '3', name: 'Bruno', avatar: '👨' },
        { id: '5', name: 'Carla', avatar: '👩‍🦰' },
        { id: '6', name: 'Daniel', avatar: '🧔' },
        { id: '7', name: 'Eduarda', avatar: '👩‍🦳' },
    ];
    
    const participants = MOCK_USERS.filter(u => participantIds.includes(u.id));
    const threadId = Date.now().toString();
    const timestamp = new Date().toISOString();

    const newThread: ChatThread = {
        id: threadId,
        isGroup: participantIds.length > 1,
        groupName: name,
        participants,
        unreadCount: 0,
        lastMessage: {
            id: 'msg_init_' + threadId,
            threadId: threadId,
            senderId: 'system',
            content: participantIds.length > 1 ? `Grupo "${name}" criado` : 'Nova conversa iniciada',
            timestamp: timestamp,
            isRead: true
        },
        updatedAt: timestamp
    };

    saveThreads([newThread, ...allThreads], workspaceId);
    
    const allMessages = loadMessages(workspaceId);
    allMessages[threadId] = [];
    saveMessages(allMessages, workspaceId);

    return newThread;
};

export const searchUsers = async (query: string): Promise<(ChatUser & { role?: string })[]> => {
    await new Promise(resolve => setTimeout(resolve, 300));
    // Users are global for this mock
    const MOCK_USERS = [
        { id: '2', name: 'Alice', avatar: '👩', role: 'Designer' },
        { id: '3', name: 'Bruno', avatar: '👨', role: 'Developer' },
        { id: '5', name: 'Carla', avatar: '👩‍🦰', role: 'Manager' },
        { id: '6', name: 'Daniel', avatar: '🧔', role: 'Analyst' },
        { id: '7', name: 'Eduarda', avatar: '👩‍🦳', role: 'Product Owner' },
    ];

    if (!query.trim()) return MOCK_USERS;
    
    const lowerQuery = query.toLowerCase();
    return MOCK_USERS.filter(u => 
        u.name.toLowerCase().includes(lowerQuery) || 
        (u.role && u.role.toLowerCase().includes(lowerQuery))
    );
};
