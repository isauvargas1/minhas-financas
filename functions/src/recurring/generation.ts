import * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";

import {sha256} from "../shared/hashing";
import {workspaceRef} from "../shared/workspaceAuth";
import {commitFact, prepareFact, type FactPlan} from "./facts";
import {
  RECURRING_SYSTEM_ACTOR,
  appendRecurringEvent,
  contractSnapshot,
  occurrenceDocument,
  occurrenceSnapshot,
  readAuthoritativeRecurringExpense,
  recurringOccurrenceIdFor,
  recurringOccurrencesRef,
  targetDomainOf,
  type AttentionCode,
  type AuthoritativeRecurringExpense,
  type OccurrenceStatus,
} from "./model";
import {nextDueAfter} from "./schedule";

/**
 * Processamento de um vencimento (P4-B) — a unidade do agendador.
 *
 * Uma transação por vencimento:
 *
 * 1. relê o contrato e confere que continua ativo, com o mesmo próximo
 *    vencimento esperado e já alcançado (`<= hoje`). Pausa, cancelamento ou
 *    edição concorrentes mudam o contrato e a transação desiste sem gravar;
 * 2. lê a ocorrência no ID determinístico `workspace:contrato:vencimento` —
 *    se já existe, o vencimento foi processado e só o avanço é refeito;
 * 3. decide pelo modo de execução: `confirmation_required` cria a ocorrência
 *    aguardando o usuário; `automatic` prepara o fato no domínio de destino
 *    (cartão ou caixa) — impedimento de domínio vira `attention_required`
 *    com código seguro, sem fato parcial;
 * 4. grava fato (se houver), ocorrência, avanço do contrato
 *    (`lastProcessedDueDate`, próximo vencimento ou `ended`) e eventos, no
 *    mesmo commit.
 *
 * Falha transitória lança: nada é gravado e o mesmo vencimento é tentado na
 * próxima execução — sem duplicidade, porque ocorrência, compra e
 * lançamento têm IDs determinísticos e são criados com `create`.
 */
export const RECURRING_GENERATION_OPERATION = "processRecurring";

export type DueOutcome =
  | {status: "skipped"}
  | {
    status: "processed";
    occurrenceStatus: OccurrenceStatus;
    attentionCode: AttentionCode | null;
    ended: boolean;
    nextDueDate: string | null;
  };

/** Avanço do contrato depois de processar `dueDate`. */
export const advanceAfter = (
  contract: AuthoritativeRecurringExpense,
  dueDate: string,
): {nextDueDate: string | null; ended: boolean} => {
  const next = nextDueAfter(contract, dueDate);
  return {nextDueDate: next, ended: next === null};
};

const automaticRequestHash = (occurrenceId: string): string =>
  sha256(`recurring:automatic:${occurrenceId}`);

/** Ponto de falha injetável, só para os testes. */
export interface RecurringGenerationFaults {
  /** Com todas as escritas enfileiradas, antes do commit. */
  beforeCommit?: () => void;
}

