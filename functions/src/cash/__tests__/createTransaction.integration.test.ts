import assert from "node:assert/strict";
import test from "node:test";
import {Timestamp} from "firebase-admin/firestore";

import {cashEntryMovementIdFor} from "../../accounts/model";
import {CASH_EVENTS_COLLECTION, cashEventId} from "../../shared/audit";
import {
  addDaysToDayKey,
  saoPauloDayKey,
  saoPauloMonthKey,
} from "../../shared/dateKeys";
import {sha256} from "../../shared/hashing";
import {
  defaultAccountOf,
  seedActiveAccount,
  seedMember,
  seedWorkspace,
} from "../../shared/testSupport/kernelTestSupport";
import {
  call,
  db,
  expectHttpsError,
  idempotencyKey,
  uniqueId,
} from "../../workspaces/testSupport/p1TestSupport";
import {createCashTransaction} from "../callables";
import {
  CASH_ENTRY_RATE_LIMIT,
  CREATE_CASH_TRANSACTION_OPERATION,
  cashTransactionId,
  executeCreateCashTransaction,
} from "../createTransaction";
import {rateLimitDocumentId} from "../../shared/rateLimit";
import {
  applyCashPeriodWriteOnce,
  cashPeriodDeltaFor,
  cashPeriodEventKey,
  cashPeriodKeyFor,
  emptyCashPeriodDelta,
} from "../periods";

/**
 * Criação autoritativa de lançamento manual confirmado (P3-A, PR-TX-01).
 *
 * Exercita a callable exportada pelo mesmo caminho do runtime (`.run`) contra
 * o Emulator: autorização, contrato, idempotência, concorrência, atomicidade e
 * compatibilidade do fato gravado com a projeção de caixa existente.
 */
db();

interface Result {
  transactionId: string;
  replayed: boolean;
}

interface Tenant {
  workspaceId: string;
  owner: string;
  admin: string;
  member: string;
  viewer: string;
}

const seedTenant = async (type: "PF" | "PJ" = "PF"): Promise<Tenant> => {
  const tenant: Tenant = {
    workspaceId: uniqueId("cash-ws"),
    owner: uniqueId("cash-owner"),
    admin: uniqueId("cash-admin"),
    member: uniqueId("cash-member"),
    viewer: uniqueId("cash-viewer"),
  };
  const people = [tenant.owner, tenant.admin, tenant.member, tenant.viewer];
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
  await seedMember(tenant.workspaceId, tenant.viewer, "viewer");
  return tenant;
};

const payload = (
  workspaceId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  workspaceId,
  cashAccountId: defaultAccountOf(workspaceId),
  idempotencyKey: idempotencyKey(),
  type: "receita",
  description: "Salário de setembro",
  category: "Salário",
  amountCents: 620_000,
  date: "2026-09-15",
  ...overrides,
});

const create = (uid: string | null, data: Record<string, unknown>) =>
  call<Result>(createCashTransaction, uid, data);

const entries = async (workspaceId: string) =>
  (await db().collection(`workspaces/${workspaceId}/transactions`).get()).docs;

const entryRef = (workspaceId: string, transactionId: string) =>
  db().doc(`workspaces/${workspaceId}/transactions/${transactionId}`);

const events = async (workspaceId: string) =>
  (await db().collection(`workspaces/${workspaceId}/${CASH_EVENTS_COLLECTION}`)
    .get()).docs.map((doc) => doc.data());

const idempotencyRecord = (uid: string, key: string) =>
  db().doc(
    `users/${uid}/idempotency_keys/${CREATE_CASH_TRANSACTION_OPERATION}_` +
      sha256(`${uid}:${key}`).slice(0, 32),
  );

const hasIdempotencyRecord = async (uid: string, key: string) =>
  (await idempotencyRecord(uid, key).get()).exists;

const replayOf = (first: Result): Result =>
  ({transactionId: first.transactionId, replayed: true});

/** Nenhum lançamento, evento ou chave: a recusa não deixou efeito. */
const assertNoEffect = async (
  workspaceId: string,
  uid: string,
  key: string,
) => {
  assert.equal((await entries(workspaceId)).length, 0, "lançamento gravado");
  assert.equal((await events(workspaceId)).length, 0, "evento gravado");
  assert.equal(
    await hasIdempotencyRecord(uid, key),
    false,
    "chave de idempotência gravada",
  );
};

// ------------------------------------------------------------ fluxo válido

