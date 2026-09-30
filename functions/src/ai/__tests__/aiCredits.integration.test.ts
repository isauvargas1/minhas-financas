import assert from "node:assert/strict";
import test from "node:test";

import {Timestamp} from "firebase-admin/firestore";
import type {HttpsError} from "firebase-functions/v2/https";

import {
  getAccountUsage,
  getWorkspaceEntitlement,
} from "../../billing/callables";
import {
  AI_CREDITS_EXHAUSTED_MESSAGE,
  QUOTA_STATE_UNAVAILABLE_MESSAGE,
} from "../../billing/quota";
import {
  DAY_MS,
  account,
  downgradeToFree,
  setBilling,
  settle,
} from "../../billing/testSupport/quotaTestSupport";
import {
  insideTransaction,
  installTransactionProbe,
} from "../../billing/testSupport/transactionProbe";
import {saoPauloMonthKey} from "../../shared/dateKeys";
import {
  rateLimitDocumentId,
  type RateLimitPolicy,
} from "../../shared/rateLimit";
import {
  seedMember,
  seedWorkspace,
} from "../../shared/testSupport/kernelTestSupport";
import {transferWorkspaceOwnership} from "../../workspaces/callables";
import {
  call,
  db,
  expectHttpsError,
  idempotencyKey,
  uniqueId,
} from "../../workspaces/testSupport/p1TestSupport";
import {
  AI_IDEMPOTENCY_CONFLICT_MESSAGE,
  AI_REQUEST_ALREADY_PROCESSED_MESSAGE,
} from "../admission";
import {analyzeFinancialQuestion, createAiCallables} from "../callables";
import type {AiGenerationRequest} from "../gateway";
import {ANALYSIS_RATE_LIMIT, EXTRACTION_RATE_LIMIT} from "../policy";

/**
 * P2B.2 — créditos de IA por plano do titular (PR-AI-03), no Emulator.
 *
 * As callables são montadas pela mesma fábrica da produção
 * (`createAiCallables`), passando pelo kernel inteiro (`.run`), com um
 * provedor falso: nenhuma chamada de rede, nenhuma credencial. O falso
 * recusa ser chamado de dentro de uma transação (sonda de transação) e
 * registra cada pedido. O relógio da admissão é fixo; o rate limit horário
 * segue o relógio real, como em produção.
 */
installTransactionProbe(db());

const NOW = Date.parse("2026-09-15T15:00:00.000Z");
const PERIOD = "2026-09";

interface ProviderCall {
  request: AiGenerationRequest;
}

type Respond = (request: AiGenerationRequest) => Promise<string>;

const defaultRespond: Respond = async (request) =>
  request.json ?
    "{\"type\":\"despesa\",\"value\":45}" :
    "Resposta da IA de teste.";

const harness = (
  options: {now?: () => number; respond?: Respond} = {},
) => {
  const calls: ProviderCall[] = [];
  const callables = createAiCallables(() => ({
    now: options.now ?? (() => NOW),
    gateway: {
      generate: async (request) => {
        if (insideTransaction()) {
          throw new Error("provedor chamado dentro de uma transação");
        }
        calls.push({request});
        return (options.respond ?? defaultRespond)(request);
      },
    },
  }));
  const analyze = (
    uid: string,
    workspaceId: string,
    overrides: Record<string, unknown> = {},
  ) => call<{answer: string}>(callables.analyzeFinancialQuestion, uid, {
    ...analysisPayload(workspaceId),
    ...overrides,
  });
  const extractText = (
    uid: string,
    workspaceId: string,
    overrides: Record<string, unknown> = {},
  ) => call<{extracted: unknown}>(
    callables.extractTransactionFromContent,
    uid,
    {
      kind: "text",
      workspaceId,
      idempotencyKey: idempotencyKey(),
      transcript: "Almoço de R$ 45,00 hoje",
      ...overrides,
    },
  );
  const extractDocument = (
    uid: string,
    workspaceId: string,
    overrides: Record<string, unknown> = {},
  ) => call<{extracted: unknown}>(
    callables.extractTransactionFromContent,
    uid,
    {
      kind: "document",
      workspaceId,
      idempotencyKey: idempotencyKey(),
      mimeType: "image/png",
      dataBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
      ...overrides,
    },
  );
  return {calls, analyze, extractText, extractDocument};
};

const analysisPayload = (workspaceId: string) => ({
  workspaceId,
  idempotencyKey: idempotencyKey(),
  question: "Como está minha taxa de poupança?",
  context: {
    profileType: "PF",
    periodLabel: "Últimos 30 dias",
    kpis: [{label: "Receitas", formattedValue: "R$ 5.000,00"}],
    topCategories: ["Moradia (40.0%)"],
    alerts: [],
  },
});

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

const newWorkspace = async (
  owner: string,
  members: Array<[string, "admin" | "member" | "viewer"]> = [],
): Promise<string> => {
  const workspaceId = uniqueId("ai-ws");
  await seedWorkspace({workspaceId, ownerId: owner});
  for (const [uid, role] of members) {
    await seedMember(workspaceId, uid, role);
  }
  return workspaceId;
};

