import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

import {monthPlan, type DaySpec, type WorkCalendar, type WorkRoutine} from '../../src/modules/work-time/calendar.ts';
import {DEFAULT_WEEKLY_ROUTINE} from '../../src/modules/work-time/draft.ts';
import {
  DETAILS_CALENDAR_NOT_APPLIED,
  DETAILS_EXCLUSIONS_NOT_APPLIED,
  calculationReachedMonths,
  ESTIMATE_EXCLUDED_READ_FAILED,
  ESTIMATE_REPORT_READ_FAILED,
  estimateFailureMessage,
  estimateQualifiers,
  incomeItemPresentation,
  ESTIMATE_QUALIFIER_BUSINESS,
  ESTIMATE_QUALIFIER_CURRENT_MONTH,
  ESTIMATE_QUALIFIER_PROVISIONAL,
  ESTIMATE_QUALIFIER_STALE,
} from '../../src/modules/work-time/messages.ts';
import {
  computeWorkTimeEstimate,
  estimateWindowMonths,
  extraMonthNeeded,
  type EstimateInput,
} from '../../src/modules/work-time/estimate.ts';
import {
  applyIncomeExclusions,
  buildIncomeItemViews,
  classifyIncomeDocument,
  excludedItemOf,
  isExcludableIncome,
  reconcileIncomeMonths,
  type ExcludedIncomeItem,
  type IncomeDocument,
  type IncomeItemView,
  type MonthReceipts,
} from '../../src/modules/work-time/incomeBasis.ts';
import {
  readExcludedIncome,
  receiptMovementIdOfMirror,
  reversalMirrorIdOf,
  reversalMovementIdOf,
} from '../../src/modules/work-time/receivableReversal.ts';

/*
 * P5-F.1 — base de renda e estimativa automática. A renda vem do relatório
 * oficial (`receiptsCents` por mês); o espelho do cliente só classifica
 * itens para o painel e para as exclusões, e a fixture compartilhada com o
 * backend prova que ele dá o mesmo `incomeCents` de `cashPeriodDeltaFor`.
 */

const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/cash-income-classification.json', import.meta.url), 'utf8'),
) as {cases: Array<{name: string; kind: string; incomeCents: number; data: Record<string, unknown>}>};

const OFFICE: WorkCalendar = {routines: [DEFAULT_WEEKLY_ROUTINE], worksOnHolidays: false, localHolidays: [], exceptions: []};
const REFERENCE = '2026-11-04';

const receipts = (entries: Record<string, number>, partial: string[] = []): MonthReceipts[] =>
  Object.entries(entries).map(([month, receiptsCents]) => ({month, receiptsCents, partial: partial.includes(month)}));

const input = (patch: Partial<EstimateInput> = {}): EstimateInput => ({
  mode: 'habitual',
  historyMonths: 3,
  allowBusinessIncome: false,
  calendar: OFFICE,
  referenceDate: REFERENCE,
  workspaceType: 'PF',
  reportExact: true,
  receipts: receipts({'2026-08': 352_000, '2026-09': 352_000, '2026-10': 352_000, '2026-11': 100_000}, ['2026-11']),
  excluded: [],
  ...patch,
});

const minutesOf = (...months: string[]) => months.reduce((sum, month) => sum + monthPlan(OFFICE, month).minutes, 0);
const rounded = (numerator: bigint, denominator: bigint) => Number((2n * numerator + denominator) / (2n * denominator));

test('espelho de receita: a fixture compartilhada com o backend dá o mesmo incomeCents', () => {
  assert.ok(fixture.cases.length >= 12);
  for (const item of fixture.cases) {
    const result = classifyIncomeDocument(item.data);
    assert.equal(result.contributionCents, item.incomeCents, item.name);
    assert.equal(result.kind, item.kind, item.name);
  }
});

test('espelho de receita: a classificação não usa descrição nem categoria', () => {
  const plain = {type: 'receita', valueCents: 1_000, date: '2026-10-05', isPaid: true};
  for (const label of ['Empréstimo do banco', 'Reembolso', 'Aporte de capital', 'Transferência', 'Estorno', 'Salário']) {
    assert.deepEqual(classifyIncomeDocument({...plain, description: label, category: label}), {kind: 'income', contributionCents: 1_000}, label);
  }
  // A marca do backend decide, qualquer que seja o texto.
  assert.equal(classifyIncomeDocument({...plain, description: 'Salário', loanEntry: {}}).kind, 'loan');
  // Fora do contrato, nada entra.
  assert.equal(classifyIncomeDocument({type: 'parcelado', valueCents: 1_000}).kind, 'invalid');
  assert.equal(classifyIncomeDocument({type: 'receita', valueCents: -5}).kind, 'invalid');
  assert.equal(classifyIncomeDocument({type: 'receita', valueCents: 10.5}).kind, 'invalid');
});

test('só o que soma renda pode ser tirado da estimativa', () => {
  for (const item of fixture.cases) {
    const classification = classifyIncomeDocument(item.data);
    const expected = (item.kind === 'income' || item.kind === 'receivable') && item.incomeCents > 0;
    assert.equal(isExcludableIncome(classification), expected, item.name);
  }
});