test("P3-A — receita válida grava um fato único e auditado", async () => {
  const tenant = await seedTenant("PF");
  const data = payload(tenant.workspaceId, {incomeType: "Fixa"});
  const result = await create(tenant.member, data);

  assert.equal(result.replayed, false);
  assert.equal(
    result.transactionId,
    cashTransactionId(
      tenant.workspaceId,
      tenant.member,
      String(data.idempotencyKey),
    ),
  );
  const docs = await entries(tenant.workspaceId);
  assert.equal(docs.length, 1);
  const entry = docs[0].data();
  assert.equal(docs[0].id, result.transactionId);
  assert.equal(entry.type, "receita");
  assert.equal(entry.description, "Salário de setembro");
  assert.equal(entry.category, "Salário");
  assert.equal(entry.incomeType, "Fixa");
  assert.equal(entry.valueCents, 620_000);
  assert.equal(entry.value, 6200);
  assert.equal(entry.date, "2026-09-15");
  assert.ok(entry.transactionDate instanceof Timestamp);
  assert.equal(saoPauloDayKey(entry.transactionDate.toDate()), "2026-09-15");
  assert.equal(entry.isPaid, true);
  assert.equal(entry.workspaceId, tenant.workspaceId);
  assert.equal(entry.profileId, tenant.workspaceId);
  assert.equal(entry.profileType, "PF");
  assert.equal(entry.userId, tenant.member);
  assert.equal(entry.createdBy, tenant.member);
  assert.equal(entry.updatedBy, tenant.member);
  assert.ok(entry.createdAt instanceof Timestamp);
  assert.deepEqual(entry.cashEntry, {
    domainVersion: 1,
    origin: "manual",
    status: "confirmed",
    currency: "BRL",
    requestHash: entry.cashEntry.requestHash,
    // P3-D (D-40): mês da quota consumido, pelo relógio do servidor.
    quotaPeriod: saoPauloMonthKey(),
    // P3-J (D-30): movimento de conta aplicado na criação confirmada.
    accountMovementId: cashEntryMovementIdFor(result.transactionId, "apply",
      1),
  });
  assert.equal(entry.cashAccountId, defaultAccountOf(tenant.workspaceId));
  assert.match(entry.cashEntry.requestHash, /^[0-9a-f]{64}$/);
  // Nenhum vínculo de outro domínio e nenhum campo de outro tipo.
  for (const field of [
    "goalId", "cardId", "walletId", "loanId", "loanMovementId",
    "installments", "source", "creditCardInvoiceId", "investmentMetadata",
    "voidedAt", "expenseType", "paymentMethod", "supplier", "costCenter",
  ]) {
    assert.equal(field in entry, false, `campo ${field} não deveria existir`);
  }

  // Auditoria: quem, papel, alvo e requisição; nada do conteúdo financeiro.
  const audit = await events(tenant.workspaceId);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].operation, "cash_entry.created");
  assert.equal(audit[0].actorId, tenant.member);
  assert.equal(audit[0].actorRole, "member");
  assert.equal(audit[0].profileType, "PF");
  assert.equal(audit[0].transactionId, result.transactionId);
  assert.equal(audit[0].workspaceId, tenant.workspaceId);
  assert.equal(audit[0].requestHash, entry.cashEntry.requestHash);
  assert.equal(typeof audit[0].requestId, "string");
  // Lista exata de campos: nenhum valor, descrição, categoria ou data. Busca
  // de texto no JSON seria frágil, porque `requestHash` (hex) e os
  // nanossegundos de `createdAt` podem conter quaisquer dígitos.
  assert.deepEqual(Object.keys(audit[0]).sort(), [
    "actorId", "actorRole", "createdAt", "entryStatus", "id", "operation",
    "profileType", "requestHash", "requestId", "transactionId", "workspaceId",
  ]);
  // P3-F: o estado inicial do lançamento faz parte da trilha.
  assert.equal(audit[0].entryStatus, "confirmed");

  const record = await idempotencyRecord(
    tenant.member,
    String(data.idempotencyKey),
  ).get();
  assert.equal(record.get("status"), "completed");
  assert.equal(record.get("workspaceId"), tenant.workspaceId);
  assert.deepEqual(record.get("result"), {transactionId: result.transactionId});
});

