import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WORK_TIME_PREFERENCE_FIELDS,
  effectiveDisplayMode,
  isWorkTimeEnabled,
  parseWorkTimePreference,
  workTimePreferenceFields,
  workTimePreferencePathSegments,
  type WorkTimePreference,
} from '../../src/modules/work-time/contract.ts';
import {
  DEFAULT_WEEKLY_ROUTINE,
  addException,
  addLocalHoliday,
  buildException,
  dayInputFromSpec,
  describeException,
  describeLocalHoliday,
  formatDuration,
  initialDraft,
  isSameAsSaved,
  normalizeMunicipalityInput,
  parseDayInput,
  routinesAmbiguityMessage,
  routinesAmbiguityProblem,
  validateDraft,
  type DayInput,
} from '../../src/modules/work-time/draft.ts';
import type { DaySpec, WorkRoutine } from '../../src/modules/work-time/calendar.ts';
import {
  applyTemplate,
  editorResultOf,
  modelOf,
  routinesKey,
  type RoutineModel,
  type WeeklyModel,
} from '../../src/modules/work-time/routineModels.ts';

/*
 * P5-F (REQ-FUT-01), contrato v2 da P5-F.1 — documento privado e rascunho do
 * assistente/Configurações. O documento é lido com o mesmo rigor das Rules,
 * mais a semântica das gramáticas: campos exatos, tipos, gramáticas e forma
 * canônica; qualquer desvio vira "sem preferência" (dinheiro). O v1 (renda e
 * carga digitadas) não é lido: não há migração nem leitura dupla.
 */

const NBSP = ' ';
const show = (text: string) => text.replaceAll(NBSP, ' ');
const timestamp = { toMillis: () => 1_760_000_000_000 };
const ROUTINES = 'W:08:00-17:00/60,08:00-17:00/60,08:00-17:00/60,08:00-17:00/60,08:00-17:00/60,-,-';

const storedDocument = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 2,
  enabled: true,
  displayMode: 'time',
  estimateMode: 'habitual',
  historyMonths: 3,
  incomeWorkspaceId: 'ws_pf_1',
  allowBusinessIncome: false,
  excludedIncomeIds: 'cash_a,cash_b',
  routines: ROUTINES,
  worksOnHolidays: false,
  uf: 'SP',
  municipality: 'São Paulo',
  localHolidays: '01-25;2026-06-04',
  exceptions: 'F2026-07-06/2026-07-17;E2026-07-20+120',
  updatedAt: timestamp,
  ...overrides,
});

const PREFERENCE: WorkTimePreference = {
  enabled: true,
  displayMode: 'time',
  estimateMode: 'habitual',
  historyMonths: 3,
  incomeWorkspaceId: 'ws_pf_1',
  allowBusinessIncome: false,
  excludedIncomeIds: ['cash_a', 'cash_b'],
  routines: [DEFAULT_WEEKLY_ROUTINE],
  worksOnHolidays: false,
  uf: 'SP',
  municipality: 'São Paulo',
  localHolidays: [{ kind: 'annual', month: 1, day: 25 }, { kind: 'date', date: '2026-06-04' }],
  exceptions: [
    { kind: 'vacation', start: '2026-07-06', end: '2026-07-17' },
    { kind: 'overtime', date: '2026-07-20', minutes: 120 },
  ],
};

const TODAY = '2026-11-04';

test('caminho privado por usuário, fora do perfil server-owned e de qualquer workspace', () => {
  assert.deepEqual(workTimePreferencePathSegments('uid-123'), ['users', 'uid-123', 'private_preferences', 'work_time_equivalent']);
  for (const uid of ['', 'a/b', '.', '..', 'x'.repeat(129), undefined as unknown as string]) {
    assert.throws(() => workTimePreferencePathSegments(uid), /Usuário inválido/);
  }
});

test('leitura estrita: documento v2 válido vira preferência sem updatedAt', () => {
  assert.deepEqual(parseWorkTimePreference(storedDocument()), PREFERENCE);
  assert.deepEqual(parseWorkTimePreference(storedDocument({ enabled: false, displayMode: 'money' })), {
    ...PREFERENCE, enabled: false, displayMode: 'money',
  });
  assert.deepEqual(parseWorkTimePreference(storedDocument({ excludedIncomeIds: '', localHolidays: '', exceptions: '', uf: '', municipality: '' })), {
    ...PREFERENCE, excludedIncomeIds: [], localHolidays: [], exceptions: [], uf: '', municipality: '',
  });
});