test('exclusões: descontadas no próprio mês, ignoradas fora da janela, nunca deixam o mês negativo', () => {
  const months = receipts({'2026-09': 352_000, '2026-10': 100_000});
  const excluded: ExcludedIncomeItem[] = [
    {id: 'a', month: '2026-09', classification: {kind: 'income', contributionCents: 52_000}},
    {id: 'b', month: '2026-09', classification: {kind: 'receivable', contributionCents: 10_000}},
    {id: 'c', month: '2026-10', classification: {kind: 'income', contributionCents: 150_000}},
    {id: 'd', month: '2026-07', classification: {kind: 'income', contributionCents: 1_000}},
    {id: 'e', month: null, classification: null},
    {id: 'f', month: '2026-09', classification: {kind: 'receivable_reversal', contributionCents: -5_000}},
    {id: 'g', month: '2026-09', classification: {kind: 'loan', contributionCents: 0}},
  ];
  const outcome = applyIncomeExclusions(months, excluded);
  assert.equal(outcome.ignored, 4, 'fora da janela, não encontrado, estorno e empréstimo');
  assert.deepEqual(outcome.months[0], {
    month: '2026-09', receiptsCents: 352_000, partial: false,
    excludedCents: 62_000, excludedCount: 2, eligibleCents: 290_000, exclusionsSkipped: false,
  });
  // 150.000 excluídos de um mês com 100.000 oficiais: o total oficial prevalece e o mês é sinalizado.
  assert.deepEqual(outcome.months[1], {
    month: '2026-10', receiptsCents: 100_000, partial: false,
    excludedCents: 0, excludedCount: 0, eligibleCents: 100_000, exclusionsSkipped: true,
  });
});

test('janela: últimos N meses completos no habitual, mês corrente no modo mês atual, 12º mês à parte', () => {
  assert.deepEqual(estimateWindowMonths('habitual', 3, REFERENCE), ['2026-08', '2026-09', '2026-10']);
  assert.deepEqual(estimateWindowMonths('habitual', 1, REFERENCE), ['2026-10']);
  assert.equal(estimateWindowMonths('habitual', 12, REFERENCE)[0], '2025-11');
  assert.equal(estimateWindowMonths('habitual', 12, REFERENCE).length, 12);
  assert.deepEqual(estimateWindowMonths('current_month', 3, REFERENCE), ['2026-11']);
  assert.deepEqual(estimateWindowMonths('habitual', 3, '2026-01-01'), ['2025-10', '2025-11', '2025-12'], 'virada de ano');
  assert.equal(extraMonthNeeded('habitual', 12, '2026-11'), '2025-11');
  assert.equal(extraMonthNeeded('habitual', 6, '2026-11'), null);
  assert.equal(extraMonthNeeded('current_month', 12, '2026-11'), null);
});

test('habitual: Σ renda dos meses completos ÷ Σ horas dos mesmos meses, em inteiros', () => {
  const estimate = computeWorkTimeEstimate(input());
  assert.equal(estimate.status, 'ready');
  if (estimate.status !== 'ready') return;
  const minutes = minutesOf('2026-08', '2026-09', '2026-10');
  assert.equal(estimate.incomeCents, 1_056_000, 'o mês corrente não entra');
  assert.equal(estimate.workMinutes, minutes);
  assert.deepEqual(estimate.config, {incomeCents: 1_056_000, workMinutes: minutes});
  assert.equal(estimate.hourlyRateCents, rounded(1_056_000n * 60n, BigInt(minutes)));
  assert.equal(estimate.provisional, false);
  assert.deepEqual(estimate.months.map((month) => month.month), ['2026-08', '2026-09', '2026-10']);
  // Horas do próprio mês (outubro tem o feriado de 12/10, segunda-feira).
  assert.equal(estimate.months[2].workMinutes, monthPlan(OFFICE, '2026-10').minutes);
  assert.ok(Number.isInteger(estimate.hourlyRateCents));
});

test('habitual: meses antes da primeira renda saem da conta e a estimativa fica provisória', () => {
  const estimate = computeWorkTimeEstimate(input({
    receipts: receipts({'2026-08': 0, '2026-09': 0, '2026-10': 352_000, '2026-11': 0}, ['2026-11']),
  }));
  assert.equal(estimate.status, 'ready');
  if (estimate.status !== 'ready') return;
  assert.equal(estimate.provisional, true);
  assert.deepEqual(estimate.months.map((month) => month.month), ['2026-10']);
  assert.deepEqual(estimate.notes.find((note) => note.kind === 'provisional'), {kind: 'provisional', monthsUsed: 1, monthsRequested: 3});
  // Um mês sem renda no meio da janela continua contando (renda zero é um fato).
  const middle = computeWorkTimeEstimate(input({
    receipts: receipts({'2026-08': 352_000, '2026-09': 0, '2026-10': 352_000, '2026-11': 0}, ['2026-11']),
  }));
  assert.equal(middle.status === 'ready' && middle.months.length, 3);
});

test('dados insuficientes: indisponível com o motivo, nunca um valor inventado', () => {
  const none = computeWorkTimeEstimate(input({receipts: receipts({'2026-08': 0, '2026-09': 0, '2026-10': 0, '2026-11': 0})}));
  assert.equal(none.status, 'unavailable');
  assert.equal(none.status === 'unavailable' && none.reason, 'no_income');
  const notExact = computeWorkTimeEstimate(input({reportExact: false}));
  assert.equal(notExact.status === 'unavailable' && notExact.reason, 'report_unavailable');
  const missingMonth = computeWorkTimeEstimate(input({historyMonths: 12}));
  assert.equal(missingMonth.status === 'unavailable' && missingMonth.reason, 'report_unavailable', 'sem o 12º mês');
  const allVacation = computeWorkTimeEstimate(input({
    calendar: {...OFFICE, exceptions: [{kind: 'vacation', start: '2026-08-01', end: '2026-10-31'}]},
  }));
  assert.equal(allVacation.status === 'unavailable' && allVacation.reason, 'no_work_minutes');
  const tiny = computeWorkTimeEstimate(input({receipts: receipts({'2026-08': 0, '2026-09': 0, '2026-10': 50, '2026-11': 0})}));
  assert.equal(tiny.status === 'unavailable' && tiny.reason, 'income_too_low');
  const cheap = computeWorkTimeEstimate(input({receipts: receipts({'2026-08': 100, '2026-09': 100, '2026-10': 100, '2026-11': 0})}));
  assert.equal(cheap.status === 'unavailable' && cheap.reason, 'hourly_rate_too_low');
  // Mês com mais estornos que receitas: o total da janela decide.
  const negative = computeWorkTimeEstimate(input({receipts: receipts({'2026-08': 0, '2026-09': 0, '2026-10': -1_000, '2026-11': 0})}));
  assert.equal(negative.status === 'unavailable' && negative.reason, 'no_income');
});

