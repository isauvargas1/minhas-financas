
import { Client, Receivable } from './types.ts';

const KEY_CLIENTS = 'pj_clients';
const KEY_RECEIVABLES = 'pj_receivables';

const getKey = (base: string, workspaceId: string) => `${base}_${workspaceId}`;

const loadFromStorage = <T>(key: string): T[] => {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : [];
};

const saveToStorage = (key: string, data: any) => {
    localStorage.setItem(key, JSON.stringify(data));
};

// --- CLIENTS ---

export const listClients = async (workspaceId: string): Promise<Client[]> => {
    await new Promise(resolve => setTimeout(resolve, 300));
    return loadFromStorage<Client>(getKey(KEY_CLIENTS, workspaceId));
};

export const createClient = async (client: Omit<Client, 'id' | 'createdAt'>): Promise<Client> => {
    await new Promise(resolve => setTimeout(resolve, 300));
    const key = getKey(KEY_CLIENTS, client.workspaceId);
    const clients = loadFromStorage<Client>(key);
    
    const newClient: Client = {
        ...client,
        id: Date.now().toString(),
        createdAt: new Date().toISOString()
    };
    
    saveToStorage(key, [newClient, ...clients]);
    return newClient;
};

export const updateClient = async (client: Client): Promise<Client> => {
    await new Promise(resolve => setTimeout(resolve, 300));
    const key = getKey(KEY_CLIENTS, client.workspaceId);
    const clients = loadFromStorage<Client>(key);
    const updated = clients.map(c => c.id === client.id ? client : c);
    saveToStorage(key, updated);
    return client;
};

export const deleteClient = async (clientId: string, workspaceId: string): Promise<void> => {
    await new Promise(resolve => setTimeout(resolve, 300));
    const key = getKey(KEY_CLIENTS, workspaceId);
    const clients = loadFromStorage<Client>(key);
    saveToStorage(key, clients.filter(c => c.id !== clientId));
};

// --- RECEIVABLES ---

export const listReceivables = async (workspaceId: string): Promise<Receivable[]> => {
    await new Promise(resolve => setTimeout(resolve, 300));
    return loadFromStorage<Receivable>(getKey(KEY_RECEIVABLES, workspaceId));
};

export const createReceivable = async (receivable: Omit<Receivable, 'id' | 'createdAt'>): Promise<Receivable> => {
    await new Promise(resolve => setTimeout(resolve, 300));
    const key = getKey(KEY_RECEIVABLES, receivable.workspaceId);
    const receivables = loadFromStorage<Receivable>(key);
    
    const newReceivable: Receivable = {
        ...receivable,
        id: Date.now().toString(),
        createdAt: new Date().toISOString()
    };
    
    saveToStorage(key, [newReceivable, ...receivables]);
    return newReceivable;
};

export const updateReceivableStatus = async (id: string, status: Receivable['status'], workspaceId: string): Promise<void> => {
    await new Promise(resolve => setTimeout(resolve, 200));
    const key = getKey(KEY_RECEIVABLES, workspaceId);
    const receivables = loadFromStorage<Receivable>(key);
    const updated = receivables.map(r => r.id === id ? { ...r, status } : r);
    saveToStorage(key, updated);
};

export const deleteReceivable = async (id: string, workspaceId: string): Promise<void> => {
    await new Promise(resolve => setTimeout(resolve, 300));
    const key = getKey(KEY_RECEIVABLES, workspaceId);
    const receivables = loadFromStorage<Receivable>(key);
    saveToStorage(key, receivables.filter(r => r.id !== id));
};
