import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {useWorkspace} from '../../contexts/WorkspaceContext';
import type {Goal} from '../../types';
import {
  archiveGoal,
  createGoal,
  listGoals,
  setGoalTransactionLinks,
  updateGoal,
  type GoalWriteInput,
} from './api';

export const KEYS = {all: (workspaceId: string, investmentsV2Enabled?: boolean) => ['goals', workspaceId, investmentsV2Enabled ? 'v2' : 'legacy']};

const useInvalidateGoals = () => {
  const {activeWorkspace} = useWorkspace();
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({queryKey: ['goals', activeWorkspace.id]}),
      queryClient.invalidateQueries({queryKey: ['transactions', activeWorkspace.id]}),
    ]);
  };
};

export const useGoals = () => {
  const {activeWorkspace} = useWorkspace();
  const investmentsV2Enabled = activeWorkspace.features?.investmentsV2?.enabled === true;
  return useQuery({
    queryKey: KEYS.all(activeWorkspace.id, investmentsV2Enabled),
    queryFn: () => listGoals(activeWorkspace.id, investmentsV2Enabled),
    enabled: Boolean(activeWorkspace.id) && activeWorkspace.id !== 'loading',
  });
};

export const useCreateGoal = () => {
  const {activeWorkspace} = useWorkspace();
  const invalidate = useInvalidateGoals();
  return useMutation({
    mutationFn: ({goal, idempotencyKey}: {goal: GoalWriteInput; idempotencyKey: string}) =>
      createGoal(goal, activeWorkspace.id, idempotencyKey),
    onSuccess: invalidate,
  });
};

export const useUpdateGoal = () => {
  const {activeWorkspace} = useWorkspace();
  const invalidate = useInvalidateGoals();
  return useMutation({
    mutationFn: ({id, goal, idempotencyKey}: {id: string; goal: GoalWriteInput; idempotencyKey: string}) =>
      updateGoal(id, goal, activeWorkspace.id, idempotencyKey),
    onSuccess: invalidate,
  });
};

export const useSetGoalTransactionLinks = () => {
  const {activeWorkspace} = useWorkspace();
  const invalidate = useInvalidateGoals();
  return useMutation({
    mutationFn: ({goalId, transactionIds, idempotencyKey}: {
      goalId: string;
      transactionIds: string[];
      idempotencyKey: string;
    }) => setGoalTransactionLinks(goalId, transactionIds, activeWorkspace.id, idempotencyKey),
    onSuccess: invalidate,
  });
};

export const useArchiveGoal = () => {
  const {activeWorkspace} = useWorkspace();
  const invalidate = useInvalidateGoals();
  return useMutation({
    mutationFn: ({id, idempotencyKey}: {id: string; idempotencyKey: string}) =>
      archiveGoal(id, activeWorkspace.id, idempotencyKey),
    onSuccess: invalidate,
  });
};

export type GoalMutationResult = Goal;
