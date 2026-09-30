import type {RateLimitPolicy} from "../shared/rateLimit";
import type {WorkspaceRole} from "../shared/workspaceAuth";

/**
 * Política de IA do servidor (P2B.2, PR-AI-03, D-11).
 *
 * Um único lugar para o que limita custo e acesso: papéis, peso em créditos
 * de cada operação, teto de saída por chamada, rate limit horário e tamanho
 * da entrada. O teto mensal vem do catálogo (`aiCreditsPerMonth` do plano
 * efetivo do titular). Nada disto vai ao cliente.
 */

/** Modelo atual, sem troca nesta etapa (provedor e tier: P5, D-11). */
export const AI_MODEL = "gemini-3-flash-preview";

/**
 * Papéis que podem usar a IA: quem escreve no workspace. `viewer` é somente
 * leitura e não consome créditos.
 */
export const AI_OPERATION_ROLES: readonly WorkspaceRole[] = [
  "owner",
  "admin",
  "member",
];

/**
 * Peso de cada operação em créditos (catálogo v1). Provider-agnostic: o
 * crédito conta tentativas aceitas, não tokens. Uma versão futura do
 * catálogo muda os pesos aqui, sem literal espalhado nas callables.
 */
export const AI_CREDIT_COSTS = Object.freeze({
  analysis: 1,
  extractionText: 1,
  extractionDocument: 1,
});

export type AiCreditOperation = keyof typeof AI_CREDIT_COSTS;

/** Teto de saída por chamada: nenhuma chamada produz resposta ilimitada. */
export const AI_MAX_OUTPUT_TOKENS = Object.freeze({
  analysis: 1200,
  extraction: 600,
});

export const ANALYSIS_RATE_LIMIT: RateLimitPolicy = {
  operation: "analyzeFinancialQuestion",
  limit: 20,
  windowSeconds: 60 * 60,
};

export const EXTRACTION_RATE_LIMIT: RateLimitPolicy = {
  operation: "extractTransactionFromContent",
  limit: 60,
  windowSeconds: 60 * 60,
};

/** ~6 MB em base64, cerca de 4,5 MB de arquivo. */
export const MAX_DOCUMENT_BASE64 = 6 * 1024 * 1024;
