import assert from "node:assert/strict";
import test from "node:test";
import {FieldValue, Timestamp} from "firebase-admin/firestore";

import {CASH_EVENTS_COLLECTION} from "../../shared/audit";
import {formatIsoInstant} from "../../shared/commitTime";
import {saoPauloDayKey} from "../../shared/dateKeys";
import {sha256} from "../../shared/hashing";
import {rateLimitDocumentId} from "../../shared/rateLimit";
import {
  defaultAccountOf,
  seedActiveAccount,
  seedMember,
  seedWorkspace,
} from "../../shared/testSupport/kernelTestSupport";
import {
  handleTransactionWrite,
  type TransactionWriteEvent,
} from "../../triggers/transactions";
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
import {updateCashTransactionPayloadSchema} from "../contracts";
import {
  CASH_CONFLICT_MESSAGE,
  CASH_ENTRY_MUTATION_RATE_LIMIT,
  executeUpdateCashTransaction,
  executeVoidCashTransaction,
} from "../mutateTransaction";
import {cashPeriodDeltaFor, cashPeriodKeyFor} from "../periods";
import {executeRebuildCashPeriods} from "../rebuild";

/**
 * Correção e anulação autoritativas de lançamento (P3-C, D-35).
 *
 * As callables rodam pelo mesmo caminho do runtime (`.run`) contra o
 * Emulator. A projeção é conferida entregando ao gatilho real
 * (`handleTransactionWrite`) o antes e o depois de cada escrita, com o
 * instante de commit, e comparando com a soma recalculada do ledger.
 */
db();

interface Tenant {
  workspaceId: string;
  owner: string;
  admin: string;
  member: string;
  otherMember: string;
  viewer: string;
}

const seedTenant = async (type: "PF" | "PJ" = "PF"): Promise<Tenant> => {
  const tenant: Tenant = {
    workspaceId: uniqueId("cash-mut-ws"),
    owner: uniqueId("cash-mut-owner"),
    admin: uniqueId("cash-mut-admin"),
    member: uniqueId("cash-mut-member"),
    otherMember: uniqueId("cash-mut-member-b"),
    viewer: uniqueId("cash-mut-viewer"),
  };
  const people = [
    tenant.owner, tenant.admin, tenant.member, tenant.otherMember,
    tenant.viewer,
  ];
  for (const uid of people) {
    await seedActiveAccount(uid);
  }
  await seedWorkspace({
    workspaceId: tenant.workspaceId,
    ownerId: tenant.owner,
    type,
  });
  await seedMember(tenant.workspaceId, tenant.admin, "admin");
  await seedMember(tenant.workspaceId, tenant.member, "member");
  await seedMember(tenant.workspaceId, tenant.otherMember, "member");
  await seedMember(tenant.workspaceId, tenant.viewer, "viewer");
  return tenant;
};

const entryRef = (workspaceId: string, id: string) =>
  db().doc(`workspaces/${workspaceId}/transactions/${id}`);

const read = async (workspaceId: string, id: string) =>
  (await entryRef(workspaceId, id).get()).data() ?? {};

/** Versão que o cliente leria: `updatedAt` em ISO, ou `null`. */
const versionOf = async (workspaceId: string, id: string) => {
  const updatedAt = (await read(workspaceId, id)).updatedAt;
  return updatedAt instanceof Timestamp ? formatIsoInstant(updatedAt) : null;
};

const events = async (workspaceId: string) =>
  (await db().collection(`workspaces/${workspaceId}/${CASH_EVENTS_COLLECTION}`)
    .get()).docs.map((doc) => doc.data());

const mutationEvents = async (workspaceId: string) =>
  (await events(workspaceId)).filter((event) =>
    event.operation !== "cash_entry.created");