test("P3-A — despesa válida em PJ, nos três papéis de escrita", async () => {
  const tenant = await seedTenant("PJ");
  for (const [uid, role] of [
    [tenant.owner, "owner"],
    [tenant.admin, "admin"],
    [tenant.member, "member"],
  ] as const) {
    const result = await create(uid, payload(tenant.workspaceId, {
      type: "despesa",
      description: `Fornecedor de ${role}`,
      category: "Operação",
      amountCents: 48_235,
      expenseType: "Variável",
      paymentMethod: "Pix",
      supplier: "Mercado Central",
      costCenter: "Loja 1",
    }));
    const entry = (await entryRef(tenant.workspaceId, result.transactionId)
      .get()).data();
    assert.equal(entry?.type, "despesa");
    assert.equal(entry?.valueCents, 48_235);
    assert.equal(entry?.value, 482.35);
    assert.equal(entry?.expenseType, "Variável");
    assert.equal(entry?.paymentMethod, "Pix");
    assert.equal(entry?.supplier, "Mercado Central");
    assert.equal(entry?.costCenter, "Loja 1");
    assert.equal(entry?.profileType, "PJ");
    assert.equal(entry?.userId, uid);
    assert.equal("incomeType" in (entry ?? {}), false);
  }
  const audit = await events(tenant.workspaceId);
  assert.deepEqual(
    audit.map((event) => event.actorRole).sort(),
    ["admin", "member", "owner"],
  );
  assert.ok(audit.every((event) => event.profileType === "PJ"));
});

test("P3-A — o fato entra na projeção de caixa uma única vez", async () => {
  const tenant = await seedTenant("PF");
  // Último dia do mês: a atribuição ao período é feita em São Paulo.
  const income = await create(tenant.owner, payload(tenant.workspaceId, {
    amountCents: 100_001,
    date: "2026-08-31",
  }));
  const expense = await create(tenant.owner, payload(tenant.workspaceId, {
    type: "despesa",
    description: "Aluguel",
    category: "Moradia",
    amountCents: 40_000,
    date: "2026-08-01",
  }));
  const incomeDoc = (await entryRef(tenant.workspaceId, income.transactionId)
    .get()).data();
  const expenseDoc = (await entryRef(tenant.workspaceId, expense.transactionId)
    .get()).data();

  assert.equal(cashPeriodKeyFor(incomeDoc), "2026-08");
  assert.equal(cashPeriodKeyFor(expenseDoc), "2026-08");
  assert.deepEqual(cashPeriodDeltaFor(incomeDoc), {
    ...emptyCashPeriodDelta(),
    incomeCents: 100_001,
    expenseCents: 0,
    investmentOutflowCents: 0,
    netCents: 100_001,
    transactionCount: 1,
  });
  assert.deepEqual(cashPeriodDeltaFor(expenseDoc), {
    ...emptyCashPeriodDelta(),
    incomeCents: 0,
    expenseCents: 40_000,
    investmentOutflowCents: 0,
    netCents: -40_000,
    transactionCount: 1,
  });

  // O gatilho real não roda nesta suíte (só Auth e Firestore no Emulator):
  // aplica-se a escrita como `onTransactionWrite` faria, inclusive com a
  // reentrega do mesmo evento, que não pode somar de novo.
  const apply = (eventId: string, after: Record<string, unknown> | undefined) =>
    db().runTransaction((transaction) => applyCashPeriodWriteOnce(
      transaction,
      tenant.workspaceId,
      cashPeriodEventKey(eventId),
      undefined,
      after,
      {transactionId: eventId, action: "CREATE", eventTime: Timestamp.now()},
    ));
  await apply(`evt-${income.transactionId}`, incomeDoc);
  await apply(`evt-${expense.transactionId}`, expenseDoc);
  await apply(`evt-${income.transactionId}`, incomeDoc);
  const period = (await db()
    .doc(`workspaces/${tenant.workspaceId}/cash_report_periods/2026-08`)
    .get()).data();
  assert.equal(period?.incomeCents, 100_001);
  assert.equal(period?.expenseCents, 40_000);
  assert.equal(period?.netCents, 60_001);
  assert.equal(period?.transactionCount, 2);
});

// ------------------------------------------------------------- contrato

