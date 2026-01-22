
import { RecurringExpense, RecurringOccurrence, RecurringStatus } from './types.ts';
import { initialRecurringExpenses } from '../../constants.ts';
import { projectOccurrences } from './logic.ts';

const KEY_RECURRING = 'recurring_expenses';
const KEY_OCCURRENCES = 'recurring_occurrences_override'; // Salva apenas exceções (pagos, alterados)

// --- HELPERS ---
const getStorageKey = (base: string, workspaceId?: string) => {
    if (!workspaceId || workspaceId === 'personal') return base;
    return `${base}_${workspaceId}`;
};

const loadFromStorage = <T>(key: string, defaultData: T): T => {
    const stored = localStorage.getItem(key);
    if (stored) {
        return JSON.parse(stored);
    }
    // Only init defaults for personal, or if the key is the base key
    if (key === KEY_RECURRING) {
        localStorage.setItem(key, JSON.stringify(defaultData));
        return defaultData;
    }
    return [] as unknown as T;
};

const saveToStorage = (key: string, data: any) => {
    localStorage.setItem(key, JSON.stringify(data));
};

// --- API FUNCTIONS ---

// 1. CRUD Despesas Recorrentes

export const listRecurringExpenses = async (workspaceId?: string): Promise<RecurringExpense[]> => {
    await new Promise(resolve => setTimeout(resolve, 300));
    const key = getStorageKey(KEY_RECURRING, workspaceId);
    return loadFromStorage<RecurringExpense[]>(key, initialRecurringExpenses);
};

export const getRecurringExpense = async (id: string, workspaceId?: string): Promise<RecurringExpense | undefined> => {
    await new Promise(resolve => setTimeout(resolve, 200));
    const key = getStorageKey(KEY_RECURRING, workspaceId);
    const all = loadFromStorage<RecurringExpense[]>(key, initialRecurringExpenses);
    return all.find(e => e.id === id);
};

export const createRecurringExpense = async (expense: RecurringExpense, workspaceId?: string): Promise<RecurringExpense> => {
    await new Promise(resolve => setTimeout(resolve, 400));
    const key = getStorageKey(KEY_RECURRING, workspaceId);
    const all = loadFromStorage<RecurringExpense[]>(key, initialRecurringExpenses);
    
    const newExpense = {
        ...expense,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    
    const newAll = [...all, newExpense];
    saveToStorage(key, newAll);
    return newExpense;
};

export const updateRecurringExpense = async (id: string, data: Partial<RecurringExpense>, workspaceId?: string): Promise<RecurringExpense> => {
    await new Promise(resolve => setTimeout(resolve, 400));
    const key = getStorageKey(KEY_RECURRING, workspaceId);
    const all = loadFromStorage<RecurringExpense[]>(key, initialRecurringExpenses);
    
    const index = all.findIndex(e => e.id === id);
    if (index === -1) throw new Error("Expense not found");

    const updated = { ...all[index], ...data, updatedAt: new Date().toISOString() };
    all[index] = updated;
    
    saveToStorage(key, all);
    return updated;
};

export const deleteRecurringExpense = async (id: string, workspaceId?: string): Promise<void> => {
    await new Promise(resolve => setTimeout(resolve, 300));
    const key = getStorageKey(KEY_RECURRING, workspaceId);
    const all = loadFromStorage<RecurringExpense[]>(key, initialRecurringExpenses);
    saveToStorage(key, all.filter(e => e.id !== id));
};

// 2. Gestão de Status

export const updateRecurringStatus = async (id: string, status: RecurringStatus, workspaceId?: string): Promise<void> => {
    await updateRecurringExpense(id, { status }, workspaceId);
};

// 3. Ocorrências (Instances)

export const listRecurringOccurrences = async (
    start: Date, 
    end: Date, 
    workspaceId?: string,
    statusFilter?: RecurringStatus
): Promise<RecurringOccurrence[]> => {
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const recKey = getStorageKey(KEY_RECURRING, workspaceId);
    const occKey = getStorageKey(KEY_OCCURRENCES, workspaceId);

    const expenses = loadFromStorage<RecurringExpense[]>(recKey, initialRecurringExpenses);
    const overrides = loadFromStorage<RecurringOccurrence[]>(occKey, []);

    let allOccurrences: RecurringOccurrence[] = [];

    const relevantExpenses = expenses.filter(e => 
        statusFilter ? e.status === statusFilter : true
    );

    for (const expense of relevantExpenses) {
        if (expense.status === 'cancelado' && expense.updatedAt && new Date(expense.updatedAt) < start) {
            continue;
        }

        const projected = projectOccurrences(expense, start, end);

        const merged = projected.map(proj => {
            const saved = overrides.find(o => o.id === proj.id);
            if (saved) {
                return saved;
            }
            return proj;
        });

        allOccurrences = [...allOccurrences, ...merged];
    }

    return allOccurrences.sort((a, b) => new Date(a.dataPrevista).getTime() - new Date(b.dataPrevista).getTime());
};

export const saveOccurrence = async (occurrence: RecurringOccurrence, workspaceId?: string): Promise<RecurringOccurrence> => {
    await new Promise(resolve => setTimeout(resolve, 300));
    const key = getStorageKey(KEY_OCCURRENCES, workspaceId);
    const overrides = loadFromStorage<RecurringOccurrence[]>(key, []);
    
    const index = overrides.findIndex(o => o.id === occurrence.id);
    let newOverrides;
    
    if (index >= 0) {
        newOverrides = [...overrides];
        newOverrides[index] = { ...occurrence, updatedAt: new Date().toISOString() };
    } else {
        newOverrides = [...overrides, { ...occurrence, createdAt: new Date().toISOString() }];
    }
    
    saveToStorage(key, newOverrides);
    return occurrence;
};
