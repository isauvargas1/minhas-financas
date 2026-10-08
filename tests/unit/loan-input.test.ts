import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LOAN_MAX_CENTS,
  LOAN_MAX_RATE_PPM,
  addMonthsToDayKey,
  centsToInput,
  formatCents,
  formatDayKey,
  formatRatePpm,
  parseBrlToCents,
  parsePercentToRatePpm,
} from '../../src/modules/loans/money.ts';
import {
  LoanInputError,
  METADATA_UNCHANGED_MESSAGE,
  emptyLoanCreateForm,
  metadataFormOf,
  normalizeCnpjCpf,
  toCancelPayload,
  toCreateLoanPayload,
  toMetadataPayload,
  toPaymentPayload,
  toReversePayload,
  type LoanCreateForm,
} from '../../src/modules/loans/payloads.ts';
import type { Loan, LoanMovement } from '../../src/modules/loans/types.ts';

/**
 * P3-H — conversões e payloads do frontend de empréstimos: texto em reais →
 * centavos inteiros, percentual → partes por milhão, sem ponto flutuante e
 * sem arredondamento silencioso; nenhum campo autoritativo sai do cliente.
 */

test('P3-H — BRL textual → centavos: separador brasileiro, limites e recusas', () => {
  const accepted: Array<[string, number]> = [
    ['1', 100], ['1,5', 150], ['1,50', 150], ['0,01', 1], ['1.234,56', 123_456],
    ['1234,56', 123_456], ['R$ 1.234,56', 123_456], ['R$1.000.000,00', 100_000_000],
    ['  10,00  ', 1_000], ['1.000', 100_000], ['1.000.000.000,00', LOAN_MAX_CENTS],
    ['999.999.999,99', 99_999_999_999], ['0,10', 10],
  ];
  for (const [input, cents] of accepted) {
    assert.equal(parseBrlToCents(input), cents, input);
  }
  for (const input of [
    '', ' ', '0', '0,00', '-1', '+1', '1e3', '10.50', '10.5', '1,234', '1,2,3',
    '1.23,45', '12.3456', 'abc', 'R$', '1.000.000.000,01', '9999999999999',
    'NaN', 'Infinity', '1 000', '١٢', '10,5x',
  ]) {
    assert.equal(parseBrlToCents(input), null, input);
  }
  // Zero só quando permitido (juros ou principal do pagamento).
  assert.equal(parseBrlToCents('0', { allowZero: true }), 0);
  assert.equal(parseBrlToCents('0,00', { allowZero: true }), 0);
  assert.equal(parseBrlToCents('-0', { allowZero: true }), null);
  // Exato onde ponto flutuante erraria (0,1 + 0,2; 1.005 × 100).
  assert.equal(parseBrlToCents('0,29'), 29);
  assert.equal(parseBrlToCents('1,005'), null, 'três casas: recusa, não arredonda');
  assert.equal(parseBrlToCents('4.503.599.627,37'), null, 'acima do teto');
});

test('P3-H — percentual → ppm inteiro, quatro casas, 0 < taxa ≤ 100%', () => {
  const accepted: Array<[string, number]> = [
    ['1,99', 19_900], ['1.99', 19_900], ['12', 120_000], ['0,0001', 1],
    ['100', LOAN_MAX_RATE_PPM], ['2,5%', 25_000], ['0,5 %', 5_000], ['99,9999', 999_999],
    ['1,005', 10_050],
  ];
  for (const [input, ppm] of accepted) {
    assert.equal(parsePercentToRatePpm(input), ppm, input);
  }
  for (const input of [
    '', '0', '0,0000', '0,00001', '1,23456', '100,0001', '101', '1000', '-1',
    '1e2', 'abc', '1,2,3', ',5', '5,',
  ]) {
    assert.equal(parsePercentToRatePpm(input), null, input);
  }
  // A taxa não tem milhar: ponto é separador decimal.
  assert.equal(parsePercentToRatePpm('1.000'), 10_000);
});

