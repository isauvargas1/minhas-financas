import assert from "node:assert/strict";
import test from "node:test";
import {FieldValue, Timestamp} from "firebase-admin/firestore";

import {
  QUOTA_STATE_UNAVAILABLE_MESSAGE,
  TRANSACTIONS_QUOTA_EXHAUSTED_MESSAGE,
  TRANSACTIONS_QUOTA_EXHAUSTED_NON_OWNER_MESSAGE,
} from "../../billing/quota";
import {planLimits} from "../../billing/catalog";
import {formatIsoInstant} from "../../shared/commitTime";
import {saoPauloMonthKey, saoPauloMonthStart} from "../../shared/dateKeys";
import {sha256} from "../../shared/hashing";
import {rateLimitDocumentId} from "../../shared/rateLimit";
import {
  defaultAccountOf,
  seedActiveAccount,
  seedMember,
  seedPaidPlan,
  seedWorkspace,
} from "../../shared/testSupport/kernelTestSupport";
import {
  bootstrapAccount,
  createWorkspace,
  transferWorkspaceOwnership,
} from "../../workspaces/callables";
import {
  call,
  db,
  expectHttpsError,
  idempotencyKey,
  uniqueId,
} from "../../workspaces/testSupport/p1TestSupport";
import {
  createCashTransaction,
  updateCashTransaction,
  voidCashTransaction,
} from "../callables";
import {createCashTransactionPayloadSchema} from "../contracts";
import {
  CASH_ENTRY_RATE_LIMIT,
  executeCreateCashTransaction,
} from "../createTransaction";

/**
 * Quota comercial de lançamentos por mês (P3-D, D-40), pela callable de
 * criação contra o Emulator.
 *
 * O contador vive em `workspaces/{id}/quota_state/transactions_{YYYY-MM}`;
 * os testes semeiam o uso anterior direto nele (estado server-only) para não
 * criar dezenas de lançamentos por caso.
 */
db();

type Plan = "free" | "pro" | "business";

const tenant = async (plan: Plan = "free") => {
  const workspaceId = uniqueId("quota-ws");
  const owner = uniqueId("quota-owner");
  const admin = uniqueId("quota-admin");
  const member = uniqueId("quota-member");
  const viewer = uniqueId("quota-viewer");
  for (const uid of [owner, admin, member, viewer]) {
    await seedActiveAccount(uid);
  }
  // Quatro membros não cabem no Free (2): o titular Free usa só ele e um
  // membro; os demais planos usam a equipe toda.
  if (plan !== "free") await seedPaidPlan(owner, plan);
  await seedWorkspace({workspaceId, ownerId: owner});
  await seedMember(workspaceId, member, "member");
  if (plan !== "free") {
    await seedMember(workspaceId, admin, "admin");
    await seedMember(workspaceId, viewer, "viewer");
  }
  return {workspaceId, owner, admin, member, viewer};
};

const month = () => saoPauloMonthKey();

const monthRef = (workspaceId: string, monthKey: string) =>
  db().doc(`workspaces/${workspaceId}/quota_state/transactions_${monthKey}`);

const setUsed = (workspaceId: string, monthKey: string, used: number) =>
  monthRef(workspaceId, monthKey).set({
    workspaceId,
    monthKey,
    used,
    schemaVersion: 1,
    updatedAt: FieldValue.serverTimestamp(),
  });

const usedOf = async (workspaceId: string, monthKey = month()) =>
  (await monthRef(workspaceId, monthKey).get()).get("used") as
    | number
    | undefined;

const entryInput = (workspaceId: string, overrides = {}) => ({
  workspaceId,
  cashAccountId: defaultAccountOf(workspaceId),
  idempotencyKey: idempotencyKey(),
  type: "despesa",
  description: "Mercado",
  category: "Casa",
  amountCents: 10_000,
  date: "2026-09-15",
  ...overrides,
});

const create = (uid: string, workspaceId: string, overrides = {}) =>
  call<{transactionId: string; replayed: boolean}>(
    createCashTransaction,
    uid,
    entryInput(workspaceId, overrides),
  );

const ledgerSize = async (workspaceId: string) =>
  (await db().collection(`workspaces/${workspaceId}/transactions`).get()).size;

