import { 
    collection, 
    doc, 
    getDocs, 
    addDoc, 
    updateDoc, 
    deleteDoc, 
    Timestamp 
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { Goal } from '../../types';

const COLLECTION_NAME = 'goals';

// Helper recursivo para limpar undefined
const cleanPayload = (obj: any): any => {
    if (Array.isArray(obj)) {
        return obj.map(v => cleanPayload(v));
    } else if (obj !== null && typeof obj === 'object' && !(obj instanceof Timestamp)) {
        return Object.entries(obj).reduce((acc, [key, value]) => {
            if (value !== undefined) {
                acc[key] = cleanPayload(value);
            }
            return acc;
        }, {} as any);
    }
    return obj;
};

export const listGoals = async (workspaceId?: string): Promise<Goal[]> => {
    if (!workspaceId || workspaceId === 'loading') return [];

    try {
        const ref = collection(db, 'workspaces', workspaceId, COLLECTION_NAME);
        const snapshot = await getDocs(ref);
        
        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        } as Goal));
    } catch (error) {
        console.error("Erro ao listar metas:", error);
        return [];
    }
};

export const createGoal = async (goal: Omit<Goal, 'id'>, workspaceId?: string): Promise<Goal> => {
    if (!workspaceId) throw new Error("Workspace ID obrigatório");

    const ref = collection(db, 'workspaces', workspaceId, COLLECTION_NAME);
    
    const payload = cleanPayload({
        ...goal,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
    });

    const docRef = await addDoc(ref, payload);

    return { id: docRef.id, ...goal } as Goal;
};

export const updateGoal = async (id: string, data: Partial<Goal>, workspaceId?: string): Promise<Goal> => {
    if (!workspaceId) throw new Error("Workspace ID obrigatório");

    const docRef = doc(db, 'workspaces', workspaceId, COLLECTION_NAME, id);
    
    const payload = cleanPayload({
        ...data,
        updatedAt: Timestamp.now()
    });

    await updateDoc(docRef, payload);

    return { id, ...data } as Goal; // Retorno otimista
};

export const deleteGoal = async (id: string, workspaceId?: string): Promise<void> => {
    if (!workspaceId) return;
    const docRef = doc(db, 'workspaces', workspaceId, COLLECTION_NAME, id);
    await deleteDoc(docRef);
};