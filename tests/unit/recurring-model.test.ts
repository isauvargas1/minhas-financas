import assert from 'node:assert/strict';
import test from 'node:test';

import {
  toAmountChange,
  toCardFactState,
  toCashFactState,
  toRecurringExpense,
  toRecurringOccurrence,
} from '../../src/modules/recurring/adapters.ts';
import { RECURRING_CALLABLES, createRecurringCallables } from '../../src/modules/recurring/callables.ts';
import {
  RecurringInputError,
  actualAmountToCents,
  amountInputToCents,
  centsToNumberInput,
  emptyForm,
  formFromExpense,
  monthlyEstimateCents,
  toContractFields,
  toUpdateChanges,
} from '../../src/modules/recurring/payloads.ts';
import {
  ATTENTION_MESSAGES,
  FREQUENCY_LABELS,
  OCCURRENCE_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  RECURRING_STATUS_LABELS,
  executionModeExplanation,
  factStateLabel,
  formatDayLong,
  formatDayShort,
  recurringErrorView,
  recurringPermissions,
} from '../../src/modules/recurring/presentation.ts';
import { isManualCashEntryCandidate } from '../../src/modules/transactions/cashEntry.ts';

/**
 * P4-B — modelo de Recorrentes no frontend: formulário → contrato em
 * centavos (sem ponto flutuante), leitura estrita do formato autoritativo,
 * permissões iguais às do backend e textos em pt-BR.
 */
const timestamp = { seconds: 1_790_000_000, nanoseconds: 120_000_000 };

const stored = (overrides: Record<string, unknown> = {}) => ({
  id: 'rec_1', schemaVersion: 1, workspaceId: 'ws', name: 'Internet', type: 'fixed_bill',
  description: null, amountCents: 9_990, currency: 'BRL', frequency: 'monthly', billingDay: 10,
  startDate: '2026-01-10', endDate: null, paymentMethod: 'pix', executionMode: 'automatic',
  cardId: null, cashAccountId: 'acc_1', categoryId: 'cat_utilidades', category: 'Utilidades',
  status: 'active',
  nextDueDate: '2026-11-10', lastProcessedDueDate: '2026-10-10', openOccurrenceCount: 1,
  visual: { color: '#4f46e5', icon: 'Bolt', emoji: null }, business: null, createdBy: 'uid-1',
  revision: 3, updatedAt: timestamp, ...overrides,
});

test('P4-B — valor digitado vira centavos inteiros por texto, nunca por ponto flutuante', () => {
  assert.equal(amountInputToCents('49.90'), 4_990);
  assert.equal(amountInputToCents('0.1'), 10);
  assert.equal(amountInputToCents('1234'), 123_400);
  for (const bad of ['', '0', '12.345', '1,50', '-1', 'abc', '1e3', 'NaN']) {
    assert.equal(amountInputToCents(bad), null, bad);
  }
  assert.equal(centsToNumberInput(4_990), '49.90');
  assert.equal(centsToNumberInput(5), '0.05');
  assert.throws(() => actualAmountToCents('0'), RecurringInputError);
  // Estimativa mensal em centavos inteiros (exibição).
  assert.equal(monthlyEstimateCents({ amountCents: 1_000, frequency: 'weekly' }), 4_000);
  assert.equal(monthlyEstimateCents({ amountCents: 1_000, frequency: 'quarterly' }), 333);
  assert.equal(monthlyEstimateCents({ amountCents: 12_000, frequency: 'annual' }), 1_000);
  assert.ok(Number.isSafeInteger(monthlyEstimateCents({ amountCents: 9_999, frequency: 'semiannual' })));
});