const nextMonth = (monthKey: string) => {
  const [year, value] = monthKey.split("-").map(Number);
  return value === 12 ?
    `${year + 1}-01` :
    `${year}-${String(value + 1).padStart(2, "0")}`;
};

// ------------------------------------------------------------------ limites

for (const plan of ["free", "pro", "business"] as const) {
  test(`P3-D — limite ${plan}: a última unidade passa`, async () => {
    const t = await tenant(plan);
    const limit = planLimits(plan).transactionsPerMonth;
    await setUsed(t.workspaceId, month(), limit - 1);
    await create(t.owner, t.workspaceId);
    assert.equal(await usedOf(t.workspaceId), limit);
    const error = await expectHttpsError(
      create(t.owner, t.workspaceId),
      "resource-exhausted",
      {message: TRANSACTIONS_QUOTA_EXHAUSTED_MESSAGE},
    );
    assert.deepEqual(
      {...(error.details as Record<string, unknown>), reason: undefined},
      {
        resource: "transactionsPerMonth",
        planId: plan,
        limit,
        used: limit,
        periodKey: month(),
        reason: undefined,
      },
    );
    assert.equal(await usedOf(t.workspaceId), limit);
    assert.equal(await ledgerSize(t.workspaceId), 1);
  });
}

test("P3-D — não titular: procurar o titular, sem ver o uso", async () => {
  const t = await tenant("free");
  await setUsed(t.workspaceId, month(), 50);
  const error = await expectHttpsError(
    create(t.member, t.workspaceId),
    "resource-exhausted",
    {message: TRANSACTIONS_QUOTA_EXHAUSTED_NON_OWNER_MESSAGE},
  );
  const details = error.details as Record<string, unknown>;
  assert.equal(details.used, undefined, "o membro não recebe o uso");
  assert.equal(details.limit, 50);
  assert.doesNotMatch(error.message, /upgrade/i);
});

// ------------------------------------------------- contabilização e período

test("P3-D — conta por workspace: um espaço não consome outro", async () => {
  const owner = uniqueId("quota-multi");
  await seedActiveAccount(owner);
  await seedPaidPlan(owner, "pro");
  const [a, b] = [uniqueId("quota-a"), uniqueId("quota-b")];
  await seedWorkspace({workspaceId: a, ownerId: owner});
  await seedWorkspace({workspaceId: b, ownerId: owner});
  await setUsed(a, month(), 1000);
  await expectHttpsError(create(owner, a), "resource-exhausted");
  await create(owner, b);
  assert.equal(await usedOf(b), 1);
  assert.equal(await usedOf(a), 1000);
});

test("P3-D — virada de mês em São Paulo pelo relógio do servidor", async () => {
  const t = await tenant("free");
  const current = month();
  const following = nextMonth(current);
  const boundary = saoPauloMonthStart(following).getTime();
  await setUsed(t.workspaceId, current, 49);
  const actor = {
    uid: t.owner, workspaceId: t.workspaceId, role: "owner" as const,
  };
  const run = (nowMs: number) => executeCreateCashTransaction(
    actor,
    createCashTransactionPayloadSchema.parse(entryInput(t.workspaceId)),
    uniqueId("req"),
    {now: () => nowMs},
  );
  // Último milissegundo do mês: consome o mês corrente (49 → 50).
  const last = await run(boundary - 1);
  assert.equal(await usedOf(t.workspaceId, current), 50);
  await assert.rejects(run(boundary - 1), (error: {code?: string}) =>
    error.code === "quota_exceeded");
  // Primeiro instante do mês seguinte: contador novo, do zero.
  const first = await run(boundary);
  assert.equal(await usedOf(t.workspaceId, following), 1);
  assert.equal(await usedOf(t.workspaceId, current), 50);
  const quotaPeriods = await Promise.all([last, first].map(async (result) =>
    (await db().doc(
      `workspaces/${t.workspaceId}/transactions/${result.transactionId}`,
    ).get()).get("cashEntry.quotaPeriod")));
  assert.deepEqual(quotaPeriods, [current, following]);
});