test("P3-A — valor, data e campos inválidos não têm efeito", async () => {
  const tenant = await seedTenant("PF");
  const key = idempotencyKey();
  const invalid: Array<[string, Record<string, unknown>]> = [
    ["valor zero", {amountCents: 0}],
    ["valor negativo", {amountCents: -100}],
    ["valor fracionado", {amountCents: 100.5}],
    ["valor em texto", {amountCents: "100"}],
    ["valor acima do teto", {amountCents: 100_000_000_001}],
    ["data futura", {date: addDaysToDayKey(saoPauloDayKey(), 1)}],
    ["data inexistente", {date: "2026-02-30"}],
    ["data fora do formato", {date: "15/09/2026"}],
    ["data antes de 2000", {date: "1999-12-31"}],
    ["tipo investimento", {type: "investimento"}],
    ["tipo parcelado", {type: "parcelado"}],
    ["valor em reais", {value: 6200}],
    ["valueCents forjado", {valueCents: 1}],
    ["userId forjado", {userId: tenant.owner}],
    ["profileId forjado", {profileId: "outro"}],
    ["isPaid", {isPaid: false}],
    ["vínculo de meta", {goalId: "goal-1"}],
    ["vínculo de cartão", {cardId: "card-1"}],
    ["vínculo de fatura", {creditCardInvoiceId: "inv-1"}],
    ["vínculo de carteira", {walletId: "wallet-1"}],
    ["vínculo de empréstimo", {loanId: "loan-1"}],
    ["movimento de empréstimo", {loanMovementId: "mov-1"}],
    ["vínculo de recebível", {receivableId: "rec-1"}],
    ["metadado de investimento", {investmentMetadata: {status: "settled"}}],
    ["metadado de caixa", {cashEntry: {origin: "manual"}}],
    ["baixa", {voidedAt: "2026-09-15"}],
    ["campo desconhecido", {qualquer: "x"}],
  ];
  for (const [label, override] of invalid) {
    await expectHttpsError(
      create(tenant.owner, payload(tenant.workspaceId, {
        ...override,
        idempotencyKey: key,
      })),
      "invalid-argument",
    ).catch((error) => {
      throw new Error(`${label}: ${String(error)}`);
    });
  }
  await assertNoEffect(tenant.workspaceId, tenant.owner, key);
});

test("P3-A — fornecedor e centro de custo só em espaço PJ", async () => {
  const tenant = await seedTenant("PF");
  const key = idempotencyKey();
  for (const field of ["supplier", "costCenter"]) {
    await expectHttpsError(
      create(tenant.owner, payload(tenant.workspaceId, {
        type: "despesa",
        [field]: "Valor",
        idempotencyKey: key,
      })),
      "invalid-argument",
      {message: "Fornecedor e centro de custo só podem ser informados em " +
        "espaço PJ."},
    );
  }
  await assertNoEffect(tenant.workspaceId, tenant.owner, key);
});

// ------------------------------------------------------------- autorização

test("P3-A — exige sessão, conta, membership e papel", async () => {
  const tenant = await seedTenant("PF");
  const key = idempotencyKey();
  const data = payload(tenant.workspaceId, {idempotencyKey: key});

  await expectHttpsError(create(null, data), "unauthenticated");

  const stranger = uniqueId("cash-stranger");
  await seedActiveAccount(stranger);
  await expectHttpsError(create(stranger, data), "permission-denied");

  const removed = uniqueId("cash-removed");
  await seedActiveAccount(removed);
  await seedMember(tenant.workspaceId, removed, "member", "removed");
  await expectHttpsError(create(removed, data), "permission-denied");

  await expectHttpsError(create(tenant.viewer, data), "permission-denied");

  const suspended = uniqueId("cash-suspended");
  await seedActiveAccount(suspended, {status: "suspended"});
  await seedMember(tenant.workspaceId, suspended, "member");
  await expectHttpsError(
    create(suspended, data),
    "permission-denied",
    {reason: "account_suspended"},
  );

  // Login fora da política (D-06): só Google em projeto real.
  await expectHttpsError(
    call(createCashTransaction, tenant.owner, data, {
      sign_in_provider: "anonymous",
    }),
    "unauthenticated",
  );

  for (const uid of [stranger, removed, tenant.viewer, suspended]) {
    assert.equal(await hasIdempotencyRecord(uid, key), false);
  }
  await assertNoEffect(tenant.workspaceId, tenant.owner, key);
});

test("P3-A — workspace arquivado não recebe lançamento", async () => {
  const owner = uniqueId("cash-archived-owner");
  const workspaceId = uniqueId("cash-archived-ws");
  await seedActiveAccount(owner);
  await seedWorkspace({workspaceId, ownerId: owner, status: "archived"});
  const key = idempotencyKey();
  await expectHttpsError(
    create(owner, payload(workspaceId, {idempotencyKey: key})),
    "failed-precondition",
    {reason: "workspace_archived"},
  );
  await assertNoEffect(workspaceId, owner, key);
});

test("P3-A — nenhum ator escreve no workspace de outro tenant", async () => {
  const tenantA = await seedTenant("PF");
  const tenantB = await seedTenant("PJ");
  const key = idempotencyKey();
  // Nos dois sentidos: cada ator de um tenant contra o workspace do outro.
  for (const [actors, target] of [
    [tenantB, tenantA],
    [tenantA, tenantB],
  ] as const) {
    for (const uid of [actors.owner, actors.admin, actors.member]) {
      await expectHttpsError(
        create(uid, payload(target.workspaceId, {idempotencyKey: key})),
        "permission-denied",
      );
    }
  }
  assert.equal((await entries(tenantA.workspaceId)).length, 0);
  assert.equal((await entries(tenantB.workspaceId)).length, 0);
  assert.equal((await events(tenantA.workspaceId)).length, 0);
  assert.equal((await events(tenantB.workspaceId)).length, 0);
});

