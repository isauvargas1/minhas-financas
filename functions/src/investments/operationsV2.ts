import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";

import type {WorkspaceAuthorizationContext} from "../creditCards/auth";
import {CreditCardApplicationError} from "../creditCards/errors";
import type {
  ArchiveInvestmentAccountPayload,
  ArchiveInvestmentAssetPayload,
  CancelInvestmentMovementPayload,
  CreateInvestmentContributionPayload,
  CreateInvestmentRedemptionV2Payload,
  RecordInvestmentValuationPayload,
  RegisterInvestmentImportBatchPayload,
  ChangeInvestmentGoalPayload,
  LinkInvestmentToGoalPayload,
  ReverseInvestmentMovementPayload,
  SaveInvestmentAccountPayload,
  SaveInvestmentAssetPayload,
  SettleInvestmentRedemptionPayload,
  UnlinkInvestmentFromGoalPayload,
} from "./contracts";
import {
  INVESTMENT_CALCULATION_VERSION,
  INVESTMENT_DOMAIN_VERSION,
} from "./domain";
import {saoPauloDayKey} from "../shared/dateKeys";
import {assertInvestmentDocument} from "./documentContracts";
import {recordInvestmentOperationMetric} from "./observability";
import {investmentOperationRoles} from "./writeStrategy";
import {
  assertNotBefore,
  assertNotFuture,
  assertWorkspaceDocument,
  authorizeInvestmentTransaction,
  completeInvestmentIdempotency,
  deterministicDocumentId,
  investmentPositionId,
  parseTimestamp,
  recordInvestmentEvent,
  reserveInvestmentIdempotency,
  sha256,
} from "./infrastructure";
import {
  addExact,
  currentValueForPosition,
  negateExact,
  positionValueCents,
} from "./math";
import {
  readInvestmentPeriodContext,
  writeInvestmentAllocationProjections,
  writeInvestmentReportPeriod,
  writeInvestmentValuationReportPeriod,
} from "./reporting";
import {
  INVESTMENT_COLLECTIONS,
  investmentCollection,
  investmentDoc,
  investmentFirestore,
  investmentGoalDoc,
  investmentTransactionDoc,
} from "./paths";

export interface PositionState {
  quantityMicros: number;
  principalCents: number;
  realizedGainCents: number;
  /**
   * Perda realizada acumulada (INV-P1-009). Não-negativa, como o ganho: o
   * resultado com sinal é derivado (`realizedGain − realizedLoss`).
   */
  realizedLossCents: number;
  feesCents: number;
  taxCents: number;
  currentValueCents: number;
  goalId?: string;
  version: number;
  valuationId?: string;
  valuationUnitPriceMicros?: number;
  valuationEffectiveAt?: Timestamp;
}

interface PositionDeltas {
  quantityMicros: number;
  principalCents: number;
  realizedGainCents: number;
  realizedLossCents?: number;
  feesCents: number;
  taxCents: number;
}

const emptyPosition = (): PositionState => ({
  quantityMicros: 0,
  principalCents: 0,
  realizedGainCents: 0,
  realizedLossCents: 0,
  feesCents: 0,
  taxCents: 0,
  currentValueCents: 0,
  version: 0,
});

export const integerOrZero = (value: unknown): number =>
  Number.isSafeInteger(value) ? (value as number) : 0;

/**
 * Posição **exposta**: tem quantidade, custo ou valor.
 *
 * É a definição que `projectionRebuild.accumulatePosition` usa para contar, e
 * por isso precisa ser a mesma no caminho incremental (INV-P2-047).
 */
export const isExposedPosition = (state: {
  quantityMicros: number;
  principalCents: number;
  currentValueCents: number;
}): boolean =>
  state.quantityMicros !== 0 ||
  state.principalCents !== 0 ||
  state.currentValueCents !== 0;

export const positionState = (
  snapshot: admin.firestore.DocumentSnapshot,
): PositionState => {
  if (!snapshot.exists) return emptyPosition();
  const data = snapshot.data() ?? {};
  const state: PositionState = {
    quantityMicros: integerOrZero(data.quantityMicros),
    principalCents: integerOrZero(data.principalCents),
    realizedGainCents: integerOrZero(data.realizedGainCents),
    realizedLossCents: integerOrZero(data.realizedLossCents),
    feesCents: integerOrZero(data.feesCents),
    taxCents: integerOrZero(data.taxCents),
    currentValueCents: integerOrZero(data.currentValueCents),
    version: integerOrZero(data.version),
  };
  if (typeof data.goalId === "string") state.goalId = data.goalId;
  if (typeof data.valuationId === "string") {
    state.valuationId = data.valuationId;
  }
  if (Number.isSafeInteger(data.valuationUnitPriceMicros)) {
    state.valuationUnitPriceMicros = data.valuationUnitPriceMicros;
  }
  if (data.valuationEffectiveAt instanceof Timestamp) {
    state.valuationEffectiveAt = data.valuationEffectiveAt;
  }
  return state;
};

const applyPositionDeltas = (
  current: PositionState,
  deltas: PositionDeltas,
): PositionState => {
  const quantityMicros = addExact(
    current.quantityMicros,
    deltas.quantityMicros,
    "quantityMicros",
  );
  const principalCents = addExact(
    current.principalCents,
    deltas.principalCents,
    "principalCents",
  );
  const realizedGainCents = addExact(
    current.realizedGainCents,
    deltas.realizedGainCents,
    "realizedGainCents",
  );
  const realizedLossCents = addExact(
    current.realizedLossCents,
    deltas.realizedLossCents ?? 0,
    "realizedLossCents",
  );
  const feesCents = addExact(current.feesCents, deltas.feesCents, "feesCents");
  const taxCents = addExact(current.taxCents, deltas.taxCents, "taxCents");
  if (
    quantityMicros < 0 ||
    principalCents < 0 ||
    realizedGainCents < 0 ||
    realizedLossCents < 0 ||
    feesCents < 0 ||
    taxCents < 0
  ) {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      "O movimento deixaria a posição de investimento inconsistente.",
    );
  }
  // INV-P1-009 — invariante de encerramento. Sem quantidade não há custo de
  // aquisição a sustentar: um principal remanescente aqui é patrimônio
  // fantasma, somado ao resumo e às 8 faixas de alocação, e a reconstrução
  // reproduz o mesmo erro porque soma os mesmos deltas do ledger. O caminho
  // correto para resgatar abaixo do custo é retirar o custo inteiro e lançar
  // a diferença em `lossCents`.
  if (quantityMicros === 0 && principalCents !== 0) {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      "Ao zerar a quantidade da posição, o custo resgatado precisa ser o " +
        "custo total. Lance a diferença como perda realizada.",
    );
  }
  const currentValueCents = currentValueForPosition(
    quantityMicros,
    principalCents,
    current.valuationUnitPriceMicros,
  );
  return {
    ...current,
    quantityMicros,
    principalCents,
    realizedGainCents,
    realizedLossCents,
    feesCents,
    taxCents,
    currentValueCents,
    version: current.version + 1,
  };
};

const ensureAccountAndAsset = (
  accountSnapshot: admin.firestore.DocumentSnapshot,
  assetSnapshot: admin.firestore.DocumentSnapshot,
  workspaceId: string,
  profileType: "PF" | "PJ",
  requireActive: boolean,
) => {
  const account = assertWorkspaceDocument(
    accountSnapshot,
    workspaceId,
    "Conta de investimento",
  );
  const asset = assertWorkspaceDocument(
    assetSnapshot,
    workspaceId,
    "Ativo de investimento",
  );
  if (account.currency !== "BRL" || asset.currency !== "BRL") {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      "Conta e ativo precisam usar a moeda BRL neste domínio.",
    );
  }
  if (
    account.profileType !== profileType ||
    asset.profileType !== profileType
  ) {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      "Conta e ativo não pertencem ao contexto PF/PJ do workspace.",
    );
  }
  if (
    requireActive &&
    (account.status !== "active" || asset.status !== "active")
  ) {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      "Conta e ativo precisam estar ativos para esta operação.",
    );
  }
  return {account, asset};
};

export const updateGoalProjection = (
  transaction: admin.firestore.Transaction,
  goalSnapshot: admin.firestore.DocumentSnapshot | undefined,
  netContributionDeltaCents: number,
  currentValueDeltaCents: number,
  actorId: string,
): void => {
  if (
    !goalSnapshot ||
    (netContributionDeltaCents === 0 && currentValueDeltaCents === 0)
  ) {
    return;
  }
  const goal = assertWorkspaceDocument(
    goalSnapshot,
    goalSnapshot.ref.parent.parent?.id ?? "",
    "Meta",
  );
  const nextNet = addExact(
    integerOrZero(goal.investmentNetContributionCents),
    netContributionDeltaCents,
    "investmentNetContributionCents",
  );
  const nextCurrent = addExact(
    integerOrZero(goal.investmentCurrentValueCents),
    currentValueDeltaCents,
    "investmentCurrentValueCents",
  );
  if (nextNet < 0 || nextCurrent < 0) {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      "O movimento deixaria o progresso de investimentos " +
        "da meta inconsistente.",
    );
  }
  transaction.update(goalSnapshot.ref, {
    investmentNetContributionCents: nextNet,
    investmentCurrentValueCents: nextCurrent,
    investmentProgressCents:
      goal.progressBasis === "current_value" ? nextCurrent : nextNet,
    investmentProjectionVersion:
      integerOrZero(goal.investmentProjectionVersion) + 1,
    investmentCalculationVersion: INVESTMENT_CALCULATION_VERSION,
    investmentProjectionDirty: goal.investmentProjectionDirty === true,
    investmentUpdatedBy: actorId,
    investmentUpdatedAt: FieldValue.serverTimestamp(),
  });
};

