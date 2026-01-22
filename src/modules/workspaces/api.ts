import { 
    collection, 
    query, 
    where, 
    getDocs, 
    addDoc, 
    doc, 
    updateDoc, 
    serverTimestamp,
    getDoc
} from 'firebase/firestore';
import { db } from "@/lib/firebase";
import { Workspace } from './types';

const COLLECTION_NAME = 'workspaces';

export const listWorkspaces = async (userId: string): Promise<Workspace[]> => {
    try {
        // Busca workspaces onde o usuário é o dono (ownerId)
        // Futuramente adicionaremos busca por "membros" também
        const q = query(
            collection(db, COLLECTION_NAME), 
            where('ownerId', '==', userId)
        );
        
        const querySnapshot = await getDocs(q);
        const workspaces: Workspace[] = [];
        
        querySnapshot.forEach((doc) => {
            workspaces.push({ id: doc.id, ...doc.data() } as Workspace);
        });
        
        return workspaces;
    } catch (error) {
        console.error("Erro ao listar workspaces:", error);
        throw error;
    }
};

export const createWorkspace = async (workspaceData: Omit<Workspace, 'id' | 'createdAt' | 'updatedAt'>): Promise<Workspace> => {
    try {
        const docRef = await addDoc(collection(db, COLLECTION_NAME), {
            ...workspaceData,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });

        // Retorna o objeto completo com o ID gerado
        return {
            id: docRef.id,
            ...workspaceData,
            createdAt: new Date().toISOString(), // Mock para UI imediata
            updatedAt: new Date().toISOString()
        };
    } catch (error) {
        console.error("Erro ao criar workspace:", error);
        throw error;
    }
};

export const updateWorkspace = async (id: string, data: Partial<Workspace>): Promise<void> => {
    const docRef = doc(db, COLLECTION_NAME, id);
    await updateDoc(docRef, {
        ...data,
        updatedAt: serverTimestamp()
    });
};