test('RR-R32-11 (P5-GATE-FINAL): a memória de cálculo só diz "nenhuma" quando a estimativa chegou a calcular os meses', () => {
  // Uma folga e uma desconsiderada na janela: a estimativa que para antes dos meses não as aplicou, e "nenhuma" seria falso.
  const calendar: WorkCalendar = {...OFFICE, exceptions: [{kind: 'vacation', start: '2026-09-01', end: '2026-09-04'}]};
  const excluded: ExcludedIncomeItem[] = [{id: 'rx1', month: '2026-09', classification: null}];
  const stoppedBefore = [
    computeWorkTimeEstimate(input({calendar, excluded, workspaceType: 'PJ'})),
    computeWorkTimeEstimate(input({calendar, excluded, reportExact: false})),
    computeWorkTimeEstimate(input({calendar, excluded: [{id: 'rx1', month: '2026-09', classification: null, unconfirmed: true}]})),
  ];
  assert.deepEqual(stoppedBefore.map((estimate) => estimate.status === 'unavailable' && estimate.reason),
    ['business_not_confirmed', 'report_unavailable', 'exclusion_unconfirmed']);
  for (const estimate of stoppedBefore) {
    assert.equal(calculationReachedMonths(estimate), false, 'sem meses, a memória não afirma "nenhuma"');
    assert.equal(estimate.months.length, 0);
  }
  // Com os meses calculados, a memória mostra o que foi aplicado, como antes (inclusive na indisponível com números).
  const ready = computeWorkTimeEstimate(input({calendar}));
  assert.equal(ready.status, 'ready');
  assert.equal(calculationReachedMonths(ready), true);
  const noIncome = computeWorkTimeEstimate(input({calendar, receipts: receipts({'2026-08': 0, '2026-09': 0, '2026-10': 0, '2026-11': 0})}));
  assert.equal(noIncome.status === 'unavailable' && noIncome.reason, 'no_income');
  assert.equal(calculationReachedMonths(noIncome), true);
  for (const text of [DETAILS_EXCLUSIONS_NOT_APPLIED, DETAILS_CALENDAR_NOT_APPLIED]) {
    assert.doesNotMatch(text, /nenhum/i);
    assert.match(text, /não foram aplicad[ao]s: a estimativa parou antes de calcular os meses\.$/);
  }
});

test('B02: o primeiro mês da janela abre o período: um turno da véspera da janela não tira horas da estimativa', () => {
  const everyDay = (spec: DaySpec): WorkRoutine => ({kind: 'weekly', days: Array(7).fill(spec)});
  const allDay: WorkCalendar = {...OFFICE, worksOnHolidays: true, routines: [everyDay({kind: 'window', start: 0, end: 0, breakMinutes: 0})]};
  // Sexta 22:00–06:00: 31/07/2026, véspera da janela (agosto a outubro), é sexta.
  const friday: WorkRoutine = {kind: 'weekly', days: [0, 1, 2, 3, 4, 5, 6].map((index): DaySpec => (index === 4 ? {kind: 'window', start: 1320, end: 360, breakMinutes: 0} : {kind: 'off'}))};
  const before = computeWorkTimeEstimate(input({calendar: allDay}));
  const after = computeWorkTimeEstimate(input({calendar: {...allDay, routines: [...allDay.routines, friday]}}));
  assert.equal(before.status, 'ready');
  // 92 dias de 24 h; a sexta acrescentada não tira nada, nem do 1º de agosto.
  assert.deepEqual([before.workMinutes, after.workMinutes], [92 * 1440, 92 * 1440]);
  assert.equal(after.status === 'ready' && after.months[0].plan.days[0].minutes, 1440);
});

test('B02: rotinas sem cálculo seguro deixam a estimativa indisponível, sem nenhum mês com horas na memória de cálculo', () => {
  // 08–14 e 12–18, cada uma com 30 min de intervalo, nos dias úteis: as horas dependem de onde caem as pausas.
  const weekdaysWindow = (start: number, end: number, breakMinutes: number): WorkRoutine => ({
    kind: 'weekly',
    days: [0, 1, 2, 3, 4, 5, 6].map((index): DaySpec => (index < 5 ? {kind: 'window', start, end, breakMinutes} : {kind: 'off'})),
  });
  const crossed: WorkCalendar = {...OFFICE, routines: [weekdaysWindow(480, 840, 30), weekdaysWindow(720, 1080, 30)]};
  assert.ok(monthPlan(crossed, '2026-10').ambiguousDays.length > 0);
  const estimate = computeWorkTimeEstimate(input({calendar: crossed}));
  assert.equal(estimate.status, 'unavailable');
  assert.equal(estimate.status === 'unavailable' && estimate.reason, 'ambiguous_routines');
  assert.deepEqual([estimate.months, estimate.workMinutes, estimate.incomeCents], [[], 0, 0], 'nenhuma hora que não vale chega à tela');
  // O mesmo período com as rotinas sem intervalo: a união das janelas (10 h por dia útil) dá a estimativa.
  const plain: WorkCalendar = {...crossed, routines: [weekdaysWindow(480, 840, 0), weekdaysWindow(720, 1080, 0)]};
  const ready = computeWorkTimeEstimate(input({calendar: plain}));
  assert.equal(ready.status, 'ready');
  assert.equal(ready.workMinutes, ['2026-08', '2026-09', '2026-10'].reduce((sum, month) => sum + monthPlan(plain, month).minutes, 0));
  assert.equal(monthPlan(plain, '2026-10').days.find((day) => day.date === '2026-10-05')?.minutes, 600);
});

