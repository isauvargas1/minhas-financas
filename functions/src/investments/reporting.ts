import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";

import type {PositionState} from "./operationsV2";
import {sha256} from "./infrastructure";
import {CreditCardApplicationError} from "../creditCards/errors";
import {
  INVESTMENT_COLLECTIONS,
  investmentCollection,
  investmentDoc,
} from "./paths";

const integerOrZero = (value: unknown): number =>
  Number.isSafeInteger(value) ? (value as number) : 0;
import {
  saoPauloDayKey,
  saoPauloMonthKey,
  saoPauloMonthStart,
} from "../shared/dateKeys";

export type InvestmentAllocationDimension =
  | "account"
  | "class"
  | "asset"
  | "goal"
  | "risk"
  | "liquidity"
  | "indexer"
  | "purpose";

export type InvestmentAllocationPurpose =
  | "unassigned"
  | "retirement"
  | "goal"
  | "reserve"
  | "financial_application"
  | "reinvestment"
  | "fixed_asset";

export interface MovementReportInput {
  operation: "contribution" | "redemption" | "reversal";
  reversalOfOperation?: "contribution" | "redemption";
  principalCents: number;
  gainCents: number;
  feesCents: number;
  taxCents: number;
  cashDeltaCents: number;
  currentValueDeltaCents: number;
}

export interface MovementReportDeltas {
  contributionCents: number;
  redemptionPrincipalCents: number;
  realizedGainCents: number;
  feesCents: number;
  taxCents: number;
  costDeltaCents: number;
  currentValueDeltaCents: number;
  cashDeltaCents: number;
  settledMovementCount: number;
}

export const movementReportDeltas = (
  input: MovementReportInput,
): MovementReportDeltas => {
  const sign = input.operation === "reversal" ? -1 : 1;
  const effectiveOperation = input.operation === "reversal" ?
    input.reversalOfOperation : input.operation;
  if (
    effectiveOperation !== "contribution" &&
    effectiveOperation !== "redemption"
  ) {
    throw new Error(
      "A reversão precisa informar a operação financeira original.",
    );
  }
  return {
    contributionCents:
      effectiveOperation === "contribution" ? sign * input.principalCents : 0,
    redemptionPrincipalCents:
      effectiveOperation === "redemption" ? sign * input.principalCents : 0,
    realizedGainCents:
      effectiveOperation === "redemption" ? sign * input.gainCents : 0,
    feesCents: sign * input.feesCents,
    taxCents: sign * input.taxCents,
    costDeltaCents:
      effectiveOperation === "contribution" ?
        sign * input.principalCents : -sign * input.principalCents,
    currentValueDeltaCents: input.currentValueDeltaCents,
    cashDeltaCents: input.cashDeltaCents,
    // O contador segue o mesmo sinal das demais componentes: um estorno
    // compensa o evento original em vez de somar uma segunda ocorrência.
    // Antes era `1` fixo, e um par aporte+estorno deixava contagem 2.
    settledMovementCount: sign,
  };
};

const periodId = (value: Timestamp): string =>
  saoPauloMonthKey(value.toDate());

const dayId = (value: Timestamp): string => saoPauloDayKey(value.toDate());

export const writeInvestmentReportPeriod = (
  transaction: admin.firestore.Transaction,
  workspaceId: string,
  profileType: "PF" | "PJ",
  actorId: string,
  occurredAt: Timestamp,
  input: MovementReportInput,
  context: InvestmentPeriodContext,
): void => {
  writeInvestmentReportDeltas(
    transaction,
    workspaceId,
    profileType,
    actorId,
    occurredAt,
    movementReportDeltas(input),
    context,
  );
};

/**
 * Teto de meses posteriores atualizados por um lançamento retroativo.
 *
 * O fechamento de um mês é cumulativo, então um lançamento com data antiga
 * altera também o fechamento de todos os meses seguintes. Na prática esse
 * número é zero — lançamentos entram no mês corrente. Ultrapassar o teto falha
 * de forma explícita e pede reconstrução, em vez de escrever um histórico
 * parcialmente corrigido.
 */
export const MAX_RETROACTIVE_PERIODS = 24;

/**
 * Contexto de fechamento do período, lido na fase de leitura da transação.
 *
 * O Firestore exige todas as leituras antes de qualquer escrita, então quem
 * grava o período precisa receber isto pronto em vez de consultar na hora.
 */
export interface InvestmentPeriodContext {
  period: string;
  openingCents: number;
  laterPeriodRefs: admin.firestore.DocumentReference[];
}

