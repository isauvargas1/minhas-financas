import * as admin from "firebase-admin";
import {z} from "zod";

import type {FinancialReport} from "../reports/contract";
import {reportRangeSchema} from "../reports/contract";
import {executeGetFinancialReport} from "../reports/report";
import {defineCallable, type CallableFailure} from "../shared/callable";
import {saoPauloDayKey} from "../shared/dateKeys";
import {ApplicationError, errorCodeOf} from "../shared/errors";
import {idempotencyKeySchema} from "../shared/ids";
import type {OperationLogger} from "../shared/logger";
import {reserveRateLimit} from "../shared/rateLimit";
import {AI_CALLABLE_OPTIONS} from "../shared/runtimeOptions";
import {
  reassertWorkspaceActor,
  type WorkspaceActor,
  type WorkspaceRole,
} from "../shared/workspaceAuth";
import {admitAiCall} from "./admission";
import {
  ANALYSIS_REPORT_SECTIONS,
  buildAnalysisContext,
  renderAnalysisData,
  type AnalysisContext,
  type CoverageLabel,
} from "./analysisContext";
import {assertProviderConsent, providerConsentSchema} from "./consent";
import {
  EXTRACTION_RESPONSE_SCHEMA,
  EXTRACTION_SYSTEM_INSTRUCTION,
  ExtractionResponseError,
  parseExtractionResponse,
  type ExtractionResult,
} from "./extraction";
import {
  AiProviderError,
  classifyProviderError,
  createGeminiGateway,
  type AiGateway,
} from "./gateway";
import {
  AI_MAX_OUTPUT_TOKENS,
  AI_OPERATION_ROLES,
  ANALYSIS_CONTEXT_RATE_LIMIT,
  ANALYSIS_RATE_LIMIT,
  EXTRACTION_RATE_LIMIT,
  MAX_DOCUMENT_BASE64,
} from "./policy";
import {
  ANALYSIS_ANSWER_MAX_CHARS,
  ANALYSIS_DATA_HEADER,
  ANALYSIS_QUESTION_HEADER,
  EXTRACTION_DOCUMENT_REQUEST,
  EXTRACTION_TEXT_HEADER,
  analysisSystemInstruction,
  sanitizeUserText,
} from "./prompts";

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
 * A classe e o status HTTP da falha do provedor vão no evento
 * `ai.provider_failed`, registrado antes da conversão do erro.
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
 * Consultor financeiro por IA (P5-E1, D-11.1).
 *
 * O navegador informa só a pergunta, o período (o mesmo contrato dos
 * Relatórios), a chave de idempotência da intenção e a confirmação de envio.
 * Nenhum valor financeiro vem do cliente: o schema estrito recusa `context`,
 * indicadores, perfil PF/PJ ou papel. O backend lê o relatório oficial
 * (`executeGetFinancialReport`, a mesma fonte do Dashboard e dos Relatórios,
 * com o papel relido decidindo o que entra), monta o contexto mínimo e só
 * então admite a chamada.
 *
 * Prompt e resposta são dado do usuário: nada disso é registrado em log. Só
 * saem identificadores, contagens e código de erro.
 */
export const analysisPayloadSchema = z
  .object({
    workspaceId: z.string().min(1).max(240),
    // Uma chave por intenção do usuário (P2B.2): a repetição da mesma
    // intenção (retry de rede, duplo clique) não consome outro crédito nem
    // chama o provedor de novo.
    idempotencyKey: idempotencyKeySchema,
    question: z.string().trim().min(3).max(2_000),
    range: reportRangeSchema,
    providerConsent: providerConsentSchema.optional(),
  })
  .strict();

type AnalysisPayload = z.infer<typeof analysisPayloadSchema>;

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

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Extração estruturada de uma operação a partir de texto falado ou de um
 * comprovante (P5-E1, D-11.3, D-11.4). O resultado só pré-preenche o
 * formulário: nada é gravado aqui.
 */
