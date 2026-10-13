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

/**
 * Modelo atual (D-11.2, verificação documental na P5-E1). É um modelo
 * *preview* do Gemini: sem data de desligamento anunciada, mas com aviso
 * mínimo de duas semanas e fora das garantias de produto GA. A troca para um
 * modelo GA (candidatos e comparação em `docs/production/evidence/p5e1/`)
 * depende de conferência ao vivo da documentação e de avaliação em STAGING;
 * até lá o identificador fica num único lugar.
 */
export const AI_MODEL = "gemini-3-flash-preview";

/**
 * Tempo limite por tentativa na chamada ao provedor, abaixo dos 120 s da
 * callable (`AI_CALLABLE_OPTIONS`), com folga para a resposta ao cliente.
 */
export const AI_PROVIDER_TIMEOUT_MS = 90_000;

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

/**
 * Teto de saída por chamada: nenhuma chamada produz resposta ilimitada. No
 * modelo com raciocínio o teto cobre raciocínio e resposta; o raciocínio vai
 * em nível baixo (`gateway.ts`) e o teto deixa folga para a resposta
 * completa — um JSON de extração truncado seria crédito perdido.
 */
export const AI_MAX_OUTPUT_TOKENS = Object.freeze({
  analysis: 2048,
  extraction: 1024,
});

export const ANALYSIS_RATE_LIMIT: RateLimitPolicy = {
  operation: "analyzeFinancialQuestion",
  limit: 20,
  windowSeconds: 60 * 60,
};

/**
 * Leitura do contexto financeiro oficial do consultor (P5-E1): limita quantas
 * vezes por hora o relatório é montado para a IA, por ator e workspace,
 * mesmo quando a admissão depois recusa (créditos esgotados, chave repetida).
 * Reservado antes da leitura e antes da admissão; não é crédito.
 */
export const ANALYSIS_CONTEXT_RATE_LIMIT: RateLimitPolicy = {
  operation: "analyzeFinancialQuestionContext",
  limit: 60,
  windowSeconds: 60 * 60,
};

export const EXTRACTION_RATE_LIMIT: RateLimitPolicy = {
  operation: "extractTransactionFromContent",
  limit: 60,
  windowSeconds: 60 * 60,
};

/** ~6 MB em base64, cerca de 4,5 MB de arquivo. */
export const MAX_DOCUMENT_BASE64 = 6 * 1024 * 1024;
