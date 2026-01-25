
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from './api.ts';
import { SplitBill, SplitParticipant, SplitShare } from '../../types.ts';
import { useWorkspace } from '../../contexts/WorkspaceContext.tsx';

// Keys for caching (Workspace dependent)
export const keys = {
    groups: (ws: string) => ['splitGroups', ws],
    group: (id: string, ws: string) => ['splitGroup', id, ws],
    participants: (groupId: string, ws: string) => ['splitParticipants', groupId, ws],
    bills: (groupId: string, ws: string) => ['splitBills', groupId, ws],
    shares: (billId: string, ws: string) => ['splitShares', billId, ws],
    groupShares: (groupId: string, ws: string) => ['splitGroupShares', groupId, ws],
    invites: (groupId: string, ws: string) => ['splitGroupInvites', groupId, ws]
};

// --- GROUPS HOOKS ---
export const useSplitGroups = () => {
    const { activeWorkspace } = useWorkspace();
    return useQuery({
        queryKey: keys.groups(activeWorkspace.id),
        queryFn: () => api.listSplitGroups(activeWorkspace.id),
        enabled: !!activeWorkspace.id
    });
};

export const useSplitGroup = (groupId: string) => {
    const { activeWorkspace } = useWorkspace();
    return useQuery({
        queryKey: keys.group(groupId, activeWorkspace.id),
        queryFn: () => api.getSplitGroup(groupId, activeWorkspace.id),
        enabled: !!groupId && !!activeWorkspace.id
    });
};

export const useCreateSplitGroup = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (group: any) => api.createSplitGroup(group, activeWorkspace.id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: keys.groups(activeWorkspace.id) });
        }
    });
};

export const useUpdateSplitGroup = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (group: any) => api.updateSplitGroup(group, activeWorkspace.id),
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: keys.groups(activeWorkspace.id) });
            queryClient.invalidateQueries({ queryKey: keys.group(data.id, activeWorkspace.id) });
        }
    });
};

export const useDeleteSplitGroup = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (groupId: string) => api.deleteSplitGroup(groupId, activeWorkspace.id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: keys.groups(activeWorkspace.id) });
        }
    });
};

export const useLeaveSplitGroup = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ groupId, participantId }: { groupId: string; participantId: string }) => 
            api.leaveSplitGroup(groupId, participantId, activeWorkspace.id),
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({ queryKey: keys.groups(activeWorkspace.id) });
            queryClient.invalidateQueries({ queryKey: keys.participants(variables.groupId, activeWorkspace.id) });
        }
    });
};

// --- PARTICIPANTS HOOKS ---
export const useSplitParticipants = (groupId: string) => {
    const { activeWorkspace } = useWorkspace();
    return useQuery({
        queryKey: keys.participants(groupId, activeWorkspace.id),
        queryFn: () => api.listSplitParticipants(groupId, activeWorkspace.id),
        enabled: !!groupId && !!activeWorkspace.id
    });
};

export const useAddSplitParticipant = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (p: SplitParticipant) => api.addSplitParticipant(p, activeWorkspace.id),
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({ queryKey: keys.participants(variables.groupId, activeWorkspace.id) });
        }
    });
};

// --- BILLS HOOKS ---
export const useSplitBills = (groupId: string) => {
    const { activeWorkspace } = useWorkspace();
    return useQuery({
        queryKey: keys.bills(groupId, activeWorkspace.id),
        queryFn: () => api.listSplitBillsByGroup(groupId, activeWorkspace.id),
        enabled: !!groupId && !!activeWorkspace.id
    });
};

export const useCreateSplitBill = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ bill, shares }: { bill: SplitBill; shares: SplitShare[] }) => 
            api.createSplitBill(bill, shares, activeWorkspace.id),
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({ queryKey: keys.bills(variables.bill.groupId, activeWorkspace.id) });
            queryClient.invalidateQueries({ queryKey: keys.groupShares(variables.bill.groupId, activeWorkspace.id) });
        }
    });
};

export const useUpdateSplitBill = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ bill, shares }: { bill: SplitBill; shares?: SplitShare[] }) => 
            api.updateSplitBill(bill, shares, activeWorkspace.id),
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: keys.bills(data.groupId, activeWorkspace.id) });
            queryClient.invalidateQueries({ queryKey: keys.groupShares(data.groupId, activeWorkspace.id) });
        }
    });
};

export const useDeleteSplitBill = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ billId, groupId }: { billId: string; groupId: string }) => 
            api.deleteSplitBill(billId, activeWorkspace.id),
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({ queryKey: keys.bills(variables.groupId, activeWorkspace.id) });
            queryClient.invalidateQueries({ queryKey: keys.groupShares(variables.groupId, activeWorkspace.id) });
        }
    });
};

export const useUpdateSplitBillStatus = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ billId, status, groupId }: { billId: string; status: any; groupId: string }) => 
            api.updateSplitBillStatus(billId, status, activeWorkspace.id),
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({ queryKey: keys.bills(variables.groupId, activeWorkspace.id) });
        }
    });
};

// --- SHARES HOOKS ---
export const useSplitShares = (billId: string) => {
    const { activeWorkspace } = useWorkspace();
    return useQuery({
        queryKey: keys.shares(billId, activeWorkspace.id),
        queryFn: () => api.listSplitSharesByBill(billId, activeWorkspace.id),
        enabled: !!billId && !!activeWorkspace.id
    });
};

export const useSplitGroupShares = (groupId: string) => {
    const { activeWorkspace } = useWorkspace();
    return useQuery({
        queryKey: keys.groupShares(groupId, activeWorkspace.id),
        queryFn: () => api.listSplitSharesByGroup(groupId, activeWorkspace.id),
        enabled: !!groupId && !!activeWorkspace.id
    });
}

export const useUpdateSplitShare = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (share: SplitShare) => api.updateSplitShare(share, activeWorkspace.id),
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: keys.shares(data.billId, activeWorkspace.id) });
            queryClient.invalidateQueries({ queryKey: ['splitGroupShares'] }); // fuzzy
        }
    });
};

// --- INVITES HOOKS ---
export const useSplitGroupInvites = (groupId: string) => {
    const { activeWorkspace } = useWorkspace();
    return useQuery({
        queryKey: keys.invites(groupId, activeWorkspace.id),
        queryFn: () => api.listSplitGroupInvites(groupId, activeWorkspace.id),
        enabled: !!groupId && !!activeWorkspace.id
    });
};

export const useCreateInvite = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ groupId, role }: { groupId: string; role: 'participante' | 'visualizador' }) => 
            api.createSplitGroupInvite(groupId, role, activeWorkspace.id),
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({ queryKey: keys.invites(variables.groupId, activeWorkspace.id) });
        }
    });
};

export const useAcceptInvite = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ code, userName }: { code: string; userName: string }) => 
            api.acceptInvite(code, userName, activeWorkspace.id),
        onSuccess: (data) => {
            if (data.success && data.groupId) {
                queryClient.invalidateQueries({ queryKey: keys.groups(activeWorkspace.id) });
                queryClient.invalidateQueries({ queryKey: keys.participants(data.groupId, activeWorkspace.id) });
            }
        }
    });
};
