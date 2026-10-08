import assert from "node:assert/strict";
import test from "node:test";
import {Timestamp} from "firebase-admin/firestore";

import {
  confirmCashTransaction,
  createCashTransaction,
  importCashTransactions,
  updateCashTransaction,
  voidCashTransaction,
} from "../../cash/callables";
import {executeCreateCashTransaction} from "../../cash/createTransaction";
import {formatIsoInstant} from "../../shared/commitTime";
import {saoPauloDayKey} from "../../shared/dateKeys";
import {
  cancel as cancelLoan,
  cancelPayload as cancelLoanPayload,
  create as createLoan,
  createPayload as loanPayload,
  ledgerTruth,
  pay as payLoan,
  payPayload,
  readMovement as readLoanMovement,
  reverse as reverseLoan,
  reversePayload as reverseLoanPayload,
  seedLoanTenant,
} from "../../loans/testSupport/loanTestSupport";
import {
  read as readDoc,
  movementRef as receivableMovementRef,
  newReceivable,
  receivablePayload,
  receive,
  receivePayload,
  reverse as reverseReceipt,
  reversePayload as reverseReceiptPayload,
  seedClient,
  seedReceivableTenant,
} from "../../receivables/testSupport/receivableTestSupport";
import {
  call,
  db,
  expectHttpsError,
  idempotencyKey,
  uniqueId,
} from "../../workspaces/testSupport/p1TestSupport";
import {
  assertReconciliationEmulator,
  runCashAccountReconciliation,
} from "../reconciliation";
import {
  accountRef,
  archiveAccount,
  assertLedgerConsistent,
  balanceOf,
  countOf,
  createAccountPayload,
  defaultAccountOf,
  movementsOf,
  newAccount,
  statusPayload,
  transfer,
  transferPayload,
} from "../testSupport/accountTestSupport";

/**
 * P3-J (D-30) — cada produtor P3 move a conta no mesmo commit do fato:
 * lançamento manual (confirmado, pendente, confirmação, correção, anulação),
 * importação, empréstimo e recebível; transferência e saldo inicial não
 * mudam receita, despesa nem o `netCents` global. Reconciliação local.
 */

type CashResult = {transactionId: string; revision?: number};

const today = saoPauloDayKey();

const entryRef = (workspaceId: string, id: string) =>
  db().doc(`workspaces/${workspaceId}/transactions/${id}`);

const versionOf = async (workspaceId: string, id: string) =>
  formatIsoInstant((await entryRef(workspaceId, id).get())
    .get("updatedAt") as Timestamp);

const createEntry = (uid: string, workspaceId: string,
  overrides: Record<string, unknown> = {}) =>
  call<CashResult>(createCashTransaction, uid, {
    workspaceId,
    idempotencyKey: idempotencyKey(),
    cashAccountId: defaultAccountOf(workspaceId),
    type: "receita",
    description: "Salário",
    category: "Salário",
    amountCents: 500_000,
    date: "2026-09-15",
    ...overrides,
  });

const entryState = async (workspaceId: string, id: string) => {
  const data = (await entryRef(workspaceId, id).get()).data() ?? {};
  return data;
};

