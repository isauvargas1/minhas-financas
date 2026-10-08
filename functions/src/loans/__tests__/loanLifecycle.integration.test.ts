import assert from "node:assert/strict";
import test from "node:test";

import {defaultAccountOf} from "../../shared/testSupport/kernelTestSupport";
import {saoPauloMonthKey} from "../../shared/dateKeys";
import {
  db,
  expectHttpsError,
  idempotencyKey,
} from "../../workspaces/testSupport/p1TestSupport";
import {executeRebuildCashPeriods} from "../../cash/rebuild";
import {
  executeCreateLoan,
  executeRegisterLoanPayment,
  CANCEL_WITH_PAYMENTS_MESSAGE,
  LOAN_ALREADY_CANCELLED_MESSAGE,
  LOAN_ALREADY_PAID_MESSAGE,
  LOAN_CANCELLED_MESSAGE,
  LOAN_METADATA_UNCHANGED_MESSAGE,
  MOVEMENT_ALREADY_REVERSED_MESSAGE,
  MOVEMENT_NOT_REVERSIBLE_MESSAGE,
  PAYMENT_BEFORE_START_MESSAGE,
  PJ_ONLY_LOAN_FIELDS_MESSAGE,
  PRINCIPAL_ABOVE_BALANCE_MESSAGE,
} from "../operations";
import type {CreateLoanPayload, RegisterLoanPaymentPayload} from "../contracts";
import {
  cancel,
  cancelPayload,
  countOf,
  create,
  createPayload,
  deliverMirror,
  ledgerTruth,
  loanEvents,
  loanVersion,
  metadataPayload,
  monthOf,
  pay,
  payPayload,
  projectedTotals,
  readLoan,
  readMirror,
  readMovement,
  reverse,
  reversePayload,
  seedLoanTenant,
  shiftDays,
  today,
  updateMetadata,
} from "../testSupport/loanTestSupport";

/**
 * P3-G — domínio autoritativo de empréstimos (D-13), de ponta a ponta no
 * Emulator. As callables rodam pelo caminho do runtime; a projeção mensal é
 * conferida entregando cada espelho ao gatilho real e comparando com a soma
 * recalculada do ledger e com a reconstrução.
 */
db();

const CNPJ = "11.222.333/0001-81";

const quotaUsed = async (workspaceId: string) =>
  Number((await db().doc(
    `workspaces/${workspaceId}/quota_state/transactions_${saoPauloMonthKey()}`,
  ).get()).get("used") ?? 0);