test('P4-B — formulário → contrato: modo explícito, dia só nas mensais, destino pela forma', () => {
  const form = { ...emptyForm(false, '2026-10-06', { color: '#E50914', icon: 'Bolt' }),
    name: '  Netflix ', amount: '55.90', cardId: 'card-1', categoryId: 'cat_rec' };
  assert.equal(form.executionMode, 'automatic');
  assert.equal(form.billingDay, '6');
  const card = toContractFields(form, false);
  assert.equal(card.amountCents, 5_590);
  assert.equal(card.name, 'Netflix');
  assert.equal(card.executionMode, 'automatic');
  assert.equal(card.cardId, 'card-1');
  assert.equal(card.cashAccountId, null);
  assert.equal(card.billingDay, 6);
  assert.equal(card.business, null);
  assert.equal(card.categoryId, 'cat_rec');
  assert.equal('category' in card, false);
  assert.throws(() => toContractFields({ ...form, categoryId: '  ' }, false), /Categoria: valor obrigatório\./);
  assert.equal('source' in card, false);
  assert.equal('status' in card, false);
  const weekly = toContractFields({ ...form, frequency: 'weekly', billingDay: '31' }, false);
  assert.equal(weekly.billingDay, null);
  const cash = toContractFields({ ...form, paymentMethod: 'pix', cashAccountId: 'acc-1',
    executionMode: 'confirmation_required' }, false);
  assert.equal(cash.cardId, null);
  assert.equal(cash.cashAccountId, 'acc-1');
  assert.equal(cash.executionMode, 'confirmation_required');
  const pj = toContractFields({ ...form, supplier: 'AWS', costCenter: ' TI ' }, true);
  assert.deepEqual(pj.business, { supplier: 'AWS', businessType: 'saas', costCenter: 'TI',
    responsible: null, adjustmentDate: null, commitment: null });
  for (const [label, bad] of [
    ['sem nome', { ...form, name: ' ' }],
    ['valor inválido', { ...form, amount: '1,99' }],
    ['dia 0', { ...form, billingDay: '0' }],
    ['dia 32', { ...form, billingDay: '32' }],
    ['término antes do início', { ...form, endDate: '2026-01-01' }],
    ['cartão sem cartão', { ...form, cardId: '' }],
    ['caixa sem conta', { ...form, paymentMethod: 'boleto', cashAccountId: '' }],
  ] as const) {
    assert.throws(() => toContractFields(bad, false), RecurringInputError, label);
  }
});

test('P4-B — edição envia só o que mudou; sem mudança, recusa', () => {
  const expense = toRecurringExpense('rec_1', stored());
  assert.ok(expense);
  const form = formFromExpense(expense);
  assert.equal(form.amount, '99.90');
  assert.throws(() => toUpdateChanges(expense, form, false), /Nenhuma alteração/);
  assert.deepEqual(toUpdateChanges(expense, { ...form, amount: '120.00' }, false), { amountCents: 12_000 });
  assert.deepEqual(toUpdateChanges(expense, { ...form, frequency: 'weekly' }, false),
    { frequency: 'weekly', billingDay: null });
});

test('P4-B — leitura estrita: formato antigo e incoerente não aparecem', () => {
  const expense = toRecurringExpense('rec_1', stored());
  assert.equal(expense?.amountCents, 9_990);
  assert.equal(expense?.version, '2026-09-21T14:13:20.120000000Z');
  for (const [label, data] of [
    ['legado', { id: 'rec_1', nome: 'X', valorPadrao: 49.9, periodo: 'mensal', status: 'ativo' }],
    ['reais', stored({ amountCents: 99.9 })],
    ['status antigo', stored({ status: 'ativo' })],
    ['frequência antiga', stored({ frequency: 'mensal' })],
    ['semanal com dia', stored({ frequency: 'weekly' })],
    ['sem versão', stored({ updatedAt: null })],
    ['outro id', stored({ id: 'rec_2' })],
  ] as const) {
    assert.equal(toRecurringExpense('rec_1', data as Record<string, unknown>), null, label);
  }
  const occurrence = {
    id: 'rocc_1', schemaVersion: 1, recurringExpenseId: 'rec_1', dueDate: '2026-10-10',
    competenceMonth: '2026-10', plannedAmountCents: 9_990, actualAmountCents: null,
    status: 'awaiting_confirmation', targetDomain: 'cash', executionMode: 'confirmation_required',
    cardId: null, cashAccountId: 'acc_1', cashTransactionId: null, cardPurchaseId: null,
    attentionCode: null, settlement: null,
  };
  assert.equal(toRecurringOccurrence('rocc_1', occurrence)?.status, 'awaiting_confirmation');
  assert.equal(toRecurringOccurrence('rocc_1', { ...occurrence, competencia: '2026-10',
    competenceMonth: '2026-09' }), null);
  assert.equal(toRecurringOccurrence('rocc_1', { ...occurrence, status: 'pago' }), null);
  // Histórico de valor só dos eventos com `amountChanged`.
  const change = toAmountChange('evt', { schemaVersion: 1, amountChanged: true, reason: 'Reajuste',
    occurredAt: { seconds: 1_790_000_000 }, before: { amountCents: 9_990 }, after: { amountCents: 12_990 } });
  assert.deepEqual(change, { id: 'evt', date: '2026-09-21', previousCents: 9_990, nextCents: 12_990,
    reason: 'Reajuste' });
  assert.equal(toAmountChange('evt', { schemaVersion: 1, amountChanged: false,
    occurredAt: { seconds: 1 }, after: { amountCents: 1 } }), null);
  // Estado do fato gerado vem do domínio de destino.
  assert.deepEqual(toCashFactState({ valueCents: 9_990, cashEntry: { origin: 'recurring', status: 'pending' } }),
    { domain: 'cash', status: 'pending', amountCents: 9_990 });
  assert.equal(toCashFactState({ valueCents: 9_990, cashEntry: { origin: 'manual', status: 'pending' } }), null);
  assert.deepEqual(toCardFactState({ source: 'recurring', totalCents: 5_000, status: 'refunded' }),
    { domain: 'card', status: 'refunded', amountCents: 5_000 });
});

