import * as admin from "firebase-admin";
import {FieldPath, FieldValue, Timestamp} from "firebase-admin/firestore";

import type {WorkspaceAuthorizationContext} from "../creditCards/auth";
import {CreditCardApplicationError} from "../creditCards/errors";
import type {
  RecalculateGoalInvestmentProgressPayload,
  RecalculateInvestmentPositionPayload,
} from "./contracts";
import {INVESTMENT_CALCULATION_VERSION} from "./domain";
import {
  assertWorkspaceDocument,
  authorizeInvestmentTransaction,
  completeInvestmentIdempotency,
  deterministicDocumentId,
  investmentPositionId,
  recordInvestmentEvent,
  reserveInvestmentIdempotency,
} from "./infrastructure";
import {addExact, currentValueForPosition} from "./math";
import {integerOrZero, positionState, writePosition} from "./operationsV2";
import {
  writeInvestmentAllocationProjections,
  writeInvestmentValuationReportPeriod,
} from "./reporting";
import {
  INVESTMENT_COLLECTIONS,
  investmentCollection,
  investmentDoc,
  investmentFirestore,
  investmentGoalDoc,
} from "./paths";
import {recordInvestmentOperationMetric} from "./observability";
import {readInvestmentPeriodContext} from "./reporting";
import {investmentOperationRoles} from "./writeStrategy";

interface RebuildTotals {
  quantityMicros: number;
  principalCents: number;
  realizedGainCents: number;
  realizedLossCents: number;
  feesCents: number;
  taxCents: number;
  netContributionCents: number;
  currentValueCents: number;
}

const emptyTotals = (): RebuildTotals => ({
  quantityMicros: 0,
  principalCents: 0,
  realizedGainCents: 0,
  realizedLossCents: 0,
  feesCents: 0,
  taxCents: 0,
  netContributionCents: 0,
  currentValueCents: 0,
});

const totalsFromSnapshot = (value: unknown): RebuildTotals => {
  const data =
    typeof value === "object" && value ?
      (value as Record<string, unknown>) :
      {};
  return {
    quantityMicros: integerOrZero(data.quantityMicros),
    principalCents: integerOrZero(data.principalCents),
    realizedGainCents: integerOrZero(data.realizedGainCents),
    realizedLossCents: integerOrZero(data.realizedLossCents),
    feesCents: integerOrZero(data.feesCents),
    taxCents: integerOrZero(data.taxCents),
    netContributionCents: integerOrZero(data.netContributionCents),
    currentValueCents: integerOrZero(data.currentValueCents),
  };
};

const assertRebuildSnapshot = (
  snapshot: admin.firestore.DocumentSnapshot,
  kind: "position_rebuild" | "goal_rebuild",
  targetId: string,
  correlationId: string,
  actorId: string,
  pageSize: number,
): admin.firestore.DocumentData | undefined => {
  if (!snapshot.exists) return undefined;
  const data = snapshot.data() ?? {};
  if (
    data.kind !== kind ||
    data.targetId !== targetId ||
    data.correlationId !== correlationId ||
    data.createdBy !== actorId ||
    data.pageSize !== pageSize
  ) {
    throw new CreditCardApplicationError(
      "idempotency_conflict",
      "O identificador de reconstrução já está associado a outro contexto.",
    );
  }
  if (data.status === "completed") {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      "Esta reconstrução já foi concluída.",
    );
  }
  return data;
};

const assertNonNegativePositionTotals = (totals: RebuildTotals): void => {
  if (
    totals.quantityMicros < 0 ||
    totals.principalCents < 0 ||
    totals.realizedGainCents < 0 ||
    totals.realizedLossCents < 0 ||
    totals.feesCents < 0 ||
    totals.taxCents < 0
  ) {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      "O ledger contém uma sequência de movimentos inconsistente.",
    );
  }
  // INV-P1-009 — a mesma invariante do caminho incremental precisa valer na
  // reconstrução, senão o rebuild republicaria o principal fantasma.
  if (totals.quantityMicros === 0 && totals.principalCents !== 0) {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      "O ledger encerra a posição com custo remanescente. Reveja as " +
        "liquidações abaixo do custo antes de reconstruir.",
    );
  }
};

