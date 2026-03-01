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
    Timestamp,
    runTransaction
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { 
    SplitGroup, SplitBill, SplitParticipant, SplitShare,
    SplitGroupInvite, SplitBillPaymentStatus, SplitParticipantRole
} from '../../types';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../lib/firebase';


// Coleções
const GROUPS_COLL = 'split_groups';
const PARTICIPANTS_COLL = 'split_participants';
const BILLS_COLL = 'split_bills';
const SHARES_COLL = 'split_shares';
const INVITES_COLL = 'split_invites';

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

// --- GROUPS ---

export const listSplitGroups = async (workspaceId?: string): Promise<SplitGroup[]> => {
    if (!workspaceId) return [];
    try {
        const ref = collection(db, 'workspaces', workspaceId, GROUPS_COLL);
        const snapshot = await getDocs(ref);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as SplitGroup));
    } catch (error) {
        console.error("Erro ao listar grupos:", error);
        return [];
    }
};

export const getSplitGroup = async (groupId: string, workspaceId?: string): Promise<SplitGroup | undefined> => {
    if (!workspaceId) return undefined;
    const docRef = doc(db, 'workspaces', workspaceId, GROUPS_COLL, groupId);
    const snap = await getDoc(docRef);
    return snap.exists() ? ({ id: snap.id, ...snap.data() } as SplitGroup) : undefined;
};

export const createSplitGroup = async (group: Omit<SplitGroup, 'id' | 'dataCriacao'>, workspaceId: string): Promise<string> => {
  const { auth } = await import('../../lib/firebase');
  const userId = auth.currentUser?.uid;
  const userName = auth.currentUser?.displayName || 'Dono';

  if (!userId) throw new Error("Usuário não autenticado");

  // Usamos uma transação para garantir que o grupo E o participante sejam criados juntos
  return await runTransaction(db, async (transaction) => {
    const groupRef = doc(collection(db, 'workspaces', workspaceId, 'split_groups'));
    const participantRef = doc(collection(db, 'workspaces', workspaceId, 'split_participants'));

    const newGroup = {
      ...group,
      id: groupRef.id,
      dataCriacao: new Date().toISOString(),
      ativo: true
    };

    // 1. Cria o grupo
    transaction.set(groupRef, cleanPayload(newGroup));

    // 2. Cria o registro do dono (VOCÊ) na coleção de participantes
    transaction.set(participantRef, cleanPayload({
      id: participantRef.id,
      groupId: groupRef.id,
      userId: userId, // Campo essencial para a Cloud Function te achar
      nomeExibicao: userName,
      papel: 'dono',
      corIdentidade: '#6366f1',
      avatarEmojiOpcional: '👑'
    }));

    return groupRef.id;
  });
};

export const updateSplitGroup = async (group: SplitGroup, workspaceId?: string): Promise<SplitGroup> => {
    if (!workspaceId) throw new Error("Workspace ID obrigatório");
    const docRef = doc(db, 'workspaces', workspaceId, GROUPS_COLL, group.id);
    const { id, ...data } = group;
    await updateDoc(docRef, cleanPayload(data));
    return group;
};

export const deleteSplitGroup = async (groupId: string, workspaceId?: string): Promise<void> => {
    if (!workspaceId) return;

    // Deleção em cascata (Best Effort)
    const batch = writeBatch(db);
    
    // 1. Grupo
    batch.delete(doc(db, 'workspaces', workspaceId, GROUPS_COLL, groupId));

    // 2. Participantes
    const partsQ = query(collection(db, 'workspaces', workspaceId, PARTICIPANTS_COLL), where('groupId', '==', groupId));
    const partsSnap = await getDocs(partsQ);
    partsSnap.forEach(d => batch.delete(d.ref));

    // 3. Contas (Bills)
    const billsQ = query(collection(db, 'workspaces', workspaceId, BILLS_COLL), where('groupId', '==', groupId));
    const billsSnap = await getDocs(billsQ);
    billsSnap.forEach(d => batch.delete(d.ref));

    // 4. Shares (Divisões) - requer buscar bills primeiro ou filtrar shares por algum vínculo (aqui simplificado)
    // Para simplificar e evitar excesso de leituras, assumimos que shares órfãos não quebram a UI, 
    // mas o ideal seria buscar os IDs das bills e deletar shares onde billId in [ids].
    
    // 5. Convites
    const invitesQ = query(collection(db, 'workspaces', workspaceId, INVITES_COLL), where('groupId', '==', groupId));
    const invitesSnap = await getDocs(invitesQ);
    invitesSnap.forEach(d => batch.delete(d.ref));

    await batch.commit();
};