const usageDoc = (owner: string, period = PERIOD) =>
  db().doc(`billing_accounts/${owner}/ai_usage/${period}`).get();

const usedCredits = async (
  owner: string,
  period = PERIOD,
): Promise<number | undefined> =>
  (await usageDoc(owner, period)).get("usedCredits");

/** Contador do mês como a admissão o deixaria. */
const setUsed = async (owner: string, used: number, period = PERIOD) => {
  await db().doc(`billing_accounts/${owner}/ai_usage/${period}`).set({
    billingOwnerUid: owner,
    monthKey: period,
    usedCredits: used,
    schemaVersion: 1,
    updatedAt: Timestamp.now(),
  });
};

/** Recibos de idempotência do **ator** (não do owner). */
const receiptsOf = async (actor: string) =>
  (await db().collection(`users/${actor}/ai_usage_receipts`).get()).docs;

const rateLimitDoc = (
  workspaceId: string,
  uid: string,
  policy: RateLimitPolicy = ANALYSIS_RATE_LIMIT,
) => db().doc(
  `workspaces/${workspaceId}/rate_limits/${rateLimitDocumentId(policy, uid)}`,
).get();

/** Nenhum efeito da chamada recusada: sem uso, recibo, rate limit. */
const assertNothingConsumed = async (
  owner: string,
  workspaceId: string,
  actor: string,
) => {
  assert.equal((await usageDoc(owner)).exists, false, "uso gravado");
  assert.equal((await receiptsOf(actor)).length, 0, "recibo gravado");
  assert.equal((await rateLimitDoc(workspaceId, actor)).exists, false,
    "rate limit consumido");
};

const expectCreditsExhausted = async (
  promise: Promise<unknown>,
  expected: {planId: string; limit: number; used: number; periodKey?: string},
  owner: string,
): Promise<HttpsError> => {
  const error = await expectHttpsError(promise, "resource-exhausted", {
    message: AI_CREDITS_EXHAUSTED_MESSAGE,
  });
  assert.deepEqual(error.details, {
    resource: "aiCreditsPerMonth",
    planId: expected.planId,
    limit: expected.limit,
    used: expected.used,
    periodKey: expected.periodKey ?? PERIOD,
  });
  // Nada do titular além do necessário para negar: sem uid, Stripe, grace.
  const serialized = JSON.stringify(error.toJSON());
  assert.equal(serialized.includes(owner), false, "uid do titular exposto");
  assert.doesNotMatch(serialized, /cus_|sub_|price_|billingOwnerUid|grace/i);
  return error;
};

// ---------------------------------------------------------------------------
// Teto mensal por plano do titular
// ---------------------------------------------------------------------------

test("teto do catálogo: Free 10, Pro 150, Business 750", async () => {
  for (const [plan, limit] of [
    ["free", 10],
    ["pro", 150],
    ["business", 750],
  ] as const) {
    const owner = await account(`ai-${plan}`, plan);
    const workspaceId = await newWorkspace(owner);
    const provider = harness();
    await setUsed(owner, limit - 1);
    await provider.analyze(owner, workspaceId);
    assert.equal(await usedCredits(owner), limit, plan);
    await expectCreditsExhausted(provider.analyze(owner, workspaceId),
      {planId: plan, limit, used: limit}, owner);
    await expectCreditsExhausted(provider.extractText(owner, workspaceId),
      {planId: plan, limit, used: limit}, owner);
    assert.equal(provider.calls.length, 1, `${plan}: provedor só uma vez`);
    assert.equal(await usedCredits(owner), limit);
  }
});

test("primeiro uso do mês cria o contador server-owned", async () => {
  const owner = await account("ai-first");
  const workspaceId = await newWorkspace(owner);
  assert.equal((await usageDoc(owner)).exists, false);
  await harness().analyze(owner, workspaceId);
  const usage = await usageDoc(owner);
  assert.deepEqual(Object.keys(usage.data() ?? {}).sort(), [
    "billingOwnerUid", "monthKey", "schemaVersion", "updatedAt",
    "usedCredits",
  ]);
  assert.equal(usage.get("billingOwnerUid"), owner);
  assert.equal(usage.get("monthKey"), PERIOD);
  assert.equal(usage.get("usedCredits"), 1);
  assert.equal(usage.get("schemaVersion"), 1);
  assert.ok(usage.get("updatedAt") instanceof Timestamp);
});

test("cada operação custa 1 crédito: análise, texto e documento",
  async () => {
    const owner = await account("ai-cost");
    const workspaceId = await newWorkspace(owner);
    const provider = harness();
    await provider.analyze(owner, workspaceId);
    await provider.extractText(owner, workspaceId);
    await provider.extractDocument(owner, workspaceId);
    assert.equal(await usedCredits(owner), 3);
    assert.deepEqual(
      (await receiptsOf(owner)).map((doc) => doc.get("creditCost")),
      [1, 1, 1],
    );
  });

