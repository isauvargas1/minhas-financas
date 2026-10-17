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
 * - a rotina de faturas do domínio de cartões anterior à P4-A não declarava
 *   recurso algum e herdava 60 s / 256 MiB para paginar até 10.000 faturas
 *   com uma transação por fatura;
 * - as sete callables de metas também não declaravam, e entre elas está
 *   `rebuildGoalProgress`, que soma até 100.000 aportes em páginas de 300;
 * - a configuração do checkout era lida de `process.env` sem constar no
 *   `secrets` de nenhuma função. Provisioná-la não a montaria, os valores
 *   chegariam vazios, e o checkout falharia fechado em produção com
 *   aparência de recusa deliberada.
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
  // P3-G: + `processLoanStatusRefresh` (atraso de empréstimos).
  // P5-D2: + processReceivableOverdueNotifications
  assert.equal(scheduled.length, 5);
  assert.ok(scheduled.some(([name]) => name === "processLoanStatusRefresh"));
  assert.ok(scheduled.some(([name]) =>
    name === "processReceivableOverdueNotifications"));

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

test("o relatório financeiro tem memória para o pior caso de todo o período",
  () => {
    const endpoint = endpointOf("getFinancialReport");
    assert.equal(endpoint.timeoutSeconds, 60);
    assert.equal(endpoint.availableMemoryMb, 1024);
    assert.equal(endpoint.maxInstances, 20);
  });

test("as operações paginadas pesadas têm a janela longa", () => {
  const heavy = ["rebuildCashPeriods"];
  for (const name of heavy) {
    const endpoint = endpointOf(name);
    assert.equal(endpoint.timeoutSeconds, 540, `tempo limite de ${name}`);
    assert.equal(endpoint.availableMemoryMb, 512, `memória de ${name}`);
  }
});

/**
 * D-15 (P4-D): investimentos expõem só as callables da experiência simples.
 * As 14 da superfície profissional (cadastro técnico, valoração, importação,
 * onboarding, reconstrução e backfill) saíram e não podem voltar sem decisão.
 */
const INVESTMENT_CALLABLES = [
  "cancelInvestmentMovement",
  "changeInvestmentGoal",
  "createSimpleInvestment",
  "linkInvestmentToGoal",
  "reverseInvestmentMovement",
  "settleInvestmentContribution",
  "settleSimpleWithdrawal",
  "unlinkInvestmentFromGoal",
  "withdrawSimpleInvestment",
];

const REMOVED_INVESTMENT_CALLABLES = [
  "archiveInvestmentAccount",
  "archiveInvestmentAsset",
  "backfillInvestmentWorkspace",
  "createInvestmentContribution",
  "createInvestmentRedemption",
  "onboardInvestmentWorkspace",
  "rebuildInvestmentProjections",
  "recalculateGoalInvestmentProgress",
  "recalculateInvestmentPosition",
  "recordInvestmentValuation",
  "registerInvestmentImportBatch",
  "saveInvestmentAccount",
  "saveInvestmentAsset",
  "settleInvestmentRedemption",
];

