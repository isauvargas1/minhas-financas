import type * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";

import {ApplicationError} from "../shared/errors";
import {
  SPLIT_LIMITS,
  SPLIT_OTHER_CATEGORY,
  remainingOf,
  type AuthoritativeSplitGroup,
  type AuthoritativeSplitParticipant,
  type SplitGroupCounters,
  type SplitGroupTotals,
  type SplitParticipantBalances,
  type SplitShareStatus,
} from "./model";

/**
 * Agregados da Divisão de contas (P4-C, §39): totais do grupo e saldos por
 * participante, mantidos pelo backend na mesma transação de cada operação.
 * As telas leem estes campos — nenhuma soma carrega coleções inteiras.
 *
 * Cada título contribui com:
 * - parte do título: `billCount` 1, `openBillCount` (se em aberto),
 *   `billedCents` e a categoria (valor do título), `paidCents` do pagador;
 * - parte de cada rateio não anulado: `dueCents` do participante; se em
 *   aberto, o que falta pagar entra em `owesOpenCents`/`openShareCount` do
 *   devedor, em `receivableOpenCents`/`openReceivableCount` do pagador e em
 *   `openCents`/`openShareCount` do grupo.
 *
 * Uma operação aplica `contribuição(depois) − contribuição(antes)` só das
 * partes que tocou. Valor negativo depois da aplicação é inconsistência:
 * falha fechada, nada é gravado.
 */
export const AGGREGATE_INCONSISTENT_MESSAGE =
  "Os totais deste grupo estão inconsistentes. Nada foi alterado.";

export interface ParticipantDelta {
  balances: SplitParticipantBalances;
  openShareCount: number;
  openReceivableCount: number;
  openReimbursementCount: number;
}

const emptyParticipantDelta = (): ParticipantDelta => ({
  balances: {dueCents: 0, paidCents: 0, owesOpenCents: 0,
    receivableOpenCents: 0},
  openShareCount: 0,
  openReceivableCount: 0,
  openReimbursementCount: 0,
});

export interface GroupDelta {
  counters: SplitGroupCounters;
  totals: Omit<SplitGroupTotals, "categoryTotals">;
  categories: Map<string, number>;
}

const emptyGroupDelta = (): GroupDelta => ({
  counters: {
    participantCount: 0,
    activeParticipantCount: 0,
    billCount: 0,
    openBillCount: 0,
    openShareCount: 0,
    openReimbursementCount: 0,
  },
  totals: {
    billedCents: 0,
    openCents: 0,
    reimbursementTotalCents: 0,
    reimbursementPendingCents: 0,
    reimbursementPaidCents: 0,
  },
  categories: new Map(),
});

/** Estado mínimo de um título para a contribuição. */
export interface BillState {
  status: "open" | "settled" | "voided";
  amountCents: number;
  payerParticipantId: string;
  categoryBucket: string;
}

export interface ShareState {
  participantId: string;
  status: SplitShareStatus;
  amountDueCents: number;
  amountSettledCents: number;
}

export class AggregateBook {
  readonly group: GroupDelta = emptyGroupDelta();
  readonly participants = new Map<string, ParticipantDelta>();

  private participant(id: string): ParticipantDelta {
    let delta = this.participants.get(id);
    if (!delta) {
      delta = emptyParticipantDelta();
      this.participants.set(id, delta);
    }
    return delta;
  }

  /** Parte do título (sinal +1 para somar, −1 para retirar). */
  addBillPart(bill: BillState, sign: 1 | -1): void {
    if (bill.status === "voided") return;
    this.group.counters.billCount += sign;
    if (bill.status === "open") this.group.counters.openBillCount += sign;
    this.group.totals.billedCents += sign * bill.amountCents;
    this.group.categories.set(bill.categoryBucket,
      (this.group.categories.get(bill.categoryBucket) ?? 0) +
        sign * bill.amountCents);
    this.participant(bill.payerParticipantId).balances.paidCents +=
      sign * bill.amountCents;
  }

  /** Parte de um rateio (sinal +1 para somar, −1 para retirar). */
  addSharePart(payerParticipantId: string, share: ShareState,
    sign: 1 | -1): void {
    if (share.status === "voided") return;
    const debtor = this.participant(share.participantId);
    debtor.balances.dueCents += sign * share.amountDueCents;
    const remaining = remainingOf(share);
    if (remaining > 0) {
      debtor.balances.owesOpenCents += sign * remaining;
      debtor.openShareCount += sign;
      const payer = this.participant(payerParticipantId);
      payer.balances.receivableOpenCents += sign * remaining;
      payer.openReceivableCount += sign;
      this.group.counters.openShareCount += sign;
      this.group.totals.openCents += sign * remaining;
    }
  }

  /** Contribuição completa do título com os seus rateios. */
  addBill(bill: BillState, shares: readonly ShareState[], sign: 1 | -1): void {
    this.addBillPart(bill, sign);
    if (bill.status === "voided") return;
    for (const share of shares) {
      this.addSharePart(bill.payerParticipantId, share, sign);
    }
  }

  /** Reembolso (`open`: requested/approved; `paid`: pago). */
  addReimbursement(input: {
    requesterParticipantId: string;
    amountCents: number;
    state: "open" | "paid" | "closed";
  }, sign: 1 | -1): void {
    if (input.state === "closed") return;
    this.group.totals.reimbursementTotalCents += sign * input.amountCents;
    if (input.state === "open") {
      this.group.totals.reimbursementPendingCents += sign * input.amountCents;
      this.group.counters.openReimbursementCount += sign;
      this.participant(input.requesterParticipantId).openReimbursementCount +=
        sign;
    } else {
      this.group.totals.reimbursementPaidCents += sign * input.amountCents;
    }
  }