test('leitura estrita: v1, campo a mais, campo a menos, tipo errado e gramática inválida não valem', () => {
  const { updatedAt: _ignored, ...withoutUpdatedAt } = storedDocument();
  const invalid: unknown[] = [
    null,
    'texto',
    [],
    withoutUpdatedAt,
    // Documento v1: não há migração nem leitura dupla.
    { schemaVersion: 1, enabled: true, displayMode: 'time', monthlyIncomeCents: 350_000, monthlyWorkMinutes: 10_400, updatedAt: timestamp },
    storedDocument({ schemaVersion: 1 }),
    storedDocument({ extra: true }),
    // Nada derivado no documento.
    storedDocument({ incomeCents: 350_000 }),
    storedDocument({ workMinutes: 9_600 }),
    storedDocument({ hourlyRateCents: 2_000 }),
    storedDocument({ workspaceId: 'ws-1' }),
    storedDocument({ enabled: 'true' }),
    storedDocument({ displayMode: 'hours' }),
    storedDocument({ estimateMode: 'annual' }),
    storedDocument({ historyMonths: 2 }),
    storedDocument({ historyMonths: '3' }),
    storedDocument({ incomeWorkspaceId: '' }),
    storedDocument({ incomeWorkspaceId: 'a/b' }),
    storedDocument({ allowBusinessIncome: 'false' }),
    storedDocument({ worksOnHolidays: 1 }),
    storedDocument({ uf: 'XX' }),
    storedDocument({ municipality: ' São Paulo' }),
    storedDocument({ routines: '' }),
    storedDocument({ routines: 'W:-,-,-,-,-,-,-' }),
    storedDocument({ routines: ['W:D480'] }),
    storedDocument({ exceptions: 'F2026-07-17/2026-07-06' }),
    storedDocument({ exceptions: 'O2026-08-04;O2026-08-03' }),
    storedDocument({ localHolidays: '02-29' }),
    storedDocument({ excludedIncomeIds: 'b,a' }),
    storedDocument({ updatedAt: '2026-10-18' }),
    storedDocument({ updatedAt: null }),
  ];
  for (const data of invalid) assert.equal(parseWorkTimePreference(data), null, JSON.stringify(data));
});

test('campos gravados pelo cliente: lista exata, forma canônica, sem updatedAt e sem valor derivado', () => {
  const fields = workTimePreferenceFields(PREFERENCE);
  assert.deepEqual(Object.keys(fields).sort(), WORK_TIME_PREFERENCE_FIELDS.filter((field) => field !== 'updatedAt').sort());
  const { updatedAt: _ignored, ...expected } = storedDocument();
  assert.deepEqual(fields, expected);
  for (const forbidden of ['incomeCents', 'workMinutes', 'hourlyRateCents', 'monthlyIncomeCents', 'monthlyWorkMinutes']) {
    assert.equal(forbidden in fields, false, forbidden);
  }
  // A gravação ordena e tira repetição; o que sai é o que a leitura aceita.
  const shuffled = { ...PREFERENCE, excludedIncomeIds: ['cash_b', 'cash_a', 'cash_b'], exceptions: [...PREFERENCE.exceptions].reverse() };
  assert.deepEqual(workTimePreferenceFields(shuffled), fields);
  assert.throws(() => workTimePreferenceFields({ ...PREFERENCE, routines: [] }), /inválida/);
  assert.throws(() => workTimePreferenceFields({ ...PREFERENCE, incomeWorkspaceId: '' }), /inválida/);
  assert.throws(() => workTimePreferenceFields({ ...PREFERENCE, displayMode: 'hours' as 'time' }), /inválida/);
  assert.throws(() => workTimePreferenceFields({
    ...PREFERENCE,
    exceptions: [
      { kind: 'day_off', start: '2026-08-03', end: '2026-08-04' },
      { kind: 'day_off', start: '2026-08-04', end: '2026-08-05' },
    ],
  }), /inválida/);
});

test('modo efetivo: tempo só com preferência válida, ligada e em modo tempo; o padrão é dinheiro', () => {
  assert.equal(effectiveDisplayMode(null), 'money');
  assert.equal(effectiveDisplayMode({ ...PREFERENCE, enabled: false }), 'money');
  assert.equal(effectiveDisplayMode({ ...PREFERENCE, displayMode: 'money' }), 'money');
  assert.equal(effectiveDisplayMode(PREFERENCE), 'time');
  assert.equal(isWorkTimeEnabled(null), false);
  assert.equal(isWorkTimeEnabled({ ...PREFERENCE, enabled: false }), false);
  assert.equal(isWorkTimeEnabled({ ...PREFERENCE, displayMode: 'money' }), true);
});

