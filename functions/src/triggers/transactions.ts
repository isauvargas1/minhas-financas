import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";
import {onDocumentWritten} from "firebase-functions/v2/firestore";

import {
  applyCashPeriodWriteOnce,
  cashPeriodEventKey,
} from "../cash/periods";

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

export const onTransactionWrite = onDocumentWritten(
  "workspaces/{workspaceId}/transactions/{transactionId}",
  async (event) => {
    if (!event.data) return;
    const {workspaceId, transactionId} = event.params;
    const beforeData = event.data.before.data();
    const afterData = event.data.after.data();

    /*
     * O progresso patrimonial da meta não é mais recomposto aqui.
     *
     * `goals` só recebe `goalId` numa transação pelo espelho de caixa que o
     * domínio patrimonial grava (`operationsV2.writeCashProjection`), e o
     * progresso correspondente já foi aplicado na mesma transação do ledger
     * por `updateGoalProjection`, a partir das posições. Recompor aqui, a
     * partir de `transactions`, seria uma segunda fonte para a mesma grandeza.
     * A reconciliação é `recalculateGoalInvestmentProgress`.
     */

    const action = !event.data.before.exists ? "CREATE" :
      !event.data.after.exists ? "DELETE" : "UPDATE";
    const description = afterData?.description ?? beforeData?.description ?? "Transação";
    const eventKey = cashPeriodEventKey(event.id);

    // INV-P1-011 — projeção mensal de caixa mantida por delta.
    //
    // É o que permite ao produto parar de varrer a subcoleção inteira de
    // transações para responder "qual é o saldo acumulado": o agregado global
    // passa a ser a soma de um punhado de documentos mensais.
    //
    // INV-P3-001 — a entrega é **pelo menos** uma vez. Um delta é somado; um
    // delta somado duas vezes é saldo errado. `applyCashPeriodWriteOnce`
    // registra a entrega na mesma transação em que a aplica, então a reentrega
    // do mesmo `event.id` não soma nada. `rebuildCashPeriods` continua sendo a
    // reconciliação — não é mais o que segura a duplicação.
    await db().runTransaction(async (transaction) => {
      await applyCashPeriodWriteOnce(
        transaction,
        workspaceId,
        eventKey,
        beforeData,
        afterData,
        {transactionId, action},
      );
    });

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
