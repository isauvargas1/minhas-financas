import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listGoals, createGoal, updateGoal, deleteGoal } from './api';
import { Goal } from '../../types';
import { useWorkspace } from '../../contexts/WorkspaceContext';

export const KEYS = {
    all: (ws: string) => ['goals', ws],
};

export const useGoals = () => {
    const { activeWorkspace } = useWorkspace();
    return useQuery({
        queryKey: KEYS.all(activeWorkspace.id),
        queryFn: () => listGoals(activeWorkspace.id),
        enabled: !!activeWorkspace.id
    });
};

export const useCreateGoal = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    
    return useMutation({
        mutationFn: (goal: Omit<Goal, 'id'>) => createGoal(goal, activeWorkspace.id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: KEYS.all(activeWorkspace.id) });
        }
    });
};

export const useUpdateGoal = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    
    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: Partial<Goal> }) => 
            updateGoal(id, data, activeWorkspace.id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: KEYS.all(activeWorkspace.id) });
        }
    });
};

export const useDeleteGoal = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    
    return useMutation({
        mutationFn: (id: string) => deleteGoal(id, activeWorkspace.id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: KEYS.all(activeWorkspace.id) });
        }
    });
};