test('revisão 2 da R1 (M06): uma data de exceção fora do formato dá a mensagem do formato, sem exceção sem tratamento', () => {
  // Com uma janela com intervalo coberta, o conferidor do calendário lê as datas das exceções (sem ela, o pré-filtro
  // devolve antes e a data só chega à checagem do formato).
  const window = (start: number, end: number, breakMinutes = 0): DaySpec => ({ kind: 'window', start, end, breakMinutes });
  const off: DaySpec = { kind: 'off' };
  const only = (index: number, spec: DaySpec): WorkRoutine => ({ kind: 'weekly', days: Array.from({ length: 7 }, (_, day) => (day === index ? spec : off)) });
  const routines = [only(0, window(1200, 0)), only(0, window(1320, 120, 30)), only(1, window(0, 480))];
  const covered = { ...initialDraft('ws_pf_1'), routines, worksOnHolidays: true };
  assert.deepEqual(validateDraft(covered, '2026-10-01'), { ok: true });
  for (const exceptions of [
    [{ kind: 'vacation' as const, start: '2026-02-30', end: '2026-03-02' }],
    [{ kind: 'day_off' as const, start: '2026-10-20', end: '2026-13-01' }],
  ]) {
    assert.deepEqual(validateDraft({ ...covered, exceptions }, '2026-10-01'), { ok: false, section: 'exceptions', message: 'Há exceções sobrepostas ou fora do formato. Revise a lista.' });
  }
});

test('rascunho inicial: semana comercial, renda PF escolhida, modo habitual de 3 meses e exibição em reais', () => {
  const draft = initialDraft('ws_pf_1');
  assert.deepEqual(validateDraft(draft, TODAY), { ok: true });
  assert.equal(draft.estimateMode, 'habitual');
  assert.equal(draft.historyMonths, 3);
  assert.equal(draft.displayMode, 'money', 'nada muda na tela até a pessoa escolher o tempo');
  assert.equal(draft.allowBusinessIncome, false);
  assert.equal(workTimePreferenceFields(draft).routines, ROUTINES);
  assert.deepEqual(validateDraft(initialDraft(''), TODAY), { ok: false, section: 'income', message: 'Escolha de qual espaço vem a sua renda.' });
});

test('dia da rotina: horário, duração, turno que passa da meia-noite e mensagens em pt-BR', () => {
  const base: DayInput = { mode: 'window', start: '08:00', end: '17:00', breakMinutes: '60', hours: '', minutes: '' };
  assert.deepEqual(parseDayInput(base), { ok: true, spec: { kind: 'window', start: 480, end: 1020, breakMinutes: 60 } });
  assert.deepEqual(parseDayInput({ ...base, start: '22:00', end: '06:00', breakMinutes: '' }),
    { ok: true, spec: { kind: 'window', start: 1320, end: 360, breakMinutes: 0 } });
  assert.deepEqual(parseDayInput({ ...base, mode: 'duration', hours: '7', minutes: '30' }), { ok: true, spec: { kind: 'duration', minutes: 450 } });
  assert.deepEqual(parseDayInput({ ...base, mode: 'off' }), { ok: true, spec: { kind: 'off' } });
  const failures: Array<[DayInput, RegExp]> = [
    [{ ...base, start: '8:00' }, /formato 08:00/],
    [{ ...base, end: '24:00' }, /formato 08:00/],
    [{ ...base, breakMinutes: '540' }, /intervalo precisa ser menor/],
    [{ ...base, breakMinutes: '-5' }, /minutos inteiros/],
    [{ ...base, mode: 'duration', hours: '0', minutes: '0' }, /maior que zero/],
    [{ ...base, mode: 'duration', hours: '25', minutes: '0' }, /24 horas/],
    [{ ...base, mode: 'duration', hours: '8', minutes: '60' }, /0 a 59/],
    [{ ...base, mode: 'duration', hours: '8,5', minutes: '' }, /horas inteiras/],
  ];
  for (const [input, message] of failures) {
    const result = parseDayInput(input);
    assert.equal(result.ok, false, JSON.stringify(input));
    assert.match((result as { message: string }).message, message);
  }
  for (const spec of DEFAULT_WEEKLY_ROUTINE.kind === 'weekly' ? DEFAULT_WEEKLY_ROUTINE.days : []) {
    assert.deepEqual(parseDayInput(dayInputFromSpec(spec)), { ok: true, spec }, 'ida e volta');
  }
});