test('B02 (P5-F.1-R2A, S01): a jornada reduzida que deixa o dia seguinte sem cálculo seguro deixa a estimativa indisponível, com o motivo próprio', () => {
  // Segunda 20:00–06:00 e terça 00:00–08:00; segunda 05/10/2026 (na janela de agosto a outubro) reduzida a 8 h.
  const night: WorkRoutine = {kind: 'weekly', days: [0, 1, 2, 3, 4, 5, 6].map((index): DaySpec => (
    index === 0 ? {kind: 'window', start: 1200, end: 360, breakMinutes: 0} : index === 1 ? {kind: 'window', start: 0, end: 480, breakMinutes: 0} : {kind: 'off'}))};
  const base: WorkCalendar = {...OFFICE, worksOnHolidays: true, routines: [night]};
  assert.equal(computeWorkTimeEstimate(input({calendar: base})).status, 'ready');
  const reduced: WorkCalendar = {...base, exceptions: [{kind: 'reduced', start: '2026-10-05', end: '2026-10-05', minutes: 480}]};
  const estimate = computeWorkTimeEstimate(input({calendar: reduced}));
  assert.equal(estimate.status === 'unavailable' && estimate.reason, 'ambiguous_reduced_eve');
  assert.deepEqual([estimate.months, estimate.workMinutes, estimate.incomeCents], [[], 0, 0], 'nenhuma hora que não vale chega à tela');
  // Com um dia ambíguo pelo intervalo na mesma janela, o motivo é o das rotinas (a correção começa por elas).
  const crossedMonday: WorkRoutine = {kind: 'weekly', days: [0, 1, 2, 3, 4, 5, 6].map((index): DaySpec => (
    index === 2 ? {kind: 'window', start: 480, end: 840, breakMinutes: 30} : {kind: 'off'}))};
  const crossedOther: WorkRoutine = {kind: 'weekly', days: [0, 1, 2, 3, 4, 5, 6].map((index): DaySpec => (
    index === 2 ? {kind: 'window', start: 720, end: 1080, breakMinutes: 30} : {kind: 'off'}))};
  const mixed = computeWorkTimeEstimate(input({calendar: {...reduced, routines: [night, crossedMonday, crossedOther]}}));
  assert.equal(mixed.status === 'unavailable' && mixed.reason, 'ambiguous_routines');
  // A redução que não corta nada: a estimativa volta.
  const loose = computeWorkTimeEstimate(input({calendar: {...base, exceptions: [{kind: 'reduced', start: '2026-10-05', end: '2026-10-05', minutes: 600}]}}));
  assert.equal(loose.status, 'ready');
});

// ------------------------------------------------------ B01: recebimento desconsiderado e estornado (R1)

const reversalFixture = JSON.parse(
  readFileSync(new URL('../fixtures/receivable-reversal-ids.json', import.meta.url), 'utf8'),
) as {cases: Array<{movementId: string; mirrorId: string; reversalMovementId: string; reversalMirrorId: string}>};

test('B01: o navegador deriva os IDs do estorno como o backend (fixture compartilhada)', async () => {
  assert.ok(reversalFixture.cases.length >= 3);
  for (const item of reversalFixture.cases) {
    assert.equal(receiptMovementIdOfMirror(item.mirrorId), item.movementId);
    assert.equal(await reversalMovementIdOf(item.movementId), item.reversalMovementId);
    assert.equal(await reversalMirrorIdOf(item.mirrorId), item.reversalMirrorId);
  }
  // Só espelhos de recebimento têm estorno derivável; nenhum outro ID vira consulta.
  for (const id of ['tx_123', 'loancash_abc', 'recvcash_curto', `recvcash_${'A'.repeat(40)}`]) {
    assert.equal(receiptMovementIdOfMirror(id), null, id);
    assert.equal(await reversalMirrorIdOf(id), null, id);
  }
});

const [CASE] = reversalFixture.cases;
/** Espelho do recebimento A (R$ 100,00 de principal) e do estorno dele, como o backend os grava. */
const receiptA = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: CASE.mirrorId, date: '2026-10-10', type: 'receita', valueCents: 10_000, isPaid: true,
  receivableEntry: {receivableMovementId: CASE.movementId, reversal: false, principalCents: 10_000}, ...patch,
});
const reversalOfA = (patch: Record<string, unknown> = {}, entry: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: CASE.reversalMirrorId, date: '2026-10-10', type: 'despesa', valueCents: 10_000, isPaid: true,
  receivableEntry: {receivableMovementId: CASE.reversalMovementId, reversal: true, reversalOf: CASE.movementId, principalCents: 10_000, ...entry},
  ...patch,
});
const incomeB = {id: 'tx_b', date: '2026-10-12', type: 'receita', valueCents: 10_000, isPaid: true};

