import assert from "node:assert/strict";
import test from "node:test";

import {FUNCTIONS_REGION} from "./runtimeOptions";

/**
 * Contrato de implantação de todas as funções.
 *
 * Região, tempo limite, memória, concorrência e **declaração de segredo** não
 * são detalhe de execução: são o objeto que o `firebase deploy` lê para criar
 * o recurso no Google Cloud. Nada disso era verificado por teste nenhum, e as
 * três falhas que este arquivo tranca já estavam no repositório:
 *
 * - `processCreditCardInvoiceOperationalAlerts` não declarava recurso algum e
 *   herdava 60 s / 256 MiB para paginar até 10.000 faturas com uma transação
 *   por fatura;
 * - as sete callables de metas também não declaravam, e entre elas está
 *   `rebuildGoalProgress`, que soma até 100.000 aportes em páginas de 300;
 * - `STRIPE_ALLOWED_PRICE_IDS` e `APP_ALLOWED_ORIGINS` eram lidas de
 *   `process.env` sem constar no `secrets` de nenhuma função. Provisioná-las
 *   não as montaria, as listas chegariam vazias, e o checkout falharia fechado
 *   em produção com aparência de recusa deliberada.
 *
 * O `__endpoint` é exatamente o que vai para o deploy, então o que este
 * arquivo afirma é o que o Cloud Functions vai receber.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const deployed = require("../index") as Record<string, unknown>;

interface Endpoint {
  region?: string[];
  timeoutSeconds?: number;
  availableMemoryMb?: number;
  maxInstances?: number;
  scheduleTrigger?: {schedule?: string; timeZone?: string};
  callableTrigger?: unknown;
  secretEnvironmentVariables?: Array<{key: string}>;
}

const endpoints = (): Array<[string, Endpoint]> =>
  Object.entries(deployed)
    // As funções v2 são **funções** com `__endpoint` anexado, não objetos: o
    // módulo também exporta tipos e utilitários, que este filtro descarta.
    .filter(([, value]) =>
      Boolean(value) &&
      (typeof value === "object" || typeof value === "function") &&
      "__endpoint" in (value as Record<string, unknown>))
    .map(([name, value]) => [
      name,
      (value as {__endpoint: Endpoint}).__endpoint,
    ]);

const endpointOf = (name: string): Endpoint => {
  const found = endpoints().find(([entry]) => entry === name);
  assert.ok(found, `função ${name} não está exportada em index.ts`);
  return found[1];
};

const secretsOf = (name: string): string[] =>
  (endpointOf(name).secretEnvironmentVariables ?? []).map((s) => s.key);

test("o codebase exporta funções e todas ficam na região do Firestore", () => {
  const all = endpoints();
  // O Firestore está em `southamerica-east1`; sem região declarada tudo subia
  // em `us-central1`, a um continente de distância do banco (INV-P2-042).
  assert.ok(all.length >= 40, `esperava dezenas de funções, veio ${all.length}`);
  for (const [name, endpoint] of all) {
    assert.deepEqual(endpoint.region, [FUNCTIONS_REGION], `região de ${name}`);
  }
});

test("as rotinas agendadas declaram fuso e perfil de execução longa", () => {
  const scheduled = endpoints().filter(([, e]) => e.scheduleTrigger);
  assert.equal(scheduled.length, 3);

  for (const [name, endpoint] of scheduled) {
    assert.equal(
      endpoint.scheduleTrigger?.timeZone,
      "America/Sao_Paulo",
      `fuso de ${name}`,
    );
    assert.equal(endpoint.timeoutSeconds, 540, `tempo limite de ${name}`);
    assert.equal(endpoint.availableMemoryMb, 512, `memória de ${name}`);
    assert.equal(endpoint.maxInstances, 1, `concorrência de ${name}`);
  }
});

test("toda callable declara tempo limite e memória", () => {
  const callables = endpoints().filter(([, e]) => e.callableTrigger);
  assert.ok(callables.length >= 35);
  for (const [name, endpoint] of callables) {
    assert.equal(
      typeof endpoint.timeoutSeconds,
      "number",
      `${name} sem tempo limite: herdaria o padrão de 60 s da plataforma`,
    );
    assert.equal(typeof endpoint.availableMemoryMb, "number", `${name} sem memória`);
  }
});

test("as operações paginadas pesadas têm a janela longa", () => {
  const heavy = [
    "rebuildInvestmentProjections",
    "backfillInvestmentWorkspace",
    "recalculateInvestmentPosition",
    "recalculateGoalInvestmentProgress",
    "rebuildCashPeriods",
  ];
  for (const name of heavy) {
    const endpoint = endpointOf(name);
    assert.equal(endpoint.timeoutSeconds, 540, `tempo limite de ${name}`);
    assert.equal(endpoint.availableMemoryMb, 512, `memória de ${name}`);
  }
});

test("toda configuração externa lida é declarada por quem a lê", () => {
  // A regra: se o código chama `process.env.X`, a função precisa declarar `X`,
  // senão o Cloud Functions não o monta e o valor chega vazio.
  assert.deepEqual(secretsOf("analyzeFinancialQuestion"), ["GOOGLE_AI_API_KEY"]);
  assert.deepEqual(
    secretsOf("extractTransactionFromContent"),
    ["GOOGLE_AI_API_KEY"],
  );

  const checkout = secretsOf("createCheckoutSession");
  assert.ok(checkout.includes("STRIPE_SECRET_KEY"));
  assert.ok(
    checkout.includes("STRIPE_ALLOWED_PRICE_IDS"),
    "sem a allowlist montada, nenhum preço é aceito e o checkout fica inoperante",
  );
  assert.ok(
    checkout.includes("APP_ALLOWED_ORIGINS"),
    "sem as origens montadas, nenhum returnUrl é válido",
  );

  const webhook = secretsOf("stripeWebhook");
  assert.ok(webhook.includes("STRIPE_SECRET_KEY"));
  assert.ok(webhook.includes("STRIPE_WEBHOOK_SECRET"));
  assert.ok(
    webhook.includes("STRIPE_ALLOWED_PRICE_IDS"),
    "o webhook confere o preço antes de conceder o plano",
  );
});

test("a superfície operacional de metas está publicada", () => {
  // A reconstrução que a área operacional oferece precisa existir como função
  // implantada: sem ela o painel oferece um botão que não tem destino.
  assert.ok(
    endpointOf("recalculateGoalInvestmentProgress").callableTrigger,
    "recalculateGoalInvestmentProgress deve ser callable",
  );
});

/*
 * O domínio de investimentos é único: não existe callable de migração, de
 * reconciliação, de rollback nem de habilitação de flag, e não existe a trilha
 * legada de resgate sobre `transactions`. Este teste é o que impede qualquer
 * uma delas de voltar por reintrodução acidental de um export.
 */
test("nenhuma callable legada de investimento é exportada", () => {
  const removed = [
    "saveInvestmentRedemption",
    "cancelInvestmentRedemption",
    "reverseInvestmentRedemption",
    "migrateLegacyInvestments",
    "rollbackLegacyInvestmentMigration",
    "reconcileLegacyMigration",
    "enableInvestmentsV2Flag",
    "saveGoalContribution",
    "setGoalTransactionLinks",
    "rebuildGoalProgress",
  ];
  const names = endpoints().map(([name]) => name);
  for (const name of removed) {
    assert.ok(!names.includes(name), `${name} voltou à superfície implantada`);
  }
});