/**
 * Lê o que o fechamento do período precisa: a abertura do mês, tomada do
 * fechamento do mês anterior — documento da própria série mensal, nunca o
 * patrimônio atual —, e os meses posteriores que um lançamento retroativo
 * deslocaria.
 */
export const readInvestmentPeriodContext = async (
  transaction: admin.firestore.Transaction,
  workspaceId: string,
  occurredAt: Timestamp,
): Promise<InvestmentPeriodContext> => {
  const period = periodId(occurredAt);
  const periodsRef = investmentCollection(
    workspaceId,
    INVESTMENT_COLLECTIONS.reportPeriods,
  );
  const targetSnapshot = await transaction.get(
    investmentDoc(workspaceId, INVESTMENT_COLLECTIONS.reportPeriods, period),
  );
  // Existir não é o mesmo que já ter fechamento: um documento gravado antes
  // deste campo existir precisa ser semeado, senão o mês perderia a base
  // cumulativa e passaria a valer apenas o delta do lançamento novo.
  const targetData = targetSnapshot.data();
  const hasClosing =
    targetSnapshot.exists &&
    Number.isSafeInteger(targetData?.closingCurrentValueCents);
  const previousPeriod = hasClosing ?
    undefined :
    await transaction.get(
      periodsRef.where("period", "<", period)
        .orderBy("period", "desc").limit(1),
    );
  const laterPeriods = await transaction.get(
    periodsRef.where("period", ">", period)
      .orderBy("period", "asc").limit(MAX_RETROACTIVE_PERIODS + 1),
  );
  if (laterPeriods.size > MAX_RETROACTIVE_PERIODS) {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      `O lançamento em ${period} exigiria corrigir mais de ` +
        `${MAX_RETROACTIVE_PERIODS} meses posteriores. Reconstrua a série ` +
        "mensal em vez de aplicar a correção de forma incremental.",
    );
  }
  return {
    period,
    // Abertura do mês. Com fechamento já presente, o incremento basta. Sem
    // ele, semeia com o fechamento do mês anterior mais o que este mês já
    // acumulou de variação patrimonial antes da migração.
    openingCents: hasClosing ?
      0 :
      integerOrZero(
        previousPeriod?.docs[0]?.data().closingCurrentValueCents,
      ) + integerOrZero(targetData?.currentValueDeltaCents),
    laterPeriodRefs: laterPeriods.docs.map((entry) => entry.ref),
  };
};

const writeInvestmentReportDeltas = (
  transaction: admin.firestore.Transaction,
  workspaceId: string,
  profileType: "PF" | "PJ",
  actorId: string,
  occurredAt: Timestamp,
  deltas: MovementReportDeltas,
  context: InvestmentPeriodContext,
): void => {
  const id = periodId(occurredAt);
  const day = dayId(occurredAt);
  const openingCents = context.openingCents;

  transaction.set(
    investmentDoc(workspaceId, INVESTMENT_COLLECTIONS.reportPeriods, id),
    {
      id,
      workspaceId,
      profileType,
      currency: "BRL",
      period: id,
      periodStart: Timestamp.fromDate(saoPauloMonthStart(id)),
      contributionCents: FieldValue.increment(deltas.contributionCents),
      redemptionPrincipalCents: FieldValue.increment(
        deltas.redemptionPrincipalCents,
      ),
      realizedGainCents: FieldValue.increment(deltas.realizedGainCents),
      feesCents: FieldValue.increment(deltas.feesCents),
      taxCents: FieldValue.increment(deltas.taxCents),
      costDeltaCents: FieldValue.increment(deltas.costDeltaCents),
      currentValueDeltaCents: FieldValue.increment(
        deltas.currentValueDeltaCents,
      ),
      cashDeltaCents: FieldValue.increment(deltas.cashDeltaCents),
      settledMovementCount: FieldValue.increment(deltas.settledMovementCount),
      // Fechamento cumulativo: abertura do mês (fechamento do anterior) mais o
      // delta patrimonial deste lançamento.
      closingCurrentValueCents: FieldValue.increment(
        openingCents + deltas.currentValueDeltaCents,
      ),
      daily: {
        [day]: {
          contributionCents: FieldValue.increment(deltas.contributionCents),
          redemptionPrincipalCents: FieldValue.increment(
            deltas.redemptionPrincipalCents,
          ),
          realizedGainCents: FieldValue.increment(deltas.realizedGainCents),
          feesCents: FieldValue.increment(deltas.feesCents),
          taxCents: FieldValue.increment(deltas.taxCents),
          costDeltaCents: FieldValue.increment(deltas.costDeltaCents),
          currentValueDeltaCents: FieldValue.increment(
            deltas.currentValueDeltaCents,
          ),
          cashDeltaCents: FieldValue.increment(deltas.cashDeltaCents),
          settledMovementCount: FieldValue.increment(
            deltas.settledMovementCount,
          ),
        },
      },
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actorId,
    },
    {merge: true},
  );

  // Lançamento retroativo desloca o fechamento de todo mês posterior.
  context.laterPeriodRefs.forEach((laterRef) => {
    transaction.set(
      laterRef,
      {
        closingCurrentValueCents: FieldValue.increment(
          deltas.currentValueDeltaCents,
        ),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorId,
      },
      {merge: true},
    );
  });
};

