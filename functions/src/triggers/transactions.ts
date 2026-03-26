import {onDocumentWritten} from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";

const db = admin.firestore();

const getSignedBalanceValue = (data?: admin.firestore.DocumentData) => {
  if (!data) return 0;
  const numericValue = Number(data.value || 0);

  if (data.type === "despesa" || data.type === "parcelado") {
    return -numericValue;
  }

  return numericValue;
};

const getGoalContribution = (data?: admin.firestore.DocumentData) => {
  if (!data || data.type !== "investimento" || !data.goalId) {
    return null;
  }

  return {
    goalId: String(data.goalId),
    value: Number(data.value || 0),
  };
};

export const onTransactionWrite = onDocumentWritten(
  "workspaces/{workspaceId}/transactions/{transactionId}",
  async (event) => {
    const workspaceId = event.params.workspaceId;
    const transactionId = event.params.transactionId;

    if (!event.data) return;

    const beforeData = event.data.before.data();
    const afterData = event.data.after.data();

    const batch = db.batch();
    const logsRef = db.collection(`workspaces/${workspaceId}/activity_logs`);

    let action: "CREATE" | "UPDATE" | "DELETE" = "UPDATE";
    let logMessage = "";

    if (!event.data.before.exists && afterData) {
      action = "CREATE";
      logMessage = `Transação "${afterData.description}" criada.`;
    } else if (!event.data.after.exists && beforeData) {
      action = "DELETE";
      logMessage = `Transação "${beforeData.description}" excluída.`;
    } else if (beforeData && afterData) {
      action = "UPDATE";
      logMessage = `Transação "${afterData.description}" atualizada.`;
    }

    const userId = afterData?.userId || beforeData?.userId || "sistema";
    const logDoc = logsRef.doc();

    batch.set(logDoc, {
      id: logDoc.id,
      entity: "transaction",
      entityId: transactionId,
      action,
      userId,
      description: logMessage,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      details: {
        before: beforeData || null,
        after: afterData || null,
        balanceBefore: getSignedBalanceValue(beforeData),
        balanceAfter: getSignedBalanceValue(afterData),
      },
    });

    const goalAdjustments = new Map<string, number>();
    const beforeGoal = getGoalContribution(beforeData);
    const afterGoal = getGoalContribution(afterData);

    if (beforeGoal) {
      goalAdjustments.set(
        beforeGoal.goalId,
        (goalAdjustments.get(beforeGoal.goalId) ?? 0) - beforeGoal.value,
      );
    }

    if (afterGoal) {
      goalAdjustments.set(
        afterGoal.goalId,
        (goalAdjustments.get(afterGoal.goalId) ?? 0) + afterGoal.value,
      );
    }

    for (const [goalId, diff] of goalAdjustments.entries()) {
      if (diff === 0) continue;

      const goalRef = db.doc(`workspaces/${workspaceId}/goals/${goalId}`);
      const goalSnap = await goalRef.get();

      if (!goalSnap.exists) {
        continue;
      }

      batch.update(goalRef, {
        currentAmount: admin.firestore.FieldValue.increment(diff),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    await batch.commit();
    console.log(`[${action}] Workspace ${workspaceId} atualizado.`);
  },
);