test("P3-D — retroativo consome o mês do registro, não o da data", async () => {
  const t = await tenant("free");
  const {transactionId} = await create(t.owner, t.workspaceId, {
    date: "2026-08-20",
  });
  assert.equal(await usedOf(t.workspaceId), 1);
  assert.equal(await usedOf(t.workspaceId, "2026-08"), undefined);
  const entry = (await db()
    .doc(`workspaces/${t.workspaceId}/transactions/${transactionId}`).get())
    .data() ?? {};
  assert.equal(entry.date, "2026-08-20");
  assert.equal(entry.cashEntry.quotaPeriod, month());
});

// --------------------------------------------------- concorrência e replay

test("P3-D — concorrência na última unidade: só uma passa", async () => {
  const t = await tenant("pro");
  await setUsed(t.workspaceId, month(), 999);
  const outcomes = await Promise.allSettled([
    create(t.owner, t.workspaceId),
    create(t.admin, t.workspaceId),
    create(t.member, t.workspaceId),
    create(t.owner, t.workspaceId),
    create(t.admin, t.workspaceId),
  ]);
  const passed = outcomes.filter((outcome) => outcome.status === "fulfilled");
  assert.equal(passed.length, 1);
  for (const outcome of outcomes) {
    if (outcome.status === "rejected") {
      assert.ok(
        ["resource-exhausted", "aborted"]
          .includes((outcome.reason as {code?: string}).code ?? ""),
        String(outcome.reason),
      );
    }
  }
  assert.equal(await usedOf(t.workspaceId), 1000);
  assert.equal(await ledgerSize(t.workspaceId), 1);
});

test("P3-D — replay, pela chave ou pela âncora, não consome", async () => {
  const t = await tenant("free");
  const input = entryInput(t.workspaceId);
  const first = await call<{transactionId: string}>(
    createCashTransaction, t.owner, input,
  );
  const replay = await call<{replayed: boolean}>(
    createCashTransaction, t.owner, input,
  );
  assert.equal(replay.replayed, true);
  await db().doc(
    `users/${t.owner}/idempotency_keys/createCashTransaction_` +
      sha256(`${t.owner}:${input.idempotencyKey}`).slice(0, 32),
  ).delete();
  const anchored = await call<{transactionId: string; replayed: boolean}>(
    createCashTransaction, t.owner, input,
  );
  assert.deepEqual(anchored, {
    transactionId: first.transactionId, replayed: true,
  });
  assert.equal(await usedOf(t.workspaceId), 1);
  // Replay também passa com a quota esgotada.
  await setUsed(t.workspaceId, month(), 50);
  assert.equal((await call<{replayed: boolean}>(
    createCashTransaction, t.owner, input,
  )).replayed, true);
});

test("P3-D — falha antes do commit não consome nem cria", async () => {
  const t = await tenant("free");
  const payload = createCashTransactionPayloadSchema.parse(
    entryInput(t.workspaceId),
  );
  const actor = {
    uid: t.owner, workspaceId: t.workspaceId, role: "owner" as const,
  };
  await assert.rejects(executeCreateCashTransaction(
    actor, payload, "req-falha", {
      beforeCommit: () => {
        throw new Error("falha sintética");
      },
    },
  ));
  assert.equal(await usedOf(t.workspaceId), undefined);
  assert.equal(await ledgerSize(t.workspaceId), 0);
  await executeCreateCashTransaction(actor, payload, "req-ok");
  assert.equal(await usedOf(t.workspaceId), 1);
});

// ---------------------------------------------- correção, anulação, plano

test("P3-D — correção e anulação não consomem nem devolvem", async () => {
  const t = await tenant("free");
  const {transactionId} = await create(t.owner, t.workspaceId);
  const version = async () => formatIsoInstant((await db()
    .doc(`workspaces/${t.workspaceId}/transactions/${transactionId}`).get())
    .get("updatedAt") as Timestamp);
  await call(updateCashTransaction, t.owner, {
    workspaceId: t.workspaceId,
    idempotencyKey: idempotencyKey(),
    transactionId,
    expectedUpdatedAt: await version(),
    reason: "Valor",
    entry: {
      cashAccountId: defaultAccountOf(t.workspaceId),
      type: "despesa", description: "Mercado", category: "Casa",
      amountCents: 12_000, date: "2026-09-15",
    },
  });
  assert.equal(await usedOf(t.workspaceId), 1);
  await call(voidCashTransaction, t.owner, {
    workspaceId: t.workspaceId,
    idempotencyKey: idempotencyKey(),
    transactionId,
    expectedUpdatedAt: await version(),
    reason: "Duplicado",
  });
  assert.equal(await usedOf(t.workspaceId), 1);
  assert.equal(await ledgerSize(t.workspaceId), 1);
});

