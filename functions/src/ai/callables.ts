import {z} from "zod";

import {defineCallable, type CallableFailure} from "../shared/callable";
import {ApplicationError, errorCodeOf} from "../shared/errors";
import {idempotencyKeySchema} from "../shared/ids";
import {AI_CALLABLE_OPTIONS} from "../shared/runtimeOptions";
import type {WorkspaceActor} from "../shared/workspaceAuth";
import {admitAiCall} from "./admission";
import {createGeminiGateway, type AiGateway} from "./gateway";
import {
  AI_MAX_OUTPUT_TOKENS,
  AI_OPERATION_ROLES,
  ANALYSIS_RATE_LIMIT,
  EXTRACTION_RATE_LIMIT,
  MAX_DOCUMENT_BASE64,
} from "./policy";

export {AI_OPERATION_ROLES} from "./policy";

/**
 * Segredo do provider de IA (INV-P2-020).
 *
 * As duas callables usavam `onCall(async …)` sem opções, enquanto `billing.ts`
 * e `stripe.ts` já declaravam `secrets`. Sem a declaração, o Cloud Functions
 * não monta o segredo no ambiente da função: `process.env.GOOGLE_AI_API_KEY`
 * ficava indefinido e **as duas callables falhavam em toda chamada em
 * produção** — fechando corretamente, mas com o recurso simplesmente
 * inoperante.
 *
 * O nome do segredo precisa existir no Secret Manager do projeto; o passo está
 * em `docs/investments/PRODUCTION_DEPLOYMENT_CHECKLIST.md`.
 */
export const AI_SECRETS = ["GOOGLE_AI_API_KEY"] as const;

const AI_OPTIONS = {
  ...AI_CALLABLE_OPTIONS,
  secrets: [...AI_SECRETS],
};

/** Com `workspaceRoles`, o kernel sempre entrega o ator resolvido. */
const requireActor = (actor: WorkspaceActor | null): WorkspaceActor => {
  if (!actor) throw new Error("ai_callable_without_actor");
  return actor;
};

/**
 * Registro de falha do domínio. Log sanitizado: nunca a pergunta, a
 * transcrição, o documento, a resposta do modelo, o payload ou o erro cru.
 */
const logAiFailure = (event: string, operation: string) =>
  ({uid, requestId, error}: CallableFailure): void => {
    console.error(event, {
      operation,
      requestId,
      actorId: uid ?? "anonymous",
      errorCode: errorCodeOf(error),
    });
  };

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
export const analysisPayloadSchema = z
  .object({
    workspaceId: z.string().min(1).max(240),
    // Uma chave por ação intencional do usuário (P2B.2): o reenvio não
    // consome outro crédito nem chama o provedor de novo.
    idempotencyKey: idempotencyKeySchema,
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

export const buildPrompt = (payload: AnalysisPayload): string => {
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
export const readApiKey = (): string => {
  const key = process.env.GOOGLE_AI_API_KEY;
  if (!key || key.length < 8) {
    throw new ApplicationError(
      "domain_precondition_failed",
      "A análise por IA não está configurada neste ambiente.",
    );
  }
  return key;
};

/**
 * Extração estruturada de uma transação a partir de texto falado ou de um
 * comprovante. Mesmo motivo da análise: a chave nunca vai ao cliente.
 */
export const extractionPayloadSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("text"),
      workspaceId: z.string().min(1).max(240),
      idempotencyKey: idempotencyKeySchema,
      transcript: z.string().trim().min(3).max(4_000),
    }),
    z.object({
      kind: z.literal("document"),
      workspaceId: z.string().min(1).max(240),
      idempotencyKey: idempotencyKeySchema,
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

/**
 * Dependências externas das callables de IA: o provedor e o relógio.
 *
 * Em produção, `productionAiDependencies` lê e valida o segredo **antes** da
 * admissão: configuração ausente recusa sem consumir crédito. Os testes
 * montam as callables com um gateway falso (`createAiCallables`).
 */
export interface AiDependencies {
  gateway: AiGateway;
  now: () => number;
}

export const productionAiDependencies = (): AiDependencies => ({
  gateway: createGeminiGateway(readApiKey()),
  now: Date.now,
});

/**
 * Callables de IA sobre o kernel. Ordem fixa em cada chamada: contrato e
 * pré-checagem (kernel) → dependências (segredo) → admissão atômica (crédito,
 * recibo e rate limit num commit) → provedor, fora de qualquer transação.
 */
export const createAiCallables = (dependencies: () => AiDependencies) => ({
  analyzeFinancialQuestion: defineCallable({
    operation: ANALYSIS_RATE_LIMIT.operation,
    schema: analysisPayloadSchema,
    runtime: AI_OPTIONS,
    workspaceRoles: AI_OPERATION_ROLES,
    onFailure: logAiFailure(
      "ai_analysis_failed",
      ANALYSIS_RATE_LIMIT.operation,
    ),
    handler: async ({actor, payload, log}) => {
      const {gateway, now} = dependencies();
      const admission = await admitAiCall({
        actor: requireActor(actor),
        creditOperation: "analysis",
        rateLimit: ANALYSIS_RATE_LIMIT,
        idempotencyKey: payload.idempotencyKey,
        payload,
        now,
      });
      log.info("ai.credit_consumed", {
        periodKey: admission.periodKey,
        creditCost: admission.creditCost,
      });
      // Crédito já confirmado: falha daqui em diante não o devolve.
      const answer = await gateway.generate({
        parts: [{text: buildPrompt(payload)}],
        maxOutputTokens: AI_MAX_OUTPUT_TOKENS.analysis,
      });
      return {
        answer: answer || "Não foi possível processar a análise agora.",
        createdAt: new Date().toISOString(),
      };
    },
  }),

  extractTransactionFromContent: defineCallable({
    operation: EXTRACTION_RATE_LIMIT.operation,
    schema: extractionPayloadSchema,
    runtime: AI_OPTIONS,
    workspaceRoles: AI_OPERATION_ROLES,
    onFailure: logAiFailure(
      "ai_extraction_failed",
      EXTRACTION_RATE_LIMIT.operation,
    ),
    handler: async ({actor, payload, log}) => {
      const {gateway, now} = dependencies();
      const admission = await admitAiCall({
        actor: requireActor(actor),
        creditOperation: payload.kind === "text" ?
          "extractionText" :
          "extractionDocument",
        rateLimit: EXTRACTION_RATE_LIMIT,
        idempotencyKey: payload.idempotencyKey,
        payload,
        now,
      });
      log.info("ai.credit_consumed", {
        periodKey: admission.periodKey,
        creditCost: admission.creditCost,
      });
      // Crédito já confirmado: falha daqui em diante não o devolve.
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
      const text = await gateway.generate({
        parts,
        maxOutputTokens: AI_MAX_OUTPUT_TOKENS.extraction,
        json: true,
      });
      let extracted: unknown;
      try {
        extracted = JSON.parse(text);
      } catch {
        throw new ApplicationError(
          "domain_precondition_failed",
          "Não foi possível interpretar o conteúdo enviado.",
        );
      }
      return {extracted};
    },
  }),
});

export const {analyzeFinancialQuestion, extractTransactionFromContent} =
  createAiCallables(productionAiDependencies);