test("P3-J — lançamento manual: receita soma, despesa subtrai; pendente não " +
  "move a conta; a confirmação move", async () => {
  const t = await seedLoanTenant("PF", "acp-cash");
  const main = defaultAccountOf(t.workspaceId);
  await createEntry(t.member, t.workspaceId);
  assert.equal(await balanceOf(t.workspaceId, main), 500_000);
  await createEntry(t.member, t.workspaceId, {type: "despesa",
    description: "Mercado", category: "Casa", amountCents: 12_345});
  assert.equal(await balanceOf(t.workspaceId, main), 487_655);

  const second = await newAccount(t.owner, createAccountPayload(t.workspaceId));
  const pending = await createEntry(t.member, t.workspaceId, {
    type: "despesa", description: "Aluguel", category: "Moradia",
    amountCents: 200_000, status: "pending", date: undefined,
    dueDate: "2026-12-10", cashAccountId: main,
  });
  assert.equal(await balanceOf(t.workspaceId, main), 487_655,
    "pendente não move a conta");
  const stored = await entryState(t.workspaceId, pending.transactionId);
  assert.equal(stored.cashAccountId, main, "a conta fica gravada");
  assert.equal(stored.cashEntry.accountMovementId, null);

  // Confirmação em outra conta: a liquidação usa a conta informada.
  await call(confirmCashTransaction, t.member, {
    workspaceId: t.workspaceId, idempotencyKey: idempotencyKey(),
    transactionId: pending.transactionId,
    expectedUpdatedAt: await versionOf(t.workspaceId, pending.transactionId),
    date: today, amountCents: 201_000, cashAccountId: second.accountId,
  });
  assert.equal(await balanceOf(t.workspaceId, main), 487_655);
  assert.equal(await balanceOf(t.workspaceId, second.accountId), -201_000);
  assert.equal((await entryState(t.workspaceId, pending.transactionId))
    .cashAccountId, second.accountId);
  await assertLedgerConsistent(t.workspaceId);
});

test("P3-J — correção de confirmado compensa e reaplica; descrição sozinha " +
  "não move; anulação compensa; nada é apagado", async () => {
  const t = await seedLoanTenant("PF", "acp-edit");
  const main = defaultAccountOf(t.workspaceId);
  const other = await newAccount(t.owner, createAccountPayload(t.workspaceId));
  const created = await createEntry(t.owner, t.workspaceId,
    {type: "despesa", description: "Luz", category: "Casa",
      amountCents: 9_000});
  const edit = async (entry: Record<string, unknown>) =>
    call(updateCashTransaction, t.owner, {
      workspaceId: t.workspaceId, idempotencyKey: idempotencyKey(),
      transactionId: created.transactionId,
      expectedUpdatedAt: await versionOf(t.workspaceId, created.transactionId),
      reason: "Ajuste",
      entry: {type: "despesa", description: "Luz", category: "Casa",
        amountCents: 9_000, date: "2026-09-15", cashAccountId: main, ...entry},
    });
  // Só a descrição: nenhum movimento novo.
  await edit({description: "Conta de luz"});
  assert.equal((await movementsOf(t.workspaceId, main)).length, 1);
  // Valor novo: estorno do anterior + aplicação do novo.
  await edit({description: "Conta de luz", amountCents: 9_500});
  assert.equal(await balanceOf(t.workspaceId, main), -9_500);
  const kinds = (await movementsOf(t.workspaceId, main))
    .map((movement) => movement.kind).sort();
  assert.deepEqual(kinds,
    ["cash_transaction", "cash_transaction", "reversal"]);
  // Tipo novo (despesa → receita): o sinal acompanha.
  await edit({type: "receita", description: "Reembolso", category: "Outros",
    amountCents: 9_500});
  assert.equal(await balanceOf(t.workspaceId, main), 9_500);
  // Conta nova: a antiga é compensada, a nova recebe.
  await edit({type: "receita", description: "Reembolso", category: "Outros",
    amountCents: 9_500, cashAccountId: other.accountId});
  assert.equal(await balanceOf(t.workspaceId, main), 0);
  assert.equal(await balanceOf(t.workspaceId, other.accountId), 9_500);
  // Anulação: compensa e o documento permanece.
  await call(voidCashTransaction, t.owner, {
    workspaceId: t.workspaceId, idempotencyKey: idempotencyKey(),
    transactionId: created.transactionId,
    expectedUpdatedAt: await versionOf(t.workspaceId, created.transactionId),
    reason: "Duplicado",
  });
  assert.equal(await balanceOf(t.workspaceId, other.accountId), 0);
  const voided = await entryState(t.workspaceId, created.transactionId);
  assert.ok(voided.voidedAt, "baixa lógica");
  assert.equal(voided.cashEntry.accountMovementId, null);
  // Nenhum movimento apagado: 1 + 2 + 2 + 2 + 1.
  assert.equal((await movementsOf(t.workspaceId)).length, 8);
  // Anular pendente não move nada.
  const pending = await createEntry(t.owner, t.workspaceId, {
    status: "pending", date: undefined, dueDate: "2026-12-01"});
  await call(voidCashTransaction, t.owner, {
    workspaceId: t.workspaceId, idempotencyKey: idempotencyKey(),
    transactionId: pending.transactionId,
    expectedUpdatedAt: await versionOf(t.workspaceId, pending.transactionId),
    reason: "Não haverá",
  });
  assert.equal((await movementsOf(t.workspaceId)).length, 8);
  await assertLedgerConsistent(t.workspaceId);
});