test('P3-H — formatação: centavos, taxa, data civil e meses', () => {
  assert.equal(centsToInput(123_456), '1.234,56');
  assert.equal(centsToInput(5), '0,05');
  assert.equal(centsToInput(100_000_000), '1.000.000,00');
  assert.equal(centsToInput(-1), '');
  assert.match(formatCents(123_456).replace(/\s/g, ' '), /R\$\s1\.234,56/);
  assert.equal(formatRatePpm(19_900), '1,99%');
  assert.equal(formatRatePpm(120_000), '12%');
  assert.equal(formatRatePpm(1), '0,0001%');
  assert.equal(formatDayKey('2026-10-05'), '05/10/2026');
  assert.equal(formatDayKey(null), '—');
  assert.equal(addMonthsToDayKey('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonthsToDayKey('2028-01-31', 1), '2028-02-29');
  assert.equal(addMonthsToDayKey('2026-11-15', 2), '2027-01-15');
});

const TODAY = '2026-10-05';
const form = (overrides: Partial<LoanCreateForm> = {}): LoanCreateForm => ({
  ...emptyLoanCreateForm('borrow', TODAY),
  personName: 'Banco Exemplo',
  principal: '3.000,00',
  cashAccountId: 'acc_principal',
  installments: '3',
  ...overrides,
});
const pf = { workspaceId: 'ws-pf', profileType: 'PF' as const, today: TODAY };
const pj = { workspaceId: 'ws-pj', profileType: 'PJ' as const, today: TODAY };

const rejects = (fn: () => unknown, pattern: RegExp) => {
  assert.throws(fn, (error: unknown) => error instanceof LoanInputError && pattern.test(error.message));
};

test('P3-H — payload PF: termos em centavos e ppm, sem campo autoritativo nem PJ', () => {
  assert.deepEqual(toCreateLoanPayload(form(), pf), {
    workspaceId: 'ws-pf', type: 'borrow', personName: 'Banco Exemplo',
    principalCents: 300_000, cashAccountId: 'acc_principal', startDate: TODAY,
    firstDueDate: '2026-11-05', installments: 3, interest: { type: 'none' },
  });
  // P3-J (D-30): a conta do principal é obrigatória.
  rejects(() => toCreateLoanPayload(form({ cashAccountId: '' }), pf), /Conta\/carteira/);
  assert.deepEqual(toCreateLoanPayload(form({
    type: 'lend', interestType: 'fixed', fixedInterest: '150,00',
    personContact: ' contato@exemplo.com ', description: 'Reforma',
  }), pf), {
    workspaceId: 'ws-pf', type: 'lend', personName: 'Banco Exemplo',
    principalCents: 300_000, cashAccountId: 'acc_principal', startDate: TODAY,
    firstDueDate: '2026-11-05',
    installments: 3, interest: { type: 'fixed', totalInterestCents: 15_000 },
    personContact: 'contato@exemplo.com', description: 'Reforma',
  });
  for (const amortization of ['price', 'sac', 'simple'] as const) {
    for (const ratePeriod of ['monthly', 'annual'] as const) {
      assert.deepEqual(toCreateLoanPayload(form({
        interestType: 'percentage', rate: '1,99', ratePeriod, amortization,
      }), pf).interest, { type: 'percentage', ratePpm: 19_900, ratePeriod, amortization });
    }
  }
  const payload = toCreateLoanPayload(form(), pf);
  for (const forbidden of [
    'balanceCents', 'status', 'schedule', 'createdBy', 'profileType', 'loanId',
    'currentBalance', 'principalValue', 'idempotencyKey', 'counterpartyType',
    'cnpjCpf', 'classification', 'costCenter',
  ]) {
    assert.equal(forbidden in payload, false, forbidden);
  }
  rejects(() => toCreateLoanPayload(form({ costCenter: 'Matriz' }), pf), /exclusivos de espaço PJ/);
  rejects(() => toCreateLoanPayload(form({ cnpjCpf: '529.982.247-25' }), pf), /exclusivos de espaço PJ/);
});

test('P3-H — payload PJ: CNPJ/CPF válido normalizado, classificação e centro de custo', () => {
  const payload = toCreateLoanPayload(form({
    counterpartyType: 'banco', cnpjCpf: '11.222.333/0001-81',
    classification: 'capital_giro', costCenter: ' Operacional ',
    interestType: 'percentage', rate: '12', ratePeriod: 'annual', amortization: 'sac',
  }), pj);
  assert.equal(payload.cnpjCpf, '11222333000181');
  assert.equal(payload.counterpartyType, 'banco');
  assert.equal(payload.classification, 'capital_giro');
  assert.equal(payload.costCenter, 'Operacional');
  assert.equal(toCreateLoanPayload(form({ cnpjCpf: '529.982.247-25' }), pj).cnpjCpf, '52998224725');
  assert.equal('cnpjCpf' in toCreateLoanPayload(form(), pj), false, 'opcional vazio não vai');
  for (const invalid of ['11.222.333/0001-82', '529.982.247-24', '111.111.111-11', '123', '1122233300018']) {
    assert.throws(() => normalizeCnpjCpf(invalid), LoanInputError, invalid);
  }
});

test('P3-H — criação: recusas locais em pt-BR antes de chamar o backend', () => {
  rejects(() => toCreateLoanPayload(form({ personName: '  ' }), pf), /Contraparte/);
  rejects(() => toCreateLoanPayload(form({ principal: '0' }), pf), /Principal/);
  rejects(() => toCreateLoanPayload(form({ principal: '10.50' }), pf), /Principal/);
  rejects(() => toCreateLoanPayload(form({ startDate: '2026-10-06' }), pf), /não pode ser futura/);
  rejects(() => toCreateLoanPayload(form({ firstDueDate: '2026-10-04' }), pf), /anterior à contratação/);
  rejects(() => toCreateLoanPayload(form({ installments: '0' }), pf), /1 a 360/);
  rejects(() => toCreateLoanPayload(form({ installments: '361' }), pf), /1 a 360/);
  rejects(() => toCreateLoanPayload(form({ installments: '2,5' }), pf), /1 a 360/);
  rejects(() => toCreateLoanPayload(form({ principal: '0,02', installments: '3' }), pf), /1 centavo por parcela/);
  rejects(() => toCreateLoanPayload(form({ interestType: 'fixed', fixedInterest: '' }), pf), /Juros fixos/);
  rejects(() => toCreateLoanPayload(form({ interestType: 'percentage', rate: '0,00001', amortization: 'price' }), pf), /Taxa/);
  rejects(() => toCreateLoanPayload(form({ interestType: 'percentage', rate: '2', amortization: '' }), pf), /Amortização/);
  rejects(() => toCreateLoanPayload(form({ personName: 'x'.repeat(121) }), pf), /até 120/);
});

const loan = (overrides: Partial<Loan> = {}): Loan => ({
  id: 'loan_1', workspaceId: 'ws-pf', profileType: 'PF', type: 'borrow',
  personName: 'Banco', principalCents: 300_000, balanceCents: 200_000,
  totalPrincipalSettledCents: 100_000, totalInterestSettledCents: 5_000,
  activePaymentCount: 1, status: 'active', overdueFrom: '2026-12-06',
  interest: { type: 'none' }, startDate: '2026-09-01', firstDueDate: '2026-10-01',
  installmentsCount: 3, schedule: [], scheduledInterestCents: 0,
  maturityDate: '2026-12-01', createdBy: 'uid-member',
  version: '2026-10-05T12:00:00.123456789Z', revision: 3,
  ...overrides,
});

test('P3-H — pagamento: principal e juros separados, versão integral, validações locais', () => {
  const context = { workspaceId: 'ws-pf', loan: loan(), today: TODAY };
  assert.deepEqual(toPaymentPayload({ principal: '1.000,00', interest: '100,00', date: TODAY, cashAccountId: 'acc_principal' }, context), {
    workspaceId: 'ws-pf', loanId: 'loan_1', expectedUpdatedAt: '2026-10-05T12:00:00.123456789Z',
    cashAccountId: 'acc_principal', date: TODAY, principalCents: 100_000, interestCents: 10_000,
  });
  rejects(() => toPaymentPayload({ principal: '1,00', interest: '0', date: TODAY, cashAccountId: ' ' }, context),
    /Conta\/carteira/);
  assert.equal(toPaymentPayload({ principal: '', interest: '50,00', date: TODAY, cashAccountId: 'acc_principal' }, context).principalCents, 0, 'só juros');
  assert.equal(toPaymentPayload({ principal: '2.000,00', interest: '0', date: TODAY, cashAccountId: 'acc_principal' }, context).principalCents, 200_000, 'quitação');
  rejects(() => toPaymentPayload({ principal: '0', interest: '0', date: TODAY, cashAccountId: 'acc_principal' }, context), /maior que zero/);
  rejects(() => toPaymentPayload({ principal: '2.000,01', interest: '0', date: TODAY, cashAccountId: 'acc_principal' }, context), /maior que o saldo/);
  rejects(() => toPaymentPayload({ principal: '1,005', interest: '0', date: TODAY, cashAccountId: 'acc_principal' }, context), /Principal/);
  rejects(() => toPaymentPayload({ principal: '1,00', interest: '0,001', date: TODAY, cashAccountId: 'acc_principal' }, context), /Juros/);
  rejects(() => toPaymentPayload({ principal: '1,00', interest: '0', date: '2026-10-06', cashAccountId: 'acc_principal' }, context), /futura/);
  rejects(() => toPaymentPayload({ principal: '1,00', interest: '0', date: '2026-08-31', cashAccountId: 'acc_principal' }, context), /anterior à contratação/);
  const payload = toPaymentPayload({ principal: '1,00', interest: '0', date: TODAY, cashAccountId: 'acc_principal' }, context);
  for (const forbidden of ['balanceCents', 'status', 'amountCents', 'totalCents', 'idempotencyKey']) {
    assert.equal(forbidden in payload, false, forbidden);
  }
});

test('P3-H — estorno e cancelamento exigem motivo; metadados enviam só o que mudou', () => {
  const movement = { id: 'lmv_1' } as LoanMovement;
  assert.deepEqual(toReversePayload({ workspaceId: 'ws-pf', loan: loan(), movement, reason: ' Duplicado ' }), {
    workspaceId: 'ws-pf', loanId: 'loan_1', movementId: 'lmv_1',
    expectedUpdatedAt: '2026-10-05T12:00:00.123456789Z', reason: 'Duplicado',
  });
  rejects(() => toReversePayload({ workspaceId: 'ws-pf', loan: loan(), movement, reason: '  ' }), /motivo/);
  rejects(() => toCancelPayload({ workspaceId: 'ws-pf', loan: loan(), reason: 'x'.repeat(301) }), /até 300/);
  assert.equal(toCancelPayload({ workspaceId: 'ws-pf', loan: loan(), reason: 'Engano' }).reason, 'Engano');

  const base = loan({ personContact: 'antigo@exemplo.com', description: 'Giro' });
  rejects(() => toMetadataPayload(metadataFormOf(base), { workspaceId: 'ws-pf', loan: base }),
    new RegExp(METADATA_UNCHANGED_MESSAGE));
  assert.deepEqual(toMetadataPayload({ ...metadataFormOf(base), personContact: '', description: 'Giro novo' },
    { workspaceId: 'ws-pf', loan: base }).changes, { personContact: null, description: 'Giro novo' });
  rejects(() => toMetadataPayload({ ...metadataFormOf(base), personName: '' }, { workspaceId: 'ws-pf', loan: base }), /Contraparte/);
  // PF: campos de PJ não existem no envio, mesmo se o formulário os tiver.
  assert.equal('costCenter' in (toMetadataPayload({ ...metadataFormOf(base), costCenter: 'X', description: 'Outra' },
    { workspaceId: 'ws-pf', loan: base }).changes as object), false);
  const pjLoan = loan({ profileType: 'PJ', classification: 'outro', cnpjCpf: '11222333000181' });
  assert.deepEqual(toMetadataPayload({
    ...metadataFormOf(pjLoan), classification: 'capital_giro', cnpjCpf: '529.982.247-25', costCenter: 'Matriz',
  }, { workspaceId: 'ws-pj', loan: pjLoan }).changes, {
    cnpjCpf: '52998224725', classification: 'capital_giro', costCenter: 'Matriz',
  });
  const changes = toMetadataPayload({ ...metadataFormOf(pjLoan), costCenter: 'Matriz' },
    { workspaceId: 'ws-pj', loan: pjLoan }).changes as Record<string, unknown>;
  for (const forbidden of ['principalCents', 'type', 'interest', 'schedule', 'balanceCents', 'status',
    'totalPrincipalSettledCents', 'totalInterestSettledCents']) {
    assert.equal(forbidden in changes, false, forbidden);
  }
});
