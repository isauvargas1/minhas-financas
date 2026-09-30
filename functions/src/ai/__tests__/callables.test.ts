import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import test from "node:test";

import {
  AI_OPERATION_ROLES,
  AI_SECRETS,
  analysisPayloadSchema,
  analyzeFinancialQuestion,
  buildPrompt,
  extractTransactionFromContent,
  extractionPayloadSchema,
  readApiKey,
} from "../callables";
import {createGeminiGateway} from "../gateway";
import {
  AI_CREDIT_COSTS,
  AI_MAX_OUTPUT_TOKENS,
  AI_MODEL,
  MAX_DOCUMENT_BASE64,
} from "../policy";
import {ApplicationError} from "../../shared/errors";
import {RETENTION_DAYS} from "../../shared/retention";
import {AI_CALLABLE_OPTIONS} from "../../shared/runtimeOptions";

/**
 * Comportamento das callables de IA (INV-P2-020).
 *
 * A auditoria registrou duas coisas: as duas callables não declaravam
 * `secrets` — e portanto falhavam em **toda** chamada em produção, porque o
 * Cloud Functions não monta o segredo no ambiente sem a declaração — e não
 * havia teste nenhum do comportamento delas além da guarda de bundle.
 *
 * Nenhum destes testes precisa de chave real: o que se verifica é a
 * declaração, a recusa controlada sem segredo, a validação de entrada e o que
 * o prompt carrega.
 */

const analysisPayload = () => analysisPayloadSchema.parse({
  workspaceId: "workspace-a",
  idempotencyKey: "idem-analise-0001",
  question: "Como está minha taxa de poupança?",
  context: {
    profileType: "PF",
    periodLabel: "Últimos 30 dias",
    kpis: [{label: "Receitas", value: 5000, formattedValue: "R$ 5.000,00"}],
    topCategories: ["Alimentação", "Moradia"],
    alerts: [],
  },
});

test("o segredo do provider é declarado pelas callables", () => {
  // Sem esta declaração, `process.env.GOOGLE_AI_API_KEY` fica indefinido em
  // produção e as duas callables falham em toda chamada.
  assert.deepEqual([...AI_SECRETS], ["GOOGLE_AI_API_KEY"]);
});

test("as callables do kernel mantêm segredo, recursos e papéis de escrita",
  () => {
    for (const callable of [
      analyzeFinancialQuestion,
      extractTransactionFromContent,
    ]) {
      const endpoint = (callable as unknown as {
        __endpoint: {
          timeoutSeconds?: number;
          secretEnvironmentVariables?: Array<{key: string}>;
        };
      }).__endpoint;
      assert.equal(endpoint.timeoutSeconds, AI_CALLABLE_OPTIONS.timeoutSeconds);
      assert.deepEqual(
        (endpoint.secretEnvironmentVariables ?? []).map((entry) => entry.key),
        [...AI_SECRETS],
      );
    }
    // `viewer` é somente leitura: não consome a cota externa do workspace.
    assert.deepEqual([...AI_OPERATION_ROLES], ["owner", "admin", "member"]);
  });

test("sem segredo configurado, a recusa é explícita e em pt-BR", () => {
  const previous = process.env.GOOGLE_AI_API_KEY;
  delete process.env.GOOGLE_AI_API_KEY;
  try {
    assert.throws(
      () => readApiKey(),
      (error: unknown) =>
        error instanceof ApplicationError &&
        error.code === "domain_precondition_failed" &&
        /não está configurada/i.test(error.message),
    );
  } finally {
    if (previous === undefined) delete process.env.GOOGLE_AI_API_KEY;
    else process.env.GOOGLE_AI_API_KEY = previous;
  }
});

test("chave curta demais é tratada como ausente, não como válida", () => {
  const previous = process.env.GOOGLE_AI_API_KEY;
  process.env.GOOGLE_AI_API_KEY = "curta";
  try {
    assert.throws(() => readApiKey());
  } finally {
    if (previous === undefined) delete process.env.GOOGLE_AI_API_KEY;
    else process.env.GOOGLE_AI_API_KEY = previous;
  }
});

test("com segredo configurado, a chave é devolvida sem transformação", () => {
  const previous = process.env.GOOGLE_AI_API_KEY;
  process.env.GOOGLE_AI_API_KEY = "chave-de-teste-suficientemente-longa";
  try {
    assert.equal(readApiKey(), "chave-de-teste-suficientemente-longa");
  } finally {
    if (previous === undefined) delete process.env.GOOGLE_AI_API_KEY;
    else process.env.GOOGLE_AI_API_KEY = previous;
  }
});

test("o prompt carrega só agregados, nunca lançamento individual", () => {
  const prompt = buildPrompt(analysisPayload());
  assert.match(prompt, /Como está minha taxa de poupança\?/);
  assert.match(prompt, /Receitas/);
  // O contrato de entrada não admite lista de transações, então o prompt não
  // tem como carregar descrição, fornecedor ou contraparte de lançamento.
  assert.equal(prompt.includes("investmentMetadata"), false);
});

test("entrada inválida é recusada pelo contrato, não pelo provider", () => {
  // Pergunta vazia, workspace ausente e campo desconhecido: nenhum deles
  // chega a gastar cota externa.
  const context = {
    profileType: "PF" as const,
    periodLabel: "x",
    kpis: [],
    topCategories: [],
    alerts: [],
  };
  assert.throws(() => analysisPayloadSchema.parse({
    workspaceId: "workspace-a", idempotencyKey: "idem-0001", question: "  ",
    context,
  }));
  assert.throws(() => analysisPayloadSchema.parse({
    idempotencyKey: "idem-0001", question: "pergunta válida", context,
  }));
  assert.throws(() => analysisPayloadSchema.parse({
    ...analysisPayload(),
    campoDesconhecido: true,
  }));
});

