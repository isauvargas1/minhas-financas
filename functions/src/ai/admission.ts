import * as admin from "firebase-admin";

import {
  aiRequestHash,
  aiUsageReceiptId,
  aiUsageReceiptRef,
  aiUsageRef,
  createAiUsageReceipt,
  readAiUsedCredits,
  writeAiUsage,
} from "../billing/aiCredits";
import {billingAccountRef} from "../billing/model";
import {
  assertCanonicalOwnerMembership,
  assertWithinQuota,
  canonicalOwnerCandidate,
  entitlementAt,
} from "../billing/quota";
import {saoPauloMonthKey} from "../shared/dateKeys";
import {ApplicationError} from "../shared/errors";
import {
  reserveRateLimitFromSnapshot,
  workspaceRateLimitRef,
  type RateLimitPolicy,
} from "../shared/rateLimit";
import {
  reassertWorkspaceActor,
  workspaceMemberRef,
  type WorkspaceActor,
} from "../shared/workspaceAuth";
import {AI_CREDIT_COSTS, type AiCreditOperation} from "./policy";

/**
 * Admissão de uma chamada de IA (P2B.2, PR-AI-03).
 *
 * Uma única transação decide e consome tudo, no mesmo commit:
 *
 * 1. relê a autorização do ator (conta, workspace, membership e papel);
 * 2. resolve o owner canônico do workspace e confirma o membership `owner`
 *    ativo dele (D-01: o pool de créditos é do titular);
 * 3. lê o billing do titular e deriva o plano efetivo no relógio do servidor
 *    (`effectiveEntitlement`: grace e cancelamento vencem sem webhook);
 * 4. lê o uso do mês civil de São Paulo, o recibo da chave e o rate limit
 *    horário do ator no workspace, num único `getAll`;
 * 5. recusa chave repetida (mesmo conteúdo: já processada; outro conteúdo:
 *    conflito), rate limit estourado e `usados + custo > limite`;
 * 6. grava o contador do mês, cria o recibo e confirma o rate limit.
 *
 * Qualquer recusa lança antes da primeira escrita: nada é gravado, nem o
 * rate limit. Chamadas concorrentes do mesmo titular leem o mesmo documento
 * mensal; a perdedora é repetida pelo Firestore, relê o contador (ou o
 * recibo) e é recusada. Se a contenção esgotar as tentativas do SDK, sai
 * `aborted`, também sem efeito.
 *
 * Política de cobrança desta versão: o crédito representa a tentativa aceita
 * e enviada ao provedor. Depois do commit, falha do provedor (timeout, 4xx,
 * 5xx, resposta vazia, JSON inválido) **não** devolve o crédito, e a mesma
 * chave não chama o provedor de novo. Falha antes do commit não consome.
 */
export const AI_REQUEST_ALREADY_PROCESSED_MESSAGE =
  "Esta solicitação de IA já foi processada. Faça uma nova solicitação " +
  "para consultar novamente.";

export const AI_IDEMPOTENCY_CONFLICT_MESSAGE =
  "Esta chave de idempotência já foi usada com outros dados.";

export interface AiAdmissionRequest {
  /** Ator da pré-checagem do kernel; a decisão que vale é a releitura. */
  actor: WorkspaceActor;
  /** Operação cobrada (peso em `AI_CREDIT_COSTS`). */
  creditOperation: AiCreditOperation;
  /** Rate limit horário da callable; `operation` identifica a callable. */
  rateLimit: RateLimitPolicy;
  idempotencyKey: string;
  /** Payload validado: só o hash dele é persistido. */
  payload: Record<string, unknown>;
  /** Relógio do servidor. */
  now: () => number;
}

export interface AiAdmission {
  periodKey: string;
  creditCost: number;
}

export const admitAiCall = (
  request: AiAdmissionRequest,
): Promise<AiAdmission> => {
  const {actor, rateLimit} = request;
  const operation = rateLimit.operation;
  const creditCost = AI_CREDIT_COSTS[request.creditOperation];
  // Fora da transação: o hash de um documento de até ~6 MB não é refeito a
  // cada tentativa.
  const receiptId = aiUsageReceiptId(actor.uid, request.idempotencyKey);
  const requestHash = aiRequestHash({
    operation,
    idempotencyKey: request.idempotencyKey,
    payload: request.payload,
  });

  return admin.firestore().runTransaction(async (transaction) => {
    const nowMs = request.now();
    const periodKey = saoPauloMonthKey(new Date(nowMs));

    // Mesma exigência da pré-checagem: papel inalterado. Quem perdeu o
    // acesso ou foi rebaixado não consome crédito nem rate limit.
    const {workspace} = await reassertWorkspaceActor(transaction, actor);
    const ownerUid = canonicalOwnerCandidate(workspace);
    const receiptRef = aiUsageReceiptRef(ownerUid, receiptId);
    const [ownerMember, billing, usage, receipt, rateLimitSnapshot] =
      await transaction.getAll(
        workspaceMemberRef(actor.workspaceId, ownerUid),
        billingAccountRef(ownerUid),
        aiUsageRef(ownerUid, periodKey),
        receiptRef,
        workspaceRateLimitRef(actor.workspaceId, actor.uid, rateLimit),
      );
    assertCanonicalOwnerMembership(ownerMember);
    const entitlement = entitlementAt(billing, nowMs);
    const used = readAiUsedCredits(usage, ownerUid, periodKey);

    if (receipt.exists) {
      if (
        receipt.get("requestHash") !== requestHash ||
        receipt.get("actorId") !== actor.uid ||
        receipt.get("operation") !== operation
      ) {
        throw new ApplicationError(
          "idempotency_conflict",
          AI_IDEMPOTENCY_CONFLICT_MESSAGE,
        );
      }
      // Já consumida e enviada: não há resposta guardada para devolver
      // (conteúdo do usuário não é persistido) e o provedor não é chamado
      // de novo.
      throw new ApplicationError(
        "idempotency_conflict",
        AI_REQUEST_ALREADY_PROCESSED_MESSAGE,
      );
    }

    const rateLimitReservation = reserveRateLimitFromSnapshot(
      transaction,
      rateLimitSnapshot,
      {workspaceId: actor.workspaceId, actorId: actor.uid, policy: rateLimit},
    );
    assertWithinQuota({
      resource: "aiCreditsPerMonth",
      entitlement,
      used,
      adding: creditCost,
      periodKey,
    });

    writeAiUsage(transaction, {
      ownerUid,
      monthKey: periodKey,
      usedCredits: used + creditCost,
    });
    createAiUsageReceipt(transaction, receiptRef, {
      operation,
      actorId: actor.uid,
      workspaceId: actor.workspaceId,
      monthKey: periodKey,
      creditCost,
      requestHash,
    });
    rateLimitReservation.commit();
    return {periodKey, creditCost};
  });
};
