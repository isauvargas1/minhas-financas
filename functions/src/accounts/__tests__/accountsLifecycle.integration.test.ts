import assert from "node:assert/strict";
import test from "node:test";
import {Timestamp} from "firebase-admin/firestore";

import {seedLoanTenant} from "../../loans/testSupport/loanTestSupport";
import {
  db,
  expectHttpsError,
  idempotencyKey,
} from "../../workspaces/testSupport/p1TestSupport";
import {ACCOUNT_LIMIT_MESSAGE, executeCreateCashAccount} from "../operations";
import {executeCreateCashTransfer} from "../transfers";
import {
  accountEvents,
  accountRef,
  archiveAccount,
  assertLedgerConsistent,
  balanceOf,
  countOf,
  createAccountPayload,
  defaultAccountOf,
  editAccount,
  expireKeys,
  movementsOf,
  newAccount,
  reactivateAccount,
  readAccount,
  reverse,
  reversePayload,
  statusPayload,
  transfer,
  transferPayload,
  transferRef,
  accountVersion,
} from "../testSupport/accountTestSupport";
import {
  CASH_ACCOUNT_LIMIT_PER_WORKSPACE,
  cashAccountIdFor,
  openingBalanceMovementIdFor,
  transferMovementIdFor,
} from "../model";

/**
 * P3-J (D-30) — contas/carteiras e transferências no Emulator: criação com
 * saldo inicial, edição, arquivamento, reativação, transferência e estorno,
 * replay, concorrência, falha antes do commit, papéis, isolamento e o teto
 * de contas por workspace.
 */

test("P3-J — conta: saldo inicial positivo, zero e negativo; o saldo é a " +
  "soma do livro-razão", async () => {
  const t = await seedLoanTenant("PF", "acc-open");
  const positive = await newAccount(t.owner, createAccountPayload(t.workspaceId,
    {name: "Banco", openingBalanceCents: 150_000,
      openingBalanceDate: "2026-09-01"}));
  assert.equal(positive.balanceCents, 150_000);
  const account = await readAccount(t.workspaceId, positive.accountId);
  assert.equal(account.balanceCents, 150_000);
  assert.equal(account.status, "active");
  assert.equal(account.accountType, "checking");
  const [opening] = await movementsOf(t.workspaceId, positive.accountId);
  assert.equal(opening.id, openingBalanceMovementIdFor(positive.accountId));
  assert.equal(opening.kind, "opening_balance");
  assert.equal(opening.amountCents, 150_000);
  assert.equal(opening.effectiveDate, "2026-09-01");
  assert.equal(opening.sourceDomain, "account");

  const zero = await newAccount(t.admin, createAccountPayload(t.workspaceId,
    {name: "Cofre", accountType: "cash"}));
  assert.equal(await balanceOf(t.workspaceId, zero.accountId), 0);
  assert.deepEqual(await movementsOf(t.workspaceId, zero.accountId), [],
    "saldo inicial zero não vira movimento");

  const negative = await newAccount(t.owner, createAccountPayload(t.workspaceId,
    {name: "Cheque especial", openingBalanceCents: -20_000}));
  assert.equal(await balanceOf(t.workspaceId, negative.accountId), -20_000);

  // Saldo inicial não é receita nem despesa: nenhum lançamento, nenhuma quota.
  assert.equal(await countOf(t.workspaceId, "transactions"), 0);
  const events = await accountEvents(t.workspaceId);
  // A conta padrão do seed de teste é gravada sem evento (o evento dela é
  // do provisionamento real, coberto na suíte de provisionamento).
  assert.equal(events.filter((event) =>
    event.operation === "cash_account.created").length, 3);
  // Nenhum evento carrega o nome (texto livre) da conta.
  assert.equal(JSON.stringify(events).includes("Cheque especial"), false);
  await assertLedgerConsistent(t.workspaceId);
});

