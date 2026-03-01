import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
    listSplitGroups, getSplitGroup, createSplitGroup, updateSplitGroup, deleteSplitGroup, leaveSplitGroup,
    listSplitParticipants, addSplitParticipant,
    listSplitBillsByGroup, createSplitBill, updateSplitBill, deleteSplitBill, updateSplitBillStatus,
    listSplitSharesByBill, listSplitSharesByGroup, updateSplitShare,
    createSplitGroupInvite, listSplitGroupInvites, getInviteByCode, acceptInvite
} from './api';
import { SplitGroup, SplitBill, SplitParticipant, SplitShare } from '../../types';
import { useWorkspace } from '../../contexts/WorkspaceContext';

export const KEYS = {
    groups: (ws: string) => ['split_groups', ws],
    group: (ws: string, id: string) => ['split_group', ws, id],
    participants: (ws: string, groupId: string) => ['split_participants', ws, groupId],
    bills: (ws: string, groupId: string) => ['split_bills', ws, groupId],
    shares: (ws: string, billId: string) => ['split_shares', ws, billId],
    groupShares: (ws: string, groupId: string) => ['split_group_shares', ws, groupId],
    invites: (ws: string, groupId: string) => ['split_invites', ws, groupId],
};

// --- GROUPS ---

export const useSplitGroups = () => {
    const { activeWorkspace } = useWorkspace();
    return useQuery({
        queryKey: KEYS.groups(activeWorkspace.id),
        queryFn: () => listSplitGroups(activeWorkspace.id),
        enabled: !!activeWorkspace.id
    });
};

export const useSplitGroup = (groupId: string | undefined) => {
    const { activeWorkspace } = useWorkspace();
    return useQuery({
        queryKey: KEYS.group(activeWorkspace.id, groupId || ''),
        queryFn: () => getSplitGroup(groupId!, activeWorkspace.id),
        enabled: !!activeWorkspace.id && !!groupId
    });
};

export const useCreateSplitGroup = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (group: SplitGroup) => createSplitGroup(group, activeWorkspace.id),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: KEYS.groups(activeWorkspace.id) })
    });
};

export const useUpdateSplitGroup = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (group: SplitGroup) => updateSplitGroup(group, activeWorkspace.id),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: KEYS.groups(activeWorkspace.id) })
    });
};

export const useDeleteSplitGroup = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (groupId: string) => deleteSplitGroup(groupId, activeWorkspace.id),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: KEYS.groups(activeWorkspace.id) })
    });
};

// --- PARTICIPANTS ---

export const useSplitParticipants = (groupId: string) => {
    const { activeWorkspace } = useWorkspace();
    return useQuery({
        queryKey: KEYS.participants(activeWorkspace.id, groupId),
        queryFn: () => listSplitParticipants(groupId, activeWorkspace.id),
        enabled: !!activeWorkspace.id && !!groupId
    });
};

export const useAddSplitParticipant = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (p: SplitParticipant) => addSplitParticipant(p, activeWorkspace.id),
        onSuccess: (_, variables) => queryClient.invalidateQueries({ queryKey: KEYS.participants(activeWorkspace.id, variables.groupId) })
    });
};

export const useLeaveSplitGroup = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (data: { groupId: string; participantId: string }) => 
            leaveSplitGroup(data.groupId, data.participantId, activeWorkspace.id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: KEYS.groups(activeWorkspace.id) });
        }
    });
};

// --- BILLS ---

export const useSplitBills = (groupId: string) => {
    const { activeWorkspace } = useWorkspace();
    return useQuery({
        queryKey: KEYS.bills(activeWorkspace.id, groupId),
        queryFn: () => listSplitBillsByGroup(groupId, activeWorkspace.id),
        enabled: !!activeWorkspace.id && !!groupId
    });
};

export const useCreateSplitBill = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (data: { bill: SplitBill; shares: SplitShare[] }) => createSplitBill(data.bill, data.shares, activeWorkspace.id),
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({ queryKey: KEYS.bills(activeWorkspace.id, variables.bill.groupId) });
            queryClient.invalidateQueries({ queryKey: KEYS.groupShares(activeWorkspace.id, variables.bill.groupId) });
        }
    });
};

export const useUpdateSplitBill = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (data: { bill: SplitBill; shares?: SplitShare[] }) => updateSplitBill(data.bill, data.shares, activeWorkspace.id),
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({ queryKey: KEYS.bills(activeWorkspace.id, variables.bill.groupId) });
            queryClient.invalidateQueries({ queryKey: KEYS.shares(activeWorkspace.id, variables.bill.id) });
        }
    });
};

export const useDeleteSplitBill = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (data: { billId: string; groupId: string }) => deleteSplitBill(data.billId, activeWorkspace.id),
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({ queryKey: KEYS.bills(activeWorkspace.id, variables.groupId) });
        }
    });
};

export const useUpdateSplitBillStatus = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (data: { billId: string; status: any; groupId: string }) => updateSplitBillStatus(data.billId, data.status, activeWorkspace.id),
        onSuccess: (_, variables) => queryClient.invalidateQueries({ queryKey: KEYS.bills(activeWorkspace.id, variables.groupId) })
    });
};

// --- SHARES ---

export const useSplitShares = (billId: string) => {
    const { activeWorkspace } = useWorkspace();
    return useQuery({
        queryKey: KEYS.shares(activeWorkspace.id, billId),
        queryFn: () => listSplitSharesByBill(billId, activeWorkspace.id),
        enabled: !!activeWorkspace.id && !!billId
    });
};

export const useSplitGroupShares = (groupId: string) => {
    const { activeWorkspace } = useWorkspace();
    return useQuery({
        queryKey: KEYS.groupShares(activeWorkspace.id, groupId),
        queryFn: () => listSplitSharesByGroup(groupId, activeWorkspace.id),
        enabled: !!activeWorkspace.id && !!groupId
    });
};

export const useUpdateSplitShare = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (share: SplitShare) => updateSplitShare(share, activeWorkspace.id),
        onSuccess: (_, variables) => queryClient.invalidateQueries({ queryKey: KEYS.shares(activeWorkspace.id, variables.billId) })
    });
};

// --- INVITES ---

export const useCreateSplitGroupInvite = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (data: { groupId: string; role: 'participante' | 'visualizador' }) => 
            createSplitGroupInvite(data.groupId, data.role, activeWorkspace.id),
        onSuccess: (_, variables) => queryClient.invalidateQueries({ queryKey: KEYS.invites(activeWorkspace.id, variables.groupId) })
    });
};

export const useSplitGroupInvites = (groupId: string) => {
    const { activeWorkspace } = useWorkspace();
    return useQuery({
        queryKey: KEYS.invites(activeWorkspace.id, groupId),
        queryFn: () => listSplitGroupInvites(groupId, activeWorkspace.id),
        enabled: !!activeWorkspace.id && !!groupId
    });
};

export const useAcceptInvite = () => {
    const { activeWorkspace } = useWorkspace();
    return useMutation({
        mutationFn: (data: { code: string; userName: string }) => acceptInvite(data.code, data.userName, activeWorkspace.id)
    });
};