test('B01: A +100 estornado (−100) e B +100, com A desconsiderado antes do estorno: a renda é a de B, R$ 100,00, nunca zero', () => {
  // O total oficial de outubro já soma A, o estorno de A e B: R$ 100,00.
  const official = receipts({'2026-08': 352_000, '2026-09': 352_000, '2026-10': 10_000});
  const october = (excluded: ExcludedIncomeItem[]) => applyIncomeExclusions(official, excluded).months[2];
  // Antes da R1, a exclusão de A (lido sem o estorno) descontava de novo os R$ 100,00 e deixava o mês em zero, sem aviso.
  const blind = october([excludedItemOf(receiptA(), null)]);
  assert.deepEqual([blind.eligibleCents, blind.exclusionsSkipped], [0, false], 'a leitura sem o estorno reproduz o defeito');
  // Com o estorno lido junto, pelo identificador oficial, a exclusão perde o efeito.
  const item = excludedItemOf(receiptA(), reversalOfA());
  assert.deepEqual([item.reversed, item.unconfirmed, item.classification?.contributionCents], [true, undefined, 0]);
  const fixed = october([item]);
  assert.deepEqual([fixed.eligibleCents, fixed.excludedCents, fixed.exclusionsSkipped], [10_000, 0, false]);
  const estimate = computeWorkTimeEstimate(input({receipts: [...official, {month: '2026-11', receiptsCents: 0, partial: true}], excluded: [item]}));
  assert.equal(estimate.status, 'ready');
  assert.equal(estimate.months[2].eligibleCents, 10_000);
  assert.deepEqual(estimate.notes.filter((note) => note.kind === 'exclusions_reversed'), [{kind: 'exclusions_reversed', count: 1}]);
  // Antes do estorno, o total era R$ 200,00 e a exclusão de A valia: os mesmos R$ 100,00 elegíveis.
  const beforeReversal = applyIncomeExclusions(receipts({'2026-10': 20_000}), [excludedItemOf(receiptA(), null)]).months[0];
  assert.deepEqual([beforeReversal.eligibleCents, beforeReversal.excludedCents], [10_000, 10_000]);
  // B desconsiderado também: o total cai para zero só pela exclusão de B, que vale.
  const both = october([item, excludedItemOf(incomeB, null)]);
  assert.deepEqual([both.eligibleCents, both.excludedCents, both.excludedCount], [0, 10_000, 1]);
});

test('B01: estado do estorno que não se confirma suspende a estimativa; o recebimento não estornado continua descontado', () => {
  const official = [...receipts({'2026-08': 352_000, '2026-09': 352_000, '2026-10': 30_000}), {month: '2026-11', receiptsCents: 0, partial: true}];
  const unconfirmed: Array<[string, ExcludedIncomeItem]> = [
    ['movimento do documento diferente do ID', excludedItemOf(receiptA({receivableEntry: {receivableMovementId: 'rmv_outro', reversal: false, principalCents: 10_000}}), null)],
    ['estorno de outro movimento', excludedItemOf(receiptA(), reversalOfA({}, {reversalOf: 'rmv_outro'}))],
    ['estorno em outro mês', excludedItemOf(receiptA(), reversalOfA({date: '2026-11-02'}))],
    ['estorno de outro valor', excludedItemOf(receiptA(), reversalOfA({}, {principalCents: 5_000}))],
    ['estorno anulado', excludedItemOf(receiptA(), reversalOfA({voidedAt: '2026-10-11T12:00:00Z'}))],
    ['documento que não é estorno', excludedItemOf(receiptA(), reversalOfA({}, {reversal: false}))],
  ];
  for (const [name, item] of unconfirmed) {
    assert.equal(item.unconfirmed, true, name);
    const estimate = computeWorkTimeEstimate(input({receipts: official, excluded: [item]}));
    assert.equal(estimate.status === 'unavailable' && estimate.reason, 'exclusion_unconfirmed', name);
    assert.deepEqual([estimate.months, estimate.incomeCents], [[], 0], `${name}: nada é mostrado`);
  }
  // Fora da janela, o item sem confirmação não muda nada (a exclusão já seria ignorada).
  const outside = excludedItemOf(receiptA({date: '2026-01-10'}), reversalOfA({}, {reversalOf: 'rmv_outro'}));
  assert.equal(computeWorkTimeEstimate(input({receipts: official, excluded: [outside]})).status, 'ready');
  // Recebimento não estornado: a exclusão continua valendo, ao lado de outras receitas do mês.
  const kept = excludedItemOf(receiptA(), null);
  assert.deepEqual([kept.reversed, kept.unconfirmed, kept.classification?.contributionCents], [undefined, undefined, 10_000]);
  const ready = computeWorkTimeEstimate(input({receipts: official, excluded: [kept, excludedItemOf(incomeB, null)]}));
  assert.equal(ready.status, 'ready');
  assert.deepEqual([ready.months[2].eligibleCents, ready.months[2].excludedCount], [10_000, 2]);
});

test('B01: a leitura por id traz o recebimento e o estorno lado a lado, na mesma consulta, e separa os itens dos estornos', async () => {
  const calls: string[][] = [];
  const store = new Map<string, Record<string, unknown>>([[CASE.mirrorId, receiptA()], [CASE.reversalMirrorId, reversalOfA()], ['tx_b', incomeB]]);
  const read = async (_workspaceId: string, ids: readonly string[]) => {
    calls.push([...ids]);
    return {found: ids.filter((id) => store.has(id)).map((id) => store.get(id) as object), missing: ids.filter((id) => !store.has(id))};
  };
  const second = reversalFixture.cases[1];
  const result = await readExcludedIncome(read, 'ws-a', ['tx_b', CASE.mirrorId, 'tx_sumiu', second.mirrorId]);
  // Os pares primeiro, cada um nas posições (0, 1), (2, 3)…: os lotes de 30 nunca os separam.
  assert.deepEqual(calls, [[CASE.mirrorId, CASE.reversalMirrorId, second.mirrorId, second.reversalMirrorId, 'tx_b', 'tx_sumiu']]);
  assert.deepEqual(result.found.map((document) => (document as {id: string}).id).sort(), [CASE.mirrorId, 'tx_b'].sort());
  assert.deepEqual([...result.missing].sort(), [second.mirrorId, 'tx_sumiu'].sort(), 'o estorno que não existe não é um item sumido');
  assert.deepEqual(Object.keys(result.reversals), [CASE.mirrorId]);
  assert.equal((result.reversals[CASE.mirrorId] as {id: string}).id, CASE.reversalMirrorId);
});

