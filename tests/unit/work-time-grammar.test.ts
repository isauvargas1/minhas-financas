import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

import {
  ANNUAL_PATTERN,
  CYCLE_COUNT_PATTERN,
  DATE_PATTERN,
  DAY_PATTERN,
  EXCEPTIONS_LIST_PATTERN,
  EXCEPTION_PATTERN,
  EXCLUDED_IDS_LIST_PATTERN,
  LOCAL_HOLIDAYS_LIST_PATTERN,
  LOCAL_HOLIDAY_PATTERN,
  MAX_EXCEPTIONS,
  MAX_EXCEPTIONS_LENGTH,
  MAX_EXCLUDED_IDS_LENGTH,
  MAX_EXCLUDED_INCOME_IDS,
  MAX_LOCAL_HOLIDAYS,
  MAX_LOCAL_HOLIDAYS_LENGTH,
  MAX_MUNICIPALITY_LENGTH,
  MAX_ROUTINES_LENGTH,
  MINUTES_0_PATTERN,
  MINUTES_1_PATTERN,
  MUNICIPALITY_PATTERN,
  RECORD_ID_PATTERN,
  ROUTINES_LIST_PATTERN,
  ROUTINE_PATTERN,
  TIME_PATTERN,
  WORK_DAY_PATTERN,
  checkExceptions,
  formatExceptions,
  formatExcludedIds,
  formatLocalHolidays,
  formatRoutines,
  isMunicipality,
  isRecordId,
  parseExceptions,
  parseExcludedIds,
  parseLocalHolidays,
  parseRoutines,
} from '../../src/modules/work-time/grammar.ts';
import {BRAZILIAN_UFS} from '../../src/modules/work-time/contract.ts';

/*
 * P5-F.1 — gramáticas fechadas do documento v2. O corpus compartilhado
 * (`tests/fixtures/work-time-grammar-cases.json`) também roda contra as Rules
 * no Emulator (`tests/firestore/work-time-p5f.rules.integration.test.mjs`).
 * `rules` é o que as Rules aceitam; `client`, o que o cliente aceita. O
 * cliente nunca aceita o que as Rules negam.
 */

type Case = {label: string; value: string; rules: boolean; client: boolean};
type Corpus = Record<'routines' | 'exceptions' | 'localHolidays' | 'excludedIncomeIds' | 'municipality' | 'incomeWorkspaceId' | 'uf', Case[]>;

const corpus = JSON.parse(
  readFileSync(new URL('../fixtures/work-time-grammar-cases.json', import.meta.url), 'utf8'),
) as Corpus;

const full = (pattern: string, flags = '') => new RegExp(`^${pattern}$`, flags);
const count = (value: string, separator: string) => value.split(separator).length;

/** Lista como nas Rules: vazia (quando permitido) ou texto + separador casando `(?:item<sep>)+`. */
const list = (value: string, pattern: string, separator: string, allowEmpty = true) =>
  (allowEmpty && value === '') || full(pattern).test(value + separator);

/** As mesmas checagens das Rules (tamanho, quantidade e padrão), em JavaScript. */
const rulesAccept: Record<keyof Corpus, (value: string) => boolean> = {
  routines: (value) => value.length <= MAX_ROUTINES_LENGTH && list(value, ROUTINES_LIST_PATTERN, ';', false),
  exceptions: (value) => value.length <= MAX_EXCEPTIONS_LENGTH && count(value, ';') <= MAX_EXCEPTIONS &&
    list(value, EXCEPTIONS_LIST_PATTERN, ';'),
  localHolidays: (value) => value.length <= MAX_LOCAL_HOLIDAYS_LENGTH && count(value, ';') <= MAX_LOCAL_HOLIDAYS &&
    list(value, LOCAL_HOLIDAYS_LIST_PATTERN, ';'),
  excludedIncomeIds: (value) => value.length <= MAX_EXCLUDED_IDS_LENGTH && count(value, ',') <= MAX_EXCLUDED_INCOME_IDS &&
    list(value, EXCLUDED_IDS_LIST_PATTERN, ','),
  municipality: (value) => value.length <= MAX_MUNICIPALITY_LENGTH && full(MUNICIPALITY_PATTERN, 'u').test(value),
  incomeWorkspaceId: (value) => full(RECORD_ID_PATTERN).test(value),
  uf: (value) => value === '' || (BRAZILIAN_UFS as readonly string[]).includes(value),
};

