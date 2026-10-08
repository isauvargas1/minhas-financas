import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CASH_CALLABLES,
  createCashCallables,
  type CashCallableName,
} from '../../src/modules/transactions/cashCallables.ts';
import {
  CashEntryInputError,
  cashErrorView,
  cashRefreshScope,
  expectedUpdatedAtOf,
  CONFIRM_ONLY_SETTLEMENT_MESSAGE,
  FUTURE_SETTLED_MESSAGE,
  isAuthoritativeCashEntry,
  isManualCashEntryCandidate,
  isPendingCashEntry,
  manualEntryStatus,
  parseDecimalAmountToCents,
  PROTECTED_LINK_KEYS,
  resolveIntentKey,
  saoPauloToday,
  toConfirmCashPayload,
  toCreateCashPayload,
  toUpdateCashPayload,
  toVoidCashPayload,
  type ManualEntryForm,
} from '../../src/modules/transactions/cashEntry.ts';
import { transactionsQuotaView } from '../../src/modules/billing/transactionsQuota.ts';
import {
  isUnsettledEntry,
  summarizeCashFlow,
  transactionCashImpactCents,
} from '../../src/modules/investments/semantics.ts';
import type { Transaction } from '../../src/types.ts';

/**
 * Adaptador do formulário para as callables de caixa (P3-E). Puro: sem SDK
 * nem Firebase. O contrato real do backend é provado pelos testes de
 * integração e pelo E2E contra o Emulator.
 */

test('P3-E — valor digitado vira centavos inteiros, sem arredondar', () => {
  const vectors: Array<[string, number]> = [
    ['1', 100],
    ['0.01', 1],
    ['0.1', 10],
    ['0.10', 10],
    ['10.5', 1050],
    ['19.99', 1999],
    ['123.45', 12345],
    ['1000000000', 100_000_000_000],
    [' 42.3 ', 4230],
  ];
  for (const [input, cents] of vectors) {
    assert.equal(parseDecimalAmountToCents(input), cents, input);
  }
  // `0.1 + 0.2` em ponto flutuante daria 30.000000000000004 centavos.
  assert.equal(parseDecimalAmountToCents('0.3'), 30);
  for (const input of [
    '', '0', '0.00', '-1', '1e3', '10.005', '1.234', '1,5', 'abc',
    '1000000000.01', '.5', '5.', 'NaN', 'Infinity',
  ]) {
    assert.equal(parseDecimalAmountToCents(input), null, input);
  }
});

test('P3-F — estado pelo formulário: pago até hoje confirma; não pago é pendente', () => {
  const today = '2026-10-04';
  assert.equal(manualEntryStatus({ date: '2026-10-04', isPaid: true }, today), 'confirmed');
  assert.equal(manualEntryStatus({ date: '2026-09-01' }, today), 'confirmed');
  // Pendente: vencido, de hoje ou agendado.
  for (const date of ['2026-09-01', '2026-10-04', '2027-01-15']) {
    assert.equal(manualEntryStatus({ date, isPaid: false }, today), 'pending', date);
  }
  // Pago com data futura nunca vira agendado sozinho.
  assert.throws(() => manualEntryStatus({ date: '2026-10-05', isPaid: true }, today),
    (error: Error) => error instanceof CashEntryInputError && error.message === FUTURE_SETTLED_MESSAGE);
  for (const date of ['2026-02-30', '']) {
    assert.throws(() => manualEntryStatus({ date, isPaid: false }, today), CashEntryInputError, date);
  }
  // Hoje no fuso do produto: 2026-10-05 02:00 UTC ainda é dia 4 em São Paulo.
  assert.equal(saoPauloToday(new Date('2026-10-05T02:00:00Z')), '2026-10-04');
});

