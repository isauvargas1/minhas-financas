import {createHash} from "node:crypto";
import * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";
import {onDocumentWritten} from "firebase-functions/v2/firestore";

import {
  contributionMinorUnits,
} from "../goals/operations";

const db = () => admin.firestore();

const getSignedBalanceValue = (data?: admin.firestore.DocumentData) => {
  if (!data) return 0;
  const numericValue = Number(data.value || 0);
  if (data.type === "despesa" || data.type === "parcelado") return -numericValue;
  if (data.type === "investimento") {
    const metadata = data.investmentMetadata;
    if (metadata && metadata.status !== "settled" && metadata.status !== "reversed") return 0;
    if (metadata?.cashImpact === "inflow") return numericValue;
    if (metadata?.cashImpact === "none") return 0;
    return -numericValue;
  }
  return numericValue;
};

const linkedGoalId = (data?: admin.firestore.DocumentData): string | null => {
  if (!data || data.type !== "investimento" || typeof data.goalId !== "string") return null;
  return data.goalId;
};

const rebuildGoalProgress = async (workspaceId: string, goalId: string) => {
  const goalDocument = db().doc(`workspaces/${workspaceId}/goals/${goalId}`);
  const contributionsQuery = db()
    .collection(`workspaces/${workspaceId}/transactions`)
    .where("goalId", "==", goalId);

  await db().runTransaction(async (transaction) => {
    const [goalSnapshot, contributions] = await Promise.all([
      transaction.get(goalDocument),
      transaction.get(contributionsQuery),
    ]);
    if (!goalSnapshot.exists) return;
    const goal = goalSnapshot.data() ?? {};
    const netContributionCents = contributions.docs.reduce(
      (total, contribution) => total + contributionMinorUnits(contribution.data()),
      0,
    );
    const currentValueCents = Number.isSafeInteger(goal.currentValueCents) ?
      goal.currentValueCents as number :
      Math.round(Number(goal.currentValue ?? 0) * 100);
    const progressCents = (goal.progressBasis ?? "net_contributions") === "current_value" ?
      currentValueCents : netContributionCents;
    transaction.update(goalDocument, {
      progressBasis: goal.progressBasis ?? "net_contributions",
      netContributionCents,
      currentAmountCents: progressCents,
      currentAmount: progressCents / 100,
      lastProgressRebuildAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
};

export const onTransactionWrite = onDocumentWritten(
  "workspaces/{workspaceId}/transactions/{transactionId}",
  async (event) => {
    if (!event.data) return;
    const {workspaceId, transactionId} = event.params;
    const beforeData = event.data.before.data();
    const afterData = event.data.after.data();
    const projectionAlreadyApplied = Boolean(
      beforeData?.investmentMetadata || afterData?.investmentMetadata,
    );
    const affectedGoalIds = new Set<string>();
    const beforeGoalId = linkedGoalId(beforeData);
    const afterGoalId = linkedGoalId(afterData);
    if (beforeGoalId) affectedGoalIds.add(beforeGoalId);
    if (afterGoalId) affectedGoalIds.add(afterGoalId);

    if (!projectionAlreadyApplied) {
      for (const goalId of affectedGoalIds) {
        await rebuildGoalProgress(workspaceId, goalId);
      }
    }

    const action = !event.data.before.exists ? "CREATE" :
      !event.data.after.exists ? "DELETE" : "UPDATE";
    const description = afterData?.description ?? beforeData?.description ?? "Transação";
    const eventKey = createHash("sha256").update(event.id).digest("hex").slice(0, 40);
    await db().doc(`workspaces/${workspaceId}/activity_logs/transaction_${eventKey}`).set({
      eventId: event.id,
      entity: "transaction",
      entityId: transactionId,
      action,
      userId: afterData?.userId || beforeData?.userId || "sistema",
      description: `Transação "${description}" ${action === "CREATE" ? "criada" : action === "DELETE" ? "excluída" : "atualizada"}.`,
      timestamp: FieldValue.serverTimestamp(),
      details: {
        before: beforeData || null,
        after: afterData || null,
        balanceBefore: getSignedBalanceValue(beforeData),
        balanceAfter: getSignedBalanceValue(afterData),
      },
    }, {merge: false});
  },
);
