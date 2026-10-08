import assert from 'node:assert/strict';
import test from 'node:test';

import {
  toCashAccount,
  toCashAccountMovement,
  toCashTransfer,
} from '../../src/modules/accounts/adapters.ts';
import {
  parseOpeningBalance,
  toAccountStatusPayload,
  toCreateCashAccountPayload,
  toCreateCashTransferPayload,
  toReverseCashTransferPayload,
  toUpdateCashAccountPayload,
} from '../../src/modules/accounts/payloads.ts';
import {
  AccountInputError,
  LEDGER_COVERAGE_NOTE,
  accountPermissions,
  accountsErrorView,
  canReverseTransfer,
  movementKindLabel,
} from '../../src/modules/accounts/presentation.ts';
import {
  ACCOUNTS_CALLABLES,
  createAccountsCallables,
} from '../../src/modules/accounts/callables.ts';
import type { CashAccount, CashTransfer } from '../../src/modules/accounts/types.ts';

/**
 * P3-J (D-30) — modelo de leitura, payloads e apresentação de contas e
 * transferências, sem SDK.
 */
const STAMP = { seconds: 1_790_000_000, nanoseconds: 123_456_789 };
const VERSION = '2026-09-21T14:13:20.123456789Z';

const accountDoc = (overrides: Record<string, unknown> = {}) => ({
  id: 'acc_1', schemaVersion: 1, workspaceId: 'ws', name: 'Carteira principal',
  accountType: 'cash', status: 'active', balanceCents: -1_250, currency: 'BRL',
  createdBy: 'uid', updatedAt: STAMP, ...overrides,
});

test('P3-J — adaptador de conta: só o formato autoritativo, saldo com sinal', () => {
  assert.deepEqual(toCashAccount('acc_1', accountDoc()), {
    id: 'acc_1', name: 'Carteira principal', accountType: 'cash', status: 'active',
    balanceCents: -1_250, version: VERSION,
  });
  for (const [label, data] of [
    ['sem marca', accountDoc({ schemaVersion: undefined })],
    ['id divergente', accountDoc({ id: 'acc_2' })],
    ['saldo em reais', accountDoc({ balanceCents: 12.5 })],
    ['tipo desconhecido', accountDoc({ accountType: 'wallet' })],
    ['estado desconhecido', accountDoc({ status: 'closed' })],
    ['moeda', accountDoc({ currency: 'USD' })],
    ['sem versão', accountDoc({ updatedAt: null })],
  ] as const) {
    assert.equal(toCashAccount('acc_1', data as Record<string, unknown>), null, label);
  }
});

test('P3-J — adaptador de movimento e de transferência', () => {
  const movement = {
    id: 'acm_1', schemaVersion: 1, accountId: 'acc_1', kind: 'transfer_out',
    amountCents: -5_000, effectiveDate: '2026-10-05', sourceDomain: 'transfer',
    sourceId: 'trf_1', reversalOf: null,
  };
  assert.equal(toCashAccountMovement('acm_1', movement)?.amountCents, -5_000);
  assert.equal(toCashAccountMovement('acm_1', { ...movement, amountCents: 0 }), null, 'zero');
  assert.equal(toCashAccountMovement('acm_1', { ...movement, kind: 'wallet' }), null);
  assert.equal(toCashAccountMovement('acm_1', { ...movement, effectiveDate: '2026-02-30' }), null);
  const transfer = {
    id: 'trf_1', schemaVersion: 1, sourceAccountId: 'acc_1', destinationAccountId: 'acc_2',
    amountCents: 5_000, date: '2026-10-05', status: 'reversed', createdBy: 'uid-m',
    updatedAt: STAMP, reversal: { reason: 'Duplicada' },
  };
  assert.deepEqual(toCashTransfer('trf_1', transfer), {
    id: 'trf_1', sourceAccountId: 'acc_1', destinationAccountId: 'acc_2', amountCents: 5_000,
    date: '2026-10-05', status: 'reversed', createdBy: 'uid-m', version: VERSION,
    reversalReason: 'Duplicada',
  });
  assert.equal(toCashTransfer('trf_1', { ...transfer, destinationAccountId: 'acc_1' }), null,
    'mesma conta nas duas pontas');
  assert.equal(toCashTransfer('trf_1', { ...transfer, amountCents: -1 }), null);
});

