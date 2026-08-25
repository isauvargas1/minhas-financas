import {createHash} from "node:crypto";
import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";
import {onDocumentWritten} from "firebase-functions/v2/firestore";

import {
  contributionMinorUnits,
} from "../goals/operations";
import {applyCashPeriodWrite} from "../cash/periods";

const db = () => admin.firestore();

/**
 * Retenção da trilha de atividade (INV-P2-041).
 *
 * `activity_logs` cresce a cada escrita e nunca era purgado. Um ano cobre
 * qualquer investigação operacional realista; o fato financeiro em si vive na
 * transação, que é preservada para sempre.
 */
const ACTIVITY_LOG_RETENTION_DAYS = 365;

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

/**
 * Teto de aportes somados numa recomposição de meta (INV-P2-030).
 *
 * A consulta rodava **sem `limit` e sem `orderBy`** dentro de uma transação,
 * a cada escrita de transação vinculada a meta: custo O(histórico da meta) por
 * escrita, e o espelho do domínio de investimentos engorda a mesma coleção.
 * Espelha o teto que `goals/operations.ts` já aplicava no caminho de callable.
 * Ultrapassá-lo falha explicitamente em vez de somar um subconjunto.
 */
const GOAL_PROGRESS_SCAN_LIMIT = 2_000;

/**
 * Efeito desta escrita sobre o progresso de **uma** meta (NEW-06).
 *
 * A transação pode ter entrado na meta, saído dela, ou mudado de valor dentro
 * dela: os três casos são a diferença entre o que o documento valia antes e o
 * que vale agora, para aquela meta.
 */
const goalContributionDelta = (
  goalId: string,
  before: admin.firestore.DocumentData | undefined,
  after: admin.firestore.DocumentData | undefined,
): number => {
  const previous = linkedGoalId(before) === goalId && before ?
    contributionMinorUnits(before) : 0;
  const current = linkedGoalId(after) === goalId && after ?
    contributionMinorUnits(after) : 0;
  return current - previous;
};

const rebuildGoalProgress = async (
  workspaceId: string,
  goalId: string,
  deltaCents: number,
) => {
  const goalDocument = db().doc(`workspaces/${workspaceId}/goals/${goalId}`);
  const contributionsQuery = db()
    .collection(`workspaces/${workspaceId}/transactions`)
    .where("goalId", "==", goalId)
    .orderBy("__name__", "asc")
    .limit(GOAL_PROGRESS_SCAN_LIMIT + 1);

  await db().runTransaction(async (transaction) => {
    const [goalSnapshot, contributions] = await Promise.all([
      transaction.get(goalDocument),
      transaction.get(contributionsQuery),
    ]);
    if (!goalSnapshot.exists) return;
    if (contributions.size > GOAL_PROGRESS_SCAN_LIMIT) {
      /*
       * Acima do teto de varredura, o progresso passa a ser mantido por
       * **delta** — exatamente como a projeção mensal de caixa neste mesmo
       * gatilho (NEW-06).
       *
       * Lançar aqui, como antes, deixava a meta permanentemente congelada: a
       * escrita da transação já aconteceu, o gatilho não repete por padrão, e
       * a rotina de reconstrução citada no erro tinha o mesmo teto. O delta é
       * exato — a diferença sai do próprio par antes/depois — e
       * `rebuildGoalProgress` (paginado) é o caminho de reconciliação.
       */
      const goal = goalSnapshot.data() ?? {};
      if (deltaCents === 0) return;
      const previousNet = Number.isSafeInteger(goal.netContributionCents) ?
        goal.netContributionCents as number : 0;
      const netContributionCents = previousNet + deltaCents;
      const progressCents = (goal.progressBasis ?? "net_contributions") === "current_value" ?
        (Number.isSafeInteger(goal.currentValueCents) ?
          goal.currentValueCents as number :
          Math.round(Number(goal.currentValue ?? 0) * 100)) :
        netContributionCents;
      transaction.update(goalDocument, {
        progressBasis: goal.progressBasis ?? "net_contributions",
        netContributionCents,
        currentAmountCents: progressCents,
        currentAmount: progressCents / 100,
        lastProgressDeltaAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return;
    }
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
        await rebuildGoalProgress(
          workspaceId,
          goalId,
          goalContributionDelta(goalId, beforeData, afterData),
        );
      }
    }

    // INV-P1-011 — projeção mensal de caixa mantida por delta.
    //
    // É o que permite ao produto parar de varrer a subcoleção inteira de
    // transações para responder "qual é o saldo acumulado": o agregado global
    // passa a ser a soma de um punhado de documentos mensais.
    await db().runTransaction(async (transaction) => {
      applyCashPeriodWrite(transaction, workspaceId, beforeData, afterData);
    });

    const action = !event.data.before.exists ? "CREATE" :
      !event.data.after.exists ? "DELETE" : "UPDATE";
    const description = afterData?.description ?? beforeData?.description ?? "Transação";
    const eventKey = createHash("sha256").update(event.id).digest("hex").slice(0, 40);
    /*
     * Trilha de atividade enxuta.
     *
     * A versão anterior gravava `before` e `after` **completos** de toda
     * transação: uma segunda cópia integral do conteúdo financeiro numa
     * coleção legível por qualquer membro do workspace — custo de escrita
     * dobrado e exposição desnecessária de dados que já vivem no documento de
     * origem, que não é apagado (INV-P2-032).
     *
     * O que a trilha precisa responder é quem mudou o quê e qual foi o efeito
     * em caixa. Os campos alterados ficam nomeados; os valores ficam no
     * documento de origem, referenciado por `entityId`.
     */
    const changedFields = Array.from(new Set([
      ...Object.keys(beforeData ?? {}),
      ...Object.keys(afterData ?? {}),
    ])).filter((field) => {
      const before = JSON.stringify((beforeData ?? {})[field] ?? null);
      const after = JSON.stringify((afterData ?? {})[field] ?? null);
      return before !== after;
    }).slice(0, 40);

    await db().doc(`workspaces/${workspaceId}/activity_logs/transaction_${eventKey}`).set({
      eventId: event.id,
      entity: "transaction",
      entityId: transactionId,
      action,
      userId: afterData?.userId || beforeData?.userId || "sistema",
      description: `Transação "${description}" ${action === "CREATE" ? "criada" : action === "DELETE" ? "excluída" : "atualizada"}.`,
      timestamp: FieldValue.serverTimestamp(),
      // Retenção: `expiresAt` é o campo que a política de TTL do projeto usa.
      // Trilha operacional não é fato financeiro; o fato permanece na própria
      // transação, que nunca é apagada.
      expiresAt: Timestamp.fromMillis(
        Date.now() + ACTIVITY_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000,
      ),
      details: {
        changedFields,
        type: afterData?.type ?? beforeData?.type ?? null,
        balanceBefore: getSignedBalanceValue(beforeData),
        balanceAfter: getSignedBalanceValue(afterData),
      },
    }, {merge: false});
  },
);