test("P3-G — borrow PF: contrato, fato inicial e espelho de caixa no mesmo " +
  "commit, sem receita operacional nem quota", async () => {
  const tenant = await seedLoanTenant("PF");
  const created = await create(tenant.member,
    createPayload(tenant.workspaceId));
  assert.equal(created.replayed, false);
  assert.match(created.loanId, /^loan_[0-9a-f]{40}$/);

  const loan = await readLoan(tenant.workspaceId, created.loanId);
  assert.equal(loan.schemaVersion, 1);
  assert.equal(loan.workspaceId, tenant.workspaceId);
  assert.equal(loan.profileType, "PF");
  assert.equal(loan.type, "borrow");
  assert.equal(loan.createdBy, tenant.member);
  assert.equal(loan.principalCents, 300_000);
  assert.equal(loan.balanceCents, 300_000);
  assert.equal(loan.totalPrincipalSettledCents, 0);
  assert.equal(loan.totalInterestSettledCents, 0);
  assert.equal(loan.status, "active");
  assert.equal(loan.schedule.length, 3);
  assert.deepEqual(loan.schedule.map((item: {principalCents: number}) =>
    item.principalCents), [100_000, 100_000, 100_000]);
  for (const floatField of ["currentBalance", "principalValue", "amount"]) {
    assert.equal(loan[floatField], undefined, floatField);
  }

  const movement = await readMovement(tenant.workspaceId, created.movementId);
  assert.equal(movement.kind, "disbursement");
  assert.equal(movement.loanId, created.loanId);
  assert.equal(movement.principalCents, 300_000);
  assert.equal(movement.cashDirection, "in");
  assert.equal(movement.cashTransactionId, created.cashTransactionId);

  const mirror = await readMirror(tenant.workspaceId,
    created.cashTransactionId);
  assert.equal(mirror.type, "receita");
  assert.equal(mirror.valueCents, 300_000);
  assert.equal(mirror.source, "loan");
  assert.equal(mirror.userId, tenant.member);
  assert.equal(mirror.description, "Empréstimo recebido");
  assert.deepEqual(mirror.loanEntry, {
    domainVersion: 1,
    loanId: created.loanId,
    loanMovementId: created.movementId,
    loanType: "borrow",
    kind: "disbursement",
    reversal: false,
    principalCents: 300_000,
    interestCents: 0,
    currency: "BRL",
  });
  // Nenhum dado da contraparte no espelho nem na auditoria.
  const serialized = JSON.stringify([mirror, await loanEvents(
    tenant.workspaceId)]);
  const personalData = ["Banco Exemplo", "contato@banco", "Capital de giro"];
  for (const personal of personalData) {
    assert.equal(serialized.includes(personal), false, personal);
  }
  const [event] = await loanEvents(tenant.workspaceId);
  assert.equal(event.operation, "loan.created");
  assert.equal(event.actorId, tenant.member);
  assert.equal(event.actorRole, "member");
  assert.deepEqual(event.after, {
    status: "active", principalCents: 300_000, balanceCents: 300_000,
    totalPrincipalSettledCents: 0, totalInterestSettledCents: 0,
    activePaymentCount: 0,
  });

  // O espelho não consome a quota manual (D-40).
  assert.equal(await quotaUsed(tenant.workspaceId), 0);

  // Principal entra no caixa sem virar receita operacional.
  await deliverMirror(tenant.workspaceId, created.cashTransactionId);
  const month = monthOf(today());
  const period = (await projectedTotals(tenant.workspaceId))[month];
  assert.equal(period.loanPrincipalInflowCents, 300_000);
  assert.equal(period.incomeCents, 0);
  assert.equal(period.expenseCents, 0);
  assert.equal(period.netCents, 300_000);
  assert.deepEqual(await projectedTotals(tenant.workspaceId),
    await ledgerTruth(tenant.workspaceId));
});

test("P3-G — lend PJ com Price, campos PJ e saída de principal", async () => {
  const tenant = await seedLoanTenant("PJ");
  const created = await create(tenant.owner, createPayload(tenant.workspaceId, {
    type: "lend",
    personName: "Colaborador Exemplo",
    principalCents: 1_000_000,
    installments: 12,
    interest: {type: "percentage", ratePpm: 10_000, ratePeriod: "monthly",
      amortization: "price"},
    counterpartyType: "colaborador",
    cnpjCpf: CNPJ,
    classification: "emprestimos_colaboradores",
    costCenter: "Folha",
  }));
  const loan = await readLoan(tenant.workspaceId, created.loanId);
  assert.equal(loan.profileType, "PJ");
  assert.equal(loan.cnpjCpf, "11222333000181");
  assert.equal(loan.classification, "emprestimos_colaboradores");
  assert.equal(loan.counterpartyType, "colaborador");
  assert.equal(loan.costCenter, "Folha");
  assert.equal(loan.schedule[0].totalCents, 88_849);
  assert.equal(loan.schedule[11].principalCents, 87_967);
  assert.equal(loan.scheduledInterestCents, 66_186);
  assert.equal(loan.interest.ratePpm, 10_000);

  const mirror = await readMirror(tenant.workspaceId,
    created.cashTransactionId);
  assert.equal(mirror.type, "despesa");
  assert.equal(mirror.description, "Empréstimo concedido");
  assert.equal(mirror.valueCents, 1_000_000);
  await deliverMirror(tenant.workspaceId, created.cashTransactionId);
  const period = (await projectedTotals(tenant.workspaceId))[monthOf(today())];
  assert.equal(period.loanPrincipalOutflowCents, 1_000_000);
  assert.equal(period.expenseCents, 0);
  assert.equal(period.netCents, -1_000_000);

  // Taxa anual nominal, SAC, primeira e última parcela.
  const annual = await create(tenant.owner, createPayload(tenant.workspaceId, {
    principalCents: 1_200_000,
    installments: 2,
    firstDueDate: shiftDays(today(), 10),
    interest: {type: "percentage", ratePpm: 100_000, ratePeriod: "annual",
      amortization: "sac"},
  }));
  const annualLoan = await readLoan(tenant.workspaceId, annual.loanId);
  assert.deepEqual(
    annualLoan.schedule.map((item: Record<string, unknown>) =>
      [item.number, item.principalCents, item.interestCents]),
    [[1, 600_000, 10_000], [2, 600_000, 5_000]],
  );
  assert.equal(annualLoan.schedule[0].dueDate, shiftDays(today(), 10));
  assert.equal(annualLoan.maturityDate, annualLoan.schedule[1].dueDate);
});

