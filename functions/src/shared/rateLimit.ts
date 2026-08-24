import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";

import {CreditCardApplicationError} from "../creditCards/errors";
import {saoPauloDayKey} from "./dateKeys";

/**
 * Limite de frequência por ator, workspace e operação.
 *
 * A contagem vive em documento do Firestore, e não em memória de instância:
 * Cloud Functions escala horizontalmente e reinicia, então um contador em
 * memória não limita nada de fato — cada instância teria a própria contagem.
 *
 * A janela é deslizante por blocos: o documento guarda o início da janela e a
 * contagem dentro dela. Quando a janela expira, contagem e início são
 * reiniciados na mesma transação da verificação, o que torna a checagem
 * atômica e imune a corrida entre chamadas simultâneas.
 */

export interface RateLimitPolicy {
  /** Nome da operação limitada, usado na chave do documento. */
  operation: string;
  /** Teto de chamadas dentro da janela. */
  limit: number;
  /** Tamanho da janela em segundos. */
  windowSeconds: number;
}

const sanitizeKeyPart = (value: string): string =>
  value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);

export const rateLimitDocumentId = (
  policy: RateLimitPolicy,
  actorId: string,
): string =>
  `${sanitizeKeyPart(policy.operation)}_${sanitizeKeyPart(actorId)}`;

/**
 * Consome uma unidade do limite dentro da transação informada.
 *
 * Precisa ser chamada na fase de leitura da transação, como qualquer outra
 * leitura. Lança `domain_precondition_failed` com mensagem em pt-BR quando o
 * teto é atingido.
 */
export const consumeRateLimit = async (
  transaction: admin.firestore.Transaction,
  workspaceId: string,
  actorId: string,
  policy: RateLimitPolicy,
): Promise<{remaining: number; resetsAt: Timestamp}> =>
  consumeRateLimitAt(
    transaction,
    admin
      .firestore()
      .doc(
        `workspaces/${workspaceId}/rate_limits/` +
          rateLimitDocumentId(policy, actorId),
      ),
    {workspaceId, actorId, policy},
  );

/**
 * Consome limite num documento arbitrário.
 *
 * Existe para as operações que **não têm workspace** — o checkout de
 * assinatura é por usuário, não por tenant. Escrever o contador sob
 * `workspaces/user_{uid}/…` criaria subcoleção sob um documento de workspace
 * que não existe, poluindo a listagem do tenant.
 */
export const consumeUserRateLimit = async (
  transaction: admin.firestore.Transaction,
  userId: string,
  policy: RateLimitPolicy,
): Promise<{remaining: number; resetsAt: Timestamp}> =>
  consumeRateLimitAt(
    transaction,
    admin
      .firestore()
      .doc(`users/${userId}/rate_limits/${rateLimitDocumentId(policy, userId)}`),
    {workspaceId: null, actorId: userId, policy},
  );

const consumeRateLimitAt = async (
  transaction: admin.firestore.Transaction,
  ref: admin.firestore.DocumentReference,
  context: {
    workspaceId: string | null;
    actorId: string;
    policy: RateLimitPolicy;
  },
): Promise<{remaining: number; resetsAt: Timestamp}> => {
  const {workspaceId, actorId, policy} = context;
  const snapshot = await transaction.get(ref);
  const now = Date.now();
  const windowMs = policy.windowSeconds * 1000;
  const data = snapshot.data();
  const windowStartMs =
    (data?.windowStart as Timestamp | undefined)?.toMillis() ?? 0;
  const expired = now - windowStartMs >= windowMs;
  const used = expired ? 0 : Number(data?.count ?? 0);

  if (used >= policy.limit) {
    const resetsAt = Timestamp.fromMillis(windowStartMs + windowMs);
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      "Muitas solicitações em pouco tempo. Aguarde alguns instantes e " +
        "tente novamente.",
      {retryAfterSeconds: Math.ceil((resetsAt.toMillis() - now) / 1000)},
    );
  }

  const nextWindowStartMs = expired ? now : windowStartMs;
  transaction.set(
    ref,
    {
      id: ref.id,
      workspaceId,
      actorId,
      operation: policy.operation,
      windowStart: Timestamp.fromMillis(nextWindowStartMs),
      windowSeconds: policy.windowSeconds,
      limit: policy.limit,
      count: expired ? 1 : FieldValue.increment(1),
      date: saoPauloDayKey(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    {merge: true},
  );

  return {
    remaining: policy.limit - used - 1,
    resetsAt: Timestamp.fromMillis(nextWindowStartMs + windowMs),
  };
};