test('P3-F — correção, confirmação e anulação: lançamento do Caixa pendente ou confirmado', () => {
  for (const origin of ['manual', 'recurring']) {
    assert.equal(isManualCashEntryCandidate({
      type: 'receita', cashEntry: { origin, status: 'confirmed' },
    }), true, origin);
    assert.equal(isManualCashEntryCandidate({
      type: 'despesa', isPaid: false, cashEntry: { origin, status: 'pending' },
    }), true, origin);
  }
  assert.equal(isPendingCashEntry({ isPaid: false }), true);
  assert.equal(isPendingCashEntry({ type: 'receita' }), false);
  assert.equal(isAuthoritativeCashEntry({ cashEntry: { origin: 'manual' } }), true);
  const marked = { type: 'despesa', cashEntry: { origin: 'manual', status: 'confirmed' } };
  // P4-D: sem a marca do Caixa não há lançamento editável — o formato do
  // caminho direto antigo do cliente (e a adoção `legacy_manual`) acabou.
  const unmarked = {
    type: 'despesa', isPaid: true, userId: 'uid', source: 'manual',
    installments: 1, currentInstallment: 1, value: 10, date: '2026-09-10',
  };
  for (const [label, entry] of [
    ['sem marca', unmarked],
    ['sem marca pendente', { ...unmarked, isPaid: false }],
    ['receita sem marca', { type: 'receita', userId: 'uid', date: '2026-10-04' }],
    ['origem legacy_manual', { type: 'despesa', cashEntry: { origin: 'legacy_manual', status: 'confirmed' } }],
    ['parcelado', { ...marked, type: 'parcelado' }],
    ['investimento', { ...marked, type: 'investimento' }],
    ['anulado', { ...marked, voidedAt: { seconds: 1 } }],
    ['anulado no backend', { type: 'receita', cashEntry: { origin: 'manual', status: 'voided' } }],
    ['origem desconhecida', { type: 'receita', cashEntry: { origin: 'x', status: 'confirmed' } }],
    ...PROTECTED_LINK_KEYS.map((key) => [key, { ...marked, [key]: 'x' }] as const),
  ] as const) {
    assert.equal(isManualCashEntryCandidate(entry), false, label);
  }
});

test('P3-E — versão lida preserva os nanossegundos do Timestamp', () => {
  assert.equal(
    expectedUpdatedAtOf({ seconds: 1_790_000_000, nanoseconds: 123_456_789 }),
    '2026-09-21T14:13:20.123456789Z',
  );
  assert.equal(
    expectedUpdatedAtOf({ seconds: 1_790_000_000, nanoseconds: 7_000 }),
    '2026-09-21T14:13:20.000007000Z',
  );
  assert.equal(expectedUpdatedAtOf(undefined), null);
  assert.equal(expectedUpdatedAtOf(null), null);
  for (const invalid of [
    '2026-09-21T14:13:20Z', 1_790_000_000, { seconds: 1 }, { seconds: 1, nanoseconds: -1 },
    { seconds: 1, nanoseconds: 1_000_000_000 }, { seconds: 1.5, nanoseconds: 0 },
  ]) {
    assert.throws(() => expectedUpdatedAtOf(invalid), CashEntryInputError, JSON.stringify(invalid));
  }
});

const form = (overrides: Partial<ManualEntryForm> = {}): ManualEntryForm => ({
  type: 'despesa',
  description: '  Mercado  ',
  category: 'Casa',
  amount: '150.5',
  date: '2026-09-10',
  expenseType: 'Variável',
  paymentMethod: '',
  incomeType: 'ignorado na despesa',
  supplier: '',
  costCenter: '  ',
  isPaid: true,
  cashAccountId: 'acc_principal',
  ...overrides,
});