test('B01 (revisão da R1, N08): sem ID repetido e com cada par lado a lado, também com o espelho de um estorno na lista e mais de 30 IDs', async () => {
  const calls: string[][] = [];
  const read = async (_workspaceId: string, ids: readonly string[]) => {
    calls.push([...ids]);
    return {found: [], missing: [...ids]};
  };
  const hex = (index: number) => index.toString(16).padStart(40, '0');
  const receipts = Array.from({length: 15}, (_, index) => `recvcash_${hex(index + 1)}`);
  // O espelho do estorno de CASE também tem a forma de um espelho de recebimento, e entra na lista: depois do
  // recebimento e, na outra ordem (revisão independente 2, M07), antes dele.
  for (const listed of [
    [CASE.mirrorId, CASE.reversalMirrorId, ...receipts, 'tx_comum'],
    [CASE.reversalMirrorId, ...receipts, CASE.mirrorId, 'tx_comum'],
  ]) {
    calls.length = 0;
    await readExcludedIncome(read, 'ws-a', listed);
    const [ids] = calls;
    assert.equal(new Set(ids).size, ids.length, 'nenhum ID repetido');
    const pairs = await Promise.all([CASE.mirrorId, ...receipts].map(async (id) => [id, await reversalMirrorIdOf(id)] as const));
    for (const [id, reversalId] of pairs) {
      const position = ids.indexOf(id);
      assert.equal(position % 2, 0, `${id}: posição par`);
      assert.equal(ids[position + 1], reversalId, `${id}: o estorno logo depois`);
      assert.equal(Math.floor(position / 30), Math.floor((position + 1) / 30), `${id}: o par no mesmo lote de 30`);
    }
    // O espelho do estorno da lista entrou como estorno de CASE: não abre um par novo (estorno não tem estorno).
    assert.equal(ids.filter((id) => id === CASE.reversalMirrorId).length, 1);
    assert.equal(ids.includes(await reversalMirrorIdOf(CASE.reversalMirrorId) as string), false);
    assert.deepEqual(ids.slice(-1), ['tx_comum'], 'os IDs sem par vão por último');
  }
});

test('PJ só com confirmação explícita, e sempre sinalizado; sem soma PF+PJ', () => {
  const blocked = computeWorkTimeEstimate(input({workspaceType: 'PJ'}));
  assert.equal(blocked.status === 'unavailable' && blocked.reason, 'business_not_confirmed');
  const allowed = computeWorkTimeEstimate(input({workspaceType: 'PJ', allowBusinessIncome: true}));
  assert.equal(allowed.status, 'ready');
  assert.ok(allowed.notes.some((note) => note.kind === 'business_income'));
  // PF com a confirmação ligada não muda nada.
  const pf = computeWorkTimeEstimate(input({allowBusinessIncome: true}));
  assert.equal(pf.status === 'ready' && pf.notes.some((note) => note.kind === 'business_income'), false);
});

test('mês atual: renda recebida até hoje ÷ horas do mês inteiro, sempre marcada como incompleta', () => {
  const estimate = computeWorkTimeEstimate(input({mode: 'current_month'}));
  assert.equal(estimate.status, 'ready');
  if (estimate.status !== 'ready') return;
  const november = monthPlan(OFFICE, '2026-11').minutes;
  assert.equal(november, 152 * 60);
  assert.deepEqual(estimate.config, {incomeCents: 100_000, workMinutes: november});
  assert.equal(estimate.provisional, true);
  assert.deepEqual(estimate.notes.find((note) => note.kind === 'current_month_incomplete'),
    {kind: 'current_month_incomplete', throughDate: REFERENCE});
  const empty = computeWorkTimeEstimate(input({mode: 'current_month', receipts: receipts({'2026-11': 0}, ['2026-11'])}));
  assert.equal(empty.status === 'unavailable' && empty.reason, 'no_income');
});

test('exclusões do usuário entram só na estimativa e são somadas por mês', () => {
  const excluded: ExcludedIncomeItem[] = [
    {id: 'bonus', month: '2026-10', classification: {kind: 'income', contributionCents: 52_000}},
    {id: 'old', month: '2026-01', classification: {kind: 'income', contributionCents: 9_999}},
  ];
  const estimate = computeWorkTimeEstimate(input({excluded}));
  assert.equal(estimate.status, 'ready');
  if (estimate.status !== 'ready') return;
  assert.equal(estimate.incomeCents, 1_056_000 - 52_000);
  assert.equal(estimate.excludedCents, 52_000);
  assert.equal(estimate.excludedCount, 1);
  assert.deepEqual(estimate.notes.find((note) => note.kind === 'exclusions_ignored'), {kind: 'exclusions_ignored', count: 1});
  // O relatório oficial não é alterado: o mês guarda o total oficial ao lado do elegível.
  assert.equal(estimate.months[2].receiptsCents, 352_000);
  assert.equal(estimate.months[2].eligibleCents, 300_000);
});

test('12 meses: a janela usa o 12º mês completo trazido à parte', () => {
  const months: Record<string, number> = {};
  for (const month of estimateWindowMonths('habitual', 12, REFERENCE)) months[month] = 300_000;
  months['2026-11'] = 0;
  const estimate = computeWorkTimeEstimate(input({historyMonths: 12, receipts: receipts(months, ['2026-11'])}));
  assert.equal(estimate.status, 'ready');
  if (estimate.status !== 'ready') return;
  assert.equal(estimate.months.length, 12);
  assert.equal(estimate.incomeCents, 3_600_000);
  assert.equal(estimate.provisional, false);
});