export const executeRecalculateInvestmentPosition = async (
  auth: WorkspaceAuthorizationContext,
  payload: RecalculateInvestmentPositionPayload,
): Promise<Record<string, unknown>> => {
  const operation = "recalculateInvestmentPosition" as const;
  const positionId = investmentPositionId(payload.accountId, payload.assetId);
  const rebuildId =
    payload.rebuildId ??
    deterministicDocumentId(
      "position-rebuild",
      auth.uid,
      positionId,
      payload.correlationId,
    );
  return investmentFirestore().runTransaction(async (transaction) => {
    const authorization = await authorizeInvestmentTransaction(
      transaction,
      auth,
      investmentOperationRoles(operation),
    );
    const reservation = await reserveInvestmentIdempotency(
      transaction,
      auth,
      operation,
      payload.idempotencyKey,
      payload.correlationId,
      payload,
    );
    if (reservation.replay) return reservation.replay;
    const refs = {
      position: investmentDoc(
        auth.workspaceId,
        INVESTMENT_COLLECTIONS.positions,
        positionId,
      ),
      account: investmentDoc(
        auth.workspaceId,
        INVESTMENT_COLLECTIONS.accounts,
        payload.accountId,
      ),
      asset: investmentDoc(
        auth.workspaceId,
        INVESTMENT_COLLECTIONS.assets,
        payload.assetId,
      ),
      snapshot: investmentDoc(
        auth.workspaceId,
        INVESTMENT_COLLECTIONS.snapshots,
        rebuildId,
      ),
    };
    const [positionSnapshot, accountSnapshot, assetSnapshot, rebuildSnapshot] =
      await Promise.all([
        transaction.get(refs.position),
        transaction.get(refs.account),
        transaction.get(refs.asset),
        transaction.get(refs.snapshot),
      ]);
    const account = assertWorkspaceDocument(
      accountSnapshot,
      auth.workspaceId,
      "Conta de investimento",
    );
    const asset = assertWorkspaceDocument(
      assetSnapshot,
      auth.workspaceId,
      "Ativo de investimento",
    );
    if (
      account.profileType !== authorization.profileType ||
      asset.profileType !== authorization.profileType
    ) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "Conta e ativo não pertencem ao contexto PF/PJ do workspace.",
      );
    }
    const existingRebuild = assertRebuildSnapshot(
      rebuildSnapshot,
      "position_rebuild",
      positionId,
      payload.correlationId,
      auth.uid,
      payload.pageSize,
    );
    const currentPosition = positionState(positionSnapshot);
    const cutoffAt =
      existingRebuild?.cutoffAt instanceof Timestamp ?
        existingRebuild.cutoffAt :
        Timestamp.now();
    const expectedVersion = existingRebuild ?
      integerOrZero(existingRebuild.expectedProjectionVersion) :
      currentPosition.version;
    if (currentPosition.version !== expectedVersion) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "A posição mudou durante a reconstrução; inicie uma nova reconstrução.",
      );
    }
    let query: admin.firestore.Query = investmentCollection(
      auth.workspaceId,
      INVESTMENT_COLLECTIONS.movements,
    )
      .where("accountId", "==", payload.accountId)
      .where("assetId", "==", payload.assetId)
      .where("status", "==", "settled")
      .where("occurredAt", "<=", cutoffAt)
      .orderBy("occurredAt", "asc")
      .orderBy(FieldPath.documentId(), "asc")
      .limit(payload.pageSize + 1);
    const cursor = existingRebuild?.cursor;
    if (
      cursor?.orderedAt instanceof Timestamp &&
      typeof cursor.documentId === "string"
    ) {
      query = query.startAfter(cursor.orderedAt, cursor.documentId);
    }
    const movementPage = await transaction.get(query);
    const pageDocuments = movementPage.docs.slice(0, payload.pageSize);
    const hasMore = movementPage.size > payload.pageSize;
    const totals = existingRebuild ?
      totalsFromSnapshot(existingRebuild.totals) :
      emptyTotals();
    let linkedGoalId =
      typeof existingRebuild?.linkedGoalId === "string" ?
        existingRebuild.linkedGoalId :
        undefined;
    for (const document of pageDocuments) {
      const movement = document.data();
      totals.quantityMicros = addExact(
        totals.quantityMicros,
        integerOrZero(movement.quantityDeltaMicros),
        "quantityMicros",
      );
      totals.principalCents = addExact(
        totals.principalCents,
        integerOrZero(movement.principalDeltaCents),
        "principalCents",
      );
      totals.realizedGainCents = addExact(
        totals.realizedGainCents,
        integerOrZero(movement.realizedGainDeltaCents),
        "realizedGainCents",
      );
      totals.realizedLossCents = addExact(
        totals.realizedLossCents,
        integerOrZero(movement.realizedLossDeltaCents),
        "realizedLossCents",
      );
      totals.feesCents = addExact(
        totals.feesCents,
        integerOrZero(movement.feesDeltaCents),
        "feesCents",
      );
      totals.taxCents = addExact(
        totals.taxCents,
        integerOrZero(movement.taxDeltaCents),
        "taxCents",
      );
      if (
        movement.operation === "contribution" &&
        linkedGoalId === undefined &&
        typeof movement.goalId === "string"
      ) {
        linkedGoalId = movement.goalId;
      }
      if (
        movement.operation === "goal_link" &&
        typeof movement.goalId === "string"
      ) {
        linkedGoalId = movement.goalId;
      }
      if (
        movement.operation === "goal_unlink" &&
        movement.goalId === linkedGoalId
      ) {
        linkedGoalId = undefined;
      }
    }
    assertNonNegativePositionTotals(totals);
    const lastDocument = pageDocuments[pageDocuments.length - 1];
    const nextCursor = lastDocument ?
      {
        orderedAt: lastDocument.get("occurredAt") as Timestamp,
        documentId: lastDocument.id,
      } :
      existingRebuild?.cursor;
    const processedCount =
      integerOrZero(existingRebuild?.processedCount) + pageDocuments.length;
    let valuationSnapshot: admin.firestore.QueryDocumentSnapshot | undefined;
    if (!hasMore) {
      // Filtra por conta **e** ativo: a valoração pertence à posição que a
      // recebeu. Buscando só por `assetId`, o mesmo ativo custodiado em duas
      // contas reconstruía as duas com o preço de uma delas, divergindo do
      // caminho incremental e acusando deriva inexistente no ledger.
      const valuationQuery = investmentCollection(
        auth.workspaceId,
        INVESTMENT_COLLECTIONS.valuations,
      )
        .where("accountId", "==", payload.accountId)
        .where("assetId", "==", payload.assetId)
        .where("effectiveAt", "<=", cutoffAt)
        .orderBy("effectiveAt", "desc")
        .orderBy(FieldPath.documentId(), "desc")
        .limit(1);
      valuationSnapshot = (await transaction.get(valuationQuery)).docs[0];
    }
    // Contexto do período lido ainda na fase de leitura da transação.
    const periodContext = hasMore ?
      undefined :
      await readInvestmentPeriodContext(
        transaction,
        auth.workspaceId,
        (valuationSnapshot?.data()?.effectiveAt as Timestamp | undefined) ??
          cutoffAt,
      );
    const valuation = valuationSnapshot?.data();
    const valuationUnitPriceMicros =
      valuation && Number.isSafeInteger(valuation.unitPriceMicros) ?
        (valuation.unitPriceMicros as number) :
        undefined;
    totals.currentValueCents = currentValueForPosition(
      totals.quantityMicros,
      totals.principalCents,
      valuationUnitPriceMicros,
    );
    if (!hasMore && currentPosition.goalId !== linkedGoalId) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "O vínculo da posição diverge do ledger; " +
          "reconcilie o vínculo antes de publicar o rebuild.",
      );
    }
    const goalSnapshot =
      !hasMore && linkedGoalId ?
        await transaction.get(
          investmentGoalDoc(auth.workspaceId, linkedGoalId),
        ) :
        undefined;
    if (goalSnapshot) {
      assertWorkspaceDocument(goalSnapshot, auth.workspaceId, "Meta");
    }
    const snapshotData = {
      id: rebuildId,
      workspaceId: auth.workspaceId,
      profileType: authorization.profileType,
      kind: "position_rebuild",
      targetId: positionId,
      status: hasMore ? "running" : "completed",
      cutoffAt,
      ...(nextCursor ? {cursor: nextCursor} : {}),
      processedCount,
      expectedProjectionVersion: expectedVersion,
      totals,
      ...(linkedGoalId ? {linkedGoalId} : {}),
      pageSize: payload.pageSize,
      calculationVersion: INVESTMENT_CALCULATION_VERSION,
      correlationId: payload.correlationId,
      createdBy: existingRebuild?.createdBy ?? auth.uid,
      createdAt: existingRebuild?.createdAt ?? FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      ...(!hasMore ? {completedAt: FieldValue.serverTimestamp()} : {}),
    };
    transaction.set(refs.snapshot, snapshotData, {merge: true});
    if (!hasMore) {
      const rebuiltState = {
        ...currentPosition,
        quantityMicros: totals.quantityMicros,
        principalCents: totals.principalCents,
        realizedGainCents: totals.realizedGainCents,
        realizedLossCents: totals.realizedLossCents,
        feesCents: totals.feesCents,
        taxCents: totals.taxCents,
        currentValueCents: totals.currentValueCents,
        goalId: linkedGoalId,
        version: currentPosition.version + 1,
        valuationId: valuationSnapshot?.id,
        valuationUnitPriceMicros,
        valuationEffectiveAt:
          valuation?.effectiveAt instanceof Timestamp ?
            valuation.effectiveAt :
            undefined,
      };
      writePosition(
        transaction,
        positionSnapshot,
        auth.workspaceId,
        authorization.profileType,
        payload.accountId,
        payload.assetId,
        rebuiltState,
        nextCursor?.documentId ?? currentPosition.valuationId ?? "rebuild",
        nextCursor?.orderedAt ?? cutoffAt,
        auth.uid,
      );
      writeInvestmentAllocationProjections(
        transaction,
        auth.workspaceId,
        authorization.profileType,
        auth.uid,
        accountSnapshot.data() ?? {},
        assetSnapshot.data() ?? {},
        currentPosition,
        rebuiltState,
        {
          previous: currentPosition.goalId === linkedGoalId ?
            goalSnapshot?.data()?.name as string | undefined : undefined,
          next: goalSnapshot?.data()?.name as string | undefined,
        },
      );
      if (periodContext) writeInvestmentValuationReportPeriod(
        transaction,
        auth.workspaceId,
        authorization.profileType,
        auth.uid,
        rebuiltState.valuationEffectiveAt ?? cutoffAt,
        rebuiltState.currentValueCents - currentPosition.currentValueCents,
        periodContext,
      );
      if (goalSnapshot) {
        const goal = goalSnapshot.data() ?? {};
        transaction.update(goalSnapshot.ref, {
          investmentProjectionDirty: true,
          investmentProjectionVersion:
            integerOrZero(goal.investmentProjectionVersion) + 1,
          investmentCalculationVersion: INVESTMENT_CALCULATION_VERSION,
          investmentUpdatedBy: auth.uid,
          investmentUpdatedAt: FieldValue.serverTimestamp(),
        });
      }
    }
    const result = {
      success: true,
      rebuildId,
      positionId,
      status: hasMore ? "running" : "completed",
      hasMore,
      processedCount,
      pageProcessedCount: pageDocuments.length,
      totals,
    };
    recordInvestmentOperationMetric(transaction, {
      workspaceId: auth.workspaceId,
      operation,
      actorId: auth.uid,
      correlationId: payload.correlationId,
      idempotencyKey: payload.idempotencyKey,
    });
    recordInvestmentEvent(
      transaction,
      auth,
      authorization.role,
      authorization.profileType,
      operation,
      reservation,
      payload.correlationId,
      "snapshot",
      rebuildId,
      {
        positionId,
        hasMore,
        processedCount,
        pageProcessedCount: pageDocuments.length,
      },
    );
    completeInvestmentIdempotency(
      transaction,
      auth,
      operation,
      payload.correlationId,
      reservation,
      result,
    );
    return result;
  });
};

