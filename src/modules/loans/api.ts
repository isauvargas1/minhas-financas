import { 
    collection, 
    doc, 
    getDocs, 
    addDoc, 
    updateDoc,
    getDoc, 
    deleteDoc, 
    query,
    where,
    writeBatch,
    Timestamp,
    runTransaction
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { Loan, LoanMovement } from './types';

const LOANS_COLL = 'loans';
const MOVEMENTS_COLL = 'loan_movements';

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

export const listLoans = async (workspaceId?: string): Promise<Loan[]> => {
    if (!workspaceId || workspaceId === 'loading') return [];

    try {
        const ref = collection(db, 'workspaces', workspaceId, LOANS_COLL);
        const snapshot = await getDocs(ref);
        
        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        } as Loan));
    } catch (error) {
        console.error("Erro ao listar empréstimos:", error);
        return [];
    }
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
    const movRef = collection(db, 'workspaces', workspaceId, MOVEMENTS_COLL);
    const q = query(movRef, where('loanId', '==', id));
    const snapshot = await getDocs(q);

    if (!snapshot.empty) {
        const batch = writeBatch(db);
        snapshot.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
    }
};

// --- MOVEMENTS ---

export const listMovements = async (loanId: string, workspaceId?: string): Promise<LoanMovement[]> => {
    if (!workspaceId) return [];

    const ref = collection(db, 'workspaces', workspaceId, MOVEMENTS_COLL);
    const q = query(ref, where('loanId', '==', loanId));
    const snapshot = await getDocs(q);

    const movements = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
    } as LoanMovement));

    // Ordenação manual (banco não garante ordem sem índice composto em queries complexas)
    return movements.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
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