test('painel: itens classificados, estorno pareado, duplicidade só sinalizada e despesa comum fora', () => {
  const receivable = (id: string, date: string, reversal: boolean, movementId: string, reversalOf?: string): IncomeDocument => ({
    id, date, valueCents: 100_000, type: reversal ? 'despesa' : 'receita', isPaid: true,
    receivableEntry: {principalCents: 100_000, reversal, receivableMovementId: movementId, ...(reversalOf ? {reversalOf} : {})},
  });
  const documents: IncomeDocument[] = [
    {id: 'salario', date: '2026-10-05', valueCents: 352_000, type: 'receita', isPaid: true, description: 'Salário', cashAccountId: 'acc1'},
    {id: 'bonus-a', date: '2026-10-20', valueCents: 50_000, type: 'receita', isPaid: true, cashAccountId: 'acc1'},
    {id: 'bonus-b', date: '2026-10-20', valueCents: 50_000, type: 'receita', isPaid: true, cashAccountId: 'acc1'},
    {id: 'prevista', date: '2026-10-25', valueCents: 10_000, type: 'receita', isPaid: false},
    {id: 'aluguel', date: '2026-10-10', valueCents: 99_000, type: 'despesa', isPaid: true},
    // Forma que o backend grava (`functions/src/receivables/operations.ts`): o estorno fica na data do
    // próprio recebimento, mesmo feito semanas depois, e os dois somam zero naquele mês.
    receivable('rec', '2026-09-15', false, 'rmv_1'),
    receivable('est', '2026-09-15', true, 'rmv_2', 'rmv_1'),
    receivable('outro', '2026-09-20', false, 'rmv_3'),
  ];
  const views = buildIncomeItemViews(documents, ['bonus-b']);
  assert.deepEqual(views.map((item) => item.id), ['prevista', 'bonus-b', 'bonus-a', 'salario', 'outro', 'rec', 'est'], 'mais recente primeiro, sem a despesa');
  const byId = new Map(views.map((item) => [item.id, item]));
  assert.equal(byId.get('rec')?.reversed, true, 'recebimento estornado');
  assert.equal(byId.get('outro')?.reversed, false, 'o estorno é pareado pelo movimento, não pela data');
  assert.equal(byId.get('salario')?.reversed, false, 'sem estorno');
  assert.equal(byId.get('est')?.reversed, false, 'o próprio estorno não é um recebimento estornado');
  assert.equal(byId.get('est')?.month, byId.get('rec')?.month, 'os dois no mesmo mês');
  assert.equal(byId.get('est')?.classification.contributionCents, -100_000);
  assert.equal(byId.get('est')?.excludable, false);
  assert.equal(byId.get('bonus-a')?.possibleDuplicate, true);
  assert.equal(byId.get('bonus-b')?.possibleDuplicate, true);
  assert.equal(byId.get('salario')?.possibleDuplicate, false);
  assert.equal(byId.get('bonus-b')?.excludedByUser, true);
  assert.equal(byId.get('prevista')?.excludable, false, 'prevista não pode ser desconsiderada: já não entra');
  assert.equal(byId.get('salario')?.description, 'Salário', 'a descrição só identifica o item');

  // Setembro: recebimento e estorno somam zero; fica o outro recebimento.
  const months = reconcileIncomeMonths(views, receipts({'2026-09': 100_000, '2026-10': 452_000}));
  assert.deepEqual(months[0], {month: '2026-09', listedCents: 100_000, officialCents: 100_000, matches: true, considered: 2, excludedByUser: 0, automatic: 1});
  assert.deepEqual(months[1], {month: '2026-10', listedCents: 452_000, officialCents: 452_000, matches: true, considered: 2, excludedByUser: 1, automatic: 1});
  // Relatório ainda sem um lançamento novo: a conferência mostra a diferença; o total oficial vale.
  const lagging = reconcileIncomeMonths(views, receipts({'2026-10': 402_000}));
  assert.equal(lagging[0].matches, false);
});

test('painel: texto e caixa de cada item, com o recebimento estornado dentro e depois do período', () => {
  // Habitual ago–out; hoje 04/11/2026: a lista vai de 01/08 a hoje, então novembro fica "depois do período".
  // O estorno fica na data do recebimento: os dois estão sempre no mesmo mês.
  const WINDOW = ['2026-08', '2026-09', '2026-10'];
  const item = (patch: Partial<IncomeItemView>): IncomeItemView => ({
    id: 'x', date: '2026-09-15', month: '2026-09', description: 'Projeto', valueCents: 100_000,
    classification: {kind: 'receivable', contributionCents: 100_000}, excludable: true, excludedByUser: false,
    reversed: false, possibleDuplicate: false, ...patch,
  });
  // Sem estorno, na janela: considerada, com caixa.
  assert.deepEqual(incomeItemPresentation(item({}), WINDOW), {status: 'Considerada na estimativa.', reversalNote: null, canToggle: true});
  // Estornado na janela: o estorno já anula o valor; sem caixa, e nenhuma data apresentada como a do estorno.
  const inside = incomeItemPresentation(item({reversed: true}), WINDOW);
  assert.deepEqual(inside, {
    status: 'Considerada na estimativa.',
    reversalNote: 'Recebimento estornado: o estorno fica na data do recebimento e já anula o valor dele neste mês. Não é preciso desconsiderá-lo.',
    canToggle: false,
  });
  assert.doesNotMatch(inside.reversalNote ?? '', /\d{2}\/\d{2}\/\d{4}/, 'sem data: a do espelho é a do recebimento');
  // Já desconsiderado: o aviso diz que a exclusão não tira nada (o estorno é lido junto com ele, B01; antes da R1,
  // o texto avisava que o valor saía duas vezes), com a caixa para voltar a considerá-lo.
  const insideExcluded = incomeItemPresentation(item({reversed: true, excludedByUser: true}), WINDOW);
  assert.deepEqual(insideExcluded, {
    status: 'Desconsiderada por você: não entra nesta estimativa.',
    reversalNote: 'Recebimento estornado: o estorno fica na data do recebimento e já anula o valor dele neste mês. Você o desconsiderou, mas a exclusão não tira nada da estimativa: o estorno já anula o valor. Pode voltar a considerá-lo.',
    canToggle: true,
  });
  // Estornado depois do período (os dois em novembro): ainda não entram e, quando entrarem, um anula o outro.
  const after = incomeItemPresentation(item({date: '2026-11-02', month: '2026-11', reversed: true}), WINDOW);
  assert.deepEqual(after, {
    status: 'Depois do período desta estimativa: ainda não entra na conta.',
    reversalNote: 'Recebimento estornado: o estorno fica na data do recebimento e anula o valor dele no mesmo mês, depois do período desta estimativa. Não é preciso desconsiderá-lo.',
    canToggle: false,
  });
  const afterExcluded = incomeItemPresentation(item({date: '2026-11-02', month: '2026-11', reversed: true, excludedByUser: true}), WINDOW);
  assert.equal(afterExcluded.canToggle, true);
  assert.equal(afterExcluded.status, 'Desconsiderada por você: não entra nesta estimativa.');
  assert.match(afterExcluded.reversalNote ?? '', / Você o desconsiderou, mas a exclusão não tira nada da estimativa: o estorno já anula o valor\. Pode voltar a considerá-lo\.$/);
  // Receita comum depois do período, sem estorno: ainda não entra, mas pode ser desconsiderada de antemão.
  const later = incomeItemPresentation(item({date: '2026-11-03', month: '2026-11', classification: {kind: 'income', contributionCents: 100_000}}), WINDOW);
  assert.deepEqual(later, {status: 'Depois do período desta estimativa: ainda não entra na conta.', reversalNote: null, canToggle: true});
  // O que não soma renda mostra o motivo e não tem caixa; o estorno diz onde fica.
  const pending = incomeItemPresentation(item({classification: {kind: 'pending', contributionCents: 0}, excludable: false}), WINDOW);
  assert.deepEqual(pending, {status: 'Ainda não efetivada: não entra.', reversalNote: null, canToggle: false});
  const reversal = incomeItemPresentation(item({classification: {kind: 'receivable_reversal', contributionCents: -100_000}, excludable: false}), WINDOW);
  assert.deepEqual(reversal, {status: 'Estorno de recebimento: fica na data do recebimento e anula o valor dele naquele mês.', reversalNote: null, canToggle: false});
});