test("último crédito disputado por membros de dois workspaces: " +
  "exatamente uma chamada vence", async () => {
  const owner = await account("ai-race", "pro");
  const first = await account("ai-race-a");
  const second = await account("ai-race-b");
  const one = await newWorkspace(owner, [[first, "member"]]);
  const two = await newWorkspace(owner, [[second, "admin"]]);
  await setUsed(owner, 149);
  const provider = harness();
  const {fulfilled, rejectedCodes} = await settle([
    provider.analyze(owner, one),
    provider.analyze(first, one),
    provider.extractText(second, two),
    provider.analyze(owner, two),
  ]);
  assert.equal(fulfilled, 1, "só uma chamada leva o último crédito");
  // Perdedoras: releem o contador e são recusadas, ou esgotam as tentativas
  // do SDK por contenção (`aborted`). Nunca `internal`.
  assert.equal(rejectedCodes.length, 3);
  for (const code of rejectedCodes) {
    assert.ok(["resource-exhausted", "aborted"].includes(String(code)),
      String(code));
  }
  assert.equal(await usedCredits(owner), 150);
  assert.equal(provider.calls.length, 1);
  // Recibos são do ator: um só entre os três atores que disputaram.
  const receipts = [
    ...await receiptsOf(owner),
    ...await receiptsOf(first),
    ...await receiptsOf(second),
  ];
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].get("billingOwnerUid"), owner);
});

test("limite atingido: provedor não é chamado e nada é gravado",
  async () => {
    const owner = await account("ai-full");
    const workspaceId = await newWorkspace(owner);
    await setUsed(owner, 10);
    const before = await usageDoc(owner);
    const provider = harness();
    await expectCreditsExhausted(provider.analyze(owner, workspaceId),
      {planId: "free", limit: 10, used: 10}, owner);
    await expectCreditsExhausted(provider.extractDocument(owner, workspaceId),
      {planId: "free", limit: 10, used: 10}, owner);
    assert.equal(provider.calls.length, 0);
    const after = await usageDoc(owner);
    assert.ok(after.get("updatedAt").isEqual(before.get("updatedAt")));
    assert.equal((await receiptsOf(owner)).length, 0);
    // Quota recusada não consome o rate limit de nenhuma das operações.
    assert.equal((await rateLimitDoc(workspaceId, owner)).exists, false);
    assert.equal(
      (await rateLimitDoc(workspaceId, owner, EXTRACTION_RATE_LIMIT)).exists,
      false,
    );
  });

// ---------------------------------------------------------------------------
// Pool do billing owner
// ---------------------------------------------------------------------------

test("membro consome o pool do owner, não o próprio", async () => {
  const owner = await account("ai-pool-owner", "pro");
  const member = await account("ai-pool-member");
  const workspaceId = await newWorkspace(owner, [[member, "member"]]);
  const provider = harness();
  await provider.analyze(member, workspaceId);
  await provider.extractText(member, workspaceId);
  assert.equal(await usedCredits(owner), 2);
  assert.equal((await usageDoc(member)).exists, false);
  // O recibo é do membro (ator); o débito, do owner.
  assert.equal((await receiptsOf(owner)).length, 0);
  const receipts = await receiptsOf(member);
  assert.deepEqual(receipts.map((doc) => doc.get("actorId")),
    [member, member]);
  assert.deepEqual(receipts.map((doc) => doc.get("workspaceId")),
    [workspaceId, workspaceId]);
  assert.deepEqual(receipts.map((doc) => doc.get("billingOwnerUid")),
    [owner, owner]);
  // Membro recusado vê só o necessário: sem o uid do titular.
  await setUsed(owner, 150);
  await expectCreditsExhausted(provider.analyze(member, workspaceId),
    {planId: "pro", limit: 150, used: 150}, owner);
});

test("dois workspaces do mesmo owner compartilham um único pool",
  async () => {
    const owner = await account("ai-shared", "pro");
    const member = await account("ai-shared-m");
    const one = await newWorkspace(owner);
    const two = await newWorkspace(owner, [[member, "member"]]);
    const provider = harness();
    await provider.analyze(owner, one);
    await provider.analyze(member, two);
    await provider.extractText(owner, two);
    assert.equal(await usedCredits(owner), 3);
    // Pool compartilhado: o último crédito de um espaço esgota o outro.
    await setUsed(owner, 150);
    await expectCreditsExhausted(provider.analyze(owner, one),
      {planId: "pro", limit: 150, used: 150}, owner);
    await expectCreditsExhausted(provider.analyze(member, two),
      {planId: "pro", limit: 150, used: 150}, owner);
  });

test("workspace de outro owner consome o pool do outro owner", async () => {
  const ownerA = await account("ai-own-a");
  const ownerB = await account("ai-own-b", "business");
  const actor = await account("ai-own-x");
  const inA = await newWorkspace(ownerA, [[actor, "member"]]);
  const inB = await newWorkspace(ownerB, [[actor, "admin"]]);
  await setUsed(ownerA, 10);
  const provider = harness();
  // A esgotado não impede o uso em B, que é de outro titular.
  await expectCreditsExhausted(provider.analyze(actor, inA),
    {planId: "free", limit: 10, used: 10}, ownerA);
  await provider.analyze(actor, inB);
  assert.equal(await usedCredits(ownerA), 10);
  assert.equal(await usedCredits(ownerB), 1);
  assert.equal((await usageDoc(actor)).exists, false);
});