export const executeRecalculateGoalInvestmentProgress = async (
  auth: WorkspaceAuthorizationContext,
  payload: RecalculateGoalInvestmentProgressPayload,
): Promise<Record<string, unknown>> => {
  const operation = "recalculateGoalInvestmentProgress" as const;
  const rebuildId =
    payload.rebuildId ??
    deterministicDocumentId(
      "goal-rebuild",
      auth.uid,
      payload.goalId,
      payload.correlationId,
    );
  return investmentFirestore().runTransaction(async (transaction) => {
    const authorization = await authorizeInvestmentTransaction(
      transaction,
      auth,
      investmentOperationRoles(operation),
    );
    const reservation = await reserveInvestmentIdempotency(
      transaction,
      auth,
      operation,
      payload.idempotencyKey,
      payload.correlationId,
      payload,
    );
    if (reservation.replay) return reservation.replay;
    const goalRef = investmentGoalDoc(auth.workspaceId, payload.goalId);
    const snapshotRef = investmentDoc(
      auth.workspaceId,
      INVESTMENT_COLLECTIONS.snapshots,
      rebuildId,
    );
    const [goalSnapshot, rebuildSnapshot] = await Promise.all([
      transaction.get(goalRef),
      transaction.get(snapshotRef),
    ]);
    const goal = assertWorkspaceDocument(
      goalSnapshot,
      auth.workspaceId,
      "Meta",
    );
    const existingRebuild = assertRebuildSnapshot(
      rebuildSnapshot,
      "goal_rebuild",
      payload.goalId,
      payload.correlationId,
      auth.uid,
      payload.pageSize,
    );
    const cutoffAt =
      existingRebuild?.cutoffAt instanceof Timestamp ?
        existingRebuild.cutoffAt :
        Timestamp.now();
    const currentVersion = integerOrZero(goal.investmentProjectionVersion);
    const expectedVersion = existingRebuild ?
      integerOrZero(existingRebuild.expectedProjectionVersion) :
      currentVersion;
    if (currentVersion !== expectedVersion) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "A projeção da meta mudou durante a reconstrução; " +
          "inicie uma nova reconstrução.",
      );
    }
    let query: admin.firestore.Query = investmentCollection(
      auth.workspaceId,
      INVESTMENT_COLLECTIONS.positions,
    )
      .where("goalId", "==", payload.goalId)
      .where("updatedAt", "<=", cutoffAt)
      .orderBy("updatedAt", "asc")
      .orderBy(FieldPath.documentId(), "asc")
      .limit(payload.pageSize + 1);
    const cursor = existingRebuild?.cursor;
    if (
      cursor?.orderedAt instanceof Timestamp &&
      typeof cursor.documentId === "string"
    ) {
      query = query.startAfter(cursor.orderedAt, cursor.documentId);
    }
    const positionPage = await transaction.get(query);
    const pageDocuments = positionPage.docs.slice(0, payload.pageSize);
    const hasMore = positionPage.size > payload.pageSize;
    const totals = existingRebuild ?
      totalsFromSnapshot(existingRebuild.totals) :
      emptyTotals();
    for (const document of pageDocuments) {
      totals.netContributionCents = addExact(
        totals.netContributionCents,
        integerOrZero(document.get("principalCents")),
        "netContributionCents",
      );
      totals.currentValueCents = addExact(
        totals.currentValueCents,
        integerOrZero(document.get("currentValueCents")),
        "currentValueCents",
      );
    }
    const lastDocument = pageDocuments[pageDocuments.length - 1];
    const nextCursor = lastDocument ?
      {
        orderedAt: lastDocument.get("updatedAt") as Timestamp,
        documentId: lastDocument.id,
      } :
      existingRebuild?.cursor;
    const processedCount =
      integerOrZero(existingRebuild?.processedCount) + pageDocuments.length;
    transaction.set(
      snapshotRef,
      {
        id: rebuildId,
        workspaceId: auth.workspaceId,
        profileType: authorization.profileType,
        kind: "goal_rebuild",
        targetId: payload.goalId,
        status: hasMore ? "running" : "completed",
        cutoffAt,
        ...(nextCursor ? {cursor: nextCursor} : {}),
        processedCount,
        expectedProjectionVersion: expectedVersion,
        totals,
        pageSize: payload.pageSize,
        calculationVersion: INVESTMENT_CALCULATION_VERSION,
        correlationId: payload.correlationId,
        createdBy: existingRebuild?.createdBy ?? auth.uid,
        createdAt: existingRebuild?.createdAt ?? FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        ...(!hasMore ? {completedAt: FieldValue.serverTimestamp()} : {}),
      },
      {merge: true},
    );
    if (!hasMore) {
      transaction.update(goalRef, {
        investmentNetContributionCents: totals.netContributionCents,
        investmentCurrentValueCents: totals.currentValueCents,
        investmentProgressCents:
          goal.progressBasis === "current_value" ?
            totals.currentValueCents :
            totals.netContributionCents,
        investmentProjectionVersion: currentVersion + 1,
        investmentCalculationVersion: INVESTMENT_CALCULATION_VERSION,
        investmentProjectionDirty: false,
        investmentUpdatedBy: auth.uid,
        investmentUpdatedAt: FieldValue.serverTimestamp(),
      });
    }
    const result = {
      success: true,
      rebuildId,
      goalId: payload.goalId,
      status: hasMore ? "running" : "completed",
      hasMore,
      processedCount,
      pageProcessedCount: pageDocuments.length,
      netContributionCents: totals.netContributionCents,
      currentValueCents: totals.currentValueCents,
    };
    recordInvestmentOperationMetric(transaction, {
      workspaceId: auth.workspaceId,
      operation,
      actorId: auth.uid,
      correlationId: payload.correlationId,
      idempotencyKey: payload.idempotencyKey,
    });
    recordInvestmentEvent(
      transaction,
      auth,
      authorization.role,
      authorization.profileType,
      operation,
      reservation,
      payload.correlationId,
      "snapshot",
      rebuildId,
      {
        goalId: payload.goalId,
        hasMore,
        processedCount,
        pageProcessedCount: pageDocuments.length,
      },
    );
    completeInvestmentIdempotency(
      transaction,
      auth,
      operation,
      payload.correlationId,
      reservation,
      result,
    );
    return result;
  });
};
