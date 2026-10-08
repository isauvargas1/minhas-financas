import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";

import {ApplicationError} from "../shared/errors";
import {
  reassertWorkspaceActor,
  type WorkspaceActor,
} from "../shared/workspaceAuth";
import {
  CONTRIBUTION_ACCOUNT_REQUIRED_MESSAGE,
  PENDING_ACCOUNT_FORBIDDEN_MESSAGE,
  WITHDRAWAL_ACCOUNT_REQUIRED_MESSAGE,
  type CancelInvestmentMovementPayload,
  type ChangeInvestmentGoalPayload,
  type CreateSimpleInvestmentPayload,
  type LinkInvestmentToGoalPayload,
  type ReverseInvestmentMovementPayload,
  type SettleInvestmentContributionPayload,
  type SettleSimpleWithdrawalPayload,
  type UnlinkInvestmentFromGoalPayload,
  type WithdrawSimpleInvestmentPayload,
} from "./contracts";
import {
  investmentCashDate,
  investmentCashEntryFor,
  postInvestmentAccountMovement,
  postInvestmentReversalAccountMovement,
  prepareInvestmentCashAccount,
  prepareInvestmentReversalAccount,
  writeInvestmentCashMirror,
} from "./cash";
import {
  INVESTMENT_CALCULATION_VERSION,
  INVESTMENT_DOMAIN_VERSION,
} from "./domain";
import {assertInvestmentDocument} from "./documentContracts";
import {recordInvestmentOperationMetric} from "./observability";
import {investmentOperationRoles} from "./writeStrategy";
import {
  assertNotBefore,
  assertNotFuture,
  assertWorkspaceDocument,
  completeInvestmentIdempotency,
  deterministicDocumentId,
  investmentPositionId,
  parseTimestamp,
  profileTypeFromWorkspace,
  recordInvestmentEvent,
  reserveInvestmentIdempotency,
  sha256,
} from "./infrastructure";
import {addExact, negateExact} from "./math";
import {
  assetTypeForCatalogItemId,
  INVESTMENT_CATEGORY_SELECTOR,
  INVESTMENT_CLASS_SELECTOR,
  INVESTMENT_INSTITUTION_SELECTOR,
  institutionAccountId,
  isValueModeAsset,
  movementPresentationSnapshot,
  resolveInvestmentCatalogItem,
  valueModeQuantityMicros,
} from "./simpleMode";
import {
  readInvestmentPeriodContext,
  writeInvestmentAllocationProjections,
  writeInvestmentReportPeriod,
} from "./reporting";
import {
  INVESTMENT_COLLECTIONS,
  investmentDoc,
  investmentFirestore,
  investmentGoalDoc,
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
    throw new ApplicationError(
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
    throw new ApplicationError(
      "domain_precondition_failed",
      "Ao zerar a quantidade da posição, o custo resgatado precisa ser o " +
        "custo total. Lance a diferença como perda realizada.",
    );
  }
  // Regime por valor (D-15): sem valoração a mercado, o valor atual é o
  // capital aplicado.
  const currentValueCents = principalCents;
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
    throw new ApplicationError(
      "domain_precondition_failed",
      "Conta e ativo precisam usar a moeda BRL neste domínio.",
    );
  }
  if (
    account.profileType !== profileType ||
    asset.profileType !== profileType
  ) {
    throw new ApplicationError(
      "domain_precondition_failed",
      "Conta e ativo não pertencem ao contexto PF/PJ do workspace.",
    );
  }
  if (
    requireActive &&
    (account.status !== "active" || asset.status !== "active")
  ) {
    throw new ApplicationError(
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
    throw new ApplicationError(
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
      },
      {merge: true},
    );
  } else {
    transaction.create(snapshot.ref, {
      ...data,
      ...(state.goalId ? {goalId: state.goalId} : {}),
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

export const executeReverseInvestmentMovement = async (
  auth: WorkspaceActor,
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
    const access = await reassertWorkspaceActor(
      transaction,
      auth,
      investmentOperationRoles(operation),
    );
    const authorization = {
      role: access.role,
      profileType: profileTypeFromWorkspace(access.workspace),
    };
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
      throw new ApplicationError(
        "domain_precondition_failed",
        "Somente um aporte ou resgate liquidado pode ser estornado.",
      );
    }
    if (original.reversedByMovementId || reversalSnapshot.exists) {
      throw new ApplicationError(
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
      throw new ApplicationError(
        "not_found",
        "Posição não encontrada.",
      );
    }
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
    /*
     * D-30 (P4-D): o estorno compensa o movimento de conta do original, na
     * **mesma** conta — o usuário não escolhe outra. Conta arquivada recusa a
     * compensação (reative-a antes), como em todo o livro-razão.
     */
    const reversalAccount = await prepareInvestmentReversalAccount(
      transaction,
      auth.workspaceId,
      original,
    );
    const accountMovementId = postInvestmentReversalAccountMovement(
      transaction,
      reversalAccount,
      {
        workspaceId: auth.workspaceId,
        actorUid: auth.uid,
        operation,
        requestId: payload.correlationId,
        reversalMovementId: reversalId,
        effectiveDate: investmentCashDate({occurredAt: reversedAt}),
      },
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
      cashAccountId: reversalAccount.movement.accountId,
      accountMovementId,
      // A fotografia de apresentação acompanha o estorno: ele aparece na mesma
      // listagem, e reler o cadastro atual mostraria um rótulo que talvez não
      // fosse o do movimento estornado.
      ...movementPresentationSnapshot(
        accountSnapshot.data(),
        assetSnapshot.data(),
      ),
      transactionId: projectionId,
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
    writeInvestmentCashMirror(
      transaction,
      auth,
      authorization.profileType,
      reversal,
      investmentCashEntryFor(reversal, {
        operation: original.operation,
        status: "settled",
      }),
      {cashAccountId: reversal.cashAccountId, accountMovementId},
    );
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
  auth: WorkspaceActor,
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
  /*
   * INV-P2-022 — vincular ou desvincular não é agendável: a interface envia o
   * instante da própria ação (`intent.occurredAt()`) e o vínculo move o
   * progresso da meta imediatamente. O `occurredAt` vira `occurredAt` e
   * `settlementAt` do movimento e é o carimbo que `writePosition` grava, então
   * uma data futura abriria o período do mês futuro e deslocaria o
   * `lastMovementAt` da posição. `changeInvestmentGoal`, que emite exatamente
   * este par de movimentos, já recusa data futura — a guarda aqui fecha a
   * assimetria entre os dois caminhos.
   */
  const occurredAt = assertNotFuture(
    parseTimestamp(payload.occurredAt),
    "occurredAt",
  );
  return investmentFirestore().runTransaction(async (transaction) => {
    const access = await reassertWorkspaceActor(
      transaction,
      auth,
      investmentOperationRoles(operation),
    );
    const authorization = {
      role: access.role,
      profileType: profileTypeFromWorkspace(access.workspace),
    };
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
      throw new ApplicationError(
        "idempotency_conflict",
        "Movimento já existente.",
      );
    }
    const current = positionState(positionSnapshot);
    if (!positionSnapshot.exists) {
      throw new ApplicationError(
        "not_found",
        "Posição não encontrada.",
      );
    }
    if (link && current.goalId) {
      throw new ApplicationError(
        "domain_precondition_failed",
        "A posição já está vinculada a uma meta.",
      );
    }
    if (!link && current.goalId !== payload.goalId) {
      throw new ApplicationError(
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
  auth: WorkspaceActor,
  payload: ChangeInvestmentGoalPayload,
): Promise<Record<string, unknown>> => {
  const operation = "changeInvestmentGoal" as const;
  if (payload.goalId === payload.previousGoalId) {
    throw new ApplicationError(
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
    const access = await reassertWorkspaceActor(
      transaction,
      auth,
      investmentOperationRoles(operation),
    );
    const authorization = {
      role: access.role,
      profileType: profileTypeFromWorkspace(access.workspace),
    };
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
      throw new ApplicationError(
        "idempotency_conflict",
        "Movimento já existente.",
      );
    }
    if (!positionSnapshot.exists) {
      throw new ApplicationError(
        "not_found",
        "Posição não encontrada.",
      );
    }
    const current = positionState(positionSnapshot);
    if (current.goalId !== payload.previousGoalId) {
      throw new ApplicationError(
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
  auth: WorkspaceActor,
  payload: LinkInvestmentToGoalPayload,
): Promise<Record<string, unknown>> =>
  executeGoalLinkChange(auth, payload, true);

export const executeUnlinkInvestmentFromGoal = (
  auth: WorkspaceActor,
  payload: UnlinkInvestmentFromGoalPayload,
): Promise<Record<string, unknown>> =>
  executeGoalLinkChange(auth, payload, false);

/**
 * Conta do fato (D-30, P4-D), conferida também no executor — além do schema
 * da callable: liquidado exige a conta; pendente a recusa.
 */
const assertCashAccountForFact = (
  settled: boolean,
  cashAccountId: string | undefined,
  requiredMessage: string,
): void => {
  if (settled && !cashAccountId) {
    throw new ApplicationError("domain_precondition_failed", requiredMessage);
  }
  if (!settled && cashAccountId !== undefined) {
    throw new ApplicationError("domain_precondition_failed",
      PENDING_ACCOUNT_FORBIDDEN_MESSAGE);
  }
};

/** Ativo fora do regime por valor: nenhum fluxo do produto o grava. */
const INVESTMENT_OUT_OF_CONTRACT_MESSAGE =
  "Este investimento está fora do contrato e não pode ser movimentado.";

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
  auth: WorkspaceActor,
  payload: CancelInvestmentMovementPayload,
): Promise<Record<string, unknown>> => {
  const operation = "cancelInvestmentMovement" as const;
  /*
   * INV-P2-022 — não existe cancelamento agendado: a interface envia o
   * instante da ação e o efeito (`status: 'cancelled'`) é imediato. O
   * `occurredAt` é o carimbo que o log de evento publica como momento do
   * cancelamento, e aceitar futuro gravaria no histórico um cancelamento
   * datado depois do próprio `cancelledAt` do servidor.
   */
  const occurredAt = assertNotFuture(
    parseTimestamp(payload.occurredAt),
    "occurredAt",
  );
  return investmentFirestore().runTransaction(async (transaction) => {
    const access = await reassertWorkspaceActor(
      transaction,
      auth,
      investmentOperationRoles(operation),
    );
    const authorization = {
      role: access.role,
      profileType: profileTypeFromWorkspace(access.workspace),
    };
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
      throw new ApplicationError(
        "domain_precondition_failed",
        "Este movimento já está cancelado.",
      );
    }
    if (movement.status !== "pending") {
      throw new ApplicationError(
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
    // Pendente não moveu conta; o espelho passa a cancelado, com efeito zero.
    writeInvestmentCashMirror(
      transaction,
      auth,
      authorization.profileType,
      cancelledMovement,
      investmentCashEntryFor(cancelledMovement, {
        operation: movement.operation === "redemption" ?
          "redemption" : "contribution",
        status: "cancelled",
      }),
      null,
    );
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

export const executeSettleInvestmentContribution = async (
  auth: WorkspaceActor,
  payload: SettleInvestmentContributionPayload,
): Promise<Record<string, unknown>> => {
  const operation = "settleInvestmentContribution" as const;
  const settledAt = assertNotFuture(
    parseTimestamp(payload.settledAt),
    "settledAt",
  );
  return investmentFirestore().runTransaction(async (transaction) => {
    const access = await reassertWorkspaceActor(
      transaction,
      auth,
      investmentOperationRoles(operation),
    );
    const authorization = {
      role: access.role,
      profileType: profileTypeFromWorkspace(access.workspace),
    };
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
      "Aporte",
    );
    /*
     * Segunda liquidação é impossível por construção: o movimento já não está
     * `pending`. A idempotência cobre o retry da *mesma* intenção; esta guarda
     * cobre uma intenção nova sobre um aporte já liquidado.
     */
    if (
      movement.operation !== "contribution" ||
      movement.status !== "pending"
    ) {
      throw new ApplicationError(
        "domain_precondition_failed",
        "Somente um aporte pendente pode ser liquidado.",
      );
    }
    assertNotBefore(
      settledAt,
      movement.occurredAt as Timestamp,
      "settledAt",
      "ao registro do aporte",
    );
    const refs = {
      account: investmentDoc(
        auth.workspaceId,
        INVESTMENT_COLLECTIONS.accounts,
        String(movement.accountId),
      ),
      asset: investmentDoc(
        auth.workspaceId,
        INVESTMENT_COLLECTIONS.assets,
        String(movement.assetId),
      ),
      position: investmentDoc(
        auth.workspaceId,
        INVESTMENT_COLLECTIONS.positions,
        String(movement.positionId),
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
      true,
    );
    const current = positionState(positionSnapshot);
    /*
     * As guardas de meta são reavaliadas aqui, e não só na criação: entre o
     * registro do aporte e a liquidação a posição pode ter sido vinculada a
     * outra meta, e aplicar o progresso na meta errada é irreversível sem
     * estorno.
     */
    const intendedGoalId = typeof movement.goalId === "string" ?
      movement.goalId :
      undefined;
    if (current.goalId && intendedGoalId && current.goalId !== intendedGoalId) {
      throw new ApplicationError(
        "domain_precondition_failed",
        "A posição já está vinculada a outra meta.",
      );
    }
    if (!current.goalId && intendedGoalId && current.principalCents > 0) {
      throw new ApplicationError(
        "domain_precondition_failed",
        "Use a operação de vínculo para associar uma posição já existente.",
      );
    }
    const goalId = current.goalId ?? intendedGoalId;
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
    // D-30 (P4-D): a conta de onde o dinheiro saiu, ativa no workspace.
    const cashAccounts = await prepareInvestmentCashAccount(
      transaction,
      auth.workspaceId,
      payload.cashAccountId,
    );
    const principalCents = integerOrZero(movement.principalCents);
    const feesCents = integerOrZero(movement.feesCents);
    const taxCents = integerOrZero(movement.taxCents);
    const quantityMicros = integerOrZero(movement.quantityMicros);
    const next = applyPositionDeltas(current, {
      quantityMicros,
      principalCents,
      realizedGainCents: 0,
      feesCents,
      taxCents,
    });
    next.goalId = goalId;
    const cashOutCents = addExact(
      addExact(principalCents, feesCents, "cashOutCents"),
      taxCents,
      "cashOutCents",
    );
    const currentValueDeltaCents =
      next.currentValueCents - current.currentValueCents;
    const cashDeltaCents = negateExact(cashOutCents, "cashDeltaCents");
    const accountMovementId = postInvestmentAccountMovement(
      transaction,
      cashAccounts,
      {
        workspaceId: auth.workspaceId,
        actorUid: auth.uid,
        operation,
        requestId: payload.correlationId,
        investmentMovementId: payload.movementId,
        cashAccountId: payload.cashAccountId,
        amountCents: cashDeltaCents,
        effectiveDate: investmentCashDate({
          occurredAt: movement.occurredAt as Timestamp,
          settlementAt: settledAt,
        }),
      },
    );
    const settledMovement = {
      ...movement,
      status: "settled",
      cashDeltaCents,
      principalDeltaCents: principalCents,
      realizedGainDeltaCents: 0,
      feesDeltaCents: feesCents,
      taxDeltaCents: taxCents,
      quantityDeltaMicros: quantityMicros,
      goalNetContributionDeltaCents: goalId ? principalCents : 0,
      goalCurrentValueDeltaCents: goalId ? currentValueDeltaCents : 0,
      currentValueDeltaCents,
      ...(goalId ? {goalId} : {}),
      cashAccountId: payload.cashAccountId,
      accountMovementId,
      settlementAt: settledAt,
      settledBy: auth.uid,
      settledAt: FieldValue.serverTimestamp(),
      settlementCorrelationId: payload.correlationId,
      updatedAt: FieldValue.serverTimestamp(),
    };
    // O documento resultante é validado inteiro, e não só o patch: é a mesma
    // verificação que as Rules fazem na leitura.
    assertInvestmentDocument("movement", settledMovement, auth.workspaceId);
    transaction.update(movementRef, {
      status: settledMovement.status,
      cashDeltaCents: settledMovement.cashDeltaCents,
      principalDeltaCents: settledMovement.principalDeltaCents,
      realizedGainDeltaCents: settledMovement.realizedGainDeltaCents,
      feesDeltaCents: settledMovement.feesDeltaCents,
      taxDeltaCents: settledMovement.taxDeltaCents,
      quantityDeltaMicros: settledMovement.quantityDeltaMicros,
      goalNetContributionDeltaCents:
        settledMovement.goalNetContributionDeltaCents,
      goalCurrentValueDeltaCents: settledMovement.goalCurrentValueDeltaCents,
      currentValueDeltaCents: settledMovement.currentValueDeltaCents,
      ...(goalId ? {goalId} : {}),
      cashAccountId: payload.cashAccountId,
      accountMovementId,
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
      String(movement.accountId),
      String(movement.assetId),
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
      {next: goalSnapshot?.data()?.name as string | undefined},
    );
    writeInvestmentReportPeriod(
      transaction,
      auth.workspaceId,
      authorization.profileType,
      auth.uid,
      settledAt,
      {
        operation: "contribution",
        principalCents,
        gainCents: 0,
        feesCents,
        taxCents,
        cashDeltaCents: settledMovement.cashDeltaCents,
        currentValueDeltaCents,
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
    writeInvestmentCashMirror(
      transaction,
      auth,
      authorization.profileType,
      settledMovement,
      investmentCashEntryFor(settledMovement, {
        operation: "contribution",
        status: "settled",
      }),
      {cashAccountId: payload.cashAccountId, accountMovementId},
    );
    const result = {
      success: true,
      movementId: payload.movementId,
      positionId: String(movement.positionId),
      transactionId: movement.transactionId,
      accountMovementId,
      status: "settled",
      cashDeltaCents: settledMovement.cashDeltaCents,
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
      payload.movementId,
      {
        positionId: String(movement.positionId),
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

/**
 * Aporte pendente que uma correção substitui, já validado.
 *
 * Só o que a substituição precisa: a referência para o cancelamento, o
 * documento lido — que é a base do documento cancelado — e a categoria à qual
 * ele já está vinculado, que é a única inatividade tolerável na resolução do
 * catálogo.
 */
interface ReplacedPendingContribution {
  ref: admin.firestore.DocumentReference;
  data: admin.firestore.DocumentData;
  /** `typeId` fotografado no movimento. Ausente em movimento sem fotografia. */
  typeId?: string;
}

/**
 * Lê e valida o pendente que a correção vai substituir (§11).
 *
 * Autoridade é do servidor, e a lista é fechada: o documento existe, está no
 * workspace autorizado, é um **aporte**, ainda está `pending` e pertence ao
 * mesmo contexto PF/PJ. Nada aqui confia no que a interface afirmou — ela
 * envia um identificador, e só.
 *
 * O que **não** está aqui, de propósito: nenhuma tolerância a movimento
 * liquidado. Corrigir um lançamento já depositado continua exigindo estorno
 * compensatório, que é operação própria e mexe em posição, meta e caixa.
 */
const readReplacedPendingContribution = async (
  transaction: admin.firestore.Transaction,
  auth: WorkspaceActor,
  profileType: "PF" | "PJ",
  movementId: string,
): Promise<ReplacedPendingContribution> => {
  const ref = investmentDoc(
    auth.workspaceId,
    INVESTMENT_COLLECTIONS.movements,
    movementId,
  );
  const snapshot = await transaction.get(ref);
  const data = assertWorkspaceDocument(
    snapshot,
    auth.workspaceId,
    "Movimento de investimento",
  );
  if (data.operation !== "contribution") {
    throw new ApplicationError(
      "domain_precondition_failed",
      "Somente um aporte pode ser corrigido por substituição.",
    );
  }
  if (data.status === "cancelled") {
    throw new ApplicationError(
      "domain_precondition_failed",
      "Este lançamento já foi cancelado. Atualize a lista antes de corrigi-lo.",
    );
  }
  if (data.status !== "pending") {
    throw new ApplicationError(
      "domain_precondition_failed",
      "Somente um lançamento pendente pode ser corrigido. " +
        "Lançamento já depositado exige estorno compensatório.",
    );
  }
  if (data.profileType !== profileType) {
    throw new ApplicationError(
      "domain_precondition_failed",
      "O lançamento não pertence ao contexto PF/PJ do workspace.",
    );
  }
  return {
    ref,
    data,
    typeId: typeof data.typeId === "string" ? data.typeId : undefined,
  };
};

/**
 * Novo investimento no modo simples (Etapa 1, §§1-4 e 6-7).
 *
 * A operação cobre, numa transação só: resolver instituição, carteira e
 * categoria no catálogo do workspace; garantir a conta técnica da
 * instituição; criar o ativo técnico **próprio deste investimento**; e
 * registrar o primeiro aporte, liquidado ou pendente.
 *
 * ## Identidade
 *
 * O ativo nasce com identidade própria derivada da **intenção**
 * (`operation:uid:idempotencyKey`), nunca de texto. Dois comandos distintos
 * com a mesma descrição criam dois investimentos distintos — que é o
 * comportamento correto: "Tesouro Selic" na corretora A e na corretora B são
 * duas coisas. Retry e duplo clique repetem a mesma chave e, portanto, o
 * mesmo identificador, e a reserva de idempotência devolve o resultado
 * anterior sem escrever nada.
 *
 * A conta, ao contrário, é **compartilhada por instituição**: o identificador
 * deriva do ID do item de catálogo, que é estável. Renomear "BTG" para
 * "BTG Pactual" continua apontando para a mesma conta e para o mesmo
 * histórico.
 *
 * ## Correção de um pendente (`replacesMovementId`)
 *
 * Corrigir um aporte pendente é cancelar a intenção anterior e abrir outra —
 * nunca editar um fato financeiro no lugar. O que mudou é que as duas metades
 * acontecem **nesta** transação, e não em duas callables encadeadas pela
 * interface.
 *
 * A ordem anterior — cancelar, depois criar — tinha um estado parcial
 * alcançável: o cancelamento respondia, a criação era recusada, e o usuário
 * perdia o pendente por ter tentado corrigir a descrição. A ordem inversa
 * seria pior: uma falha no cancelamento deixaria **dois** pendentes vivos
 * para o mesmo dinheiro. Não existe ordem segura entre duas transações
 * independentes; existe uma transação só.
 *
 * Por isso a substituição não é uma segunda arquitetura de edição: é a mesma
 * criação de sempre, com o cancelamento do antecessor amarrado ao mesmo
 * commit. Ou os dois valem, ou nenhum — e uma edição recusada devolve o
 * pendente original intacto, com os mesmos efeitos zero que ele já tinha.
 */
export const executeCreateSimpleInvestment = async (
  auth: WorkspaceActor,
  payload: CreateSimpleInvestmentPayload,
): Promise<Record<string, unknown>> => {
  const operation = "createSimpleInvestment" as const;
  const movementId = deterministicDocumentId(
    operation,
    auth.uid,
    payload.idempotencyKey,
  );
  const assetId = deterministicDocumentId(
    `${operation}:asset`,
    auth.uid,
    payload.idempotencyKey,
  );
  const projectionId = `investment_${movementId}`;
  const occurredAt = assertNotFuture(
    parseTimestamp(payload.occurredAt),
    "occurredAt",
  );
  const settled = payload.settled !== false;
  assertCashAccountForFact(settled, payload.cashAccountId,
    CONTRIBUTION_ACCOUNT_REQUIRED_MESSAGE);
  return investmentFirestore().runTransaction(async (transaction) => {
    const access = await reassertWorkspaceActor(
      transaction,
      auth,
      investmentOperationRoles(operation),
    );
    const authorization = {
      role: access.role,
      profileType: profileTypeFromWorkspace(access.workspace),
    };
    const reservation = await reserveInvestmentIdempotency(
      transaction,
      auth,
      operation,
      payload.idempotencyKey,
      payload.correlationId,
      payload,
    );
    if (reservation.replay) return reservation.replay;
    /*
     * O antecessor é lido **antes** do catálogo porque é ele quem autoriza a
     * única exceção de categoria inativa que existe: a do vínculo que o
     * próprio pendente já tem.
     */
    const replaced = payload.replacesMovementId ?
      await readReplacedPendingContribution(
        transaction,
        auth,
        authorization.profileType,
        payload.replacesMovementId,
      ) :
      undefined;
    const [institution, portfolio, category] = await Promise.all([
      resolveInvestmentCatalogItem(
        transaction,
        auth.workspaceId,
        INVESTMENT_INSTITUTION_SELECTOR,
        payload.institutionId,
      ),
      resolveInvestmentCatalogItem(
        transaction,
        auth.workspaceId,
        INVESTMENT_CLASS_SELECTOR,
        payload.classId,
      ),
      /*
       * A categoria vem de `category`/`investimento`, o cadastro que o usuário
       * administra em Configurações › Cadastros › Categorias › Investimentos.
       */
      resolveInvestmentCatalogItem(
        transaction,
        auth.workspaceId,
        INVESTMENT_CATEGORY_SELECTOR,
        payload.typeId,
        /*
         * A categoria inativada depois do lançamento continua servindo ao
         * pendente que já a usa — e só a ele. A tolerância exige que o
         * identificador enviado seja **exatamente** o que o movimento
         * substituído carrega: trocar para outra categoria, inativa ou não,
         * volta a passar pela regra normal, que exige cadastro ativo. Um
         * lançamento novo nunca chega aqui com `replaced` definido.
         */
        replaced?.typeId === payload.typeId ?
          {preservedInactiveItemId: replaced.typeId} :
          undefined,
      ),
    ]);
    const accountId = institutionAccountId(auth.workspaceId, institution.id);
    const positionId = investmentPositionId(accountId, assetId);
    const refs = {
      account: investmentDoc(
        auth.workspaceId,
        INVESTMENT_COLLECTIONS.accounts,
        accountId,
      ),
      asset: investmentDoc(
        auth.workspaceId,
        INVESTMENT_COLLECTIONS.assets,
        assetId,
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
    if (
      assetSnapshot.exists ||
      movementSnapshot.exists ||
      positionSnapshot.exists
    ) {
      throw new ApplicationError(
        "idempotency_conflict",
        "Investimento já existente.",
      );
    }
    const goalSnapshot = payload.goalId ?
      await transaction.get(
        investmentGoalDoc(auth.workspaceId, payload.goalId),
      ) :
      undefined;
    if (goalSnapshot) {
      assertWorkspaceDocument(goalSnapshot, auth.workspaceId, "Meta");
    }
    const periodContext = settled ?
      await readInvestmentPeriodContext(
        transaction,
        auth.workspaceId,
        occurredAt,
      ) :
      undefined;
    // D-30 (P4-D): o aporte depositado sai da conta escolhida, ativa no
    // workspace. O pendente não move conta.
    const cashAccounts = settled ?
      await prepareInvestmentCashAccount(
        transaction,
        auth.workspaceId,
        String(payload.cashAccountId),
      ) :
      undefined;

    const accountBefore = accountSnapshot.data();
    if (accountSnapshot.exists) {
      if (accountBefore?.workspaceId !== auth.workspaceId) {
        throw new ApplicationError(
          "domain_precondition_failed",
          "A conta da instituição não pertence ao workspace autorizado.",
        );
      }
      if (accountBefore?.status !== "active") {
        throw new ApplicationError(
          "domain_precondition_failed",
          "A conta desta instituição está inativa e não aceita um novo " +
            "investimento.",
        );
      }
      if (accountBefore?.profileType !== authorization.profileType) {
        throw new ApplicationError(
          "domain_precondition_failed",
          "A conta da instituição não pertence ao contexto PF/PJ do " +
            "workspace.",
        );
      }
    }
    /*
     * O rótulo da conta acompanha o cadastro; a identidade, não. Renomear a
     * instituição atualiza o nome exibido nas faixas de alocação sem criar
     * conta nova e sem tocar em nenhum movimento já gravado — que carrega a
     * própria fotografia do nome no instante em que foi escrito.
     */
    const accountDocument = {
      id: accountId,
      workspaceId: auth.workspaceId,
      profileType: authorization.profileType,
      name: institution.name,
      institutionName: institution.name,
      institutionId: institution.id,
      currency: "BRL",
      status: "active",
      createdBy: accountSnapshot.exists ?
        String(accountBefore?.createdBy) :
        auth.uid,
      createdAt: accountSnapshot.exists ?
        (accountBefore?.createdAt as Timestamp) :
        FieldValue.serverTimestamp(),
      updatedBy: auth.uid,
      updatedAt: FieldValue.serverTimestamp(),
    };
    assertInvestmentDocument("account", accountDocument, auth.workspaceId);
    if (!accountSnapshot.exists) {
      transaction.create(refs.account, accountDocument);
    } else if (
      accountBefore?.institutionName !== institution.name ||
      accountBefore?.name !== institution.name ||
      accountBefore?.institutionId !== institution.id
    ) {
      transaction.update(refs.account, {
        name: institution.name,
        institutionName: institution.name,
        institutionId: institution.id,
        updatedBy: auth.uid,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    /*
     * `allocationPurpose` é obrigatório no documento e o conjunto válido
     * difere entre PF e PJ. Nada é presumido: sem meta vinculada o ativo fica
     * explicitamente "não classificado", que é o diagnóstico que a faixa de
     * alocação precisa mostrar.
     */
    const allocationPurpose =
      authorization.profileType === "PF" && payload.goalId ?
        "goal" :
        "unassigned";
    const assetDocument = {
      id: assetId,
      workspaceId: auth.workspaceId,
      profileType: authorization.profileType,
      name: payload.description,
      // Classificação técnica derivada do **identificador** da categoria, e
      // nunca do rótulo: renomear a categoria não reclassifica o ativo.
      assetType: assetTypeForCatalogItemId(category.id),
      allocationPurpose,
      classId: portfolio.id,
      className: portfolio.name,
      typeId: category.id,
      typeName: category.name,
      trackingMode: "value",
      currency: "BRL",
      status: "active",
      createdBy: auth.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedBy: auth.uid,
      updatedAt: FieldValue.serverTimestamp(),
    };
    transaction.create(
      refs.asset,
      assertInvestmentDocument("asset", assetDocument, auth.workspaceId),
    );

    const goalId = payload.goalId;
    const quantityMicros = valueModeQuantityMicros(payload.valueCents);
    const current = positionState(positionSnapshot);
    const next = settled ?
      applyPositionDeltas(current, {
        quantityMicros,
        principalCents: payload.valueCents,
        realizedGainCents: 0,
        feesCents: 0,
        taxCents: 0,
      }) :
      current;
    if (settled) next.goalId = goalId;
    const currentValueDeltaCents =
      next.currentValueCents - current.currentValueCents;
    const effects = settled ?
      {
        cashDeltaCents: negateExact(payload.valueCents, "cashDeltaCents"),
        principalDeltaCents: payload.valueCents,
        quantityDeltaMicros: quantityMicros,
        goalNetContributionDeltaCents: goalId ? payload.valueCents : 0,
        goalCurrentValueDeltaCents: goalId ? currentValueDeltaCents : 0,
        currentValueDeltaCents,
      } :
      {
        cashDeltaCents: 0,
        principalDeltaCents: 0,
        quantityDeltaMicros: 0,
        goalNetContributionDeltaCents: 0,
        goalCurrentValueDeltaCents: 0,
        currentValueDeltaCents: 0,
      };
    const accountMovementId = cashAccounts ?
      postInvestmentAccountMovement(transaction, cashAccounts, {
        workspaceId: auth.workspaceId,
        actorUid: auth.uid,
        operation,
        requestId: payload.correlationId,
        investmentMovementId: movementId,
        cashAccountId: String(payload.cashAccountId),
        amountCents: effects.cashDeltaCents,
        effectiveDate: investmentCashDate({occurredAt, settlementAt: occurredAt}),
      }) :
      undefined;
    const movement = {
      id: movementId,
      workspaceId: auth.workspaceId,
      profileType: authorization.profileType,
      domainVersion: INVESTMENT_DOMAIN_VERSION,
      calculationVersion: INVESTMENT_CALCULATION_VERSION,
      accountId,
      assetId,
      positionId,
      operation: "contribution",
      status: settled ? "settled" : "pending",
      currency: "BRL",
      description: payload.description,
      principalCents: payload.valueCents,
      gainCents: 0,
      // Modo simples é controle de capital: nada de taxa ou imposto
      // inventado para preencher schema.
      feesCents: 0,
      taxCents: 0,
      quantityMicros,
      realizedGainDeltaCents: 0,
      feesDeltaCents: 0,
      taxDeltaCents: 0,
      ...effects,
      ...(goalId ? {goalId} : {}),
      ...(accountMovementId ?
        {cashAccountId: String(payload.cashAccountId), accountMovementId} :
        {}),
      ...movementPresentationSnapshot(accountDocument, assetDocument),
      transactionId: projectionId,
      correlationId: payload.correlationId,
      idempotencyKeyHash: reservation.keyHash,
      occurredAt,
      ...(settled ?
        {
          settlementAt: occurredAt,
          settledBy: auth.uid,
          settledAt: FieldValue.serverTimestamp(),
        } :
        {}),
      createdBy: auth.uid,
      createdAt: FieldValue.serverTimestamp(),
    };
    transaction.create(
      refs.movement,
      assertInvestmentDocument("movement", movement, auth.workspaceId),
    );
    /*
     * O antecessor é aposentado no mesmo commit que cria o substituto.
     *
     * É exatamente o cancelamento de `executeCancelInvestmentMovement` —
     * mesmos campos, mesma preservação do documento, mesmo espelho reescrito
     * como cancelado. Nada de hard delete e nada de estado intermediário
     * visível: um leitor concorrente vê ou o pendente antigo sozinho, ou o
     * novo pendente com o antigo já cancelado.
     */
    if (replaced) {
      const cancellation = {
        status: "cancelled" as const,
        cancelledAt: FieldValue.serverTimestamp(),
        cancelledBy: auth.uid,
        cancellationReason:
          "Substituído pela correção do lançamento pendente " +
          `(movimento ${movementId}).`,
        cancellationCorrelationId: payload.correlationId,
        updatedAt: FieldValue.serverTimestamp(),
      };
      const cancelledMovement = assertInvestmentDocument(
        "movement",
        {...replaced.data, ...cancellation},
        auth.workspaceId,
      );
      transaction.update(replaced.ref, cancellation);
      writeInvestmentCashMirror(
        transaction,
        auth,
        authorization.profileType,
        cancelledMovement,
        investmentCashEntryFor(cancelledMovement, {
          operation: "contribution",
          status: "cancelled",
        }),
        null,
      );
    }
    if (settled && periodContext) {
      writePosition(
        transaction,
        positionSnapshot,
        auth.workspaceId,
        authorization.profileType,
        accountId,
        assetId,
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
        accountDocument,
        assetDocument,
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
          principalCents: payload.valueCents,
          gainCents: 0,
          feesCents: 0,
          taxCents: 0,
          cashDeltaCents: movement.cashDeltaCents,
          currentValueDeltaCents,
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
    }
    writeInvestmentCashMirror(
      transaction,
      auth,
      authorization.profileType,
      movement,
      investmentCashEntryFor(movement, {
        operation: "contribution",
        status: settled ? "settled" : "pending",
      }),
      accountMovementId ?
        {cashAccountId: String(payload.cashAccountId), accountMovementId} :
        null,
    );
    const result = {
      success: true,
      movementId,
      positionId,
      assetId,
      accountId,
      transactionId: projectionId,
      accountMovementId: accountMovementId ?? null,
      status: movement.status,
      cashDeltaCents: movement.cashDeltaCents,
      principalCents: next.principalCents,
      currentValueCents: next.currentValueCents,
      ...(replaced ? {replacedMovementId: replaced.ref.id} : {}),
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
        accountId,
        assetId,
        institutionId: institution.id,
        classId: portfolio.id,
        typeId: category.id,
        goalId: goalId ?? null,
        status: movement.status,
        // Trilha da substituição: o evento é o que amarra o cancelado ao
        // substituto sem inventar campo novo no contrato do movimento.
        ...(replaced ?
          {
            replacedMovementId: replaced.ref.id,
            replacedMovementStatus: "cancelled",
          } :
          {}),
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
 * Retirada no modo simples (Etapa 1, §8).
 *
 * Cobre os dois estados numa transação só. `received: false` grava o pedido
 * como pendente, com todos os deltas em zero — nenhum efeito em caixa,
 * posição ou meta. `received: true` grava o resgate já liquidado.
 *
 * ## Por que não passa por `settleInvestmentRedemption`
 *
 * Aquela operação existe para liquidar um pedido informando **quanto** de
 * ganho, perda, taxa e imposto a liquidação teve. No modo simples esses
 * valores não existem: o usuário informa um valor e nada mais. Encadear as
 * duas callables tornaria a conclusão não atômica — um pendente órfão se a
 * segunda falhasse. A retirada simples é, portanto, uma entrada própria que
 * compõe exatamente os mesmos primitivos de projeção do resto do domínio.
 *
 * ## Limitação assumida
 *
 * O que sai da posição é **custo**, nunca rendimento: `gainCents`,
 * `lossCents`, `feesCents` e `taxCents` são zero por contrato, e o caixa
 * recebido é igual ao custo retirado. Um resgate acima do custo não pode ser
 * representado sem informação que a UX simples não coleta, e por isso é
 * recusado com erro de domínio — nunca estimado.
 */
interface SimpleWithdrawalComponents {
  /** Parcela de rendimento do total retirado. Zero quando não informada. */
  gainCents: number;
  /** Parcela de custo do total retirado. É o que reduz o capital investido. */
  principalCents: number;
  quantityMicros: number;
}

const negatedCents = (value: number, field: string): number =>
  value === 0 ? 0 : negateExact(value, field);

/**
 * Decompõe uma retirada simples em custo e rendimento.
 *
 * O usuário informa o **total retirado**. Sem `gainCents`, o comportamento é
 * conservador: o total inteiro é custo, e retirar acima do capital aplicado é
 * recusado — o sistema não adivinha rentabilidade. Com `gainCents`, o custo é
 * a diferença, e é só ele que sai da posição.
 *
 * A quantidade continua derivada do custo, nunca do total: é o custo que a
 * cota sintética representa. Numa retirada que zera o custo, a quantidade
 * inteira da posição é usada, o que garante o encerramento simultâneo exigido
 * por `applyPositionDeltas`.
 */
const simpleWithdrawalComponents = (
  current: PositionState,
  valueCents: number,
  suppliedGainCents: number | undefined,
): SimpleWithdrawalComponents => {
  const gainCents = suppliedGainCents ?? 0;
  if (!Number.isSafeInteger(gainCents) || gainCents < 0) {
    throw new ApplicationError(
      "domain_precondition_failed",
      "O rendimento informado precisa ser um valor não negativo.",
    );
  }
  const principalCents = addExact(
    valueCents,
    -gainCents,
    "principalCents",
  );
  if (principalCents < 0) {
    throw new ApplicationError(
      "domain_precondition_failed",
      "O rendimento informado não pode superar o valor total retirado.",
    );
  }
  if (principalCents > current.principalCents) {
    throw new ApplicationError(
      "domain_precondition_failed",
      "O capital retirado supera o capital investido disponível neste " +
        "investimento. Se parte do valor é rendimento, informe quanto: o " +
        "sistema não estima rentabilidade.",
    );
  }
  const isTotal =
    principalCents > 0 && principalCents === current.principalCents;
  const quantityMicros = isTotal ?
    current.quantityMicros :
    valueModeQuantityMicros(principalCents);
  if (quantityMicros > current.quantityMicros) {
    throw new ApplicationError(
      "domain_precondition_failed",
      "A retirada supera o saldo disponível na posição.",
    );
  }
  return {gainCents, principalCents, quantityMicros};
};

/**
 * Efeitos de uma retirada simples liquidada.
 *
 * O caixa recebe o total — custo mais rendimento. A posição perde só o custo,
 * e o rendimento vira ganho realizado, que é a mesma grandeza que
 * `settleInvestmentRedemption` publica. A meta é reduzida apenas pelo custo:
 * `investmentNetContributionCents` mede capital aportado, e rendimento
 * retirado nunca foi aporte.
 */
const simpleWithdrawalSettledEffects = (
  components: SimpleWithdrawalComponents,
  currentValueDeltaCents: number,
  goalId: string | undefined,
) => ({
  cashDeltaCents: addExact(
    components.principalCents,
    components.gainCents,
    "cashDeltaCents",
  ),
  principalDeltaCents: negatedCents(
    components.principalCents,
    "principalDeltaCents",
  ),
  realizedGainDeltaCents: components.gainCents,
  quantityDeltaMicros: negatedCents(
    components.quantityMicros,
    "quantityDeltaMicros",
  ),
  goalNetContributionDeltaCents: goalId ?
    negatedCents(components.principalCents, "goalNetContributionDeltaCents") :
    0,
  goalCurrentValueDeltaCents: goalId ? currentValueDeltaCents : 0,
  currentValueDeltaCents,
});

const SIMPLE_WITHDRAWAL_PENDING_EFFECTS = {
  cashDeltaCents: 0,
  principalDeltaCents: 0,
  realizedGainDeltaCents: 0,
  quantityDeltaMicros: 0,
  goalNetContributionDeltaCents: 0,
  goalCurrentValueDeltaCents: 0,
  currentValueDeltaCents: 0,
} as const;

export const executeWithdrawSimpleInvestment = async (
  auth: WorkspaceActor,
  payload: WithdrawSimpleInvestmentPayload,
): Promise<Record<string, unknown>> => {
  const operation = "withdrawSimpleInvestment" as const;
  const movementId = deterministicDocumentId(
    operation,
    auth.uid,
    payload.idempotencyKey,
  );
  const projectionId = `investment_${movementId}`;
  const occurredAt = assertNotFuture(
    parseTimestamp(payload.occurredAt),
    "occurredAt",
  );
  const received = payload.received !== false;
  assertCashAccountForFact(received, payload.cashAccountId,
    WITHDRAWAL_ACCOUNT_REQUIRED_MESSAGE);
  return investmentFirestore().runTransaction(async (transaction) => {
    const access = await reassertWorkspaceActor(
      transaction,
      auth,
      investmentOperationRoles(operation),
    );
    const authorization = {
      role: access.role,
      profileType: profileTypeFromWorkspace(access.workspace),
    };
    const reservation = await reserveInvestmentIdempotency(
      transaction,
      auth,
      operation,
      payload.idempotencyKey,
      payload.correlationId,
      payload,
    );
    if (reservation.replay) return reservation.replay;
    const positionRef = investmentDoc(
      auth.workspaceId,
      INVESTMENT_COLLECTIONS.positions,
      payload.positionId,
    );
    const movementRef = investmentDoc(
      auth.workspaceId,
      INVESTMENT_COLLECTIONS.movements,
      movementId,
    );
    const [positionSnapshot, movementSnapshot] = await Promise.all([
      transaction.get(positionRef),
      transaction.get(movementRef),
    ]);
    const position = assertWorkspaceDocument(
      positionSnapshot,
      auth.workspaceId,
      "Investimento",
    );
    if (movementSnapshot.exists) {
      throw new ApplicationError(
        "idempotency_conflict",
        "Movimento já existente.",
      );
    }
    const accountId = String(position.accountId);
    const assetId = String(position.assetId);
    if (investmentPositionId(accountId, assetId) !== payload.positionId) {
      throw new ApplicationError(
        "domain_precondition_failed",
        "A posição informada é incoerente com a conta e o ativo que declara.",
      );
    }
    const [accountSnapshot, assetSnapshot] = await Promise.all([
      transaction.get(investmentDoc(
        auth.workspaceId,
        INVESTMENT_COLLECTIONS.accounts,
        accountId,
      )),
      transaction.get(investmentDoc(
        auth.workspaceId,
        INVESTMENT_COLLECTIONS.assets,
        assetId,
      )),
    ]);
    ensureAccountAndAsset(
      accountSnapshot,
      assetSnapshot,
      auth.workspaceId,
      authorization.profileType,
      false,
    );
    // Regime único por valor (D-15): ativo fora dele está fora do contrato.
    if (!isValueModeAsset(assetSnapshot.data())) {
      throw new ApplicationError(
        "domain_precondition_failed",
        INVESTMENT_OUT_OF_CONTRACT_MESSAGE,
      );
    }
    const current = positionState(positionSnapshot);
    const {gainCents, principalCents, quantityMicros} =
      simpleWithdrawalComponents(
        current,
        payload.valueCents,
        payload.gainCents,
      );
    const goalId = current.goalId;
    const goalSnapshot = received && goalId ?
      await transaction.get(investmentGoalDoc(auth.workspaceId, goalId)) :
      undefined;
    if (goalSnapshot) {
      assertWorkspaceDocument(goalSnapshot, auth.workspaceId, "Meta");
    }
    const periodContext = received ?
      await readInvestmentPeriodContext(
        transaction,
        auth.workspaceId,
        occurredAt,
      ) :
      undefined;
    // D-30 (P4-D): a retirada recebida entra na conta escolhida, ativa no
    // workspace. A pendente não move conta.
    const cashAccounts = received ?
      await prepareInvestmentCashAccount(
        transaction,
        auth.workspaceId,
        String(payload.cashAccountId),
      ) :
      undefined;
    const next = received ?
      applyPositionDeltas(current, {
        quantityMicros: negateExact(quantityMicros, "quantityDeltaMicros"),
        principalCents: negateExact(principalCents, "principalDeltaCents"),
        realizedGainCents: gainCents,
        realizedLossCents: 0,
        feesCents: 0,
        taxCents: 0,
      }) :
      current;
    const currentValueDeltaCents =
      next.currentValueCents - current.currentValueCents;
    const description = payload.description ??
      `Retirada de ${String(assetSnapshot.data()?.name ?? "investimento")}`;
    const effects = received ?
      simpleWithdrawalSettledEffects(
        {gainCents, principalCents, quantityMicros},
        currentValueDeltaCents,
        goalId,
      ) :
      SIMPLE_WITHDRAWAL_PENDING_EFFECTS;
    const accountMovementId = cashAccounts ?
      postInvestmentAccountMovement(transaction, cashAccounts, {
        workspaceId: auth.workspaceId,
        actorUid: auth.uid,
        operation,
        requestId: payload.correlationId,
        investmentMovementId: movementId,
        cashAccountId: String(payload.cashAccountId),
        amountCents: effects.cashDeltaCents,
        effectiveDate: investmentCashDate({occurredAt, settlementAt: occurredAt}),
      }) :
      undefined;
    const movement = {
      id: movementId,
      workspaceId: auth.workspaceId,
      profileType: authorization.profileType,
      domainVersion: INVESTMENT_DOMAIN_VERSION,
      calculationVersion: INVESTMENT_CALCULATION_VERSION,
      accountId,
      assetId,
      positionId: payload.positionId,
      operation: "redemption",
      status: received ? "settled" : "pending",
      currency: "BRL",
      description,
      // `principalCents` é o **componente de custo** do total retirado, e é
      // ele que reduz o capital investido. O total recebido é
      // `principalCents + gainCents`, e aparece no caixa.
      principalCents,
      requestedPrincipalCents: principalCents,
      requestedQuantityMicros: quantityMicros,
      ...(received ?
        {residualPrincipalCents: 0, residualQuantityMicros: 0} :
        {}),
      // Rendimento só existe quando informado. Perda, taxa e imposto seguem
      // fora da UX simples e não são inventados.
      gainCents,
      lossCents: 0,
      feesCents: 0,
      taxCents: 0,
      quantityMicros,
      realizedLossDeltaCents: 0,
      feesDeltaCents: 0,
      taxDeltaCents: 0,
      ...effects,
      ...(goalId ? {goalId} : {}),
      ...(accountMovementId ?
        {cashAccountId: String(payload.cashAccountId), accountMovementId} :
        {}),
      ...movementPresentationSnapshot(
        accountSnapshot.data(),
        assetSnapshot.data(),
      ),
      transactionId: projectionId,
      correlationId: payload.correlationId,
      idempotencyKeyHash: reservation.keyHash,
      occurredAt,
      ...(received ?
        {
          settlementAt: occurredAt,
          settledBy: auth.uid,
          settledAt: FieldValue.serverTimestamp(),
        } :
        {}),
      createdBy: auth.uid,
      createdAt: FieldValue.serverTimestamp(),
    };
    transaction.create(
      movementRef,
      assertInvestmentDocument("movement", movement, auth.workspaceId),
    );
    if (received && periodContext) {
      writePosition(
        transaction,
        positionSnapshot,
        auth.workspaceId,
        authorization.profileType,
        accountId,
        assetId,
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
          previous: goalSnapshot?.data()?.name as string | undefined,
          next: goalSnapshot?.data()?.name as string | undefined,
        },
      );
      writeInvestmentReportPeriod(
        transaction,
        auth.workspaceId,
        authorization.profileType,
        auth.uid,
        occurredAt,
        {
          operation: "redemption",
          principalCents,
          gainCents,
          lossCents: 0,
          feesCents: 0,
          taxCents: 0,
          cashDeltaCents: movement.cashDeltaCents,
          currentValueDeltaCents,
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
    }
    writeInvestmentCashMirror(
      transaction,
      auth,
      authorization.profileType,
      movement,
      investmentCashEntryFor(movement, {
        operation: "redemption",
        status: received ? "settled" : "pending",
      }),
      accountMovementId ?
        {cashAccountId: String(payload.cashAccountId), accountMovementId} :
        null,
    );
    const result = {
      success: true,
      movementId,
      positionId: payload.positionId,
      transactionId: projectionId,
      accountMovementId: accountMovementId ?? null,
      status: movement.status,
      cashDeltaCents: movement.cashDeltaCents,
      principalCents,
      gainCents,
      remainingPrincipalCents: next.principalCents,
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
        positionId: payload.positionId,
        status: movement.status,
        valueCents: payload.valueCents,
        principalCents,
        gainCents,
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
 * Liquidação de uma retirada simples pendente.
 *
 * Espelha `executeSettleInvestmentContribution`: não recebe valores — total e
 * rendimento já foram fixados no pedido —, preserva `occurredAt` como a data
 * do pedido e registra `settlementAt` como a data em que o dinheiro entrou.
 *
 * Os componentes são **revalidados contra a posição no instante da
 * liquidação**: entre o pedido e o recebimento outra retirada pode ter
 * reduzido o capital, e aplicar o custo antigo deixaria a posição negativa ou
 * o patrimônio fantasma.
 *
 * Só liquida retirada de investimento em regime por valor. Um pedido de
 * resgate do fluxo avançado continua sendo liquidado por
 * `settleInvestmentRedemption`, que é onde quantidade, perda, taxas e imposto
 * são informados.
 */
export const executeSettleSimpleWithdrawal = async (
  auth: WorkspaceActor,
  payload: SettleSimpleWithdrawalPayload,
): Promise<Record<string, unknown>> => {
  const operation = "settleSimpleWithdrawal" as const;
  const settledAt = assertNotFuture(
    parseTimestamp(payload.settledAt),
    "settledAt",
  );
  return investmentFirestore().runTransaction(async (transaction) => {
    const access = await reassertWorkspaceActor(
      transaction,
      auth,
      investmentOperationRoles(operation),
    );
    const authorization = {
      role: access.role,
      profileType: profileTypeFromWorkspace(access.workspace),
    };
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
      "Retirada",
    );
    if (
      movement.operation !== "redemption" ||
      movement.status !== "pending"
    ) {
      throw new ApplicationError(
        "domain_precondition_failed",
        "Somente uma retirada pendente pode ser liquidada.",
      );
    }
    assertNotBefore(
      settledAt,
      movement.occurredAt as Timestamp,
      "settledAt",
      "à solicitação da retirada",
    );
    const refs = {
      account: investmentDoc(
        auth.workspaceId,
        INVESTMENT_COLLECTIONS.accounts,
        String(movement.accountId),
      ),
      asset: investmentDoc(
        auth.workspaceId,
        INVESTMENT_COLLECTIONS.assets,
        String(movement.assetId),
      ),
      position: investmentDoc(
        auth.workspaceId,
        INVESTMENT_COLLECTIONS.positions,
        String(movement.positionId),
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
    if (!isValueModeAsset(assetSnapshot.data())) {
      throw new ApplicationError(
        "domain_precondition_failed",
        INVESTMENT_OUT_OF_CONTRACT_MESSAGE,
      );
    }
    const current = positionState(positionSnapshot);
    const requestedGainCents = integerOrZero(movement.gainCents);
    const requestedTotalCents = addExact(
      integerOrZero(movement.principalCents),
      requestedGainCents,
      "requestedTotalCents",
    );
    const components = simpleWithdrawalComponents(
      current,
      requestedTotalCents,
      requestedGainCents,
    );
    /*
     * Vínculo de meta do movimento liquidado.
     *
     * Os deltas acima são apurados contra a meta da posição **no instante da
     * liquidação**, e o documento precisa declarar essa mesma meta. Entre o
     * pedido e o recebimento a posição pode ter sido desvinculada ou movida
     * para outra meta; conservar o `goalId` gravado na abertura do pendente
     * faria o resgate aparecer no histórico de uma meta que não sofreu efeito
     * nenhum, porque `listGoalInvestmentMovements` filtra exatamente por esse
     * campo. Sem meta o campo **sai** do documento: string vazia não é
     * ausência, e o contrato declara `goalId` opcional — nunca vazio.
     *
     * O vínculo do pedido não se perde. O evento de liquidação registra os
     * dois lados, e os movimentos `goal_link`/`goal_unlink` da posição
     * continuam no ledger.
     */
    const goalId = current.goalId;
    const requestedGoalId = typeof movement.goalId === "string" ?
      movement.goalId :
      undefined;
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
    // D-30 (P4-D): a conta em que o dinheiro entrou, ativa no workspace.
    const cashAccounts = await prepareInvestmentCashAccount(
      transaction,
      auth.workspaceId,
      payload.cashAccountId,
    );
    const next = applyPositionDeltas(current, {
      quantityMicros: negatedCents(
        components.quantityMicros,
        "quantityDeltaMicros",
      ),
      principalCents: negatedCents(
        components.principalCents,
        "principalDeltaCents",
      ),
      realizedGainCents: components.gainCents,
      realizedLossCents: 0,
      feesCents: 0,
      taxCents: 0,
    });
    const currentValueDeltaCents =
      next.currentValueCents - current.currentValueCents;
    const effects = simpleWithdrawalSettledEffects(
      components,
      currentValueDeltaCents,
      goalId,
    );
    const accountMovementId = postInvestmentAccountMovement(
      transaction,
      cashAccounts,
      {
        workspaceId: auth.workspaceId,
        actorUid: auth.uid,
        operation,
        requestId: payload.correlationId,
        investmentMovementId: payload.movementId,
        cashAccountId: payload.cashAccountId,
        amountCents: effects.cashDeltaCents,
        effectiveDate: investmentCashDate({
          occurredAt: movement.occurredAt as Timestamp,
          settlementAt: settledAt,
        }),
      },
    );
    const settledMovement = {
      ...movement,
      status: "settled",
      principalCents: components.principalCents,
      gainCents: components.gainCents,
      quantityMicros: components.quantityMicros,
      residualPrincipalCents: 0,
      residualQuantityMicros: 0,
      realizedLossDeltaCents: 0,
      feesDeltaCents: 0,
      taxDeltaCents: 0,
      ...effects,
      goalId,
      cashAccountId: payload.cashAccountId,
      accountMovementId,
      settlementAt: settledAt,
      settledBy: auth.uid,
      settledAt: FieldValue.serverTimestamp(),
      settlementCorrelationId: payload.correlationId,
      updatedAt: FieldValue.serverTimestamp(),
    };
    assertInvestmentDocument("movement", settledMovement, auth.workspaceId);
    transaction.update(movementRef, {
      status: settledMovement.status,
      principalCents: settledMovement.principalCents,
      gainCents: settledMovement.gainCents,
      quantityMicros: settledMovement.quantityMicros,
      residualPrincipalCents: 0,
      residualQuantityMicros: 0,
      realizedLossDeltaCents: 0,
      feesDeltaCents: 0,
      taxDeltaCents: 0,
      cashDeltaCents: settledMovement.cashDeltaCents,
      principalDeltaCents: settledMovement.principalDeltaCents,
      realizedGainDeltaCents: settledMovement.realizedGainDeltaCents,
      quantityDeltaMicros: settledMovement.quantityDeltaMicros,
      goalNetContributionDeltaCents:
        settledMovement.goalNetContributionDeltaCents,
      goalCurrentValueDeltaCents: settledMovement.goalCurrentValueDeltaCents,
      currentValueDeltaCents: settledMovement.currentValueDeltaCents,
      goalId: goalId ?? FieldValue.delete(),
      cashAccountId: payload.cashAccountId,
      accountMovementId,
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
      String(movement.accountId),
      String(movement.assetId),
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
        principalCents: components.principalCents,
        gainCents: components.gainCents,
        lossCents: 0,
        feesCents: 0,
        taxCents: 0,
        cashDeltaCents: settledMovement.cashDeltaCents,
        currentValueDeltaCents,
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
    writeInvestmentCashMirror(
      transaction,
      auth,
      authorization.profileType,
      settledMovement,
      investmentCashEntryFor(settledMovement, {
        operation: "redemption",
        status: "settled",
      }),
      {cashAccountId: payload.cashAccountId, accountMovementId},
    );
    const result = {
      success: true,
      movementId: payload.movementId,
      positionId: String(movement.positionId),
      transactionId: movement.transactionId,
      accountMovementId,
      status: "settled",
      cashDeltaCents: settledMovement.cashDeltaCents,
      principalCents: components.principalCents,
      gainCents: components.gainCents,
      remainingPrincipalCents: next.principalCents,
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
        positionId: String(movement.positionId),
        beforeStatus: "pending",
        afterStatus: "settled",
        principalCents: components.principalCents,
        gainCents: components.gainCents,
        requestedGoalId: requestedGoalId ?? null,
        settledGoalId: goalId ?? null,
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
