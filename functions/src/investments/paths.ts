import * as firebaseAdminFirestore from "firebase-admin/firestore";

export const INVESTMENT_COLLECTIONS = {
  accounts: "investment_accounts",
  assets: "investment_assets",
  movements: "investment_movements",
  positions: "investment_positions",
  eventLogs: "investment_event_logs",
  idempotencyKeys: "investment_idempotency_keys",
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

export const investmentFirestore = (): firebaseAdminFirestore.Firestore =>
  firebaseAdminFirestore.getFirestore();

export const investmentWorkspaceRef = (
  workspaceId: string,
): firebaseAdminFirestore.DocumentReference =>
  investmentFirestore().doc(`workspaces/${workspaceId}`);

export const investmentCollection = (
  workspaceId: string,
  collectionName: InvestmentCollectionName,
): firebaseAdminFirestore.CollectionReference =>
  investmentWorkspaceRef(workspaceId).collection(collectionName);

export const investmentDoc = (
  workspaceId: string,
  collectionName: InvestmentCollectionName,
  documentId: string,
): firebaseAdminFirestore.DocumentReference =>
  investmentCollection(workspaceId, collectionName).doc(documentId);

export const investmentTransactionDoc = (
  workspaceId: string,
  transactionId: string,
): firebaseAdminFirestore.DocumentReference =>
  investmentWorkspaceRef(workspaceId)
    .collection("transactions")
    .doc(transactionId);

export const investmentGoalDoc = (
  workspaceId: string,
  goalId: string,
): firebaseAdminFirestore.DocumentReference =>
  investmentWorkspaceRef(workspaceId).collection("goals").doc(goalId);