test('P3-E — payload estrito: sem opcionais vazios, PJ só em PJ', () => {
  assert.deepEqual(toCreateCashPayload(form(), { workspaceId: 'ws-1', isPJ: false }), {
    workspaceId: 'ws-1',
    type: 'despesa',
    description: 'Mercado',
    category: 'Casa',
    amountCents: 15_050,
    cashAccountId: 'acc_principal',
    status: 'confirmed',
    date: '2026-09-10',
    expenseType: 'Variável',
  });
  // D-29: não pago vira pendente, com o vencimento — nunca `date` nem `isPaid`.
  assert.deepEqual(toCreateCashPayload(form({ isPaid: false, date: '2027-03-05' }), {
    workspaceId: 'ws-1', isPJ: false,
  }), {
    workspaceId: 'ws-1',
    type: 'despesa',
    description: 'Mercado',
    category: 'Casa',
    amountCents: 15_050,
    cashAccountId: 'acc_principal',
    status: 'pending',
    dueDate: '2027-03-05',
    expenseType: 'Variável',
  });
  assert.throws(
    () => toCreateCashPayload(form({ date: '2099-01-01' }), { workspaceId: 'ws', isPJ: false }),
    /não pode ter data futura/,
  );
  assert.deepEqual(toCreateCashPayload(form({
    type: 'receita', incomeType: 'Fixa', supplier: 'Cliente', costCenter: 'Loja',
  }), { workspaceId: 'ws-pj', isPJ: true }), {
    workspaceId: 'ws-pj',
    type: 'receita',
    description: 'Mercado',
    category: 'Casa',
    amountCents: 15_050,
    cashAccountId: 'acc_principal',
    status: 'confirmed',
    date: '2026-09-10',
    incomeType: 'Fixa',
    supplier: 'Cliente',
    costCenter: 'Loja',
  });
  assert.throws(
    () => toCreateCashPayload(form({ supplier: 'Fornecedor' }), { workspaceId: 'ws', isPJ: false }),
    /só podem ser informados em espaço PJ/,
  );
  assert.throws(
    () => toCreateCashPayload(form({ amount: '10.001' }), { workspaceId: 'ws', isPJ: false }),
    /no máximo duas casas decimais/,
  );
  // P3-J (D-30): sem conta escolhida, nada é enviado.
  for (const cashAccountId of ['', '   ', undefined]) {
    assert.throws(
      () => toCreateCashPayload(form({ cashAccountId }), { workspaceId: 'ws', isPJ: false }),
      /Escolha a conta ou carteira/,
    );
  }
  // Nenhuma chave de autoridade ou vínculo sai do adaptador.
  const keys = Object.keys(toCreateCashPayload(form(), { workspaceId: 'ws', isPJ: false }));
  for (const forbidden of ['userId', 'value', 'valueCents', 'isPaid', 'displaySnapshots', 'walletId', 'cardId']) {
    assert.equal(keys.includes(forbidden), false, forbidden);
  }
});

test('P3-E — correção e anulação levam versão completa e motivo', () => {
  const updatedAt = { seconds: 1_790_000_000, nanoseconds: 5 };
  assert.deepEqual(toUpdateCashPayload(form(), {
    workspaceId: 'ws', isPJ: false, transactionId: 'cash_1', updatedAt, reason: '  Valor errado ',
  }), {
    workspaceId: 'ws',
    transactionId: 'cash_1',
    expectedUpdatedAt: '2026-09-21T14:13:20.000000005Z',
    reason: 'Valor errado',
    entry: {
      type: 'despesa', description: 'Mercado', category: 'Casa',
      amountCents: 15_050, cashAccountId: 'acc_principal', status: 'confirmed',
      date: '2026-09-10', expenseType: 'Variável',
    },
  });
  // Correção do pendente: vencimento novo, estado pendente.
  assert.deepEqual((toUpdateCashPayload(form({ isPaid: false, date: '2027-02-01' }), {
    workspaceId: 'ws', isPJ: false, transactionId: 'cash_1', updatedAt, reason: 'Novo vencimento',
  }).entry as Record<string, unknown>), {
    type: 'despesa', description: 'Mercado', category: 'Casa',
    amountCents: 15_050, cashAccountId: 'acc_principal', status: 'pending',
    dueDate: '2027-02-01', expenseType: 'Variável',
  });
  assert.deepEqual(toVoidCashPayload({
    workspaceId: 'ws', transactionId: 'cash_1', updatedAt: null, reason: 'Duplicado',
  }), {
    workspaceId: 'ws', transactionId: 'cash_1', expectedUpdatedAt: null, reason: 'Duplicado',
  });
  for (const reason of ['', '   ', 'x'.repeat(301)]) {
    assert.throws(() => toVoidCashPayload({
      workspaceId: 'ws', transactionId: 'c', updatedAt: null, reason,
    }), CashEntryInputError);
  }
});

