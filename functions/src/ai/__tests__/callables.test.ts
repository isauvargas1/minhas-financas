import assert from "node:assert/strict";
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
import {ApplicationError} from "../../shared/errors";
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
    workspaceId: "workspace-a", question: "  ", context,
  }));
  assert.throws(() => analysisPayloadSchema.parse({
    question: "pergunta válida", context,
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
    transcript: "Almoço de R$ 45,00 em 10/08",
  });
  assert.equal(parsed.kind, "text");
});