export const extractionPayloadSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("text"),
      workspaceId: z.string().min(1).max(240),
      idempotencyKey: idempotencyKeySchema,
      transcript: z.string().trim().min(3).max(4_000),
      providerConsent: providerConsentSchema.optional(),
    }).strict(),
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
      dataBase64: z.string().min(16).max(MAX_DOCUMENT_BASE64)
        .refine((value) => value.length % 4 === 0 &&
          BASE64_PATTERN.test(value), "Arquivo em base64 inválido."),
      providerConsent: providerConsentSchema.optional(),
    }).strict(),
  ]);

type ExtractionPayload = z.infer<typeof extractionPayloadSchema>;

/** Assinatura (primeiros bytes) de cada tipo aceito. */
const matchesSignature = (mimeType: string, bytes: Buffer): boolean => {
  const startsWith = (signature: number[], offset = 0) =>
    signature.every((byte, index) => bytes[offset + index] === byte);
  switch (mimeType) {
  case "image/png":
    return startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  case "image/jpeg":
    return startsWith([0xff, 0xd8, 0xff]);
  case "image/webp":
    return startsWith([0x52, 0x49, 0x46, 0x46]) &&
      startsWith([0x57, 0x45, 0x42, 0x50], 8);
  case "application/pdf":
    return startsWith([0x25, 0x50, 0x44, 0x46, 0x2d]);
  default:
    return false;
  }
};

export const DOCUMENT_TYPE_MISMATCH_MESSAGE =
  "O arquivo não corresponde ao tipo informado. Envie uma imagem PNG, JPEG " +
  "ou WEBP, ou um PDF. Nada foi enviado e nenhum crédito foi usado.";

/**
 * O conteúdo precisa ser do tipo declarado (a extensão ou o `File.type` do
 * navegador não bastam). Recusado antes da admissão: sem crédito.
 */
export const assertDocumentSignature = (
  mimeType: string,
  dataBase64: string,
): void => {
  const head = Buffer.from(dataBase64.slice(0, 32), "base64");
  if (!matchesSignature(mimeType, head)) {
    throw new ApplicationError("invalid_payload",
      DOCUMENT_TYPE_MISMATCH_MESSAGE);
  }
};

export const AI_PROVIDER_FAILED_REASON = "ai_provider_failed";

const PROVIDER_FAILURE_MESSAGES: Record<AiProviderError["kind"], string> = {
  timeout: "O serviço de IA demorou demais para responder.",
  rate_limited: "O serviço de IA está sobrecarregado no momento.",
  rejected: "O serviço de IA recusou o conteúdo enviado.",
  unavailable: "O serviço de IA está indisponível no momento.",
  unknown: "Não foi possível concluir a consulta ao serviço de IA.",
};

/** Política P2B.2: o crédito da tentativa aceita não é devolvido. */
const CREDIT_KEPT_NOTICE =
  " A tentativa foi contabilizada nos créditos de IA do plano. Tente " +
  "novamente mais tarde.";

const providerFailure = (error: unknown): ApplicationError => {
  const failure = classifyProviderError(error);
  return new ApplicationError(
    "domain_precondition_failed",
    PROVIDER_FAILURE_MESSAGES[failure.kind] + CREDIT_KEPT_NOTICE,
    {reason: AI_PROVIDER_FAILED_REASON},
  );
};

/** Chama o provedor; qualquer falha vira erro pt-BR sem detalhe interno. */
const callProvider = async (
  gateway: AiGateway,
  request: Parameters<AiGateway["generate"]>[0],
  log: OperationLogger,
): Promise<string> => {
  try {
    return await gateway.generate(request);
  } catch (error) {
    const failure = classifyProviderError(error);
    log.warn("ai.provider_failed", {
      providerFailure: failure.kind,
      providerStatus: failure.status,
    });
    throw providerFailure(failure);
  }
};

export const ANALYSIS_EMPTY_ANSWER_MESSAGE =
  "A IA não devolveu uma resposta válida." + CREDIT_KEPT_NOTICE;