test('P3-F — confirmação: data efetiva e valor liquidado; nada descartado em silêncio', () => {
  const updatedAt = { seconds: 1_790_000_000, nanoseconds: 42 };
  const stored = {
    type: 'despesa', description: 'Mercado', category: 'Casa',
    expenseType: 'Variável', paymentMethod: 'Boleto', isPaid: false,
    dueDate: '2026-10-10', date: '2026-10-10',
  };
  const context = {
    workspaceId: 'ws', isPJ: false, transactionId: 'cash_9', updatedAt, stored,
  };
  const settle = form({ isPaid: true, date: '2026-10-03', amount: '152.75', paymentMethod: 'Pix' });
  assert.deepEqual(toConfirmCashPayload(settle, context, '2026-10-04'), {
    workspaceId: 'ws',
    transactionId: 'cash_9',
    expectedUpdatedAt: '2026-09-21T14:13:20.000000042Z',
    date: '2026-10-03',
    amountCents: 15_275,
    paymentMethod: 'Pix',
    cashAccountId: 'acc_principal',
  });
  // A conta da liquidação pode ser outra que a registrada (D-30).
  assert.equal(toConfirmCashPayload({ ...settle, cashAccountId: 'acc_outra' }, context,
    '2026-10-04').cashAccountId, 'acc_outra');
  // Receita não leva forma de pagamento.
  const income = toConfirmCashPayload(
    form({ type: 'receita', incomeType: '', isPaid: true, date: '2026-10-04' }),
    { ...context, stored: { ...stored, type: 'receita', expenseType: undefined } },
    '2026-10-04',
  );
  assert.equal('paymentMethod' in income, false);
  // Liquidação futura não é fato.
  assert.throws(() => toConfirmCashPayload(form({ date: '2026-10-05' }), context, '2026-10-04'),
    /não pode ter data futura/);
  // Mudou descrição ou categoria junto: correção primeiro, confirmação depois.
  for (const changed of [{ description: 'Outra' }, { category: 'Lazer' }, { expenseType: 'Fixa' }]) {
    assert.throws(
      () => toConfirmCashPayload(form({ ...changed, date: '2026-10-03' }), context, '2026-10-04'),
      (error: Error) => error.message === CONFIRM_ONLY_SETTLEMENT_MESSAGE,
      JSON.stringify(changed),
    );
  }
});

test('P3-E — chave por intenção: reenvio reusa, conteúdo novo renova', () => {
  let counter = 0;
  const generate = () => `key-${++counter}`;
  const payload = { workspaceId: 'ws', amountCents: 100 };
  const first = resolveIntentKey(null, 'createCashTransaction', payload, generate);
  const retry = resolveIntentKey(first, 'createCashTransaction', { amountCents: 100, workspaceId: 'ws' }, generate);
  assert.equal(retry.key, first.key, 'mesma intenção, mesma chave');
  const changed = resolveIntentKey(first, 'createCashTransaction', { ...payload, amountCents: 101 }, generate);
  assert.notEqual(changed.key, first.key);
  const otherOperation = resolveIntentKey(first, 'updateCashTransaction', payload, generate);
  assert.notEqual(otherOperation.key, first.key);
  assert.equal(counter, 3);
});