test("após a transferência, os usos seguintes consomem o novo owner",
  async () => {
    const ownerA = await account("ai-tr-a", "pro");
    const ownerB = await account("ai-tr-b", "pro");
    const workspaceId = await newWorkspace(ownerA, [[ownerB, "member"]]);
    const provider = harness();
    await provider.analyze(ownerB, workspaceId);
    assert.equal(await usedCredits(ownerA), 1);
    await call(transferWorkspaceOwnership, ownerA, {
      workspaceId,
      newOwnerId: ownerB,
      idempotencyKey: idempotencyKey(),
    });
    await provider.analyze(ownerA, workspaceId);
    await provider.analyze(ownerB, workspaceId);
    assert.equal(await usedCredits(ownerA), 1, "antigo titular intacto");
    assert.equal(await usedCredits(ownerB), 2);
    // O teto também passa a ser o do novo titular.
    await setUsed(ownerB, 150);
    await expectCreditsExhausted(provider.analyze(ownerA, workspaceId),
      {planId: "pro", limit: 150, used: 150}, ownerB);
  });

// ---------------------------------------------------------------------------
// Idempotência do ator através da transferência de ownership
// ---------------------------------------------------------------------------

/**
 * O membro `actor` consome com a chave `key` no workspace de A; depois o
 * workspace é transferido para B. O recibo é do ator, então continua
 * encontrável com o owner novo.
 */
const consumedThenTransferred = async (prefix: string) => {
  const ownerA = await account(`${prefix}-a`, "pro");
  const ownerB = await account(`${prefix}-b`, "pro");
  const actor = await account(`${prefix}-m`);
  const workspaceId = await newWorkspace(ownerA, [
    [ownerB, "member"],
    [actor, "member"],
  ]);
  const provider = harness();
  const payload = analysisPayload(workspaceId);
  await provider.analyze(actor, workspaceId, payload);
  assert.equal(await usedCredits(ownerA), 1);
  await call(transferWorkspaceOwnership, ownerA, {
    workspaceId,
    newOwnerId: ownerB,
    idempotencyKey: idempotencyKey(),
  });
  assert.equal(
    (await db().doc(`workspaces/${workspaceId}`).get()).get("ownerId"),
    ownerB,
  );
  return {ownerA, ownerB, actor, workspaceId, provider, payload};
};

test("mesma chave e mesmo conteúdo depois da transferência: recusa " +
  "idempotente, sem debitar A nem B e sem chamar o provedor", async () => {
  const {ownerA, ownerB, actor, workspaceId, provider, payload} =
    await consumedThenTransferred("ai-idem-tr");
  await expectHttpsError(provider.analyze(actor, workspaceId, payload),
    "failed-precondition", {message: AI_REQUEST_ALREADY_PROCESSED_MESSAGE});
  assert.equal(await usedCredits(ownerA), 1, "A debitado de novo");
  assert.equal((await usageDoc(ownerB)).exists, false, "B debitado");
  assert.equal(provider.calls.length, 1, "provedor chamado de novo");
  const receipts = await receiptsOf(actor);
  assert.equal(receipts.length, 1);
  // O recibo continua registrando quem pagou a chamada original.
  assert.equal(receipts[0].get("billingOwnerUid"), ownerA);
  assert.equal((await rateLimitDoc(workspaceId, actor)).get("count"), 1);
});

test("mesma chave com outro conteúdo depois da transferência: conflito, " +
  "sem consumo nem chamada", async () => {
  const {ownerA, ownerB, actor, workspaceId, provider, payload} =
    await consumedThenTransferred("ai-idem-tr-conf");
  await expectHttpsError(
    provider.analyze(actor, workspaceId, {
      ...payload,
      question: "Pergunta diferente com a mesma chave?",
    }),
    "failed-precondition",
    {message: AI_IDEMPOTENCY_CONFLICT_MESSAGE},
  );
  await expectHttpsError(
    provider.extractText(actor, workspaceId, {
      idempotencyKey: payload.idempotencyKey,
    }),
    "failed-precondition",
    {message: AI_IDEMPOTENCY_CONFLICT_MESSAGE},
  );
  assert.equal(await usedCredits(ownerA), 1);
  assert.equal((await usageDoc(ownerB)).exists, false);
  assert.equal(provider.calls.length, 1);
  assert.equal((await receiptsOf(actor)).length, 1);
  assert.equal((await rateLimitDoc(workspaceId, actor)).get("count"), 1);
});

test("chave nova depois da transferência consome o novo owner e chama o " +
  "provedor", async () => {
  const {ownerA, ownerB, actor, workspaceId, provider, payload} =
    await consumedThenTransferred("ai-idem-tr-new");
  await provider.analyze(actor, workspaceId, {
    ...payload,
    idempotencyKey: idempotencyKey(),
  });
  assert.equal(await usedCredits(ownerA), 1, "antigo titular intacto");
  assert.equal(await usedCredits(ownerB), 1);
  assert.equal(provider.calls.length, 2);
  assert.deepEqual(
    (await receiptsOf(actor)).map((doc) => doc.get("billingOwnerUid")).sort(),
    [ownerA, ownerB].sort(),
  );
});