/**
 * Resposta do consultor: texto não confiável. Sem caracteres de controle,
 * não vazia e com teto de tamanho; o cliente a exibe como texto, sem HTML.
 */
export const validateAnalysisAnswer = (text: string): string => {
  const clean = sanitizeUserText(text);
  if (clean.length === 0) {
    throw new ApplicationError("domain_precondition_failed",
      ANALYSIS_EMPTY_ANSWER_MESSAGE, {reason: AI_PROVIDER_FAILED_REASON});
  }
  return clean.length > ANALYSIS_ANSWER_MAX_CHARS ?
    `${clean.slice(0, ANALYSIS_ANSWER_MAX_CHARS).trimEnd()}…` :
    clean;
};

export const EXTRACTION_INVALID_RESPONSE_MESSAGE =
  "A IA não devolveu dados válidos para preencher o formulário. Nenhum " +
  "campo foi preenchido." + CREDIT_KEPT_NOTICE;

/** Partes do pedido ao provedor para o consultor (exportado para testes). */
export const analysisParts = (
  context: AnalysisContext,
  question: string,
) => [
  {text: `${ANALYSIS_DATA_HEADER}\n${renderAnalysisData(context)}`},
  {text: `${ANALYSIS_QUESTION_HEADER}\n${sanitizeUserText(question)}`},
];

/** Partes do pedido ao provedor para a extração (exportado para testes). */
export const extractionParts = (payload: ExtractionPayload) =>
  payload.kind === "text" ?
    [{text: `${EXTRACTION_TEXT_HEADER}\n${
      sanitizeUserText(payload.transcript)}`}] :
    [
      {inlineData: {data: payload.dataBase64, mimeType: payload.mimeType}},
      {text: EXTRACTION_DOCUMENT_REQUEST},
    ];

/**
 * Dependências externas das callables de IA: o provedor, o relógio e a
 * leitura do relatório oficial.
 *
 * Em produção, `productionAiDependencies` lê e valida o segredo **antes** da
 * admissão: configuração ausente recusa sem consumir crédito. Os testes
 * montam as callables com um gateway falso (`createAiCallables`) e podem
 * injetar falha na leitura do relatório, sem gancho global.
 */
export interface AiDependencies {
  gateway: AiGateway;
  now: () => number;
  readReport?: typeof executeGetFinancialReport;
}

export const productionAiDependencies = (): AiDependencies => ({
  gateway: createGeminiGateway(readApiKey()),
  now: Date.now,
});

/**
 * Transação de contexto do consultor, antes de qualquer leitura financeira:
 * relê a autorização (conta, workspace ativo, membership e papel atual na
 * matriz da IA, como `getFinancialReport` relê para o relatório) e reserva o
 * limite de leitura de contexto. Recusa = nada lido, nenhum crédito.
 */
const reserveAnalysisContext = async (
  actor: WorkspaceActor,
): Promise<WorkspaceRole> => admin.firestore().runTransaction(
  async (transaction) => {
    const access = await reassertWorkspaceActor(
      transaction, actor, AI_OPERATION_ROLES);
    const reservation = await reserveRateLimit(transaction,
      actor.workspaceId, actor.uid, ANALYSIS_CONTEXT_RATE_LIMIT);
    reservation.commit();
    return access.role;
  },
);

export interface AnalysisAnswer {
  answer: string;
  createdAt: string;
  workspaceType: "PF" | "PJ";
  period: AnalysisContext["period"];
  /** Cobertura de cada bloco enviado ao modelo. */
  coverage: Record<string, CoverageLabel>;
}

const coverageOf = (context: AnalysisContext): Record<string, CoverageLabel> =>
  Object.fromEntries(ANALYSIS_REPORT_SECTIONS.map((section) =>
    [section, context[section].coverage]));