test("P3-A — papel revogado é recusado na transação", async () => {
  const tenant = await seedTenant("PF");
  const key = idempotencyKey();
  // O kernel já resolveu o ator como member; a releitura transacional vê o
  // membership removido e recusa sem gravar nada.
  await seedMember(tenant.workspaceId, tenant.member, "member", "removed");
  await assert.rejects(
    executeCreateCashTransaction(
      {uid: tenant.member, workspaceId: tenant.workspaceId, role: "member"},
      {
        workspaceId: tenant.workspaceId,
        cashAccountId: defaultAccountOf(tenant.workspaceId),
        idempotencyKey: key,
        type: "receita",
        description: "Salário",
        category: "Salário",
        amountCents: 100,
        date: "2026-09-15",
      },
      "req-revogado",
    ),
    (error: {code?: string}) =>
      error.code === "workspace_membership_required",
  );
  // Rebaixamento a viewer: mesma recusa pela matriz.
  await seedMember(tenant.workspaceId, tenant.admin, "viewer");
  await assert.rejects(
    executeCreateCashTransaction(
      {uid: tenant.admin, workspaceId: tenant.workspaceId, role: "admin"},
      {
        workspaceId: tenant.workspaceId,
        cashAccountId: defaultAccountOf(tenant.workspaceId),
        idempotencyKey: key,
        type: "receita",
        description: "Salário",
        category: "Salário",
        amountCents: 100,
        date: "2026-09-15",
      },
      "req-rebaixado",
    ),
    (error: {code?: string}) => error.code === "workspace_role_denied",
  );
  await assertNoEffect(tenant.workspaceId, tenant.member, key);
  assert.equal(await hasIdempotencyRecord(tenant.admin, key), false);
});

// ------------------------------------------------------------ idempotência

test("P3-A — mesma chave e conteúdo devolvem o mesmo lançamento", async () => {
  const tenant = await seedTenant("PF");
  const data = payload(tenant.workspaceId);
  const first = await create(tenant.owner, data);
  // Ordem diferente das chaves e espaços nas pontas: mesma intenção.
  const reordered = Object.fromEntries(Object.entries(data).reverse());
  const second = await create(tenant.owner, {
    ...reordered,
    description: `  ${String(data.description)} `,
  });
  const third = await create(tenant.owner, data);

  assert.equal(first.replayed, false);
  assert.deepEqual(second, replayOf(first));
  assert.deepEqual(third, replayOf(first));
  assert.equal((await entries(tenant.workspaceId)).length, 1);
  assert.equal((await events(tenant.workspaceId)).length, 1);
});

test("P3-A — mesma chave com conteúdo diferente é recusada", async () => {
  const tenantA = await seedTenant("PF");
  const tenantB = await seedTenant("PF");
  await seedMember(tenantB.workspaceId, tenantA.owner, "member");
  const data = payload(tenantA.workspaceId);
  const first = await create(tenantA.owner, data);

  for (const override of [
    {amountCents: 620_001},
    {date: "2026-09-14"},
    {type: "despesa"},
    {description: "Outro"},
    {incomeType: "Variável"},
    // Mesma chave em outro workspace do mesmo ator também é outra intenção.
    {workspaceId: tenantB.workspaceId},
  ]) {
    await expectHttpsError(
      create(tenantA.owner, {...data, ...override}),
      "failed-precondition",
      {message: "Esta chave de idempotência já foi usada com outros dados."},
    );
  }
  const docs = await entries(tenantA.workspaceId);
  assert.equal(docs.length, 1);
  assert.equal(docs[0].id, first.transactionId);
  assert.equal(docs[0].get("valueCents"), 620_000);
  assert.equal((await entries(tenantB.workspaceId)).length, 0);
  assert.equal((await events(tenantA.workspaceId)).length, 1);

  // A chave pertence ao ator: outro membro com a mesma chave cria o próprio.
  const other = await create(tenantA.admin, data);
  assert.equal(other.replayed, false);
  assert.notEqual(other.transactionId, first.transactionId);
});