const create = async (
  uid: string,
  workspaceId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> => {
  const result = await call<{transactionId: string}>(
    createCashTransaction,
    uid,
    {
      workspaceId,
      cashAccountId: defaultAccountOf(workspaceId),
      idempotencyKey: idempotencyKey(),
      type: "receita",
      description: "Salário de agosto",
      category: "Salário",
      amountCents: 620_000,
      date: "2026-08-20",
      ...overrides,
    },
  );
  return result.transactionId;
};

interface MutationResult {
  transactionId: string;
  replayed: boolean;
  changed?: boolean;
  revision: number;
}

const updatePayload = async (
  workspaceId: string,
  transactionId: string,
  entry: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) => ({
  workspaceId,
  idempotencyKey: idempotencyKey(),
  transactionId,
  expectedUpdatedAt: await versionOf(workspaceId, transactionId),
  reason: "Correção do valor lançado",
  entry: {
    cashAccountId: defaultAccountOf(workspaceId),
    type: "receita",
    description: "Salário de agosto",
    category: "Salário",
    amountCents: 620_000,
    date: "2026-08-20",
    ...entry,
  },
  ...extra,
});

const voidPayload = async (
  workspaceId: string,
  transactionId: string,
  extra: Record<string, unknown> = {},
) => ({
  workspaceId,
  idempotencyKey: idempotencyKey(),
  transactionId,
  expectedUpdatedAt: await versionOf(workspaceId, transactionId),
  reason: "Lançado em duplicidade",
  ...extra,
});

const edit = (uid: string | null, data: Record<string, unknown>) =>
  call<MutationResult>(updateCashTransaction, uid, data);

const annul = (uid: string | null, data: Record<string, unknown>) =>
  call<MutationResult>(voidCashTransaction, uid, data);

const usedSlots = async (workspaceId: string, uid: string) =>
  Number((await db().doc(
    `workspaces/${workspaceId}/rate_limits/` +
      rateLimitDocumentId(CASH_ENTRY_MUTATION_RATE_LIMIT, uid),
  ).get()).get("count") ?? 0);

const idempotencyRecord = (uid: string, operation: string, key: string) =>
  db().doc(
    `users/${uid}/idempotency_keys/${operation}_` +
      sha256(`${uid}:${key}`).slice(0, 32),
  );

/**
 * Documento sem a marca do Caixa, no formato que o caminho direto antigo do
 * cliente gravava (P4-D: nenhum escritor atual o produz). Serve para provar
 * a recusa.
 */
const seedUnmarked = async (
  workspaceId: string,
  userId: string,
  overrides: Record<string, unknown> = {},
  omit: string[] = [],
): Promise<string> => {
  const ref = db().collection(`workspaces/${workspaceId}/transactions`).doc();
  const data: Record<string, unknown> = {
    type: "despesa",
    description: "Compra de mercado",
    category: "Alimentação",
    value: 150.5,
    date: "2026-08-20",
    transactionDate: Timestamp.fromDate(new Date("2026-08-20T12:00:00.000Z")),
    isPaid: true,
    paymentMethod: "pix",
    expenseType: "variavel",
    installments: 1,
    currentInstallment: 1,
    source: "manual",
    userId,
    workspaceId,
    profileId: workspaceId,
    displaySnapshots: {
      categorySnapshot: {label: "Alimentação"},
      paymentMethodSnapshot: {label: "Pix"},
    },
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    ...overrides,
  };
  for (const key of omit) delete data[key];
  await ref.set(data);
  return ref.id;
};

/** Executa a escrita e devolve o evento que o Eventarc entregaria. */
const captured = async (
  workspaceId: string,
  id: string,
  action: () => Promise<unknown>,
): Promise<TransactionWriteEvent> => {
  const before = await entryRef(workspaceId, id).get();
  await action();
  const after = await entryRef(workspaceId, id).get();
  assert.ok(after.updateTime);
  return {
    eventId: uniqueId(`evt-${id}`),
    workspaceId,
    transactionId: id,
    eventTime: after.updateTime,
    before: before.exists ? before.data() : undefined,
    after: after.data(),
    beforeCreateTime: before.exists ? before.createTime : undefined,
  };
};

type Totals = Record<string, {income: number; expense: number; count: number}>;

const truth = async (workspaceId: string): Promise<Totals> => {
  const snapshot = await db()
    .collection(`workspaces/${workspaceId}/transactions`).get();
  const totals: Totals = {};
  for (const doc of snapshot.docs) {
    const key = cashPeriodKeyFor(doc.data());
    if (!key) continue;
    const delta = cashPeriodDeltaFor(doc.data());
    const bucket = totals[key] ?? {income: 0, expense: 0, count: 0};
    bucket.income += delta.incomeCents;
    bucket.expense += delta.expenseCents;
    bucket.count += delta.transactionCount;
    totals[key] = bucket;
  }
  for (const [key, bucket] of Object.entries(totals)) {
    if (!bucket.income && !bucket.expense && !bucket.count) delete totals[key];
  }
  return totals;
};

const projected = async (workspaceId: string): Promise<Totals> => {
  const snapshot = await db()
    .collection(`workspaces/${workspaceId}/cash_report_periods`).get();
  const totals: Totals = {};
  for (const doc of snapshot.docs) {
    if (doc.id.startsWith("cash_periods_rebuild")) continue;
    const data = doc.data();
    const bucket = {
      income: data.incomeCents ?? 0,
      expense: data.expenseCents ?? 0,
      count: data.transactionCount ?? 0,
    };
    if (bucket.income || bucket.expense || bucket.count) {
      totals[doc.id] = bucket;
    }
  }
  return totals;
};

// ------------------------------------------------------------- correção

test("P3-C — corrige receita: valor, mês, campos; mantém origem", async () => {
  const tenant = await seedTenant("PF");
  const id = await create(tenant.member, tenant.workspaceId, {
    incomeType: "Fixa",
  });
  const created = await read(tenant.workspaceId, id);
  const payload = await updatePayload(tenant.workspaceId, id, {
    amountCents: 650_000,
    date: "2026-09-02",
    description: "Salário de agosto (corrigido)",
    incomeType: "Variável",
  }, {correlationId: "corr-tela-1"});

  const result = await edit(tenant.owner, payload);
  assert.deepEqual(result, {
    transactionId: id, replayed: false, changed: true, revision: 2,
  });

  const entry = await read(tenant.workspaceId, id);
  assert.equal(entry.valueCents, 650_000);
  assert.equal(entry.value, 6500);
  assert.equal(entry.date, "2026-09-02");
  assert.equal(saoPauloDayKey(entry.transactionDate.toDate()), "2026-09-02");
  assert.equal(entry.description, "Salário de agosto (corrigido)");
  assert.equal(entry.incomeType, "Variável");
  // Identidade, criação, autoria e âncora da criação preservadas.
  assert.equal(entry.userId, tenant.member);
  assert.equal(entry.createdBy, tenant.member);
  assert.ok(entry.createdAt.isEqual(created.createdAt));
  assert.equal(entry.cashEntry.requestHash, created.cashEntry.requestHash);
  assert.equal(entry.cashEntry.origin, "manual");
  assert.equal(entry.cashEntry.revision, 2);
  assert.equal(entry.cashEntry.status, "confirmed");
  assert.equal(entry.updatedBy, tenant.owner);
  assert.equal(entry.isPaid, true);

  const [event] = await mutationEvents(tenant.workspaceId);
  assert.equal(event.operation, "cash_entry.updated");
  assert.equal(event.actorId, tenant.owner);
  assert.equal(event.actorRole, "owner");
  assert.equal(event.transactionId, id);
  assert.equal(event.reason, "Correção do valor lançado");
  assert.equal(event.correlationId, "corr-tela-1");
  assert.equal(event.revision, 2);
  assert.equal(
    event.intentId,
    sha256(`${tenant.owner}:${payload.idempotencyKey}`).slice(0, 32),
  );
  assert.deepEqual(event.before, {
    status: "confirmed", amountCents: 620_000, type: "receita",
    date: "2026-08-20", dueDate: null,
    cashAccountId: defaultAccountOf(tenant.workspaceId),
  });
  assert.deepEqual(event.after, {
    status: "confirmed", amountCents: 650_000, type: "receita",
    date: "2026-09-02", dueDate: null,
    cashAccountId: defaultAccountOf(tenant.workspaceId),
  });
  assert.deepEqual(event.changedFields, [
    "description", "amountCents", "date", "incomeType",
  ]);
  // Só os campos da trilha: nenhuma descrição, categoria ou texto livre além
  // do motivo.
  assert.deepEqual(Object.keys(event).sort(), [
    "actorId", "actorRole", "after", "before", "changedFields",
    "correlationId", "createdAt", "id", "intentId",
    "operation", "profileType", "reason", "requestHash", "requestId",
    "revision", "transactionId", "workspaceId",
  ]);
});

test("P3-C — corrige despesa em PJ e troca o tipo para receita", async () => {
  const tenant = await seedTenant("PJ");
  const id = await create(tenant.admin, tenant.workspaceId, {
    type: "despesa",
    description: "Fornecedor",
    category: "Operação",
    amountCents: 48_235,
    expenseType: "Variável",
    paymentMethod: "Pix",
    supplier: "Mercado Central",
    costCenter: "Loja 1",
  });
  await edit(tenant.admin, await updatePayload(tenant.workspaceId, id, {
    type: "receita",
    description: "Devolução do fornecedor",
    category: "Reembolso",
    amountCents: 48_235,
    incomeType: "Eventual",
    supplier: "Mercado Central",
  }));
  const entry = await read(tenant.workspaceId, id);
  assert.equal(entry.type, "receita");
  assert.equal(entry.incomeType, "Eventual");
  assert.equal(entry.supplier, "Mercado Central");
  for (const removed of ["expenseType", "paymentMethod", "costCenter"]) {
    assert.equal(removed in entry, false, `${removed} deveria sair`);
  }
  const [event] = await mutationEvents(tenant.workspaceId);
  assert.deepEqual(
    [event.before.type, event.after.type],
    ["despesa", "receita"],
  );
  assert.equal(event.profileType, "PJ");
});

test("P3-C — correção sem mudança não grava, audita nem consome", async () => {
  const tenant = await seedTenant("PF");
  const id = await create(tenant.owner, tenant.workspaceId);
  const before = await read(tenant.workspaceId, id);
  const result = await edit(
    tenant.owner,
    await updatePayload(tenant.workspaceId, id, {}),
  );
  assert.deepEqual(result, {
    transactionId: id, replayed: false, changed: false, revision: 1,
  });
  assert.ok((await read(tenant.workspaceId, id)).updatedAt
    .isEqual(before.updatedAt));
  assert.equal((await mutationEvents(tenant.workspaceId)).length, 0);
  assert.equal(await usedSlots(tenant.workspaceId, tenant.owner), 0);
});

// ----------------------------------------------------- anulação e projeção

test("P3-C — anulação lógica: o documento fica, o caixa sai", async () => {
  const tenant = await seedTenant("PF");
  const id = await create(tenant.member, tenant.workspaceId);
  const result = await annul(
    tenant.member,
    await voidPayload(tenant.workspaceId, id),
  );
  assert.deepEqual(result, {transactionId: id, replayed: false, revision: 2});
  const entry = await read(tenant.workspaceId, id);
  assert.ok(entry.voidedAt instanceof Timestamp);
  assert.equal(entry.voidedBy, tenant.member);
  assert.equal(entry.voidReason, "Lançado em duplicidade");
  assert.equal(entry.cashEntry.status, "voided");
  assert.equal(entry.valueCents, 620_000, "o valor histórico permanece");
  assert.deepEqual(cashPeriodDeltaFor(entry).transactionCount, 0);

  const [event] = await mutationEvents(tenant.workspaceId);
  assert.equal(event.operation, "cash_entry.voided");
  assert.deepEqual(event.before, {
    status: "confirmed", amountCents: 620_000, type: "receita",
    date: "2026-08-20", dueDate: null,
    cashAccountId: defaultAccountOf(tenant.workspaceId),
  });
  assert.equal(event.after, null);
  assert.equal(event.reason, "Lançado em duplicidade");
});

test("P3-C — anulado não é corrigido, reanulado nem reativado", async () => {
  const tenant = await seedTenant("PF");
  const id = await create(tenant.owner, tenant.workspaceId);
  await annul(tenant.owner, await voidPayload(tenant.workspaceId, id));
  const voided = await read(tenant.workspaceId, id);
  const message = "Lançamento anulado não pode ser alterado nem reativado.";
  await expectHttpsError(
    edit(tenant.owner, await updatePayload(tenant.workspaceId, id, {
      amountCents: 1,
    })),
    "failed-precondition",
    {message},
  );
  await expectHttpsError(
    annul(tenant.owner, await voidPayload(tenant.workspaceId, id)),
    "failed-precondition",
    {message},
  );
  assert.deepEqual(await read(tenant.workspaceId, id), voided);
  assert.equal((await mutationEvents(tenant.workspaceId)).length, 1);
});

test("P3-C — correção de valor, mês, tipo e anulação no caixa", async () => {
  const tenant = await seedTenant("PF");
  const deliver = (event: TransactionWriteEvent) =>
    handleTransactionWrite(event);
  // O ID só existe depois da criação: o evento de criação é montado com ele.
  const id = await create(tenant.owner, tenant.workspaceId);
  const createdDoc = await entryRef(tenant.workspaceId, id).get();
  await deliver({
    eventId: uniqueId("evt-create"),
    workspaceId: tenant.workspaceId,
    transactionId: id,
    eventTime: createdDoc.updateTime as Timestamp,
    after: createdDoc.data(),
  });
  assert.deepEqual(await projected(tenant.workspaceId), {
    "2026-08": {income: 620_000, expense: 0, count: 1},
  });

  await deliver(await captured(tenant.workspaceId, id, async () =>
    edit(tenant.owner, await updatePayload(tenant.workspaceId, id, {
      type: "despesa",
      description: "Era despesa",
      category: "Casa",
      amountCents: 12_345,
      date: "2026-09-10",
    }))));
  assert.deepEqual(await projected(tenant.workspaceId), {
    "2026-09": {income: 0, expense: 12_345, count: 1},
  });
  assert.deepEqual(await projected(tenant.workspaceId),
    await truth(tenant.workspaceId));

  await deliver(await captured(tenant.workspaceId, id, async () =>
    annul(tenant.owner, await voidPayload(tenant.workspaceId, id))));
  assert.deepEqual(await projected(tenant.workspaceId), {});
  assert.deepEqual(await truth(tenant.workspaceId), {});

  // A reconstrução enxerga o mesmo ledger e chega ao mesmo caixa.
  for (let call = 0; call < 10; call += 1) {
    const step = await executeRebuildCashPeriods(
      tenant.workspaceId,
      tenant.owner,
      {
        workspaceId: tenant.workspaceId, idempotencyKey: "rebuild-key-0001",
        correlationId: "corr-rebuild", reason: "conferência",
        pageSize: 50, dryRun: false,
      },
    );
    if (step.completed === true) break;
  }
  assert.deepEqual(await projected(tenant.workspaceId), {});
});

// --------------------------------------------------------------- contrato

test("P3-C — valor, vínculo e autoridade forjados: recusados", async () => {
  const tenant = await seedTenant("PF");
  const id = await create(tenant.owner, tenant.workspaceId);
  const before = await read(tenant.workspaceId, id);
  const base = await updatePayload(tenant.workspaceId, id, {});
  const invalid: Array<Record<string, unknown>> = [
    {entry: {...base.entry, amountCents: 0}},
    {entry: {...base.entry, amountCents: 10.5}},
    {entry: {...base.entry, amountCents: 100_000_000_001}},
    {entry: {...base.entry, date: "2999-01-01"}},
    {entry: {...base.entry, type: "investimento"}},
    {entry: {...base.entry, valueCents: 1}},
    {entry: {...base.entry, userId: tenant.viewer}},
    {entry: {...base.entry, cardId: "card-1"}},
    {entry: {...base.entry, loanId: "loan-1"}},
    {entry: {...base.entry, goalId: "goal-1"}},
    {entry: {...base.entry, isPaid: false}},
    // Fornecedor e centro de custo só em PJ: o espaço aqui é PF.
    {entry: {...base.entry, supplier: "Fornecedor"}},
    {entry: {...base.entry, costCenter: "Loja"}},
    {userId: tenant.viewer},
    {cashEntry: {status: "confirmed"}},
    {createdBy: tenant.viewer},
    {reason: ""},
    {expectedUpdatedAt: "ontem"},
  ];
  for (const override of invalid) {
    await expectHttpsError(
      edit(tenant.owner, {...base, ...override}),
      "invalid-argument",
    ).catch((error) => {
      throw new Error(`${JSON.stringify(override)}: ${String(error)}`);
    });
  }
  await expectHttpsError(
    annul(tenant.owner, {...await voidPayload(tenant.workspaceId, id),
      voidedBy: tenant.viewer}),
    "invalid-argument",
  );
  assert.deepEqual(await read(tenant.workspaceId, id), before);
  assert.equal((await mutationEvents(tenant.workspaceId)).length, 0);
});

// ------------------------------------------------------------ autorização

test("P3-C — owner/admin corrigem; member só o seu; viewer, não", async () => {
  const tenant = await seedTenant("PF");
  const own = await create(tenant.member, tenant.workspaceId);
  const others = await create(tenant.otherMember, tenant.workspaceId);
  const ownership =
    "Você só pode alterar os lançamentos que você mesmo registrou.";

  await expectHttpsError(
    edit(tenant.member, await updatePayload(tenant.workspaceId, others, {
      amountCents: 1,
    })),
    "permission-denied",
    {message: ownership},
  );
  await expectHttpsError(
    annul(tenant.member, await voidPayload(tenant.workspaceId, others)),
    "permission-denied",
    {message: ownership},
  );
  await expectHttpsError(
    edit(null, await updatePayload(tenant.workspaceId, own, {amountCents: 1})),
    "unauthenticated",
  );
  await expectHttpsError(
    annul(null, await voidPayload(tenant.workspaceId, own)),
    "unauthenticated",
  );
  for (const uid of [tenant.viewer]) {
    await expectHttpsError(
      edit(uid, await updatePayload(tenant.workspaceId, own, {amountCents: 1})),
      "permission-denied",
    );
    await expectHttpsError(
      annul(uid, await voidPayload(tenant.workspaceId, own)),
      "permission-denied",
    );
  }
  assert.equal((await mutationEvents(tenant.workspaceId)).length, 0);

  const mine = await edit(tenant.member,
    await updatePayload(tenant.workspaceId, own, {amountCents: 1_000}));
  assert.equal(mine.changed, true);
  await edit(tenant.owner,
    await updatePayload(tenant.workspaceId, others, {amountCents: 2_000}));
  await edit(tenant.admin,
    await updatePayload(tenant.workspaceId, others, {amountCents: 3_000}));
  assert.equal((await read(tenant.workspaceId, others)).valueCents, 3_000);
  assert.equal((await read(tenant.workspaceId, others)).userId,
    tenant.otherMember, "a autoria não muda com a correção");
  await annul(tenant.admin, await voidPayload(tenant.workspaceId, others));
  assert.deepEqual(
    (await mutationEvents(tenant.workspaceId))
      .map((event) => `${event.actorRole}:${event.operation}`).sort(),
    [
      "admin:cash_entry.updated", "admin:cash_entry.voided",
      "member:cash_entry.updated", "owner:cash_entry.updated",
    ],
  );
});

test("P3-C — conta suspensa, membro removido, espaço arquivado", async () => {
  const tenant = await seedTenant("PF");
  const id = await create(tenant.member, tenant.workspaceId);
  const before = await read(tenant.workspaceId, id);

  await seedMember(tenant.workspaceId, tenant.member, "member", "removed");
  await expectHttpsError(
    edit(tenant.member, await updatePayload(tenant.workspaceId, id, {
      amountCents: 1,
    })),
    "permission-denied",
  );
  await seedMember(tenant.workspaceId, tenant.member, "member");

  await db().doc(`users/${tenant.member}`).update({status: "suspended"});
  await expectHttpsError(
    annul(tenant.member, await voidPayload(tenant.workspaceId, id)),
    "permission-denied",
    {reason: "account_suspended"},
  );
  await db().doc(`users/${tenant.member}`).update({status: "active"});

  await db().doc(`workspaces/${tenant.workspaceId}`)
    .update({status: "archived"});
  await expectHttpsError(
    edit(tenant.owner, await updatePayload(tenant.workspaceId, id, {
      amountCents: 1,
    })),
    "failed-precondition",
    {reason: "workspace_archived"},
  );
  assert.deepEqual(await read(tenant.workspaceId, id), before);
  assert.equal((await mutationEvents(tenant.workspaceId)).length, 0);
});

test("P3-C — nenhum tenant altera lançamento do outro", async () => {
  const tenantA = await seedTenant("PF");
  const tenantB = await seedTenant("PF");
  const inA = await create(tenantA.owner, tenantA.workspaceId);
  const inB = await create(tenantB.owner, tenantB.workspaceId);
  for (const [actor, target, id] of [
    [tenantB.owner, tenantA.workspaceId, inA],
    [tenantA.owner, tenantB.workspaceId, inB],
  ] as const) {
    await expectHttpsError(
      edit(actor, await updatePayload(target, id, {amountCents: 1})),
      "permission-denied",
    );
    await expectHttpsError(
      annul(actor, await voidPayload(target, id)),
      "permission-denied",
    );
  }
  // O próprio workspace com o ID do outro: o caminho é o do tenant
  // autorizado, e o documento não existe nele.
  await expectHttpsError(
    edit(tenantB.owner, {
      ...await updatePayload(tenantA.workspaceId, inA, {amountCents: 1}),
      workspaceId: tenantB.workspaceId,
    }),
    "not-found",
  );
  assert.equal((await read(tenantA.workspaceId, inA)).valueCents, 620_000);
  assert.equal((await mutationEvents(tenantA.workspaceId)).length, 0);
  assert.equal((await mutationEvents(tenantB.workspaceId)).length, 0);
});

test("P3-C — papel revogado depois da pré-checagem é recusado", async () => {
  const tenant = await seedTenant("PF");
  const id = await create(tenant.member, tenant.workspaceId);
  const payload = updateCashTransactionPayloadSchema.parse(
    await updatePayload(tenant.workspaceId, id, {amountCents: 1}),
  );
  await seedMember(tenant.workspaceId, tenant.member, "member", "removed");
  await assert.rejects(
    executeUpdateCashTransaction(
      {uid: tenant.member, workspaceId: tenant.workspaceId, role: "member"},
      payload,
      "req-revogado",
    ),
    (error: {code?: string}) =>
      error.code === "workspace_membership_required",
  );
  await seedMember(tenant.workspaceId, tenant.admin, "viewer");
  await assert.rejects(
    executeVoidCashTransaction(
      {uid: tenant.admin, workspaceId: tenant.workspaceId, role: "admin"},
      await voidPayload(tenant.workspaceId, id),
      "req-rebaixado",
    ),
    (error: {code?: string}) => error.code === "workspace_role_denied",
  );
  assert.equal((await read(tenant.workspaceId, id)).valueCents, 620_000);
  assert.equal((await mutationEvents(tenant.workspaceId)).length, 0);
});

// --------------------------------------- idempotência, versão e concorrência

test("P3-C — replay sem nova escrita; chave reusada: recusa", async () => {
  const tenant = await seedTenant("PF");
  const id = await create(tenant.owner, tenant.workspaceId);
  const payload = await updatePayload(tenant.workspaceId, id, {
    amountCents: 700_000,
  });
  const first = await edit(tenant.owner, payload);
  const afterFirst = await read(tenant.workspaceId, id);
  const replay = await edit(tenant.owner, payload);
  assert.deepEqual(replay, {...first, replayed: true});
  assert.ok((await read(tenant.workspaceId, id)).updatedAt
    .isEqual(afterFirst.updatedAt));
  assert.equal((await mutationEvents(tenant.workspaceId)).length, 1);
  assert.equal(await usedSlots(tenant.workspaceId, tenant.owner), 1);

  await expectHttpsError(
    edit(tenant.owner, {...payload, reason: "Outro motivo"}),
    "failed-precondition",
    {message: "Esta chave de idempotência já foi usada com outros dados."},
  );
  // Chave do ator expirada: a trilha da intenção ainda é a âncora.
  await idempotencyRecord(
    tenant.owner, "updateCashTransaction", payload.idempotencyKey,
  ).delete();
  assert.deepEqual(
    await edit(tenant.owner, payload),
    {...first, replayed: true},
  );
  assert.equal((await mutationEvents(tenant.workspaceId)).length, 1);
  // Com a chave expirada, a mesma chave com outro conteúdo continua conflito.
  await idempotencyRecord(
    tenant.owner, "updateCashTransaction", payload.idempotencyKey,
  ).delete();
  await expectHttpsError(
    edit(tenant.owner, {...payload, reason: "Outro motivo"}),
    "failed-precondition",
    {message: "Esta chave de idempotência já foi usada com outros dados."},
  );
  assert.equal((await read(tenant.workspaceId, id)).valueCents, 700_000);
  assert.equal((await mutationEvents(tenant.workspaceId)).length, 1);

  const voidData = await voidPayload(tenant.workspaceId, id);
  const voided = await annul(tenant.owner, voidData);
  assert.deepEqual(await annul(tenant.owner, voidData),
    {...voided, replayed: true});
  assert.equal((await mutationEvents(tenant.workspaceId)).length, 2);
});

test("P3-C — versão desatualizada: conflito em pt-BR", async () => {
  const tenant = await seedTenant("PF");
  const id = await create(tenant.owner, tenant.workspaceId);
  const stale = await updatePayload(tenant.workspaceId, id, {amountCents: 1});
  await edit(tenant.owner,
    await updatePayload(tenant.workspaceId, id, {amountCents: 2}));
  await expectHttpsError(edit(tenant.admin, stale), "aborted",
    {message: CASH_CONFLICT_MESSAGE});

  // Outra escrita do backend (atualiza `updatedAt`) depois da leitura.
  const other = await create(tenant.member, tenant.workspaceId);
  const seen = await updatePayload(tenant.workspaceId, other, {
    amountCents: 15_050,
  });
  await entryRef(tenant.workspaceId, other).update({
    updatedAt: FieldValue.serverTimestamp(),
  });
  await expectHttpsError(edit(tenant.owner, seen), "aborted",
    {message: CASH_CONFLICT_MESSAGE});
  // Versão ausente não casa com um documento que tem versão.
  await expectHttpsError(
    annul(tenant.owner, {...await voidPayload(tenant.workspaceId, other),
      expectedUpdatedAt: null}),
    "aborted",
  );
  assert.equal((await read(tenant.workspaceId, other)).isPaid, true);
  assert.equal((await mutationEvents(tenant.workspaceId)).length, 1);
});

test("P3-C — correções simultâneas: uma vence, outra conflita", async () => {
  const tenant = await seedTenant("PF");
  const id = await create(tenant.owner, tenant.workspaceId);
  const [left, right] = await Promise.all([
    updatePayload(tenant.workspaceId, id, {amountCents: 111}),
    updatePayload(tenant.workspaceId, id, {amountCents: 222}),
  ]);
  const outcomes = await Promise.allSettled([
    edit(tenant.owner, left),
    edit(tenant.admin, right),
  ]);
  const won = outcomes.filter((outcome) => outcome.status === "fulfilled");
  assert.equal(won.length, 1, "só uma correção vale");
  const lost = outcomes.find((outcome) => outcome.status === "rejected") as
    PromiseRejectedResult;
  assert.equal((lost.reason as {code?: string}).code, "aborted");
  const value = (await read(tenant.workspaceId, id)).valueCents;
  assert.ok(value === 111 || value === 222);
  const audit = await mutationEvents(tenant.workspaceId);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].after.amountCents, value);
});

