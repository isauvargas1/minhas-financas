import * as admin from "firebase-admin";
import {onCall} from "firebase-functions/v2/https";
import {z} from "zod";

import {requireWorkspaceRole} from "../creditCards/auth";
import {CreditCardApplicationError} from "../creditCards/errors";
import {toInvestmentHttpsError} from "../investments/errors";
import {consumeRateLimit, type RateLimitPolicy} from "../shared/rateLimit";

/**
 * Análise financeira por IA, exclusivamente no backend.
 *
 * Antes, o cliente Gemini era instanciado no navegador com a chave vinda de
 * `VITE_GOOGLE_AI_KEY`. Variável `VITE_*` é embutida no bundle: a credencial
 * ficava legível para qualquer visitante do site, e qualquer pessoa podia
 * gastar a cota da conta. A chave passa a existir apenas aqui, em variável de
 * ambiente do backend, e o cliente só envia a pergunta.
 *
 * Prompt e resposta são dado do usuário: nada disso é registrado em log. Só
 * saem identificadores, contagens e código de erro.
 */

const ANALYSIS_POLICY: RateLimitPolicy = {
  operation: "analyzeFinancialQuestion",
  limit: 20,
  windowSeconds: 60 * 60,
};

const analysisPayloadSchema = z
  .object({
    workspaceId: z.string().min(1).max(240),
    question: z.string().trim().min(3).max(2_000),
    // Resumo já calculado no cliente, apenas números e rótulos agregados.
    context: z
      .object({
        profileType: z.enum(["PF", "PJ"]),
        periodLabel: z.string().max(120),
        kpis: z
          .array(
            z.object({
              label: z.string().max(120),
              formattedValue: z.string().max(60),
            }),
          )
          .max(40),
        topCategories: z.array(z.string().max(120)).max(10),
        alerts: z.array(z.string().max(400)).max(20),
      })
      .strict(),
  })
  .strict();

type AnalysisPayload = z.infer<typeof analysisPayloadSchema>;

const buildPrompt = (payload: AnalysisPayload): string => {
  const {context} = payload;
  const kpis = context.kpis
    .map((entry) => `${entry.label}: ${entry.formattedValue}`)
    .join("; ");
  const alerts = context.alerts.join("\n") || "Nenhum alerta relevante.";
  const persona = context.profileType === "PJ" ?
    [
      "--- MODO CONSULTOR ESTRATÉGICO (PJ) ---",
      "Persona: CFO virtual sênior, focado em eficiência operacional e liquidez.",
      "Avalie cobertura de juros, sustentabilidade do caixa e alavancagem.",
    ].join("\n") :
    [
      "--- MODO FINANÇAS PESSOAIS (PF) ---",
      "Persona: consultor financeiro pessoal, direto e acolhedor.",
    ].join("\n");

  return [
    "Você é uma IA integrada a um painel financeiro.",
    persona,
    `Período: ${context.periodLabel}`,
    `Indicadores: ${kpis}`,
    `Maiores saídas: ${context.topCategories.join(", ") || "não informado"}`,
    `Alertas: ${alerts}`,
    `Pergunta do usuário: "${payload.question}"`,
    "Responda em português do Brasil, em Markdown, usando bullets para " +
      "recomendações. Não invente números que não estejam nos dados acima.",
  ].join("\n\n");
};

/** Chave lida só do ambiente do backend; ausência é erro, não default. */
const readApiKey = (): string => {
  const key = process.env.GOOGLE_AI_API_KEY;
  if (!key || key.length < 8) {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      "A análise por IA não está configurada neste ambiente.",
    );
  }
  return key;
};

const callGemini = async (prompt: string, apiKey: string): Promise<string> => {
  const {GoogleGenerativeAI} = await import("@google/generative-ai");
  const client = new GoogleGenerativeAI(apiKey);
  const model = client.getGenerativeModel({model: "gemini-3-flash-preview"});
  const result = await model.generateContent([prompt]);
  return result.response.text();
};

