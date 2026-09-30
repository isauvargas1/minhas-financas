import * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";

import {sha256, stableStringify} from "../shared/hashing";
import {idempotencyIdentity} from "../shared/idempotency";
import {RETENTION_DAYS, expiresInDays} from "../shared/retention";
import {userProfileRef} from "../shared/workspaceAuth";
import {billingAccountRef} from "./model";
import {quotaStateUnavailable} from "./quota";

/**
 * Estado server-owned dos créditos de IA (P2B.2, PR-AI-03, D-01, D-11).
 *
 * O **crédito** é do billing owner; a **chave de idempotência** é do ator.
 *
 * - `billing_accounts/{ownerUid}/ai_usage/{YYYY-MM}`: créditos usados no mês
 *   civil de `America/Sao_Paulo`, no pool do titular — todos os membros
 *   autorizados de todos os workspaces de que ele é owner consomem o mesmo
 *   teto (`aiCreditsPerMonth` do plano efetivo dele). Documento ausente = 0;
 *   a primeira chamada aceita do mês o cria. Sem cron de reset, sem
 *   varredura de meses anteriores e sem contador em memória. Meses passados
 *   não são mais escritos. Sem TTL nesta etapa (ciclo de vida em P8).
 * - `users/{actorUid}/ai_usage_receipts/{receiptId}`: recibo da chamada
 *   aceita, sob quem enviou a chave. Continua encontrável depois de troca de
 *   plano ou de transferência do workspace: a mesma chave nunca debita de
 *   novo, nem o owner antigo nem o novo. Registra o `billingOwnerUid`
 *   debitado. TTL de 90 dias. Só metadados e o hash da intenção: nunca
 *   pergunta, transcrição, documento, prompt, resposta ou JSON extraído.
 *
 * As Rules negam leitura, listagem e escrita do cliente nos dois (curinga de
 * `billing_accounts` e regra explícita em `users/{uid}/ai_usage_receipts`).
 * Estado presente e malformado falha fechado.
 */
export const AI_USAGE_COLLECTION = "ai_usage";
export const AI_USAGE_RECEIPTS_COLLECTION = "ai_usage_receipts";
export const AI_USAGE_SCHEMA_VERSION = 1;

type Snapshot = admin.firestore.DocumentSnapshot;

export const aiUsageRef = (
  ownerUid: string,
  monthKey: string,
): admin.firestore.DocumentReference =>
  billingAccountRef(ownerUid).collection(AI_USAGE_COLLECTION).doc(monthKey);

/** Recibo sob o ator: independe do owner vigente do workspace. */
export const aiUsageReceiptRef = (
  actorUid: string,
  receiptId: string,
): admin.firestore.DocumentReference =>
  userProfileRef(actorUid)
    .collection(AI_USAGE_RECEIPTS_COLLECTION)
    .doc(receiptId);

/**
 * ID do recibo: a chave pertence a quem a enviou. O hash não deixa a chave
 * em claro no caminho e mantém chaves iguais de atores diferentes separadas.
 */
export const aiUsageReceiptId = (
  actorId: string,
  idempotencyKey: string,
): string => sha256(`ai-usage:${actorId}:${idempotencyKey}`);

/**
 * Hash da intenção: operação e payload validado, sem a chave de transporte.
 * A própria chave entra como sal: o hash de uma pergunta curta não serve
 * para confirmar o conteúdo por dicionário sem conhecer a chave, que não é
 * persistida. Só compara reenvios da mesma chave.
 */
export const aiRequestHash = (input: {
  operation: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
}): string =>
  sha256(stableStringify({
    salt: input.idempotencyKey,
    operation: input.operation,
    payload: idempotencyIdentity(input.payload),
  }));

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Créditos usados no mês. Ausente = 0; presente e incoerente falha fechado. */
export const readAiUsedCredits = (
  snapshot: Snapshot,
  ownerUid: string,
  monthKey: string,
): number => {
  if (!snapshot.exists) return 0;
  const used = snapshot.get("usedCredits");
  if (
    snapshot.get("schemaVersion") !== AI_USAGE_SCHEMA_VERSION ||
    snapshot.get("billingOwnerUid") !== ownerUid ||
    snapshot.get("monthKey") !== monthKey ||
    !isCount(used)
  ) {
    throw quotaStateUnavailable();
  }
  return used;
};

/** Regrava o contador do mês inteiro (lido na mesma transação). */
export const writeAiUsage = (
  transaction: admin.firestore.Transaction,
  input: {ownerUid: string; monthKey: string; usedCredits: number},
): void => {
  if (!isCount(input.usedCredits)) throw quotaStateUnavailable();
  transaction.set(aiUsageRef(input.ownerUid, input.monthKey), {
    billingOwnerUid: input.ownerUid,
    monthKey: input.monthKey,
    usedCredits: input.usedCredits,
    schemaVersion: AI_USAGE_SCHEMA_VERSION,
    updatedAt: FieldValue.serverTimestamp(),
  });
};

export interface AiUsageReceipt {
  operation: string;
  actorId: string;
  workspaceId: string;
  /** Titular efetivamente debitado nesta chamada (auditoria). */
  billingOwnerUid: string;
  monthKey: string;
  creditCost: number;
  requestHash: string;
}

/** Cria o recibo: exatamente estes campos, com retenção de 90 dias. */
export const createAiUsageReceipt = (
  transaction: admin.firestore.Transaction,
  ref: admin.firestore.DocumentReference,
  receipt: AiUsageReceipt,
): void => {
  transaction.create(ref, {
    operation: receipt.operation,
    actorId: receipt.actorId,
    workspaceId: receipt.workspaceId,
    billingOwnerUid: receipt.billingOwnerUid,
    monthKey: receipt.monthKey,
    creditCost: receipt.creditCost,
    requestHash: receipt.requestHash,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: expiresInDays(RETENTION_DAYS.aiUsageReceipts),
  });
};
