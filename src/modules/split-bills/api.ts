import {
    collection,
    doc,
    documentId,
    getDocs,
    getDoc,
    addDoc,
    updateDoc,
    deleteDoc,
    limit,
    orderBy,
    query,
    startAfter,
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

/**
 * Tetos de leitura da divisão de contas.
 *
 * O pior padrão do módulo estava em `listSplitSharesByGroup`: ele lia a
 * coleção **inteira** de rateios do workspace e filtrava em memória pelos
 * títulos do grupo — e o comentário do próprio código admitia a escolha
 * ("não ideal para produção massiva"). Como cada cartão da lista de grupos
 * chama essa função, uma tela com N grupos fazia N varreduras completas de
 * `split_shares` por renderização.
 *
 * A correção não é uma varredura por título (trocar uma varredura por N), e
 * sim uma consulta por `billId` em blocos de 30 — o teto do operador `in` do
 * Firestore. O número de consultas passa a ser proporcional ao número de
 * títulos do grupo, cada uma servida por índice, e o resultado é exatamente o
 * conjunto necessário.
 */
export const SPLIT_GROUPS_PAGE_SIZE = 100;
export const SPLIT_BILLS_PAGE_SIZE = 300;
export const SPLIT_PARTICIPANTS_LIMIT = 200;
export const SPLIT_SHARES_PAGE_SIZE = 500;
export const SPLIT_INVITES_LIMIT = 100;

/** Teto do operador `in` do Firestore. */
const IN_OPERATOR_LIMIT = 30;

const chunked = <T>(values: T[], size: number): T[][] => {
    const chunks: T[][] = [];
    for (let index = 0; index < values.length; index += size) {
        chunks.push(values.slice(index, index + size));
    }
    return chunks;
};

export interface SplitGroupPage {
    items: SplitGroup[];
    nextCursor?: string;
    hasMore: boolean;
}

export interface SplitBillList {
    items: SplitBill[];
    /** A consulta bateu no teto: os agregados desta tela não cobrem tudo. */
    truncated: boolean;
}

export interface SplitShareList {
    items: SplitShare[];
    truncated: boolean;
}

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

/**
 * Uma página de grupos.
 *
 * A ordem é por `documentId()`, o único campo presente em todo documento: os
 * grupos anteriores a `dataCriacao` sairiam da consulta se ela ordenasse por
 * um campo opcional.
 */
export const listSplitGroups = async (
    workspaceId?: string,
    options: { pageSize?: number; cursor?: string } = {},
): Promise<SplitGroupPage> => {
    if (!workspaceId) return { items: [], hasMore: false };
    const pageSize = options.pageSize ?? SPLIT_GROUPS_PAGE_SIZE;
    const ref = collection(db, 'workspaces', workspaceId, GROUPS_COLL);
    const snapshot = await getDocs(query(
        ref,
        orderBy(documentId()),
        ...(options.cursor ? [startAfter(options.cursor)] : []),
        limit(pageSize + 1),
    ));
    const docs = snapshot.docs.slice(0, pageSize);
    return {
        items: docs.map(entry => ({ id: entry.id, ...entry.data() } as SplitGroup)),
        nextCursor: docs[docs.length - 1]?.id,
        hasMore: snapshot.size > pageSize,
    };
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

/**
 * Exclusão de grupo com cascata paginada.
 *
 * A versão anterior acumulava grupo, participantes, títulos e convites num
 * **único** lote. Um lote do Firestore aceita 500 escritas, e os tetos de
 * leitura somados passam disso: um grupo grande simplesmente não podia ser
 * excluído, porque o commit era recusado por inteiro.
 *
 * Agora cada coleção é drenada em lotes próprios, e o documento do grupo é
 * apagado por último — se algo falhar no meio, o grupo continua existindo e a
 * operação pode ser repetida.
 */
export const deleteSplitGroup = async (groupId: string, workspaceId?: string): Promise<void> => {
    if (!workspaceId) return;

    /** Escritas por lote, com folga sob o teto de 500 do Firestore. */
    const CASCADE_BATCH = 400;

    const drain = async (collectionName: string, field: string, value: string) => {
        for (;;) {
            const page = await getDocs(query(
                collection(db, 'workspaces', workspaceId, collectionName),
                where(field, '==', value),
                orderBy(documentId()),
                limit(CASCADE_BATCH),
            ));
            if (page.empty) return;
            const batch = writeBatch(db);
            page.docs.forEach(entry => batch.delete(entry.ref));
            await batch.commit();
            if (page.size < CASCADE_BATCH) return;
        }
    };

    // Rateios primeiro: são filhos dos títulos, e apagar o título antes
    // deixaria rateio órfão se a execução parasse no meio.
    const bills = await getDocs(query(
        collection(db, 'workspaces', workspaceId, BILLS_COLL),
        where('groupId', '==', groupId),
        orderBy(documentId()),
        limit(SPLIT_BILLS_PAGE_SIZE),
    ));
    for (const bill of bills.docs) {
        await drain(SHARES_COLL, 'billId', bill.id);
    }

    await drain(BILLS_COLL, 'groupId', groupId);
    await drain(PARTICIPANTS_COLL, 'groupId', groupId);
    await drain(INVITES_COLL, 'groupId', groupId);

    await deleteDoc(doc(db, 'workspaces', workspaceId, GROUPS_COLL, groupId));
};

// --- PARTICIPANTS ---

export const listSplitParticipants = async (groupId: string, workspaceId?: string): Promise<SplitParticipant[]> => {
    if (!workspaceId) return [];
    const q = query(
        collection(db, 'workspaces', workspaceId, PARTICIPANTS_COLL),
        where('groupId', '==', groupId),
        orderBy(documentId()),
        limit(SPLIT_PARTICIPANTS_LIMIT),
    );
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

/**
 * Títulos de um grupo, com teto explícito.
 *
 * A ordenação de exibição continua sendo por `createdAt` no cliente, porque
 * `createdAt` é opcional em documentos antigos e ordenar por ele no servidor
 * os removeria da consulta. O que muda é que a leitura passa a ter `orderBy`
 * determinístico e `limit`, e o estouro do teto é **declarado** em vez de
 * virar um agregado silenciosamente parcial na tela.
 */
export const listSplitBillsByGroup = async (
    groupId: string,
    workspaceId?: string,
): Promise<SplitBillList> => {
    if (!workspaceId) return { items: [], truncated: false };
    const snap = await getDocs(query(
        collection(db, 'workspaces', workspaceId, BILLS_COLL),
        where('groupId', '==', groupId),
        orderBy(documentId()),
        limit(SPLIT_BILLS_PAGE_SIZE + 1),
    ));
    const docs = snap.docs.slice(0, SPLIT_BILLS_PAGE_SIZE);
    return {
        items: docs
            .map(d => ({ id: d.id, ...d.data() } as SplitBill))
            .sort((a, b) => new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime()),
        truncated: snap.size > SPLIT_BILLS_PAGE_SIZE,
    };
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
        const oldSharesQ = query(
            collection(db, 'workspaces', workspaceId, SHARES_COLL),
            where('billId', '==', bill.id),
            orderBy(documentId()),
            limit(SPLIT_SHARES_PAGE_SIZE),
        );
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
    
    const sharesQ = query(
        collection(db, 'workspaces', workspaceId, SHARES_COLL),
        where('billId', '==', billId),
        orderBy(documentId()),
        // Um lote do Firestore aceita 500 escritas, e a exclusão do título já
        // consome uma delas.
        limit(499),
    );
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
    const q = query(
        collection(db, 'workspaces', workspaceId, SHARES_COLL),
        where('billId', '==', billId),
        orderBy(documentId()),
        limit(SPLIT_SHARES_PAGE_SIZE),
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as SplitShare));
};

/**
 * Rateios em aberto dos títulos de um grupo.
 *
 * A versão anterior lia `split_shares` inteira e filtrava por `billId` em
 * memória. Como cada cartão da lista de grupos chama esta função, a tela de
 * grupos fazia uma varredura completa da coleção **por grupo exibido** — e
 * tudo isso para calcular dois escalares por cartão.
 *
 * Agora a consulta é por `billId` em blocos de 30 (teto do operador `in`). O
 * número de consultas é proporcional aos títulos do grupo — já limitados por
 * `listSplitBillsByGroup` — e não ao tamanho da coleção do workspace.
 *
 * **Devolve todos os rateios, não só os em aberto.** Restringir a
 * `status == 'aPagar'` reduziria ainda mais a leitura, e os dois cartões de
 * grupo de fato só somam os em aberto — mas o mesmo resultado alimenta o
 * formulário de edição de título (`SplitGroupDetailsView.getBillShares` →
 * `SplitBillFormModal`), que semeia os participantes selecionados a partir
 * dele e, ao salvar, **apaga e reescreve** os rateios do título. Filtrar aqui
 * faria a edição de um título com participante já pago excluir o rateio dele
 * em definitivo e redividir o valor entre os demais.
 *
 * `truncated` propaga o teto dos títulos: se nem todos couberam, os totais
 * derivados destes rateios também não cobrem tudo, e a tela precisa dizê-lo.
 */
export const listSplitSharesByGroup = async (
    groupId: string,
    workspaceId?: string,
): Promise<SplitShareList> => {
    if (!workspaceId) return { items: [], truncated: false };

    const bills = await listSplitBillsByGroup(groupId, workspaceId);
    if (bills.items.length === 0) {
        return { items: [], truncated: bills.truncated };
    }

    const ref = collection(db, 'workspaces', workspaceId, SHARES_COLL);
    const pages = await Promise.all(
        chunked(bills.items.map(bill => bill.id), IN_OPERATOR_LIMIT).map(ids =>
            getDocs(query(
                ref,
                where('billId', 'in', ids),
                orderBy(documentId()),
                limit(SPLIT_SHARES_PAGE_SIZE + 1),
            )),
        ),
    );

    let truncated = bills.truncated;
    const items: SplitShare[] = [];
    for (const page of pages) {
        if (page.size > SPLIT_SHARES_PAGE_SIZE) truncated = true;
        page.docs.slice(0, SPLIT_SHARES_PAGE_SIZE).forEach(d => {
            items.push({ id: d.id, ...d.data() } as SplitShare);
        });
    }

    return { items, truncated };
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
        where('status', '==', 'pendente'),
        orderBy(documentId()),
        limit(SPLIT_INVITES_LIMIT),
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as SplitGroupInvite));
};

export const getInviteByCode = async (code: string, workspaceId?: string): Promise<SplitGroupInvite | undefined> => {
    if (!workspaceId) return undefined;
    // O código de convite é único: a consulta devolve no máximo um documento,
    // e só o primeiro era usado. `limit(1)` torna isso explícito.
    const q = query(
        collection(db, 'workspaces', workspaceId, INVITES_COLL),
        where('codigoConvite', '==', code),
        where('status', '==', 'pendente'),
        limit(1),
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