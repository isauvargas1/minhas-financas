import { 
    collection, 
    doc, 
    getDocs, 
    getDoc,
    addDoc, 
    updateDoc, 
    deleteDoc, 
    setDoc,
    query, 
    where,
    Timestamp 
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { RecurringExpense, RecurringOccurrence, RecurringStatus } from './types.ts';
import { projectOccurrences } from './logic.ts';

const EXPENSES_COLL = 'recurring_expenses';
const OCCURRENCES_COLL = 'recurring_occurrences';

// --- HELPERS ---

// Remove campos undefined do objeto, pois o Firestore Web SDK não aceita undefined
const cleanPayload = (obj: any) => {
    return Object.entries(obj).reduce((acc, [key, value]) => {
        if (value !== undefined) {
            acc[key] = value;
        }
        return acc;
    }, {} as any);
};

const toDateString = (val: any): string => {
    if (!val) return '';
    if (val instanceof Timestamp) return val.toDate().toISOString().split('T')[0];
    if (typeof val === 'string') return val.split('T')[0];
    return '';
};

const mapExpenseFromFirestore = (docSnap: any): RecurringExpense => {
    const data = docSnap.data();
    return {
        ...data,
        id: docSnap.id,
        // Garante que datas voltem como string YYYY-MM-DD
        dataInicio: toDateString(data.dataInicio) || new Date().toISOString().split('T')[0],
        dataFim: toDateString(data.dataFim) || undefined,
        
        createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate().toISOString() : new Date().toISOString(),
        updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt.toDate().toISOString() : new Date().toISOString(),
        
        // Garante que campos opcionais nulos virem undefined se necessário (opcional, mas bom para consistência)
        anexoNome: data.anexoNome || undefined,
        fornecedor: data.fornecedor || undefined,
    } as RecurringExpense;
};

const mapOccurrenceFromFirestore = (docSnap: any): RecurringOccurrence => {
    const data = docSnap.data();
    return {
        ...data,
        id: docSnap.id,
        dataPrevista: toDateString(data.dataPrevista),
        createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate().toISOString() : data.createdAt,
        updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt.toDate().toISOString() : data.updatedAt,
    } as RecurringOccurrence;
};

// --- API FUNCTIONS ---

export const listRecurringExpenses = async (workspaceId?: string): Promise<RecurringExpense[]> => {
    if (!workspaceId || workspaceId === 'loading') return [];

    try {
        const ref = collection(db, 'workspaces', workspaceId, EXPENSES_COLL);
        const snapshot = await getDocs(ref);
        return snapshot.docs.map(mapExpenseFromFirestore);
    } catch (error) {
        console.error("Erro ao listar despesas recorrentes:", error);
        return [];
    }
};

export const getRecurringExpense = async (id: string, workspaceId?: string): Promise<RecurringExpense | undefined> => {
    if (!workspaceId) return undefined;

    const docRef = doc(db, 'workspaces', workspaceId, EXPENSES_COLL, id);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) return undefined;
    return mapExpenseFromFirestore(docSnap);
};

export const createRecurringExpense = async (expense: RecurringExpense, workspaceId?: string): Promise<RecurringExpense> => {
    if (!workspaceId) throw new Error("Workspace ID obrigatório");

    const ref = collection(db, 'workspaces', workspaceId, EXPENSES_COLL);
    
    // 1. Converte Datas para Timestamp
    // 2. Remove ID (Firestore gera)
    // 3. Remove undefined (cleanPayload)
    const { id, ...rest } = expense;
    
    const rawData = {
        ...rest,
        dataInicio: expense.dataInicio ? Timestamp.fromDate(new Date(expense.dataInicio)) : null,
        dataFim: expense.dataFim ? Timestamp.fromDate(new Date(expense.dataFim)) : null,
        dataReajuste: expense.dataReajuste ? expense.dataReajuste : null, // String direta ou null
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
    };

    const payload = cleanPayload(rawData);
    
    const docRef = await addDoc(ref, payload);
    
    return {
        ...expense,
        id: docRef.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
};

export const updateRecurringExpense = async (id: string, data: Partial<RecurringExpense>, workspaceId?: string): Promise<RecurringExpense> => {
    if (!workspaceId) throw new Error("Workspace ID obrigatório");

    const docRef = doc(db, 'workspaces', workspaceId, EXPENSES_COLL, id);
    
    const rawData: any = { ...data, updatedAt: Timestamp.now() };
    
    if (data.dataInicio) rawData.dataInicio = Timestamp.fromDate(new Date(data.dataInicio));
    if (data.dataFim) rawData.dataFim = Timestamp.fromDate(new Date(data.dataFim));

    // Remove undefined antes do update
    const payload = cleanPayload(rawData);

    await updateDoc(docRef, payload);

    return { id, ...data } as RecurringExpense; 
};

export const deleteRecurringExpense = async (id: string, workspaceId?: string): Promise<void> => {
    if (!workspaceId) return;
    const docRef = doc(db, 'workspaces', workspaceId, EXPENSES_COLL, id);
    await deleteDoc(docRef);
};

export const updateRecurringStatus = async (id: string, status: RecurringStatus, workspaceId?: string): Promise<void> => {
    await updateRecurringExpense(id, { status }, workspaceId);
};

// --- OCORRÊNCIAS ---

export const listRecurringOccurrences = async (
    start: Date, 
    end: Date, 
    workspaceId?: string,
    statusFilter?: RecurringStatus
): Promise<RecurringOccurrence[]> => {
    if (!workspaceId || workspaceId === 'loading') return [];

    const expenses = await listRecurringExpenses(workspaceId);
    
    const occRef = collection(db, 'workspaces', workspaceId, OCCURRENCES_COLL);
    const q = query(
        occRef, 
        where('dataPrevista', '>=', Timestamp.fromDate(start)),
        where('dataPrevista', '<=', Timestamp.fromDate(end))
    );
    const overridesSnap = await getDocs(q);
    const overrides = overridesSnap.docs.map(mapOccurrenceFromFirestore);

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
            if (saved) return saved;
            return proj;
        });

        allOccurrences = [...allOccurrences, ...merged];
    }

    return allOccurrences.sort((a, b) => new Date(a.dataPrevista).getTime() - new Date(b.dataPrevista).getTime());
};

export const saveOccurrence = async (occurrence: RecurringOccurrence, workspaceId?: string): Promise<RecurringOccurrence> => {
    if (!workspaceId) throw new Error("Workspace ID obrigatório");

    const docRef = doc(db, 'workspaces', workspaceId, OCCURRENCES_COLL, occurrence.id);
    
    const rawData = {
        ...occurrence,
        dataPrevista: Timestamp.fromDate(new Date(occurrence.dataPrevista)),
        createdAt: occurrence.createdAt ? Timestamp.fromDate(new Date(occurrence.createdAt)) : Timestamp.now(),
        updatedAt: Timestamp.now()
    };

    const payload = cleanPayload(rawData);

    await setDoc(docRef, payload, { merge: true });
    
    return occurrence;
};