test("P3-G — PF não envia campos de PJ; nada é gravado", async () => {
  const tenant = await seedLoanTenant("PF");
  for (const extra of [
    {cnpjCpf: CNPJ}, {classification: "capital_giro"},
    {counterpartyType: "banco"}, {costCenter: "Matriz"},
  ]) {
    await expectHttpsError(
      create(tenant.owner, createPayload(tenant.workspaceId, extra)),
      "invalid-argument",
      {message: PJ_ONLY_LOAN_FIELDS_MESSAGE},
    );
  }
  assert.equal(await countOf(tenant.workspaceId, "loans"), 0);
  assert.equal(await countOf(tenant.workspaceId, "transactions"), 0);
  // Contratação futura e entradas inválidas: recusadas pelo contrato.
  for (const invalid of [
    {startDate: shiftDays(today(), 1)},
    {firstDueDate: shiftDays(today(), -1)},
    {principalCents: 10.5},
    {installments: 361},
    {principalCents: 2, installments: 3},
    {interest: {type: "percentage", ratePpm: 1.5, ratePeriod: "monthly",
      amortization: "price"}},
    {balanceCents: 1},
    {createdBy: "intruso"},
    {status: "paid"},
  ]) {
    await expectHttpsError(
      create(tenant.owner, createPayload(tenant.workspaceId, invalid)),
      "invalid-argument",
    );
  }
  assert.equal(await countOf(tenant.workspaceId, "loans"), 0);
});

test("P3-G — liquidação com principal e juros: saldo cai só pelo principal; " +
  "juros são despesa financeira", async () => {
  const tenant = await seedLoanTenant("PF");
  const created = await create(tenant.member,
    createPayload(tenant.workspaceId));
  await deliverMirror(tenant.workspaceId, created.cashTransactionId);
  const paid = await pay(tenant.member,
    await payPayload(tenant.workspaceId, created.loanId));
  assert.equal(paid.balanceCents, 200_000);
  assert.equal(paid.status, "active");
  const loan = await readLoan(tenant.workspaceId, created.loanId);
  assert.equal(loan.balanceCents, 200_000);
  assert.equal(loan.totalPrincipalSettledCents, 100_000);
  assert.equal(loan.totalInterestSettledCents, 10_000);
  assert.equal(loan.activePaymentCount, 1);

  const movement = await readMovement(tenant.workspaceId,
    paid.movementId as string);
  assert.equal(movement.kind, "payment");
  assert.equal(movement.totalCents, 110_000);
  assert.equal(movement.cashDirection, "out");
  const mirror = await readMirror(tenant.workspaceId,
    paid.cashTransactionId as string);
  assert.equal(mirror.type, "despesa");
  assert.equal(mirror.valueCents, 110_000);
  assert.equal(mirror.description, "Pagamento de empréstimo");

  await deliverMirror(tenant.workspaceId, paid.cashTransactionId as string);
  const period = (await projectedTotals(tenant.workspaceId))[monthOf(today())];
  assert.equal(period.loanPrincipalOutflowCents, 100_000);
  assert.equal(period.financialExpenseCents, 10_000);
  assert.equal(period.expenseCents, 0);
  assert.equal(period.netCents, 300_000 - 110_000);

  // Lend: recebimento é entrada; juros são receita financeira.
  const lend = await create(tenant.owner, createPayload(tenant.workspaceId, {
    type: "lend",
  }));
  const received = await pay(tenant.owner, await payPayload(
    tenant.workspaceId, lend.loanId, {principalCents: 50_000,
      interestCents: 2_500}));
  const lendMirror = await readMirror(tenant.workspaceId,
    received.cashTransactionId as string);
  assert.equal(lendMirror.type, "receita");
  assert.equal(lendMirror.description, "Recebimento de empréstimo");
  await deliverMirror(tenant.workspaceId, lend.cashTransactionId);
  await deliverMirror(tenant.workspaceId, received.cashTransactionId as string);
  const both = (await projectedTotals(tenant.workspaceId))[monthOf(today())];
  assert.equal(both.loanPrincipalInflowCents, 300_000 + 50_000);
  assert.equal(both.loanPrincipalOutflowCents, 100_000 + 300_000);
  assert.equal(both.financialIncomeCents, 2_500);
  assert.equal(both.incomeCents, 0);
  assert.deepEqual(await projectedTotals(tenant.workspaceId),
    await ledgerTruth(tenant.workspaceId));
});

