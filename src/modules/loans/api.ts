import {
    collection,
    doc,
    documentId,
    getAggregateFromServer,
    getDocs,
    addDoc,
    updateDoc,
    getDoc,
    deleteDoc,
    count,
    limit,
    orderBy,
    query,
    startAfter,
    sum,
    where,
    writeBatch,
    Timestamp,
    runTransaction
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { Loan, LoanMovement, LoanStatus } from './types';

const LOANS_COLL = 'loans';
const MOVEMENTS_COLL = 'loan_movements';

/**
 * Leitura paginada dos empréstimos.
 *
 * `listLoans` fazia `getDocs(collection(...))` — sem `where`, sem `orderBy`,
 * sem `limit` — e as duas telas (PF e PJ) somavam saldo e contavam atrasados
 * sobre o array inteiro. O custo era o histórico completo de contratos a cada
 * carga da tela, e os totais dependiam de ter lido tudo.
 *
 * A listagem passa a ser paginada por cursor e os totais deixam de depender
 * dela: viram agregados do servidor, que não leem documento nenhum. Sem essa
 * separação, paginar transformaria os três indicadores financeiros em somas
 * silenciosamente parciais — trocar um problema de custo por um de correção.
 */
export const LOANS_PAGE_SIZE = 100;

/** Movimentações por página na tela de detalhe. */
export const LOAN_MOVEMENTS_PAGE_SIZE = 100;

export interface LoanPage {
    items: Loan[];
    /** ID do último documento da página; `undefined` quando acabou. */
    nextCursor?: string;
    hasMore: boolean;
}

/**
 * Cursor de movimentações.
 *
 * A consulta ordena por `date` e desempata por `documentId()`, então o cursor
 * precisa carregar **os dois** valores. Passar só o ID a `startAfter` monta um
 * cursor parcial sobre o *primeiro* campo da ordenação: o Firestore compararia
 * o ID do documento com strings `YYYY-MM-DD`, e como um ID costuma começar por
 * letra — que ordena acima de `"2…"` — em ordem decrescente o cursor cairia
 * antes de toda linha e a próxima página repetiria a primeira, para sempre.
 */
export interface LoanMovementCursor {
    date: string;
    id: string;
}

export interface LoanMovementPage {
    items: LoanMovement[];
    nextCursor?: LoanMovementCursor;
    hasMore: boolean;
}

/**
 * Totais dos contratos, calculados pelo servidor.
 *
 * `getAggregateFromServer` devolve soma e contagem sem trazer documento
 * nenhum: o custo é de índice, não de leitura, e o número é exato mesmo
 * quando a tela mostra só a primeira página.
 */
export interface LoanTotals {
    lend: number;
    borrow: number;
    overdue: number;
}

/**
 * Recorte dos saldos exibidos: tudo que não está quitado.
 *
 * É o `status !== 'paid'` que as duas telas aplicavam, escrito como filtro de
 * servidor. Enumerar os três valores em vez de usar `not-in` é o que permite
 * combinar com a igualdade em `type` na mesma consulta.
 *
 * Ressalva registrada: `in` — como `not-in` — **omite** documento que não
 * tenha o campo. Um contrato gravado antes de `status` existir sairia dos
 * totais e continuaria aparecendo na listagem, que não filtra por status. O
 * tipo `Loan` exige `status` e `createLoan` sempre o grava, então o caso só
 * existe se houver documento anterior ao campo; não há como consultá-lo pelo
 * servidor, e varrer a coleção para encontrá-lo é exatamente o que esta
 * mudança elimina.
 */
const UNPAID_STATUSES: LoanStatus[] = ['active', 'overdue', 'cancelled'];

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

// --- LOANS ---

/**
 * Uma página de empréstimos.
 *
 * A ordem é por `documentId()`: é o único campo garantidamente presente em
 * todo documento, inclusive nos anteriores a `createdAt`. Ordenar por um campo
 * opcional faria o Firestore omitir da consulta exatamente os contratos mais
 * antigos — o mesmo defeito que a ordenação por `transactionDate` já causou no
 * histórico de transações.
 */
export const listLoans = async (
    workspaceId?: string,
    options: { pageSize?: number; cursor?: string } = {},
): Promise<LoanPage> => {
    if (!workspaceId || workspaceId === 'loading') {
        return { items: [], hasMore: false };
    }

    const pageSize = options.pageSize ?? LOANS_PAGE_SIZE;
    const ref = collection(db, 'workspaces', workspaceId, LOANS_COLL);
    const snapshot = await getDocs(query(
        ref,
        orderBy(documentId()),
        ...(options.cursor ? [startAfter(options.cursor)] : []),
        // Lê um a mais para saber se há próxima página sem uma segunda consulta.
        limit(pageSize + 1),
    ));

    const docs = snapshot.docs.slice(0, pageSize);
    return {
        items: docs.map(entry => ({ id: entry.id, ...entry.data() } as Loan)),
        nextCursor: docs[docs.length - 1]?.id,
        hasMore: snapshot.size > pageSize,
    };
};

/**
 * Saldo a receber, saldo a pagar e contagem de atrasados.
 *
 * Três agregados do servidor no lugar de três reduções sobre a coleção
 * inteira. O recorte é exatamente o de antes — contrato não quitado —, agora
 * expresso como filtro do servidor em vez de `filter` sobre o array todo.
 */
export const getLoanTotals = async (workspaceId?: string): Promise<LoanTotals> => {
    if (!workspaceId || workspaceId === 'loading') {
        return { lend: 0, borrow: 0, overdue: 0 };
    }

    const ref = collection(db, 'workspaces', workspaceId, LOANS_COLL);
    const openOfType = (type: 'lend' | 'borrow') => query(
        ref,
        where('type', '==', type),
        where('status', 'in', UNPAID_STATUSES),
    );

    const [lend, borrow, overdue] = await Promise.all([
        getAggregateFromServer(openOfType('lend'), { total: sum('currentBalance') }),
        getAggregateFromServer(openOfType('borrow'), { total: sum('currentBalance') }),
        getAggregateFromServer(
            query(ref, where('status', '==', 'overdue')),
            { total: count() },
        ),
    ]);

    /*
     * Arredondamento ao centavo na saída do agregado.
     *
     * `currentBalance` é `number` em reais — representação legada do módulo de
     * empréstimos, registrada como dívida no ExecPlan e **não** alterada aqui.
     * Somar binários de ponto flutuante acumula resíduo (0.1 + 0.2 é o caso
     * clássico), e a soma anterior, feita no cliente sobre o array inteiro,
     * tinha exatamente o mesmo problema.
     *
     * O que muda é que o resíduo deixa de chegar à tela: o total é fechado no
     * centavo antes de sair daqui. Não converte o módulo para centavos
     * inteiros — isso exige migrar os documentos existentes —, mas garante que
     * nenhum artefato de ponto flutuante seja exibido como saldo.
     */
    const toCents = (value: number | null): number =>
        Math.round((value ?? 0) * 100) / 100;

    return {
        lend: toCents(lend.data().total),
        borrow: toCents(borrow.data().total),
        overdue: overdue.data().total ?? 0,
    };
};

export const createLoan = async (loan: Loan, workspaceId?: string): Promise<Loan> => {
    if (!workspaceId) throw new Error("Workspace ID obrigatório");

    const ref = collection(db, 'workspaces', workspaceId, LOANS_COLL);
    
    // Remove ID temporário e limpa payload
    const { id, ...rest } = loan;
    const payload = cleanPayload({
        ...rest,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
    });

    const docRef = await addDoc(ref, payload);

    return { id: docRef.id, ...loan } as Loan;
};

export const updateLoan = async (loan: Loan, workspaceId?: string): Promise<Loan> => {
    if (!workspaceId) throw new Error("Workspace ID obrigatório");

    const docRef = doc(db, 'workspaces', workspaceId, LOANS_COLL, loan.id);
    
    const payload = cleanPayload({
        ...loan,
        updatedAt: Timestamp.now()
    });
    // Removemos o ID do payload para não duplicar
    delete payload.id;

    await updateDoc(docRef, payload);

    return loan;
};


export const getLoan = async (id: string, workspaceId?: string): Promise<Loan | undefined> => {
    if (!workspaceId) return undefined;
    const docRef = doc(db, 'workspaces', workspaceId, LOANS_COLL, id);
    const docSnap = await getDoc(docRef);
    
    if (!docSnap.exists()) return undefined;
    
    return {
        id: docSnap.id,
        ...docSnap.data()
    } as Loan;
};

export const deleteLoan = async (id: string, workspaceId?: string): Promise<void> => {
    if (!workspaceId) return;
    
    // 1. Deleta o contrato
    const docRef = doc(db, 'workspaces', workspaceId, LOANS_COLL, id);
    await deleteDoc(docRef);

    // 2. Limpeza: Busca e deleta todas as movimentações associadas (Best Effort)
    // Para ser atômico deveria ser via Cloud Functions, mas aqui faremos via Batch no client
    // A cascata é paginada: um lote do Firestore aceita 500 escritas, e a
    // versão anterior lia tudo e tentava apagar num lote só — acima de 500
    // movimentações o commit falhava e o contrato ficava com histórico órfão.
    const movRef = collection(db, 'workspaces', workspaceId, MOVEMENTS_COLL);
    const DELETE_PAGE = 400;
    for (;;) {
        const snapshot = await getDocs(query(
            movRef,
            where('loanId', '==', id),
            orderBy(documentId()),
            limit(DELETE_PAGE),
        ));
        if (snapshot.empty) break;
        const batch = writeBatch(db);
        snapshot.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
        if (snapshot.size < DELETE_PAGE) break;
    }
};

// --- MOVEMENTS ---

/**
 * Movimentações de um contrato, da mais recente para a mais antiga.
 *
 * A ordenação era feita em memória porque não havia índice composto — o
 * comentário anterior dizia exatamente isso. Sem `limit`, um contrato com
 * histórico longo trazia tudo para ordenar no cliente. O índice
 * `(loanId, date desc, __name__ desc)` passa a existir, e a ordenação e o
 * corte passam a ser do servidor.
 */
export const listMovements = async (
    loanId: string,
    workspaceId?: string,
    options: { pageSize?: number; cursor?: LoanMovementCursor } = {},
): Promise<LoanMovementPage> => {
    if (!workspaceId) return { items: [], hasMore: false };

    const pageSize = options.pageSize ?? LOAN_MOVEMENTS_PAGE_SIZE;
    const ref = collection(db, 'workspaces', workspaceId, MOVEMENTS_COLL);
    const snapshot = await getDocs(query(
        ref,
        where('loanId', '==', loanId),
        orderBy('date', 'desc'),
        orderBy(documentId(), 'desc'),
        // Um valor por campo de ordenação: `date` e depois o ID.
        ...(options.cursor ? [startAfter(options.cursor.date, options.cursor.id)] : []),
        limit(pageSize + 1),
    ));

    const docs = snapshot.docs.slice(0, pageSize);
    const last = docs[docs.length - 1];
    return {
        items: docs.map(entry => ({ id: entry.id, ...entry.data() } as LoanMovement)),
        nextCursor: last ?
            { date: String(last.get('date') ?? ''), id: last.id } :
            undefined,
        hasMore: snapshot.size > pageSize,
    };
};

export const createMovement = async (movement: LoanMovement, workspaceId?: string): Promise<LoanMovement> => {
    if (!workspaceId) throw new Error("Workspace ID obrigatório");

    const loanRef = doc(db, 'workspaces', workspaceId, LOANS_COLL, movement.loanId);
    const movRef = doc(collection(db, 'workspaces', workspaceId, MOVEMENTS_COLL));

    const { id, ...rest } = movement;
    const payload = cleanPayload({
        ...rest,
        createdAt: Timestamp.now()
    });

    // Usa transação para garantir que o saldo atualize junto com o movimento
    await runTransaction(db, async (transaction) => {
        const loanSnap = await transaction.get(loanRef);
        if (!loanSnap.exists()) throw new Error("Empréstimo não encontrado!");

        const loanData = loanSnap.data() as Loan;
        
        // Lógica de saldo:
        // Se tipo é 'payment' (pagamento), reduz o saldo devedor.
        // Se tipo é 'receipt' (recebimento), também reduz (depende do ponto de vista, mas reduz o valor em aberto).
        // Se for 'adjustment' (ajuste), pode aumentar ou diminuir (vamos assumir que movement.amount tem sinal correto ou tratamos aqui).
        
        // Simplificação: Pagamentos reduzem o currentBalance
        let newBalance = loanData.currentBalance;
        let totalPaid = loanData.totalPaidReceived || 0;

        if (movement.type === 'payment' || movement.type === 'receipt') {
            newBalance = (loanData.currentBalance || 0) - movement.amount;
            totalPaid = (loanData.totalPaidReceived || 0) + movement.amount;
        }

        // 1. Cria o movimento
        transaction.set(movRef, payload);

        // 2. Atualiza o empréstimo
        transaction.update(loanRef, { 
            currentBalance: newBalance,
            totalPaidReceived: totalPaid,
            updatedAt: Timestamp.now()
        });
    });

    return { id: movRef.id, ...movement } as LoanMovement;
};

// Update e Delete Movement podem ser adicionados conforme necessidade, mas geralmente
// movimentações financeiras não são editadas, e sim compensadas por ajustes.