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
import { CreditCard } from '../../types';

const COLLECTION_NAME = 'credit_cards';

// --- HELPER RECURSIVO (CORREÇÃO CRÍTICA) ---
// Remove undefined de objetos e sub-objetos para não travar o Firestore
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

const sanitizeCreditCardClientPayload = (
    card: Partial<CreditCard>,
    workspaceId: string,
): Partial<CreditCard> => {
    const {
        id: _id,
        limitUsed: _limitUsed,
        limitAvailable: _limitAvailable,
        ...safeCard
    } = card;

    return {
        ...safeCard,
        workspaceId,
    };
};

export const listCreditCards = async (workspaceId?: string): Promise<CreditCard[]> => {
    if (!workspaceId || workspaceId === 'loading') return [];

    try {
        const ref = collection(db, 'workspaces', workspaceId, COLLECTION_NAME);
        const snapshot = await getDocs(ref);
        
        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        } as CreditCard));
    } catch (error) {
        console.error("Erro ao listar cartões:", error);
        return [];
    }
};

export const createCreditCard = async (card: Omit<CreditCard, 'id'>, workspaceId?: string): Promise<CreditCard> => {
    if (!workspaceId) throw new Error("Workspace ID obrigatório");

    const ref = collection(db, 'workspaces', workspaceId, COLLECTION_NAME);
    
    // Limpa payload recursivamente (incluindo o objeto 'visual')
    const payload = cleanPayload({
    ...sanitizeCreditCardClientPayload(card, workspaceId),
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now()
});

    const docRef = await addDoc(ref, payload);

    return { id: docRef.id, ...card } as CreditCard;
};

export const updateCreditCard = async (id: string, data: Partial<CreditCard>, workspaceId?: string): Promise<CreditCard> => {
    if (!workspaceId) throw new Error("Workspace ID obrigatório");

    const docRef = doc(db, 'workspaces', workspaceId, COLLECTION_NAME, id);
    
   const payload = cleanPayload({
    ...sanitizeCreditCardClientPayload(data, workspaceId),
    updatedAt: Timestamp.now()
});

    await updateDoc(docRef, payload);

    return { id, ...data } as CreditCard;
};

export const deleteCreditCard = async (id: string, workspaceId?: string): Promise<void> => {
    if (!workspaceId) return;
    const docRef = doc(db, 'workspaces', workspaceId, COLLECTION_NAME, id);
    await deleteDoc(docRef);
};