test("P3-G — regras da liquidação: saldo, data, quitação e status pago " +
  "pelo saldo zero", async () => {
  const tenant = await seedLoanTenant("PF");
  const created = await create(tenant.owner, createPayload(tenant.workspaceId, {
    startDate: shiftDays(today(), -5),
  }));
  await expectHttpsError(pay(tenant.owner, await payPayload(tenant.workspaceId,
    created.loanId, {principalCents: 300_001})), "failed-precondition",
  {message: PRINCIPAL_ABOVE_BALANCE_MESSAGE});
  await expectHttpsError(pay(tenant.owner, await payPayload(tenant.workspaceId,
    created.loanId, {date: shiftDays(today(), -6)})), "failed-precondition",
  {message: PAYMENT_BEFORE_START_MESSAGE});
  await expectHttpsError(pay(tenant.owner, await payPayload(tenant.workspaceId,
    created.loanId, {date: shiftDays(today(), 1)})), "invalid-argument");
  await expectHttpsError(pay(tenant.owner, await payPayload(tenant.workspaceId,
    created.loanId, {principalCents: 0, interestCents: 0})),
  "invalid-argument");
  // Campos calculados nunca vêm do cliente.
  for (const forged of [{balanceCents: 0}, {status: "paid"},
    {currentBalance: 0}]) {
    await expectHttpsError(pay(tenant.owner, await payPayload(
      tenant.workspaceId, created.loanId, forged)), "invalid-argument");
  }

  // Última amortização: saldo zero → `paid`.
  const first = await pay(tenant.owner, await payPayload(tenant.workspaceId,
    created.loanId, {principalCents: 120_000, interestCents: 0}));
  assert.equal(first.balanceCents, 180_000);
  const last = await pay(tenant.owner, await payPayload(tenant.workspaceId,
    created.loanId, {principalCents: 180_000, interestCents: 1_234}));
  assert.equal(last.balanceCents, 0);
  assert.equal(last.status, "paid");
  const loan = await readLoan(tenant.workspaceId, created.loanId);
  assert.equal(loan.status, "paid");
  assert.equal(loan.overdueFrom, null);
  assert.equal(loan.totalPrincipalSettledCents, 300_000);
  assert.equal(loan.totalInterestSettledCents, 1_234);
  await expectHttpsError(pay(tenant.owner, await payPayload(tenant.workspaceId,
    created.loanId, {principalCents: 1, interestCents: 0})),
  "failed-precondition", {message: LOAN_ALREADY_PAID_MESSAGE});
});