const clientAccept: Record<keyof Corpus, (value: string) => boolean> = {
  routines: (value) => parseRoutines(value) !== null,
  exceptions: (value) => parseExceptions(value) !== null,
  localHolidays: (value) => parseLocalHolidays(value) !== null,
  excludedIncomeIds: (value) => parseExcludedIds(value) !== null,
  municipality: (value) => isMunicipality(value),
  incomeWorkspaceId: (value) => isRecordId(value),
  uf: (value) => value === '' || (BRAZILIAN_UFS as readonly string[]).includes(value),
};

test('corpus: cada caso é aceito ou recusado pelo cliente e pela checagem das Rules como esperado', () => {
  let total = 0;
  for (const field of Object.keys(corpus) as Array<keyof Corpus>) {
    for (const item of corpus[field]) {
      total += 1;
      assert.equal(rulesAccept[field](item.value), item.rules, `${field} (Rules): ${item.label}`);
      assert.equal(clientAccept[field](item.value), item.client, `${field} (cliente): ${item.label}`);
      if (item.client) assert.ok(item.rules, `${field}: o cliente aceita o que as Rules negam (${item.label})`);
    }
  }
  assert.ok(total >= 110, 'corpus completo');
});

test('forma canônica: o que o cliente lê, ele grava igual', () => {
  for (const item of corpus.routines.filter((entry) => entry.client)) {
    assert.equal(formatRoutines(parseRoutines(item.value)!), item.value, item.label);
  }
  for (const item of corpus.exceptions.filter((entry) => entry.client)) {
    assert.equal(formatExceptions(parseExceptions(item.value)!), item.value, item.label);
  }
  for (const item of corpus.localHolidays.filter((entry) => entry.client)) {
    assert.equal(formatLocalHolidays(parseLocalHolidays(item.value)!), item.value, item.label);
  }
  for (const item of corpus.excludedIncomeIds.filter((entry) => entry.client)) {
    assert.equal(formatExcludedIds(parseExcludedIds(item.value)!), item.value, item.label);
  }
  // A gravação ordena e tira repetições.
  assert.equal(formatExcludedIds(['b', 'a', 'b']), 'a,b');
  assert.equal(formatLocalHolidays([
    {kind: 'date', date: '2026-06-04'}, {kind: 'annual', month: 7, day: 9}, {kind: 'annual', month: 7, day: 9},
  ]), '07-09;2026-06-04');
  assert.equal(formatExceptions([
    {kind: 'day_off', start: '2026-08-04', end: '2026-08-04'},
    {kind: 'day_off', start: '2026-08-03', end: '2026-08-03'},
  ]), 'O2026-08-03;O2026-08-04');
});

