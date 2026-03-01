import { 
    collection, 
    getDocs, 
    addDoc, 
    updateDoc, 
    deleteDoc, 
    doc, 
    query, 
    orderBy, 
    where,
    writeBatch
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { AppNotification } from '../../types';

const COLLECTION = 'notifications';

export const listNotifications = async (workspaceId?: string): Promise<AppNotification[]> => {
    if (!workspaceId) return [];

    try {
        const ref = collection(db, 'workspaces', workspaceId, COLLECTION);
        // Busca as mais recentes primeiro
        const q = query(ref, orderBy('createdAt', 'desc'));
        const snapshot = await getDocs(q);
        
        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        } as AppNotification));
    } catch (error) {
        console.error("Erro ao buscar notificações:", error);
        return [];
    }
};

export const createNotification = async (
    notification: Omit<AppNotification, 'id' | 'read' | 'createdAt'>, 
    workspaceId?: string
): Promise<void> => {
    if (!workspaceId) return;

    const ref = collection(db, 'workspaces', workspaceId, COLLECTION);
    await addDoc(ref, {
        ...notification,
        read: false,
        createdAt: new Date().toISOString()
    });
};

export const markAsRead = async (id: string, workspaceId?: string): Promise<void> => {
    if (!workspaceId) return;
    const ref = doc(db, 'workspaces', workspaceId, COLLECTION, id);
    await updateDoc(ref, { read: true });
};

export const markAllAsRead = async (notificationIds: string[], workspaceId?: string): Promise<void> => {
    if (!workspaceId || notificationIds.length === 0) return;
    
    const batch = writeBatch(db);
    notificationIds.forEach(id => {
        const ref = doc(db, 'workspaces', workspaceId, COLLECTION, id);
        batch.update(ref, { read: true });
    });
    await batch.commit();
};

export const deleteNotification = async (id: string, workspaceId?: string): Promise<void> => {
    if (!workspaceId) return;
    const ref = doc(db, 'workspaces', workspaceId, COLLECTION, id);
    await deleteDoc(ref);
};