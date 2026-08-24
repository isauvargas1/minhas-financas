import type { Goal } from '../../types';

export const mapGoalDocument = (
  id: string,
  data: Omit<Goal, 'id'> & { investmentProgressCents?: number },
  investmentsV2Enabled: boolean,
): Goal => ({
  id,
  ...data,
  progressBasis: data.progressBasis ?? 'net_contributions',
  currentAmount: investmentsV2Enabled && Number.isSafeInteger(data.investmentProgressCents)
    ? data.investmentProgressCents! / 100
    : data.currentAmount,
});