test("investimentos expõem só as callables da experiência simples (D-15)", () => {
  const names = endpoints()
    .filter(([, endpoint]) => endpoint.callableTrigger)
    .map(([name]) => name);
  for (const removed of REMOVED_INVESTMENT_CALLABLES) {
    assert.ok(!names.includes(removed), `callable removida voltou: ${removed}`);
  }
  const investment = names.filter((name) =>
    /Investment/.test(name) || name === "settleSimpleWithdrawal");
  assert.deepEqual(investment.sort(), INVESTMENT_CALLABLES);
  for (const name of INVESTMENT_CALLABLES) {
    assert.ok(endpointOf(name).callableTrigger, `${name} não é callable`);
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

  // P2A: cada plano pago tem o próprio Price por ambiente; a allowlist plana
  // `STRIPE_ALLOWED_PRICE_IDS` (sem plano associado) deixou de existir.
  assert.deepEqual(secretsOf("createCheckoutSession").sort(), [
    "APP_ALLOWED_ORIGINS",
    "STRIPE_PRICE_BUSINESS_MONTHLY",
    "STRIPE_PRICE_PRO_MONTHLY",
    "STRIPE_SECRET_KEY",
  ]);
  assert.deepEqual(secretsOf("createBillingPortalSession").sort(), [
    "APP_ALLOWED_ORIGINS",
    "STRIPE_SECRET_KEY",
  ]);
  assert.deepEqual(secretsOf("getBillingCatalog"), []);
  assert.deepEqual(secretsOf("stripeWebhook").sort(), [
    "STRIPE_PRICE_BUSINESS_MONTHLY",
    "STRIPE_PRICE_PRO_MONTHLY",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
  ]);
  for (const [name] of endpoints()) {
    assert.ok(
      !secretsOf(name).includes("STRIPE_ALLOWED_PRICE_IDS"),
      `${name} declara a allowlist legada de preços`,
    );
  }
});

test("P2A: billing com perfil de domínio e webhook com recursos", () => {
  for (const name of [
    "getBillingCatalog",
    "createCheckoutSession",
    "createBillingPortalSession",
  ]) {
    const endpoint = endpointOf(name);
    assert.ok(endpoint.callableTrigger, `${name} não é callable`);
    assert.equal(endpoint.timeoutSeconds, 60, `tempo limite de ${name}`);
    assert.equal(endpoint.availableMemoryMb, 256, `memória de ${name}`);
  }
  const webhook = endpointOf("stripeWebhook") as Endpoint & {
    httpsTrigger?: unknown;
  };
  assert.ok(webhook.httpsTrigger, "stripeWebhook é HTTP");
  assert.equal(webhook.callableTrigger, undefined);
  assert.equal(webhook.timeoutSeconds, 60);
  assert.equal(webhook.availableMemoryMb, 256);
  assert.equal(webhook.maxInstances, 10);
});

test("P2B.1: entitlement do workspace e uso da conta, só leitura e sem " +
  "segredo", () => {
  for (const name of ["getWorkspaceEntitlement", "getAccountUsage"]) {
    const endpoint = endpointOf(name);
    assert.ok(endpoint.callableTrigger, `${name} não é callable`);
    assert.deepEqual(endpoint.region, [FUNCTIONS_REGION], `região de ${name}`);
    assert.equal(endpoint.timeoutSeconds, 60, `tempo limite de ${name}`);
    assert.equal(endpoint.availableMemoryMb, 256, `memória de ${name}`);
    assert.deepEqual(secretsOf(name), [], `${name} não lê segredo`);
  }
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

const P1_CALLABLES = [
  "bootstrapAccount",
  "createWorkspace",
  "updateWorkspaceSettings",
  "archiveWorkspace",
  "inviteWorkspaceMember",
  "acceptWorkspaceInvite",
  "revokeWorkspaceInvite",
  "changeWorkspaceMemberRole",
  "removeWorkspaceMember",
  "leaveWorkspace",
  "transferWorkspaceOwnership",
];

test("P1: callables de conta e membership com perfil de domínio", () => {
  for (const name of P1_CALLABLES) {
    const endpoint = endpointOf(name);
    assert.ok(endpoint.callableTrigger, `${name} não é callable`);
    assert.deepEqual(endpoint.region, [FUNCTIONS_REGION], `região de ${name}`);
    assert.equal(endpoint.timeoutSeconds, 60, `tempo limite de ${name}`);
    assert.equal(endpoint.availableMemoryMb, 256, `memória de ${name}`);
    assert.equal(endpoint.maxInstances, 20, `concorrência de ${name}`);
    assert.deepEqual(secretsOf(name), [], `${name} não lê segredo`);
  }
});

test("P3-G: callables de empréstimos com perfil de domínio", () => {
  for (const name of [
    "cancelLoan",
    "createLoan",
    "registerLoanPayment",
    "reverseLoanMovement",
    "updateLoanMetadata",
  ]) {
    const endpoint = endpointOf(name);
    assert.ok(endpoint.callableTrigger, `${name} não é callable`);
    assert.deepEqual(endpoint.region, [FUNCTIONS_REGION], name);
    assert.equal(endpoint.timeoutSeconds, 60, name);
    assert.equal(endpoint.availableMemoryMb, 256, name);
    assert.equal(endpoint.maxInstances, 20, name);
    assert.deepEqual(secretsOf(name), [], name);
  }
});

test("P3-I: callables de clientes e recebíveis com perfil de domínio", () => {
  for (const name of [
    "archiveClient",
    "cancelReceivable",
    "createClient",
    "createReceivable",
    "receiveReceivable",
    "reverseReceivableReceipt",
    "updateClient",
    "updateReceivable",
  ]) {
    const endpoint = endpointOf(name);
    assert.ok(endpoint.callableTrigger, `${name} não é callable`);
    assert.deepEqual(endpoint.region, [FUNCTIONS_REGION], name);
    assert.equal(endpoint.timeoutSeconds, 60, name);
    assert.equal(endpoint.availableMemoryMb, 256, name);
    assert.equal(endpoint.maxInstances, 20, name);
    assert.deepEqual(secretsOf(name), [], name);
  }
});

test("P3-J: callables de contas e transferências com perfil de domínio", () => {
  for (const name of [
    "archiveCashAccount",
    "createCashAccount",
    "createCashTransfer",
    "reactivateCashAccount",
    "reverseCashTransfer",
    "updateCashAccount",
  ]) {
    const endpoint = endpointOf(name);
    assert.ok(endpoint.callableTrigger, `${name} não é callable`);
    assert.deepEqual(endpoint.region, [FUNCTIONS_REGION], name);
    assert.equal(endpoint.timeoutSeconds, 60, name);
    assert.equal(endpoint.availableMemoryMb, 256, name);
    assert.equal(endpoint.maxInstances, 20, name);
    assert.deepEqual(secretsOf(name), [], name);
  }
});

test("P4-E: callables do catálogo de configurações com perfil de domínio",
  () => {
    for (const name of [
      "archiveSettingsCatalogItem",
      "createSettingsCatalogItem",
      "updateSettingsCatalogItem",
    ]) {
      const endpoint = endpointOf(name);
      assert.ok(endpoint.callableTrigger, `${name} não é callable`);
      assert.deepEqual(endpoint.region, [FUNCTIONS_REGION], name);
      assert.equal(endpoint.timeoutSeconds, 60, name);
      assert.equal(endpoint.availableMemoryMb, 256, name);
      assert.equal(endpoint.maxInstances, 20, name);
      assert.deepEqual(secretsOf(name), [], name);
    }
    // D-23: não há callable de exclusão nem de reativação separada.
    for (const name of ["deleteSettingsCatalogItem",
      "reactivateSettingsCatalogItem"]) {
      assert.equal(endpoints().some(([entry]) => entry === name), false, name);
    }
  });

test("P4-A: callables de cartões com perfil de domínio", () => {
  for (const name of [
    "archiveCreditCard",
    "cancelCreditCardPurchase",
    "createCreditCard",
    "createCreditCardInvoiceAdjustment",
    "createCreditCardPurchase",
    "reactivateCreditCard",
    "refundCreditCardPurchase",
    "registerInvoicePayment",
    "reverseInvoicePayment",
    "updateCreditCard",
    "updateCreditCardPurchase",
  ]) {
    const endpoint = endpointOf(name);
    assert.ok(endpoint.callableTrigger, `${name} não é callable`);
    assert.deepEqual(endpoint.region, [FUNCTIONS_REGION], name);
    assert.equal(endpoint.timeoutSeconds, 60, name);
    assert.equal(endpoint.availableMemoryMb, 256, name);
    assert.equal(endpoint.maxInstances, 20, name);
    assert.deepEqual(secretsOf(name), [], name);
  }
  // Reconciliação: paginada e com a janela longa das operações pesadas.
  for (const name of ["recalculateCardLimit", "rebuildCardInvoicesForCard"]) {
    const endpoint = endpointOf(name);
    assert.ok(endpoint.callableTrigger, `${name} não é callable`);
    assert.equal(endpoint.timeoutSeconds, 540, name);
    assert.equal(endpoint.availableMemoryMb, 512, name);
    assert.equal(endpoint.maxInstances, 3, name);
  }
});

/*
 * P4-A substituiu o domínio de cartões em ponto flutuante sem migração (não
 * há dados reais): nenhuma callable de migração, de fechamento/reabertura
 * manual (o ciclo é decidido pela data, D-36) nem os nomes antigos de
 * pagamento sobrevivem na superfície implantada.
 */
test("P4-A: nenhuma callable ou rotina legada de cartões é exportada", () => {
  const removed = [
    "migrateLegacyInstallments",
    "migrateLegacyInstallmentsToInvoiceDomain",
    "closeCreditCardInvoice",
    "reopenCreditCardInvoice",
    "registerCreditCardInvoicePayment",
    "reverseCreditCardInvoicePayment",
    "processCreditCardInvoiceOperationalAlerts",
  ];
  const names = endpoints().map(([name]) => name);
  for (const name of removed) {
    assert.ok(!names.includes(name), `${name} voltou à superfície implantada`);
  }
  assert.ok(names.includes("processCreditCardInvoiceClosing"));
});

test("P3-A/P3-C/P3-D/P3-F: callables de caixa com perfil de domínio", () => {
  for (const name of [
    "confirmCashTransaction",
    "createCashTransaction",
    "importCashTransactions",
    "updateCashTransaction",
    "voidCashTransaction",
  ]) {
    const endpoint = endpointOf(name);
    assert.ok(endpoint.callableTrigger, `${name} não é callable`);
    assert.deepEqual(endpoint.region, [FUNCTIONS_REGION], name);
    assert.equal(endpoint.timeoutSeconds, 60, name);
    assert.equal(endpoint.availableMemoryMb, 256, name);
    assert.equal(endpoint.maxInstances, 20, name);
    assert.deepEqual(secretsOf(name), [], name);
  }
});

test("P3-B: gatilho de caixa reentrega falhas e mantém o perfil", () => {
  const endpoint = endpointOf("onTransactionWrite") as Endpoint & {
    eventTrigger?: {retry?: boolean};
  };
  assert.equal(endpoint.eventTrigger?.retry, true);
  assert.deepEqual(endpoint.region, [FUNCTIONS_REGION]);
  assert.equal(endpoint.timeoutSeconds, 60);
  assert.equal(endpoint.availableMemoryMb, 256);
  assert.equal(endpoint.maxInstances, 20);
  assert.deepEqual(secretsOf("onTransactionWrite"), []);
});

test("P5-D2: gatilhos de notificação reentregam e mantêm o perfil", () => {
  for (const name of [
    "onLoanWriteNotification",
    "onCashAccountWriteNotification",
    "onGoalWriteNotification",
    "onRecurringOccurrenceCreatedNotification",
  ]) {
    const endpoint = endpointOf(name) as Endpoint & {
      eventTrigger?: {retry?: boolean};
    };
    assert.ok(endpoint.eventTrigger, `${name} não é gatilho de evento`);
    assert.equal(endpoint.eventTrigger?.retry, true, `retry de ${name}`);
    assert.deepEqual(endpoint.region, [FUNCTIONS_REGION], `região de ${name}`);
    assert.equal(endpoint.timeoutSeconds, 60, `tempo limite de ${name}`);
    assert.equal(endpoint.availableMemoryMb, 256, `memória de ${name}`);
    assert.equal(endpoint.maxInstances, 20, `concorrência de ${name}`);
    assert.deepEqual(secretsOf(name), [], `${name} não lê segredo`);
  }
});

test("P5-D2: callable da contagem de não lidas com perfil de domínio", () => {
  const name = "getNotificationUnreadCount";
  const endpoint = endpointOf(name);
  assert.ok(endpoint.callableTrigger, `${name} não é callable`);
  assert.deepEqual(endpoint.region, [FUNCTIONS_REGION], name);
  assert.equal(endpoint.timeoutSeconds, 60, name);
  assert.equal(endpoint.availableMemoryMb, 256, name);
  assert.equal(endpoint.maxInstances, 20, name);
  assert.deepEqual(secretsOf(name), [], name);
});

test("P1: gatilho do índice do usuário é idempotente e limitado", () => {
  const endpoint = endpointOf("onWorkspaceDisplayChange") as Endpoint & {
    eventTrigger?: {retry?: boolean; eventFilterPathPatterns?: unknown};
  };
  assert.deepEqual(endpoint.region, [FUNCTIONS_REGION]);
  assert.equal(endpoint.timeoutSeconds, 120);
  assert.equal(endpoint.availableMemoryMb, 256);
  assert.equal(endpoint.maxInstances, 5);
  assert.equal(endpoint.eventTrigger?.retry, true);
});

test("P1: nenhum módulo de teste é alcançável pelo entrypoint", () => {
  // O seam de convites e os helpers de seed vivem em `testSupport/`. Se algum
  // módulo de produção os importasse, entrariam no runtime implantado.
  const loaded = Object.keys(require.cache).filter((path) =>
    path.includes("/lib/") && !path.endsWith("deploymentContract.test.js"));
  const offenders = loaded.filter((path) =>
    /\/(testSupport|__tests__)\/|\.test\.js$|manual[A-Za-z]*Test\.js$/
      .test(path));
  assert.deepEqual(offenders, []);
  for (const name of Object.keys(deployed)) {
    assert.ok(!/test|seam/i.test(name), `export de teste: ${name}`);
  }
});

test("P1: o deploy não envia código exclusivo de teste", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const firebaseJson = require("../../../firebase.json") as {
    functions: Array<{source: string; ignore: string[]}>;
  };
  const config = firebaseJson.functions.find((f) => f.source === "functions");
  assert.ok(config);
  for (const pattern of [
    "lib/**/__tests__/**",
    "lib/**/testSupport/**",
    "lib/**/*.test.js",
    "src/**/testSupport/**",
  ]) {
    assert.ok(config.ignore.includes(pattern), `ignore sem ${pattern}`);
  }
});

test("P2C-H2: o build parte de lib/ limpo e só apaga a saída gerada", () => {
  // Sem a limpeza, `lib/` guardava testes compilados de fontes removidas:
  // `test:unit` os executava (contagem falsa) e o deploy enviaria código
  // morto. A limpeza alcança só `lib/`, que é saída do `tsc` e não versionada.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pkg = require("../../package.json") as {
    scripts: Record<string, string>;
  };
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const tsconfig = require("../../tsconfig.json") as {
    compilerOptions: {outDir: string; rootDir: string};
  };
  assert.equal(tsconfig.compilerOptions.outDir, "lib");
  assert.equal(tsconfig.compilerOptions.rootDir, "src");
  assert.match(pkg.scripts.build, /^npm run clean && tsc$/);
  assert.equal(pkg.scripts.clean,
    "node -e \"require('node:fs').rmSync('lib', " +
    "{recursive: true, force: true})\"");
  // Verificação de tipos sem emitir e sem apagar nada.
  assert.equal(pkg.scripts.typecheck, "tsc --noEmit");
  for (const script of ["test:unit", "test:integration"]) {
    assert.match(pkg.scripts[script], /^npm run build && /, script);
  }
});

test("P2C-H2: a integração roda um arquivo por vez no Emulator único", () => {
  // Os arquivos de integração compartilham uma única JVM do Firestore
  // Emulator. Em paralelo (padrão do `node --test`: núcleos − 1, variável por
  // máquina), transações de outros arquivos provocam lock timeout nos deletes
  // de limpeza, e o `BulkWriter` do SDK (`recursiveDelete`) não reenvia a
  // operação reenfileirada no modo flush: a promessa fica pendente sem handle
  // e o arquivo é cancelado (PLAN §17.11). Um arquivo por vez elimina o
  // gatilho sem tocar em nenhuma asserção.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pkg = require("../../package.json") as {
    scripts: Record<string, string>;
  };
  assert.match(pkg.scripts["test:integration"],
    /node --test --test-concurrency=1 "lib\/\*\*\/\*\.integration\.test\.js"/);
});