  /** IDs dos participantes cujos saldos mudam (precisam estar relidos). */
  touchedParticipants(): string[] {
    return [...this.participants.entries()]
      .filter(([, delta]) => !isZeroDelta(delta))
      .map(([id]) => id);
  }
}

const isZeroDelta = (delta: ParticipantDelta): boolean =>
  delta.balances.dueCents === 0 && delta.balances.paidCents === 0 &&
  delta.balances.owesOpenCents === 0 &&
  delta.balances.receivableOpenCents === 0 &&
  delta.openShareCount === 0 && delta.openReceivableCount === 0 &&
  delta.openReimbursementCount === 0;

const fail = (): never => {
  throw new ApplicationError("internal", AGGREGATE_INCONSISTENT_MESSAGE);
};

const nonNegative = (value: number): number =>
  Number.isSafeInteger(value) && value >= 0 ? value : fail();

/**
 * Categoria em que o valor do título é somado: a própria, enquanto o grupo
 * tiver menos de 50 categorias distintas; depois, "Outras". O título guarda
 * o balde escolhido para retirar do mesmo lugar depois.
 */
export const categoryBucketFor = (
  group: AuthoritativeSplitGroup,
  category: string,
): string => {
  const keys = Object.keys(group.totals.categoryTotals)
    .filter((key) => key !== SPLIT_OTHER_CATEGORY);
  if (category in group.totals.categoryTotals) return category;
  return keys.length < SPLIT_LIMITS.categoryTotalsKeys ?
    category : SPLIT_OTHER_CATEGORY;
};

/** Grupo depois da aplicação (sem gravar). */
export const applyGroupDelta = (
  group: AuthoritativeSplitGroup,
  delta: GroupDelta,
): {counters: SplitGroupCounters; totals: SplitGroupTotals} => {
  const counters = Object.fromEntries(
    (Object.keys(group.counters) as (keyof SplitGroupCounters)[]).map((key) =>
      [key, nonNegative(group.counters[key] + delta.counters[key])]),
  ) as unknown as SplitGroupCounters;
  if (
    counters.activeParticipantCount > counters.participantCount ||
    counters.openBillCount > counters.billCount
  ) {
    fail();
  }
  const categoryTotals = {...group.totals.categoryTotals};
  for (const [key, cents] of delta.categories) {
    if (cents === 0) continue;
    const next = nonNegative((categoryTotals[key] ?? 0) + cents);
    if (next === 0) delete categoryTotals[key];
    else categoryTotals[key] = next;
  }
  const totals: SplitGroupTotals = {
    billedCents: nonNegative(group.totals.billedCents +
      delta.totals.billedCents),
    openCents: nonNegative(group.totals.openCents + delta.totals.openCents),
    categoryTotals,
    reimbursementTotalCents: nonNegative(group.totals.reimbursementTotalCents +
      delta.totals.reimbursementTotalCents),
    reimbursementPendingCents: nonNegative(
      group.totals.reimbursementPendingCents +
        delta.totals.reimbursementPendingCents),
    reimbursementPaidCents: nonNegative(group.totals.reimbursementPaidCents +
      delta.totals.reimbursementPaidCents),
  };
  return {counters, totals};
};

/** Grava o grupo com os agregados novos (e mais campos da operação). */
export const writeGroup = (
  transaction: admin.firestore.Transaction,
  groupRef: admin.firestore.DocumentReference,
  group: AuthoritativeSplitGroup,
  delta: GroupDelta,
  actorUid: string,
  extra: Record<string, unknown> = {},
): {counters: SplitGroupCounters; totals: SplitGroupTotals} => {
  const next = applyGroupDelta(group, delta);
  transaction.update(groupRef, {
    counters: next.counters,
    totals: next.totals,
    revision: group.revision + 1,
    updatedBy: actorUid,
    updatedAt: FieldValue.serverTimestamp(),
    ...extra,
  });
  return next;
};

/** Grava os saldos dos participantes tocados (todos precisam estar relidos). */
export const writeParticipantBalances = (
  transaction: admin.firestore.Transaction,
  participantRefOf: (id: string) => admin.firestore.DocumentReference,
  loaded: ReadonlyMap<string, AuthoritativeSplitParticipant>,
  book: AggregateBook,
  actorUid: string,
): void => {
  for (const id of book.touchedParticipants()) {
    const participant = loaded.get(id) ?? fail();
    const delta = book.participants.get(id) as ParticipantDelta;
    transaction.update(participantRefOf(id), {
      balances: {
        dueCents: nonNegative(participant.balances.dueCents +
          delta.balances.dueCents),
        paidCents: nonNegative(participant.balances.paidCents +
          delta.balances.paidCents),
        owesOpenCents: nonNegative(participant.balances.owesOpenCents +
          delta.balances.owesOpenCents),
        receivableOpenCents: nonNegative(
          participant.balances.receivableOpenCents +
            delta.balances.receivableOpenCents),
      },
      openShareCount: nonNegative(participant.openShareCount +
        delta.openShareCount),
      openReceivableCount: nonNegative(participant.openReceivableCount +
        delta.openReceivableCount),
      openReimbursementCount: nonNegative(participant.openReimbursementCount +
        delta.openReimbursementCount),
      revision: participant.revision + 1,
      updatedBy: actorUid,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
};
