
import { RecurringExpense, RecurringOccurrence, RecurringStatus } from './types.ts';
import { initialRecurringExpenses } from '../../constants.ts';
import { projectOccurrences } from './logic.ts';

const KEY_RECURRING = 'recurring_expenses';
const KEY_OCCURRENCES = 'recurring_occurrences_override'; // Salva apenas exceções (pagos, alterados)

// --- HELPERS ---
const loadFromStorage = <T>(key: string, defaultData: T): T => {
    const stored = localStorage.getItem(key);
    if (stored) {
        return JSON.parse(stored);
    }
    localStorage.setItem(key, JSON.stringify(defaultData));
    return defaultData;
};

const saveToStorage = (key: string, data: any) => {
    localStorage.setItem(key, JSON.stringify(data));
};

// --- API FUNCTIONS ---

// 1. CRUD Despesas Recorrentes

export const listRecurringExpenses = async (): Promise<RecurringExpense[]> => {
    await new Promise(resolve => setTimeout(resolve, 300));
    return loadFromStorage<RecurringExpense[]>(KEY_RECURRING, initialRecurringExpenses);
};

export const getRecurringExpense = async (id: string): Promise<RecurringExpense | undefined> => {
    await new Promise(resolve => setTimeout(resolve, 200));
    const all = loadFromStorage<RecurringExpense[]>(KEY_RECURRING, initialRecurringExpenses);
    return all.find(e => e.id === id);
};

export const createRecurringExpense = async (expense: RecurringExpense): Promise<RecurringExpense> => {
    await new Promise(resolve => setTimeout(resolve, 400));
    const all = loadFromStorage<RecurringExpense[]>(KEY_RECURRING, initialRecurringExpenses);
    
    // Ensure dates are ISO strings if passed as objects
    const newExpense = {
        ...expense,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    
    const newAll = [...all, newExpense];
    saveToStorage(KEY_RECURRING, newAll);
    return newExpense;
};

export const updateRecurringExpense = async (id: string, data: Partial<RecurringExpense>): Promise<RecurringExpense> => {
    await new Promise(resolve => setTimeout(resolve, 400));
    const all = loadFromStorage<RecurringExpense[]>(KEY_RECURRING, initialRecurringExpenses);
    
    const index = all.findIndex(e => e.id === id);
    if (index === -1) throw new Error("Expense not found");

    const updated = { ...all[index], ...data, updatedAt: new Date().toISOString() };
    all[index] = updated;
    
    saveToStorage(KEY_RECURRING, all);
    return updated;
};

export const deleteRecurringExpense = async (id: string): Promise<void> => {
    await new Promise(resolve => setTimeout(resolve, 300));
    const all = loadFromStorage<RecurringExpense[]>(KEY_RECURRING, initialRecurringExpenses);
    saveToStorage(KEY_RECURRING, all.filter(e => e.id !== id));
    // TODO: Clean up saved occurrences overrides if necessary
};

// 2. Gestão de Status

export const updateRecurringStatus = async (id: string, status: RecurringStatus): Promise<void> => {
    await updateRecurringExpense(id, { status });
};

// 3. Ocorrências (Instances)

export const listRecurringOccurrences = async (
    start: Date, 
    end: Date, 
    statusFilter?: RecurringStatus
): Promise<RecurringOccurrence[]> => {
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const expenses = loadFromStorage<RecurringExpense[]>(KEY_RECURRING, initialRecurringExpenses);
    const overrides = loadFromStorage<RecurringOccurrence[]>(KEY_OCCURRENCES, []);

    let allOccurrences: RecurringOccurrence[] = [];

    // Filtra despesas ativas ou pausadas (canceladas não geram novas ocorrências futuras, mas histórico sim)
    const relevantExpenses = expenses.filter(e => 
        statusFilter ? e.status === statusFilter : true
    );

    for (const expense of relevantExpenses) {
        // Se a despesa foi cancelada antes do início do range, ignora
        if (expense.status === 'cancelado' && expense.updatedAt && new Date(expense.updatedAt) < start) {
            continue;
        }

        // 1. Projeção Matemática
        const projected = projectOccurrences(expense, start, end);

        // 2. Merge com Overrides (dados salvos de pagamento/edição)
        const merged = projected.map(proj => {
            // Tenta encontrar uma versão salva desta ocorrência (chave composta: id despesa + competencia)
            // A lógica de ID virtual na projection é `occ_${expense.id}_${competencia}`
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

// Função chamada quando o usuário marca uma ocorrência como Paga ou edita valor
export const saveOccurrence = async (occurrence: RecurringOccurrence): Promise<RecurringOccurrence> => {
    await new Promise(resolve => setTimeout(resolve, 300));
    const overrides = loadFromStorage<RecurringOccurrence[]>(KEY_OCCURRENCES, []);
    
    const index = overrides.findIndex(o => o.id === occurrence.id);
    let newOverrides;
    
    if (index >= 0) {
        newOverrides = [...overrides];
        newOverrides[index] = { ...occurrence, updatedAt: new Date().toISOString() };
    } else {
        newOverrides = [...overrides, { ...occurrence, createdAt: new Date().toISOString() }];
    }
    
    saveToStorage(KEY_OCCURRENCES, newOverrides);
    return occurrence;
};