test("P3-G — pagamentos paralelos: um efeito por versão, sem saldo negativo " +
  "nem atualização perdida", async () => {
  const tenant = await seedLoanTenant("PF");
  const created = await create(tenant.owner, createPayload(tenant.workspaceId));
  const version = await loanVersion(tenant.workspaceId, created.loanId);
  const attempts = await Promise.allSettled(Array.from({length: 4}, () =>
    pay(tenant.owner, {
      workspaceId: tenant.workspaceId,
      idempotencyKey: idempotencyKey(),
      loanId: created.loanId,
      expectedUpdatedAt: version,
      cashAccountId: defaultAccountOf(tenant.workspaceId),
      date: today(),
      principalCents: 200_000,
      interestCents: 0,
    })));
  const won = attempts.filter((outcome) => outcome.status === "fulfilled");
  assert.equal(won.length, 1, JSON.stringify(attempts.map((a) => a.status)));
  const rejected = attempts.filter((outcome) => outcome.status === "rejected");
  for (const lost of rejected) {
    const reason = (lost as PromiseRejectedResult).reason as {code?: string};
    assert.equal(reason.code, "aborted");
  }
  const loan = await readLoan(tenant.workspaceId, created.loanId);
  assert.equal(loan.balanceCents, 100_000);
  assert.equal(loan.activePaymentCount, 1);
  assert.equal(await countOf(tenant.workspaceId, "loan_movements"), 2);
  assert.equal(await countOf(tenant.workspaceId, "transactions"), 2);
});

test("P3-G — estorno restaura saldo, juros, status e caixa; replay e " +
  "segunda reversão", async () => {
  const tenant = await seedLoanTenant("PF");
  const created = await create(tenant.owner, createPayload(tenant.workspaceId));
  await deliverMirror(tenant.workspaceId, created.cashTransactionId);
  const paid = await pay(tenant.owner, await payPayload(tenant.workspaceId,
    created.loanId, {principalCents: 300_000, interestCents: 9_000}));
  assert.equal(paid.status, "paid");
  await deliverMirror(tenant.workspaceId, paid.cashTransactionId as string);

  const payload = await reversePayload(tenant.workspaceId, created.loanId,
    paid.movementId as string);
  const reversed = await reverse(tenant.owner, payload);
  assert.equal(reversed.replayed, false);
  assert.equal(reversed.balanceCents, 300_000);
  assert.equal(reversed.status, "active");
  const loan = await readLoan(tenant.workspaceId, created.loanId);
  assert.equal(loan.balanceCents, 300_000);
  assert.equal(loan.totalPrincipalSettledCents, 0);
  assert.equal(loan.totalInterestSettledCents, 0);
  assert.equal(loan.activePaymentCount, 0);

  const original = await readMovement(tenant.workspaceId,
    paid.movementId as string);
  const compensation = await readMovement(tenant.workspaceId,
    reversed.movementId as string);
  assert.equal(original.reversedBy, reversed.movementId);
  assert.equal(compensation.reversalOf, paid.movementId);
  assert.equal(compensation.kind, "reversal");
  assert.equal(compensation.originalKind, "payment");
  assert.equal(compensation.date, original.date);
  assert.equal(compensation.reason, "Pagamento lançado em duplicidade");
  // Nada apagado: os dois movimentos e os dois espelhos existem.
  assert.ok((await readMirror(tenant.workspaceId,
    paid.cashTransactionId as string)).loanEntry);
  const compensationMirror = await readMirror(tenant.workspaceId,
    reversed.cashTransactionId as string);
  assert.equal(compensationMirror.type, "receita");
  assert.equal(compensationMirror.valueCents, 309_000);
  assert.equal(compensationMirror.loanEntry.reversal, true);
  assert.equal(compensationMirror.loanEntry.reversalOf, paid.movementId);

  await deliverMirror(tenant.workspaceId, reversed.cashTransactionId as string);
  const period = (await projectedTotals(tenant.workspaceId))[monthOf(today())];
  assert.equal(period.loanPrincipalOutflowCents, 0);
  assert.equal(period.financialExpenseCents, 0);
  assert.equal(period.netCents, 300_000);
  assert.deepEqual(await projectedTotals(tenant.workspaceId),
    await ledgerTruth(tenant.workspaceId));

  // Replay da mesma intenção: mesmo resultado, nada novo.
  const movements = await countOf(tenant.workspaceId, "loan_movements");
  const replay = await reverse(tenant.owner, payload);
  assert.equal(replay.replayed, true);
  assert.equal(replay.movementId, reversed.movementId);
  assert.equal(await countOf(tenant.workspaceId, "loan_movements"), movements);
  // Outra intenção sobre o movimento já estornado: recusa.
  await expectHttpsError(reverse(tenant.owner, await reversePayload(
    tenant.workspaceId, created.loanId, paid.movementId as string)),
  "failed-precondition", {message: MOVEMENT_ALREADY_REVERSED_MESSAGE});
  // A contratação não é estornável por aqui.
  await expectHttpsError(reverse(tenant.owner, await reversePayload(
    tenant.workspaceId, created.loanId, created.movementId)),
  "failed-precondition", {message: MOVEMENT_NOT_REVERSIBLE_MESSAGE});
  await expectHttpsError(reverse(tenant.owner, await reversePayload(
    tenant.workspaceId, created.loanId, "lmv_inexistente")), "not-found");
});