test("P3-J — conta arquivada ou de outro workspace: recusa sem gravar; " +
  "falha antes do commit não move a conta", async () => {
  const t = await seedLoanTenant("PF", "acp-guard");
  const other = await newAccount(t.owner, createAccountPayload(t.workspaceId));
  await archiveAccount(t.owner,
    await statusPayload(t.workspaceId, other.accountId));
  await expectHttpsError(createEntry(t.member, t.workspaceId,
    {cashAccountId: other.accountId}), "failed-precondition",
  {message: /arquivada/});
  const foreign = await seedLoanTenant("PF", "acp-foreign");
  await expectHttpsError(createEntry(t.member, t.workspaceId,
    {cashAccountId: defaultAccountOf(foreign.workspaceId)}), "not-found");
  await expectHttpsError(createEntry(t.member, t.workspaceId,
    {cashAccountId: undefined}), "invalid-argument");
  assert.equal(await countOf(t.workspaceId, "transactions"), 0);

  await assert.rejects(executeCreateCashTransaction(
    {uid: t.member, workspaceId: t.workspaceId, role: "member"},
    {workspaceId: t.workspaceId, idempotencyKey: idempotencyKey(),
      cashAccountId: defaultAccountOf(t.workspaceId), type: "receita",
      description: "Falha", category: "X", amountCents: 100,
      date: "2026-09-15"},
    "req-fail", {beforeCommit: () => {
      throw new Error("falha injetada");
    }}), /falha injetada/);
  assert.equal(await balanceOf(t.workspaceId, defaultAccountOf(t.workspaceId)),
    0);
  assert.equal(await countOf(t.workspaceId, "cash_account_movements"), 0);
  assert.equal(await countOf(t.workspaceId, "transactions"), 0);
});

test("P3-J — importação: cada linha nova move a conta do lote; replay não " +
  "duplica", async () => {
  const t = await seedLoanTenant("PF", "acp-imp");
  const main = defaultAccountOf(t.workspaceId);
  const importId = uniqueId("arquivo");
  const batch = (items: Array<Record<string, unknown>>,
    key = idempotencyKey()) => ({
    workspaceId: t.workspaceId, idempotencyKey: key, importId,
    cashAccountId: main, items,
  });
  const line = (index: number, type: "receita" | "despesa") => ({
    lineId: `l${index}`, type, description: `Linha ${index}`,
    category: "Importado", amountCents: 1_000 * index, date: "2026-09-10",
  });
  const payload = batch([line(1, "receita"), line(2, "despesa"),
    line(3, "receita")]);
  await call(importCashTransactions, t.owner, payload);
  assert.equal(await balanceOf(t.workspaceId, main), 1_000 - 2_000 + 3_000);
  // Mesmo lote, mesma chave; e as mesmas linhas com outra chave.
  await call(importCashTransactions, t.owner, payload);
  await call(importCashTransactions, t.owner,
    batch([line(1, "receita"), line(2, "despesa"), line(3, "receita")]));
  assert.equal(await balanceOf(t.workspaceId, main), 2_000);
  assert.equal((await movementsOf(t.workspaceId, main)).length, 3);
  await assertLedgerConsistent(t.workspaceId);
});

