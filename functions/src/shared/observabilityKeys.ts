import {createHash} from "node:crypto";

/**
 * Primitivas compartilhadas de observabilidade dos domínios financeiros.
 *
 * Dois problemas confirmados na auditoria de prontidão motivam este módulo, e
 * os dois são de superfície, não de cálculo:
 *
 * 1. **Chave de idempotência crua persistida** (INV-P2-039). A chave é um
 *    segredo funcional: quem a conhece consegue transformar uma operação nova
 *    em replay da anterior. O domínio já guarda `idempotencyKeyHash` nos
 *    fatos; métricas e eventos guardavam o valor cru numa coleção legível por
 *    qualquer membro do workspace.
 *
 * 2. **Documentos de evento ilimitados** (INV-P2-039). O ID do evento de falha
 *    era derivado do `correlationId` do chamador, que é livre — cada tentativa
 *    criava um documento novo, sem teto. O ID passa a vir de uma identidade
 *    com cardinalidade limitada: a intenção (chave de idempotência) quando
 *    existe, senão um balde diário por operação e ator.
 */

const sha256Hex = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

/**
 * Digest curto e estável de uma chave de idempotência.
 *
 * Curto o bastante para caber em ID de documento e longo o bastante para que
 * colisão não seja um risco prático (32 hex = 128 bits).
 */
export const idempotencyKeyDigest = (
  idempotencyKey: string | undefined,
): string | undefined =>
  idempotencyKey && idempotencyKey.trim() ?
    sha256Hex(idempotencyKey.trim()).slice(0, 32) :
    undefined;

/** Digest curto de qualquer identificador livre vindo do cliente. */
export const opaqueDigest = (value: string, length = 16): string =>
  sha256Hex(value).slice(0, length);

/** Remove de um ID de documento tudo que não seja seguro no path. */
export const sanitizeIdPart = (value: string): string =>
  value.replace(/[^\w-]/g, "_").slice(0, 96);

export interface BoundedFailureEventIdInput {
  /** Prefixo estável, normalmente o nome da operação. */
  operation: string;
  /** Chave de idempotência crua, se o chamador enviou uma. */
  idempotencyKey?: string;
  /** Ator autenticado, quando houver. */
  actorId?: string;
  /** Chave de dia já no fuso oficial do produto. */
  dayKey: string;
}

/**
 * ID de evento de falha com cardinalidade limitada.
 *
 * Com chave de idempotência: um documento por intenção financeira — o mesmo
 * teto que o próprio domínio já impõe em `*_idempotency_keys`. Sem chave: um
 * documento por operação, ator e dia. Em nenhum dos casos o `correlationId`
 * entra no ID, porque ele muda a cada tentativa por desenho.
 */
export const boundedFailureEventId = (
  input: BoundedFailureEventIdInput,
): string => {
  const digest = idempotencyKeyDigest(input.idempotencyKey);
  if (digest) {
    return sanitizeIdPart(`failure_${input.operation}_k${digest}`);
  }
  const actorPart = input.actorId ?
    opaqueDigest(input.actorId, 12) :
    "anonymous";
  return sanitizeIdPart(
    `failure_${input.operation}_${input.dayKey}_a${actorPart}`,
  );
};

/**
 * Mensagem de erro segura para persistir ou logar.
 *
 * Trunca e nunca serializa o objeto de erro: `error.cause`, `error.details` e
 * campos anexados por bibliotecas carregam payload, valor monetário e
 * identificador de pessoa (INV-P2-036).
 */
export const safeErrorMessage = (
  error: unknown,
  fallback: string,
  maxLength = 500,
): string => {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim().slice(0, maxLength);
  }
  return fallback;
};
