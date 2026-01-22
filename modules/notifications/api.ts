
import { NotificationItem } from './types.ts';

const KEY_NOTIFICATIONS = 'app_notifications';

const getKey = (base: string, workspaceId?: string) => {
    if (!workspaceId || workspaceId === 'personal') return base;
    return `${base}_${workspaceId}`;
};

// Mock Data for personal workspace
const MOCK_NOTIFICATIONS: NotificationItem[] = [
    {
        id: '1',
        type: 'meta',
        title: 'Meta Atingida! 🎉',
        message: 'Você atingiu 50% da meta "Viagem Europa 2026". Parabéns!',
        createdAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
        status: 'unread',
        actionRoute: 'goals',
        actionLabel: 'Ver Meta'
    },
    {
        id: '2',
        type: 'cartaoCredito',
        title: 'Fatura Fechada',
        message: 'A fatura do Nubank Gold fechou em R$ 1.250,00.',
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
        status: 'unread',
        actionRoute: 'cards',
        actionLabel: 'Ver Fatura'
    },
    // ... others
];

// Load from storage or initialize
const loadNotifications = (workspaceId?: string): NotificationItem[] => {
    const key = getKey(KEY_NOTIFICATIONS, workspaceId);
    const stored = localStorage.getItem(key);
    if (stored) {
        return JSON.parse(stored);
    }
    // Initialize mock only for personal
    if (key === KEY_NOTIFICATIONS) {
        localStorage.setItem(key, JSON.stringify(MOCK_NOTIFICATIONS));
        return MOCK_NOTIFICATIONS;
    }
    return [];
};

const saveNotifications = (notifications: NotificationItem[], workspaceId?: string) => {
    localStorage.setItem(getKey(KEY_NOTIFICATIONS, workspaceId), JSON.stringify(notifications));
};

export const getNotifications = async (workspaceId?: string): Promise<NotificationItem[]> => {
    await new Promise(resolve => setTimeout(resolve, 400));
    return loadNotifications(workspaceId).filter(n => n.status !== 'archived').sort((a, b) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
};

export const createNotification = async (notification: Omit<NotificationItem, 'id' | 'createdAt' | 'status'>, workspaceId?: string): Promise<NotificationItem> => {
    const all = loadNotifications(workspaceId);
    const today = new Date().toISOString().split('T')[0];
    const duplicate = all.find(n => n.title === notification.title && n.createdAt.startsWith(today));
    
    if (duplicate) return duplicate;

    const newNotification: NotificationItem = {
        id: Date.now().toString(),
        createdAt: new Date().toISOString(),
        status: 'unread',
        ...notification
    };
    
    saveNotifications([newNotification, ...all], workspaceId);
    return newNotification;
};

export const markNotificationAsRead = async (id: string, workspaceId?: string): Promise<void> => {
    await new Promise(resolve => setTimeout(resolve, 200));
    const all = loadNotifications(workspaceId);
    const updated = all.map(n => n.id === id ? { ...n, status: 'read' as const } : n);
    saveNotifications(updated, workspaceId);
};

export const markAllNotificationsAsRead = async (workspaceId?: string): Promise<void> => {
    await new Promise(resolve => setTimeout(resolve, 300));
    const all = loadNotifications(workspaceId);
    const updated = all.map(n => n.status === 'unread' ? { ...n, status: 'read' as const } : n);
    saveNotifications(updated, workspaceId);
};

export const archiveNotification = async (id: string, workspaceId?: string): Promise<void> => {
    await new Promise(resolve => setTimeout(resolve, 200));
    const all = loadNotifications(workspaceId);
    const updated = all.map(n => n.id === id ? { ...n, status: 'archived' as const } : n);
    saveNotifications(updated, workspaceId);
};