test('composição: os padrões completos são montados só com as peças compartilhadas com as Rules', () => {
  const window = `${TIME_PATTERN}-${TIME_PATTERN}/${MINUTES_0_PATTERN}`;
  assert.equal(DAY_PATTERN, `(?:-|D${MINUTES_1_PATTERN}|${window})`);
  assert.equal(WORK_DAY_PATTERN, `(?:D${MINUTES_1_PATTERN}|${window})`);
  assert.equal(ROUTINE_PATTERN,
    `(?:W:${DAY_PATTERN}(?:,${DAY_PATTERN}){6}|C:${DATE_PATTERN}:${CYCLE_COUNT_PATTERN}x${CYCLE_COUNT_PATTERN}:${WORK_DAY_PATTERN})`);
  assert.equal(ROUTINES_LIST_PATTERN, `(?:${ROUTINE_PATTERN};){1,3}`);
  const range = `${DATE_PATTERN}(?:/${DATE_PATTERN})?`;
  assert.equal(EXCEPTION_PATTERN,
    `(?:[FOA]${range}|H${DATE_PATTERN}|[PE]${DATE_PATTERN}[+]${MINUTES_1_PATTERN}|R${range}=${MINUTES_1_PATTERN}|S${DATE_PATTERN}=${MINUTES_0_PATTERN})`);
  assert.equal(EXCEPTIONS_LIST_PATTERN, `(?:${EXCEPTION_PATTERN};)+`);
  assert.equal(LOCAL_HOLIDAY_PATTERN, `(?:${DATE_PATTERN}|${ANNUAL_PATTERN})`);
  assert.equal(LOCAL_HOLIDAYS_LIST_PATTERN, `(?:${LOCAL_HOLIDAY_PATTERN};)+`);
  assert.equal(EXCLUDED_IDS_LIST_PATTERN, `(?:${RECORD_ID_PATTERN},)+`);
  // Nenhum item contém o próprio separador: a lista com uma cópia do item é exata.
  assert.doesNotMatch(ROUTINE_PATTERN + EXCEPTION_PATTERN + LOCAL_HOLIDAY_PATTERN, /;/);
  assert.equal(new RegExp(RECORD_ID_PATTERN).test(','), false, 'a classe do id não tem vírgula');
  // Só grupos sem captura, e abaixo do limite de 100 agrupamentos por expressão das Rules.
  for (const pattern of [ROUTINES_LIST_PATTERN, EXCEPTIONS_LIST_PATTERN, LOCAL_HOLIDAYS_LIST_PATTERN, EXCLUDED_IDS_LIST_PATTERN, MUNICIPALITY_PATTERN]) {
    assert.doesNotMatch(pattern, /\((?!\?:)/, 'grupo com captura');
    assert.ok((pattern.match(/\(\?:/g) ?? []).length < 100, `agrupamentos: ${pattern.slice(0, 20)}…`);
  }
  // Nenhuma peça usa barra invertida, exceto a classe de letras do município.
  for (const piece of [DATE_PATTERN, ANNUAL_PATTERN, MINUTES_0_PATTERN, MINUTES_1_PATTERN, TIME_PATTERN, CYCLE_COUNT_PATTERN, RECORD_ID_PATTERN]) {
    assert.doesNotMatch(piece, /\\/);
  }
});

test('peças: datas reais de 2000 a 2099, minutos sem zero à esquerda, horas válidas', () => {
  const date = full(DATE_PATTERN);
  let accepted = 0;
  for (let year = 2000; year <= 2099; year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      for (let day = 1; day <= 31; day += 1) {
        const text = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const real = new Date(Date.UTC(year, month - 1, day)).getUTCDate() === day;
        assert.equal(date.test(text), real, text);
        if (real) accepted += 1;
      }
    }
  }
  assert.equal(accepted, 36_525, 'todos os dias de 2000 a 2099');
  const minutes0 = full(MINUTES_0_PATTERN);
  const minutes1 = full(MINUTES_1_PATTERN);
  for (let value = 0; value <= 1500; value += 1) {
    assert.equal(minutes0.test(String(value)), value <= 1440, `0..1440: ${value}`);
    assert.equal(minutes1.test(String(value)), value >= 1 && value <= 1440, `1..1440: ${value}`);
  }
  for (const text of ['00', '01', '007', '-1', '1.5', '']) {
    assert.equal(minutes0.test(text), false, text);
  }
  const time = full(TIME_PATTERN);
  for (let hour = 0; hour <= 25; hour += 1) {
    for (const minute of [0, 30, 59, 60]) {
      const text = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
      assert.equal(time.test(text), hour <= 23 && minute <= 59, text);
    }
  }
});

test('exceções: checagens semânticas que as Rules não alcançam', () => {
  assert.equal(checkExceptions([{kind: 'vacation', start: '2026-07-17', end: '2026-07-06'}]), 'range_order');
  assert.equal(checkExceptions([{kind: 'vacation', start: '2026-01-01', end: '2027-01-02'}]), 'range_too_long');
  assert.equal(checkExceptions([{kind: 'vacation', start: '2026-01-01', end: '2027-01-01'}]), null, '366 dias');
  assert.equal(checkExceptions([
    {kind: 'reduced', start: '2026-07-01', end: '2026-07-10', minutes: 360},
    {kind: 'reduced', start: '2026-07-10', end: '2026-07-20', minutes: 240},
  ]), 'overlap');
  assert.equal(checkExceptions([
    {kind: 'vacation', start: '2026-07-01', end: '2026-07-10'},
    {kind: 'day_off', start: '2026-07-05', end: '2026-07-05'},
    {kind: 'on_call', date: '2026-07-05', minutes: 60},
    {kind: 'overtime', date: '2026-07-05', minutes: 60},
  ]), null, 'tipos diferentes podem coincidir');
});