test("extração recusa tipo de conteúdo fora do contrato", () => {
  assert.throws(() => extractionPayloadSchema.parse({
    workspaceId: "workspace-a",
    kind: "video",
    transcript: "algo",
  }));
  // Texto legítimo passa.
  const parsed = extractionPayloadSchema.parse({
    workspaceId: "workspace-a",
    kind: "text",
    idempotencyKey: "idem-extracao-0001",
    transcript: "Almoço de R$ 45,00 em 10/08",
  });
  assert.equal(parsed.kind, "text");
});

/* ------------------------------------------------------ P2B.2 contratos */

test("as duas callables exigem idempotencyKey válida (P2B.2)", () => {
  const {idempotencyKey: _removed, ...withoutKey} = analysisPayload();
  void _removed;
  assert.throws(() => analysisPayloadSchema.parse(withoutKey));
  assert.throws(() => analysisPayloadSchema.parse({
    ...withoutKey, idempotencyKey: "curta",
  }));
  assert.throws(() => analysisPayloadSchema.parse({
    ...withoutKey, idempotencyKey: "com/barra-0001",
  }));
  const text = {
    kind: "text", workspaceId: "workspace-a", transcript: "Almoço de R$ 45",
  };
  const documentPayload = {
    kind: "document",
    workspaceId: "workspace-a",
    mimeType: "image/png",
    dataBase64: "iVBORw0KGgoAAAANSUhEUg==",
  };
  assert.throws(() => extractionPayloadSchema.parse(text));
  assert.throws(() => extractionPayloadSchema.parse(documentPayload));
  for (const payload of [text, documentPayload]) {
    const parsed = extractionPayloadSchema.parse({
      ...payload, idempotencyKey: "idem-extracao-0002",
    });
    assert.equal(parsed.idempotencyKey, "idem-extracao-0002");
  }
  // O tamanho máximo do documento não mudou.
  assert.equal(MAX_DOCUMENT_BASE64, 6 * 1024 * 1024);
  assert.throws(() => extractionPayloadSchema.parse({
    ...documentPayload,
    idempotencyKey: "idem-extracao-0003",
    dataBase64: "A".repeat(MAX_DOCUMENT_BASE64 + 1),
  }));
});

test("cada operação disponível custa 1 crédito, num único lugar", () => {
  assert.deepEqual({...AI_CREDIT_COSTS}, {
    analysis: 1,
    extractionText: 1,
    extractionDocument: 1,
  });
  assert.ok(Object.isFrozen(AI_CREDIT_COSTS));
});

test("teto de saída por chamada: análise 1200, extração 600", () => {
  assert.deepEqual({...AI_MAX_OUTPUT_TOKENS}, {
    analysis: 1200,
    extraction: 600,
  });
  assert.ok(Object.isFrozen(AI_MAX_OUTPUT_TOKENS));
});

/** SDK falso: registra construção, modelo pedido e conteúdo enviado. */
const fakeSdk = (answer: string) => {
  const seen: Array<{
    apiKey: string;
    params: Record<string, unknown>;
    parts: unknown;
  }> = [];
  class GoogleGenerativeAI {
    constructor(private readonly apiKey: string) {}
    getGenerativeModel(params: Record<string, unknown>) {
      return {
        generateContent: async (parts: unknown) => {
          seen.push({apiKey: this.apiKey, params, parts});
          return {response: {text: () => answer}};
        },
      };
    }
  }
  return {
    seen,
    load: async () => ({GoogleGenerativeAI}) as unknown as
      typeof import("@google/generative-ai"),
  };
};

test("gateway real: mesmo modelo, teto de saída e JSON só quando pedido",
  async () => {
    const sdk = fakeSdk("resposta");
    const gateway = createGeminiGateway("chave-de-teste-longa", sdk.load);
    assert.equal(await gateway.generate({
      parts: [{text: "prompt"}],
      maxOutputTokens: AI_MAX_OUTPUT_TOKENS.analysis,
    }), "resposta");
    await gateway.generate({
      parts: [{inlineData: {data: "AAAA", mimeType: "image/png"}}],
      maxOutputTokens: AI_MAX_OUTPUT_TOKENS.extraction,
      json: true,
    });
    assert.equal(AI_MODEL, "gemini-3-flash-preview");
    assert.deepEqual(sdk.seen.map((entry) => entry.params), [
      {model: AI_MODEL, generationConfig: {maxOutputTokens: 1200}},
      {
        model: AI_MODEL,
        generationConfig: {
          maxOutputTokens: 600,
          responseMimeType: "application/json",
        },
      },
    ]);
    assert.deepEqual(sdk.seen[0].parts, [{text: "prompt"}]);
    assert.ok(sdk.seen.every((entry) =>
      entry.apiKey === "chave-de-teste-longa"));
  });

test("recibos de IA têm TTL versionado de 90 dias", () => {
  assert.equal(RETENTION_DAYS.aiUsageReceipts, 90);
  // lib/ai/__tests__ → raiz do repositório.
  const indexes = JSON.parse(readFileSync(
    resolve(__dirname, "../../../../firestore.indexes.json"),
    "utf8",
  )) as {fieldOverrides: Array<Record<string, unknown>>};
  const overrides = indexes.fieldOverrides.filter((entry) =>
    entry.collectionGroup === "ai_usage_receipts");
  assert.deepEqual(overrides, [{
    collectionGroup: "ai_usage_receipts",
    fieldPath: "expiresAt",
    ttl: true,
    indexes: [],
  }]);
  // O contador mensal não expira nesta etapa (ciclo de vida em P8).
  assert.equal(
    indexes.fieldOverrides.some((entry) =>
      entry.collectionGroup === "ai_usage"),
    false,
  );
});