export const analyzeFinancialQuestion = onCall(async (request) => {
  try {
    const payload = analysisPayloadSchema.parse(request.data);
    const auth = await requireWorkspaceRole(request, payload.workspaceId, [
      "owner",
      "admin",
      "member",
    ]);
    // Limite verificado e consumido atomicamente antes de gastar cota externa.
    await admin.firestore().runTransaction(async (transaction) => {
      await consumeRateLimit(
        transaction,
        auth.workspaceId,
        auth.uid,
        ANALYSIS_POLICY,
      );
    });
    const answer = await callGemini(buildPrompt(payload), readApiKey());
    return {
      answer: answer || "Não foi possível processar a análise agora.",
      createdAt: new Date().toISOString(),
    };
  } catch (error) {
    // Log sanitizado: nunca a pergunta, a resposta, o payload ou o erro cru.
    console.error("ai_analysis_failed", {
      operation: ANALYSIS_POLICY.operation,
      actorId: request.auth?.uid ?? "anonymous",
      errorCode:
        error instanceof CreditCardApplicationError ? error.code : "unknown",
    });
    throw toInvestmentHttpsError(error);
  }
});

/**
 * Extração estruturada de uma transação a partir de texto falado ou de um
 * comprovante. Mesmo motivo da análise: a chave nunca vai ao cliente.
 */
const EXTRACTION_POLICY: RateLimitPolicy = {
  operation: "extractTransactionFromContent",
  limit: 60,
  windowSeconds: 60 * 60,
};

/** ~6 MB em base64, cerca de 4,5 MB de arquivo. */
const MAX_DOCUMENT_BASE64 = 6 * 1024 * 1024;

const extractionPayloadSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("text"),
      workspaceId: z.string().min(1).max(240),
      transcript: z.string().trim().min(3).max(4_000),
    }),
    z.object({
      kind: z.literal("document"),
      workspaceId: z.string().min(1).max(240),
      mimeType: z.enum([
        "image/png",
        "image/jpeg",
        "image/webp",
        "application/pdf",
      ]),
      dataBase64: z.string().min(16).max(MAX_DOCUMENT_BASE64),
    }),
  ]);

const EXTRACTION_INSTRUCTION =
  "O conteúdo descreve uma transação financeira. Extraia os dados e responda " +
  "somente com JSON, sem texto ao redor. Campos: type (receita, despesa, " +
  "investimento, parcelado), description, value (número), date (YYYY-MM-DD), " +
  "category, supplier, costCenter, installments. Omita o campo quando não " +
  "houver informação; nunca invente valores.";

export const extractTransactionFromContent = onCall(async (request) => {
  try {
    const payload = extractionPayloadSchema.parse(request.data);
    const auth = await requireWorkspaceRole(request, payload.workspaceId, [
      "owner",
      "admin",
      "member",
    ]);
    await admin.firestore().runTransaction(async (transaction) => {
      await consumeRateLimit(
        transaction,
        auth.workspaceId,
        auth.uid,
        EXTRACTION_POLICY,
      );
    });

    const apiKey = readApiKey();
    const {GoogleGenerativeAI} = await import("@google/generative-ai");
    const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
      model: "gemini-3-flash-preview",
      generationConfig: {responseMimeType: "application/json"},
    });
    const parts = payload.kind === "text" ?
      [{text: `${EXTRACTION_INSTRUCTION}\n\n${payload.transcript}`}] :
      [
        {
          inlineData: {
            data: payload.dataBase64,
            mimeType: payload.mimeType,
          },
        },
        {text: EXTRACTION_INSTRUCTION},
      ];
    const result = await model.generateContent(parts);
    const text = result.response.text();
    let extracted: unknown;
    try {
      extracted = JSON.parse(text);
    } catch {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "Não foi possível interpretar o conteúdo enviado.",
      );
    }
    return {extracted};
  } catch (error) {
    // Nunca registra transcrição, documento nem resposta do modelo.
    console.error("ai_extraction_failed", {
      operation: EXTRACTION_POLICY.operation,
      actorId: request.auth?.uid ?? "anonymous",
      errorCode:
        error instanceof CreditCardApplicationError ? error.code : "unknown",
    });
    throw toInvestmentHttpsError(error);
  }
});
