import { 
    collection, 
    query, 
    where, 
    getDocs, 
    addDoc, 
    deleteDoc,
    doc, 
    updateDoc, 
    orderBy
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { Transaction } from '../../../types';

const COLLECTION = 'transactions';

export const getTransactions = async (workspaceId: string): Promise<Transaction[]> => {
    // Busca transações vinculadas ao Workspace atual
    const q = query(
        collection(db, COLLECTION),
        where('workspaceId', '==', workspaceId),
        // Ordenação idealmente requer índice composto no Firestore, 
        // se der erro de índice, remova o orderBy temporariamente ou crie o índice no link que aparecerá no console
        // orderBy('date', 'desc') 
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({
        id: doc.id, // O ID agora é string (do Firestore)
        ...doc.data()
    } as unknown as Transaction));
};

export const createTransaction = async (transaction: Omit<Transaction, 'id'>): Promise<Transaction> => {
    const docRef = await addDoc(collection(db, COLLECTION), transaction);
    return { id: docRef.id, ...transaction } as unknown as Transaction;
};

export const updateTransaction = async (transaction: Transaction): Promise<void> => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id, ...data } = transaction; // Remove ID do payload
    const docRef = doc(db, COLLECTION, String(id));
    await updateDoc(docRef, data);
};

export const deleteTransaction = async (id: string | number): Promise<void> => {
    const docRef = doc(db, COLLECTION, String(id));
    await deleteDoc(docRef);
};