test("P3-G — cancelamento: válido sem liquidações, recusado com elas; " +
  "terminal", async () => {
  const tenant = await seedLoanTenant("PF");
  const created = await create(tenant.owner, createPayload(tenant.workspaceId));
  await deliverMirror(tenant.workspaceId, created.cashTransactionId);
  const paid = await pay(tenant.owner, await payPayload(tenant.workspaceId,
    created.loanId));
  await deliverMirror(tenant.workspaceId, paid.cashTransactionId as string);
  await expectHttpsError(cancel(tenant.owner, await cancelPayload(
    tenant.workspaceId, created.loanId)), "failed-precondition",
  {message: CANCEL_WITH_PAYMENTS_MESSAGE});

  const reversed = await reverse(tenant.owner, await reversePayload(
    tenant.workspaceId, created.loanId, paid.movementId as string));
  await deliverMirror(tenant.workspaceId, reversed.cashTransactionId as string);
  const cancelled = await cancel(tenant.owner, await cancelPayload(
    tenant.workspaceId, created.loanId));
  assert.equal(cancelled.status, "cancelled");
  const loan = await readLoan(tenant.workspaceId, created.loanId);
  assert.equal(loan.status, "cancelled");
  assert.equal(loan.overdueFrom, null);
  assert.equal(loan.cancelledBy, tenant.owner);
  assert.equal(loan.schedule.length, 3, "cronograma preservado");
  assert.equal(loan.principalCents, 300_000);
  const disbursement = await readMovement(tenant.workspaceId,
    created.movementId);
  assert.equal(disbursement.reversedBy, cancelled.movementId);
  const compensation = await readMovement(tenant.workspaceId,
    cancelled.movementId as string);
  assert.equal(compensation.originalKind, "disbursement");
  assert.equal(compensation.reversalOf, created.movementId);
  const mirror = await readMirror(tenant.workspaceId,
    cancelled.cashTransactionId as string);
  assert.equal(mirror.type, "despesa");
  assert.equal(mirror.description, "Cancelamento: empréstimo recebido");
  await deliverMirror(tenant.workspaceId,
    cancelled.cashTransactionId as string);
  // Todo o efeito de caixa do contrato volta a zero no mês; os quatro
  // documentos do ledger continuam contados (nada apagado).
  const totals = await projectedTotals(tenant.workspaceId);
  assert.deepEqual(totals, await ledgerTruth(tenant.workspaceId));
  assert.deepEqual(totals[monthOf(today())], {
    incomeCents: 0, expenseCents: 0, investmentOutflowCents: 0,
    loanPrincipalInflowCents: 0, loanPrincipalOutflowCents: 0,
    financialIncomeCents: 0, financialExpenseCents: 0,
    // P4-A: campo do pagamento de fatura de cartão (nenhum aqui).
    creditCardPaymentCents: 0,
    // P4-D: entrada de principal de investimento (nenhuma aqui).
    investmentInflowCents: 0,
    netCents: 0,
    transactionCount: 4,
  });
  assert.equal(await countOf(tenant.workspaceId, "loan_movements"), 4);
  assert.equal(await countOf(tenant.workspaceId, "transactions"), 4);

  await expectHttpsError(pay(tenant.owner, await payPayload(tenant.workspaceId,
    created.loanId)), "failed-precondition", {message: LOAN_CANCELLED_MESSAGE});
  await expectHttpsError(cancel(tenant.owner, await cancelPayload(
    tenant.workspaceId, created.loanId)), "failed-precondition",
  {message: LOAN_ALREADY_CANCELLED_MESSAGE});
  const operations = (await loanEvents(tenant.workspaceId))
    .map((event) => event.operation).sort();
  assert.deepEqual(operations, ["loan.cancelled", "loan.created",
    "loan.movement_reversed", "loan.payment_registered"]);
});