export const writeInvestmentValuationReportPeriod = (
  transaction: admin.firestore.Transaction,
  workspaceId: string,
  profileType: "PF" | "PJ",
  actorId: string,
  occurredAt: Timestamp,
  currentValueDeltaCents: number,
  context: InvestmentPeriodContext,
): void => {
  if (currentValueDeltaCents === 0) return;
  writeInvestmentReportDeltas(
    transaction,
    workspaceId,
    profileType,
    actorId,
    occurredAt,
    {
      contributionCents: 0,
      redemptionPrincipalCents: 0,
      realizedGainCents: 0,
      feesCents: 0,
      taxCents: 0,
      costDeltaCents: 0,
      currentValueDeltaCents,
      cashDeltaCents: 0,
      settledMovementCount: 0,
    },
    context,
  );
};

export interface AllocationDescriptor {
  dimension: InvestmentAllocationDimension;
  key: string;
  label: string;
}

const assetTypeLabel = (value: unknown): string => ({
  fixed_income: "Renda fixa",
  fund: "Fundo",
  stock: "Ação",
  etf: "ETF",
  crypto: "Criptoativo",
  other: "Outro",
}[String(value)] ?? "Não informado");

const purposeLabel = (value: InvestmentAllocationPurpose): string => ({
  unassigned: "Não classificado",
  retirement: "Aposentadoria",
  goal: "Objetivo",
  reserve: "Reserva",
  financial_application: "Aplicação financeira",
  reinvestment: "Reinvestimento",
  fixed_asset: "Imobilizado",
}[value]);

const metadataDescriptor = (
  dimension: "risk" | "liquidity" | "indexer",
  asset: admin.firestore.DocumentData,
): AllocationDescriptor => {
  const idField = `${dimension}Id`;
  const labelField = `${dimension}Name`;
  const key = typeof asset[idField] === "string" ?
    asset[idField] : "unassigned";
  const label = typeof asset[labelField] === "string" ?
    asset[labelField] : "Não informado";
  return {dimension, key, label};
};

export const allocationDescriptors = (
  account: admin.firestore.DocumentData,
  asset: admin.firestore.DocumentData,
  goalId: string | undefined,
  goalName?: string,
): AllocationDescriptor[] => {
  const purpose = (typeof asset.allocationPurpose === "string" ?
    asset.allocationPurpose : "unassigned") as InvestmentAllocationPurpose;
  return [
    {
      dimension: "account",
      key: String(account.id),
      label: String(account.name),
    },
    {
      dimension: "class",
      key: String(asset.classId ?? asset.assetType ?? "unassigned"),
      label: String(asset.className ?? assetTypeLabel(asset.assetType)),
    },
    {dimension: "asset", key: String(asset.id), label: String(asset.name)},
    {
      dimension: "goal",
      key: goalId ?? "unassigned",
      label: goalId ? (goalName ?? "Meta vinculada") : "Sem meta",
    },
    metadataDescriptor("risk", asset),
    metadataDescriptor("liquidity", asset),
    metadataDescriptor("indexer", asset),
    {dimension: "purpose", key: purpose, label: purposeLabel(purpose)},
  ];
};

export const allocationDocumentId = (
  descriptor: Pick<AllocationDescriptor, "dimension" | "key">,
): string => `${descriptor.dimension}_${sha256(descriptor.key).slice(0, 32)}`;

export const allocationHasExposure = (state: PositionState): boolean =>
  state.quantityMicros !== 0 || state.principalCents !== 0 ||
  state.currentValueCents !== 0;