test("mesma chave disputada em workspaces de owners diferentes: um só " +
  "consumo e uma só chamada", async () => {
  const ownerA = await account("ai-idem-x-a", "pro");
  const ownerB = await account("ai-idem-x-b", "pro");
  const actor = await account("ai-idem-x-m");
  const inA = await newWorkspace(ownerA, [[actor, "member"]]);
  const inB = await newWorkspace(ownerB, [[actor, "member"]]);
  const key = idempotencyKey();
  const provider = harness();
  const {fulfilled, rejectedCodes} = await settle([
    provider.analyze(actor, inA, {idempotencyKey: key}),
    provider.analyze(actor, inB, {idempotencyKey: key}),
  ]);
  assert.equal(fulfilled, 1);
  // A perdedora encontra o recibo do ator com outro workspace (conflito) ou
  // esgota a contenção (`aborted`). Nunca `internal`.
  for (const code of rejectedCodes) {
    assert.ok(["failed-precondition", "aborted"].includes(String(code)),
      String(code));
  }
  assert.equal(provider.calls.length, 1);
  assert.equal(
    ((await usedCredits(ownerA)) ?? 0) + ((await usedCredits(ownerB)) ?? 0),
    1,
  );
  assert.equal((await receiptsOf(actor)).length, 1);
});

// ---------------------------------------------------------------------------
// Plano efetivo no relógio do servidor
// ---------------------------------------------------------------------------

test("downgrade no mês: uso preservado e novas chamadas recusadas",
  async () => {
    const owner = await account("ai-down", "pro");
    const workspaceId = await newWorkspace(owner);
    await setUsed(owner, 40);
    await downgradeToFree(owner);
    const provider = harness();
    await expectCreditsExhausted(provider.analyze(owner, workspaceId),
      {planId: "free", limit: 10, used: 40}, owner);
    assert.equal(await usedCredits(owner), 40, "uso não é apagado");
    assert.equal(provider.calls.length, 0);
  });

test("upgrade libera até o novo teto", async () => {
  const owner = await account("ai-up");
  const workspaceId = await newWorkspace(owner);
  await setUsed(owner, 10);
  const provider = harness();
  await expectCreditsExhausted(provider.analyze(owner, workspaceId),
    {planId: "free", limit: 10, used: 10}, owner);
  await setBilling(owner, {
    planId: "pro",
    entitlementStatus: "active",
    subscriptionStatus: "active",
  });
  await provider.analyze(owner, workspaceId);
  assert.equal(await usedCredits(owner), 11);
});

test("grace conserva o teto pago; grace vencido cai para o Free",
  async () => {
    const owner = await account("ai-grace", "pro");
    const workspaceId = await newWorkspace(owner);
    await setBilling(owner, {
      entitlementStatus: "grace",
      subscriptionStatus: "past_due",
      graceUntil: Timestamp.fromMillis(NOW + DAY_MS),
    });
    await setUsed(owner, 10);
    await harness().analyze(owner, workspaceId);
    assert.equal(await usedCredits(owner), 11);
    // Mesmo mês, depois do fim do grace, sem webhook novo.
    const expired = harness({now: () => NOW + 2 * DAY_MS});
    await expectCreditsExhausted(expired.analyze(owner, workspaceId),
      {planId: "free", limit: 10, used: 11}, owner);
    assert.equal(expired.calls.length, 0);
  });

test("virada do mês em São Paulo: contador novo e mês anterior imutável",
  async () => {
    const owner = await account("ai-month");
    const workspaceId = await newWorkspace(owner);
    // 23:30 de 30/09 em São Paulo já é 01/10 em UTC.
    const lastMinutes = Date.parse("2026-09-30T23:30:00-03:00");
    const firstMinutes = Date.parse("2026-10-01T00:30:00-03:00");
    assert.equal(saoPauloMonthKey(new Date(lastMinutes)), "2026-09");
    await setUsed(owner, 10, "2026-09");
    const september = await usageDoc(owner, "2026-09");
    await expectCreditsExhausted(
      harness({now: () => lastMinutes}).analyze(owner, workspaceId),
      {planId: "free", limit: 10, used: 10, periodKey: "2026-09"},
      owner,
    );
    await harness({now: () => firstMinutes}).analyze(owner, workspaceId);
    const october = await usageDoc(owner, "2026-10");
    assert.equal(october.get("monthKey"), "2026-10");
    assert.equal(october.get("usedCredits"), 1);
    const after = await usageDoc(owner, "2026-09");
    assert.equal(after.get("usedCredits"), 10);
    assert.ok(after.get("updatedAt").isEqual(september.get("updatedAt")),
      "mês anterior regravado");
    assert.deepEqual(
      (await receiptsOf(owner)).map((doc) => doc.get("monthKey")),
      ["2026-10"],
    );
  });

// ---------------------------------------------------------------------------
// Idempotência
// ---------------------------------------------------------------------------