test('P3-E — erros do backend viram orientação em pt-BR', () => {
  const error = (code: string, message: string, details?: unknown) => ({
    code: `functions/${code}`, message, details,
  });
  assert.deepEqual(cashErrorView(error('aborted', 'Este lançamento foi alterado por outra operação depois que você o abriu. Atualize e tente novamente.')), {
    kind: 'conflict',
    message: 'Este lançamento foi alterado por outra operação depois que você o abriu. Atualize e tente novamente.',
  });
  assert.equal(cashErrorView(error('invalid-argument', 'Dados inválidos.', {
    issues: [{ path: ['amountCents'], message: 'Valor: centavos inteiros.' }],
  })).message, 'Valor: centavos inteiros.');
  assert.equal(cashErrorView(error('permission-denied', 'Você não tem acesso a este espaço.')).kind, 'forbidden');
  assert.equal(cashErrorView(error('resource-exhausted', 'Limite atingido.')).kind, 'quota');
  assert.equal(cashErrorView(error('failed-precondition', 'Lançamento anulado não pode ser alterado nem reativado.')).kind, 'voided');
  assert.match(cashErrorView(error('failed-precondition', 'x', { ineligible: 'linked_to_other_domain' })).message, /outro módulo/);
  assert.match(cashErrorView(error('failed-precondition', 'x', { ineligible: 'ambiguous_value' })).message, /formato que não pode ser corrigido/);
  assert.equal(cashErrorView(error('failed-precondition', 'Esta chave de idempotência já foi usada com outros dados.')).kind, 'idempotency');
  // P3-F: confirmação repetida, transição recusada e janela de manutenção
  // chegam com a mensagem pt-BR do backend, sem código nem detalhe interno.
  for (const [message, details] of [
    ['Este lançamento já está confirmado.', { transition: 'confirmed_to_confirmed' }],
    ['Os lançamentos deste espaço estão temporariamente bloqueados para manutenção. Tente novamente mais tarde.', { ledgerFrozen: true }],
  ] as const) {
    const view = cashErrorView(error('failed-precondition', message, details));
    assert.deepEqual(view, { kind: 'validation', message });
    assert.equal(cashRefreshScope(error('failed-precondition', message, details)), 'state');
  }
  assert.equal(cashErrorView(error('unauthenticated', 'x')).kind, 'session');
  // Resultado incerto (rede, timeout): orienta a reenviar o mesmo conteúdo.
  for (const uncertain of [new Error('Failed to fetch'), error('unavailable', 'x'), error('deadline-exceeded', 'x')]) {
    const view = cashErrorView(uncertain);
    assert.equal(view.kind, 'uncertain');
    assert.match(view.message, /não duplica/);
  }
  // Sem corpo de erro do servidor, o SDK põe o código ou um texto em inglês
  // na mensagem: isso nunca chega à interface.
  for (const sdkOnly of [
    error('internal', 'internal'),
    error('internal', 'Response is not valid JSON object.'),
    error('internal', 'Response is missing data field.'),
  ]) {
    const view = cashErrorView(sdkOnly);
    assert.equal(view.kind, 'uncertain');
    assert.match(view.message, /não duplica/);
  }
  // `internal` com mensagem do backend (pt-BR) é mantida.
  assert.equal(cashErrorView(error('internal', 'Falha interna ao gravar.')).message, 'Falha interna ao gravar.');
  for (const [code, pattern] of [
    ['permission-denied', /não tem permissão/],
    ['resource-exhausted', /limite desta operação/],
    ['failed-precondition', /estado atual/],
    ['invalid-argument', /Revise os dados/],
    ['aborted', /alterado por outra operação/],
  ] as const) {
    const view = cashErrorView(error(code, code));
    assert.match(view.message, pattern, code);
    assert.doesNotMatch(view.message, new RegExp(`^${code}$`), code);
  }
});

test('P3-E — falha só recarrega o que o servidor pode ter mudado', () => {
  const error = (code: string, message = 'Mensagem do servidor.', details?: unknown) => ({
    code: `functions/${code}`, message, details,
  });
  // Estado possivelmente diferente do exibido: lista, dependentes e quota.
  for (const stale of [
    error('aborted'),
    error('not-found'),
    error('failed-precondition', 'Lançamento anulado não pode ser alterado nem reativado.'),
    error('failed-precondition', 'x', { ineligible: 'linked_to_other_domain' }),
    error('failed-precondition', 'Esta chave de idempotência já foi usada com outros dados.'),
    error('unavailable'),
    error('internal', 'internal'),
    new Error('Failed to fetch'),
  ]) {
    assert.equal(cashRefreshScope(stale), 'state', JSON.stringify(stale));
  }
  // Quota esgotada: só o indicador.
  assert.equal(cashRefreshScope(error('resource-exhausted')), 'quota');
  // Validação, papel e sessão: nada a recarregar.
  for (const unchanged of [
    error('invalid-argument'),
    error('permission-denied'),
    error('unauthenticated'),
    new CashEntryInputError('Informe o motivo da alteração.'),
  ]) {
    assert.equal(cashRefreshScope(unchanged), 'none');
  }
});