test("P3-D — downgrade: uso acima do limite só barra criações", async () => {
  const t = await tenant("pro");
  const {transactionId} = await create(t.owner, t.workspaceId);
  await setUsed(t.workspaceId, month(), 60);
  await db().doc(`billing_accounts/${t.owner}`).update({
    planId: "free",
    entitlementStatus: "free",
    subscriptionStatus: "canceled",
  });
  const error = await expectHttpsError(
    create(t.owner, t.workspaceId),
    "resource-exhausted",
  );
  assert.equal((error.details as {limit?: number}).limit, 50);
  // Nada é apagado nem desfeito; a correção segue disponível.
  const entry = await db()
    .doc(`workspaces/${t.workspaceId}/transactions/${transactionId}`).get();
  assert.ok(entry.exists);
  await call(updateCashTransaction, t.owner, {
    workspaceId: t.workspaceId,
    idempotencyKey: idempotencyKey(),
    transactionId,
    expectedUpdatedAt: formatIsoInstant(entry.get("updatedAt")),
    reason: "Ajuste",
    entry: {
      cashAccountId: defaultAccountOf(t.workspaceId),
      type: "despesa", description: "Mercado", category: "Casa",
      amountCents: 9_000, date: "2026-09-15",
    },
  });
  assert.equal(await usedOf(t.workspaceId), 60);
});

test("P3-D — transferência: plano do novo titular, mesmo uso", async () => {
  const t = await tenant("free");
  await seedPaidPlan(t.member, "pro");
  await setUsed(t.workspaceId, month(), 50);
  await expectHttpsError(create(t.owner, t.workspaceId), "resource-exhausted");
  await call(transferWorkspaceOwnership, t.owner, {
    workspaceId: t.workspaceId,
    newOwnerId: t.member,
    idempotencyKey: idempotencyKey(),
  });
  // O antigo titular, agora admin, cria sob o Pro do novo titular.
  await create(t.owner, t.workspaceId);
  assert.equal(await usedOf(t.workspaceId), 51);

  // No sentido inverso, o plano menor do novo titular vale para novas
  // criações; a transferência em si não é bloqueada pelo uso do mês.
  await setUsed(t.workspaceId, month(), 60);
  await call(transferWorkspaceOwnership, t.member, {
    workspaceId: t.workspaceId,
    newOwnerId: t.owner,
    idempotencyKey: idempotencyKey(),
  });
  const error = await expectHttpsError(
    create(t.member, t.workspaceId),
    "resource-exhausted",
    {message: TRANSACTIONS_QUOTA_EXHAUSTED_NON_OWNER_MESSAGE},
  );
  assert.equal((error.details as {planId?: string}).planId, "free");
  assert.equal(await usedOf(t.workspaceId), 60);
});

// ------------------------------------------------ acesso e estado inválido

test("P3-D — suspensa, arquivado, sem membership: sem consumo", async () => {
  const t = await tenant("pro");
  await db().doc(`users/${t.member}`).update({status: "suspended"});
  await expectHttpsError(create(t.member, t.workspaceId), "permission-denied");
  await db().doc(`users/${t.member}`).update({status: "active"});
  await seedMember(t.workspaceId, t.admin, "admin", "removed");
  await expectHttpsError(create(t.admin, t.workspaceId), "permission-denied");
  await expectHttpsError(create(t.viewer, t.workspaceId), "permission-denied");
  await db().doc(`workspaces/${t.workspaceId}`).update({status: "archived"});
  await expectHttpsError(create(t.owner, t.workspaceId),
    "failed-precondition");
  assert.equal(await usedOf(t.workspaceId), undefined);
  assert.equal(await ledgerSize(t.workspaceId), 0);
});