test('exceções: montagem, sobreposição do mesmo tipo, limites e descrição em pt-BR', () => {
  const vacation = buildException({ kind: 'vacation', start: '2026-07-06', end: '2026-07-17', hours: '', minutes: '' });
  assert.deepEqual(vacation, { ok: true, entry: { kind: 'vacation', start: '2026-07-06', end: '2026-07-17' } });
  const overtime = buildException({ kind: 'overtime', start: '2026-07-20', end: '', hours: '2', minutes: '' });
  assert.deepEqual(overtime, { ok: true, entry: { kind: 'overtime', date: '2026-07-20', minutes: 120 } });
  const change = buildException({ kind: 'schedule_change', start: '2026-07-25', end: '', hours: '0', minutes: '0' });
  assert.deepEqual(change, { ok: true, entry: { kind: 'schedule_change', date: '2026-07-25', minutes: 0 } }, 'escala pode zerar o dia');
  assert.deepEqual(buildException({ kind: 'overtime', start: '2026-07-20', end: '', hours: '0', minutes: '' }),
    { ok: false, field: 'minutes', message: 'Informe um tempo maior que zero.' });
  assert.deepEqual(buildException({ kind: 'vacation', start: '2026-07-17', end: '2026-07-06', hours: '', minutes: '' }),
    { ok: false, field: 'end', message: 'A data final precisa ser igual ou posterior à inicial.' });
  assert.deepEqual(buildException({ kind: 'vacation', start: '2026-01-01', end: '2027-01-02', hours: '', minutes: '' }),
    { ok: false, field: 'end', message: 'O intervalo pode ter no máximo 366 dias.' });
  assert.deepEqual(buildException({ kind: 'day_off', start: '2026-02-30', end: '', hours: '', minutes: '' }),
    { ok: false, field: 'start', message: 'Escolha uma data válida entre 2000 e 2099.' });

  const first = addException([], (vacation as unknown as { entry: never }).entry);
  assert.equal(first.ok, true);
  const clash = addException((first as unknown as { entries: never[] }).entries, { kind: 'vacation', start: '2026-07-17', end: '2026-07-20' });
  assert.deepEqual(clash, { ok: false, message: 'Já existe férias nessas datas.' });
  const otherKind = addException((first as unknown as { entries: never[] }).entries, { kind: 'day_off', start: '2026-07-10', end: '2026-07-10' });
  assert.equal(otherKind.ok, true, 'tipos diferentes podem coincidir');
  assert.equal(show(describeException({ kind: 'vacation', start: '2026-07-06', end: '2026-07-17' })), 'Férias de 06/07/2026 a 17/07/2026');
  assert.equal(show(describeException({ kind: 'overtime', date: '2026-07-20', minutes: 150 })), 'Hora extra em 20/07/2026: mais 2 h 30 min');
  assert.equal(show(describeException({ kind: 'reduced', start: '2026-07-21', end: '2026-07-31', minutes: 360 })),
    'Jornada reduzida de 21/07/2026 a 31/07/2026: até 6 h por dia de trabalho');
  assert.equal(show(describeException({ kind: 'schedule_change', date: '2026-07-25', minutes: 0 })), 'Alteração de escala em 25/07/2026: 0 h no dia');
});

test('município digitado: apóstrofo do celular e acento decomposto viram a forma aceita pelas Rules', () => {
  const typed = normalizeMunicipalityInput('Santa Bárbara d\u2019Oeste');
  assert.equal(typed, "Santa Bárbara d'Oeste");
  assert.equal(validateDraft({ ...initialDraft('ws'), municipality: typed }, TODAY).ok, true);
  assert.equal(normalizeMunicipalityInput('Sa\u0303o   Paulo'), 'São Paulo');
  assert.equal(normalizeMunicipalityInput('  Mogi das Cruzes'), 'Mogi das Cruzes');
  // Sem a normalização, as mesmas entradas seriam recusadas.
  assert.equal(validateDraft({ ...initialDraft('ws'), municipality: 'Santa Bárbara d\u2019Oeste' }, TODAY).ok, false);
  assert.equal(validateDraft({ ...initialDraft('ws'), municipality: 'Sa\u0303o Paulo' }, TODAY).ok, false);
});