export const writePosition = (
  transaction: admin.firestore.Transaction,
  snapshot: admin.firestore.DocumentSnapshot,
  workspaceId: string,
  profileType: "PF" | "PJ",
  accountId: string,
  assetId: string,
  state: PositionState,
  movementId: string,
  movementAt: Timestamp,
  actorId: string,
): void => {
  const previous = positionState(snapshot);
  const data = {
    id: snapshot.ref.id,
    workspaceId,
    profileType,
    accountId,
    assetId,
    currency: "BRL",
    status: "active",
    quantityMicros: state.quantityMicros,
    principalCents: state.principalCents,
    realizedGainCents: state.realizedGainCents,
    realizedLossCents: state.realizedLossCents,
    feesCents: state.feesCents,
    taxCents: state.taxCents,
    currentValueCents: state.currentValueCents,
    unrealizedAppreciationCents: state.currentValueCents - state.principalCents,
    ...(state.valuationId ? {valuationId: state.valuationId} : {}),
    ...(state.valuationUnitPriceMicros !== undefined ?
      {
        valuationUnitPriceMicros: state.valuationUnitPriceMicros,
      } :
      {}),
    ...(state.valuationEffectiveAt ?
      {valuationEffectiveAt: state.valuationEffectiveAt} :
      {}),
    calculationVersion: INVESTMENT_CALCULATION_VERSION,
    version: state.version,
    lastMovementId: movementId,
    lastMovementAt: movementAt,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: actorId,
  };
  // Valida a visão completa do documento (inclusive `goalId`) antes de
  // qualquer escrita; o `merge` abaixo usa `FieldValue.delete()`, que não é
  // representável no contrato.
  assertInvestmentDocument("position", {
    ...data,
    ...(state.goalId ? {goalId: state.goalId} : {}),
    // `data` não carrega `createdAt`: o campo só é escrito na criação e
    // preservado no merge. A validação usa a visão completa do documento.
    createdAt: snapshot.exists ?
      ((snapshot.data()?.createdAt as Timestamp | undefined) ??
        FieldValue.serverTimestamp()) :
      FieldValue.serverTimestamp(),
  }, workspaceId);
  if (snapshot.exists) {
    transaction.set(
      snapshot.ref,
      {
        ...data,
        goalId: state.goalId ?? FieldValue.delete(),
        valuationId: state.valuationId ?? FieldValue.delete(),
        valuationUnitPriceMicros:
          state.valuationUnitPriceMicros ?? FieldValue.delete(),
        valuationEffectiveAt: state.valuationEffectiveAt ?? FieldValue.delete(),
      },
      {merge: true},
    );
  } else {
    transaction.create(snapshot.ref, {
      ...data,
      ...(state.goalId ? {goalId: state.goalId} : {}),
      ...(state.valuationId ? {valuationId: state.valuationId} : {}),
      ...(state.valuationUnitPriceMicros !== undefined ?
        {
          valuationUnitPriceMicros: state.valuationUnitPriceMicros,
        } :
        {}),
      ...(state.valuationEffectiveAt ?
        {valuationEffectiveAt: state.valuationEffectiveAt} :
        {}),
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  const summaryRef = investmentDoc(
    workspaceId,
    INVESTMENT_COLLECTIONS.summaries,
    "current",
  );
  transaction.set(summaryRef, {
    id: "current",
    workspaceId,
    profileType,
    currency: "BRL",
    // Cerca de reconstrução: toda mutação publica uma nova versão de
    // projeção, invalidando um rebuild concorrente em andamento.
    projectionVersion: FieldValue.increment(1),
    // INV-P2-047 — `positionCount` só crescia: contava a criação do documento
    // e nunca o encerramento da posição. Como a reconstrução conta apenas
    // posições **expostas**, a métrica de deriva acusava divergência
    // permanente mesmo num workspace íntegro, e o sinal ficava inútil.
    // A definição passa a ser a mesma dos dois lados.
    positionCount: FieldValue.increment(
      Number(isExposedPosition(state)) - Number(isExposedPosition(previous)),
    ),
    principalCents: FieldValue.increment(
      state.principalCents - previous.principalCents,
    ),
    currentValueCents: FieldValue.increment(
      state.currentValueCents - previous.currentValueCents,
    ),
    realizedGainCents: FieldValue.increment(
      state.realizedGainCents - previous.realizedGainCents,
    ),
    realizedLossCents: FieldValue.increment(
      state.realizedLossCents - previous.realizedLossCents,
    ),
    feesCents: FieldValue.increment(state.feesCents - previous.feesCents),
    taxCents: FieldValue.increment(state.taxCents - previous.taxCents),
    unrealizedAppreciationCents: FieldValue.increment(
      (state.currentValueCents - state.principalCents) -
        (previous.currentValueCents - previous.principalCents),
    ),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: actorId,
  }, {merge: true});
};

const transactionDate = (timestamp: Timestamp): string =>
  saoPauloDayKey(timestamp.toDate());

const writeCashProjection = (
  transaction: admin.firestore.Transaction,
  auth: WorkspaceAuthorizationContext,
  profileType: "PF" | "PJ",
  movement: Record<string, unknown>,
  investmentOperation: "contribution" | "redemption" | "redemption_reversal",
  status: "pending" | "settled" | "cancelled",
): void => {
  const transactionId = String(movement.transactionId);
  const occurredAt = movement.occurredAt as Timestamp;
  const settlementAt = movement.settlementAt as Timestamp | undefined;
  const effectiveAt = settlementAt ?? occurredAt;
  const cashDeltaCents = movement.cashDeltaCents as number;
  const valueCents = Math.abs(
    cashDeltaCents || (movement.principalCents as number),
  );
  const isSettled = status === "settled";
  const data = {
    type: "investimento",
    description: movement.description,
    category: "Investimentos",
    value: valueCents / 100,
    valueCents,
    date: transactionDate(effectiveAt),
    transactionDate: effectiveAt,
    ...(settlementAt ? {settlementDate: settlementAt} : {}),
    isPaid: isSettled,
    workspaceId: auth.workspaceId,
    profileId: auth.workspaceId,
    profileType,
    userId: auth.uid,
    ...(movement.walletId ? {walletId: movement.walletId} : {}),
    ...(movement.goalId ? {goalId: movement.goalId} : {}),
    investmentMetadata: {
      domainVersion: INVESTMENT_DOMAIN_VERSION,
      domainMovementId: movement.id,
      domainMovementOperation: movement.operation,
      currency: "BRL",
      investmentOperation,
      cashImpact:
        !isSettled || cashDeltaCents === 0 ?
          "none" :
          cashDeltaCents > 0 ?
            "inflow" :
            "outflow",
      investmentImpact:
        !isSettled || movement.principalDeltaCents === 0 ?
          "none" :
          (movement.principalDeltaCents as number) > 0 ?
            "increase" :
            "decrease",
      principalCents: movement.principalCents,
      gainCents: movement.gainCents,
      feesCents: movement.feesCents,
      taxCents: movement.taxCents,
      ...(settlementAt ? {settlementDate: settlementAt} : {}),
      status,
      sourceMovementId: movement.reversedMovementId ?? movement.id,
      idempotencyKey: movement.idempotencyKeyHash,
    },
    createdBy: movement.createdBy,
    createdAt: movement.createdAt,
    updatedBy: auth.uid,
    updatedAt: FieldValue.serverTimestamp(),
  };
  transaction.set(
    investmentTransactionDoc(auth.workspaceId, transactionId),
    data,
    {merge: true},
  );
};

export const executeCreateInvestmentContribution = async (
  auth: WorkspaceAuthorizationContext,
  payload: CreateInvestmentContributionPayload,
): Promise<Record<string, unknown>> => {
  const operation = "createInvestmentContribution" as const;
  const movementId = deterministicDocumentId(
    operation,
    auth.uid,
    payload.idempotencyKey,
  );
  const projectionId = `investment_${movementId}`;
  const occurredAt = parseTimestamp(payload.occurredAt);
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
    const positionId = investmentPositionId(payload.accountId, payload.assetId);
    const accountRef = investmentDoc(
      auth.workspaceId,
      INVESTMENT_COLLECTIONS.accounts,
      payload.accountId,
    );
    const assetRef = investmentDoc(
      auth.workspaceId,
      INVESTMENT_COLLECTIONS.assets,
      payload.assetId,
    );
    const positionRef = investmentDoc(
      auth.workspaceId,
      INVESTMENT_COLLECTIONS.positions,
      positionId,
    );
    const movementRef = investmentDoc(
      auth.workspaceId,
      INVESTMENT_COLLECTIONS.movements,
      movementId,
    );
    const [accountSnapshot, assetSnapshot, positionSnapshot, movementSnapshot] =
      await Promise.all([
        transaction.get(accountRef),
        transaction.get(assetRef),
        transaction.get(positionRef),
        transaction.get(movementRef),
      ]);
    ensureAccountAndAsset(
      accountSnapshot,
      assetSnapshot,
      auth.workspaceId,
      authorization.profileType,
      true,
    );
    const importBatchRef = payload.importBatchId ?
      investmentDoc(
        auth.workspaceId,
        INVESTMENT_COLLECTIONS.importBatches,
        payload.importBatchId,
      ) :
      undefined;
    const importBatchSnapshot = importBatchRef ?
      await transaction.get(importBatchRef) :
      undefined;
    if (importBatchRef && importBatchSnapshot) {
      const batch = assertWorkspaceDocument(
        importBatchSnapshot,
        auth.workspaceId,
        "Lote de importação",
      );
      if (batch.status === "completed" || batch.status === "failed") {
        throw new CreditCardApplicationError(
          "domain_precondition_failed",
          "O lote de importação informado não está aberto.",
        );
      }
      if (batch.profileType !== authorization.profileType) {
        throw new CreditCardApplicationError(
          "domain_precondition_failed",
          "O lote de importação não pertence ao contexto PF/PJ do workspace.",
        );
      }
    }
    if (movementSnapshot.exists) {
      throw new CreditCardApplicationError(
        "idempotency_conflict",
        "Movimento já existente.",
      );
    }
    const current = positionState(positionSnapshot);
    if (current.goalId && payload.goalId && current.goalId !== payload.goalId) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "A posição já está vinculada a outra meta.",
      );
    }
    if (!current.goalId && payload.goalId && current.principalCents > 0) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "Use a operação de vínculo para associar uma posição já existente.",
      );
    }
    const goalId = current.goalId ?? payload.goalId;
    const goalSnapshot = goalId ?
      await transaction.get(investmentGoalDoc(auth.workspaceId, goalId)) :
      undefined;
    if (goalSnapshot) {
      assertWorkspaceDocument(goalSnapshot, auth.workspaceId, "Meta");
    }
    const periodContext = await readInvestmentPeriodContext(
      transaction,
      auth.workspaceId,
      occurredAt,
    );
    const cashOutCents = addExact(
      addExact(payload.principalCents, payload.feesCents, "cashOutCents"),
      payload.taxCents,
      "cashOutCents",
    );
    const next = applyPositionDeltas(current, {
      quantityMicros: payload.quantityMicros,
      principalCents: payload.principalCents,
      realizedGainCents: 0,
      feesCents: payload.feesCents,
      taxCents: payload.taxCents,
    });
    next.goalId = goalId;
    const movement = {
      id: movementId,
      workspaceId: auth.workspaceId,
      profileType: authorization.profileType,
      domainVersion: INVESTMENT_DOMAIN_VERSION,
      calculationVersion: INVESTMENT_CALCULATION_VERSION,
      accountId: payload.accountId,
      assetId: payload.assetId,
      positionId,
      operation: "contribution",
      status: "settled",
      currency: "BRL",
      description: payload.description,
      principalCents: payload.principalCents,
      gainCents: 0,
      feesCents: payload.feesCents,
      taxCents: payload.taxCents,
      quantityMicros: payload.quantityMicros,
      cashDeltaCents: negateExact(cashOutCents, "cashDeltaCents"),
      principalDeltaCents: payload.principalCents,
      realizedGainDeltaCents: 0,
      feesDeltaCents: payload.feesCents,
      taxDeltaCents: payload.taxCents,
      quantityDeltaMicros: payload.quantityMicros,
      goalNetContributionDeltaCents: goalId ? payload.principalCents : 0,
      goalCurrentValueDeltaCents: goalId ?
        next.currentValueCents - current.currentValueCents :
        0,
      currentValueDeltaCents: next.currentValueCents - current.currentValueCents,
      ...(goalId ? {goalId} : {}),
      ...(payload.walletId ? {walletId: payload.walletId} : {}),
      ...(payload.importBatchId ?
        {importBatchId: payload.importBatchId} :
        {}),
      transactionId: projectionId,
      correlationId: payload.correlationId,
      idempotencyKeyHash: reservation.keyHash,
      occurredAt,
      settlementAt: occurredAt,
      createdBy: auth.uid,
      createdAt: FieldValue.serverTimestamp(),
      settledBy: auth.uid,
      settledAt: FieldValue.serverTimestamp(),
    };
    transaction.create(
      movementRef,
      assertInvestmentDocument("movement", movement, auth.workspaceId),
    );
    if (importBatchRef) {
      // Contador do lote avança no mesmo limite atômico do aporte.
      transaction.update(importBatchRef, {
        processedCount: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    writePosition(
      transaction,
      positionSnapshot,
      auth.workspaceId,
      authorization.profileType,
      payload.accountId,
      payload.assetId,
      next,
      movementId,
      occurredAt,
      auth.uid,
    );
    writeInvestmentAllocationProjections(
      transaction,
      auth.workspaceId,
      authorization.profileType,
      auth.uid,
      accountSnapshot.data() ?? {},
      assetSnapshot.data() ?? {},
      current,
      next,
      {next: goalSnapshot?.data()?.name as string | undefined},
    );
    writeInvestmentReportPeriod(
      transaction,
      auth.workspaceId,
      authorization.profileType,
      auth.uid,
      occurredAt,
      {
        operation: "contribution",
        principalCents: payload.principalCents,
        gainCents: 0,
        feesCents: payload.feesCents,
        taxCents: payload.taxCents,
        cashDeltaCents: movement.cashDeltaCents,
        currentValueDeltaCents:
          next.currentValueCents - current.currentValueCents,
      },
      periodContext,
    );
    updateGoalProjection(
      transaction,
      goalSnapshot,
      movement.goalNetContributionDeltaCents,
      movement.goalCurrentValueDeltaCents,
      auth.uid,
    );
    writeCashProjection(
      transaction,
      auth,
      authorization.profileType,
      movement,
      "contribution",
      "settled",
    );
    const result = {
      success: true,
      movementId,
      positionId,
      transactionId: projectionId,
      status: "settled",
      cashDeltaCents: movement.cashDeltaCents,
      principalCents: next.principalCents,
      currentValueCents: next.currentValueCents,
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
      "movement",
      movementId,
      {
        positionId,
        accountId: payload.accountId,
        assetId: payload.assetId,
        goalId: goalId ?? null,
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

export const executeCreateInvestmentRedemptionV2 = async (
  auth: WorkspaceAuthorizationContext,
  payload: CreateInvestmentRedemptionV2Payload,
): Promise<Record<string, unknown>> => {
  const operation = "createInvestmentRedemption" as const;
  const movementId = deterministicDocumentId(
    operation,
    auth.uid,
    payload.idempotencyKey,
  );
  const projectionId = `investment_${movementId}`;
  const requestedAt = parseTimestamp(payload.requestedAt);
  const expectedSettlementAt = payload.expectedSettlementAt ?
    parseTimestamp(payload.expectedSettlementAt) :
    undefined;
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
    const positionId = investmentPositionId(payload.accountId, payload.assetId);
    const refs = {
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
      position: investmentDoc(
        auth.workspaceId,
        INVESTMENT_COLLECTIONS.positions,
        positionId,
      ),
      movement: investmentDoc(
        auth.workspaceId,
        INVESTMENT_COLLECTIONS.movements,
        movementId,
      ),
    };
    const [accountSnapshot, assetSnapshot, positionSnapshot, movementSnapshot] =
      await Promise.all([
        transaction.get(refs.account),
        transaction.get(refs.asset),
        transaction.get(refs.position),
        transaction.get(refs.movement),
      ]);
    ensureAccountAndAsset(
      accountSnapshot,
      assetSnapshot,
      auth.workspaceId,
      authorization.profileType,
      false,
    );
    const current = positionState(positionSnapshot);
    if (
      !positionSnapshot.exists ||
      current.principalCents < payload.requestedPrincipalCents ||
      current.quantityMicros < payload.requestedQuantityMicros
    ) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "O resgate solicitado supera o saldo disponível na posição.",
      );
    }
    if (movementSnapshot.exists) {
      throw new CreditCardApplicationError(
        "idempotency_conflict",
        "Movimento já existente.",
      );
    }
    const movement = {
      id: movementId,
      workspaceId: auth.workspaceId,
      profileType: authorization.profileType,
      domainVersion: INVESTMENT_DOMAIN_VERSION,
      calculationVersion: INVESTMENT_CALCULATION_VERSION,
      accountId: payload.accountId,
      assetId: payload.assetId,
      positionId,
      operation: "redemption",
      status: "pending",
      currency: "BRL",
      description: payload.description,
      principalCents: payload.requestedPrincipalCents,
      gainCents: 0,
      feesCents: 0,
      taxCents: 0,
      quantityMicros: payload.requestedQuantityMicros,
      cashDeltaCents: 0,
      principalDeltaCents: 0,
      realizedGainDeltaCents: 0,
      feesDeltaCents: 0,
      taxDeltaCents: 0,
      quantityDeltaMicros: 0,
      goalNetContributionDeltaCents: 0,
      goalCurrentValueDeltaCents: 0,
      currentValueDeltaCents: 0,
      ...(current.goalId ? {goalId: current.goalId} : {}),
      ...(payload.walletId ? {walletId: payload.walletId} : {}),
      transactionId: projectionId,
      correlationId: payload.correlationId,
      idempotencyKeyHash: reservation.keyHash,
      occurredAt: requestedAt,
      ...(expectedSettlementAt ? {expectedSettlementAt} : {}),
      createdBy: auth.uid,
      createdAt: FieldValue.serverTimestamp(),
    };
    transaction.create(refs.movement, assertInvestmentDocument("movement", movement, auth.workspaceId));
    writeCashProjection(
      transaction,
      auth,
      authorization.profileType,
      movement,
      "redemption",
      "pending",
    );
    const result = {
      success: true,
      movementId,
      positionId,
      transactionId: projectionId,
      status: "pending",
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
      "movement",
      movementId,
      {positionId, requestedPrincipalCents: payload.requestedPrincipalCents},
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

export const executeSettleInvestmentRedemption = async (
  auth: WorkspaceAuthorizationContext,
  payload: SettleInvestmentRedemptionPayload,
): Promise<Record<string, unknown>> => {
  const operation = "settleInvestmentRedemption" as const;
  const settledAt = assertNotFuture(
    parseTimestamp(payload.settledAt),
    "settledAt",
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
    const movementRef = investmentDoc(
      auth.workspaceId,
      INVESTMENT_COLLECTIONS.movements,
      payload.movementId,
    );
    const movementSnapshot = await transaction.get(movementRef);
    const movement = assertWorkspaceDocument(
      movementSnapshot,
      auth.workspaceId,
      "Resgate",
    );
    if (movement.operation !== "redemption" || movement.status !== "pending") {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "Somente um resgate pendente pode ser liquidado.",
      );
    }
    if (
      payload.settlement.principalCents > movement.principalCents ||
      payload.settlement.quantityMicros > movement.quantityMicros
    ) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "A liquidação supera os valores solicitados no resgate.",
      );
    }
    // INV-P2-022 — a liquidação não pode preceder o pedido que a originou.
    assertNotBefore(
      settledAt,
      movement.occurredAt as Timestamp,
      "settledAt",
      "à solicitação do resgate",
    );
    // INV-P1-009 — a exclusividade também vive aqui, e não só no schema Zod
    // da callable: as operações são chamadas diretamente por testes de
    // integração e pelos caminhos operacionais, e a invariante financeira não
    // pode depender de quem construiu o payload.
    if (payload.settlement.gainCents > 0 && payload.settlement.lossCents > 0) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "Uma liquidação tem ganho ou perda realizada, nunca os dois.",
      );
    }
    if (payload.settlement.lossCents > payload.settlement.principalCents) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "A perda realizada não pode superar o custo resgatado.",
      );
    }
    const refs = {
      account: investmentDoc(
        auth.workspaceId,
        INVESTMENT_COLLECTIONS.accounts,
        movement.accountId,
      ),
      asset: investmentDoc(
        auth.workspaceId,
        INVESTMENT_COLLECTIONS.assets,
        movement.assetId,
      ),
      position: investmentDoc(
        auth.workspaceId,
        INVESTMENT_COLLECTIONS.positions,
        movement.positionId,
      ),
    };
    const [accountSnapshot, assetSnapshot, positionSnapshot] =
      await Promise.all([
        transaction.get(refs.account),
        transaction.get(refs.asset),
        transaction.get(refs.position),
      ]);
    ensureAccountAndAsset(
      accountSnapshot,
      assetSnapshot,
      auth.workspaceId,
      authorization.profileType,
      false,
    );
    const current = positionState(positionSnapshot);
    const next = applyPositionDeltas(current, {
      quantityMicros: negateExact(
        payload.settlement.quantityMicros,
        "quantityDeltaMicros",
      ),
      principalCents: negateExact(
        payload.settlement.principalCents,
        "principalDeltaCents",
      ),
      realizedGainCents: payload.settlement.gainCents,
      realizedLossCents: payload.settlement.lossCents,
      feesCents: payload.settlement.feesCents,
      taxCents: payload.settlement.taxCents,
    });
    const goalId = current.goalId;
    const goalSnapshot = goalId ?
      await transaction.get(investmentGoalDoc(auth.workspaceId, goalId)) :
      undefined;
    if (goalSnapshot) {
      assertWorkspaceDocument(goalSnapshot, auth.workspaceId, "Meta");
    }
    const periodContext = await readInvestmentPeriodContext(
      transaction,
      auth.workspaceId,
      settledAt,
    );
    // Caixa recebido = custo resgatado + ganho − perda − taxas − imposto.
    // A perda entra com sinal negativo aqui e **não** reduz o principal
    // retirado da posição: é isso que impede o principal fantasma de
    // INV-P1-009.
    const grossCents = addExact(
      addExact(
        payload.settlement.principalCents,
        payload.settlement.gainCents,
        "grossCents",
      ),
      -payload.settlement.lossCents,
      "grossCents",
    );
    const chargesCents = addExact(
      payload.settlement.feesCents,
      payload.settlement.taxCents,
      "chargesCents",
    );
    const cashDeltaCents = addExact(
      grossCents,
      -chargesCents,
      "cashDeltaCents",
    );
    // Zero é admissível: uma perda igual ao custo é baixa total do ativo, com
    // caixa nulo. Negativo não é — um resgate não pode consumir dinheiro.
    if (cashDeltaCents < 0) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "Perda, taxas e impostos somados não podem superar o valor bruto " +
          "do resgate.",
      );
    }
    // INV-P3-051 — a liquidação parcial sobrescrevia `principalCents` e
    // `quantityMicros` do movimento com o valor liquidado, apagando o pedido
    // original: depois disso não havia como saber quanto tinha sido
    // solicitado, nem auditar a diferença. Os valores pedidos passam a ser
    // preservados em campos próprios, e o residual fica explícito.
    const requestedPrincipalCents = integerOrZero(
      movement.requestedPrincipalCents ?? movement.principalCents,
    );
    const requestedQuantityMicros = integerOrZero(
      movement.requestedQuantityMicros ?? movement.quantityMicros,
    );
    const residualPrincipalCents =
      requestedPrincipalCents - payload.settlement.principalCents;
    const residualQuantityMicros =
      requestedQuantityMicros - payload.settlement.quantityMicros;

    const settledMovement = {
      ...movement,
      status: "settled",
      requestedPrincipalCents,
      requestedQuantityMicros,
      residualPrincipalCents,
      residualQuantityMicros,
      principalCents: payload.settlement.principalCents,
      gainCents: payload.settlement.gainCents,
      lossCents: payload.settlement.lossCents,
      feesCents: payload.settlement.feesCents,
      taxCents: payload.settlement.taxCents,
      quantityMicros: payload.settlement.quantityMicros,
      cashDeltaCents,
      principalDeltaCents: -payload.settlement.principalCents,
      realizedGainDeltaCents: payload.settlement.gainCents,
      realizedLossDeltaCents: payload.settlement.lossCents,
      feesDeltaCents: payload.settlement.feesCents,
      taxDeltaCents: payload.settlement.taxCents,
      quantityDeltaMicros: -payload.settlement.quantityMicros,
      goalNetContributionDeltaCents: goalId ?
        -payload.settlement.principalCents :
        0,
      goalCurrentValueDeltaCents: goalId ?
        next.currentValueCents - current.currentValueCents :
        0,
      currentValueDeltaCents: next.currentValueCents - current.currentValueCents,
      ...(goalId ? {goalId} : {}),
      settlementAt: settledAt,
      settledBy: auth.uid,
      settledAt: FieldValue.serverTimestamp(),
      settlementCorrelationId: payload.correlationId,
      updatedAt: FieldValue.serverTimestamp(),
    };
    transaction.update(movementRef, {
      status: settledMovement.status,
      requestedPrincipalCents,
      requestedQuantityMicros,
      residualPrincipalCents,
      residualQuantityMicros,
      principalCents: settledMovement.principalCents,
      gainCents: settledMovement.gainCents,
      lossCents: settledMovement.lossCents,
      feesCents: settledMovement.feesCents,
      taxCents: settledMovement.taxCents,
      quantityMicros: settledMovement.quantityMicros,
      cashDeltaCents: settledMovement.cashDeltaCents,
      principalDeltaCents: settledMovement.principalDeltaCents,
      realizedGainDeltaCents: settledMovement.realizedGainDeltaCents,
      realizedLossDeltaCents: settledMovement.realizedLossDeltaCents,
      feesDeltaCents: settledMovement.feesDeltaCents,
      taxDeltaCents: settledMovement.taxDeltaCents,
      quantityDeltaMicros: settledMovement.quantityDeltaMicros,
      goalNetContributionDeltaCents:
        settledMovement.goalNetContributionDeltaCents,
      goalCurrentValueDeltaCents: settledMovement.goalCurrentValueDeltaCents,
      currentValueDeltaCents: settledMovement.currentValueDeltaCents,
      ...(goalId ? {goalId} : {}),
      settlementAt: settledMovement.settlementAt,
      settledBy: auth.uid,
      settledAt: FieldValue.serverTimestamp(),
      settlementCorrelationId: payload.correlationId,
      updatedAt: FieldValue.serverTimestamp(),
    });
    writePosition(
      transaction,
      positionSnapshot,
      auth.workspaceId,
      authorization.profileType,
      movement.accountId,
      movement.assetId,
      next,
      payload.movementId,
      settledAt,
      auth.uid,
    );
    writeInvestmentAllocationProjections(
      transaction,
      auth.workspaceId,
      authorization.profileType,
      auth.uid,
      accountSnapshot.data() ?? {},
      assetSnapshot.data() ?? {},
      current,
      next,
      {
        previous: goalSnapshot?.data()?.name as string | undefined,
        next: goalSnapshot?.data()?.name as string | undefined,
      },
    );
    writeInvestmentReportPeriod(
      transaction,
      auth.workspaceId,
      authorization.profileType,
      auth.uid,
      settledAt,
      {
        operation: "redemption",
        principalCents: payload.settlement.principalCents,
        gainCents: payload.settlement.gainCents,
        lossCents: payload.settlement.lossCents,
        feesCents: payload.settlement.feesCents,
        taxCents: payload.settlement.taxCents,
        cashDeltaCents,
        currentValueDeltaCents:
          next.currentValueCents - current.currentValueCents,
      },
      periodContext,
    );
    updateGoalProjection(
      transaction,
      goalSnapshot,
      settledMovement.goalNetContributionDeltaCents,
      settledMovement.goalCurrentValueDeltaCents,
      auth.uid,
    );
    writeCashProjection(
      transaction,
      auth,
      authorization.profileType,
      settledMovement,
      "redemption",
      "settled",
    );
    const result = {
      success: true,
      movementId: payload.movementId,
      positionId: movement.positionId,
      transactionId: movement.transactionId,
      status: "settled",
      cashDeltaCents,
      remainingPrincipalCents: next.principalCents,
      realizedGainCents: next.realizedGainCents,
      realizedLossCents: next.realizedLossCents,
      realizedResultCents: next.realizedGainCents - next.realizedLossCents,
      // O pedido residual não vira novo pendente automaticamente: a decisão
      // de resgatar o restante é do usuário. O valor volta explícito para que
      // a interface possa oferecê-la (INV-P3-051).
      residualPrincipalCents,
      residualQuantityMicros,
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
      "movement",
      payload.movementId,
      {
        positionId: movement.positionId,
        beforeStatus: "pending",
        afterStatus: "settled",
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

export const executeReverseInvestmentMovement = async (
  auth: WorkspaceAuthorizationContext,
  payload: ReverseInvestmentMovementPayload,
): Promise<Record<string, unknown>> => {
  const operation = "reverseInvestmentMovement" as const;
  const reversalId = deterministicDocumentId(
    operation,
    auth.uid,
    payload.idempotencyKey,
  );
  const projectionId = `investment_${reversalId}`;
  const reversedAt = assertNotFuture(
    parseTimestamp(payload.reversedAt),
    "reversedAt",
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
    const originalRef = investmentDoc(
      auth.workspaceId,
      INVESTMENT_COLLECTIONS.movements,
      payload.movementId,
    );
    const reversalRef = investmentDoc(
      auth.workspaceId,
      INVESTMENT_COLLECTIONS.movements,
      reversalId,
    );
    const [originalSnapshot, reversalSnapshot] = await Promise.all([
      transaction.get(originalRef),
      transaction.get(reversalRef),
    ]);
    const original = assertWorkspaceDocument(
      originalSnapshot,
      auth.workspaceId,
      "Movimento",
    );
    if (
      original.status !== "settled" ||
      (original.operation !== "contribution" &&
        original.operation !== "redemption")
    ) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "Somente um aporte ou resgate liquidado pode ser estornado.",
      );
    }
    if (original.reversedByMovementId || reversalSnapshot.exists) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "Este movimento já foi estornado.",
      );
    }
    // INV-P2-022 — o estorno não pode preceder o fato estornado. Com data
    // retroativa ele subtrai patrimônio de um mês anterior ao próprio
    // movimento e propaga o negativo para todos os meses seguintes.
    assertNotBefore(
      reversedAt,
      ((original.settlementAt as Timestamp | undefined) ??
        (original.occurredAt as Timestamp)),
      "reversedAt",
      "à liquidação do movimento estornado",
    );
    const positionRef = investmentDoc(
      auth.workspaceId,
      INVESTMENT_COLLECTIONS.positions,
      original.positionId,
    );
    const accountRef = investmentDoc(
      auth.workspaceId,
      INVESTMENT_COLLECTIONS.accounts,
      original.accountId,
    );
    const assetRef = investmentDoc(
      auth.workspaceId,
      INVESTMENT_COLLECTIONS.assets,
      original.assetId,
    );
    const [positionSnapshot, accountSnapshot, assetSnapshot] =
      await Promise.all([
        transaction.get(positionRef),
        transaction.get(accountRef),
        transaction.get(assetRef),
      ]);
    ensureAccountAndAsset(
      accountSnapshot,
      assetSnapshot,
      auth.workspaceId,
      authorization.profileType,
      false,
    );
    const current = positionState(positionSnapshot);
    if (!positionSnapshot.exists) {
      throw new CreditCardApplicationError(
        "not_found",
        "Posição não encontrada.",
      );
    }
    const isMigratedMovement =
      typeof original.migratedFromTransactionId === "string";
    const deltas = {
      quantityMicros: negateExact(
        original.quantityDeltaMicros,
        "quantityDeltaMicros",
      ),
      principalCents: negateExact(
        original.principalDeltaCents,
        "principalDeltaCents",
      ),
      realizedGainCents: negateExact(
        original.realizedGainDeltaCents,
        "realizedGainDeltaCents",
      ),
      // INV-P1-009 — o estorno anula também a perda realizada do movimento
      // original. Sem isto, estornar um resgate com prejuízo deixaria a perda
      // acumulada na posição sem fato que a sustente.
      realizedLossCents: negateExact(
        integerOrZero(original.realizedLossDeltaCents),
        "realizedLossDeltaCents",
      ),
      feesCents: negateExact(original.feesDeltaCents, "feesDeltaCents"),
      taxCents: negateExact(original.taxDeltaCents, "taxDeltaCents"),
    };
    const next = applyPositionDeltas(current, deltas);
    const goalId = current.goalId;
    const goalSnapshot = goalId ?
      await transaction.get(investmentGoalDoc(auth.workspaceId, goalId)) :
      undefined;
    if (goalSnapshot) {
      assertWorkspaceDocument(goalSnapshot, auth.workspaceId, "Meta");
    }
    const periodContext = await readInvestmentPeriodContext(
      transaction,
      auth.workspaceId,
      reversedAt,
    );
    const reversal = {
      id: reversalId,
      workspaceId: auth.workspaceId,
      profileType: authorization.profileType,
      domainVersion: INVESTMENT_DOMAIN_VERSION,
      calculationVersion: INVESTMENT_CALCULATION_VERSION,
      accountId: original.accountId,
      assetId: original.assetId,
      positionId: original.positionId,
      operation: "reversal",
      // A operação original fica explícita no documento: a reconstrução das
      // projeções não precisa inferi-la pelo sinal do principal.
      reversalOfOperation: original.operation,
      status: "settled",
      currency: "BRL",
      description: `Estorno: ${original.description}`,
      principalCents: Math.abs(original.principalCents),
      gainCents: Math.abs(original.gainCents),
      lossCents: Math.abs(integerOrZero(original.lossCents)),
      feesCents: Math.abs(original.feesCents),
      taxCents: Math.abs(original.taxCents),
      quantityMicros: Math.abs(original.quantityMicros),
      cashDeltaCents: negateExact(original.cashDeltaCents, "cashDeltaCents"),
      principalDeltaCents: deltas.principalCents,
      realizedGainDeltaCents: deltas.realizedGainCents,
      realizedLossDeltaCents: deltas.realizedLossCents,
      feesDeltaCents: deltas.feesCents,
      taxDeltaCents: deltas.taxCents,
      quantityDeltaMicros: deltas.quantityMicros,
      goalNetContributionDeltaCents: goalId ? deltas.principalCents : 0,
      goalCurrentValueDeltaCents: goalId ?
        next.currentValueCents - current.currentValueCents :
        0,
      currentValueDeltaCents: next.currentValueCents - current.currentValueCents,
      ...(goalId ? {goalId} : {}),
      ...(original.walletId ? {walletId: original.walletId} : {}),
      // Movimento migrado do legado não tem espelho próprio: a transação
      // legada **é** o registro de caixa. O estorno aponta para a mesma
      // origem e não cria um segundo documento em `transactions`.
      ...(isMigratedMovement ?
        {
          transactionId: String(original.transactionId ?? projectionId),
          migratedFromTransactionId: String(original.migratedFromTransactionId),
          ...(typeof original.migrationId === "string" ?
            {migrationId: original.migrationId} :
            {}),
        } :
        {transactionId: projectionId}),
      reversedMovementId: payload.movementId,
      reversalReason: payload.reason,
      correlationId: payload.correlationId,
      idempotencyKeyHash: reservation.keyHash,
      occurredAt: reversedAt,
      settlementAt: reversedAt,
      createdBy: auth.uid,
      createdAt: FieldValue.serverTimestamp(),
      settledBy: auth.uid,
      settledAt: FieldValue.serverTimestamp(),
    };
    transaction.create(reversalRef, assertInvestmentDocument("movement", reversal, auth.workspaceId));
    transaction.update(originalRef, {
      reversedByMovementId: reversalId,
      reversedAt,
      reversedBy: auth.uid,
      reversalReason: payload.reason,
      reversalCorrelationId: payload.correlationId,
      updatedAt: FieldValue.serverTimestamp(),
    });
    writePosition(
      transaction,
      positionSnapshot,
      auth.workspaceId,
      authorization.profileType,
      original.accountId,
      original.assetId,
      next,
      reversalId,
      reversedAt,
      auth.uid,
    );
    writeInvestmentAllocationProjections(
      transaction,
      auth.workspaceId,
      authorization.profileType,
      auth.uid,
      accountSnapshot.data() ?? {},
      assetSnapshot.data() ?? {},
      current,
      next,
      {
        previous: goalSnapshot?.data()?.name as string | undefined,
        next: goalSnapshot?.data()?.name as string | undefined,
      },
    );
    writeInvestmentReportPeriod(
      transaction,
      auth.workspaceId,
      authorization.profileType,
      auth.uid,
      reversedAt,
      {
        operation: "reversal",
        reversalOfOperation: original.operation,
        principalCents: original.principalCents,
        gainCents: original.gainCents,
        lossCents: integerOrZero(original.lossCents),
        feesCents: original.feesCents,
        taxCents: original.taxCents,
        cashDeltaCents: reversal.cashDeltaCents,
        currentValueDeltaCents:
          next.currentValueCents - current.currentValueCents,
      },
      periodContext,
    );
    updateGoalProjection(
      transaction,
      goalSnapshot,
      reversal.goalNetContributionDeltaCents,
      reversal.goalCurrentValueDeltaCents,
      auth.uid,
    );
    // Estorno de movimento migrado não escreve espelho de caixa: a transação
    // legada de origem permanece em `transactions` e continua sendo o único
    // registro de caixa daquele evento. Escrever um espelho compensatório
    // criaria um segundo lançamento de caixa para um fato que o legado já
    // contabiliza — dupla contagem no rollback da migração (INV-P1-012).
    if (!isMigratedMovement) {
      writeCashProjection(
        transaction,
        auth,
        authorization.profileType,
        reversal,
        original.operation === "redemption" ?
          "redemption_reversal" :
          "redemption",
        "settled",
      );
    }
    const result = {
      success: true,
      movementId: payload.movementId,
      reversalMovementId: reversalId,
      transactionId: projectionId,
      status: "settled",
      principalCents: next.principalCents,
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
      "movement",
      reversalId,
      {reversedMovementId: payload.movementId, reason: payload.reason},
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

const executeGoalLinkChange = async (
  auth: WorkspaceAuthorizationContext,
  payload: LinkInvestmentToGoalPayload | UnlinkInvestmentFromGoalPayload,
  link: boolean,
): Promise<Record<string, unknown>> => {
  const operation = link ?
    ("linkInvestmentToGoal" as const) :
    ("unlinkInvestmentFromGoal" as const);
  const movementId = deterministicDocumentId(
    operation,
    auth.uid,
    payload.idempotencyKey,
  );
  const occurredAt = parseTimestamp(payload.occurredAt);
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
    const positionId = investmentPositionId(payload.accountId, payload.assetId);
    const refs = {
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
      position: investmentDoc(
        auth.workspaceId,
        INVESTMENT_COLLECTIONS.positions,
        positionId,
      ),
      movement: investmentDoc(
        auth.workspaceId,
        INVESTMENT_COLLECTIONS.movements,
        movementId,
      ),
      goal: investmentGoalDoc(auth.workspaceId, payload.goalId),
    };
    const [
      accountSnapshot,
      assetSnapshot,
      positionSnapshot,
      movementSnapshot,
      goalSnapshot,
    ] = await Promise.all([
      transaction.get(refs.account),
      transaction.get(refs.asset),
      transaction.get(refs.position),
      transaction.get(refs.movement),
      transaction.get(refs.goal),
    ]);
    ensureAccountAndAsset(
      accountSnapshot,
      assetSnapshot,
      auth.workspaceId,
      authorization.profileType,
      link,
    );
    assertWorkspaceDocument(goalSnapshot, auth.workspaceId, "Meta");
    if (movementSnapshot.exists) {
      throw new CreditCardApplicationError(
        "idempotency_conflict",
        "Movimento já existente.",
      );
    }
    const current = positionState(positionSnapshot);
    if (!positionSnapshot.exists) {
      throw new CreditCardApplicationError(
        "not_found",
        "Posição não encontrada.",
      );
    }
    if (link && current.goalId) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "A posição já está vinculada a uma meta.",
      );
    }
    if (!link && current.goalId !== payload.goalId) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "A posição não está vinculada à meta informada.",
      );
    }
    const sign = link ? 1 : -1;
    const next = {
      ...current,
      goalId: link ? payload.goalId : undefined,
      version: current.version + 1,
    };
    const movement = {
      id: movementId,
      workspaceId: auth.workspaceId,
      profileType: authorization.profileType,
      domainVersion: INVESTMENT_DOMAIN_VERSION,
      calculationVersion: INVESTMENT_CALCULATION_VERSION,
      accountId: payload.accountId,
      assetId: payload.assetId,
      positionId,
      operation: link ? "goal_link" : "goal_unlink",
      status: "settled",
      currency: "BRL",
      description: payload.reason,
      principalCents: 0,
      gainCents: 0,
      feesCents: 0,
      taxCents: 0,
      quantityMicros: 0,
      cashDeltaCents: 0,
      principalDeltaCents: 0,
      realizedGainDeltaCents: 0,
      feesDeltaCents: 0,
      taxDeltaCents: 0,
      quantityDeltaMicros: 0,
      goalNetContributionDeltaCents: sign * current.principalCents,
      goalCurrentValueDeltaCents: sign * current.currentValueCents,
      currentValueDeltaCents: 0,
      goalId: payload.goalId,
      correlationId: payload.correlationId,
      idempotencyKeyHash: reservation.keyHash,
      occurredAt,
      settlementAt: occurredAt,
      createdBy: auth.uid,
      createdAt: FieldValue.serverTimestamp(),
      settledBy: auth.uid,
      settledAt: FieldValue.serverTimestamp(),
    };
    transaction.create(refs.movement, assertInvestmentDocument("movement", movement, auth.workspaceId));
    writePosition(
      transaction,
      positionSnapshot,
      auth.workspaceId,
      authorization.profileType,
      payload.accountId,
      payload.assetId,
      next,
      movementId,
      occurredAt,
      auth.uid,
    );
    writeInvestmentAllocationProjections(
      transaction,
      auth.workspaceId,
      authorization.profileType,
      auth.uid,
      accountSnapshot.data() ?? {},
      assetSnapshot.data() ?? {},
      current,
      next,
      {
        previous: current.goalId === payload.goalId ?
          goalSnapshot.data()?.name as string | undefined : undefined,
        next: next.goalId === payload.goalId ?
          goalSnapshot.data()?.name as string | undefined : undefined,
      },
    );
    updateGoalProjection(
      transaction,
      goalSnapshot,
      movement.goalNetContributionDeltaCents,
      movement.goalCurrentValueDeltaCents,
      auth.uid,
    );
    const result = {
      success: true,
      movementId,
      positionId,
      goalId: payload.goalId,
      linked: link,
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
      "position",
      positionId,
      {goalId: payload.goalId, linked: link, reason: payload.reason},
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

/**
 * Troca a meta de uma posição num único limite atômico (INV-P2-028).
 *
 * "Alterar meta" **sempre falhava**: o formulário só oferecia a meta atual, e
 * `linkInvestmentToGoal` recusa posição já vinculada. Fazer as duas etapas
 * pelo cliente não resolve — uma falha entre elas deixa a posição sem meta e o
 * progresso das duas metas errado.
 *
 * A operação cria **dois** movimentos, `goal_unlink` e `goal_link`, com IDs
 * determinísticos derivados da mesma chave de idempotência. Nada é apagado, e
 * a trilha explica a troca em vez de mostrar um desvínculo solto.
 */
export const executeChangeInvestmentGoal = async (
  auth: WorkspaceAuthorizationContext,
  payload: ChangeInvestmentGoalPayload,
): Promise<Record<string, unknown>> => {
  const operation = "changeInvestmentGoal" as const;
  if (payload.goalId === payload.previousGoalId) {
    throw new CreditCardApplicationError(
      "invalid_payload",
      "A meta de destino precisa ser diferente da meta atual.",
    );
  }
  const occurredAt = assertNotFuture(
    parseTimestamp(payload.occurredAt),
    "occurredAt",
  );
  const positionId = investmentPositionId(payload.accountId, payload.assetId);
  const unlinkId = deterministicDocumentId(
    operation, auth.uid, payload.idempotencyKey, "unlink",
  );
  const linkId = deterministicDocumentId(
    operation, auth.uid, payload.idempotencyKey, "link",
  );

  return investmentFirestore().runTransaction(async (transaction) => {
    const authorization = await authorizeInvestmentTransaction(
      transaction,
      auth,
      investmentOperationRoles(operation),
    );
    const reservation = await reserveInvestmentIdempotency(
      transaction, auth, operation,
      payload.idempotencyKey, payload.correlationId, payload,
    );
    if (reservation.replay) return reservation.replay;

    const refs = {
      account: investmentDoc(
        auth.workspaceId, INVESTMENT_COLLECTIONS.accounts, payload.accountId,
      ),
      asset: investmentDoc(
        auth.workspaceId, INVESTMENT_COLLECTIONS.assets, payload.assetId,
      ),
      position: investmentDoc(
        auth.workspaceId, INVESTMENT_COLLECTIONS.positions, positionId,
      ),
      previousGoal: investmentGoalDoc(auth.workspaceId, payload.previousGoalId),
      nextGoal: investmentGoalDoc(auth.workspaceId, payload.goalId),
      unlink: investmentDoc(
        auth.workspaceId, INVESTMENT_COLLECTIONS.movements, unlinkId,
      ),
      link: investmentDoc(
        auth.workspaceId, INVESTMENT_COLLECTIONS.movements, linkId,
      ),
    };
    const [
      accountSnapshot, assetSnapshot, positionSnapshot,
      previousGoalSnapshot, nextGoalSnapshot,
      unlinkSnapshot, linkSnapshot,
    ] = await Promise.all([
      transaction.get(refs.account),
      transaction.get(refs.asset),
      transaction.get(refs.position),
      transaction.get(refs.previousGoal),
      transaction.get(refs.nextGoal),
      transaction.get(refs.unlink),
      transaction.get(refs.link),
    ]);

    ensureAccountAndAsset(
      accountSnapshot, assetSnapshot, auth.workspaceId,
      authorization.profileType, true,
    );
    assertWorkspaceDocument(previousGoalSnapshot, auth.workspaceId, "Meta");
    assertWorkspaceDocument(nextGoalSnapshot, auth.workspaceId, "Meta");
    if (unlinkSnapshot.exists || linkSnapshot.exists) {
      throw new CreditCardApplicationError(
        "idempotency_conflict",
        "Movimento já existente.",
      );
    }
    if (!positionSnapshot.exists) {
      throw new CreditCardApplicationError(
        "not_found",
        "Posição não encontrada.",
      );
    }
    const current = positionState(positionSnapshot);
    if (current.goalId !== payload.previousGoalId) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "A posição não está vinculada à meta informada como atual.",
      );
    }

    const next = {
      ...current,
      goalId: payload.goalId,
      version: current.version + 1,
    };
    const movementBase = {
      workspaceId: auth.workspaceId,
      profileType: authorization.profileType,
      domainVersion: INVESTMENT_DOMAIN_VERSION,
      calculationVersion: INVESTMENT_CALCULATION_VERSION,
      accountId: payload.accountId,
      assetId: payload.assetId,
      positionId,
      status: "settled",
      currency: "BRL",
      principalCents: 0,
      gainCents: 0,
      feesCents: 0,
      taxCents: 0,
      quantityMicros: 0,
      cashDeltaCents: 0,
      principalDeltaCents: 0,
      realizedGainDeltaCents: 0,
      feesDeltaCents: 0,
      taxDeltaCents: 0,
      quantityDeltaMicros: 0,
      currentValueDeltaCents: 0,
      correlationId: payload.correlationId,
      idempotencyKeyHash: reservation.keyHash,
      occurredAt,
      settlementAt: occurredAt,
      createdBy: auth.uid,
      createdAt: FieldValue.serverTimestamp(),
      settledBy: auth.uid,
      settledAt: FieldValue.serverTimestamp(),
    };
    const unlinkMovement = {
      ...movementBase,
      id: unlinkId,
      operation: "goal_unlink",
      description: `Troca de meta — saída: ${payload.reason}`,
      goalId: payload.previousGoalId,
      goalNetContributionDeltaCents: -current.principalCents,
      goalCurrentValueDeltaCents: -current.currentValueCents,
    };
    const linkMovement = {
      ...movementBase,
      id: linkId,
      operation: "goal_link",
      description: `Troca de meta — entrada: ${payload.reason}`,
      goalId: payload.goalId,
      goalNetContributionDeltaCents: current.principalCents,
      goalCurrentValueDeltaCents: current.currentValueCents,
    };
    transaction.create(refs.unlink, assertInvestmentDocument(
      "movement", unlinkMovement, auth.workspaceId,
    ));
    transaction.create(refs.link, assertInvestmentDocument(
      "movement", linkMovement, auth.workspaceId,
    ));
    writePosition(
      transaction, positionSnapshot, auth.workspaceId,
      authorization.profileType, payload.accountId, payload.assetId,
      next, linkId, occurredAt, auth.uid,
    );
    writeInvestmentAllocationProjections(
      transaction, auth.workspaceId, authorization.profileType, auth.uid,
      accountSnapshot.data() ?? {}, assetSnapshot.data() ?? {},
      current, next,
      {
        previous: previousGoalSnapshot.data()?.name as string | undefined,
        next: nextGoalSnapshot.data()?.name as string | undefined,
      },
    );
    updateGoalProjection(
      transaction, previousGoalSnapshot,
      unlinkMovement.goalNetContributionDeltaCents,
      unlinkMovement.goalCurrentValueDeltaCents,
      auth.uid,
    );
    updateGoalProjection(
      transaction, nextGoalSnapshot,
      linkMovement.goalNetContributionDeltaCents,
      linkMovement.goalCurrentValueDeltaCents,
      auth.uid,
    );
    const result = {
      success: true,
      positionId,
      unlinkMovementId: unlinkId,
      linkMovementId: linkId,
      previousGoalId: payload.previousGoalId,
      goalId: payload.goalId,
    };
    recordInvestmentOperationMetric(transaction, {
      workspaceId: auth.workspaceId,
      operation,
      actorId: auth.uid,
      goalId: payload.goalId,
      correlationId: payload.correlationId,
      idempotencyKey: payload.idempotencyKey,
    });
    recordInvestmentEvent(
      transaction, auth, authorization.role, authorization.profileType,
      operation, reservation, payload.correlationId,
      "position", positionId,
      {
        previousGoalId: payload.previousGoalId,
        goalId: payload.goalId,
        reason: payload.reason,
      },
    );
    completeInvestmentIdempotency(
      transaction, auth, operation, payload.correlationId, reservation, result,
    );
    return result;
  });
};

