import {
    collection,
    doc,
    documentId,
    getDocs,
    getDoc,
    addDoc,
    updateDoc,
    deleteDoc,
    setDoc,
    limit,
    orderBy,
    query,
    startAfter,
    where,
    Timestamp
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { RecurringExpense, RecurringOccurrence, RecurringStatus } from './types.ts';
import { projectOccurrences } from './logic.ts';

const EXPENSES_COLL = 'recurring_expenses';

/**
 * Tetos de leitura das despesas recorrentes.
 *
 * `listRecurringExpenses` fazia `getDocs(collection(...))` — sem `where`, sem
 * `orderBy`, sem `limit` — e era chamada por três caminhos: a tela de
 * assinaturas, o widget do painel e, dentro de si mesma, a projeção de
 * ocorrências. O widget do painel lia a coleção inteira para exibir um total e
 * três linhas.
 *
 * A listagem passa a ser paginada por cursor, e o resumo passa a ter consulta
 * própria, restrita a `status == 'ativo'` no servidor — que é o único recorte
 * que o resumo usa.
 */
export const RECURRING_PAGE_SIZE = 100;

/**
 * Teto do resumo de assinaturas ativas.
 *
 * O valor mensal normalizado depende do `periodo` de cada assinatura, então
 * não é uma soma que o Firestore consiga agregar sozinho. O recorte fica
 * bem menor que a coleção (só as ativas) e o estouro é declarado, nunca
 * silencioso.
 */
export const RECURRING_SUMMARY_LIMIT = 500;

/**
 * Teto de sobrescritas de ocorrência lidas numa janela.
 *
 * A janela da tela é de 13 meses; uma assinatura semanal gera ~56 ocorrências
 * nela. O teto cobre a janela com folga larga e existe para que a consulta
 * tenha limite, não para cortar dado real.
 */
export const RECURRING_OCCURRENCES_LIMIT = 1_000;

export interface RecurringExpensePage {
    items: RecurringExpense[];
    nextCursor?: string;
    hasMore: boolean;
}

export interface RecurringExpenseSummaryList {
    items: RecurringExpense[];
    truncated: boolean;
}
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

/**
 * Uma página de assinaturas.
 *
 * A ordem é por `documentId()`: os documentos anteriores a `createdAt` sairiam
 * da consulta se ela ordenasse por um campo opcional.
 */
export const listRecurringExpenses = async (
    workspaceId?: string,
    options: { pageSize?: number; cursor?: string } = {},
): Promise<RecurringExpensePage> => {
    if (!workspaceId || workspaceId === 'loading') {
        return { items: [], hasMore: false };
    }

    const pageSize = options.pageSize ?? RECURRING_PAGE_SIZE;
    const ref = collection(db, 'workspaces', workspaceId, EXPENSES_COLL);
    const snapshot = await getDocs(query(
        ref,
        orderBy(documentId()),
        ...(options.cursor ? [startAfter(options.cursor)] : []),
        limit(pageSize + 1),
    ));
    const docs = snapshot.docs.slice(0, pageSize);
    return {
        items: docs.map(mapExpenseFromFirestore),
        nextCursor: docs[docs.length - 1]?.id,
        hasMore: snapshot.size > pageSize,
    };
};

/**
 * Assinaturas ativas, para o resumo da tela e o widget do painel.
 *
 * O filtro é do servidor: as pausadas e canceladas não são lidas, e as duas
 * telas passam a pagar só pelo que de fato somam.
 */
export const listActiveRecurringExpenses = async (
    workspaceId?: string,
): Promise<RecurringExpenseSummaryList> => {
    if (!workspaceId || workspaceId === 'loading') {
        return { items: [], truncated: false };
    }
    const ref = collection(db, 'workspaces', workspaceId, EXPENSES_COLL);
    const snapshot = await getDocs(query(
        ref,
        where('status', '==', 'ativo'),
        orderBy(documentId()),
        limit(RECURRING_SUMMARY_LIMIT + 1),
    ));
    const docs = snapshot.docs.slice(0, RECURRING_SUMMARY_LIMIT);
    return {
        items: docs.map(mapExpenseFromFirestore),
        truncated: snapshot.size > RECURRING_SUMMARY_LIMIT,
    };
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

/**
 * Ocorrências projetadas de uma janela, opcionalmente de **uma** assinatura.
 *
 * Duas correções aqui, e a segunda é de comportamento:
 *
 * 1. a função lia a coleção inteira de assinaturas (por chamar
 *    `listRecurringExpenses` sem recorte) e a de ocorrências sem `limit`;
 * 2. a única tela que a consome é a de detalhe de **uma** assinatura, e ela
 *    não filtrava por assinatura nenhuma: a página de um contrato listava as
 *    ocorrências projetadas de todos os contratos do workspace. Com
 *    `expenseId`, a leitura passa a ser um documento e as sobrescritas
 *    daquela assinatura.
 */
export const listRecurringOccurrences = async (
    start: Date, 
    end: Date, 
    workspaceId?: string,
    statusFilter?: RecurringStatus,
    expenseId?: string,
): Promise<RecurringOccurrence[]> => {
    if (!workspaceId || workspaceId === 'loading') return [];

    const expenses = expenseId
        ? [await getRecurringExpense(expenseId, workspaceId)].filter(
            (entry): entry is RecurringExpense => Boolean(entry),
        )
        : (await listActiveRecurringExpenses(workspaceId)).items;
    if (expenses.length === 0) return [];

    const occRef = collection(db, 'workspaces', workspaceId, OCCURRENCES_COLL);
    const q = query(
        occRef,
        ...(expenseId ? [where('recurringExpenseId', '==', expenseId)] : []),
        where('dataPrevista', '>=', Timestamp.fromDate(start)),
        where('dataPrevista', '<=', Timestamp.fromDate(end)),
        orderBy('dataPrevista'),
        limit(RECURRING_OCCURRENCES_LIMIT),
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