import {onDocumentWritten} from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";

const db = admin.firestore();

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
    let valueDiff = 0;

    if (!event.data.before.exists && afterData) {
      action = "CREATE";
      logMessage = `Transação "${afterData.description}" criada.`;
      valueDiff = afterData.type === "despesa" ?
        -afterData.value : afterData.value;
    } else if (!event.data.after.exists && beforeData) {
      action = "DELETE";
      logMessage = `Transação "${beforeData.description}" excluída.`;
      valueDiff = beforeData.type === "despesa" ?
        beforeData.value : -beforeData.value;
    } else if (beforeData && afterData) {
      action = "UPDATE";
      logMessage = `Transação "${afterData.description}" atualizada.`;
      const beforeVal = beforeData.type === "despesa" ?
        -beforeData.value : beforeData.value;
      const afterVal = afterData.type === "despesa" ?
        -afterData.value : afterData.value;
      valueDiff = afterVal - beforeVal;
    }

    const userId = afterData?.userId || beforeData?.userId || "sistema";
    const logDoc = logsRef.doc();

    batch.set(logDoc, {
      id: logDoc.id,
      entity: "transaction",
      entityId: transactionId,
      action: action,
      userId: userId,
      description: logMessage,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      details: {
        before: beforeData || null,
        after: afterData || null,
      },
    });

    const goalId = afterData?.goalId || beforeData?.goalId;
    if (goalId) {
      const goalRef = db.doc(`workspaces/${workspaceId}/goals/${goalId}`);
      if (valueDiff !== 0) {
        batch.update(goalRef, {
          currentAmount: admin.firestore.FieldValue.increment(valueDiff),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    }

    await batch.commit();
    console.log(`[${action}] Workspace ${workspaceId} atualizado.`);
  }
);
