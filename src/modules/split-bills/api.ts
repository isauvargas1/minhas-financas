
import { 
    SplitGroup, SplitBill, SplitParticipant, SplitShare,
    SplitGroupInvite, SplitBillPaymentStatus, SplitParticipantRole
} from '../../types.ts';
import { 
    initialSplitGroups, initialSplitBills, 
    initialSplitParticipants, initialSplitShares 
} from '../../constants.ts';

// --- KEY HELPERS ---
const getKey = (base: string, workspaceId?: string) => {
    if (!workspaceId || workspaceId === 'personal') return base;
    return `${base}_${workspaceId}`;
}

// --- MOCK DATABASE INIT ---
const loadFromStorage = <T>(key: string, defaultData: T): T => {
    const stored = localStorage.getItem(key);
    if (stored) {
        return JSON.parse(stored);
    }
    // Only init defaults for personal, or if explicitly desired
    // For now we only seed personal to avoid clutter
    if (key.indexOf('_personal') > -1 || !key.includes('_')) {
        localStorage.setItem(key, JSON.stringify(defaultData));
        return defaultData;
    }
    return [] as unknown as T;
};

const saveToStorage = (key: string, data: any) => {
    localStorage.setItem(key, JSON.stringify(data));
};

// --- KEYS ---
const KEY_GROUPS_BASE = 'split_groups';
const KEY_PARTICIPANTS_BASE = 'split_participants';
const KEY_BILLS_BASE = 'split_bills';
const KEY_SHARES_BASE = 'split_shares';
const KEY_INVITES_BASE = 'split_invites';

// --- SERVICE FUNCTIONS ---

// Groups
export const listSplitGroups = async (workspaceId?: string): Promise<SplitGroup[]> => {
    await new Promise(resolve => setTimeout(resolve, 500));
    return loadFromStorage<SplitGroup[]>(getKey(KEY_GROUPS_BASE, workspaceId), initialSplitGroups);
};

export const getSplitGroup = async (groupId: string, workspaceId?: string): Promise<SplitGroup | undefined> => {
    await new Promise(resolve => setTimeout(resolve, 300));
    const groups = loadFromStorage<SplitGroup[]>(getKey(KEY_GROUPS_BASE, workspaceId), initialSplitGroups);
    return groups.find(g => g.id === groupId);
};

export const createSplitGroup = async (group: SplitGroup, workspaceId?: string): Promise<SplitGroup> => {
    await new Promise(resolve => setTimeout(resolve, 500));
    const key = getKey(KEY_GROUPS_BASE, workspaceId);
    const groups = loadFromStorage<SplitGroup[]>(key, initialSplitGroups);
    const newGroups = [...groups, group];
    saveToStorage(key, newGroups);
    
    // Automatically add creator as owner
    const owner: SplitParticipant = {
        id: Date.now().toString(),
        groupId: group.id,
        nomeExibicao: 'Você',
        papel: 'dono',
        corIdentidade: group.corPrincipal,
        avatarEmojiOpcional: '👤'
    };
    await addSplitParticipant(owner, workspaceId);

    return group;
};

export const updateSplitGroup = async (group: SplitGroup, workspaceId?: string): Promise<SplitGroup> => {
    await new Promise(resolve => setTimeout(resolve, 500));
    const key = getKey(KEY_GROUPS_BASE, workspaceId);
    const groups = loadFromStorage<SplitGroup[]>(key, initialSplitGroups);
    const newGroups = groups.map(g => g.id === group.id ? group : g);
    saveToStorage(key, newGroups);
    return group;
};

export const deleteSplitGroup = async (groupId: string, workspaceId?: string): Promise<void> => {
    await new Promise(resolve => setTimeout(resolve, 500));
    const gKey = getKey(KEY_GROUPS_BASE, workspaceId);
    const groups = loadFromStorage<SplitGroup[]>(gKey, initialSplitGroups);
    saveToStorage(gKey, groups.filter(g => g.id !== groupId));
    
    // Cleanup related data
    const pKey = getKey(KEY_PARTICIPANTS_BASE, workspaceId);
    const participants = loadFromStorage<SplitParticipant[]>(pKey, initialSplitParticipants);
    saveToStorage(pKey, participants.filter(p => p.groupId !== groupId));
    
    const bKey = getKey(KEY_BILLS_BASE, workspaceId);
    const bills = loadFromStorage<SplitBill[]>(bKey, initialSplitBills);
    const groupBills = bills.filter(b => b.groupId === groupId);
    saveToStorage(bKey, bills.filter(b => b.groupId !== groupId));
    
    const sKey = getKey(KEY_SHARES_BASE, workspaceId);
    const shares = loadFromStorage<SplitShare[]>(sKey, initialSplitShares);
    const billIds = groupBills.map(b => b.id);
    saveToStorage(sKey, shares.filter(s => !billIds.includes(s.billId)));
    
    const iKey = getKey(KEY_INVITES_BASE, workspaceId);
    const invites = loadFromStorage<SplitGroupInvite[]>(iKey, []);
    saveToStorage(iKey, invites.filter(i => i.groupId !== groupId));
};

