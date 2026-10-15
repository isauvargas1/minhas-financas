import type * as admin from "firebase-admin";

import {
  assertActiveAccount,
  cashEntryFactId,
  postAccountMovements,
  readPostingAccounts,
  signedCashEntryCents,
  type PostingAccounts,
} from "../accounts/ledger";
import {cashEntryMovementIdFor} from "../accounts/model";
import {
  commitCardPurchase,
  prepareCardPurchase,
  type PreparedCardPurchase,
} from "../cards/purchaseOperations";
import {cardsRef} from "../cards/model";
import {
  cashEntryDocument,
  type CashEntryInput,
} from "../cash/createTransaction";
import {appendCashEvent} from "../shared/audit";
import {isApplicationError} from "../shared/errors";
import {workspaceRef, type WorkspaceRole} from "../shared/workspaceAuth";
import {
  recurringCardPurchaseIdFor,
  recurringCashTransactionIdFor,
  type AttentionCode,
  type AuthoritativeRecurringExpense,
} from "./model";

/**
 * Fato financeiro de uma ocorrência (P4-B): no máximo um, sempre pelo
 * domínio autoritativo de destino — nunca um segundo ledger dentro de
 * Recorrentes.
 *
 * - Cartão (`credit_card`): uma compra P4-A à vista (`installmentsCount = 1`,
 *   `source = recurring`, data da compra = vencimento), pela mesma primitiva
 *   da compra manual: distribuição, publicação na fatura (retroatividade
 *   D-36), reserva do limite, livro do limite e evento do cartão. Nada de
 *   `parcelado` nem `cardId` em `transactions`.
 * - Caixa (PIX, boleto, débito, dinheiro, outro): um lançamento P3 de
 *   despesa, origem `recurring` e vínculo backend-only `recurringEntry`.
 *   Pendente não move conta (o pagamento é a confirmação P3-F); "pago agora"
 *   cria o lançamento confirmado com o movimento de conta no mesmo commit.
 *
 * Nenhum dos dois consome a quota `transactionsPerMonth` (D-40).
 *
 * Fase de leitura (`prepareFact`) e fase de escrita (`commitFact`) são
 * separadas porque o Firestore exige todas as leituras antes das escritas.
 * Na geração automática, impedimento de domínio vira um plano de atenção
 * (`attention_required` com código seguro, sem fato parcial); falha
 * transitória (contenção, ID ocupado) é lançada e a transação
 * inteira é desfeita, para nova tentativa sem duplicidade (IDs
 * determinísticos por ocorrência).
 */
export type FactTarget =
  | {domain: "card"; cardId: string}
  | {domain: "cash"; cashAccountId: string};

export type CashSettlement =
  | {status: "pending"}
  | {status: "paid"; paidDate: string};

export type FactPlan =
  | {kind: "card"; prepared: PreparedCardPurchase}
  | {
    kind: "cash";
    accounts: PostingAccounts;
    cashAccountId: string;
    settlement: CashSettlement;
  }
  | {kind: "attention"; code: AttentionCode};

/** Impedimento de domínio do cartão → código seguro, ou `null`. */
const cardAttentionCode = (error: unknown): AttentionCode | null => {
  if (!isApplicationError(error)) return null;
  if (error.code === "not_found") return "card_unavailable";
  switch (error.details?.ineligible) {
  case "inconsistent": return "card_unavailable";
  case "archived_card": return "card_archived";
  case "limit_insufficient": return "limit_insufficient";
  default: return null;
  }
};

/** Impedimento de domínio da conta → código seguro, ou `null`. */
const accountAttentionCode = (error: unknown): AttentionCode | null => {
  if (!isApplicationError(error)) return null;
  if (error.code === "not_found") return "account_unavailable";
  switch (error.details?.ineligible) {
  case "inconsistent_account": return "account_unavailable";
  case "archived_account": return "account_archived";
  default: return null;
  }
};

export const prepareFact = async (
  transaction: admin.firestore.Transaction,
  input: {
    workspaceId: string;
    target: FactTarget;
    amountCents: number;
    dueDate: string;
    today: string;
    /** Só no Caixa; no cartão é ignorado. */
    settlement: CashSettlement;
    /**
     * Geração automática: impedimento vira atenção. Ação do usuário: o erro
     * de domínio (em pt-BR) volta para ele, sem nada gravado.
     */
    impedimentsAsAttention: boolean;
  },
): Promise<FactPlan> => {
  if (input.target.domain === "card") {
    const cardSnapshot = await transaction.get(
      cardsRef(input.workspaceId).doc(input.target.cardId));
    try {
      const prepared = await prepareCardPurchase(transaction, {
        workspaceId: input.workspaceId,
        cardSnapshot,
        totalCents: input.amountCents,
        installmentsCount: 1,
        purchaseDate: input.dueDate,
        today: input.today,
      });
      return {kind: "card", prepared};
    } catch (error) {
      const code = input.impedimentsAsAttention ?
        cardAttentionCode(error) : null;
      if (code) return {kind: "attention", code};
      throw error;
    }
  }
  const cashAccountId = input.target.cashAccountId;
  try {
    const accounts = await readPostingAccounts(
      transaction, input.workspaceId, [cashAccountId]);
    assertActiveAccount(accounts.get(cashAccountId) as
      Parameters<typeof assertActiveAccount>[0]);
    return {kind: "cash", accounts, cashAccountId,
      settlement: input.settlement};
  } catch (error) {
    const code = input.impedimentsAsAttention ?
      accountAttentionCode(error) : null;
    if (code) return {kind: "attention", code};
    throw error;
  }
};

