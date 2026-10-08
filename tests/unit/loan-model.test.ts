import assert from 'node:assert/strict';
import test from 'node:test';

import { loanVersionOf, toLoan, toLoanMovement } from '../../src/modules/loans/adapters.ts';
import { LOAN_CALLABLES, createLoanCallables } from '../../src/modules/loans/callables.ts';
import { LoanInputError } from '../../src/modules/loans/payloads.ts';
import {
  interestLabel,
  isOpenLoan,
  loanErrorView,
  loanPermissions,
  movementLabel,
  movementStateLabel,
  nextInstallment,
  openBalanceCents,
  principalProgressPercent,
  scheduleRows,
  suggestedPayment,
} from '../../src/modules/loans/presentation.ts';
import type { Loan, LoanMovement } from '../../src/modules/loans/types.ts';
import {
  isOperationalExpense,
  isOperationalIncome,
  summarizeCashFlow,
  transactionCashImpact,
} from '../../src/modules/investments/semantics.ts';
import type { Transaction } from '../../src/types.ts';

/**
 * P3-H — o frontend de empréstimos lê um único formato (o contrato
 * autoritativo da P3-G) e só apresenta o que o backend gravou.
 */

const timestamp = { seconds: 1_790_000_000, nanoseconds: 123_456_789 };

const loanDoc = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'loan_1', schemaVersion: 1, workspaceId: 'ws-1', profileType: 'PF', type: 'borrow',
  personName: 'Banco Exemplo', personContact: 'contato@exemplo.com', currency: 'BRL',
  principalCents: 300_000, balanceCents: 300_000, totalPrincipalSettledCents: 0,
  totalInterestSettledCents: 0, activePaymentCount: 0, status: 'active', overdueFrom: '2026-11-06',
  interest: { type: 'percentage', ratePpm: 19_900, ratePeriod: 'monthly', amortization: 'price' },
  startDate: '2026-10-05', firstDueDate: '2026-11-05', installmentsCount: 3,
  schedule: [
    { number: 1, dueDate: '2026-11-05', principalCents: 98_000, interestCents: 5_970, totalCents: 103_970 },
    { number: 2, dueDate: '2026-12-05', principalCents: 99_950, interestCents: 4_020, totalCents: 103_970 },
    { number: 3, dueDate: '2027-01-05', principalCents: 102_050, interestCents: 2_031, totalCents: 104_081 },
  ],
  scheduledInterestCents: 12_021, maturityDate: '2027-01-05', createdBy: 'uid-member',
  updatedBy: 'uid-member', updatedAt: timestamp, revision: 1,
  disbursementMovementId: 'lmv_d', disbursementTransactionId: 'loancash_d', requestHash: 'h',
  ...overrides,
});

const adapted = (overrides: Record<string, unknown> = {}): Loan => {
  const loan = toLoan('loan_1', loanDoc(overrides));
  assert.ok(loan, JSON.stringify(overrides));
  return loan;
};

test('P3-H — adapter: um só formato; versão com nanossegundos; inválido não passa', () => {
  const loan = adapted();
  assert.equal(loan.version, '2026-09-21T14:13:20.123456789Z');
  assert.equal(loan.balanceCents, 300_000);
  assert.equal(loan.schedule.length, 3);
  assert.equal(loan.cnpjCpf, undefined, 'PF não expõe campos de PJ');
  assert.equal(loanVersionOf({ seconds: 1, nanoseconds: 5 }), '1970-01-01T00:00:01.000000005Z');
  assert.equal(loanVersionOf(null), null);
  assert.equal(loanVersionOf({ seconds: 1.5, nanoseconds: 0 }), null);
  for (const [label, overrides] of [
    ['sem marca', { schemaVersion: undefined }],
    ['outra versão', { schemaVersion: 2 }],
    ['saldo em reais', { balanceCents: 3000.5 }],
    ['saldo que não fecha', { balanceCents: 299_999 }],
    ['status desconhecido', { status: 'open' }],
    ['cronograma incompleto', { installmentsCount: 4 }],
    ['parcela com total incoerente', { schedule: [{ number: 1, dueDate: '2026-11-05', principalCents: 1, interestCents: 1, totalCents: 3 }], installmentsCount: 1 }],
    ['juros float', { interest: { type: 'percentage', ratePpm: 1.5, ratePeriod: 'monthly', amortization: 'price' } }],
    ['sem autor', { createdBy: undefined }],
    ['sem versão', { updatedAt: undefined }],
    ['data inválida', { startDate: '2026-02-30' }],
    ['formato anterior', { schemaVersion: undefined, currentBalance: 3000, principalValue: 3000 }],
  ] as const) {
    assert.equal(toLoan('loan_1', loanDoc(overrides as Record<string, unknown>)), null, label);
  }
  const pj = adapted({ profileType: 'PJ', cnpjCpf: '11222333000181', classification: 'capital_giro', costCenter: 'Matriz', counterpartyType: 'banco' });
  assert.equal(pj.cnpjCpf, '11222333000181');
  assert.equal(pj.classification, 'capital_giro');
  assert.equal(adapted({ classification: 'inventada' }).classification, undefined);
});