test("P3-C — correção concorrente com anulação: só uma se aplica", async () => {
  const tenant = await seedTenant("PF");
  for (let round = 0; round < 3; round += 1) {
    const id = await create(tenant.owner, tenant.workspaceId);
    const [editData, voidData] = await Promise.all([
      updatePayload(tenant.workspaceId, id, {amountCents: 999}),
      voidPayload(tenant.workspaceId, id),
    ]);
    const outcomes = await Promise.allSettled([
      edit(tenant.owner, editData),
      annul(tenant.admin, voidData),
    ]);
    assert.equal(
      outcomes.filter((outcome) => outcome.status === "fulfilled").length,
      1,
      `rodada ${round}`,
    );
    const entry = await read(tenant.workspaceId, id);
    const voided = entry.voidedAt instanceof Timestamp;
    // Anulado com o valor original, ou corrigido e ainda ativo.
    assert.equal(entry.valueCents, voided ? 620_000 : 999);
    const audit = (await mutationEvents(tenant.workspaceId))
      .filter((event) => event.transactionId === id);
    assert.equal(audit.length, 1);
    assert.equal(
      audit[0].operation,
      voided ? "cash_entry.voided" : "cash_entry.updated",
    );
  }
});

test("P3-C — falha no commit: sem escrita, evento, chave ou uso", async () => {
  const tenant = await seedTenant("PF");
  const id = await create(tenant.owner, tenant.workspaceId);
  const before = await read(tenant.workspaceId, id);
  const payload = updateCashTransactionPayloadSchema.parse(
    await updatePayload(tenant.workspaceId, id, {amountCents: 1}),
  );
  const actor = {
    uid: tenant.owner, workspaceId: tenant.workspaceId, role: "owner" as const,
  };
  const failing = {
    beforeCommit: () => {
      throw new Error("falha sintética antes do commit");
    },
  };
  await assert.rejects(
    executeUpdateCashTransaction(actor, payload, "req-falha", failing),
  );
  await assert.rejects(executeVoidCashTransaction(
    actor, await voidPayload(tenant.workspaceId, id), "req-falha-2", failing,
  ));
  assert.deepEqual(await read(tenant.workspaceId, id), before);
  assert.equal((await mutationEvents(tenant.workspaceId)).length, 0);
  assert.equal(await usedSlots(tenant.workspaceId, tenant.owner), 0);
  assert.equal((await idempotencyRecord(
    tenant.owner, "updateCashTransaction", payload.idempotencyKey,
  ).get()).exists, false);

  // A mesma intenção, sem a falha, aplica uma vez.
  assert.equal((await edit(tenant.owner, payload)).changed, true);
  assert.equal((await mutationEvents(tenant.workspaceId)).length, 1);
});