const writeAllocationDelta = (
  transaction: admin.firestore.Transaction,
  workspaceId: string,
  profileType: "PF" | "PJ",
  actorId: string,
  descriptor: AllocationDescriptor,
  deltas: {
    positionCount: number;
    principalCents: number;
    currentValueCents: number;
    realizedGainCents: number;
    feesCents: number;
    taxCents: number;
  },
): void => {
  const id = allocationDocumentId(descriptor);
  transaction.set(
    investmentDoc(workspaceId, INVESTMENT_COLLECTIONS.allocationSummaries, id),
    {
      id,
      workspaceId,
      profileType,
      currency: "BRL",
      dimension: descriptor.dimension,
      key: descriptor.key,
      label: descriptor.label,
      positionCount: FieldValue.increment(deltas.positionCount),
      principalCents: FieldValue.increment(deltas.principalCents),
      currentValueCents: FieldValue.increment(deltas.currentValueCents),
      realizedGainCents: FieldValue.increment(deltas.realizedGainCents),
      feesCents: FieldValue.increment(deltas.feesCents),
      taxCents: FieldValue.increment(deltas.taxCents),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actorId,
    },
    {merge: true},
  );
};

export const writeInvestmentAllocationProjections = (
  transaction: admin.firestore.Transaction,
  workspaceId: string,
  profileType: "PF" | "PJ",
  actorId: string,
  account: admin.firestore.DocumentData,
  asset: admin.firestore.DocumentData,
  previous: PositionState,
  next: PositionState,
  goalNames: {previous?: string; next?: string} = {},
): void => {
  const previousDescriptors = allocationDescriptors(
    account,
    asset,
    previous.goalId,
    goalNames.previous,
  );
  const nextDescriptors = allocationDescriptors(
    account,
    asset,
    next.goalId,
    goalNames.next,
  );
  const previousExposed = allocationHasExposure(previous);
  const nextExposed = allocationHasExposure(next);
  const sameDimensions = previousDescriptors.every(
    (entry, index) => entry.key === nextDescriptors[index].key,
  );
  if (sameDimensions) {
    nextDescriptors.forEach((entry) => writeAllocationDelta(
      transaction,
      workspaceId,
      profileType,
      actorId,
      entry,
      {
        positionCount: Number(nextExposed) - Number(previousExposed),
        principalCents: next.principalCents - previous.principalCents,
        currentValueCents: next.currentValueCents - previous.currentValueCents,
        realizedGainCents:
          next.realizedGainCents - previous.realizedGainCents,
        feesCents: next.feesCents - previous.feesCents,
        taxCents: next.taxCents - previous.taxCents,
      },
    ));
    return;
  }
  // Quando ao menos uma chave de dimensão muda, cada dimensão é tratada pelo
  // que de fato aconteceu com ela. Antes, este ramo devolvia cedo para toda
  // dimensão inalterada, de modo que uma única mudança — vincular a posição a
  // uma meta, por exemplo — descartava o delta monetário das outras sete, que
  // passavam a subcontar principal e valor atual de forma permanente.
  previousDescriptors.forEach((entry, index) => {
    const nextEntry = nextDescriptors[index];
    if (entry.key === nextEntry.key) {
      // Mesma faixa: aplica só a variação, como no caminho sem mudança.
      writeAllocationDelta(
        transaction,
        workspaceId,
        profileType,
        actorId,
        nextEntry,
        {
          positionCount: Number(nextExposed) - Number(previousExposed),
          principalCents: next.principalCents - previous.principalCents,
          currentValueCents: next.currentValueCents - previous.currentValueCents,
          realizedGainCents:
            next.realizedGainCents - previous.realizedGainCents,
          feesCents: next.feesCents - previous.feesCents,
          taxCents: next.taxCents - previous.taxCents,
        },
      );
      return;
    }
    // Faixa trocada: retira o total anterior da antiga e lança o total novo na
    // nova, para que a soma da dimensão continue fechando com o resumo.
    writeAllocationDelta(
      transaction,
      workspaceId,
      profileType,
      actorId,
      entry,
      {
        positionCount: -Number(previousExposed),
        principalCents: -previous.principalCents,
        currentValueCents: -previous.currentValueCents,
        realizedGainCents: -previous.realizedGainCents,
        feesCents: -previous.feesCents,
        taxCents: -previous.taxCents,
      },
    );
    writeAllocationDelta(
      transaction,
      workspaceId,
      profileType,
      actorId,
      nextEntry,
      {
        positionCount: Number(nextExposed),
        principalCents: next.principalCents,
        currentValueCents: next.currentValueCents,
        realizedGainCents: next.realizedGainCents,
        feesCents: next.feesCents,
        taxCents: next.taxCents,
      },
    );
  });
};