export const processDueOccurrence = async (
  contractRef: admin.firestore.DocumentReference,
  expectedDueDate: string,
  today: string,
  requestId: string,
  faults: RecurringGenerationFaults = {},
): Promise<DueOutcome> => {
  const workspaceId = contractRef.parent.parent?.id;
  if (!workspaceId) return {status: "skipped"};
  return admin.firestore().runTransaction(async (transaction) => {
    const contractSnapshotDoc = await transaction.get(contractRef);
    const contract = readAuthoritativeRecurringExpense(
      contractSnapshotDoc.id, contractSnapshotDoc.data(), workspaceId);
    if (!contract) throw new Error("recorrência fora do schema autoritativo");
    if (
      contract.status !== "active" ||
      contract.nextDueDate !== expectedDueDate ||
      expectedDueDate > today
    ) {
      return {status: "skipped"} as DueOutcome;
    }
    const dueDate = expectedDueDate;
    const occurrenceId = recurringOccurrenceIdFor(workspaceId, contract.id,
      dueDate);
    const occurrenceRef = recurringOccurrencesRef(workspaceId)
      .doc(occurrenceId);
    const [occurrenceDoc, workspaceDoc] = await transaction.getAll(
      occurrenceRef, workspaceRef(workspaceId));
    const advance = advanceAfter(contract, dueDate);
    const contractAfter = {
      ...contract,
      status: advance.ended ? "ended" as const : contract.status,
      nextDueDate: advance.nextDueDate,
    };

    let occurrenceStatus: OccurrenceStatus;
    let attentionCode: AttentionCode | null = null;
    let plan: FactPlan | null = null;
    const alreadyProcessed = occurrenceDoc.exists;
    if (alreadyProcessed) {
      occurrenceStatus = occurrenceDoc.get("status") as OccurrenceStatus;
    } else if (
      !workspaceDoc.exists ||
      workspaceDoc.get("status") === "archived"
    ) {
      occurrenceStatus = "attention_required";
      attentionCode = "workspace_unavailable";
    } else if (contract.executionMode === "confirmation_required") {
      occurrenceStatus = "awaiting_confirmation";
    } else {
      plan = await prepareFact(transaction, {
        workspaceId,
        target: targetDomainOf(contract.paymentMethod) === "card" ?
          {domain: "card", cardId: contract.cardId as string} :
          {domain: "cash", cashAccountId: contract.cashAccountId as string},
        amountCents: contract.amountCents,
        dueDate,
        today,
        settlement: {status: "pending"},
        impedimentsAsAttention: true,
      });
      if (plan.kind === "attention") {
        occurrenceStatus = "attention_required";
        attentionCode = plan.code;
      } else {
        occurrenceStatus = "generated";
      }
    }

    // ---- escritas
    const opensAction = !alreadyProcessed &&
      (occurrenceStatus === "awaiting_confirmation" ||
        occurrenceStatus === "attention_required");
    if (!alreadyProcessed) {
      const fact = plan && plan.kind !== "attention" ?
        commitFact(transaction, plan, {
          workspaceId,
          profileType: workspaceDoc.get("type") === "PJ" ? "PJ" : "PF",
          contract,
          occurrenceId,
          dueDate,
          amountCents: contract.amountCents,
          actorId: RECURRING_SYSTEM_ACTOR,
          actorRole: null,
          requestHash: automaticRequestHash(occurrenceId),
          operation: RECURRING_GENERATION_OPERATION,
          requestId,
          correlationId: null,
        }) :
        {cashTransactionId: null, cardPurchaseId: null};
      transaction.create(occurrenceRef, occurrenceDocument({
        id: occurrenceId,
        workspaceId,
        contract,
        dueDate,
        status: occurrenceStatus,
        actualAmountCents: occurrenceStatus === "generated" ?
          contract.amountCents : null,
        cashTransactionId: fact.cashTransactionId,
        cardPurchaseId: fact.cardPurchaseId,
        attentionCode,
        settlement: fact.cashTransactionId ? "pending" : null,
        actorId: RECURRING_SYSTEM_ACTOR,
        requestId,
      }));
      appendRecurringEvent(transaction, {
        workspaceId,
        recurringExpenseId: contract.id,
        occurrenceId,
        operation: occurrenceStatus === "generated" ?
          "recurring.occurrence_generated" :
          occurrenceStatus === "awaiting_confirmation" ?
            "recurring.occurrence_awaiting" :
            "recurring.occurrence_attention",
        targetKey: occurrenceId,
        actorId: RECURRING_SYSTEM_ACTOR,
        actorRole: null,
        intentId: null,
        requestHash: null,
        requestId,
        correlationId: null,
        before: null,
        after: occurrenceSnapshot({
          status: occurrenceStatus,
          dueDate,
          plannedAmountCents: contract.amountCents,
          actualAmountCents: occurrenceStatus === "generated" ?
            contract.amountCents : null,
          cashTransactionId: fact.cashTransactionId,
          cardPurchaseId: fact.cardPurchaseId,
          attentionCode,
        }),
      });
    }
    transaction.update(contractRef, {
      lastProcessedDueDate: dueDate,
      nextDueDate: advance.nextDueDate,
      status: contractAfter.status,
      ...(advance.ended ? {endedAt: FieldValue.serverTimestamp()} : {}),
      ...(opensAction ?
        {openOccurrenceCount: FieldValue.increment(1)} : {}),
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (advance.ended) {
      appendRecurringEvent(transaction, {
        workspaceId,
        recurringExpenseId: contract.id,
        occurrenceId: null,
        operation: "recurring.ended",
        targetKey: contract.id,
        actorId: RECURRING_SYSTEM_ACTOR,
        actorRole: null,
        intentId: null,
        requestHash: null,
        requestId,
        correlationId: null,
        before: contractSnapshot(contract),
        after: contractSnapshot(contractAfter),
      });
    }
    faults.beforeCommit?.();
    return {
      status: "processed",
      occurrenceStatus,
      attentionCode,
      ended: advance.ended,
      nextDueDate: advance.nextDueDate,
    } as DueOutcome;
  });
};