/** Forma de pagamento do lançamento de caixa, no vocabulário do Caixa. */
const CASH_PAYMENT_METHOD_LABELS: Record<string, string> = {
  pix: "Pix",
  boleto: "Boleto",
  debit: "Débito em conta",
  cash: "Dinheiro",
};

export interface FactContext {
  workspaceId: string;
  profileType: "PF" | "PJ";
  contract: AuthoritativeRecurringExpense;
  occurrenceId: string;
  dueDate: string;
  amountCents: number;
  /** Quem executou: o agendador ou o usuário. */
  actorId: string;
  actorRole: WorkspaceRole | null;
  requestHash: string;
  operation: string;
  requestId: string;
  correlationId: string | null;
}

export interface CommittedFact {
  cashTransactionId: string | null;
  cardPurchaseId: string | null;
}

/** Escritas do fato planejado (sem escrita no plano de atenção). */
export const commitFact = (
  transaction: admin.firestore.Transaction,
  plan: Exclude<FactPlan, {kind: "attention"}>,
  context: FactContext,
): CommittedFact => {
  const {contract} = context;
  const business = context.profileType === "PJ" ? contract.business : null;
  if (plan.kind === "card") {
    const purchaseId = recurringCardPurchaseIdFor(context.workspaceId,
      context.occurrenceId);
    commitCardPurchase(transaction, plan.prepared, {
      purchaseId,
      workspaceId: context.workspaceId,
      details: {
        description: contract.name,
        category: contract.category,
        supplier: business?.supplier ?? null,
        costCenter: business?.costCenter ?? null,
      },
      origin: {
        source: "recurring",
        recurringExpenseId: contract.id,
        occurrenceId: context.occurrenceId,
      },
      // Responsável pela compra: quem responde pelo contrato.
      createdBy: contract.createdBy,
      actorId: context.actorId,
      actorRole: context.actorRole,
      intentId: null,
      requestHash: context.requestHash,
      operation: context.operation,
      requestId: context.requestId,
      correlationId: context.correlationId,
    });
    return {cashTransactionId: null, cardPurchaseId: purchaseId};
  }
  const transactionId = recurringCashTransactionIdFor(context.workspaceId,
    context.occurrenceId);
  const paid = plan.settlement.status === "paid";
  const paymentMethod = CASH_PAYMENT_METHOD_LABELS[contract.paymentMethod];
  const entry: CashEntryInput = {
    type: "despesa",
    cashAccountId: plan.cashAccountId,
    description: contract.name,
    category: contract.category,
    categoryId: contract.categoryId,
    amountCents: context.amountCents,
    expenseType: "Recorrente",
    ...(paymentMethod === undefined ? {} : {paymentMethod}),
    ...(business?.supplier ? {supplier: business.supplier} : {}),
    ...(business?.costCenter ? {costCenter: business.costCenter} : {}),
    ...(plan.settlement.status === "paid" ?
      {status: "confirmed", date: plan.settlement.paidDate} :
      {status: "pending", dueDate: context.dueDate}),
  };
  const accountMovementId = paid ?
    cashEntryMovementIdFor(transactionId, "apply", 1) : null;
  if (paid && accountMovementId && plan.settlement.status === "paid") {
    postAccountMovements(transaction, plan.accounts, [{
      id: accountMovementId,
      accountId: plan.cashAccountId,
      kind: "cash_transaction",
      amountCents: signedCashEntryCents("despesa", context.amountCents),
      effectiveDate: plan.settlement.paidDate,
      sourceDomain: "cash",
      sourceId: transactionId,
      sourceFactId: cashEntryFactId(transactionId, 1),
      reversalOf: null,
    }], {
      workspaceId: context.workspaceId,
      actorUid: context.actorId,
      operation: context.operation,
      requestId: context.requestId,
    });
  }
  transaction.create(
    workspaceRef(context.workspaceId).collection("transactions")
      .doc(transactionId),
    cashEntryDocument({
      actorUid: context.actorId,
      // Responsável pelo lançamento: quem responde pelo contrato.
      ownerUid: contract.createdBy,
      workspaceId: context.workspaceId,
      profileType: context.profileType,
      entry,
      requestHash: context.requestHash,
      origin: {
        kind: "recurring",
        recurringExpenseId: contract.id,
        occurrenceId: context.occurrenceId,
      },
      accountMovementId,
    }));
  appendCashEvent(transaction, {
    workspaceId: context.workspaceId,
    operation: "cash_entry.created",
    actorId: context.actorId,
    actorRole: context.actorRole,
    profileType: context.profileType,
    transactionId,
    requestHash: context.requestHash,
    requestId: context.requestId,
    channel: "recurring",
    entryStatus: paid ? "confirmed" : "pending",
  });
  return {cashTransactionId: transactionId, cardPurchaseId: null};
};
