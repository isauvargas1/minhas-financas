import assert from "node:assert/strict";
import test from "node:test";
import {FieldValue} from "firebase-admin/firestore";

import {getWorkspaceEntitlement} from "../../billing/callables";
import {saoPauloMonthKey} from "../../shared/dateKeys";
import {
  defaultAccountOf,
  seedActiveAccount,
  seedMember,
  seedPaidPlan,
  seedWorkspace,
} from "../../shared/testSupport/kernelTestSupport";
import {transferWorkspaceOwnership} from "../../workspaces/callables";
import {
  DEFAULT_EXPENSE_CATEGORY_ID,
  DEFAULT_INCOME_CATEGORY_ID,
  seedDefaultCategories,
} from "../../settingsCatalog/testSupport/categorySeeds";
import {
  call,
  db,
  expectHttpsError,
  idempotencyKey,
  uniqueId,
} from "../../workspaces/testSupport/p1TestSupport";
import {createCashTransaction, importCashTransactions} from "../callables";

/**
 * Leitura da quota mensal de lançamentos pela interface (P3-E, D-40):
 * `getWorkspaceEntitlement.transactionsQuota`, do contador do backend.
 */
db();

interface Quota {
  status: string;
  periodKey: string;
  limit: number;
  used: number | null;
  remaining: number | null;
  exhausted: boolean | null;
}

const team = async () => {
  const workspaceId = uniqueId("qread-ws");
  const owner = uniqueId("qread-owner");
  const admin = uniqueId("qread-admin");
  const member = uniqueId("qread-member");
  const viewer = uniqueId("qread-viewer");
  for (const uid of [owner, admin, member, viewer]) {
    await seedActiveAccount(uid);
  }
  await seedPaidPlan(owner, "pro");
  await seedWorkspace({workspaceId, ownerId: owner});
  await seedMember(workspaceId, admin, "admin");
  await seedMember(workspaceId, member, "member");
  await seedMember(workspaceId, viewer, "viewer");
  await seedDefaultCategories(workspaceId);
  return {workspaceId, owner, admin, member, viewer};
};

const quotaOf = async (uid: string, workspaceId: string) =>
  (await call<{transactionsQuota: Quota}>(getWorkspaceEntitlement, uid, {
    workspaceId,
  })).transactionsQuota;

const setUsed = (workspaceId: string, used: number) =>
  db().doc(
    `workspaces/${workspaceId}/quota_state/transactions_${saoPauloMonthKey()}`,
  ).set({
    workspaceId,
    monthKey: saoPauloMonthKey(),
    used,
    schemaVersion: 1,
    updatedAt: FieldValue.serverTimestamp(),
  });

const create = (uid: string, workspaceId: string) =>
  call(createCashTransaction, uid, {
    workspaceId,
    cashAccountId: defaultAccountOf(workspaceId),
    idempotencyKey: idempotencyKey(),
    type: "receita",
    description: "Receita",
    categoryId: DEFAULT_INCOME_CATEGORY_ID,
    amountCents: 1_000,
    date: "2026-09-10",
  });

test("P3-E — titular vê o uso; demais papéis só o esgotamento", async () => {
  const t = await team();
  await setUsed(t.workspaceId, 400);
  assert.deepEqual(await quotaOf(t.owner, t.workspaceId), {
    status: "available",
    periodKey: saoPauloMonthKey(),
    limit: 1000,
    used: 400,
    remaining: 600,
    exhausted: false,
  });
  for (const uid of [t.admin, t.member, t.viewer]) {
    assert.deepEqual(await quotaOf(uid, t.workspaceId), {
      status: "available",
      periodKey: saoPauloMonthKey(),
      limit: 1000,
      used: null,
      remaining: null,
      exhausted: false,
    }, uid);
  }
  await setUsed(t.workspaceId, 1000);
  assert.equal((await quotaOf(t.owner, t.workspaceId)).remaining, 0);
  assert.equal((await quotaOf(t.owner, t.workspaceId)).exhausted, true);
  assert.equal((await quotaOf(t.viewer, t.workspaceId)).exhausted, true);
  assert.equal((await quotaOf(t.viewer, t.workspaceId)).used, null);
});

test("P3-E — a leitura acompanha criação e importação", async () => {
  const t = await team();
  assert.equal((await quotaOf(t.owner, t.workspaceId)).used, 0);
  await create(t.member, t.workspaceId);
  assert.equal((await quotaOf(t.owner, t.workspaceId)).used, 1);
  await call(importCashTransactions, t.admin, {
    workspaceId: t.workspaceId,
    cashAccountId: defaultAccountOf(t.workspaceId),
    idempotencyKey: idempotencyKey(),
    importId: uniqueId("arquivo"),
    items: [1, 2, 3].map((index) => ({
      lineId: `l${index}`,
      type: "despesa",
      description: `Linha ${index}`,
      categoryId: DEFAULT_EXPENSE_CATEGORY_ID,
      amountCents: 100 * index,
      date: "2026-09-10",
    })),
  });
  assert.equal((await quotaOf(t.owner, t.workspaceId)).used, 4);
});

test("P3-E — sem âncora ou com estado incoerente: nunca zero", async () => {
  const t = await team();
  await db().doc(`workspaces/${t.workspaceId}/quota_state/transactions`)
    .delete();
  for (const uid of [t.owner, t.member]) {
    assert.deepEqual(await quotaOf(uid, t.workspaceId), {
      status: "not_initialized",
      periodKey: saoPauloMonthKey(),
      limit: 1000,
      used: null,
      remaining: null,
      exhausted: null,
    });
  }
  const other = await team();
  await setUsed(other.workspaceId, -3);
  assert.deepEqual(await quotaOf(other.owner, other.workspaceId), {
    status: "unavailable",
    periodKey: saoPauloMonthKey(),
    limit: 1000,
    used: null,
    remaining: null,
    exhausted: null,
  });
});

test("P3-E — só o workspace autorizado, nada de outro titular", async () => {
  const a = await team();
  const b = await team();
  await setUsed(a.workspaceId, 700);
  await setUsed(b.workspaceId, 5);
  // O titular de A que é só membro de B não vê o uso de B.
  await seedMember(b.workspaceId, a.owner, "member");
  const seenInB = await call<Record<string, unknown>>(
    getWorkspaceEntitlement, a.owner, {workspaceId: b.workspaceId},
  );
  assert.equal((seenInB.transactionsQuota as Quota).used, null);
  const serialized = JSON.stringify(seenInB);
  assert.ok(!serialized.includes(b.owner), "sem uid do titular");
  assert.doesNotMatch(serialized, /cus_|sub_|price_|stripe|grace|700/i);
  // Quem não é membro recebe a recusa genérica.
  await expectHttpsError(
    call(getWorkspaceEntitlement, b.member, {workspaceId: a.workspaceId}),
    "permission-denied",
  );
});

test("P3-E — troca de titular troca quem vê o uso e o limite", async () => {
  const t = await team();
  await seedPaidPlan(t.admin, "business");
  await setUsed(t.workspaceId, 12);
  assert.equal((await quotaOf(t.admin, t.workspaceId)).used, null);
  await call(transferWorkspaceOwnership, t.owner, {
    workspaceId: t.workspaceId,
    newOwnerId: t.admin,
    idempotencyKey: idempotencyKey(),
  });
  assert.deepEqual(await quotaOf(t.admin, t.workspaceId), {
    status: "available",
    periodKey: saoPauloMonthKey(),
    limit: 10000,
    used: 12,
    remaining: 9988,
    exhausted: false,
  });
  assert.equal((await quotaOf(t.owner, t.workspaceId)).used, null);
});