test("P3-A — chave expirada: o lançamento segue como âncora", async () => {
  const tenant = await seedTenant("PF");
  const key = idempotencyKey();
  const data = payload(tenant.workspaceId, {idempotencyKey: key});
  const first = await create(tenant.owner, data);
  // TTL de 90 dias da chave do ator, simulado: o lançamento permanece.
  await idempotencyRecord(tenant.owner, key).delete();

  const replay = await create(tenant.owner, data);
  assert.deepEqual(replay, replayOf(first));
  await expectHttpsError(
    create(tenant.owner, {...data, amountCents: 1}),
    "failed-precondition",
  );
  assert.equal((await entries(tenant.workspaceId)).length, 1);
  assert.equal((await events(tenant.workspaceId)).length, 1);
});

test("P3-A — documento alheio no ID nunca é sobrescrito", async () => {
  const tenant = await seedTenant("PF");
  const key = idempotencyKey();
  const id = cashTransactionId(tenant.workspaceId, tenant.owner, key);
  // Um documento sem `cashEntry` no mesmo ID (por exemplo, criado pelo
  // caminho legado do cliente) não é tratado como replay nem sobrescrito.
  const squatter = {
    type: "despesa", description: "Pré-existente", category: "Casa",
    value: 1, date: "2026-09-15", userId: tenant.owner,
    workspaceId: tenant.workspaceId,
  };
  await entryRef(tenant.workspaceId, id).set(squatter);
  await expectHttpsError(
    create(tenant.owner, payload(tenant.workspaceId, {idempotencyKey: key})),
    "failed-precondition",
  );
  const stored = (await entryRef(tenant.workspaceId, id).get()).data();
  assert.deepEqual(stored, squatter);
  assert.equal((await events(tenant.workspaceId)).length, 0);
  assert.equal(await hasIdempotencyRecord(tenant.owner, key), false);
});

// ------------------------------------------------- concorrência e atomicidade

test("P3-A — intenção concorrente gera um único lançamento", async () => {
  const tenant = await seedTenant("PF");
  const data = payload(tenant.workspaceId);
  const outcomes = await Promise.allSettled(
    Array.from({length: 6}, () => create(tenant.owner, data)),
  );
  const fulfilled = outcomes
    .filter((outcome): outcome is PromiseFulfilledResult<Result> =>
      outcome.status === "fulfilled")
    .map((outcome) => outcome.value);
  const rejected = outcomes
    .filter((outcome): outcome is PromiseRejectedResult =>
      outcome.status === "rejected")
    .map((outcome) => outcome.reason as {code?: string});

  assert.ok(fulfilled.length >= 1, "ao menos uma execução conclui");
  assert.equal(new Set(fulfilled.map((r) => r.transactionId)).size, 1);
  assert.equal(fulfilled.filter((r) => !r.replayed).length, 1);
  // Perder a disputa é contenção ou conflito de idempotência, nunca erro
  // interno nem segundo lançamento.
  for (const reason of rejected) {
    assert.ok(
      reason.code === "aborted" || reason.code === "failed-precondition",
      `recusa inesperada: ${String(reason.code)}`,
    );
  }
  assert.equal((await entries(tenant.workspaceId)).length, 1);
  assert.equal((await events(tenant.workspaceId)).length, 1);
  const replay = await create(tenant.owner, data);
  assert.equal(replay.transactionId, fulfilled[0].transactionId);
  assert.equal(replay.replayed, true);
});

test("P3-A — intenções distintas concorrentes, nenhuma perdida", async () => {
  const tenant = await seedTenant("PF");
  const outcomes = await Promise.allSettled([
    create(tenant.owner, payload(tenant.workspaceId, {amountCents: 101})),
    create(tenant.admin, payload(tenant.workspaceId, {amountCents: 202})),
    create(tenant.member, payload(tenant.workspaceId, {amountCents: 303})),
    create(tenant.member, payload(tenant.workspaceId, {amountCents: 404})),
  ]);
  for (const outcome of outcomes) {
    assert.equal(outcome.status, "fulfilled", String(
      outcome.status === "rejected" ? outcome.reason : "",
    ));
  }
  const values = (await entries(tenant.workspaceId))
    .map((doc) => doc.get("valueCents") as number)
    .sort((a, b) => a - b);
  assert.deepEqual(values, [101, 202, 303, 404]);
  assert.equal((await events(tenant.workspaceId)).length, 4);
});