test("P3-G — metadados: só campos não financeiros, auditoria sem " +
  "valores", async () => {
  const tenant = await seedLoanTenant("PJ");
  const created = await create(tenant.member,
    createPayload(tenant.workspaceId, {cnpjCpf: CNPJ}));
  const before = await readLoan(tenant.workspaceId, created.loanId);
  const updated = await updateMetadata(tenant.member, await metadataPayload(
    tenant.workspaceId, created.loanId, {
      description: "Capital de giro renegociado",
      personContact: null,
      classification: "capital_giro",
    }));
  assert.equal(updated.changed, true);
  const after = await readLoan(tenant.workspaceId, created.loanId);
  assert.equal(after.description, "Capital de giro renegociado");
  assert.equal(after.personContact, undefined);
  assert.equal(after.classification, "capital_giro");
  for (const field of ["principalCents", "balanceCents", "type", "interest",
    "schedule", "status", "totalPrincipalSettledCents", "createdBy"]) {
    assert.deepEqual(after[field], before[field], field);
  }
  const event = (await loanEvents(tenant.workspaceId))
    .find((entry) => entry.operation === "loan.metadata_updated");
  assert.deepEqual(event?.changedFields,
    ["classification", "description", "personContact"]);
  assert.equal(JSON.stringify(event).includes("renegociado"), false);

  // Sem mudança: recusa, nada gravado (P3-H; idempotência em loanGuards).
  const version = (await readLoan(tenant.workspaceId, created.loanId))
    .updatedAt;
  await expectHttpsError(updateMetadata(tenant.member, await metadataPayload(
    tenant.workspaceId, created.loanId, {classification: "capital_giro"})),
  "failed-precondition", {message: LOAN_METADATA_UNCHANGED_MESSAGE});
  assert.deepEqual((await readLoan(tenant.workspaceId, created.loanId))
    .updatedAt, version);

  // Termos financeiros nunca passam por aqui.
  for (const forbidden of [
    {principalCents: 1}, {type: "lend"}, {interest: {type: "none"}},
    {schedule: []}, {balanceCents: 0}, {status: "paid"},
    {totalPrincipalSettledCents: 0}, {createdBy: tenant.otherMember},
  ]) {
    await expectHttpsError(updateMetadata(tenant.member, await metadataPayload(
      tenant.workspaceId, created.loanId, forbidden)), "invalid-argument");
  }
  await expectHttpsError(updateMetadata(tenant.member, await metadataPayload(
    tenant.workspaceId, created.loanId, {})), "invalid-argument");
  await expectHttpsError(updateMetadata(tenant.member, await metadataPayload(
    tenant.workspaceId, created.loanId, {cnpjCpf: "111.111.111-11"})),
  "invalid-argument");

  // PF não recebe campo de PJ nem por metadados.
  const pf = await seedLoanTenant("PF");
  const pfLoan = await create(pf.owner, createPayload(pf.workspaceId));
  await expectHttpsError(updateMetadata(pf.owner, await metadataPayload(
    pf.workspaceId, pfLoan.loanId, {costCenter: "Matriz"})),
  "invalid-argument", {message: PJ_ONLY_LOAN_FIELDS_MESSAGE});
});