export const leaveSplitGroup = async (groupId: string, participantId: string, workspaceId?: string): Promise<void> => {
    await new Promise(resolve => setTimeout(resolve, 300));
    const key = getKey(KEY_PARTICIPANTS_BASE, workspaceId);
    const participants = loadFromStorage<SplitParticipant[]>(key, initialSplitParticipants);
    saveToStorage(key, participants.filter(p => p.id !== participantId));
};

// Participants
export const listSplitParticipants = async (groupId: string, workspaceId?: string): Promise<SplitParticipant[]> => {
    await new Promise(resolve => setTimeout(resolve, 300));
    const key = getKey(KEY_PARTICIPANTS_BASE, workspaceId);
    const all = loadFromStorage<SplitParticipant[]>(key, initialSplitParticipants);
    return all.filter(p => p.groupId === groupId);
};

export const addSplitParticipant = async (participant: SplitParticipant, workspaceId?: string): Promise<SplitParticipant> => {
    await new Promise(resolve => setTimeout(resolve, 300));
    const key = getKey(KEY_PARTICIPANTS_BASE, workspaceId);
    const all = loadFromStorage<SplitParticipant[]>(key, initialSplitParticipants);
    const newAll = [...all, participant];
    saveToStorage(key, newAll);
    return participant;
};

// Bills
export const listSplitBillsByGroup = async (groupId: string, workspaceId?: string): Promise<SplitBill[]> => {
    await new Promise(resolve => setTimeout(resolve, 400));
    const key = getKey(KEY_BILLS_BASE, workspaceId);
    const all = loadFromStorage<SplitBill[]>(key, initialSplitBills);
    return all.filter(b => b.groupId === groupId).sort((a, b) => 
        new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime()
    );
};

export const createSplitBill = async (bill: SplitBill, shares: SplitShare[], workspaceId?: string): Promise<SplitBill> => {
    await new Promise(resolve => setTimeout(resolve, 600));
    
    // Save Bill
    const bKey = getKey(KEY_BILLS_BASE, workspaceId);
    const bills = loadFromStorage<SplitBill[]>(bKey, initialSplitBills);
    saveToStorage(bKey, [...bills, bill]);
    
    // Save Shares
    const sKey = getKey(KEY_SHARES_BASE, workspaceId);
    const existingShares = loadFromStorage<SplitShare[]>(sKey, initialSplitShares);
    saveToStorage(sKey, [...existingShares, ...shares]);
    
    return bill;
};

export const updateSplitBill = async (bill: SplitBill, shares?: SplitShare[], workspaceId?: string): Promise<SplitBill> => {
    await new Promise(resolve => setTimeout(resolve, 400));
    const bKey = getKey(KEY_BILLS_BASE, workspaceId);
    const bills = loadFromStorage<SplitBill[]>(bKey, initialSplitBills);
    const newBills = bills.map(b => b.id === bill.id ? bill : b);
    saveToStorage(bKey, newBills);

    if (shares) {
        const sKey = getKey(KEY_SHARES_BASE, workspaceId);
        const existingShares = loadFromStorage<SplitShare[]>(sKey, initialSplitShares);
        // Remove old shares for this bill
        const filteredShares = existingShares.filter(s => s.billId !== bill.id);
        // Add new shares
        saveToStorage(sKey, [...filteredShares, ...shares]);
    }

    return bill;
};

export const deleteSplitBill = async (billId: string, workspaceId?: string): Promise<void> => {
    await new Promise(resolve => setTimeout(resolve, 400));
    
    // Delete Bill
    const bKey = getKey(KEY_BILLS_BASE, workspaceId);
    const bills = loadFromStorage<SplitBill[]>(bKey, initialSplitBills);
    saveToStorage(bKey, bills.filter(b => b.id !== billId));

    // Delete Shares
    const sKey = getKey(KEY_SHARES_BASE, workspaceId);
    const shares = loadFromStorage<SplitShare[]>(sKey, initialSplitShares);
    saveToStorage(sKey, shares.filter(s => s.billId !== billId));
}

export const updateSplitBillStatus = async (billId: string, status: SplitBillPaymentStatus, workspaceId?: string): Promise<void> => {
     await new Promise(resolve => setTimeout(resolve, 300));
     const bKey = getKey(KEY_BILLS_BASE, workspaceId);
     const bills = loadFromStorage<SplitBill[]>(bKey, initialSplitBills);
     const newBills = bills.map(b => b.id === billId ? { ...b, statusPagamento: status } : b);
     saveToStorage(bKey, newBills);
}