test('P3-H — movimento: tipos autoritativos e vínculo de estorno', () => {
  const movement = toLoanMovement('lmv_r', {
    schemaVersion: 1, loanId: 'loan_1', kind: 'reversal', originalKind: 'payment',
    principalCents: 100_000, interestCents: 10_000, totalCents: 110_000, date: '2026-10-05',
    cashDirection: 'in', cashTransactionId: 'loancash_r', reversalOf: 'lmv_p', reversedBy: null,
    reason: 'Duplicado', createdBy: 'uid',
  });
  assert.deepEqual(movement && { kind: movement.kind, reversalOf: movement.reversalOf, reason: movement.reason },
    { kind: 'reversal', reversalOf: 'lmv_p', reason: 'Duplicado' });
  assert.equal(toLoanMovement('x', { schemaVersion: 1, loanId: 'l', kind: 'reversal', principalCents: 1,
    interestCents: 0, totalCents: 1, date: '2026-10-05', cashDirection: 'in', cashTransactionId: 'c',
    createdBy: 'u' }), null, 'estorno sem vínculo');
  assert.equal(toLoanMovement('x', { loanId: 'l', type: 'payment', amount: 10, date: '2026-10-05' }), null,
    'formato anterior');
  assert.equal(toLoanMovement('x', { schemaVersion: 1, loanId: 'l', kind: 'payment', principalCents: 1,
    interestCents: 1, totalCents: 3, date: '2026-10-05', cashDirection: 'out', cashTransactionId: 'c',
    createdBy: 'u' }), null, 'total incoerente');
});

test('P3-H — cronograma apresentado: só o persistido, com a situação pelo principal amortizado', () => {
  const fresh = adapted();
  assert.deepEqual(scheduleRows(fresh, '2026-10-05').map((row) => row.state), ['next', 'upcoming', 'upcoming']);
  assert.deepEqual(scheduleRows(fresh, '2026-11-06').map((row) => row.state), ['overdue', 'upcoming', 'upcoming']);
  const partial = adapted({ balanceCents: 250_000, totalPrincipalSettledCents: 50_000, activePaymentCount: 1 });
  assert.deepEqual(scheduleRows(partial, '2026-10-05').map((row) => row.state), ['partial', 'upcoming', 'upcoming']);
  const first = adapted({ balanceCents: 202_000, totalPrincipalSettledCents: 98_000, activePaymentCount: 1 });
  assert.deepEqual(scheduleRows(first, '2026-10-05').map((row) => row.state), ['amortized', 'next', 'upcoming']);
  // Valores das linhas são os do backend, sem recálculo.
  assert.deepEqual(scheduleRows(first, '2026-10-05').map((row) => row.totalCents), [103_970, 103_970, 104_081]);
  assert.equal(nextInstallment(first)?.number, 2);
  assert.deepEqual(suggestedPayment(partial), { installmentNumber: 1, principalCents: 48_000, interestCents: 5_970 });
  assert.deepEqual(suggestedPayment(first), { installmentNumber: 2, principalCents: 99_950, interestCents: 4_020 });
  const cancelled = adapted({ status: 'cancelled', overdueFrom: null });
  assert.deepEqual(scheduleRows(cancelled, '2026-10-05').map((row) => row.state), ['cancelled', 'cancelled', 'cancelled']);
  assert.equal(nextInstallment(cancelled), null);
  assert.equal(suggestedPayment(adapted({ status: 'paid', balanceCents: 0, totalPrincipalSettledCents: 300_000, overdueFrom: null })), null);
});