test("P3-J — conta: contrato estrito, saldo nunca editável, " +
  "papéis", async () => {
  const t = await seedLoanTenant("PF", "acc-rbac");
  for (const uid of [t.member, t.viewer]) {
    await expectHttpsError(newAccount(uid, createAccountPayload(t.workspaceId)),
      "permission-denied");
  }
  for (const [label, overrides] of [
    ["saldo direto", {balanceCents: 1_000}],
    ["estado", {status: "archived"}],
    ["tipo desconhecido", {accountType: "wallet"}],
    ["saldo em reais", {openingBalanceCents: 10.5}],
    ["data futura",
      {openingBalanceCents: 100, openingBalanceDate: "2099-01-01"}],
    ["data sem saldo", {openingBalanceDate: "2026-09-01"}],
  ] as const) {
    await expectHttpsError(newAccount(t.owner,
      createAccountPayload(t.workspaceId, overrides)), "invalid-argument",
    {message: undefined}).catch((error) => {
      throw new Error(`${label}: ${String(error)}`);
    });
  }
  const accountId = defaultAccountOf(t.workspaceId);
  const base = {workspaceId: t.workspaceId, idempotencyKey: idempotencyKey(),
    accountId,
    expectedUpdatedAt: await accountVersion(t.workspaceId, accountId)};
  await expectHttpsError(editAccount(t.owner,
    {...base, changes: {balanceCents: 5}}), "invalid-argument");
  await expectHttpsError(editAccount(t.member,
    {...base, changes: {name: "Outra"}}), "permission-denied");
  await expectHttpsError(editAccount(t.owner,
    {...base, changes: {name: "Carteira principal"}}), "failed-precondition",
  {message: "Nenhum dado foi alterado: os valores informados já são os " +
    "atuais."});
  const edited = await editAccount(t.admin,
    {...base, changes: {name: "Carteira da casa", accountType: "digital"}});
  assert.equal(edited.changed, true);
  const account = await readAccount(t.workspaceId, accountId);
  assert.equal(account.name, "Carteira da casa");
  assert.equal(account.accountType, "digital");
  assert.equal(account.balanceCents, 0);
  // Versão lida antes da edição: conflito, sem sobrescrever.
  await expectHttpsError(editAccount(t.owner, {...base,
    idempotencyKey: idempotencyKey(), changes: {name: "Atrasada"}}), "aborted");
  assert.equal((await readAccount(t.workspaceId, accountId)).name,
    "Carteira da casa");
});

test("P3-J — conta: replay idempotente, inclusive depois da expiração da " +
  "chave; mesma chave com outro conteúdo é conflito", async () => {
  const t = await seedLoanTenant("PF", "acc-idem");
  const payload = createAccountPayload(t.workspaceId,
    {openingBalanceCents: 7_500});
  const first = await newAccount(t.owner, payload);
  const replay = await newAccount(t.owner, payload);
  assert.deepEqual([replay.replayed, replay.accountId],
    [true, first.accountId]);
  await expireKeys(t.owner);
  const afterExpiry = await newAccount(t.owner, payload);
  assert.deepEqual([afterExpiry.replayed, afterExpiry.accountId],
    [true, first.accountId]);
  await expectHttpsError(newAccount(t.owner, {...payload, name: "Outra"}),
    "failed-precondition",
    {message: "Esta chave de idempotência já foi usada com outros dados."});
  assert.equal(await balanceOf(t.workspaceId, first.accountId), 7_500,
    "um único saldo inicial");
  assert.equal(first.accountId,
    cashAccountIdFor(t.workspaceId, t.owner, payload.idempotencyKey as string));
  await assertLedgerConsistent(t.workspaceId);
});

