import type {Part} from "@google/generative-ai";

import {AI_MODEL} from "./policy";

/**
 * Fronteira com o provedor de IA (P2B.2).
 *
 * As callables só chegam ao provedor por esta interface, e só **depois** do
 * commit do crédito, fora de qualquer transação do Firestore. A implementação
 * real usa o SDK e o modelo atuais; os testes injetam um gateway falso, sem
 * rede e sem credencial. Não é uma camada multi-provedor: provedor e tier
 * são decididos em P5 (D-11).
 */
export type AiContentPart = Part;

export interface AiGenerationRequest {
  parts: AiContentPart[];
  /** Teto de saída desta chamada (`AI_MAX_OUTPUT_TOKENS`). */
  maxOutputTokens: number;
  /** Resposta em JSON (extração estruturada). */
  json?: boolean;
}

export interface AiGateway {
  /** Texto da resposta do modelo (pode vir vazio). */
  generate: (request: AiGenerationRequest) => Promise<string>;
}

type GeminiSdk = Pick<
  typeof import("@google/generative-ai"),
  "GoogleGenerativeAI"
>;

const loadGeminiSdk = (): Promise<GeminiSdk> =>
  import("@google/generative-ai");

/** Gateway real. `loadSdk` existe só para o teste unitário do contrato. */
export const createGeminiGateway = (
  apiKey: string,
  loadSdk: () => Promise<GeminiSdk> = loadGeminiSdk,
): AiGateway => ({
  generate: async (request) => {
    const {GoogleGenerativeAI} = await loadSdk();
    const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
      model: AI_MODEL,
      generationConfig: {
        maxOutputTokens: request.maxOutputTokens,
        ...(request.json ? {responseMimeType: "application/json"} : {}),
      },
    });
    const result = await model.generateContent(request.parts);
    return result.response.text();
  },
});
