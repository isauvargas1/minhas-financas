import assert from "node:assert/strict";

import {insideTransaction} from "../../billing/testSupport/transactionProbe";
import type {FinancialReport} from "../../reports/contract";
import {executeGetFinancialReport} from "../../reports/report";
import {
  rateLimitDocumentId,
  type RateLimitPolicy,
} from "../../shared/rateLimit";
import {
  call,
  db,
  idempotencyKey,
} from "../../workspaces/testSupport/p1TestSupport";
import {
  createAiCallables,
  type AiDependencies,
  type AnalysisAnswer,
} from "../callables";
import {AI_PROVIDER_CONSENT_VERSION, type AiConsentOperation} from
  "../consent";
import type {ExtractionResult} from "../extraction";
import type {AiGenerationRequest} from "../gateway";
import {
  ANALYSIS_CONTEXT_RATE_LIMIT,
  ANALYSIS_RATE_LIMIT,
  EXTRACTION_RATE_LIMIT,
} from "../policy";
import {ANALYSIS_DATA_HEADER, ANALYSIS_QUESTION_HEADER} from "../prompts";

/**
 * Apoio das suítes P5-E1 da IA, só no Emulator.
 *
 * As callables são montadas pela fábrica da produção (`createAiCallables`) e
 * passam pelo kernel inteiro (`.run`). O provedor é falso — nenhuma rede,
 * nenhuma credencial — e recusa ser chamado dentro de uma transação. A
 * leitura do relatório oficial é a real (`executeGetFinancialReport`); o
 * harness só a observa, ou a substitui quando o cenário exige falha.
 */

export const consent = (operation: AiConsentOperation) => ({
  version: AI_PROVIDER_CONSENT_VERSION,
  operation,
  confirmed: true,
});

/** Resposta estruturada válida da extração. */
export const extractionJson = (
  fields: Record<string, unknown> = {},
): string => JSON.stringify({
  outcome: "extracted",
  operation: "expense",
  description: "Almoço",
  amount: "45.00",
  date: null,
  categoryHint: "Alimentação",
  supplier: null,
  costCenterHint: null,
  installments: null,
  ambiguousFields: [],
  ...fields,
});

export type Respond = (request: AiGenerationRequest) => Promise<string>;

export const defaultRespond: Respond = async (request) =>
  request.responseJsonSchema ? extractionJson() : "Resposta da IA de teste.";

export interface ReportRead {
  actor: Parameters<typeof executeGetFinancialReport>[0];
  payload: Parameters<typeof executeGetFinancialReport>[1];
  /** Opção pedida pelo consultor: sem ranking de clientes. */
  omitTopClients: boolean | undefined;
}

export interface AiHarnessOptions {
  now?: () => number;
  respond?: Respond;
  /** Substitui a leitura oficial (falha, fonte indisponível, permissão). */
  readReport?: AiDependencies["readReport"];
}

/** PNG mínimo válido nos primeiros bytes (a assinatura é conferida). */
export const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";

export const aiHarness = (options: AiHarnessOptions = {}) => {
  const calls: AiGenerationRequest[] = [];
  const reads: ReportRead[] = [];
  const reports: FinancialReport[] = [];
  const readReport: NonNullable<AiDependencies["readReport"]> = async (
    actor, payload, now, context,
  ) => {
    reads.push({actor, payload, omitTopClients: context?.omitTopClients});
    const report = await (options.readReport ?? executeGetFinancialReport)(
      actor, payload, now, context);
    reports.push(report);
    return report;
  };
  const callables = createAiCallables(() => ({
    now: options.now ?? Date.now,
    readReport,
    gateway: {
      generate: async (request) => {
        if (insideTransaction()) {
          throw new Error("provedor chamado dentro de uma transação");
        }
        calls.push(request);
        return (options.respond ?? defaultRespond)(request);
      },
    },
  }));
  const analyze = (
    uid: string | null,
    workspaceId: string,
    overrides: Record<string, unknown> = {},
  ) => call<AnalysisAnswer>(callables.analyzeFinancialQuestion, uid, {
    workspaceId,
    idempotencyKey: idempotencyKey(),
    question: "Como está minha saúde financeira?",
    range: {kind: "preset", preset: "30d"},
    providerConsent: consent("analysis"),
    ...overrides,
  });
  const extractText = (
    uid: string | null,
    workspaceId: string,
    overrides: Record<string, unknown> = {},
  ) => call<{extraction: ExtractionResult}>(
    callables.extractTransactionFromContent, uid, {
      kind: "text",
      workspaceId,
      idempotencyKey: idempotencyKey(),
      transcript: "Almoço de R$ 45,00 hoje",
      providerConsent: consent("extraction_text"),
      ...overrides,
    });
  const extractDocument = (
    uid: string | null,
    workspaceId: string,
    overrides: Record<string, unknown> = {},
  ) => call<{extraction: ExtractionResult}>(
    callables.extractTransactionFromContent, uid, {
      kind: "document",
      workspaceId,
      idempotencyKey: idempotencyKey(),
      mimeType: "image/png",
      dataBase64: PNG_BASE64,
      providerConsent: consent("extraction_document"),
      ...overrides,
    });
  return {calls, reads, reports, callables, analyze, extractText,
    extractDocument};
};