test("P3-J — arquivar só com saldo zero; arquivada não aceita movimento; " +
  "reativar devolve ao uso", async () => {
  const t = await seedLoanTenant("PF", "acc-arch");
  const main = defaultAccountOf(t.workspaceId);
  const other = await newAccount(t.owner, createAccountPayload(t.workspaceId,
    {openingBalanceCents: 3_000}));
  await expectHttpsError(archiveAccount(t.owner,
    await statusPayload(t.workspaceId, other.accountId)), "failed-precondition",
  {message: "Só é possível arquivar uma conta com saldo zero. Transfira o " +
    "saldo para outra conta antes de arquivar."});
  await expectHttpsError(archiveAccount(t.member,
    await statusPayload(t.workspaceId, main)), "permission-denied");
  // Zera pela transferência e arquiva.
  await transfer(t.owner, transferPayload(t.workspaceId, other.accountId, main,
    {amountCents: 3_000}));
  const archived = await archiveAccount(t.admin,
    await statusPayload(t.workspaceId, other.accountId));
  assert.equal(archived.status, "archived");
  await expectHttpsError(archiveAccount(t.admin,
    await statusPayload(t.workspaceId, other.accountId)), "failed-precondition",
  {message: "Esta conta já está arquivada."});
  // Novo fato e compensação são recusados na arquivada.
  await expectHttpsError(transfer(t.owner, transferPayload(t.workspaceId, main,
    other.accountId)), "failed-precondition", {message: /arquivada/});
  const [first] = (await db()
    .collection(`workspaces/${t.workspaceId}/cash_transfers`).get()).docs;
  await expectHttpsError(reverse(t.owner,
    await reversePayload(t.workspaceId, first.id)), "failed-precondition",
  {message: /arquivada/});
  assert.equal(await balanceOf(t.workspaceId, other.accountId), 0);
  // Reativada, volta a aceitar.
  await reactivateAccount(t.owner,
    await statusPayload(t.workspaceId, other.accountId));
  await reverse(t.owner, await reversePayload(t.workspaceId, first.id));
  assert.equal(await balanceOf(t.workspaceId, other.accountId), 3_000);
  assert.equal(await balanceOf(t.workspaceId, main), 0);
  // Nada é apagado: a conta e o histórico permanecem.
  assert.ok((await accountRef(t.workspaceId, other.accountId).get()).exists);
  await assertLedgerConsistent(t.workspaceId);
});

test("P3-J — transferência: saída e entrada no mesmo commit, efeito global " +
  "zero, sem lançamento comum", async () => {
  const t = await seedLoanTenant("PF", "acc-trf");
  const main = defaultAccountOf(t.workspaceId);
  const savings = await newAccount(t.owner, createAccountPayload(t.workspaceId,
    {name: "Poupança", accountType: "savings", openingBalanceCents: 50_000}));
  const result = await transfer(t.member, transferPayload(t.workspaceId,
    savings.accountId, main, {amountCents: 12_345, description: "Reserva"}));
  assert.equal(result.status, "completed");
  assert.equal(await balanceOf(t.workspaceId, savings.accountId), 37_655);
  assert.equal(await balanceOf(t.workspaceId, main), 12_345);
  const doc = (await transferRef(t.workspaceId, result.transferId).get())
    .data();
  assert.equal(doc?.amountCents, 12_345);
  assert.equal(doc?.createdBy, t.member);
  assert.equal(doc?.description, "Reserva");
  const out = (await db().doc(`workspaces/${t.workspaceId}/` +
    `cash_account_movements/${transferMovementIdFor(result.transferId, "out",
      false)}`).get()).data();
  const inbound = (await db().doc(`workspaces/${t.workspaceId}/` +
    `cash_account_movements/${transferMovementIdFor(result.transferId, "in",
      false)}`).get()).data();
  assert.deepEqual([out?.kind, out?.amountCents, out?.accountId],
    ["transfer_out", -12_345, savings.accountId]);
  assert.deepEqual([inbound?.kind, inbound?.amountCents, inbound?.accountId],
    ["transfer_in", 12_345, main]);
  // Nunca dois lançamentos comuns: nada em `transactions`, nada na projeção.
  assert.equal(await countOf(t.workspaceId, "transactions"), 0);
  assert.equal(await countOf(t.workspaceId, "cash_report_periods"), 0);
  // Contrato: mesma conta, valor não positivo, data futura e saldo direto.
  for (const overrides of [
    {destinationAccountId: savings.accountId},
    {amountCents: 0}, {amountCents: -1}, {amountCents: 1.5},
    {date: "2099-01-01"}, {status: "completed"},
  ]) {
    await expectHttpsError(transfer(t.owner, transferPayload(t.workspaceId,
      savings.accountId, main, overrides)), "invalid-argument");
  }
  await expectHttpsError(transfer(t.viewer, transferPayload(t.workspaceId,
    savings.accountId, main)), "permission-denied");
  await expectHttpsError(transfer(t.owner, transferPayload(t.workspaceId,
    savings.accountId, "acc_inexistente")), "not-found",
  {message: "Conta não encontrada."});
  await assertLedgerConsistent(t.workspaceId);
});