test('feriados locais: anual ou data, sem 29/02 anual, sem repetição, até 40', () => {
  assert.equal(describeLocalHoliday({ kind: 'annual', month: 1, day: 25 }), '25 de janeiro, todo ano');
  assert.equal(describeLocalHoliday({ kind: 'date', date: '2026-06-04' }), '04/06/2026');
  assert.deepEqual(addLocalHoliday([], { kind: 'annual', month: 2, day: 29 }),
    { ok: false, message: 'Escolha um dia e um mês válidos (29 de fevereiro não pode ser anual).' });
  const one = addLocalHoliday([], { kind: 'annual', month: 1, day: 25 });
  assert.equal(one.ok, true);
  assert.deepEqual(addLocalHoliday((one as unknown as { holidays: never[] }).holidays, { kind: 'annual', month: 1, day: 25 }),
    { ok: false, message: 'Esse feriado já está na lista.' });
  const forty = Array.from({ length: 40 }, (_, index) => ({ kind: 'annual' as const, month: 1 + Math.floor(index / 28), day: 1 + (index % 28) }));
  assert.deepEqual(addLocalHoliday(forty, { kind: 'date', date: '2026-12-08' }), { ok: false, message: 'Você pode registrar até 40 feriados locais.' });
});

test('B02 (revisão da R1, N07): salvar recusa a configuração que fica sem cálculo seguro por exceção, feriado ou início do período, na seção que resolve', () => {
  const window = (start: number, end: number, breakMinutes = 0): DaySpec => ({ kind: 'window', start, end, breakMinutes });
  const off: DaySpec = { kind: 'off' };
  const only = (index: number, spec: DaySpec): WorkRoutine => ({ kind: 'weekly', days: Array.from({ length: 7 }, (_, day) => (day === index ? spec : off)) });
  // Segunda 20:00–24:00, segunda 22:00–02:00 com 30 min e terça 00:00–08:00: a janela com intervalo fica coberta.
  const routines = [only(0, window(1200, 0)), only(0, window(1320, 120, 30)), only(1, window(0, 480))];
  const draft = { ...initialDraft('ws_pf_1'), routines, worksOnHolidays: true };
  assert.deepEqual(validateDraft(draft, '2026-10-01'), { ok: true });
  // A folga na terça tira a janela que cobria o trecho depois da meia-noite: recusado, na seção das exceções.
  const withDayOff = { ...draft, exceptions: [{ kind: 'day_off' as const, start: '2026-10-20', end: '2026-10-20' }] };
  assert.deepEqual(validateDraft(withDayOff, '2026-10-01'), {
    ok: false,
    section: 'exceptions',
    ambiguity: 'neighbor',
    message: 'A Rotina 1 e a Rotina 2 se cruzam em segunda-feira, 19/10/2026, e há intervalo no trecho em comum. Com a folga de terça-feira, 20/10/2026, o horário sem intervalo que cobria esse trecho não acontece: não dá para saber onde cai a pausa, então as horas não podem ser calculadas com segurança. Ajuste os horários das rotinas ou essa exceção.',
  });
  // O feriado local na terça, sem trabalhar em feriados: na seção dos feriados, com a saída de marcá-lo como trabalhado.
  const withHoliday = { ...draft, worksOnHolidays: false, localHolidays: [{ kind: 'date' as const, date: '2026-10-27' }] };
  const holiday = validateDraft(withHoliday, '2026-10-01');
  assert.deepEqual(holiday, {
    ok: false,
    section: 'holidays',
    ambiguity: 'neighbor',
    message: 'A Rotina 1 e a Rotina 2 se cruzam em segunda-feira, 26/10/2026, e há intervalo no trecho em comum. Com o feriado (Feriado local) de terça-feira, 27/10/2026, o horário sem intervalo que cobria esse trecho não acontece: não dá para saber onde cai a pausa, então as horas não podem ser calculadas com segurança. Ajuste os horários das rotinas ou marque esse feriado como trabalhado.',
  });
  // O feriado nacional na terça também: Tiradentes (21/04/2026).
  const national = validateDraft({ ...draft, worksOnHolidays: false }, '2026-04-01');
  assert.equal('message' in national && national.message.includes('Com o feriado (Tiradentes) de terça-feira, 21/04/2026'), true);
  // O primeiro dia do mês que abre o período, sem a véspera: na seção das rotinas.
  const sundayCover = [
    only(6, window(1200, 240)),
    only(0, window(60, 300, 30)),
    only(0, window(180, 360)),
  ];
  const periodStart = validateDraft({ ...draft, routines: sundayCover }, '2026-05-10');
  assert.deepEqual(periodStart, {
    ok: false,
    section: 'routines',
    ambiguity: 'period_start',
    message: 'A Rotina 2 e a Rotina 3 se cruzam em segunda-feira, 01/06/2026, e há intervalo no trecho em comum. É o primeiro dia de um mês, que pode abrir o período da estimativa, e o horário da véspera que cobria esse trecho fica fora dele: não dá para saber onde cai a pausa, então as horas não podem ser calculadas com segurança. Ajuste os horários para que não se cruzem ou deixe sem intervalo as rotinas que se cruzam.',
  });
  // A recusa vem antes da escolha da renda: no assistente, aparece no passo das rotinas, dos feriados ou das exceções.
  assert.equal((validateDraft({ ...withDayOff, incomeWorkspaceId: '' }, '2026-10-01') as { section?: string }).section, 'exceptions');
});