test("P3-A — falha no commit não deixa efeito parcial", async () => {
  const tenant = await seedTenant("PF");
  const key = idempotencyKey();
  const requestId = "req-falha-no-commit";
  const transactionId = cashTransactionId(
    tenant.workspaceId,
    tenant.owner,
    key,
  );
  // Evento de auditoria já existente para esta requisição: a última escrita
  // da transação (`create`) falha e o commit inteiro é desfeito.
  const eventRef = db().doc(
    `workspaces/${tenant.workspaceId}/${CASH_EVENTS_COLLECTION}/` +
      cashEventId(requestId, "cash_entry.created", transactionId),
  );
  await eventRef.set({marker: "pré-existente"});

  await assert.rejects(
    executeCreateCashTransaction(
      {uid: tenant.owner, workspaceId: tenant.workspaceId, role: "owner"},
      {
        workspaceId: tenant.workspaceId,
        cashAccountId: defaultAccountOf(tenant.workspaceId),
        idempotencyKey: key,
        type: "receita",
        description: "Salário",
        category: "Salário",
        amountCents: 100,
        date: "2026-09-15",
      },
      requestId,
    ),
    (error: {code?: unknown}) => error.code === 6,
  );
  assert.equal((await entries(tenant.workspaceId)).length, 0);
  assert.equal(await hasIdempotencyRecord(tenant.owner, key), false);
  assert.deepEqual((await eventRef.get()).data(), {marker: "pré-existente"});
  assert.equal((await events(tenant.workspaceId)).length, 1);

  // Removido o obstáculo, a mesma intenção conclui normalmente.
  await eventRef.delete();
  const result = await create(tenant.owner, payload(tenant.workspaceId, {
    idempotencyKey: key,
    description: "Salário",
    category: "Salário",
    amountCents: 100,
  }));
  assert.equal(result.transactionId, transactionId);
  assert.equal(result.replayed, false);
});

// ------------------------------------------------- limite operacional (P3-B)

const rateLimitRef = (workspaceId: string, uid: string) =>
  db().doc(
    `workspaces/${workspaceId}/rate_limits/` +
      rateLimitDocumentId(CASH_ENTRY_RATE_LIMIT, uid),
  );

const usedSlots = async (workspaceId: string, uid: string) =>
  Number((await rateLimitRef(workspaceId, uid).get()).get("count") ?? 0);

/** Contador semeado como se `used` criações já tivessem acontecido agora. */
const fillSlots = async (
  workspaceId: string,
  uid: string,
  used: number,
  windowStartMs = Date.now(),
) => rateLimitRef(workspaceId, uid).set({
  windowStart: Timestamp.fromMillis(windowStartMs),
  windowSeconds: CASH_ENTRY_RATE_LIMIT.windowSeconds,
  limit: CASH_ENTRY_RATE_LIMIT.limit,
  count: used,
});

test("P3-B — limite operacional não é a quota comercial", () => {
  assert.deepEqual(CASH_ENTRY_RATE_LIMIT, {
    operation: "createCashTransaction",
    limit: 120,
    windowSeconds: 600,
  });
});

test("P3-B — no teto, recusa sem efeito e informa a espera", async () => {
  const tenant = await seedTenant("PF");
  await fillSlots(tenant.workspaceId, tenant.member, 120);
  const key = idempotencyKey();
  const refused = await expectHttpsError(
    create(tenant.member, payload(tenant.workspaceId, {idempotencyKey: key})),
    "failed-precondition",
    {message: /Muitas solicitações em pouco tempo/},
  );
  const details = refused.details as {retryAfterSeconds?: number};
  assert.ok(Number(details.retryAfterSeconds) > 0);
  assert.ok(Number(details.retryAfterSeconds) <= 600);
  await assertNoEffect(tenant.workspaceId, tenant.member, key);
  assert.equal(await usedSlots(tenant.workspaceId, tenant.member), 120);

  // Janela vencida: a contagem recomeça e a criação passa.
  await fillSlots(
    tenant.workspaceId, tenant.member, 120, Date.now() - 11 * 60 * 1000,
  );
  const created = await create(tenant.member, payload(tenant.workspaceId));
  assert.equal(created.replayed, false);
  assert.equal(await usedSlots(tenant.workspaceId, tenant.member), 1);
});

test("P3-B — replay no teto devolve o lançamento sem consumir", async () => {
  const tenant = await seedTenant("PF");
  const key = idempotencyKey();
  const data = payload(tenant.workspaceId, {idempotencyKey: key});
  const first = await create(tenant.owner, data);
  assert.equal(await usedSlots(tenant.workspaceId, tenant.owner), 1);
  await fillSlots(tenant.workspaceId, tenant.owner, 120);

  assert.deepEqual(await create(tenant.owner, data), replayOf(first));
  // Replay pela âncora durável (chave do ator expirada) também passa.
  await idempotencyRecord(tenant.owner, key).delete();
  assert.deepEqual(await create(tenant.owner, data), replayOf(first));
  assert.equal(await usedSlots(tenant.workspaceId, tenant.owner), 120);
  assert.equal((await entries(tenant.workspaceId)).length, 1);
});