test("P3-J — transferência: replay e expiração da chave não duplicam; " +
  "estorno compensa uma vez", async () => {
  const t = await seedLoanTenant("PF", "acc-rev");
  const main = defaultAccountOf(t.workspaceId);
  const other = await newAccount(t.owner, createAccountPayload(t.workspaceId));
  const payload = transferPayload(t.workspaceId, main, other.accountId,
    {amountCents: 4_000});
  const first = await transfer(t.member, payload);
  assert.equal((await transfer(t.member, payload)).replayed, true);
  await expireKeys(t.member);
  const afterExpiry = await transfer(t.member, payload);
  assert.deepEqual([afterExpiry.replayed, afterExpiry.transferId],
    [true, first.transferId]);
  await expectHttpsError(transfer(t.member, {...payload, amountCents: 4_001}),
    "failed-precondition");
  assert.equal(await balanceOf(t.workspaceId, main), -4_000,
    "saldo negativo permitido, sem cheque especial");
  assert.equal(await countOf(t.workspaceId, "cash_transfers"), 1);

  // Member não estorna a transferência de outro.
  await expectHttpsError(reverse(t.otherMember,
    await reversePayload(t.workspaceId, first.transferId)),
  "permission-denied");
  const reversal = await reversePayload(t.workspaceId, first.transferId);
  const reversed = await reverse(t.member, reversal);
  assert.equal(reversed.status, "reversed");
  assert.equal(await balanceOf(t.workspaceId, main), 0);
  assert.equal(await balanceOf(t.workspaceId, other.accountId), 0);
  const doc = (await transferRef(t.workspaceId, first.transferId).get()).data();
  assert.equal(doc?.status, "reversed");
  assert.equal(doc?.reversal?.reason, "Transferência lançada em duplicidade");
  const reversals = (await movementsOf(t.workspaceId))
    .filter((movement) => movement.kind === "reversal");
  assert.equal(reversals.length, 2);
  for (const movement of reversals) {
    assert.ok(movement.reversalOf, "estorno aponta o movimento compensado");
  }
  // Replay do estorno: idempotente, também depois da expiração.
  assert.equal((await reverse(t.member, reversal)).replayed, true);
  await expireKeys(t.member);
  assert.equal((await reverse(t.member, reversal)).replayed, true);
  // Segundo estorno (outra intenção) é recusado.
  await expectHttpsError(reverse(t.owner,
    await reversePayload(t.workspaceId, first.transferId)),
  "failed-precondition", {message: "Esta transferência já foi estornada."});
  assert.equal((await movementsOf(t.workspaceId))
    .filter((movement) => movement.kind === "reversal").length, 2);
  await assertLedgerConsistent(t.workspaceId);
});