test('B02 (P5-F.1-R2A, S01): salvar recusa a jornada reduzida que deixa o dia seguinte sem cálculo seguro, na seção das exceções, com mensagem em pt-BR', () => {
  const window = (start: number, end: number): DaySpec => ({ kind: 'window', start, end, breakMinutes: 0 });
  const off: DaySpec = { kind: 'off' };
  // Segunda 20:00–06:00 e terça 00:00–08:00, sem intervalo: aceita sem exceção (600 + 120 min).
  const routines: WorkRoutine[] = [{ kind: 'weekly', days: [window(1200, 360), window(0, 480), off, off, off, off, off] }];
  const draft = { ...initialDraft('ws_pf_1'), routines, worksOnHolidays: true };
  assert.deepEqual(validateDraft(draft, '2026-11-06'), { ok: true });
  const reduced = { kind: 'reduced' as const, start: '2026-10-05', end: '2026-10-05', minutes: 480 };
  assert.deepEqual(validateDraft({ ...draft, exceptions: [reduced] }, '2026-11-06'), {
    ok: false,
    section: 'exceptions',
    ambiguity: 'reduced_eve',
    message: 'Com a jornada reduzida de segunda-feira, 05/10/2026, não dá para confirmar que parte do horário que passa da meia-noite (Rotina 1) foi trabalhada, e por isso as horas de terça-feira, 06/10/2026, não podem ser calculadas com segurança. Troque a jornada reduzida desse dia por uma alteração de escala ou ajuste os horários das rotinas.',
  });
  // Com o turno em duas rotinas, a mensagem cita as duas.
  const twoNights: WorkRoutine[] = [...routines, { kind: 'weekly', days: [window(1380, 480), off, off, off, off, off, off] }];
  const both = validateDraft({ ...draft, routines: twoNights, exceptions: [reduced] }, '2026-11-06');
  assert.equal('message' in both && both.message.includes('passa da meia-noite (Rotina 1 e Rotina 2) foi trabalhada'), true);
  // A alteração de escala no lugar da redução, ou a redução que não corta nada (10 h), são aceitas.
  assert.deepEqual(validateDraft({ ...draft, exceptions: [{ kind: 'schedule_change', date: '2026-10-05', minutes: 480 }] }, '2026-11-06'), { ok: true });
  assert.deepEqual(validateDraft({ ...draft, exceptions: [{ ...reduced, minutes: 600 }] }, '2026-11-06'), { ok: true });
  // A recusa vem antes da escolha da renda: no assistente, aparece no passo das exceções.
  assert.equal((validateDraft({ ...draft, exceptions: [reduced], incomeWorkspaceId: '' }, '2026-11-06') as { section?: string }).section, 'exceptions');
});