test('P3-J — saldo inicial: formato brasileiro com sinal, vazio é zero', () => {
  assert.equal(parseOpeningBalance(''), 0);
  assert.equal(parseOpeningBalance('1.234,56'), 123_456);
  assert.equal(parseOpeningBalance('-150,00'), -15_000);
  assert.equal(parseOpeningBalance('-0'), 0, 'sem -0');
  for (const invalid of ['10.50', '1,234', 'abc', '--1', '+1']) {
    assert.equal(parseOpeningBalance(invalid), null, invalid);
  }
});

test('P3-J — payloads de conta: nada autoritativo; zero não vira movimento', () => {
  assert.deepEqual(toCreateCashAccountPayload(
    { name: '  Banco X ', accountType: 'checking', openingBalance: '-10,00' }, 'ws'),
  { workspaceId: 'ws', name: 'Banco X', accountType: 'checking', openingBalanceCents: -1_000 });
  assert.deepEqual(toCreateCashAccountPayload(
    { name: 'Caixa', accountType: 'cash', openingBalance: '0,00' }, 'ws'),
  { workspaceId: 'ws', name: 'Caixa', accountType: 'cash' });
  assert.throws(() => toCreateCashAccountPayload({ name: ' ', accountType: 'cash' }, 'ws'), AccountInputError);
  assert.throws(() => toCreateCashAccountPayload(
    { name: 'X', accountType: 'cash', openingBalance: '1.5' }, 'ws'), /Saldo inicial/);
  const account: CashAccount = {
    id: 'acc_1', name: 'Caixa', accountType: 'cash', status: 'active', balanceCents: 0, version: VERSION,
  };
  assert.deepEqual(toUpdateCashAccountPayload({ name: 'Caixa', accountType: 'digital' }, account, 'ws'), {
    workspaceId: 'ws', accountId: 'acc_1', expectedUpdatedAt: VERSION, changes: { accountType: 'digital' },
  });
  assert.throws(() => toUpdateCashAccountPayload({ name: ' Caixa ', accountType: 'cash' }, account, 'ws'),
    /Nenhum dado foi alterado/);
  assert.deepEqual(toAccountStatusPayload(account, 'ws'),
    { workspaceId: 'ws', accountId: 'acc_1', expectedUpdatedAt: VERSION });
});

test('P3-J — payload de transferência: contas diferentes, valor positivo, data até hoje', () => {
  const form = {
    sourceAccountId: 'acc_1', destinationAccountId: 'acc_2', amount: '1.000,00',
    date: '2026-10-05', description: '  Reserva ',
  };
  assert.deepEqual(toCreateCashTransferPayload(form, 'ws', '2026-10-05'), {
    workspaceId: 'ws', sourceAccountId: 'acc_1', destinationAccountId: 'acc_2',
    amountCents: 100_000, date: '2026-10-05', description: 'Reserva',
  });
  assert.equal('description' in toCreateCashTransferPayload({ ...form, description: ' ' }, 'ws', '2026-10-05'),
    false);
  for (const [overrides, pattern] of [
    [{ destinationAccountId: 'acc_1' }, /diferente da origem/],
    [{ sourceAccountId: '' }, /origem/],
    [{ amount: '0' }, /maior que zero/],
    [{ amount: '-1,00' }, /maior que zero/],
    [{ date: '2026-10-06' }, /data futura/],
    [{ date: '2026-13-01' }, /data válida/],
  ] as const) {
    assert.throws(() => toCreateCashTransferPayload({ ...form, ...overrides }, 'ws', '2026-10-05'),
      pattern, JSON.stringify(overrides));
  }
  const transfer: CashTransfer = {
    id: 'trf_1', sourceAccountId: 'acc_1', destinationAccountId: 'acc_2', amountCents: 100_000,
    date: '2026-10-05', status: 'completed', createdBy: 'uid-m', version: VERSION,
  };
  assert.deepEqual(toReverseCashTransferPayload(transfer, ' Duplicada ', 'ws'),
    { workspaceId: 'ws', transferId: 'trf_1', expectedUpdatedAt: VERSION, reason: 'Duplicada' });
  assert.throws(() => toReverseCashTransferPayload(transfer, '  ', 'ws'), /motivo/);
});

