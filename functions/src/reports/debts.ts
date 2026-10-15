import * as admin from "firebase-admin";
import {AggregateField} from "firebase-admin/firestore";

import {LOANS_COLLECTION} from "../loans/model";
import {
  CLIENTS_COLLECTION,
  RECEIVABLES_COLLECTION,
} from "../receivables/model";
import {addDaysToDayKey} from "../shared/dateKeys";
import {addExact, ratioBasisPoints} from "./formulas";
import type {
  DebtsReport,
  LoanBucket,
  ReportSectionResult,
  TopClientItem,
} from "./contract";

/**
 * Dívidas e valores a receber (P5-C1, D-37.6), cada um no seu lugar:
 *
 * - dívida de empréstimos tomados (`loans` `borrow`, saldo devedor);
 * - a receber de empréstimos concedidos (`loans` `lend`) — não é dívida;
 * - recebíveis comerciais em aberto (`receivables`) — não são dívida;
 * - obrigações de cartão: as do bloco de cartões, referenciadas aqui uma
 *   vez só (nunca somadas de novo).
 *
 * Agregações exatas do servidor. O ranking de clientes é uma amostra dos
 * 500 vencimentos mais recentes e vem marcado como tal quando não cobre
 * todos os recebíveis.
 */

const db = () => admin.firestore();

const ACTIVE_LOAN_STATUSES = ["active", "overdue"];

/** Amostra do ranking de clientes (mesmo teto da tela anterior). */
export const TOP_CLIENTS_SAMPLE_LIMIT = 500;
const TOP_CLIENTS = 5;

const aggregate = async (
  query: admin.firestore.Query,
  field: string,
): Promise<{sum: number; count: number}> => {
  const snapshot = await query.aggregate({
    sum: AggregateField.sum(field),
    count: AggregateField.count(),
  }).get();
  const sum = Number(snapshot.data().sum ?? 0);
  if (!Number.isSafeInteger(sum)) {
    throw new Error(`soma fora da faixa segura: ${field}`);
  }
  return {sum: sum || 0, count: snapshot.data().count ?? 0};
};

const loanBucket = async (
  workspaceId: string,
  type: "borrow" | "lend",
): Promise<LoanBucket> => {
  const loans = db().collection(`workspaces/${workspaceId}/${LOANS_COLLECTION}`)
    .where("type", "==", type);
  const [open, overdue] = await Promise.all([
    aggregate(loans.where("status", "in", ACTIVE_LOAN_STATUSES),
      "balanceCents"),
    aggregate(loans.where("status", "==", "overdue"), "balanceCents"),
  ]);
  return {
    balanceCents: open.sum,
    count: open.count,
    overdueBalanceCents: overdue.sum,
    overdueCount: overdue.count,
  };
};

const topClients = async (
  workspaceId: string,
): Promise<ReportSectionResult<TopClientItem[]>> => {
  const sample = await db()
    .collection(`workspaces/${workspaceId}/${RECEIVABLES_COLLECTION}`)
    .orderBy("dueDate", "desc")
    // Sonda: só há amostra quando existe o 501º documento.
    .limit(TOP_CLIENTS_SAMPLE_LIMIT + 1)
    .get();
  const sampled = sample.size > TOP_CLIENTS_SAMPLE_LIMIT;
  const byClient = new Map<string, number>();
  let total = 0;
  for (const doc of sample.docs.slice(0, TOP_CLIENTS_SAMPLE_LIMIT)) {
    const data = doc.data();
    if (
      data.workspaceId !== workspaceId ||
      data.status === "cancelled" ||
      typeof data.clientId !== "string" ||
      !Number.isSafeInteger(data.amountCents)
    ) {
      continue;
    }
    byClient.set(data.clientId,
      addExact(byClient.get(data.clientId) ?? 0, data.amountCents));
    total = addExact(total, data.amountCents);
  }
  const top = [...byClient.entries()]
    .sort((left, right) => right[1] - left[1] ||
      left[0].localeCompare(right[0]))
    .slice(0, TOP_CLIENTS);
  const names = new Map<string, string>();
  if (top.length > 0) {
    const clients = await db().getAll(...top.map(([clientId]) =>
      db().doc(`workspaces/${workspaceId}/${CLIENTS_COLLECTION}/${clientId}`)));
    for (const client of clients) {
      const name = client.data()?.name;
      if (typeof name === "string") names.set(client.id, name);
    }
  }
  const items = top.map(([clientId, amountCents]) => ({
    clientId,
    name: names.get(clientId) ?? null,
    amountCents,
    shareBasisPoints: ratioBasisPoints(amountCents, total),
  }));
  return {
    status: sampled ? "sample" : items.length === 0 ? "zero" : "exact",
    ...(sampled ? {reason: "top_clients_sample"} : {}),
    data: items,
  };
};

export const readDebtsSection = async (input: {
  workspaceId: string;
  today: string;
  /** Obrigações de cartão do bloco de cartões (`null` se indisponível). */
  cardObligationsCents: number | null;
  /**
   * Ranking de clientes por amostra (até 500 leituras): só PJ, a única tela
   * que o exibe. PF recebe `not_requested` sem ler nada.
   */
  includeTopClients: boolean;
}): Promise<ReportSectionResult<DebtsReport>> => {
  const {workspaceId, today} = input;
  const receivables = db()
    .collection(`workspaces/${workspaceId}/${RECEIVABLES_COLLECTION}`);
  const open = receivables.where("status", "==", "open");
  const [borrowed, lent, openTotal, overdue, dueSoon, received, ranking] =
    await Promise.all([
      loanBucket(workspaceId, "borrow"),
      loanBucket(workspaceId, "lend"),
      aggregate(open, "balanceCents"),
      aggregate(open.where("dueDate", "<", today), "balanceCents"),
      aggregate(open.where("dueDate", ">=", today)
        .where("dueDate", "<=", addDaysToDayKey(today, 30)), "balanceCents"),
      aggregate(receivables.where("status", "==", "received"),
        "principalReceivedCents"),
      input.includeTopClients ?
        topClients(workspaceId) :
        Promise.resolve<ReportSectionResult<TopClientItem[]>>(
          {status: "not_requested", data: null}),
    ]);
  const data: DebtsReport = {
    loansBorrowed: borrowed,
    loansLent: lent,
    cardObligationsCents: input.cardObligationsCents,
    receivables: {
      openCents: openTotal.sum,
      openCount: openTotal.count,
      overdueCents: overdue.sum,
      overdueCount: overdue.count,
      dueNext30Cents: dueSoon.sum,
      receivedCents: received.sum,
      receivedCount: received.count,
    },
    topClients: ranking,
  };
  const empty = borrowed.count === 0 && lent.count === 0 &&
    openTotal.count === 0 && received.count === 0 &&
    (input.cardObligationsCents ?? 0) === 0;
  return {status: empty ? "zero" : "exact", data};
};