test("mesma chave concorrente: um crédito e no máximo uma chamada ao " +
  "provedor", async () => {
  const owner = await account("ai-idem-race", "pro");
  const workspaceId = await newWorkspace(owner);
  const payload = analysisPayload(workspaceId);
  const provider = harness();
  const {fulfilled, rejectedCodes} = await settle([
    provider.analyze(owner, workspaceId, payload),
    provider.analyze(owner, workspaceId, payload),
    provider.analyze(owner, workspaceId, payload),
  ]);
  assert.equal(fulfilled, 1);
  for (const code of rejectedCodes) {
    assert.ok(["failed-precondition", "aborted"].includes(String(code)),
      String(code));
  }
  assert.equal(provider.calls.length, 1);
  assert.equal(await usedCredits(owner), 1);
  assert.equal((await receiptsOf(owner)).length, 1);
  assert.equal((await rateLimitDoc(workspaceId, owner)).get("count"), 1);
});

test("mesma chave reenviada depois de processada não chama o provedor",
  async () => {
    const owner = await account("ai-idem-again");
    const workspaceId = await newWorkspace(owner);
    const payload = analysisPayload(workspaceId);
    const provider = harness();
    await provider.analyze(owner, workspaceId, payload);
    await expectHttpsError(provider.analyze(owner, workspaceId, payload),
      "failed-precondition", {message: AI_REQUEST_ALREADY_PROCESSED_MESSAGE});
    assert.equal(provider.calls.length, 1);
    assert.equal(await usedCredits(owner), 1);
    assert.equal((await rateLimitDoc(workspaceId, owner)).get("count"), 1);
  });

test("mesma chave com outro conteúdo conflita, sem consumo", async () => {
  const owner = await account("ai-idem-conflict", "pro");
  const workspaceId = await newWorkspace(owner);
  const other = await newWorkspace(owner);
  const key = idempotencyKey();
  const provider = harness();
  await provider.analyze(owner, workspaceId, {idempotencyKey: key});
  for (const attempt of [
    () => provider.analyze(owner, workspaceId, {
      idempotencyKey: key,
      question: "Outra pergunta com a mesma chave?",
    }),
    () => provider.extractText(owner, workspaceId, {idempotencyKey: key}),
    () => provider.analyze(owner, other, {idempotencyKey: key}),
  ]) {
    await expectHttpsError(attempt(), "failed-precondition",
      {message: AI_IDEMPOTENCY_CONFLICT_MESSAGE});
  }
  assert.equal(provider.calls.length, 1);
  assert.equal(await usedCredits(owner), 1);
  assert.equal((await receiptsOf(owner)).length, 1);
});

test("recibo guarda só metadados e hash, com TTL de 90 dias", async () => {
  const owner = await account("ai-receipt");
  const member = await account("ai-receipt-m");
  const workspaceId = await newWorkspace(owner, [[member, "member"]]);
  const secrets = {
    question: "PERGUNTA-SIGILOSA-7431 sobre o meu salário?",
    answer: "RESPOSTA-SIGILOSA-5519",
    transcript: "TRANSCRICAO-SIGILOSA-2208 almoço de 45 reais",
    extracted: "EXTRAIDO-SIGILOSO-9034",
    document: "RE9DVU1FTlRPLVNJR0lMT1NPLTQ0MTc=",
  };
  const keys = [idempotencyKey(), idempotencyKey(), idempotencyKey()];
  const provider = harness({
    respond: async (request) => request.json ?
      JSON.stringify({description: secrets.extracted}) :
      secrets.answer,
  });
  const startedAt = Date.now();
  const result = await provider.analyze(member, workspaceId, {
    idempotencyKey: keys[0],
    question: secrets.question,
  });
  assert.equal(result.answer, secrets.answer);
  await provider.extractText(member, workspaceId, {
    idempotencyKey: keys[1],
    transcript: secrets.transcript,
  });
  await provider.extractDocument(member, workspaceId, {
    idempotencyKey: keys[2],
    dataBase64: secrets.document,
  });

  // Recibos sob o ator (membro), nunca sob o titular.
  assert.equal((await receiptsOf(owner)).length, 0);
  const receipts = await receiptsOf(member);
  assert.equal(receipts.length, 3);
  for (const receipt of receipts) {
    assert.deepEqual(Object.keys(receipt.data()).sort(), [
      "actorId", "billingOwnerUid", "createdAt", "creditCost", "expiresAt",
      "monthKey", "operation", "requestHash", "workspaceId",
    ]);
    assert.equal(receipt.ref.parent.path, `users/${member}/ai_usage_receipts`);
    assert.equal(receipt.get("actorId"), member);
    assert.equal(receipt.get("billingOwnerUid"), owner);
    assert.equal(receipt.get("workspaceId"), workspaceId);
    assert.equal(receipt.get("monthKey"), PERIOD);
    assert.equal(receipt.get("creditCost"), 1);
    assert.match(receipt.get("requestHash"), /^[0-9a-f]{64}$/);
    // A chave não fica em claro nem no ID do documento.
    for (const key of keys) {
      assert.equal(receipt.id.includes(key), false);
    }
    const ttlMs = receipt.get("expiresAt").toMillis() - startedAt;
    assert.ok(ttlMs >= 90 * DAY_MS - 60_000 && ttlMs <= 90 * DAY_MS + 60_000,
      `TTL fora de 90 dias: ${ttlMs}`);
  }
  assert.deepEqual(
    receipts.map((doc) => doc.get("operation")).sort(),
    [
      "analyzeFinancialQuestion",
      "extractTransactionFromContent",
      "extractTransactionFromContent",
    ],
  );
  // Nem o recibo nem o contador carregam conteúdo, prompt ou resposta.
  const stored = JSON.stringify([
    ...receipts.map((doc) => doc.data()),
    (await usageDoc(owner)).data(),
    (await rateLimitDoc(workspaceId, member)).data(),
  ]);
  for (const secret of Object.values(secrets)) {
    assert.equal(stored.includes(secret), false, `persistido: ${secret}`);
  }
  assert.doesNotMatch(stored, /Pergunta do usuário|Extraia os dados/);
});