test("P3-D — estado de quota ausente ou incoerente falha fechado", async () => {
  type Corrupt = (workspaceId: string, owner: string) => Promise<unknown>;
  const cases: Array<[string, Corrupt]> = [
    ["sem âncora (workspace anterior à P3-D)", (workspaceId) =>
      db().doc(`workspaces/${workspaceId}/quota_state/transactions`).delete()],
    ["âncora de outro workspace", (workspaceId) =>
      db().doc(`workspaces/${workspaceId}/quota_state/transactions`)
        .update({workspaceId: "outro"})],
    ["rastreio iniciado depois do mês corrente", (workspaceId) =>
      db().doc(`workspaces/${workspaceId}/quota_state/transactions`)
        .update({trackingSince: "2999-01"})],
    ["contador malformado", (workspaceId) =>
      setUsed(workspaceId, month(), -1)],
    ["contador de outro mês no documento", (workspaceId) =>
      monthRef(workspaceId, month()).set({
        workspaceId, monthKey: "2000-01", used: 0, schemaVersion: 1,
      })],
    ["billing do titular ausente", (_workspaceId, owner) =>
      db().doc(`billing_accounts/${owner}`).delete()],
  ];
  for (const [label, corrupt] of cases) {
    const t = await tenant("free");
    await corrupt(t.workspaceId, t.owner);
    await expectHttpsError(
      create(t.owner, t.workspaceId),
      "internal",
      {message: QUOTA_STATE_UNAVAILABLE_MESSAGE},
    ).catch((error) => {
      throw new Error(`${label}: ${String(error)}`);
    });
    assert.equal(await ledgerSize(t.workspaceId), 0, label);
  }
});

test("P3-D — workspace novo nasce com o contador do mês em zero", async () => {
  const uid = uniqueId("quota-boot");
  const boot = await call<{workspaceId: string}>(bootstrapAccount, uid, {});
  // Free comporta um workspace: o segundo exige plano pago.
  await seedPaidPlan(uid, "pro");
  const created = await call<{workspaceId: string}>(createWorkspace, uid, {
    idempotencyKey: idempotencyKey(),
    type: "PJ",
    name: "Empresa",
  });
  for (const workspaceId of [boot.workspaceId, created.workspaceId]) {
    const anchor = (await db()
      .doc(`workspaces/${workspaceId}/quota_state/transactions`).get()).data();
    assert.deepEqual(
      {...anchor, createdAt: undefined},
      {
        workspaceId,
        trackingSince: month(),
        origin: "workspace_created",
        initialUsed: 0,
        schemaVersion: 1,
        createdAt: undefined,
      },
    );
    await create(uid, workspaceId);
    assert.equal(await usedOf(workspaceId), 1);
  }
});

test("P3-D — limite operacional e quota comercial: independentes", async () => {
  const t = await tenant("free");
  await db().doc(
    `workspaces/${t.workspaceId}/rate_limits/` +
      rateLimitDocumentId(CASH_ENTRY_RATE_LIMIT, t.owner),
  ).set({
    workspaceId: t.workspaceId,
    actorId: t.owner,
    operation: CASH_ENTRY_RATE_LIMIT.operation,
    windowStart: Timestamp.now(),
    count: 120,
    expiresAt: Timestamp.fromMillis(Date.now() + 86_400_000),
  });
  await expectHttpsError(create(t.owner, t.workspaceId), "failed-precondition",
    {message: /Muitas solicitações em pouco tempo/});
  assert.equal(await usedOf(t.workspaceId), undefined, "quota intacta");
  // Outro ator, sem limite operacional, ainda tem quota.
  await create(t.member, t.workspaceId);
  assert.equal(await usedOf(t.workspaceId), 1);
});

test("P3-D — tenants isolados: nada de outro titular", async () => {
  const a = await tenant("free");
  const b = await tenant("pro");
  await setUsed(a.workspaceId, month(), 50);
  await create(b.owner, b.workspaceId);
  assert.equal(await usedOf(b.workspaceId), 1);
  const error = await expectHttpsError(
    create(a.member, a.workspaceId),
    "resource-exhausted",
  );
  assert.deepEqual(
    Object.keys(error.details as Record<string, unknown>).sort(),
    ["limit", "periodKey", "planId", "resource"],
  );
  // Membro de A não cria em B.
  await expectHttpsError(create(a.member, b.workspaceId), "permission-denied");
  assert.equal(await usedOf(b.workspaceId), 1);
});