test("P3-J — empréstimo: principal entra ou sai na contratação; liquidação " +
  "move principal + juros; estorno e cancelamento usam a conta original",
async () => {
  const t = await seedLoanTenant("PJ", "acp-loan");
  const main = defaultAccountOf(t.workspaceId);
  const other = await newAccount(t.owner, createAccountPayload(t.workspaceId));
  const borrow = await createLoan(t.owner, loanPayload(t.workspaceId,
    {principalCents: 300_000}));
  assert.equal(await balanceOf(t.workspaceId, main), 300_000);
  const lend = await createLoan(t.owner, loanPayload(t.workspaceId,
    {type: "lend", principalCents: 50_000, cashAccountId: other.accountId}));
  assert.equal(await balanceOf(t.workspaceId, other.accountId), -50_000);

  const paid = await payLoan(t.owner, await payPayload(t.workspaceId,
    borrow.loanId, {principalCents: 100_000, interestCents: 5_000,
      cashAccountId: other.accountId}));
  assert.equal(await balanceOf(t.workspaceId, other.accountId),
    -50_000 - 105_000, "tomado paga principal + juros");
  const received = await payLoan(t.owner, await payPayload(t.workspaceId,
    lend.loanId, {principalCents: 10_000, interestCents: 1_000}));
  assert.equal(await balanceOf(t.workspaceId, main), 300_000 + 11_000,
    "concedido recebe principal + juros");

  // O estorno não aceita conta do cliente e compensa a conta original.
  await expectHttpsError(reverseLoan(t.owner, await reverseLoanPayload(
    t.workspaceId, borrow.loanId, paid.movementId as string,
    {cashAccountId: main})), "invalid-argument");
  await reverseLoan(t.owner, await reverseLoanPayload(t.workspaceId,
    borrow.loanId, paid.movementId as string));
  assert.equal(await balanceOf(t.workspaceId, other.accountId), -50_000);
  const movement = await readLoanMovement(t.workspaceId,
    paid.movementId as string);
  assert.equal(movement.cashAccountId, other.accountId);

  // Cancelamento do concedido (sem liquidação ativa depois do estorno dela).
  await reverseLoan(t.owner, await reverseLoanPayload(t.workspaceId,
    lend.loanId, received.movementId as string));
  await cancelLoan(t.owner, await cancelLoanPayload(t.workspaceId,
    lend.loanId));
  assert.equal(await balanceOf(t.workspaceId, other.accountId), 0);
  assert.equal(await balanceOf(t.workspaceId, main), 300_000);
  await assertLedgerConsistent(t.workspaceId);
});

test("P3-J — recebível: principal + juros + multa entram; desconto não; " +
  "estorno usa a conta original (D-39)", async () => {
  const t = await seedReceivableTenant("acp-rcv");
  const main = defaultAccountOf(t.workspaceId);
  const clientId = await seedClient(t);
  const created = await newReceivable(t.owner,
    receivablePayload(t.workspaceId, clientId, {amountCents: 100_000}));
  const paid = await receive(t.owner, await receivePayload(t.workspaceId,
    created.receivableId, {principalCents: 60_000, interestCents: 2_000,
      penaltyCents: 500, discountCents: 5_000}));
  assert.equal(await balanceOf(t.workspaceId, main), 62_500);
  // Só desconto: nenhum movimento; a conta não pode ser informada.
  await expectHttpsError(receive(t.owner, await receivePayload(t.workspaceId,
    created.receivableId, {principalCents: 0, discountCents: 1_000,
      cashAccountId: main})), "invalid-argument");
  await receive(t.owner, await receivePayload(t.workspaceId,
    created.receivableId, {principalCents: 0, discountCents: 1_000}));
  assert.equal((await movementsOf(t.workspaceId, main)).length, 1);
  const stored = await readDoc(receivableMovementRef(t.workspaceId,
    paid.movementId as string));
  assert.equal(stored.cashAccountId, main);
  await reverseReceipt(t.owner, await reverseReceiptPayload(t.workspaceId,
    created.receivableId, paid.movementId as string));
  assert.equal(await balanceOf(t.workspaceId, main), 0);
  await assertLedgerConsistent(t.workspaceId);
});