test("P3-C — limite no teto recusa sem efeito; replay passa", async () => {
  const tenant = await seedTenant("PF");
  const id = await create(tenant.owner, tenant.workspaceId);
  const payload = await updatePayload(tenant.workspaceId, id, {
    amountCents: 5_000,
  });
  const first = await edit(tenant.owner, payload);
  assert.equal(await usedSlots(tenant.workspaceId, tenant.owner), 1);
  await db().doc(
    `workspaces/${tenant.workspaceId}/rate_limits/` +
      rateLimitDocumentId(CASH_ENTRY_MUTATION_RATE_LIMIT, tenant.owner),
  ).update({count: 120});
  await expectHttpsError(
    annul(tenant.owner, await voidPayload(tenant.workspaceId, id)),
    "failed-precondition",
    {message: /Muitas solicitações em pouco tempo/},
  );
  assert.equal((await read(tenant.workspaceId, id)).voidedAt, undefined);
  assert.deepEqual(await edit(tenant.owner, payload),
    {...first, replayed: true});
  assert.equal(await usedSlots(tenant.workspaceId, tenant.owner), 120);
  assert.equal((await mutationEvents(tenant.workspaceId)).length, 1);
});

test("P3-C — replay da criação vale após corrigir e anular", async () => {
  const tenant = await seedTenant("PF");
  const key = idempotencyKey();
  const creation = {
    workspaceId: tenant.workspaceId,
    cashAccountId: defaultAccountOf(tenant.workspaceId),
    idempotencyKey: key,
    type: "receita",
    description: "Salário",
    category: "Salário",
    amountCents: 100_000,
    date: "2026-08-10",
  };
  const created = await call<{transactionId: string}>(
    createCashTransaction, tenant.owner, creation,
  );
  const id = created.transactionId;
  await edit(tenant.owner, await updatePayload(tenant.workspaceId, id, {
    description: "Salário", amountCents: 120_000, date: "2026-08-10",
  }));
  await annul(tenant.owner, await voidPayload(tenant.workspaceId, id));
  const finalState = await read(tenant.workspaceId, id);
  await idempotencyRecord(tenant.owner, "createCashTransaction", key).delete();
  const replay = await call<{transactionId: string; replayed: boolean}>(
    createCashTransaction, tenant.owner, creation,
  );
  assert.deepEqual(replay, {transactionId: id, replayed: true});
  assert.deepEqual(await read(tenant.workspaceId, id), finalState);
  const docs = await db()
    .collection(`workspaces/${tenant.workspaceId}/transactions`).get();
  assert.equal(docs.size, 1, "nenhum lançamento novo");
});

