import * as admin from "firebase-admin";

export const INVESTMENT_COLLECTIONS = {
  accounts: "investment_accounts",
  assets: "investment_assets",
  movements: "investment_movements",
  positions: "investment_positions",
  valuations: "investment_valuations",
  snapshots: "investment_snapshots",
  eventLogs: "investment_event_logs",
  idempotencyKeys: "investment_idempotency_keys",
  importBatches: "investment_import_batches",
  summaries: "investment_summaries",
  reportPeriods: "investment_report_periods",
  allocationSummaries: "investment_allocation_summaries",
  operationalMetrics: "investment_operational_metrics",
  /**
   * Registro de deriva detectada pela rotina agendada (INV-P2-019).
   */
  driftReports: "investment_drift_reports",
} as const;

export type InvestmentCollectionName =
  (typeof INVESTMENT_COLLECTIONS)[keyof typeof INVESTMENT_COLLECTIONS];

export const investmentFirestore = (): admin.firestore.Firestore =>
  admin.firestore();

export const investmentWorkspaceRef = (
  workspaceId: string,
): admin.firestore.DocumentReference =>
  investmentFirestore().doc(`workspaces/${workspaceId}`);

export const investmentCollection = (
  workspaceId: string,
  collectionName: InvestmentCollectionName,
): admin.firestore.CollectionReference =>
  investmentWorkspaceRef(workspaceId).collection(collectionName);

export const investmentDoc = (
  workspaceId: string,
  collectionName: InvestmentCollectionName,
  documentId: string,
): admin.firestore.DocumentReference =>
  investmentCollection(workspaceId, collectionName).doc(documentId);

export const investmentTransactionDoc = (
  workspaceId: string,
  transactionId: string,
): admin.firestore.DocumentReference =>
  investmentWorkspaceRef(workspaceId)
    .collection("transactions")
    .doc(transactionId);

export const investmentGoalDoc = (
  workspaceId: string,
  goalId: string,
): admin.firestore.DocumentReference =>
  investmentWorkspaceRef(workspaceId).collection("goals").doc(goalId);

export const investmentMemberDoc = (
  workspaceId: string,
  userId: string,
): admin.firestore.DocumentReference =>
  investmentWorkspaceRef(workspaceId).collection("members").doc(userId);
