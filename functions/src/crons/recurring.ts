import {onSchedule} from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";

const db = admin.firestore();

/** Assinaturas lidas por página; mantém a leitura por execução limitada. */
const RECURRING_PAGE_SIZE = 200;
/** Teto de páginas por execução, para o job não crescer sem limite. */
const RECURRING_MAX_PAGES = 50;
/** Escritas por commit. Cada item gera 2 escritas; o limite do lote é 500. */
const RECURRING_BATCH_LIMIT = 400;

/**
 * Checkpoint da varredura, fora de qualquer workspace.
 *
 * O teto por execução (`MAX_PAGES × PAGE_SIZE`) protege a instância, mas sem
 * retomada ele vira omissão permanente: a consulta é sempre a mesma, ordenada
 * por ID, e a assinatura processada continua `active`; logo, tudo além do teto
 * jamais seria alcançado em execução nenhuma. O cursor persistido faz a
 * execução seguinte continuar de onde a anterior parou.
 */
const RECURRING_CHECKPOINT = "job_checkpoints/recurring_expenses";

/**
 * Gera as despesas recorrentes vencidas.
 *
 * A versão anterior lia, numa única consulta sem `limit`, todas as assinaturas
 * ativas de todos os workspaces, e acumulava todas as escritas num único lote —
 * que estoura em silêncio no limite de 500 do Firestore, ou seja, a partir de
 * 250 assinaturas vencidas no mesmo dia. Agora a varredura é paginada por
 * cursor, com teto por execução, commits fatiados e retomada entre execuções.
 */
export const processRecurring = onSchedule("every day 02:00", async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const checkpointRef = db.doc(RECURRING_CHECKPOINT);
  const checkpoint = await checkpointRef.get();
  const resumePath = typeof checkpoint.data()?.cursorPath === "string" ?
    (checkpoint.data()?.cursorPath as string) :
    undefined;

  // Consulta de grupo de coleção ordena por caminho completo, então o cursor
  // retomado precisa ser uma referência de documento, não um ID curto.
  let cursorPath: string | undefined = resumePath;
  let generated = 0;
  let scanned = 0;
  let exhausted = false;
  let batch = db.batch();
  let batchWrites = 0;

  const flush = async (): Promise<void> => {
    if (batchWrites === 0) return;
    await batch.commit();
    batch = db.batch();
    batchWrites = 0;
  };

  for (let page = 0; page < RECURRING_MAX_PAGES; page += 1) {
    let query = db
      .collectionGroup("recurring_expenses")
      .where("status", "==", "active")
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(RECURRING_PAGE_SIZE);
    if (cursorPath) query = query.startAfter(db.doc(cursorPath));

    const activeSnap = await query.get();
    if (activeSnap.empty) {
      exhausted = true;
      break;
    }
    cursorPath = activeSnap.docs[activeSnap.docs.length - 1].ref.path;
    scanned += activeSnap.size;

    for (const docSnap of activeSnap.docs) {
      const data = docSnap.data();
      // Usa a data do próximo vencimento ou a data de início.
      const nextStr = data.nextDueDate || data.startDate;
      if (!nextStr) continue;

      const nextDate = new Date(nextStr);
      nextDate.setHours(0, 0, 0, 0);
      if (nextDate.getTime() > today.getTime()) continue;

      const workspaceRef = docSnap.ref.parent.parent;
      if (!workspaceRef) continue;

      // 1. Cria a transação real na coleção de transactions do workspace.
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

      // 2. Avança a assinatura para o próximo mês.
      const newNext = new Date(nextDate);
      newNext.setMonth(newNext.getMonth() + 1);
      batch.update(docSnap.ref, {
        nextDueDate: newNext.toISOString(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      batchWrites += 2;
      generated += 1;
      if (batchWrites >= RECURRING_BATCH_LIMIT) await flush();
    }

    if (activeSnap.size < RECURRING_PAGE_SIZE) {
      exhausted = true;
      break;
    }
  }

  await flush();

  // Varredura completa reinicia do começo na próxima execução; interrompida
  // pelo teto, guarda onde parou. Sem isso, o corte seria silencioso.
  await checkpointRef.set(
    {
      job: "recurring_expenses",
      cursorPath: exhausted || !cursorPath ?
        admin.firestore.FieldValue.delete() :
        cursorPath,
      lastRunGenerated: generated,
      lastRunScanned: scanned,
      lastRunTruncated: !exhausted,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    {merge: true},
  );

  // Log operacional sanitizado: apenas contagens, nunca valor, descrição
  // ou identificador de pessoa.
  console.log("recurring_processed", {
    generated,
    scanned,
    resumed: Boolean(resumePath),
    truncated: !exhausted,
  });
});
