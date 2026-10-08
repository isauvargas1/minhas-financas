import {
  EMPTY_BALANCES,
  EMPTY_GROUP_COUNTERS,
  isOpenReimbursement,
  remainingOf,
  type AuthoritativeSplitBill,
  type AuthoritativeSplitParticipant,
  type AuthoritativeSplitReimbursement,
  type AuthoritativeSplitShare,
  type SplitGroupCounters,
  type SplitGroupTotals,
  type SplitParticipantBalances,
} from "./model";

/**
 * Reconstrução dos agregados da Divisão de contas a partir das fontes
 * (P4-C, §39). Pura: recebe títulos, rateios, participantes e reembolsos
 * de um grupo e devolve o que o grupo e cada participante deveriam guardar.
 *
 * Fórmula (rateios e títulos anulados não contam):
 * - grupo: `billedCents` = Σ valores dos títulos; `openCents` = Σ do que
 *   falta nos rateios em aberto; categorias pelo balde gravado no título;
 *   reembolsos por estado;
 * - participante: `dueCents` = Σ devidos dele; `paidCents` = Σ dos títulos
 *   que pagou; `owesOpenCents` = Σ do que ele ainda deve;
 *   `receivableOpenCents` = Σ do que ainda devem nos títulos que ele pagou;
 * - título: Σ devidos = valor; em aberto ⇔ há rateio em aberto.
 *
 * Usada pelas suítes para provar que toda operação mantém os agregados
 * exatos; divergência é defeito, nunca arredondamento.
 */
export interface ParticipantAggregates {
  balances: SplitParticipantBalances;
  openShareCount: number;
  openReceivableCount: number;
  openReimbursementCount: number;
}

export interface BillDerivation {
  dueSumCents: number;
  status: "open" | "settled" | "voided";
  openShareCount: number;
  resolvedShareCount: number;
  outstandingCents: number;
}

export interface GroupReconstruction {
  counters: SplitGroupCounters;
  totals: SplitGroupTotals;
  participants: Map<string, ParticipantAggregates>;
  bills: Map<string, BillDerivation>;
}

export const reconstructGroupAggregates = (input: {
  participants: readonly AuthoritativeSplitParticipant[];
  bills: readonly AuthoritativeSplitBill[];
  shares: readonly AuthoritativeSplitShare[];
  reimbursements: readonly AuthoritativeSplitReimbursement[];
}): GroupReconstruction => {
  const counters: SplitGroupCounters = {...EMPTY_GROUP_COUNTERS};
  const totals: SplitGroupTotals = {
    billedCents: 0,
    openCents: 0,
    categoryTotals: {},
    reimbursementTotalCents: 0,
    reimbursementPendingCents: 0,
    reimbursementPaidCents: 0,
  };
  const participants = new Map<string, ParticipantAggregates>();
  for (const participant of input.participants) {
    counters.participantCount += 1;
    if (participant.status === "active") counters.activeParticipantCount += 1;
    participants.set(participant.id, {
      balances: {...EMPTY_BALANCES},
      openShareCount: 0,
      openReceivableCount: 0,
      openReimbursementCount: 0,
    });
  }
  const of = (id: string): ParticipantAggregates => {
    const found = participants.get(id);
    if (!found) throw new Error(`participante ${id} ausente`);
    return found;
  };
  const sharesByBill = new Map<string, AuthoritativeSplitShare[]>();
  for (const share of input.shares) {
    const list = sharesByBill.get(share.billId) ?? [];
    list.push(share);
    sharesByBill.set(share.billId, list);
  }
  const bills = new Map<string, BillDerivation>();
  for (const bill of input.bills) {
    const shares = (sharesByBill.get(bill.id) ?? [])
      .filter((share) => share.status !== "voided");
    const derivation: BillDerivation = {
      dueSumCents: shares.reduce((sum, share) => sum + share.amountDueCents,
        0),
      status: bill.status === "voided" ? "voided" :
        shares.some((share) => share.status === "open") ? "open" : "settled",
      openShareCount: shares.filter((share) => share.status === "open").length,
      resolvedShareCount: shares.filter((share) =>
        share.status === "forgiven" || share.settledVia === "settlement")
        .length,
      outstandingCents: shares.reduce((sum, share) =>
        sum + remainingOf(share), 0),
    };
    bills.set(bill.id, derivation);
    if (bill.status === "voided") continue;
    counters.billCount += 1;
    if (derivation.status === "open") counters.openBillCount += 1;
    totals.billedCents += bill.amountCents;
    totals.categoryTotals[bill.categoryBucket] =
      (totals.categoryTotals[bill.categoryBucket] ?? 0) + bill.amountCents;
    of(bill.payerParticipantId).balances.paidCents += bill.amountCents;
    for (const share of shares) {
      const debtor = of(share.participantId);
      debtor.balances.dueCents += share.amountDueCents;
      const remaining = remainingOf(share);
      if (remaining > 0) {
        debtor.balances.owesOpenCents += remaining;
        debtor.openShareCount += 1;
        const payer = of(bill.payerParticipantId);
        payer.balances.receivableOpenCents += remaining;
        payer.openReceivableCount += 1;
        counters.openShareCount += 1;
        totals.openCents += remaining;
      }
    }
  }
  for (const item of input.reimbursements) {
    if (item.status === "rejected" || item.status === "cancelled") continue;
    totals.reimbursementTotalCents += item.amountCents;
    if (isOpenReimbursement(item.status)) {
      totals.reimbursementPendingCents += item.amountCents;
      counters.openReimbursementCount += 1;
      of(item.requesterParticipantId).openReimbursementCount += 1;
    } else {
      totals.reimbursementPaidCents += item.amountCents;
    }
  }
  return {counters, totals, participants, bills};
};