// ---------------------------------------------------------------------------
// Rate limit horário
// ---------------------------------------------------------------------------

test("rate limit horário continua valendo e não consome crédito",
  async () => {
    const owner = await account("ai-rate");
    const workspaceId = await newWorkspace(owner);
    await db().doc(`workspaces/${workspaceId}/rate_limits/` +
      rateLimitDocumentId(ANALYSIS_RATE_LIMIT, owner)).set({
      windowStart: Timestamp.now(),
      count: ANALYSIS_RATE_LIMIT.limit,
    });
    const provider = harness();
    await expectHttpsError(provider.analyze(owner, workspaceId),
      "failed-precondition", {message: /Muitas solicitações/});
    assert.equal(provider.calls.length, 0);
    assert.equal((await usageDoc(owner)).exists, false);
    assert.equal((await receiptsOf(owner)).length, 0);
    assert.equal((await rateLimitDoc(workspaceId, owner)).get("count"),
      ANALYSIS_RATE_LIMIT.limit);
  });

test("chamada aceita grava crédito, recibo e rate limit no mesmo commit; " +
  "recusa por quota não consome o rate limit", async () => {
  const owner = await account("ai-commit");
  const workspaceId = await newWorkspace(owner);
  await setUsed(owner, 9);
  const provider = harness();
  await provider.analyze(owner, workspaceId);
  const usage = await usageDoc(owner);
  const [receipt] = await receiptsOf(owner);
  const rate = await rateLimitDoc(workspaceId, owner);
  assert.equal(usage.get("usedCredits"), 10);
  assert.equal(rate.get("count"), 1);
  // `serverTimestamp()` resolve para o instante do commit: o mesmo valor
  // nos três documentos prova que foram gravados juntos.
  assert.ok(usage.get("updatedAt").isEqual(rate.get("updatedAt")));
  assert.ok(receipt.get("createdAt").isEqual(rate.get("updatedAt")));

  await expectCreditsExhausted(provider.analyze(owner, workspaceId),
    {planId: "free", limit: 10, used: 10}, owner);
  assert.equal((await rateLimitDoc(workspaceId, owner)).get("count"), 1);
});

// ---------------------------------------------------------------------------
// Fronteira com o provedor
// ---------------------------------------------------------------------------

test("provedor só depois do commit do crédito, fora de transação",
  async () => {
    const owner = await account("ai-after");
    const workspaceId = await newWorkspace(owner);
    const seen: Array<{used: number | undefined; receipts: number}> = [];
    const provider = harness({
      respond: async (request) => {
        seen.push({
          used: await usedCredits(owner),
          receipts: (await receiptsOf(owner)).length,
        });
        return defaultRespond(request);
      },
    });
    await provider.analyze(owner, workspaceId);
    await provider.extractText(owner, workspaceId);
    await provider.extractDocument(owner, workspaceId);
    // No instante da chamada externa o crédito e o recibo já estavam
    // confirmados (o falso também recusa ser chamado dentro de transação).
    assert.deepEqual(seen, [
      {used: 1, receipts: 1},
      {used: 2, receipts: 2},
      {used: 3, receipts: 3},
    ]);
  });

test("teto de saída por chamada: análise 1200, extração 600", async () => {
  const owner = await account("ai-tokens");
  const workspaceId = await newWorkspace(owner);
  const provider = harness();
  await provider.analyze(owner, workspaceId);
  await provider.extractText(owner, workspaceId);
  await provider.extractDocument(owner, workspaceId);
  assert.deepEqual(
    provider.calls.map(({request}) => [request.maxOutputTokens, request.json]),
    [[1200, undefined], [600, true], [600, true]],
  );
  const documentParts = provider.calls[2].request.parts;
  assert.deepEqual(documentParts[0], {
    inlineData: {
      data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
      mimeType: "image/png",
    },
  });
});