test("P3-J — transferências concorrentes da mesma conta: nenhuma " +
  "atualização perdida", async () => {
  const t = await seedLoanTenant("PF", "acc-conc");
  const main = defaultAccountOf(t.workspaceId);
  const destinations = await Promise.all([1, 2, 3].map((index) =>
    newAccount(t.owner, createAccountPayload(t.workspaceId,
      {name: `Destino ${index}`}))));
  const outcomes = await Promise.allSettled(Array.from({length: 6},
    (_, index) => transfer(t.owner, transferPayload(t.workspaceId, main,
      destinations[index % 3].accountId, {amountCents: 1_000 + index}))));
  const done = outcomes.filter((outcome) => outcome.status === "fulfilled");
  assert.equal(done.length, 6, JSON.stringify(outcomes.map((o) => o.status)));
  const sent = Array.from({length: 6}, (_, index) => 1_000 + index)
    .reduce((sum, value) => sum + value, 0);
  assert.equal(await balanceOf(t.workspaceId, main), -sent);
  const received = await Promise.all(destinations.map((destination) =>
    balanceOf(t.workspaceId, destination.accountId)));
  assert.equal(received.reduce((sum, value) => sum + value, 0), sent);
  await assertLedgerConsistent(t.workspaceId);
});

test("P3-J — falha antes do commit: nem conta, nem saldo, nem movimento, " +
  "nem transferência", async () => {
  const t = await seedLoanTenant("PF", "acc-fail");
  const main = defaultAccountOf(t.workspaceId);
  const before = await countOf(t.workspaceId, "cash_accounts");
  await assert.rejects(executeCreateCashAccount(
    {uid: t.owner, workspaceId: t.workspaceId, role: "owner"},
    {workspaceId: t.workspaceId, idempotencyKey: idempotencyKey(),
      name: "Falha", accountType: "cash", openingBalanceCents: 900},
    "req-fail-account", {beforeCommit: () => {
      throw new Error("falha injetada");
    }}), /falha injetada/);
  assert.equal(await countOf(t.workspaceId, "cash_accounts"), before);
  assert.equal(await countOf(t.workspaceId, "cash_account_movements"), 0);

  const other = await newAccount(t.owner, createAccountPayload(t.workspaceId));
  await assert.rejects(executeCreateCashTransfer(
    {uid: t.owner, workspaceId: t.workspaceId, role: "owner"},
    {workspaceId: t.workspaceId, idempotencyKey: idempotencyKey(),
      sourceAccountId: main, destinationAccountId: other.accountId,
      amountCents: 500, date: "2026-10-01"},
    "req-fail-transfer", {beforeCommit: () => {
      throw new Error("falha injetada");
    }}), /falha injetada/);
  assert.equal(await balanceOf(t.workspaceId, main), 0);
  assert.equal(await balanceOf(t.workspaceId, other.accountId), 0);
  assert.equal(await countOf(t.workspaceId, "cash_transfers"), 0);
  assert.equal(await countOf(t.workspaceId, "cash_account_movements"), 0);
});

test("P3-J — isolamento: conta e transferência de outro workspace não são " +
  "alcançáveis", async () => {
  const a = await seedLoanTenant("PF", "acc-ta");
  const b = await seedLoanTenant("PF", "acc-tb");
  const accountB = defaultAccountOf(b.workspaceId);
  const otherA = await newAccount(a.owner, createAccountPayload(a.workspaceId));
  // Conta de B informada no workspace de A: não existe ali.
  await expectHttpsError(transfer(a.owner, transferPayload(a.workspaceId,
    otherA.accountId, accountB)), "not-found");
  // Owner de A agindo no workspace de B: sem membership.
  await expectHttpsError(transfer(a.owner, transferPayload(b.workspaceId,
    accountB, otherA.accountId)), "permission-denied");
  await expectHttpsError(editAccount(a.owner, {workspaceId: a.workspaceId,
    idempotencyKey: idempotencyKey(), accountId: accountB,
    expectedUpdatedAt: await accountVersion(b.workspaceId, accountB),
    changes: {name: "Invasão"}}), "not-found");
  const trfB = await transfer(b.owner, transferPayload(b.workspaceId, accountB,
    (await newAccount(b.owner,
      createAccountPayload(b.workspaceId))).accountId));
  await expectHttpsError(reverse(a.owner, {
    ...(await reversePayload(b.workspaceId, trfB.transferId)),
    workspaceId: a.workspaceId,
  }), "not-found");
  assert.equal((await readAccount(b.workspaceId, accountB)).name,
    "Carteira principal");
  await assertLedgerConsistent(a.workspaceId);
  await assertLedgerConsistent(b.workspaceId);
});