test("P3-J — semântica global: transferência e saldo inicial não são " +
  "receita nem despesa e não mudam o netCents; D-13 e D-39 intactos",
async () => {
  const t = await seedReceivableTenant("acp-global");
  const main = defaultAccountOf(t.workspaceId);
  await createEntry(t.owner, t.workspaceId, {amountCents: 80_000});
  const loan = await createLoan(t.owner, loanPayload(t.workspaceId,
    {principalCents: 40_000}));
  void loan;
  const truthBefore = await ledgerTruth(t.workspaceId);
  const savings = await newAccount(t.owner, createAccountPayload(t.workspaceId,
    {openingBalanceCents: 1_000_000}));
  await transfer(t.owner, transferPayload(t.workspaceId, main,
    savings.accountId, {amountCents: 30_000}));
  assert.deepEqual(await ledgerTruth(t.workspaceId), truthBefore,
    "projeção (receita, despesa, empréstimo, netCents) inalterada");
  // Só as duas contas da transferência mudaram, em sentidos opostos.
  assert.equal(await balanceOf(t.workspaceId, main), 80_000 + 40_000 - 30_000);
  assert.equal(await balanceOf(t.workspaceId, savings.accountId),
    1_000_000 + 30_000);
  // D-13: o principal do empréstimo é fluxo de principal, não receita.
  const months = Object.values(truthBefore);
  const sum = (field: "incomeCents" | "loanPrincipalInflowCents") =>
    months.reduce((total, delta) => total + delta[field], 0);
  assert.equal(sum("incomeCents"), 80_000);
  assert.equal(sum("loanPrincipalInflowCents"), 40_000);
  // Soma das contas = saldo inicial + netCents dos produtores P3 (a
  // transferência some no total).
  const totalNet = Object.values(truthBefore)
    .reduce((sum, delta) => sum + delta.netCents, 0);
  assert.equal(await balanceOf(t.workspaceId, main) +
    await balanceOf(t.workspaceId, savings.accountId),
  1_000_000 + totalNet);
  await assertLedgerConsistent(t.workspaceId);
});

test("P3-J — reconciliação local: simulação não escreve, aponta divergência; " +
  "reparo só no Emulator", async () => {
  assert.throws(() => assertReconciliationEmulator({
    GCLOUD_PROJECT: "sistema-financeiro-pesso-20698",
    FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
  }), /só roda no Emulator/);
  assert.throws(() => assertReconciliationEmulator({
    GCLOUD_PROJECT: "minhas-financas-local",
  }), /só roda no Emulator/);

  const t = await seedLoanTenant("PF", "acp-rec");
  const main = defaultAccountOf(t.workspaceId);
  await createEntry(t.owner, t.workspaceId, {amountCents: 10_000});
  const clean = await runCashAccountReconciliation(t.workspaceId);
  assert.deepEqual(clean.divergentAccountIds, []);
  assert.equal(clean.mode, "dry-run");
  // Divergência plantada direto no banco (fora do produto).
  await accountRef(t.workspaceId, main).update({balanceCents: 10_001});
  const dirty = await runCashAccountReconciliation(t.workspaceId);
  assert.deepEqual(dirty.divergentAccountIds, [main]);
  const row = dirty.accounts.find((entry) => entry.accountId === main);
  assert.deepEqual([row?.balanceCents, row?.expectedCents,
    row?.divergenceCents], [10_001, 10_000, 1]);
  assert.equal(await balanceOf(t.workspaceId, main), 10_001,
    "simulação não escreve");
  const repaired = await runCashAccountReconciliation(t.workspaceId,
    {repair: true});
  assert.deepEqual(repaired.repairedAccountIds, [main]);
  assert.equal(await balanceOf(t.workspaceId, main), 10_000);
  await assertLedgerConsistent(t.workspaceId);
});