test("P3-B — só a criação consome; recusa e falha não", async () => {
  const tenant = await seedTenant("PF");
  const key = idempotencyKey();
  const data = payload(tenant.workspaceId, {idempotencyKey: key});
  await create(tenant.owner, data);
  assert.equal(await usedSlots(tenant.workspaceId, tenant.owner), 1);

  await create(tenant.owner, data); // replay
  await expectHttpsError(
    create(tenant.owner, {...data, amountCents: 1}),
    "failed-precondition",
  ); // conflito de idempotência
  await expectHttpsError(
    create(tenant.owner, payload(tenant.workspaceId, {amountCents: 0})),
    "invalid-argument",
  ); // contrato
  await expectHttpsError(
    create(tenant.owner, payload(tenant.workspaceId, {
      type: "despesa",
      supplier: "Fornecedor",
    })),
    "invalid-argument",
  ); // campo só de PJ
  await expectHttpsError(
    create(tenant.viewer, payload(tenant.workspaceId)),
    "permission-denied",
  ); // papel
  assert.equal(await usedSlots(tenant.workspaceId, tenant.owner), 1);
  assert.equal(await usedSlots(tenant.workspaceId, tenant.viewer), 0);

  // Falha no commit desfaz o contador junto com o lançamento.
  const failingKey = idempotencyKey();
  const requestId = "req-falha-limite";
  const transactionId = cashTransactionId(
    tenant.workspaceId,
    tenant.owner,
    failingKey,
  );
  await db().doc(
    `workspaces/${tenant.workspaceId}/${CASH_EVENTS_COLLECTION}/` +
      cashEventId(requestId, "cash_entry.created", transactionId),
  ).set({marker: "pré-existente"});
  await assert.rejects(executeCreateCashTransaction(
    {uid: tenant.owner, workspaceId: tenant.workspaceId, role: "owner"},
    {
      workspaceId: tenant.workspaceId,
      cashAccountId: defaultAccountOf(tenant.workspaceId),
      idempotencyKey: failingKey,
      type: "receita",
      description: "Salário",
      category: "Salário",
      amountCents: 100,
      date: "2026-09-15",
    },
    requestId,
  ));
  assert.equal(await usedSlots(tenant.workspaceId, tenant.owner), 1);
});

test("P3-B — concorrência: último slot com um vencedor", async () => {
  const tenant = await seedTenant("PF");
  const data = payload(tenant.workspaceId);
  const outcomes = await Promise.allSettled(
    Array.from({length: 6}, () => create(tenant.member, data)),
  );
  assert.ok(outcomes.some((outcome) => outcome.status === "fulfilled"));
  assert.equal(await usedSlots(tenant.workspaceId, tenant.member), 1);

  await fillSlots(tenant.workspaceId, tenant.member, 119);
  const before = (await entries(tenant.workspaceId)).length;
  const race = await Promise.allSettled([0, 1, 2].map((index) =>
    create(tenant.member, payload(tenant.workspaceId, {
      amountCents: 1_000 + index,
    }))));
  const winners = race.filter((outcome) => outcome.status === "fulfilled");
  assert.equal(winners.length, 1, "só uma intenção nova cabe no último slot");
  for (const outcome of race) {
    if (outcome.status === "rejected") {
      const code = (outcome.reason as {code?: string}).code;
      assert.ok(
        code === "failed-precondition" || code === "aborted",
        `recusa inesperada: ${String(code)}`,
      );
    }
  }
  assert.equal((await entries(tenant.workspaceId)).length, before + 1);
  assert.equal(await usedSlots(tenant.workspaceId, tenant.member), 120);
});

test("P3-B — o limite é por ator e por workspace", async () => {
  const tenantA = await seedTenant("PF");
  const tenantB = await seedTenant("PF");
  await seedMember(tenantB.workspaceId, tenantA.owner, "member");
  await fillSlots(tenantA.workspaceId, tenantA.owner, 120);

  await expectHttpsError(
    create(tenantA.owner, payload(tenantA.workspaceId)),
    "failed-precondition",
  );
  // O mesmo ator em outro workspace e outro membro do mesmo workspace não
  // são afetados.
  assert.equal(
    (await create(tenantA.owner, payload(tenantB.workspaceId))).replayed,
    false,
  );
  assert.equal(
    (await create(tenantA.admin, payload(tenantA.workspaceId))).replayed,
    false,
  );
  assert.equal(await usedSlots(tenantB.workspaceId, tenantA.owner), 1);
  assert.equal(await usedSlots(tenantA.workspaceId, tenantA.admin), 1);
  assert.equal(await usedSlots(tenantA.workspaceId, tenantA.owner), 120);
});