test('P3-H — totais: só `balanceCents`; ativo e atrasado contam; quitado e cancelado não', () => {
  assert.equal(openBalanceCents(adapted()), 300_000);
  assert.equal(openBalanceCents(adapted({ status: 'overdue' })), 300_000);
  assert.equal(openBalanceCents(adapted({ status: 'cancelled' })), 0, 'cancelado fora do saldo');
  assert.equal(openBalanceCents(adapted({ status: 'paid', balanceCents: 0, totalPrincipalSettledCents: 300_000 })), 0);
  assert.deepEqual(['active', 'overdue', 'paid', 'cancelled'].map((status) => isOpenLoan({ status } as Loan)),
    [true, true, false, false]);
  // Juros pagos não mexem no saldo: o progresso é do principal.
  const withInterest = adapted({ balanceCents: 200_000, totalPrincipalSettledCents: 100_000, totalInterestSettledCents: 50_000 });
  assert.equal(openBalanceCents(withInterest), 200_000);
  assert.equal(principalProgressPercent(withInterest), 33);
  assert.equal(interestLabel(adapted().interest), '1,99% ao mês · Tabela Price');
  assert.match(interestLabel({ type: 'fixed', totalInterestCents: 15_000 }), /^Juros fixos de R\$\s150,00$/);
  assert.equal(interestLabel({ type: 'none' }), 'Sem juros');
});

test('P3-H — permissões visuais: owner/admin tudo; member só o que criou; viewer só lê', () => {
  const loan = adapted();
  const payment = { kind: 'payment', reversedBy: null } as LoanMovement;
  const reversed = { kind: 'payment', reversedBy: 'lmv_r' } as LoanMovement;
  const disbursement = { kind: 'disbursement', reversedBy: null } as LoanMovement;
  for (const role of ['owner', 'admin'] as const) {
    const permissions = loanPermissions({ role, uid: 'outro' }, loan);
    assert.deepEqual([permissions.canCreate, permissions.canManage, permissions.canPay,
      permissions.canCancel, permissions.canEditMetadata], [true, true, true, true, true], role);
    assert.equal(permissions.canReverse(payment), true);
    assert.equal(permissions.canReverse(reversed), false, 'já estornado não oferece novo estorno');
    assert.equal(permissions.canReverse(disbursement), false, 'contratação se desfaz por cancelamento');
  }
  const own = loanPermissions({ role: 'member', uid: 'uid-member' }, loan);
  assert.equal(own.canManage && own.canPay && own.canCancel && own.canEditMetadata, true);
  const foreign = loanPermissions({ role: 'member', uid: 'uid-outro' }, loan);
  assert.deepEqual([foreign.canCreate, foreign.canManage, foreign.canPay, foreign.canCancel,
    foreign.canEditMetadata, foreign.canReverse(payment)], [true, false, false, false, false, false]);
  const viewer = loanPermissions({ role: 'viewer', uid: 'uid-member' }, loan);
  assert.deepEqual([viewer.canCreate, viewer.canManage, viewer.canPay, viewer.canReverse(payment)],
    [false, false, false, false]);
  const unknown = loanPermissions({ role: null, uid: null }, loan);
  assert.equal(unknown.canCreate || unknown.canManage, false);
  const cancelled = loanPermissions({ role: 'owner', uid: 'x' }, adapted({ status: 'cancelled', overdueFrom: null }));
  assert.deepEqual([cancelled.canPay, cancelled.canCancel, cancelled.canReverse(payment)], [false, false, false]);
  const paid = loanPermissions({ role: 'owner', uid: 'x' },
    adapted({ status: 'paid', balanceCents: 0, totalPrincipalSettledCents: 300_000, overdueFrom: null }));
  assert.deepEqual([paid.canPay, paid.canCancel, paid.canReverse(payment)], [false, true, true]);
});

