import { collection, doc } from 'firebase/firestore';
import { db } from '../../../lib/firebase';

const workspace = (workspaceId: string) => doc(db, 'workspaces', workspaceId);

export const investmentAccountsRef = (workspaceId: string) =>
  collection(workspace(workspaceId), 'investment_accounts');
export const investmentAssetsRef = (workspaceId: string) =>
  collection(workspace(workspaceId), 'investment_assets');
export const investmentPositionsRef = (workspaceId: string) =>
  collection(workspace(workspaceId), 'investment_positions');
export const investmentMovementsRef = (workspaceId: string) =>
  collection(workspace(workspaceId), 'investment_movements');
export const investmentSummaryRef = (workspaceId: string) =>
  doc(workspace(workspaceId), 'investment_summaries', 'current');
export const investmentReportPeriodsRef = (workspaceId: string) =>
  collection(workspace(workspaceId), 'investment_report_periods');
export const investmentAllocationSummariesRef = (workspaceId: string) =>
  collection(workspace(workspaceId), 'investment_allocation_summaries');