test("falha do provedor depois do commit mantém o crédito e não repete a " +
  "chamada", async () => {
  const owner = await account("ai-fail");
  const workspaceId = await newWorkspace(owner);
  const failing = harness({
    respond: async () => {
      throw Object.assign(new Error("503 detalhe interno do provedor"), {
        status: 503,
      });
    },
  });
  const payload = analysisPayload(workspaceId);
  const error = await expectHttpsError(
    failing.analyze(owner, workspaceId, payload),
    "internal",
    {message: "Não foi possível concluir a operação. Tente novamente em " +
      "instantes."},
  );
  assert.deepEqual(Object.keys(error.details as object), ["requestId"]);
  assert.equal(
    JSON.stringify(error.toJSON()).includes("detalhe interno"),
    false,
  );
  assert.equal(await usedCredits(owner), 1, "crédito não é devolvido");
  assert.equal((await receiptsOf(owner)).length, 1);
  // Reenvio da mesma chave: já processada, sem nova chamada externa.
  await expectHttpsError(failing.analyze(owner, workspaceId, payload),
    "failed-precondition", {message: AI_REQUEST_ALREADY_PROCESSED_MESSAGE});
  assert.equal(failing.calls.length, 1);

  // Resposta vazia e JSON inválido também já consumiram o crédito.
  const empty = harness({respond: async () => ""});
  const answer = await empty.analyze(owner, workspaceId);
  assert.equal(answer.answer, "Não foi possível processar a análise agora.");
  const invalid = harness({respond: async () => "isto não é JSON"});
  await expectHttpsError(invalid.extractText(owner, workspaceId),
    "failed-precondition",
    {message: "Não foi possível interpretar o conteúdo enviado."});
  assert.equal(await usedCredits(owner), 3);
});

test("falhas antes do commit não consomem crédito nem chamam o provedor",
  async () => {
    const owner = await account("ai-before", "pro");
    const viewer = await account("ai-before-v");
    const stranger = await account("ai-before-s");
    const member = await account("ai-before-m");
    const workspaceId = await newWorkspace(owner, [
      [viewer, "viewer"],
      [member, "member"],
    ]);
    const provider = harness();
    await expectHttpsError(provider.analyze(viewer, workspaceId),
      "permission-denied");
    await expectHttpsError(provider.extractText(stranger, workspaceId),
      "permission-denied");
    await expectHttpsError(
      provider.analyze(owner, workspaceId, {idempotencyKey: undefined}),
      "invalid-argument",
    );
    await expectHttpsError(
      provider.extractText(owner, workspaceId, {idempotencyKey: "curta"}),
      "invalid-argument",
    );

    // Segredo ausente: a callable de produção recusa antes da admissão.
    const previous = process.env.GOOGLE_AI_API_KEY;
    delete process.env.GOOGLE_AI_API_KEY;
    try {
      await expectHttpsError(
        call(analyzeFinancialQuestion, owner, analysisPayload(workspaceId)),
        "failed-precondition",
        {message: /não está configurada/},
      );
    } finally {
      if (previous !== undefined) process.env.GOOGLE_AI_API_KEY = previous;
    }

    // Owner canônico incoerente: falha fechado, sem adivinhar o pagador.
    await db().doc(`workspaces/${workspaceId}`).update({ownerId: member});
    await expectHttpsError(provider.analyze(owner, workspaceId), "internal",
      {message: QUOTA_STATE_UNAVAILABLE_MESSAGE});
    await db().doc(`workspaces/${workspaceId}`).update({ownerId: owner});

    // Workspace arquivado.
    await db().doc(`workspaces/${workspaceId}`).update({status: "archived"});
    await expectHttpsError(provider.analyze(owner, workspaceId),
      "failed-precondition");

    assert.equal(provider.calls.length, 0);
    for (const actor of [owner, viewer, stranger, member]) {
      await assertNothingConsumed(owner, workspaceId, actor);
      assert.equal((await usageDoc(actor)).exists, false);
    }
  });

// ---------------------------------------------------------------------------
// Consulta do próprio uso
// ---------------------------------------------------------------------------

test("getAccountUsage expõe só o pool do próprio titular; o entitlement " +
  "do workspace não expõe uso", async () => {
  const owner = await account("ai-usage", "pro");
  const member = await account("ai-usage-m");
  const workspaceId = await newWorkspace(owner, [[member, "member"]]);
  const period = saoPauloMonthKey();
  await setUsed(owner, 7, period);
  assert.deepEqual(await call(getAccountUsage, owner, {}), {
    activeOwnedWorkspaces: 1,
    aiCreditsUsed: 7,
    aiCreditsLimit: 150,
    aiCreditsRemaining: 143,
    aiPeriodKey: period,
  });
  // O membro vê o próprio pool (vazio), nunca o do titular.
  assert.deepEqual(await call(getAccountUsage, member, {}), {
    activeOwnedWorkspaces: 0,
    aiCreditsUsed: 0,
    aiCreditsLimit: 10,
    aiCreditsRemaining: 10,
    aiPeriodKey: period,
  });
  const entitlement = await call<Record<string, unknown>>(
    getWorkspaceEntitlement, member, {workspaceId});
  assert.deepEqual(Object.keys(entitlement).sort(),
    ["catalogVersion", "entitlementStatus", "limits", "planId"]);
  assert.equal(JSON.stringify(entitlement).includes("aiCreditsUsed"), false);
  // Uso acima do teto após downgrade: restante nunca negativo.
  await setUsed(owner, 40, period);
  await downgradeToFree(owner);
  const downgraded = await call<Record<string, unknown>>(
    getAccountUsage, owner, {});
  assert.equal(downgraded.aiCreditsUsed, 40);
  assert.equal(downgraded.aiCreditsLimit, 10);
  assert.equal(downgraded.aiCreditsRemaining, 0);
});
