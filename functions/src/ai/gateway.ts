import {AI_MODEL, AI_PROVIDER_TIMEOUT_MS} from "./policy";

/**
 * Fronteira com o provedor de IA (P2B.2; SDK trocado na P5-E1, D-11.2).
 *
 * As callables só chegam ao provedor por esta interface, e só **depois** do
 * commit do crédito, fora de qualquer transação do Firestore. A implementação
 * real usa o SDK oficial atual do Google (`@google/genai`; o
 * `@google/generative-ai` perdeu o suporte em 2025-11-30); os testes injetam
 * um gateway falso, sem rede e sem credencial. Não é uma camada
 * multi-provedor.
 *
 * Instruções de sistema e conteúdo do usuário viajam separados
 * (`systemInstruction` × `contents`). Sem repetição automática do SDK: o
 * crédito já foi consumido e uma nova tentativa seria outra cobrança do
 * provedor. O tempo limite por tentativa fica abaixo do tempo da função.
 */
export type AiContentPart =
  | {text: string}
  | {inlineData: {data: string; mimeType: string}};

export interface AiGenerationRequest {
  /** Regras do backend (nunca conteúdo do usuário). */
  systemInstruction: string;
  /** Conteúdo do usuário e dados preparados pelo servidor. */
  parts: AiContentPart[];
  /** Teto de saída desta chamada (`AI_MAX_OUTPUT_TOKENS`). */
  maxOutputTokens: number;
  /** JSON Schema da resposta estruturada (extração); ausente = texto. */
  responseJsonSchema?: Record<string, unknown>;
}

export interface AiGateway {
  /** Texto da resposta do modelo (pode vir vazio). */
  generate: (request: AiGenerationRequest) => Promise<string>;
}

/** Falha do provedor, classificada sem conteúdo nem mensagem do SDK. */
export type AiProviderFailureKind =
  | "timeout"
  | "rate_limited"
  | "rejected"
  | "unavailable"
  | "unknown";

export class AiProviderError extends Error {
  readonly kind: AiProviderFailureKind;
  /** Status HTTP do provedor, quando houver. */
  readonly status: number | null;

  constructor(kind: AiProviderFailureKind, status: number | null) {
    super(`ai_provider_${kind}`);
    this.name = "AiProviderError";
    this.kind = kind;
    this.status = status;
  }
}

/** Classifica o erro do SDK pelo status HTTP; nunca guarda a mensagem. */
export const classifyProviderError = (error: unknown): AiProviderError => {
  if (error instanceof AiProviderError) return error;
  const candidate = (typeof error === "object" && error !== null ?
    error : {}) as {status?: unknown; name?: unknown};
  const status = typeof candidate.status === "number" ?
    candidate.status : null;
  const name = typeof candidate.name === "string" ? candidate.name : "";
  if (name === "AbortError" || name === "TimeoutError" || status === 408) {
    return new AiProviderError("timeout", status);
  }
  if (status === 429) return new AiProviderError("rate_limited", status);
  if (status !== null && status >= 500) {
    return new AiProviderError("unavailable", status);
  }
  if (status !== null && status >= 400) {
    return new AiProviderError("rejected", status);
  }
  return new AiProviderError("unknown", status);
};

/**
 * Aviso anexado quando o provedor interrompe a resposta pelo teto de saída
 * (`finishReason: MAX_TOKENS`): o texto chega incompleto e a pessoa precisa
 * saber. Na extração, o JSON cortado continua inválido e é recusado.
 */
export const AI_TRUNCATED_NOTICE =
  "\n\n(Resposta interrompida pelo limite de tamanho.)";

type GenAiSdk = Pick<typeof import("@google/genai"),
  "GoogleGenAI" | "ThinkingLevel">;

const loadGenAiSdk = (): Promise<GenAiSdk> => import("@google/genai");

/** Gateway real. `loadSdk` existe só para o teste unitário do contrato. */
export const createGeminiGateway = (
  apiKey: string,
  loadSdk: () => Promise<GenAiSdk> = loadGenAiSdk,
): AiGateway => ({
  generate: async (request) => {
    const {GoogleGenAI, ThinkingLevel} = await loadSdk();
    // Sem `retryOptions`: o SDK não repete a chamada sozinho.
    const client = new GoogleGenAI({
      apiKey,
      httpOptions: {timeout: AI_PROVIDER_TIMEOUT_MS},
    });
    try {
      const response = await client.models.generateContent({
        model: AI_MODEL,
        contents: [{role: "user", parts: request.parts}],
        config: {
          systemInstruction: request.systemInstruction,
          maxOutputTokens: request.maxOutputTokens,
          // Raciocínio curto: menos custo e latência, e o teto de saída
          // sobra para a resposta (no modelo com raciocínio, o teto cobre
          // os dois).
          thinkingConfig: {thinkingLevel: ThinkingLevel.LOW},
          ...(request.responseJsonSchema ?
            {
              responseMimeType: "application/json",
              responseJsonSchema: request.responseJsonSchema,
            } :
            {}),
        },
      });
      const text = response.text ?? "";
      const finishReason = String(response.candidates?.[0]?.finishReason ?? "");
      return finishReason === "MAX_TOKENS" && text.trim() !== "" ?
        `${text}${AI_TRUNCATED_NOTICE}` :
        text;
    } catch (error) {
      throw classifyProviderError(error);
    }
  },
});