// Shares
export const listSplitSharesByBill = async (billId: string, workspaceId?: string): Promise<SplitShare[]> => {
    await new Promise(resolve => setTimeout(resolve, 200));
    const sKey = getKey(KEY_SHARES_BASE, workspaceId);
    const all = loadFromStorage<SplitShare[]>(sKey, initialSplitShares);
    return all.filter(s => s.billId === billId);
};

export const listSplitSharesByGroup = async (groupId: string, workspaceId?: string): Promise<SplitShare[]> => {
    await new Promise(resolve => setTimeout(resolve, 400));
    const bKey = getKey(KEY_BILLS_BASE, workspaceId);
    const bills = loadFromStorage<SplitBill[]>(bKey, initialSplitBills);
    const groupBillIds = bills.filter(b => b.groupId === groupId).map(b => b.id);
    
    const sKey = getKey(KEY_SHARES_BASE, workspaceId);
    const shares = loadFromStorage<SplitShare[]>(sKey, initialSplitShares);
    return shares.filter(s => groupBillIds.includes(s.billId));
};

export const updateSplitShare = async (share: SplitShare, workspaceId?: string): Promise<SplitShare> => {
    await new Promise(resolve => setTimeout(resolve, 300));
    const sKey = getKey(KEY_SHARES_BASE, workspaceId);
    const all = loadFromStorage<SplitShare[]>(sKey, initialSplitShares);
    const newAll = all.map(s => s.id === share.id ? share : s);
    saveToStorage(sKey, newAll);
    return share;
};

// --- INVITES ---

const generateCode = () => {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
};

export const createSplitGroupInvite = async (groupId: string, role: 'participante' | 'visualizador', workspaceId?: string): Promise<SplitGroupInvite> => {
    await new Promise(resolve => setTimeout(resolve, 300));
    const iKey = getKey(KEY_INVITES_BASE, workspaceId);
    const invites = loadFromStorage<SplitGroupInvite[]>(iKey, []);
    
    const existing = invites.find(i => i.groupId === groupId && i.papelSugerido === role && i.status === 'pendente');
    if (existing) return existing;

    const newInvite: SplitGroupInvite = {
        id: Date.now().toString(),
        groupId,
        codigoConvite: generateCode(),
        papelSugerido: role,
        status: 'pendente',
        expiraEm: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    };

    saveToStorage(iKey, [...invites, newInvite]);
    return newInvite;
};

export const listSplitGroupInvites = async (groupId: string, workspaceId?: string): Promise<SplitGroupInvite[]> => {
    await new Promise(resolve => setTimeout(resolve, 200));
    const iKey = getKey(KEY_INVITES_BASE, workspaceId);
    const invites = loadFromStorage<SplitGroupInvite[]>(iKey, []);
    return invites.filter(i => i.groupId === groupId && i.status === 'pendente');
};

export const getInviteByCode = async (code: string, workspaceId?: string): Promise<SplitGroupInvite | undefined> => {
    await new Promise(resolve => setTimeout(resolve, 500));
    const iKey = getKey(KEY_INVITES_BASE, workspaceId);
    const invites = loadFromStorage<SplitGroupInvite[]>(iKey, []);
    return invites.find(i => i.codigoConvite === code && i.status === 'pendente');
};

export const acceptInvite = async (code: string, userName: string, workspaceId?: string): Promise<{ success: boolean; groupId?: string; message?: string }> => {
    await new Promise(resolve => setTimeout(resolve, 600));
    
    const iKey = getKey(KEY_INVITES_BASE, workspaceId);
    const invites = loadFromStorage<SplitGroupInvite[]>(iKey, []);
    const invite = invites.find(i => i.codigoConvite === code && i.status === 'pendente');
    
    if (!invite) {
        return { success: false, message: 'Código inválido ou expirado.' };
    }

    const pKey = getKey(KEY_PARTICIPANTS_BASE, workspaceId);
    const participants = loadFromStorage<SplitParticipant[]>(pKey, initialSplitParticipants);
    
    const alreadyIn = participants.some(p => p.groupId === invite.groupId && p.nomeExibicao === userName);
    if (alreadyIn) {
        return { success: false, message: 'Você já faz parte deste grupo.' };
    }

    const group = await getSplitGroup(invite.groupId, workspaceId);
    if (!group) return { success: false, message: 'Grupo não encontrado.' };

    const newParticipant: SplitParticipant = {
        id: Date.now().toString(),
        groupId: invite.groupId,
        nomeExibicao: userName,
        papel: invite.papelSugerido as SplitParticipantRole,
        corIdentidade: '#' + Math.floor(Math.random()*16777215).toString(16),
        avatarEmojiOpcional: '👋'
    };

    saveToStorage(pKey, [...participants, newParticipant]);
    return { success: true, groupId: invite.groupId };
};