test('rascunho: validação por seção, prévia sem salvar e comparação com o que está salvo', () => {
  const draft = initialDraft('ws_pf_1');
  assert.deepEqual(validateDraft({ ...draft, routines: [] }, TODAY), { ok: false, section: 'routines', message: 'Informe pelo menos uma rotina de trabalho.' });
  assert.deepEqual(validateDraft({ ...draft, routines: [{ kind: 'weekly', days: Array(7).fill({ kind: 'off' }) }] }, TODAY),
    { ok: false, section: 'routines', message: 'A rotina precisa ter pelo menos um dia de trabalho.' });
  assert.equal(validateDraft({ ...draft, municipality: 'São Paulo1' }, TODAY).ok, false);
  // B02: rotinas que se cruzam com intervalo no trecho em comum são recusadas, com quais e um dia em que acontece.
  const morning: WorkRoutine = { kind: 'weekly', days: [0, 1, 2, 3, 4].map((): DaySpec => ({ kind: 'window', start: 480, end: 840, breakMinutes: 30 })).concat([{ kind: 'off' }, { kind: 'off' }]) };
  const afternoon: WorkRoutine = { kind: 'weekly', days: [0, 1, 2, 3, 4].map((): DaySpec => ({ kind: 'window', start: 720, end: 1080, breakMinutes: 30 })).concat([{ kind: 'off' }, { kind: 'off' }]) };
  const refused = validateDraft({ ...draft, routines: [morning, afternoon] }, TODAY);
  assert.deepEqual(refused, { ok: false, section: 'routines', ambiguity: 'routines', message: 'A Rotina 1 e a Rotina 2 se cruzam em quarta-feira, 04/11/2026, e há intervalo no trecho em comum: não dá para saber onde cai a pausa, então as horas não podem ser calculadas com segurança. Ajuste os horários para que não se cruzem ou deixe sem intervalo as rotinas que se cruzam.' });
  assert.equal(routinesAmbiguityProblem([morning, afternoon], '2026-11-07'), refused.ok ? null : refused.message.replace('quarta-feira, 04/11/2026', 'segunda-feira, 09/11/2026'), 'o primeiro dia a partir de hoje');
  const contained: WorkRoutine = { kind: 'weekly', days: [{ kind: 'window', start: 540, end: 660, breakMinutes: 90 }, { kind: 'off' }, { kind: 'off' }, { kind: 'off' }, { kind: 'off' }, { kind: 'off' }, { kind: 'off' }] };
  const container: WorkRoutine = { kind: 'weekly', days: [{ kind: 'window', start: 480, end: 720, breakMinutes: 0 }, { kind: 'off' }, { kind: 'off' }, { kind: 'off' }, { kind: 'off' }, { kind: 'off' }, { kind: 'off' }] };
  assert.deepEqual(validateDraft({ ...draft, routines: [container, contained] }, TODAY), { ok: true }, 'contida numa janela sem intervalo: cálculo seguro');
  // A mesma rotina que se cruza de um dia para o outro, e três rotinas.
  assert.equal(routinesAmbiguityMessage({ date: '2026-10-05', routines: [0] }).startsWith('A Rotina 1 se cruza com ela mesma de um dia para o outro em segunda-feira, 05/10/2026, e há intervalo'), true);
  assert.equal(routinesAmbiguityMessage({ date: '2026-10-05', routines: [0, 1, 2] }).startsWith('A Rotina 1, a Rotina 2 e a Rotina 3 se cruzam em segunda-feira, 05/10/2026'), true);
  assert.equal(validateDraft({ ...draft, excludedIncomeIds: Array.from({ length: 51 }, (_, index) => `id${index}`) }, TODAY).ok, false);
  assert.equal(isSameAsSaved(draft, null), false);
  assert.equal(isSameAsSaved(draft, { ...draft }), true);
  assert.equal(isSameAsSaved({ ...draft, worksOnHolidays: true }, draft), false);
  assert.equal(show(formatDuration(152 * 60)), '152 h');
  assert.equal(show(formatDuration(450)), '7 h 30 min');
  assert.equal(show(formatDuration(1_234 * 60)), '1.234 h');
});

// ----------------------------------------------- P5-F.1-R2A, S03: o que conta como edição no editor de rotinas

const S03_TODAY = '2026-11-06';
const s03Window = (start: number, end: number, breakMinutes = 0): DaySpec => ({ kind: 'window', start, end, breakMinutes });
const s03Off: DaySpec = { kind: 'off' };
const everyDay = (spec: DaySpec): WorkRoutine => ({ kind: 'weekly', days: Array(7).fill(spec) });
const weekdaysOnly = (spec: DaySpec): WorkRoutine => ({ kind: 'weekly', days: [spec, spec, spec, spec, spec, s03Off, s03Off] });
/** 08:00–12:00 e 13:00–17:00 sem intervalo todos os dias, e 11:00–14:00 com 60 min nos dias úteis: a configuração do E2E. */
const HALVES: WorkRoutine[] = [everyDay(s03Window(480, 720)), everyDay(s03Window(780, 1020))];
const CROSSING: WorkRoutine[] = [...HALVES, weekdaysOnly(s03Window(660, 840, 60))];
const withModel = (models: readonly RoutineModel[], index: number, change: (model: WeeklyModel) => WeeklyModel): RoutineModel[] =>
  models.map((model, position) => (position === index ? change(model as WeeklyModel) : model));