test("P3-G — falha antes do commit não deixa nada; reenvio aplica " +
  "uma vez", async () => {
  const tenant = await seedLoanTenant("PF");
  const actor = {uid: tenant.owner, workspaceId: tenant.workspaceId,
    role: "owner" as const};
  const payload = createPayload(tenant.workspaceId) as CreateLoanPayload;
  await assert.rejects(executeCreateLoan(actor, payload, "req-fail", {
    beforeCommit: () => {
      throw new Error("falha injetada");
    },
  }), /falha injetada/);
  for (const collection of ["loans", "loan_movements", "transactions",
    "loan_events", "rate_limits"]) {
    assert.equal(await countOf(tenant.workspaceId, collection), 0, collection);
  }
  const created = await executeCreateLoan(actor, payload, "req-ok");
  const replay = await executeCreateLoan(actor, payload, "req-again");
  assert.equal(replay.replayed, true);
  assert.equal(replay.loanId, created.loanId);
  assert.equal(await countOf(tenant.workspaceId, "loans"), 1);

  const payment = await payPayload(tenant.workspaceId, created.loanId) as
    RegisterLoanPaymentPayload;
  await assert.rejects(executeRegisterLoanPayment(actor, payment, "req-p", {
    beforeCommit: () => {
      throw new Error("falha injetada");
    },
  }), /falha injetada/);
  const loan = await readLoan(tenant.workspaceId, created.loanId);
  assert.equal(loan.balanceCents, 300_000);
  assert.equal(await countOf(tenant.workspaceId, "loan_movements"), 1);
  assert.equal(await countOf(tenant.workspaceId, "transactions"), 1);
  const applied = await executeRegisterLoanPayment(actor, payment, "req-p2");
  assert.equal(applied.balanceCents, 200_000);
});

test("P3-G — reconstrução do caixa reproduz os efeitos dos " +
  "empréstimos", async () => {
  const tenant = await seedLoanTenant("PJ");
  const borrow = await create(tenant.owner, createPayload(tenant.workspaceId, {
    startDate: shiftDays(today(), -40),
    firstDueDate: shiftDays(today(), -10),
  }));
  const lend = await create(tenant.owner, createPayload(tenant.workspaceId, {
    type: "lend", principalCents: 50_000, installments: 2,
  }));
  const p1 = await pay(tenant.owner, await payPayload(tenant.workspaceId,
    borrow.loanId, {date: shiftDays(today(), -35), principalCents: 100_000,
      interestCents: 4_000}));
  const p2 = await pay(tenant.owner, await payPayload(tenant.workspaceId,
    lend.loanId, {principalCents: 20_000, interestCents: 700}));
  const r1 = await reverse(tenant.owner, await reversePayload(
    tenant.workspaceId, lend.loanId, p2.movementId as string));
  const cancellable = await create(tenant.owner, createPayload(
    tenant.workspaceId, {principalCents: 7_777, installments: 1}));
  const c1 = await cancel(tenant.owner, await cancelPayload(tenant.workspaceId,
    cancellable.loanId));
  for (const id of [borrow.cashTransactionId, lend.cashTransactionId,
    p1.cashTransactionId, p2.cashTransactionId, r1.cashTransactionId,
    cancellable.cashTransactionId, c1.cashTransactionId]) {
    await deliverMirror(tenant.workspaceId, id as string);
  }
  const truth = await ledgerTruth(tenant.workspaceId);
  assert.deepEqual(await projectedTotals(tenant.workspaceId), truth);
  const earlier = monthOf(shiftDays(today(), -35));
  assert.equal(truth[earlier].financialExpenseCents, 4_000);

  const rebuild = (dryRun: boolean) => executeRebuildCashPeriods(
    tenant.workspaceId, tenant.owner, {
      workspaceId: tenant.workspaceId,
      idempotencyKey: idempotencyKey(),
      correlationId: "corr-loan-rebuild",
      pageSize: 50,
      reason: "Reconciliação P3-G",
      dryRun,
    });
  const simulated = await rebuild(true) as Record<string, unknown>;
  assert.equal((simulated.divergence as {divergentPeriods: number})
    .divergentPeriods, 0);
  const reconciliation = simulated.reconciliation as Record<string, number>;
  assert.equal(reconciliation.financialExpenseCents, 4_000);
  const published = await rebuild(false) as Record<string, unknown>;
  assert.equal(published.completed, true);
  assert.deepEqual(await projectedTotals(tenant.workspaceId), truth);
});