test('falha de leitura: só mensagens em pt-BR, nunca o texto do SDK', () => {
  // Erro do Firestore na leitura das receitas desconsideradas (texto do SDK, em inglês).
  const sdkError = Object.assign(new Error('Failed to get document because the client is offline.'), {code: 'unavailable'});
  assert.equal(estimateFailureMessage('excluded', sdkError), ESTIMATE_EXCLUDED_READ_FAILED);
  assert.equal(estimateFailureMessage('excluded', new Error('Missing or insufficient permissions.')), ESTIMATE_EXCLUDED_READ_FAILED);
  // O relatório oficial já falha com a mensagem pt-BR de `reportErrorMessage`, que é mantida.
  assert.equal(estimateFailureMessage('report', new Error('Não foi possível carregar o relatório. Tente novamente.')),
    'Não foi possível carregar o relatório. Tente novamente.');
  assert.equal(estimateFailureMessage('report', undefined), ESTIMATE_REPORT_READ_FAILED);
  assert.equal(estimateFailureMessage('report', new Error('   ')), ESTIMATE_REPORT_READ_FAILED);
});

test('aviso do topo: ressalvas do mês incompleto, da estimativa provisória e da fonte PJ', () => {
  // Mês atual: sempre provisório; a ressalva é a do mês incompleto, não a de poucos meses.
  assert.deepEqual(estimateQualifiers({mode: 'current_month', provisional: true, workspaceType: 'PF'}), [ESTIMATE_QUALIFIER_CURRENT_MONTH]);
  assert.deepEqual(estimateQualifiers({mode: 'habitual', provisional: true, workspaceType: 'PF'}), [ESTIMATE_QUALIFIER_PROVISIONAL]);
  assert.deepEqual(estimateQualifiers({mode: 'habitual', provisional: false, workspaceType: 'PF'}), [], 'estimativa completa de PF: nenhuma ressalva');
  assert.deepEqual(estimateQualifiers({mode: 'habitual', provisional: false, workspaceType: 'PJ'}), [ESTIMATE_QUALIFIER_BUSINESS]);
  assert.deepEqual(estimateQualifiers({mode: 'habitual', provisional: true, workspaceType: 'PJ'}), [ESTIMATE_QUALIFIER_PROVISIONAL, ESTIMATE_QUALIFIER_BUSINESS]);
  assert.deepEqual(estimateQualifiers({mode: 'current_month', provisional: true, workspaceType: 'PJ'}), [ESTIMATE_QUALIFIER_CURRENT_MONTH, ESTIMATE_QUALIFIER_BUSINESS]);
  // Textos exatos que o aviso mostra.
  assert.equal(ESTIMATE_QUALIFIER_CURRENT_MONTH, 'Base: o mês atual, ainda incompleto; a renda pode variar até o fim do mês.');
  assert.equal(ESTIMATE_QUALIFIER_PROVISIONAL, 'Estimativa provisória: há menos meses de renda que o período escolhido.');
  assert.equal(ESTIMATE_QUALIFIER_BUSINESS, 'Renda de um espaço empresarial (PJ), por escolha sua.');
  // A última releitura falhou: a ressalva vai por último, junto das demais.
  assert.deepEqual(estimateQualifiers({mode: 'habitual', provisional: false, workspaceType: 'PF'}, true), [ESTIMATE_QUALIFIER_STALE]);
  assert.deepEqual(estimateQualifiers({mode: 'current_month', provisional: true, workspaceType: 'PJ'}, true),
    [ESTIMATE_QUALIFIER_CURRENT_MONTH, ESTIMATE_QUALIFIER_BUSINESS, ESTIMATE_QUALIFIER_STALE]);
  assert.equal(ESTIMATE_QUALIFIER_STALE, 'Não foi possível atualizar a estimativa com os lançamentos mais recentes: ela usa a leitura anterior. Tente de novo em Configurações.');
});