test('P3-H — histórico: rótulos por natureza e relação de estorno', () => {
  const base = { reversedBy: null, reversalOf: null } as unknown as LoanMovement;
  assert.equal(movementLabel({ ...base, kind: 'disbursement' }, 'borrow'), 'Contratação (principal recebido)');
  assert.equal(movementLabel({ ...base, kind: 'payment' }, 'borrow'), 'Pagamento');
  assert.equal(movementLabel({ ...base, kind: 'payment' }, 'lend'), 'Recebimento');
  assert.equal(movementLabel({ ...base, kind: 'reversal', originalKind: 'payment' }, 'lend'), 'Estorno de recebimento');
  assert.equal(movementLabel({ ...base, kind: 'reversal', originalKind: 'disbursement' }, 'borrow'), 'Cancelamento do contrato');
  assert.equal(movementStateLabel({ ...base, kind: 'payment', reversedBy: 'lmv_r' }), 'Estornado');
  assert.equal(movementStateLabel({ ...base, kind: 'disbursement', reversedBy: 'lmv_c' }), 'Compensado pelo cancelamento');
  assert.equal(movementStateLabel({ ...base, kind: 'reversal' }), 'Compensação');
  assert.equal(movementStateLabel({ ...base, kind: 'payment' }), 'Ativo');
});

test('P3-H — callables: cinco nomes, chave de idempotência anexada ao payload', async () => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const callables = createLoanCallables(async (name, payload) => {
    calls.push([name, payload]);
    return { loanId: 'loan_1', replayed: false } as never;
  });
  assert.deepEqual([...LOAN_CALLABLES].sort(), Object.keys(callables).sort());
  await callables.registerLoanPayment({ loanId: 'loan_1', principalCents: 1 }, 'chave-0001');
  assert.deepEqual(calls[0], ['registerLoanPayment', { loanId: 'loan_1', principalCents: 1, idempotencyKey: 'chave-0001' }]);
});

test('P3-H — erros do backend em pt-BR; recarga quando o estado do servidor mudou', () => {
  assert.deepEqual(loanErrorView(new LoanInputError('Informe o motivo.')),
    { kind: 'validation', message: 'Informe o motivo.', refresh: false });
  assert.deepEqual(loanErrorView({ code: 'functions/aborted', message: 'Este empréstimo foi alterado por outra operação depois que você o abriu. Atualize e tente novamente.' }).refresh, true);
  assert.equal(loanErrorView({ code: 'functions/permission-denied', message: 'Membros só podem administrar os empréstimos que registraram.' }).message,
    'Membros só podem administrar os empréstimos que registraram.');
  assert.equal(loanErrorView({ code: 'functions/invalid-argument', message: 'x', details: { issues: [{ message: 'Principal: centavos inteiros.' }] } }).message,
    'Principal: centavos inteiros.');
  assert.equal(loanErrorView({ code: 'functions/internal', message: 'internal' }).kind, 'uncertain');
  assert.match(loanErrorView({ code: 'functions/unavailable', message: 'unavailable' }).message, /não duplica/);
  assert.equal(loanErrorView({ code: 'functions/failed-precondition', message: 'Este movimento já foi estornado.' }).refresh, true);
});

test('P3-H — espelho de empréstimo: no saldo, fora de receita/despesa (dashboard e relatórios)', () => {
  const mirror = (type: 'receita' | 'despesa', value: number): Transaction => ({
    id: `m-${type}`, type, description: 'Empréstimo', category: 'Empréstimos', value, date: '2026-10-05',
    isPaid: true, loanEntry: { loanId: 'loan_1', loanMovementId: 'lmv_1', kind: 'disbursement' },
  } as Transaction);
  const plain: Transaction = { id: 'p', type: 'receita', description: 'Salário', category: 'Salário', value: 1000, date: '2026-10-05', isPaid: true } as Transaction;
  assert.equal(isOperationalIncome(mirror('receita', 3000)), false);
  assert.equal(isOperationalExpense(mirror('despesa', 3000)), false);
  assert.equal(isOperationalIncome(plain), true);
  assert.equal(transactionCashImpact(mirror('receita', 3000)), 3000, 'o principal move o caixa');
  const summary = summarizeCashFlow([mirror('receita', 3000), mirror('despesa', 1100), plain]);
  assert.equal(summary.income, 1000);
  assert.equal(summary.expenses, 0);
  assert.equal(summary.balance, 1000 + 3000 - 1100);
});