test('P4-B — permissões iguais às do backend', () => {
  const own = { createdBy: 'uid-m' };
  assert.deepEqual(recurringPermissions('owner', 'uid-o', own), { canCreate: true, canManage: true });
  assert.deepEqual(recurringPermissions('admin', 'uid-a', own), { canCreate: true, canManage: true });
  assert.deepEqual(recurringPermissions('member', 'uid-m', own), { canCreate: true, canManage: true });
  assert.deepEqual(recurringPermissions('member', 'uid-x', own), { canCreate: true, canManage: false });
  assert.deepEqual(recurringPermissions('viewer', 'uid-m', own), { canCreate: false, canManage: false });
  assert.deepEqual(recurringPermissions(null, null, own), { canCreate: false, canManage: false });
});

test('P4-B — textos em pt-BR, sem identificadores internos', () => {
  const texts = [
    ...Object.values(RECURRING_STATUS_LABELS), ...Object.values(FREQUENCY_LABELS),
    ...Object.values(PAYMENT_METHOD_LABELS), ...Object.values(OCCURRENCE_STATUS_LABELS),
    ...Object.values(ATTENTION_MESSAGES),
    executionModeExplanation('automatic', 'credit_card'),
    executionModeExplanation('automatic', 'pix'),
    executionModeExplanation('confirmation_required', 'boleto'),
    factStateLabel({ domain: 'cash', status: 'confirmed', amountCents: 1 }),
    factStateLabel({ domain: 'card', status: 'cancelled', amountCents: 1 }),
  ];
  for (const text of texts) {
    assert.doesNotMatch(text, /\b(active|paused|ended|cancelled|weekly|monthly|credit_card|pix_|awaiting_confirmation|attention_required|undefined|null)\b/,
      text);
  }
  assert.match(executionModeExplanation('automatic', 'pix'), /não é pagamento/);
  assert.match(executionModeExplanation('automatic', 'credit_card'), /compra no cartão/);
  assert.equal(formatDayShort('2026-10-06'), '6 de out.');
  assert.equal(formatDayLong('2026-02-28'), '28 de fev. de 2026');
  assert.equal(formatDayShort(null), '-');
  assert.equal(recurringErrorView(new RecurringInputError('Valor previsto: inválido.')).message,
    'Valor previsto: inválido.');
});

test('P4-B — callables recebem a chave da intenção e nada autoritativo extra', async () => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const callables = createRecurringCallables(async (name, payload) => {
    calls.push([name, payload]);
    return { recurringExpenseId: 'rec_1', replayed: false } as never;
  });
  assert.deepEqual(Object.keys(callables).sort(), [...RECURRING_CALLABLES].sort());
  await callables.confirmRecurringOccurrence({ workspaceId: 'ws', occurrenceId: 'rocc_1', settlement: 'pending' },
    'chave-intencao-1');
  assert.deepEqual(calls[0], ['confirmRecurringOccurrence', { workspaceId: 'ws', occurrenceId: 'rocc_1',
    settlement: 'pending', idempotencyKey: 'chave-intencao-1' }]);
});

test('P4-B — o lançamento gerado por Recorrentes é do Caixa (pagar é a confirmação)', () => {
  const generated = {
    type: 'despesa', isPaid: false, valueCents: 9_990, userId: 'uid-m',
    cashEntry: { origin: 'recurring', status: 'pending' },
    recurringEntry: { domainVersion: 1, recurringExpenseId: 'rec_1', occurrenceId: 'rocc_1' },
  };
  assert.equal(isManualCashEntryCandidate(generated), true);
  // O formato da geração anterior continua fora.
  assert.equal(isManualCashEntryCandidate({ type: 'despesa', isPaid: false, value: 49.9, source: 'recurring',
    userId: 'system:recurring-expenses' }), false);
});