/** Contas válidas gravadas direto (fixture), para chegar perto do teto. */
const seedAccounts = async (
  workspaceId: string,
  owner: string,
  count: number,
) => {
  const batch = db().batch();
  for (let index = 0; index < count; index += 1) {
    const id = `acc_fixture_${String(index).padStart(3, "0")}`;
    batch.set(accountRef(workspaceId, id), {
      id, schemaVersion: 1, workspaceId, name: `Conta ${index}`,
      accountType: "cash", status: "active", balanceCents: 0, currency: "BRL",
      createdBy: owner, updatedBy: owner, createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
  }
  await batch.commit();
};

test("P3-J — teto de contas: a centésima passa, a seguinte é recusada sem " +
  "gravar; replay no teto devolve o resultado gravado", async () => {
  const t = await seedLoanTenant("PF", "acc-cap");
  // Conta padrão + 98 fixtures = 99.
  await seedAccounts(t.workspaceId, t.owner,
    CASH_ACCOUNT_LIMIT_PER_WORKSPACE - 2);
  const payload = createAccountPayload(t.workspaceId, {name: "Centésima"});
  const created = await newAccount(t.owner, payload);
  assert.equal(created.replayed, false);
  assert.equal(await countOf(t.workspaceId, "cash_accounts"),
    CASH_ACCOUNT_LIMIT_PER_WORKSPACE);
  const replay = await newAccount(t.owner, payload);
  assert.equal(replay.accountId, created.accountId);
  assert.equal(replay.replayed, true);
  const eventsBefore = (await accountEvents(t.workspaceId)).length;
  await expectHttpsError(newAccount(t.owner, createAccountPayload(t.workspaceId,
    {name: "Excedente", openingBalanceCents: 1_000})), "failed-precondition",
  {message: ACCOUNT_LIMIT_MESSAGE});
  assert.equal(await countOf(t.workspaceId, "cash_accounts"),
    CASH_ACCOUNT_LIMIT_PER_WORKSPACE);
  assert.equal(await countOf(t.workspaceId, "cash_account_movements"), 0);
  assert.equal((await accountEvents(t.workspaceId)).length, eventsBefore);
});

test("P3-J — teto de contas sob concorrência: duas criações para a última " +
  "vaga, só uma passa", async () => {
  const t = await seedLoanTenant("PF", "acc-cap-race");
  await seedAccounts(t.workspaceId, t.owner,
    CASH_ACCOUNT_LIMIT_PER_WORKSPACE - 2);
  const outcomes = await Promise.allSettled([1, 2].map((index) =>
    newAccount(t.owner, createAccountPayload(t.workspaceId,
      {name: `Concorrente ${index}`}))));
  assert.equal(outcomes.filter((outcome) =>
    outcome.status === "fulfilled").length, 1);
  const refused = outcomes.find((outcome) => outcome.status === "rejected") as
    PromiseRejectedResult;
  assert.equal((refused.reason as {code?: string}).code, "failed-precondition");
  assert.equal(await countOf(t.workspaceId, "cash_accounts"),
    CASH_ACCOUNT_LIMIT_PER_WORKSPACE);
});