// ------------------------------------------------- elegibilidade e legado

test("P3-C — lançamentos de outros domínios: recusa intacta", async () => {
  const tenant = await seedTenant("PF");
  const shapes: Array<[string, Record<string, unknown>]> = [
    ["unsupported_type", {
      type: "investimento", description: "Aporte", category: "Investimentos",
      value: 100, valueCents: 10_000, date: "2026-08-20", isPaid: true,
      userId: tenant.owner, workspaceId: tenant.workspaceId,
      investmentEntry: {status: "settled", operation: "contribution"},
    }],
    ["linked_to_other_domain", {
      type: "receita", description: "Resgate", category: "Investimentos",
      value: 100, valueCents: 10_000, date: "2026-08-20", isPaid: true,
      userId: tenant.owner, workspaceId: tenant.workspaceId,
      investmentEntry: {status: "settled", operation: "redemption"},
    }],
    ["unsupported_origin", {
      type: "despesa", description: "Pagamento de fatura",
      category: "Cartão", value: 300, date: "2026-08-20", isPaid: true,
      userId: tenant.owner, workspaceId: tenant.workspaceId,
      source: "credit_card_invoice_payment",
    }],
    // P4-B: o formato da geração recorrente anterior (autor de sistema,
    // `source: recurring`) não tem mais escritor e continua recusado.
    ["unsupported_origin", {
      type: "despesa", description: "Aluguel (recorrente)", category: "Casa",
      value: 1800, date: "2026-08-20", isPaid: false,
      userId: "system:recurring-expenses", workspaceId: tenant.workspaceId,
      source: "recurring",
    }],
    ["unsupported_type", {
      type: "parcelado", description: "Notebook", category: "Eletrônicos",
      value: 500, date: "2026-08-20", installments: 10, currentInstallment: 1,
      cardId: "card-1", userId: tenant.owner, workspaceId: tenant.workspaceId,
    }],
    ["linked_to_other_domain", {
      type: "receita", description: "Empréstimo recebido", category: "Outros",
      value: 1000, date: "2026-08-20", userId: tenant.owner,
      workspaceId: tenant.workspaceId, loanId: "loan-1",
      loanMovementId: "mov-1",
    }],
  ];
  for (const [code, data] of shapes) {
    const id = await seedUnmarked(tenant.workspaceId, tenant.owner, {});
    await entryRef(tenant.workspaceId, id).set({
      ...data,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    const before = await read(tenant.workspaceId, id);
    const error = await expectHttpsError(
      annul(tenant.owner, await voidPayload(tenant.workspaceId, id)),
      "failed-precondition",
      {message: "Este lançamento não pode ser alterado por esta operação."},
    );
    assert.equal((error.details as {ineligible?: string}).ineligible, code);
    assert.deepEqual(await read(tenant.workspaceId, id), before);
  }
  assert.equal((await mutationEvents(tenant.workspaceId)).length, 0);
});

test("P4-D — documento sem a marca do Caixa não é corrigido nem anulado",
  async () => {
    // A adoção `legacy_manual` (P3-C) saiu com o caminho direto do cliente:
    // receita/despesa sem `cashEntry` não é lançamento do Caixa.
    const tenant = await seedTenant("PF");
    const accountRef = db().doc(`workspaces/${tenant.workspaceId}/` +
      `cash_accounts/${defaultAccountOf(tenant.workspaceId)}`);
    const balanceBefore = (await accountRef.get()).get("balanceCents");
    const shapes: Array<[Record<string, unknown>, string[]?]> = [
      [{}],
      [{isPaid: false}],
      [{type: "receita", category: "Salário", value: 3200},
        ["isPaid", "expenseType", "paymentMethod"]],
      [{valueCents: 15_050}],
    ];
    for (const [overrides, omit] of shapes) {
      const id = await seedUnmarked(
        tenant.workspaceId, tenant.member, overrides, omit,
      );
      const before = await read(tenant.workspaceId, id);
      for (const attempt of [
        async () => edit(tenant.member,
          await updatePayload(tenant.workspaceId, id, {
            type: "despesa", amountCents: 16_000,
          })),
        async () => annul(tenant.member,
          await voidPayload(tenant.workspaceId, id)),
      ]) {
        const error = await expectHttpsError(attempt(), "failed-precondition",
          {message: "Este lançamento não pode ser alterado por esta operação."});
        assert.equal((error.details as {ineligible?: string}).ineligible,
          "unsupported_origin", JSON.stringify(overrides));
      }
      assert.deepEqual(await read(tenant.workspaceId, id), before);
    }
    assert.equal((await mutationEvents(tenant.workspaceId)).length, 0);
    assert.equal((await accountRef.get()).get("balanceCents"), balanceBefore);
  });

test("P3-C — versão que não é Timestamp é recusada sem alterar nada",
  async () => {
    const tenant = await seedTenant("PF");
    const id = await create(tenant.owner, tenant.workspaceId);
    await entryRef(tenant.workspaceId, id).update({updatedAt: "2026-08-20"});
    const before = await read(tenant.workspaceId, id);
    const error = await expectHttpsError(
      annul(tenant.owner, {...await voidPayload(tenant.workspaceId, id),
        expectedUpdatedAt: null}),
      "failed-precondition",
    );
    assert.equal(
      (error.details as {ineligible?: string}).ineligible,
      "ambiguous_version",
    );
    assert.deepEqual(await read(tenant.workspaceId, id), before);
    assert.equal((await mutationEvents(tenant.workspaceId)).length, 0);
  });