test('S03 (P5-F.1-R2A): a configuração gravada que o editor recusa ao montar não é edição; a jornada para aplicar a vários dias só conta quando aplicada', () => {
  const initial = CROSSING.map(modelOf);
  const key = routinesKey(initial);
  const mounted = editorResultOf(initial, key, S03_TODAY);
  assert.equal(mounted.result.ok, false);
  assert.equal('edited' in mounted.result && mounted.result.edited, false, 'recusada ao montar, sem edição');
  assert.match(mounted.ambiguity ?? '', /se cruzam em/);
  // A jornada para aplicar a vários dias da rotina 3 começa no primeiro dia de trabalho (11:00–14:00, 60 min).
  assert.deepEqual((initial[2] as WeeklyModel).template, { ...(initial[2] as WeeklyModel).days[0] });
  // Mudar só o "Fim" dessa jornada, sem aplicar: as rotinas, a chave e a recusa não mudam.
  const templateOnly = withModel(initial, 2, (model) => ({ ...model, template: { ...model.template, end: '15:00' } }));
  assert.equal(routinesKey(templateOnly), key);
  assert.deepEqual(editorResultOf(templateOnly, key, S03_TODAY), mounted);
  // Mudar a jornada para um valor inválido, sem aplicar, também não: ela não entra nas rotinas.
  const templateInvalid = withModel(initial, 2, (model) => ({ ...model, template: { ...model.template, end: '' } }));
  assert.deepEqual(editorResultOf(templateInvalid, key, S03_TODAY), mounted);
  // "Aplicar aos dias marcados": de segunda a sexta passam a 11:00–15:00; sábado e domingo continuam sem trabalho.
  const applied = withModel(templateOnly, 2, applyTemplate);
  assert.deepEqual((applied[2] as WeeklyModel).days.map((day) => (day.mode === 'off' ? '-' : `${day.start}-${day.end}`)),
    ['11:00-15:00', '11:00-15:00', '11:00-15:00', '11:00-15:00', '11:00-15:00', '-', '-']);
  assert.notEqual(routinesKey(applied), key);
  const appliedResult = editorResultOf(applied, key, S03_TODAY);
  assert.equal('edited' in appliedResult.result && appliedResult.result.edited, true, 'a recusa passa a ser uma edição');
  assert.match(appliedResult.ambiguity ?? '', /se cruzam em/, 'continua com o cruzamento');
  // Voltar à configuração gravada (o "Descartar" monta o editor de novo) desfaz a edição.
  const remounted = CROSSING.map(modelOf);
  assert.deepEqual(editorResultOf(remounted, routinesKey(remounted), S03_TODAY), mounted);
  assert.equal((remounted[2] as WeeklyModel).template.end, '14:00', 'a jornada volta a 14:00');
});

test('S03 (P5-F.1-R2A): digitação inválida num dia ou na escala é edição, com a mensagem do problema', () => {
  const initial = CROSSING.map(modelOf);
  const key = routinesKey(initial);
  // Apagar o "Fim" de segunda na rotina 3.
  const cleared = withModel(initial, 2, (model) => ({ ...model, days: model.days.map((day, index) => (index === 0 ? { ...day, end: '' } : day)) }));
  assert.deepEqual(editorResultOf(cleared, key, S03_TODAY), {
    result: { ok: false, message: 'Rotina 3, segunda-feira: Use horários no formato 08:00.', edited: true },
    ambiguity: null,
  });
  // Um intervalo maior que a jornada, numa configuração válida.
  const valid = HALVES.map(modelOf);
  const validKey = routinesKey(valid);
  assert.deepEqual(editorResultOf(valid, validKey, S03_TODAY), { result: { ok: true, routines: HALVES }, ambiguity: null });
  const longBreak = withModel(valid, 0, (model) => ({ ...model, days: model.days.map((day, index) => (index === 2 ? { ...day, breakMinutes: '300' } : day)) }));
  assert.deepEqual(editorResultOf(longBreak, validKey, S03_TODAY).result,
    { ok: false, message: 'Rotina 1, quarta-feira: O intervalo precisa ser menor que o tempo entre o início e o fim.', edited: true });
  // Corrigir de volta ao valor gravado desfaz a edição.
  const fixed = withModel(longBreak, 0, (model) => ({ ...model, days: model.days.map((day, index) => (index === 2 ? { ...day, breakMinutes: '0' } : day)) }));
  assert.deepEqual(editorResultOf(fixed, validKey, S03_TODAY), { result: { ok: true, routines: HALVES }, ambiguity: null });
  // Escala cíclica: a jornada de cada dia de trabalho é a própria escala, e o ciclo inválido também é edição.
  const cyclic = [modelOf({ kind: 'cyclic', reference: '2026-10-01', workDays: 1, restDays: 1, day: s03Window(420, 1140) })];
  const cyclicKey = routinesKey(cyclic);
  const zeroRest = cyclic.map((model) => ({ ...model, restDays: '0' }) as RoutineModel);
  assert.deepEqual(editorResultOf(zeroRest, cyclicKey, S03_TODAY).result,
    { ok: false, message: 'Rotina 1: o ciclo vai de 1 a 28 dias de trabalho e de 1 a 28 dias de folga.', edited: true });
});