export const executeLinkInvestmentToGoal = (
  auth: WorkspaceAuthorizationContext,
  payload: LinkInvestmentToGoalPayload,
): Promise<Record<string, unknown>> =>
  executeGoalLinkChange(auth, payload, true);

export const executeUnlinkInvestmentFromGoal = (
  auth: WorkspaceAuthorizationContext,
  payload: UnlinkInvestmentFromGoalPayload,
): Promise<Record<string, unknown>> =>
  executeGoalLinkChange(auth, payload, false);

const executeArchive = async (
  auth: WorkspaceAuthorizationContext,
  payload: ArchiveInvestmentAccountPayload | ArchiveInvestmentAssetPayload,
  entityType: "account" | "asset",
): Promise<Record<string, unknown>> => {
  const operation =
    entityType === "account" ?
      ("archiveInvestmentAccount" as const) :
      ("archiveInvestmentAsset" as const);
  const collection =
    entityType === "account" ?
      INVESTMENT_COLLECTIONS.accounts :
      INVESTMENT_COLLECTIONS.assets;
  const entityId =
    entityType === "account" ?
      (payload as ArchiveInvestmentAccountPayload).accountId :
      (payload as ArchiveInvestmentAssetPayload).assetId;
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
    const ref = investmentDoc(auth.workspaceId, collection, entityId);
    const snapshot = await transaction.get(ref);
    const current = assertWorkspaceDocument(
      snapshot,
      auth.workspaceId,
      entityType === "account" ?
        "Conta de investimento" :
        "Ativo de investimento",
    );
    if (current.status === "archived") {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        entityType === "account" ?
          "A conta já está arquivada." :
          "O ativo já está arquivado.",
      );
    }
    transaction.update(ref, {
      status: "archived",
      archivedBy: auth.uid,
      archivedAt: FieldValue.serverTimestamp(),
      archiveReason: payload.reason,
      updatedBy: auth.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    const result = {success: true, entityId, status: "archived"};
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
      entityType,
      entityId,
      {
        beforeStatus: current.status,
        afterStatus: "archived",
        reason: payload.reason,
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

export const executeArchiveInvestmentAccount = (
  auth: WorkspaceAuthorizationContext,
  payload: ArchiveInvestmentAccountPayload,
): Promise<Record<string, unknown>> => executeArchive(auth, payload, "account");

export const executeArchiveInvestmentAsset = (
  auth: WorkspaceAuthorizationContext,
  payload: ArchiveInvestmentAssetPayload,
): Promise<Record<string, unknown>> => executeArchive(auth, payload, "asset");

const executeSaveEntity = async (
  auth: WorkspaceAuthorizationContext,
  payload: SaveInvestmentAccountPayload | SaveInvestmentAssetPayload,
  entityType: "account" | "asset",
): Promise<Record<string, unknown>> => {
  const operation = entityType === "account" ?
    ("saveInvestmentAccount" as const) :
    ("saveInvestmentAsset" as const);
  const collection = entityType === "account" ?
    INVESTMENT_COLLECTIONS.accounts : INVESTMENT_COLLECTIONS.assets;
  const suppliedId = entityType === "account" ?
    (payload as SaveInvestmentAccountPayload).accountId :
    (payload as SaveInvestmentAssetPayload).assetId;
  const entityId = suppliedId ?? deterministicDocumentId(
    operation,
    auth.uid,
    payload.idempotencyKey,
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
    const ref = investmentDoc(auth.workspaceId, collection, entityId);
    const snapshot = await transaction.get(ref);
    const before = snapshot.data();
    if (snapshot.exists && before?.workspaceId !== auth.workspaceId) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "O registro não pertence ao workspace autorizado.",
      );
    }
    if (snapshot.exists && before?.status === "archived") {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        entityType === "account" ?
          "Uma conta inativada não pode ser editada." :
          "Um ativo inativado não pode ser editado.",
      );
    }
    if (entityType === "asset") {
      const assetPayload = payload as SaveInvestmentAssetPayload;
      const allocationPurpose = assetPayload.allocationPurpose ?? "unassigned";
      const allowedPurposes = authorization.profileType === "PJ" ?
        [
          "unassigned",
          "reserve",
          "financial_application",
          "reinvestment",
          "fixed_asset",
        ] : ["unassigned", "retirement", "goal"];
      if (!allowedPurposes.includes(allocationPurpose)) {
        throw new CreditCardApplicationError(
          "domain_precondition_failed",
          "A finalidade do ativo não é compatível com o contexto PF/PJ.",
        );
      }
      const classificationChanged = snapshot.exists && (
        before?.assetType !== assetPayload.assetType ||
        (before?.allocationPurpose ?? "unassigned") !==
          allocationPurpose
      );
      if (classificationChanged) {
        const position = await transaction.get(
          investmentCollection(
            auth.workspaceId,
            INVESTMENT_COLLECTIONS.positions,
          )
            .where("assetId", "==", entityId)
            .where("status", "==", "active")
            .limit(1),
        );
        if (!position.empty) {
          throw new CreditCardApplicationError(
            "domain_precondition_failed",
            "A classificação não pode mudar enquanto o ativo possui posição; " +
              "preserve o histórico e cadastre um novo ativo.",
          );
        }
      }
    }
    const mutable = entityType === "account" ? {
      name: payload.name,
      institutionName:
        (payload as SaveInvestmentAccountPayload).institutionName,
    } : {
      name: payload.name,
      ...((payload as SaveInvestmentAssetPayload).symbol ? {
        symbol: (payload as SaveInvestmentAssetPayload).symbol,
      } : {}),
      assetType: (payload as SaveInvestmentAssetPayload).assetType,
      allocationPurpose:
        (payload as SaveInvestmentAssetPayload).allocationPurpose ??
          "unassigned",
      // INV-P2-026 — classe, risco, liquidez e indexador.
      //
      // O par `id`/`name` é gravado junto de propósito: o ID vincula ao item
      // do catálogo do workspace e o nome fica fotografado no ativo, para que
      // renomear ou inativar o item não apague o rótulo histórico da faixa de
      // alocação já publicada.
      ...catalogClassification(payload as SaveInvestmentAssetPayload),
    };
    const common = {
      id: entityId,
      workspaceId: auth.workspaceId,
      profileType: authorization.profileType,
      currency: "BRL",
      status: "active",
      ...mutable,
      updatedBy: auth.uid,
      updatedAt: FieldValue.serverTimestamp(),
    };
    const existing = snapshot.data() ?? {};
    // Edição preserva os campos de criação; a validação roda sobre a visão
    // completa do documento resultante, não sobre o patch.
    const document = {
      ...common,
      createdBy: snapshot.exists ? String(existing.createdBy) : auth.uid,
      createdAt: snapshot.exists ?
        (existing.createdAt as Timestamp) :
        FieldValue.serverTimestamp(),
    };
    assertInvestmentDocument(entityType, document, auth.workspaceId);
    if (snapshot.exists) {
      transaction.update(ref, common);
    } else {
      transaction.create(ref, document);
    }
    const result = {success: true, entityId, created: !snapshot.exists};
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
      entityType,
      entityId,
      {created: !snapshot.exists, beforeName: before?.name ?? null},
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

/**
 * Campos de catálogo do ativo, omitindo os ausentes.
 *
 * Ausência é significativa: `allocationDescriptors` cai para a faixa
 * "Não informado" quando o campo não existe, e gravar `undefined` seria
 * rejeitado pelo Firestore.
 */
const catalogClassification = (
  payload: SaveInvestmentAssetPayload,
): Record<string, string> => {
  const entries: Array<[string, string | undefined]> = [
    ["classId", payload.classId],
    ["className", payload.className],
    ["riskId", payload.riskId],
    ["riskName", payload.riskName],
    ["liquidityId", payload.liquidityId],
    ["liquidityName", payload.liquidityName],
    ["indexerId", payload.indexerId],
    ["indexerName", payload.indexerName],
  ];
  return Object.fromEntries(
    entries.filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
};

export const executeSaveInvestmentAccount = (
  auth: WorkspaceAuthorizationContext,
  payload: SaveInvestmentAccountPayload,
): Promise<Record<string, unknown>> =>
  executeSaveEntity(auth, payload, "account");

export const executeSaveInvestmentAsset = (
  auth: WorkspaceAuthorizationContext,
  payload: SaveInvestmentAssetPayload,
): Promise<Record<string, unknown>> =>
  executeSaveEntity(auth, payload, "asset");

export const investmentIdempotencyKeyHash = (key: string): string =>
  sha256(key);

/**
 * Cancelamento de movimento pendente (M3.D).
 *
 * Antes do M3 um resgate `pending` não tinha nenhuma transição de saída:
 * `reverseInvestmentMovement` exige `settled` e o cancelamento legado do M2
 * atuava apenas sobre `transactions`. O resultado era uma obrigação aberta
 * permanente, invisível ao rebuild e sem saída operacional.
 *
 * Cancelar um pendente não apaga fato financeiro: todos os deltas já são zero
 * e o movimento não tocou posição, meta nem caixa. O documento é preservado
 * com `cancelledAt`/`cancelledBy`/motivo — não há hard delete.
 */
export const executeCancelInvestmentMovement = async (
  auth: WorkspaceAuthorizationContext,
  payload: CancelInvestmentMovementPayload,
): Promise<Record<string, unknown>> => {
  const operation = "cancelInvestmentMovement" as const;
  const occurredAt = parseTimestamp(payload.occurredAt);
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
    const movementRef = investmentDoc(
      auth.workspaceId,
      INVESTMENT_COLLECTIONS.movements,
      payload.movementId,
    );
    const movementSnapshot = await transaction.get(movementRef);
    const movement = assertWorkspaceDocument(
      movementSnapshot,
      auth.workspaceId,
      "Movimento de investimento",
    );
    if (movement.status === "cancelled") {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "Este movimento já está cancelado.",
      );
    }
    if (movement.status !== "pending") {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "Somente um movimento pendente pode ser cancelado. " +
          "Movimento liquidado exige estorno compensatório.",
      );
    }
    const cancellation = {
      status: "cancelled" as const,
      cancelledAt: FieldValue.serverTimestamp(),
      cancelledBy: auth.uid,
      cancellationReason: payload.reason,
      cancellationCorrelationId: payload.correlationId,
      updatedAt: FieldValue.serverTimestamp(),
    };
    const cancelledMovement = assertInvestmentDocument(
      "movement",
      {...movement, ...cancellation},
      auth.workspaceId,
    );
    transaction.update(movementRef, cancellation);
    if (typeof movement.transactionId === "string") {
      writeCashProjection(
        transaction,
        auth,
        authorization.profileType,
        cancelledMovement,
        movement.operation === "redemption" ? "redemption" : "contribution",
        "cancelled",
      );
    }
    const result = {
      success: true,
      movementId: payload.movementId,
      positionId: movement.positionId,
      transactionId: movement.transactionId,
      status: "cancelled",
    };
    recordInvestmentOperationMetric(transaction, {
      workspaceId: auth.workspaceId,
      operation,
      actorId: auth.uid,
      accountId: movement.accountId as string,
      assetId: movement.assetId as string,
      movementId: payload.movementId,
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
      "movement",
      payload.movementId,
      {
        positionId: movement.positionId,
        beforeStatus: "pending",
        afterStatus: "cancelled",
        occurredAt: occurredAt.toDate().toISOString(),
        reason: payload.reason,
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

/**
 * Marcação a mercado (M3.D).
 *
 * `investment_valuations` era lida pelo rebuild mas não tinha nenhum caminho
 * de escrita: `currentValueCents` nunca divergia de `principalCents`,
 * `unrealizedAppreciationCents` era sempre zero e `progressBasis:
 * 'current_value'` era indistinguível de `net_contributions`.
 *
 * Valoração altera patrimônio e **nunca** fluxo de caixa: não há movimento no
 * ledger, não há espelho em `transactions` e o custo (principal) permanece
 * intacto. Só o valor atual e a apreciação não realizada mudam.
 */
export const executeRecordInvestmentValuation = async (
  auth: WorkspaceAuthorizationContext,
  payload: RecordInvestmentValuationPayload,
): Promise<Record<string, unknown>> => {
  const operation = "recordInvestmentValuation" as const;
  const effectiveAt = assertNotFuture(
    parseTimestamp(payload.effectiveAt),
    "effectiveAt",
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
    const positionId = investmentPositionId(payload.accountId, payload.assetId);
    const refs = {
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
      position: investmentDoc(
        auth.workspaceId,
        INVESTMENT_COLLECTIONS.positions,
        positionId,
      ),
    };
    const [accountSnapshot, assetSnapshot, positionSnapshot] =
      await Promise.all([
        transaction.get(refs.account),
        transaction.get(refs.asset),
        transaction.get(refs.position),
      ]);
    ensureAccountAndAsset(
      accountSnapshot,
      assetSnapshot,
      auth.workspaceId,
      authorization.profileType,
      false,
    );
    if (!positionSnapshot.exists) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "Não existe posição para valorar nesta conta e ativo.",
      );
    }
    const current = positionState(positionSnapshot);
    if (current.quantityMicros <= 0) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "Posição sem quantidade não pode ser valorada.",
      );
    }
    if (
      current.valuationEffectiveAt &&
      current.valuationEffectiveAt.toMillis() > effectiveAt.toMillis()
    ) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "Já existe valoração mais recente para esta posição.",
      );
    }
    const valuationId = deterministicDocumentId(
      "valuation",
      auth.uid,
      payload.idempotencyKey,
    );
    const valuationRef = investmentDoc(
      auth.workspaceId,
      INVESTMENT_COLLECTIONS.valuations,
      valuationId,
    );
    const valuationSnapshot = await transaction.get(valuationRef);
    if (valuationSnapshot.exists) {
      throw new CreditCardApplicationError(
        "idempotency_conflict",
        "Esta valoração já foi registrada.",
      );
    }
    const currentValueCents = positionValueCents(
      current.quantityMicros,
      payload.unitPriceMicros,
    );
    const next: PositionState = {
      ...current,
      currentValueCents,
      valuationId,
      valuationUnitPriceMicros: payload.unitPriceMicros,
      valuationEffectiveAt: effectiveAt,
      version: current.version + 1,
    };
    const currentValueDeltaCents = addExact(
      currentValueCents,
      -current.currentValueCents,
      "currentValueDeltaCents",
    );
    const goalId = current.goalId;
    const goalSnapshot = goalId ?
      await transaction.get(investmentGoalDoc(auth.workspaceId, goalId)) :
      undefined;
    if (goalSnapshot) {
      assertWorkspaceDocument(goalSnapshot, auth.workspaceId, "Meta");
    }
    const periodContext = await readInvestmentPeriodContext(
      transaction,
      auth.workspaceId,
      effectiveAt,
    );
    transaction.create(
      valuationRef,
      assertInvestmentDocument("valuation", {
        id: valuationId,
        workspaceId: auth.workspaceId,
        profileType: authorization.profileType,
        // A valoração é gravada para a posição de uma conta específica, e é
        // essa posição que passa a carregar `valuationUnitPriceMicros`. Sem
        // `accountId` no documento, o rebuild — que busca a valoração só por
        // `assetId` — aplicava o preço a todas as posições do ativo e publicava
        // um patrimônio diferente do caminho incremental.
        accountId: payload.accountId,
        assetId: payload.assetId,
        currency: "BRL",
        unitPriceMicros: payload.unitPriceMicros,
        source: payload.source,
        effectiveAt,
        correlationId: payload.correlationId,
        createdBy: auth.uid,
        createdAt: FieldValue.serverTimestamp(),
      }, auth.workspaceId),
    );
    writePosition(
      transaction,
      positionSnapshot,
      auth.workspaceId,
      authorization.profileType,
      payload.accountId,
      payload.assetId,
      next,
      valuationId,
      effectiveAt,
      auth.uid,
    );
    writeInvestmentAllocationProjections(
      transaction,
      auth.workspaceId,
      authorization.profileType,
      auth.uid,
      accountSnapshot.data() ?? {},
      assetSnapshot.data() ?? {},
      current,
      next,
      {
        previous: goalSnapshot?.data()?.name as string | undefined,
        next: goalSnapshot?.data()?.name as string | undefined,
      },
    );
    writeInvestmentValuationReportPeriod(
      transaction,
      auth.workspaceId,
      authorization.profileType,
      auth.uid,
      effectiveAt,
      currentValueDeltaCents,
      periodContext,
    );
    // Valoração muda apenas o valor atual da meta; o aporte líquido
    // (`net_contributions`) permanece intacto.
    updateGoalProjection(
      transaction,
      goalSnapshot,
      0,
      goalId ? currentValueDeltaCents : 0,
      auth.uid,
    );
    const result = {
      success: true,
      valuationId,
      positionId,
      unitPriceMicros: payload.unitPriceMicros,
      currentValueCents,
      currentValueDeltaCents,
      unrealizedAppreciationCents: currentValueCents - next.principalCents,
    };
    recordInvestmentOperationMetric(transaction, {
      workspaceId: auth.workspaceId,
      operation,
      actorId: auth.uid,
      accountId: payload.accountId,
      assetId: payload.assetId,
      goalId,
      amountCents: currentValueDeltaCents,
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
      "position",
      positionId,
      {
        valuationId,
        unitPriceMicros: payload.unitPriceMicros,
        currentValueDeltaCents,
        cashDeltaCents: 0,
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

/**
 * Lote de importação (M3.C).
 *
 * `InvestmentImportBatch` existia como tipo e como bloco de Rules, sem
 * nenhum leitor, escritor ou contrato — entidade morta. O M3 decide
 * **implementar a ingestão** em vez de remover a entidade: o lote passa a ser
 * o registro de procedência de aportes importados, com ciclo de vida
 * explícito e contadores atualizados na mesma transação do aporte.
 */
export const executeRegisterInvestmentImportBatch = async (
  auth: WorkspaceAuthorizationContext,
  payload: RegisterInvestmentImportBatchPayload,
): Promise<Record<string, unknown>> => {
  const operation = "registerInvestmentImportBatch" as const;
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
    const batchId =
      payload.batchId ??
      deterministicDocumentId("import-batch", auth.uid, payload.idempotencyKey);
    const batchRef = investmentDoc(
      auth.workspaceId,
      INVESTMENT_COLLECTIONS.importBatches,
      batchId,
    );
    const batchSnapshot = await transaction.get(batchRef);
    const existing = batchSnapshot.exists ?
      assertWorkspaceDocument(
        batchSnapshot,
        auth.workspaceId,
        "Lote de importação",
      ) :
      undefined;
    if (existing && existing.status === "completed") {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "Lote de importação concluído não pode ser reaberto.",
      );
    }
    const document = assertInvestmentDocument("importBatch", {
      id: batchId,
      workspaceId: auth.workspaceId,
      profileType: authorization.profileType,
      status: payload.status,
      source: payload.source,
      processedCount: payload.processedCount,
      failedCount: payload.failedCount,
      correlationId: payload.correlationId,
      createdBy: existing ? String(existing.createdBy) : auth.uid,
      createdAt: existing ?
        (existing.createdAt as Timestamp) :
        FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      ...(payload.status === "completed" ?
        {completedAt: FieldValue.serverTimestamp()} :
        {}),
    }, auth.workspaceId);
    if (batchSnapshot.exists) {
      transaction.update(batchRef, {
        status: document.status,
        source: document.source,
        processedCount: document.processedCount,
        failedCount: document.failedCount,
        correlationId: document.correlationId,
        updatedAt: FieldValue.serverTimestamp(),
        ...(payload.status === "completed" ?
          {completedAt: FieldValue.serverTimestamp()} :
          {}),
      });
    } else {
      transaction.create(batchRef, document);
    }
    const result = {
      success: true,
      batchId,
      status: payload.status,
      created: !batchSnapshot.exists,
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
      "importBatch",
      batchId,
      {status: payload.status, source: payload.source},
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