test('P3-E — indicador usa a quota do backend; desconhecido não bloqueia', () => {
  const entitlement = (quota: unknown) => ({
    catalogVersion: 1, planId: 'free' as const, entitlementStatus: 'free' as const,
    limits: { workspaces: 1, membersPerWorkspace: 2, transactionsPerMonth: 50, splitGroups: 2, aiCreditsPerMonth: 10 },
    transactionsQuota: quota as never,
  });
  const quota = (overrides: Record<string, unknown>) => ({
    status: 'available', periodKey: '2026-10', limit: 50, used: null, remaining: null, exhausted: false, ...overrides,
  });
  assert.deepEqual(transactionsQuotaView(null), { canCreate: true, limit: null });
  assert.equal(transactionsQuotaView(entitlement(undefined)).canCreate, true);
  assert.equal(transactionsQuotaView(entitlement(quota({ exhausted: true }))).canCreate, false);
  assert.equal(transactionsQuotaView(entitlement(quota({ exhausted: false }))).canCreate, true);
  for (const status of ['not_initialized', 'unavailable']) {
    assert.deepEqual(
      transactionsQuotaView(entitlement(quota({ status, exhausted: null }))),
      { canCreate: true, limit: 50 },
      status,
    );
  }
});

test('P3-E — cliente das callables envia a chave da intenção', async () => {
  const calls: Array<[CashCallableName, Record<string, unknown>]> = [];
  const client = createCashCallables(async <T>(name: CashCallableName, payload: Record<string, unknown>) => {
    calls.push([name, payload]);
    return { transactionId: 'cash_1', replayed: false } as T;
  });
  await client.createCashTransaction({ workspaceId: 'ws', amountCents: 1 }, 'key-1');
  await client.updateCashTransaction({ workspaceId: 'ws', transactionId: 'c' }, 'key-2');
  await client.confirmCashTransaction({ workspaceId: 'ws', transactionId: 'c' }, 'key-3');
  await client.voidCashTransaction({ workspaceId: 'ws', transactionId: 'c' }, 'key-4');
  assert.deepEqual(calls.map(([name]) => name), [...CASH_CALLABLES]);
  assert.deepEqual(calls.map(([, payload]) => payload.idempotencyKey),
    ['key-1', 'key-2', 'key-3', 'key-4']);
});

test('P3-F — caixa realizado na tela: pendente e agendado ficam fora', () => {
  const tx = (overrides: Partial<Transaction>): Transaction => ({
    id: 'x', type: 'despesa', description: 'd', category: 'c', value: 100,
    date: '2026-10-01', ...overrides,
  } as Transaction);
  const pendingExpense = tx({ isPaid: false });
  const pendingIncome = tx({ type: 'receita', isPaid: false, value: 300 });
  const paidExpense = tx({ isPaid: true, value: 40 });
  const legacyIncome = tx({ type: 'receita', value: 500 });
  const installment = tx({ type: 'parcelado', isPaid: false, value: 70 });
  assert.equal(isUnsettledEntry(pendingIncome), true);
  assert.equal(isUnsettledEntry(installment), false, 'cartões: regra própria');
  assert.equal(transactionCashImpactCents(pendingIncome), 0);
  assert.equal(transactionCashImpactCents(pendingExpense), 0);
  assert.equal(transactionCashImpactCents(legacyIncome), 50_000);
  const summary = summarizeCashFlow([
    pendingExpense, pendingIncome, paidExpense, legacyIncome, installment,
  ]);
  assert.equal(summary.income, 500, 'receita a receber não entra');
  // Parcela de cartão segue no total de despesas como antes (P4).
  assert.equal(summary.expenses, 40 + 70);
  assert.equal(summary.balance, 500 - 40);
});