test('P3-J — permissões: owner/admin administram, member transfere, viewer só lê', () => {
  assert.deepEqual(accountPermissions('owner'), { canManage: true, canTransfer: true });
  assert.deepEqual(accountPermissions('admin'), { canManage: true, canTransfer: true });
  assert.deepEqual(accountPermissions('member'), { canManage: false, canTransfer: true });
  assert.deepEqual(accountPermissions('viewer'), { canManage: false, canTransfer: false });
  assert.deepEqual(accountPermissions(null), { canManage: false, canTransfer: false });
  const transfer: CashTransfer = {
    id: 'trf_1', sourceAccountId: 'a', destinationAccountId: 'b', amountCents: 1,
    date: '2026-10-05', status: 'completed', createdBy: 'uid-m', version: VERSION,
  };
  assert.equal(canReverseTransfer(transfer, 'admin', 'uid-a'), true);
  assert.equal(canReverseTransfer(transfer, 'member', 'uid-m'), true, 'a própria');
  assert.equal(canReverseTransfer(transfer, 'member', 'uid-x'), false, 'a de outro');
  assert.equal(canReverseTransfer(transfer, 'viewer', 'uid-m'), false);
  assert.equal(canReverseTransfer({ ...transfer, status: 'reversed' }, 'owner', 'uid-o'), false);
});

test('P3-J — textos pt-BR, aviso de cobertura e callables por intenção', async () => {
  assert.equal(movementKindLabel({
    id: 'm', accountId: 'a', kind: 'reversal', amountCents: 1, effectiveDate: '2026-10-05',
    sourceDomain: 'transfer', sourceId: 't', reversalOf: 'x',
  }), 'Estorno de transferência');
  assert.equal(movementKindLabel({
    id: 'm', accountId: 'a', kind: 'opening_balance', amountCents: 1, effectiveDate: '2026-10-05',
    sourceDomain: 'account', sourceId: 'a', reversalOf: null,
  }), 'Saldo inicial');
  // P4-D: aporte/retirada liquidados e o estorno deles no extrato da conta.
  assert.equal(movementKindLabel({
    id: 'm', accountId: 'a', kind: 'investment', amountCents: -1, effectiveDate: '2026-10-05',
    sourceDomain: 'investment', sourceId: 'mov', reversalOf: null,
  }), 'Investimento');
  assert.equal(movementKindLabel({
    id: 'm', accountId: 'a', kind: 'reversal', amountCents: 1, effectiveDate: '2026-10-05',
    sourceDomain: 'investment', sourceId: 'mov', reversalOf: 'x',
  }), 'Estorno de investimento');
  // P4-D: todo produtor de caixa move a conta; não há exceção a anunciar.
  assert.doesNotMatch(LEDGER_COVERAGE_NOTE, /ainda não movimentam as contas/);
  assert.match(LEDGER_COVERAGE_NOTE, /aportes e retiradas de investimentos já liquidados/);
  // P4-B: a despesa recorrente paga já move a conta.
  assert.match(LEDGER_COVERAGE_NOTE, /despesas recorrentes pagas/);
  assert.doesNotMatch(LEDGER_COVERAGE_NOTE, /Recorrências/);
  assert.equal(accountsErrorView(new AccountInputError('Informe o nome.')).message, 'Informe o nome.');
  assert.equal(accountsErrorView({ code: 'functions/failed-precondition',
    message: 'Só é possível arquivar uma conta com saldo zero.' }).message,
  'Só é possível arquivar uma conta com saldo zero.');
  const calls: Array<[string, Record<string, unknown>]> = [];
  const callables = createAccountsCallables(async <T,>(name: string, payload: Record<string, unknown>) => {
    calls.push([name, payload]);
    return {} as T;
  });
  assert.deepEqual(Object.keys(callables).sort(), [...ACCOUNTS_CALLABLES].sort());
  await callables.createCashTransfer({ workspaceId: 'ws' }, 'key-1');
  assert.deepEqual(calls, [['createCashTransfer', { workspaceId: 'ws', idempotencyKey: 'key-1' }]]);
});