/**
 * Callables de IA sobre o kernel. Ordem fixa em cada chamada:
 * contrato e pré-checagem (kernel: conta, workspace, membership, papel) →
 * confirmação de envio → dependências (segredo) → [consultor: transação de
 * contexto com o papel relido → relatório oficial sem ranking de
 * clientes → contexto mínimo] →
 * [extração: assinatura do arquivo] → admissão atômica (crédito, recibo e
 * rate limit num commit) → provedor, fora de qualquer transação → validação
 * da resposta.
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
    handler: async ({actor, payload, log, trustWorkspace}):
      Promise<AnalysisAnswer> => {
      const resolved = requireActor(actor);
      assertProviderConsent(payload.providerConsent, "analysis");
      const {gateway, now, readReport} = dependencies();
      const role = await reserveAnalysisContext(resolved);
      // O papel relido decide o que o relatório entrega (ex.: patrimônio).
      const current: WorkspaceActor = {...resolved, role};
      trustWorkspace(current.workspaceId, role);
      const report: FinancialReport = await (readReport ??
        executeGetFinancialReport)(
        current,
        {
          workspaceId: current.workspaceId,
          range: payload.range,
          sections: [...ANALYSIS_REPORT_SECTIONS],
        },
        new Date(now()),
        // O contexto usa só agregados: sem ranking de clientes (amostra de
        // até 500 leituras, com nomes) em PJ.
        {log, omitTopClients: true},
      );
      // Contexto e partes prontos antes da admissão: relatório malformado
      // falha aqui, sem consumir crédito.
      const context = buildAnalysisContext(report);
      const parts = analysisParts(context, payload.question);
      const admission = await admitAiCall({
        actor: current,
        creditOperation: "analysis",
        rateLimit: ANALYSIS_RATE_LIMIT,
        idempotencyKey: payload.idempotencyKey,
        payload: payload as AnalysisPayload,
        now,
      });
      log.info("ai.credit_consumed", {
        periodKey: admission.periodKey,
        creditCost: admission.creditCost,
        creditDebitId: admission.receiptId,
      });
      // Crédito já confirmado: falha daqui em diante não o devolve.
      const text = await callProvider(gateway, {
        systemInstruction: analysisSystemInstruction(context.workspaceType),
        parts,
        maxOutputTokens: AI_MAX_OUTPUT_TOKENS.analysis,
      }, log);
      return {
        answer: validateAnalysisAnswer(text),
        createdAt: new Date(now()).toISOString(),
        workspaceType: context.workspaceType,
        period: context.period,
        coverage: coverageOf(context),
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
    handler: async ({actor, payload, log}):
      Promise<{extraction: ExtractionResult}> => {
      const resolved = requireActor(actor);
      assertProviderConsent(payload.providerConsent,
        payload.kind === "text" ? "extraction_text" : "extraction_document");
      if (payload.kind === "document") {
        assertDocumentSignature(payload.mimeType, payload.dataBase64);
      }
      const {gateway, now} = dependencies();
      const admission = await admitAiCall({
        actor: resolved,
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
        creditDebitId: admission.receiptId,
      });
      // Crédito já confirmado: falha daqui em diante não o devolve.
      const text = await callProvider(gateway, {
        systemInstruction: EXTRACTION_SYSTEM_INSTRUCTION,
        parts: extractionParts(payload),
        maxOutputTokens: AI_MAX_OUTPUT_TOKENS.extraction,
        responseJsonSchema: EXTRACTION_RESPONSE_SCHEMA,
      }, log);
      try {
        const extraction = parseExtractionResponse(text,
          saoPauloDayKey(new Date(now())));
        log.info("ai.extraction_result", {status: extraction.status});
        return {extraction};
      } catch (error) {
        if (!(error instanceof ExtractionResponseError)) throw error;
        log.warn("ai.extraction_invalid_response", {reason: error.code});
        throw new ApplicationError("domain_precondition_failed",
          EXTRACTION_INVALID_RESPONSE_MESSAGE,
          {reason: AI_PROVIDER_FAILED_REASON});
      }
    },
  }),
});

export const {analyzeFinancialQuestion, extractTransactionFromContent} =
  createAiCallables(productionAiDependencies);
