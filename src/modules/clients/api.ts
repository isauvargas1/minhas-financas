import { 
    collection, 
    doc, 
    getDocs, 
    getDoc,
    addDoc, 
    updateDoc, 
    deleteDoc, 
    query,
    where,
    writeBatch,
    Timestamp 
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { Client, Receivable } from './types';

const CLIENTS_COLL = 'clients';
const RECEIVABLES_COLL = 'receivables';

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

// --- CLIENTS ---

export const listClients = async (workspaceId?: string): Promise<Client[]> => {
    if (!workspaceId) return [];
    try {
        const ref = collection(db, 'workspaces', workspaceId, CLIENTS_COLL);
        const snapshot = await getDocs(ref);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Client));
    } catch (error) {
        console.error("Erro ao listar clientes:", error);
        return [];
    }
};

export const createClient = async (client: Omit<Client, 'id'>, workspaceId?: string): Promise<Client> => {
    if (!workspaceId) throw new Error("Workspace ID obrigatório");

    const ref = collection(db, 'workspaces', workspaceId, CLIENTS_COLL);
    const payload = cleanPayload({
        ...client,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    });

    const docRef = await addDoc(ref, payload);
    return { id: docRef.id, ...client } as Client;
};

export const updateClient = async (client: Client, workspaceId?: string): Promise<Client> => {
    if (!workspaceId) throw new Error("Workspace ID obrigatório");

    const docRef = doc(db, 'workspaces', workspaceId, CLIENTS_COLL, client.id);
    const { id, ...data } = client;
    
    const payload = cleanPayload({
        ...data,
        updatedAt: new Date().toISOString()
    });

    await updateDoc(docRef, payload);
    return client;
};

export const deleteClient = async (clientId: string, workspaceId?: string): Promise<void> => {
    if (!workspaceId) return;

    // Delete Client
    await deleteDoc(doc(db, 'workspaces', workspaceId, CLIENTS_COLL, clientId));

    // Optional: Delete related receivables (Best effort cleanup)
    const q = query(collection(db, 'workspaces', workspaceId, RECEIVABLES_COLL), where('clientId', '==', clientId));
    const snapshot = await getDocs(q);
    const batch = writeBatch(db);
    snapshot.forEach(d => batch.delete(d.ref));
    await batch.commit();
};

// --- RECEIVABLES ---

export const listReceivables = async (workspaceId?: string): Promise<Receivable[]> => {
    if (!workspaceId) return [];
    try {
        const ref = collection(db, 'workspaces', workspaceId, RECEIVABLES_COLL);
        const snapshot = await getDocs(ref);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Receivable));
    } catch (error) {
        console.error("Erro ao listar recebíveis:", error);
        return [];
    }
};

export const listReceivablesByClient = async (clientId: string, workspaceId?: string): Promise<Receivable[]> => {
    if (!workspaceId) return [];
    const q = query(collection(db, 'workspaces', workspaceId, RECEIVABLES_COLL), where('clientId', '==', clientId));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Receivable));
};

export const createReceivable = async (receivable: Omit<Receivable, 'id'>, workspaceId?: string): Promise<Receivable> => {
    if (!workspaceId) throw new Error("Workspace ID obrigatório");

    const ref = collection(db, 'workspaces', workspaceId, RECEIVABLES_COLL);
    const payload = cleanPayload({
        ...receivable,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    });

    const docRef = await addDoc(ref, payload);
    return { id: docRef.id, ...receivable } as Receivable;
};

export const updateReceivable = async (receivable: Receivable, workspaceId?: string): Promise<Receivable> => {
    if (!workspaceId) throw new Error("Workspace ID obrigatório");

    const docRef = doc(db, 'workspaces', workspaceId, RECEIVABLES_COLL, receivable.id);
    const { id, ...data } = receivable;
    
    const payload = cleanPayload({
        ...data,
        updatedAt: new Date().toISOString()
    });

    await updateDoc(docRef, payload);
    return receivable;
};

export const deleteReceivable = async (id: string, workspaceId?: string): Promise<void> => {
    if (!workspaceId) return;
    await deleteDoc(doc(db, 'workspaces', workspaceId, RECEIVABLES_COLL, id));
};