// --- PARTICIPANTS ---

export const listSplitParticipants = async (groupId: string, workspaceId?: string): Promise<SplitParticipant[]> => {
    if (!workspaceId) return [];
    const q = query(collection(db, 'workspaces', workspaceId, PARTICIPANTS_COLL), where('groupId', '==', groupId));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as SplitParticipant));
};

export const addSplitParticipant = async (participant: SplitParticipant, workspaceId?: string): Promise<SplitParticipant> => {
    if (!workspaceId) throw new Error("Workspace ID obrigatório");
    const ref = collection(db, 'workspaces', workspaceId, PARTICIPANTS_COLL);
    const { id, ...data } = participant;
    const docRef = await addDoc(ref, cleanPayload(data));
    return { id: docRef.id, ...participant } as SplitParticipant;
};

export const leaveSplitGroup = async (groupId: string, participantId: string, workspaceId?: string): Promise<void> => {
    if (!workspaceId) return;
    await deleteDoc(doc(db, 'workspaces', workspaceId, PARTICIPANTS_COLL, participantId));
};

// --- BILLS ---

export const listSplitBillsByGroup = async (groupId: string, workspaceId?: string): Promise<SplitBill[]> => {
    if (!workspaceId) return [];
    const q = query(collection(db, 'workspaces', workspaceId, BILLS_COLL), where('groupId', '==', groupId));
    const snap = await getDocs(q);
    return snap.docs
        .map(d => ({ id: d.id, ...d.data() } as SplitBill))
        .sort((a, b) => new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime());
};

export const createSplitBill = async (bill: SplitBill, shares: SplitShare[], workspaceId?: string): Promise<SplitBill> => {
    if (!workspaceId) throw new Error("Workspace ID obrigatório");

    const batch = writeBatch(db);

    // 1. Cria Conta
    const billRef = doc(collection(db, 'workspaces', workspaceId, BILLS_COLL));
    const { id: _, ...billData } = bill;
    batch.set(billRef, cleanPayload({
        ...billData,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    }));

    // 2. Cria Shares
    const sharesColl = collection(db, 'workspaces', workspaceId, SHARES_COLL);
    shares.forEach(share => {
        const shareRef = doc(sharesColl);
        const { id: __, ...shareData } = share;
        batch.set(shareRef, cleanPayload({
            ...shareData,
            billId: billRef.id // Vincula ID real
        }));
    });

    await batch.commit();
    return { id: billRef.id, ...bill } as SplitBill;
};

export const updateSplitBill = async (bill: SplitBill, shares?: SplitShare[], workspaceId?: string): Promise<SplitBill> => {
    if (!workspaceId) throw new Error("Workspace ID obrigatório");

    const batch = writeBatch(db);
    
    // 1. Atualiza Bill
    const billRef = doc(db, 'workspaces', workspaceId, BILLS_COLL, bill.id);
    const { id, ...billData } = bill;
    batch.update(billRef, cleanPayload({ ...billData, updatedAt: new Date().toISOString() }));

    // 2. Substitui Shares (se fornecidos)
    if (shares) {
        // Primeiro deleta antigos
        const oldSharesQ = query(collection(db, 'workspaces', workspaceId, SHARES_COLL), where('billId', '==', bill.id));
        const oldSnap = await getDocs(oldSharesQ);
        oldSnap.forEach(d => batch.delete(d.ref));

        // Cria novos
        const sharesColl = collection(db, 'workspaces', workspaceId, SHARES_COLL);
        shares.forEach(share => {
            const shareRef = doc(sharesColl);
            const { id: __, ...shareData } = share;
            batch.set(shareRef, cleanPayload({ ...shareData, billId: bill.id }));
        });
    }

    await batch.commit();
    return bill;
};

export const deleteSplitBill = async (billId: string, workspaceId?: string): Promise<void> => {
    if (!workspaceId) return;
    
    const batch = writeBatch(db);
    batch.delete(doc(db, 'workspaces', workspaceId, BILLS_COLL, billId));
    
    const sharesQ = query(collection(db, 'workspaces', workspaceId, SHARES_COLL), where('billId', '==', billId));
    const snap = await getDocs(sharesQ);
    snap.forEach(d => batch.delete(d.ref));

    await batch.commit();
};

export const updateSplitBillStatus = async (billId: string, status: SplitBillPaymentStatus, workspaceId?: string): Promise<void> => {
    if (!workspaceId) return;
    await updateDoc(doc(db, 'workspaces', workspaceId, BILLS_COLL, billId), { statusPagamento: status });
};