/** Bloco de dados enviado ao provedor (JSON preparado pelo servidor). */
export const analysisDataOf = (
  request: AiGenerationRequest,
): Record<string, unknown> => {
  const first = request.parts[0];
  assert.ok(first && "text" in first, "primeira parte é o bloco de dados");
  assert.ok(first.text.startsWith(`${ANALYSIS_DATA_HEADER}\n`),
    "cabeçalho do bloco de dados");
  return JSON.parse(first.text.slice(ANALYSIS_DATA_HEADER.length + 1)) as
    Record<string, unknown>;
};

/** Pergunta enviada ao provedor (parte própria, marcada como não confiável). */
export const analysisQuestionOf = (request: AiGenerationRequest): string => {
  const second = request.parts[1];
  assert.ok(second && "text" in second, "segunda parte é a pergunta");
  assert.ok(second.text.startsWith(`${ANALYSIS_QUESTION_HEADER}\n`),
    "cabeçalho da pergunta");
  return second.text.slice(ANALYSIS_QUESTION_HEADER.length + 1);
};

/** Todo o texto que saiu para o provedor numa chamada. */
export const providerTextOf = (request: AiGenerationRequest): string =>
  [request.systemInstruction, ...request.parts.map((part) =>
    "text" in part ? part.text : `${part.inlineData.mimeType}:` +
      part.inlineData.data)].join("\n");

export const rateLimitRef = (
  workspaceId: string,
  uid: string,
  policy: RateLimitPolicy,
) => db().doc(
  `workspaces/${workspaceId}/rate_limits/${rateLimitDocumentId(policy, uid)}`,
);

const usageDoc = (owner: string, monthKey: string) =>
  db().doc(`billing_accounts/${owner}/ai_usage/${monthKey}`).get();

/** Créditos usados no mês (0 quando o contador ainda não existe). */
export const usedCredits = async (
  owner: string,
  monthKey: string,
): Promise<number> =>
  Number((await usageDoc(owner, monthKey)).get("usedCredits") ?? 0);

export const receiptsOf = async (actor: string) =>
  (await db().collection(`users/${actor}/ai_usage_receipts`).get()).docs;

/**
 * Nada consumido pela chamada recusada: nenhum crédito no pool do titular,
 * nenhum recibo do ator, nenhum dos três limites (análise, extração e
 * leitura de contexto) reservado.
 */
export const assertNothingConsumed = async (
  input: {owner: string; actor: string; workspaceId: string; monthKey: string},
): Promise<void> => {
  assert.equal(await usedCredits(input.owner, input.monthKey), 0,
    "crédito consumido");
  assert.equal((await receiptsOf(input.actor)).length, 0, "recibo gravado");
  for (const policy of [ANALYSIS_RATE_LIMIT, EXTRACTION_RATE_LIMIT,
    ANALYSIS_CONTEXT_RATE_LIMIT]) {
    assert.equal(
      (await rateLimitRef(input.workspaceId, input.actor, policy).get())
        .exists,
      false,
      `limite ${policy.operation} reservado`,
    );
  }
};

/** Lançamentos e movimentos financeiros do workspace (prova de não escrita). */
export const financialWritesOf = async (workspaceId: string) => {
  const counts: Record<string, number> = {};
  for (const collection of ["transactions", "cash_account_movements",
    "credit_card_purchases", "loans", "receivables"]) {
    counts[collection] = (await db()
      .collection(`workspaces/${workspaceId}/${collection}`).count().get())
      .data().count;
  }
  return counts;
};
