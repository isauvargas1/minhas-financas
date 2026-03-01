import {onSchedule} from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";

const db = admin.firestore();

// Executa todos os dias às 02:00 da manhã (fuso horário padrão)
export const processRecurring = onSchedule("every day 02:00", async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Procura em todos os workspaces por despesas recorrentes ativas
  const expensesRef = db.collectionGroup("recurring_expenses");
  const activeSnap = await expensesRef.where("status", "==", "active").get();

  if (activeSnap.empty) {
    console.log("Nenhuma despesa recorrente ativa encontrada.");
    return;
  }

  const batch = db.batch();
  let count = 0;

  activeSnap.docs.forEach((docSnap) => {
    const data = docSnap.data();
    // Usa a data do próximo vencimento ou a data de início
    const nextStr = data.nextDueDate || data.startDate;
    if (!nextStr) return;

    const nextDate = new Date(nextStr);
    nextDate.setHours(0, 0, 0, 0);

    // Se a data de vencimento for hoje ou já tiver passado
    if (nextDate.getTime() <= today.getTime()) {
      const workspaceRef = docSnap.ref.parent.parent;
      if (!workspaceRef) return;

      // 1. Cria a transação real na coleção de transactions do workspace
      const txRef = workspaceRef.collection("transactions").doc();
      batch.set(txRef, {
        id: txRef.id,
        type: "despesa",
        description: data.description || "Despesa Recorrente",
        category: data.category || "Outros",
        value: data.value || 0,
        date: nextDate.toISOString(),
        isPaid: false,
        recurringId: docSnap.id,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // 2. Calcula a próxima data (Adiciona 1 mês)
      const newNext = new Date(nextDate);
      newNext.setMonth(newNext.getMonth() + 1);

      // 3. Atualiza a assinatura com a próxima data de cobrança
      batch.update(docSnap.ref, {
        nextDueDate: newNext.toISOString(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      count++;
    }
  });

  if (count > 0) {
    await batch.commit();
    console.log(`Geradas ${count} novas transacoes recorrentes.`);
  } else {
    console.log("Nenhuma transacao precisou ser gerada hoje.");
  }
});