// --- SHARES ---

export const listSplitSharesByBill = async (billId: string, workspaceId?: string): Promise<SplitShare[]> => {
    if (!workspaceId) return [];
    const q = query(collection(db, 'workspaces', workspaceId, SHARES_COLL), where('billId', '==', billId));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as SplitShare));
};

export const listSplitSharesByGroup = async (groupId: string, workspaceId?: string): Promise<SplitShare[]> => {
    if (!workspaceId) return [];
    
    // Busca bills do grupo primeiro (Firestore não faz join)
    const bills = await listSplitBillsByGroup(groupId, workspaceId);
    if (bills.length === 0) return [];
    const billIds = bills.map(b => b.id);

    // O Firestore tem limite para 'in' operator (max 10). Se tiver mais, precisa fazer em lotes.
    // Aqui faremos uma abordagem simplificada buscando todos shares e filtrando em memória se forem poucos,
    // ou iterando. Para escalar, idealmente ter groupId no Share também.
    
    // Melhoria de design: Adicionar groupId no SplitShare facilitaria muito. 
    // Como não posso alterar types agora, vou buscar tudo e filtrar (não ideal para produção massiva, ok para SMB).
    const q = query(collection(db, 'workspaces', workspaceId, SHARES_COLL)); 
    const snap = await getDocs(q);
    return snap.docs
        .map(d => ({ id: d.id, ...d.data() } as SplitShare))
        .filter(s => billIds.includes(s.billId));
};

export const updateSplitShare = async (share: SplitShare, workspaceId?: string): Promise<SplitShare> => {
    if (!workspaceId) throw new Error("Workspace ID obrigatório");
    const { id, ...data } = share;
    await updateDoc(doc(db, 'workspaces', workspaceId, SHARES_COLL, id), cleanPayload(data));
    return share;
};

// --- INVITES ---

export const createSplitGroupInvite = async (
    groupId: string, 
    role: 'participante' | 'visualizador', 
    workspaceId?: string
): Promise<{ success: boolean; inviteId: string; code: string }> => {
    if (!workspaceId) throw new Error("Workspace ID é obrigatório");

    try {
        // Aponta para a função exata que acabámos de criar no backend
        const createInviteFn = httpsCallable(functions, 'createSplitGroupInvite');
        
        // Passa o payload (exatamente como o nosso Zod schema espera no backend)
        const result = await createInviteFn({
            groupId,
            role,
            workspaceId
        });

        return result.data as { success: boolean; inviteId: string; code: string };
    } catch (error: any) {
        console.error("Erro ao gerar convite via Cloud Function:", error);
        throw new Error(error.message || "Não foi possível gerar o convite.");
    }
};

export const listSplitGroupInvites = async (groupId: string, workspaceId?: string): Promise<SplitGroupInvite[]> => {
    if (!workspaceId) return [];
    const q = query(
        collection(db, 'workspaces', workspaceId, INVITES_COLL), 
        where('groupId', '==', groupId),
        where('status', '==', 'pendente')
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as SplitGroupInvite));
};

export const getInviteByCode = async (code: string, workspaceId?: string): Promise<SplitGroupInvite | undefined> => {
    if (!workspaceId) return undefined;
    const q = query(
        collection(db, 'workspaces', workspaceId, INVITES_COLL), 
        where('codigoConvite', '==', code),
        where('status', '==', 'pendente')
    );
    const snap = await getDocs(q);
    if (snap.empty) return undefined;
    return { id: snap.docs[0].id, ...snap.docs[0].data() } as SplitGroupInvite;
};

export const acceptInvite = async (
    code: string, 
    userName: string, 
    workspaceId?: string
): Promise<{ success: boolean; groupId?: string; message?: string }> => {
    
    if (!workspaceId) return { success: false, message: 'Workspace inválido' };

    try {
        // Aponta para a função segura no backend
        const acceptInviteFn = httpsCallable(functions, 'acceptSplitGroupInvite');
        
        // Envia apenas os dados (Payload)
        const result = await acceptInviteFn({
            code,
            userName,
            workspaceId
        });
        
        // Recebe a confirmação e o ID do grupo que o backend retornou
        const data = result.data as { success: boolean; groupId: string };
        
        return { 
            success: data.success, 
            groupId: data.groupId 
        };
        
    } catch (error: any) {
        console.error("Erro ao aceitar convite via Cloud Function:", error);
        
        // O Firebase Functions retorna a mensagem de erro que definimos no backend (ex: "Este convite já expirou.")
        return { 
            success: false, 
            message: error.message || "Não foi possível aceitar o convite." 
        };
    }
};