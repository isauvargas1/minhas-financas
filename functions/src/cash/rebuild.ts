import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";
import {onCall} from "firebase-functions/v2/https";
import {z} from "zod";

import {requireWorkspaceRole} from "../creditCards/auth";
import {CreditCardApplicationError} from "../creditCards/errors";
import {toHttpsError} from "../creditCards/errors";
import {consumeRateLimit} from "../shared/rateLimit";
import {HEAVY_CALLABLE_OPTIONS} from "../shared/runtimeOptions";
import {
  CASH_PERIODS_COLLECTION,
  cashPeriodDeltaFor,
  cashPeriodKeyFor,
  cashPeriodRef,
  type CashPeriodDelta,
} from "./periods";
import {saoPauloMonthStart} from "../shared/dateKeys";

/**
 * Reconstrução da projeção mensal de caixa (INV-P1-011).
 *
 * A projeção é mantida por delta pelo gatilho de transações, e todo acumulador
 * precisa de caminho de reconstrução — a alternativa é um número opaco que
 * ninguém consegue conferir. Esta rotina recalcula os períodos a partir do
 * próprio ledger de transações, publicando **valores absolutos**: reexecutar é
 * idempotente e não duplica.
 *
 * É também o caminho de backfill para workspaces cujo histórico é anterior à
 * projeção.
 *
 * Paginada e retomável por cursor, como as demais operações pesadas: um tenant
 * grande não cabe numa transação nem numa invocação.
 */

const payloadSchema = z.object({
  workspaceId: z.string().trim().min(1).max(128),
  idempotencyKey: z.string().trim().min(8).max(200),
  correlationId: z.string().trim().min(3).max(200),
  pageSize: z.number().int().min(1).max(500).default(300),
  reason: z.string().trim().min(3).max(500),
}).strict();

type Payload = z.infer<typeof payloadSchema>;

const REBUILD_STATE_ID = "cash_periods_rebuild";

const rebuildStateRef = (
  workspaceId: string,
): admin.firestore.DocumentReference =>
  admin.firestore().doc(
    `workspaces/${workspaceId}/${CASH_PERIODS_COLLECTION}/${REBUILD_STATE_ID}`,
  );

const RATE_LIMIT = {
  operation: "rebuildCashPeriods",
  limit: 100,
  windowSeconds: 60 * 60,
};

const emptyTotals = (): CashPeriodDelta => ({
  incomeCents: 0,
  expenseCents: 0,
  investmentOutflowCents: 0,
  netCents: 0,
  transactionCount: 0,
});

export const executeRebuildCashPeriods = async (
  workspaceId: string,
  actorId: string,
  payload: Payload,
): Promise<Record<string, unknown>> => {
  const db = admin.firestore();

  const state = (await rebuildStateRef(workspaceId).get()).data();
  const cursorId = typeof state?.cursor === "string" ? state.cursor : undefined;
  const accumulated = (state?.periods ?? {}) as Record<string, CashPeriodDelta>;
  const processed = Number.isSafeInteger(state?.processed) ?
    (state?.processed as number) :
    0;

  let query = db
    .collection(`workspaces/${workspaceId}/transactions`)
    .orderBy(admin.firestore.FieldPath.documentId())
    .limit(payload.pageSize);
  if (cursorId) query = query.startAfter(cursorId);

  const page = await query.get();
  for (const entry of page.docs) {
    const data = entry.data();
    const period = cashPeriodKeyFor(data);
    if (!period) continue;
    const delta = cashPeriodDeltaFor(data);
    const bucket = accumulated[period] ?? emptyTotals();
    bucket.incomeCents += delta.incomeCents;
    bucket.expenseCents += delta.expenseCents;
    bucket.investmentOutflowCents += delta.investmentOutflowCents;
    bucket.netCents += delta.netCents;
    bucket.transactionCount += delta.transactionCount;
    accumulated[period] = bucket;
  }

  // Teto explícito: a acumulação vive num documento, que tem limite de 1 MiB.
  // Um workspace com mais de 600 meses de histórico é impossível na prática;
  // atingir o teto é erro nomeado, nunca truncamento silencioso.
  if (Object.keys(accumulated).length > 600) {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      "A reconstrução do fluxo de caixa excedeu 600 períodos mensais. " +
        "Nenhum dado foi truncado.",
    );
  }

  const completed = page.size < payload.pageSize;
  const lastId = page.docs[page.docs.length - 1]?.id;

  if (!completed) {
    await rebuildStateRef(workspaceId).set({
      id: REBUILD_STATE_ID,
      workspaceId,
      kind: "cash_periods_rebuild",
      status: "running",
      cursor: lastId ?? cursorId ?? null,
      processed: processed + page.size,
      periods: accumulated,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actorId,
    }, {merge: false});
    return {
      success: true,
      completed: false,
      processed: processed + page.size,
      periods: Object.keys(accumulated).length,
    };
  }

  // Última página: publica valores absolutos e zera períodos órfãos — meses
  // que existiam por uma execução anterior e não têm mais lastro no ledger.
  const existing = await db
    .collection(`workspaces/${workspaceId}/${CASH_PERIODS_COLLECTION}`)
    .get();
  const batch = db.batch();
  for (const [period, totals] of Object.entries(accumulated)) {
    batch.set(cashPeriodRef(workspaceId, period), {
      id: period,
      workspaceId,
      period,
      periodStart: Timestamp.fromDate(saoPauloMonthStart(period)),
      ...totals,
      rebuiltAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actorId,
    });
  }
  for (const entry of existing.docs) {
    if (entry.id === REBUILD_STATE_ID) continue;
    if (accumulated[entry.id]) continue;
    batch.set(entry.ref, {
      ...emptyTotals(),
      rebuiltAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actorId,
    }, {merge: true});
  }
  batch.delete(rebuildStateRef(workspaceId));
  await batch.commit();

  return {
    success: true,
    completed: true,
    processed: processed + page.size,
    periods: Object.keys(accumulated).length,
  };
};

export const rebuildCashPeriods = onCall(
  HEAVY_CALLABLE_OPTIONS,
  async (request) => {
    try {
      const payload = payloadSchema.parse(request.data);
      const auth = await requireWorkspaceRole(request, payload.workspaceId, [
        "owner",
        "admin",
      ]);
      await admin.firestore().runTransaction(async (transaction) => {
        const reservation = await consumeRateLimit(
          transaction,
          auth.workspaceId,
          auth.uid,
          RATE_LIMIT,
        );
        reservation.commit();
      });
      return await executeRebuildCashPeriods(
        auth.workspaceId,
        auth.uid,
        payload,
      );
    } catch (error) {
      throw toHttpsError(error);
    }
  },
);
