import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calendarAmbiguity,
  dayPlan,
  monthPlan,
  routinesAmbiguity,
  type DaySpec,
  type MonthPlan,
  type WorkCalendar,
  type WorkException,
  type WorkRoutine,
} from '../../src/modules/work-time/calendar.ts';
import {
  addDays,
  dayNumber,
  daysInMonth,
  isCivilDate,
  isMonthKey,
  shiftMonthKey,
  weekdayIndex,
} from '../../src/modules/work-time/dates.ts';
import {
  NATIONAL_HOLIDAY_BASE_FROM,
  easterSunday,
  electionSundayDate,
  movableObservanceDate,
  nationalHolidayOn,
  nationalHolidaysOfYear,
} from '../../src/modules/work-time/holidays.ts';

/*
 * P5-F.1 — motor de calendário puro: horas planejadas por mês a partir das
 * rotinas, dos feriados nacionais por lei e das exceções do usuário.
 */

const window = (start: string, end: string, breakMinutes = 0): DaySpec => {
  const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  return { kind: 'window', start: toMinutes(start), end: toMinutes(end), breakMinutes };
};
const OFF: DaySpec = { kind: 'off' };
const duration = (minutes: number): DaySpec => ({ kind: 'duration', minutes });
const weekly = (...days: DaySpec[]): WorkRoutine => ({ kind: 'weekly', days });
const weekdays = (spec: DaySpec): WorkRoutine => weekly(spec, spec, spec, spec, spec, OFF, OFF);
/** 08:00–17:00 com 1 h de intervalo: 8 h efetivas por dia útil. */
const OFFICE = weekdays(window('08:00', '17:00', 60));

const calendar = (patch: Partial<WorkCalendar> = {}): WorkCalendar => ({
  routines: [OFFICE],
  worksOnHolidays: false,
  localHolidays: [],
  exceptions: [],
  ...patch,
});
const hours = (minutes: number) => minutes / 60;

test('datas civis: dias reais, anos bissextos, intervalo 2000–2099 e dia da semana ISO', () => {
  for (const date of ['2024-02-29', '2000-02-29', '2026-12-31', '2000-01-01', '2099-12-31']) assert.ok(isCivilDate(date), date);
  for (const date of ['2026-02-29', '2100-02-29', '1999-12-31', '2100-01-01', '2026-13-01', '2026-04-31', '2026-1-01', 20260101, null]) {
    assert.equal(isCivilDate(date), false, String(date));
  }
  assert.equal(daysInMonth(2024, 2), 29);
  assert.equal(daysInMonth(2025, 2), 28);
  assert.equal(daysInMonth(2000, 2), 29, '2000 é divisível por 400');
  assert.equal(weekdayIndex('2026-11-04'), 2, 'quarta-feira');
  assert.equal(weekdayIndex('2024-02-29'), 3, 'quinta-feira');
  assert.equal(weekdayIndex('2026-11-01'), 6, 'domingo');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2025-02-28', 1), '2025-03-01');
  assert.equal(addDays('2000-01-01', -1), null);
  assert.equal(dayNumber('2026-01-01') - dayNumber('2025-01-01'), 365);
  assert.equal(shiftMonthKey('2026-01', -1), '2025-12');
  assert.equal(shiftMonthKey('2026-11', -12), '2025-11');
  assert.equal(shiftMonthKey('2000-01', -1), null);
  assert.ok(isMonthKey('2026-11'));
  assert.equal(isMonthKey('2026-00'), false);
});

test('horas do mês são do próprio mês, nunca uma carga fixa de 220 h', () => {
  // Fevereiro/2026: 20 dias úteis, nenhum feriado nacional → 20 × 8 = 160 h.
  assert.equal(hours(monthPlan(calendar(), '2026-02').minutes), 160);
  // Novembro/2026: 21 dias úteis menos Finados (2, segunda) e Consciência Negra (20, sexta) → 19 × 8 = 152 h.
  const november = monthPlan(calendar(), '2026-11');
  assert.equal(hours(november.minutes), 152);
  assert.equal(november.workDays, 19);
  assert.deepEqual(november.holidaysOff.map((item) => item.date), ['2026-11-02', '2026-11-20']);
  // 15/11/2026 é domingo: feriado em dia sem trabalho não reduz nada (sem desconto em dobro).
  assert.deepEqual(november.holidaysOnRestDays.map((item) => item.date), ['2026-11-15']);
  // Janeiro/2026: 22 dias úteis menos 1º de janeiro (quinta) → 168 h.
  assert.equal(hours(monthPlan(calendar(), '2026-01').minutes), 168);
  // Fevereiro bissexto: 2024 tem 21 dias úteis (168 h); 2025, 20 (160 h).
  assert.equal(hours(monthPlan(calendar(), '2024-02').minutes), 168);
  assert.equal(hours(monthPlan(calendar(), '2025-02').minutes), 160);
  const totals = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']
    .map((month) => hours(monthPlan(calendar(), month).minutes));
  assert.ok(totals.every((value) => value !== 220));
  assert.ok(new Set(totals).size > 1, 'meses diferentes, horas diferentes');
});

test('feriados nacionais por lei, com vigência; pontos facultativos e datas religiosas municipais nunca automáticos', () => {
  assert.deepEqual(nationalHolidaysOfYear(2026).map((item) => item.date), [
    '2026-01-01', '2026-04-21', '2026-05-01', '2026-09-07', '2026-10-12', '2026-11-02', '2026-11-15', '2026-11-20', '2026-12-25',
  ]);
  // Lei 14.759/2023: 20 de novembro a partir de 2024.
  assert.equal(nationalHolidayOn('2023-11-20'), null);
  assert.equal(nationalHolidayOn('2024-11-20')?.law, 'Lei nº 14.759/2023');
  assert.equal(nationalHolidayOn('2026-10-12')?.law, 'Lei nº 6.802/1980');
  assert.match(nationalHolidayOn('2026-11-02')?.law ?? '', /Lei nº 662\/1949.*Lei nº 10\.607\/2002/);
  // Antes do início da base, nada é automático (e o mês é sinalizado).
  assert.equal(nationalHolidayOn(`${NATIONAL_HOLIDAY_BASE_FROM - 1}-12-25`), null);
  assert.equal(monthPlan(calendar(), '2002-12').nationalHolidayBaseCovered, false);
  assert.equal(monthPlan(calendar(), '2003-01').nationalHolidayBaseCovered, true);
  // Carnaval, Sexta-feira da Paixão e Corpus Christi de 2026 continuam dias de trabalho.
  for (const id of ['carnival_monday', 'carnival_tuesday', 'good_friday', 'corpus_christi'] as const) {
    const date = movableObservanceDate(id, 2026);
    assert.ok(date);
    assert.equal(nationalHolidayOn(date), null, id);
    assert.equal(dayPlan(calendar(), date).minutes, 480, `${id} (${date}) é dia útil sem feriado local`);
  }
});

test('domingos de eleição: só atalho, nunca automáticos; 1º e último domingo de outubro dos anos pares', () => {
  // Datas das eleições gerais e municipais (Constituição Federal, arts. 28, 29, II, e 77).
  assert.equal(electionSundayDate('first', 2022), '2022-10-02');
  assert.equal(electionSundayDate('second', 2022), '2022-10-30');
  assert.equal(electionSundayDate('first', 2024), '2024-10-06');
  assert.equal(electionSundayDate('second', 2024), '2024-10-27');
  assert.equal(electionSundayDate('first', 2026), '2026-10-04');
  assert.equal(electionSundayDate('second', 2026), '2026-10-25');
  assert.equal(electionSundayDate('first', 2032), '2032-10-03', 'primeiro de outubro numa sexta');
  assert.equal(electionSundayDate('second', 2032), '2032-10-31', 'último dia de outubro num domingo');
  assert.equal(electionSundayDate('first', 2025), null, 'ano ímpar');
  assert.equal(electionSundayDate('first', 2020), null, 'eleições de 2020 adiadas (EC nº 107/2020)');
  assert.equal(electionSundayDate('second', 2020), null);
  assert.equal(electionSundayDate('first', 1998), null, 'fora do intervalo');
  for (const year of [2022, 2024, 2026, 2032]) {
    for (const round of ['first', 'second'] as const) {
      const date = electionSundayDate(round, year) as string;
      assert.equal(weekdayIndex(date), 6, `${date} é domingo`);
      assert.equal(nationalHolidayOn(date), null, `${date} não entra sozinho`);
    }
  }
});

test('Páscoa e datas móveis (algoritmo gregoriano)', () => {
  const known: Record<number, string> = {
    2000: '2000-04-23', 2008: '2008-03-23', 2011: '2011-04-24', 2019: '2019-04-21',
    2024: '2024-03-31', 2025: '2025-04-20', 2026: '2026-04-05', 2027: '2027-03-28', 2038: '2038-04-25',
  };
  for (const [year, date] of Object.entries(known)) assert.equal(easterSunday(Number(year)), date, year);
  assert.equal(movableObservanceDate('carnival_monday', 2026), '2026-02-16');
  assert.equal(movableObservanceDate('carnival_tuesday', 2026), '2026-02-17');
  assert.equal(movableObservanceDate('good_friday', 2026), '2026-04-03');
  assert.equal(movableObservanceDate('corpus_christi', 2026), '2026-06-04');
  assert.equal(movableObservanceDate('good_friday', 1999), null);
  assert.equal(movableObservanceDate('good_friday', 2100), null);
});

test('feriados locais (anual e data única), trabalho em feriados e feriado trabalhado', () => {
  // 25/01 (anual) e Corpus Christi de 2026 (data) cadastrados pelo usuário.
  const local = calendar({
    localHolidays: [{ kind: 'annual', month: 1, day: 25 }, { kind: 'date', date: '2026-06-04' }],
  });
  assert.equal(dayPlan(local, '2027-01-25').minutes, 0, 'anual vale em todo ano (segunda-feira)');
  assert.equal(dayPlan(local, '2026-06-04').holiday?.source, 'local');
  assert.equal(dayPlan(local, '2026-06-04').outcome, 'holiday_off');
  assert.equal(dayPlan(local, '2027-05-27').minutes, 480, 'a data única não se repete');
  // Quem trabalha em feriados mantém a rotina, e o feriado aparece como trabalhado.
  const works = monthPlan(calendar({ worksOnHolidays: true }), '2026-11');
  assert.equal(hours(works.minutes), 168);
  assert.deepEqual(works.holidaysWorked.map((item) => item.date), ['2026-11-02', '2026-11-20']);
  // Feriado trabalhado marcado numa data: só aquele feriado volta a contar.
  const one = monthPlan(calendar({ exceptions: [{ kind: 'holiday_worked', date: '2026-11-20' }] }), '2026-11');
  assert.equal(hours(one.minutes), 160);
  assert.equal(one.exceptionDays.holiday_worked, 1);
  // Marcar um feriado em dia sem trabalho não cria horas.
  assert.equal(dayPlan(calendar({ exceptions: [{ kind: 'holiday_worked', date: '2026-11-15' }] }), '2026-11-15').minutes, 0);
});

test('escala 12×36 e escalas cíclicas contam a partir da data de referência, também para trás', () => {
  const shift: WorkRoutine = { kind: 'cyclic', reference: '2026-01-01', workDays: 1, restDays: 1, day: window('07:00', '19:00', 60) };
  const plan = monthPlan(calendar({ routines: [shift], worksOnHolidays: true }), '2026-01');
  assert.equal(plan.workDays, 16, 'dias ímpares de janeiro');
  assert.equal(hours(plan.minutes), 16 * 11);
  assert.equal(dayPlan(calendar({ routines: [shift] }), '2025-12-30').minutes, 660, 'dois dias antes da referência');
  assert.equal(dayPlan(calendar({ routines: [shift] }), '2025-12-31').minutes, 0, 'véspera da referência é folga');
  // 6×1 (seis dias de trabalho, um de folga).
  const sixOne: WorkRoutine = { kind: 'cyclic', reference: '2026-03-01', workDays: 6, restDays: 1, day: duration(440) };
  const march = monthPlan(calendar({ routines: [sixOne], worksOnHolidays: true }), '2026-03');
  assert.equal(march.workDays, 27, '31 dias, folga nos dias 7, 14, 21 e 28');
  // Para trás, o ciclo assimétrico continua: a véspera da referência é a folga do ciclo anterior.
  const sixOneCalendar = calendar({ routines: [sixOne], worksOnHolidays: true });
  assert.equal(dayPlan(sixOneCalendar, '2026-02-28').minutes, 0, 'véspera da referência: folga');
  assert.equal(dayPlan(sixOneCalendar, '2026-02-27').minutes, 440, 'dois dias antes: trabalho');
  assert.equal(dayPlan(sixOneCalendar, '2026-02-23').minutes, 440, 'seis dias antes: trabalho');
  assert.equal(dayPlan(sixOneCalendar, '2026-02-22').minutes, 440, 'uma semana antes: início do ciclo');
  assert.equal(dayPlan(sixOneCalendar, '2026-02-21').minutes, 0, 'oito dias antes: folga');
  // 24×48: turno de 24 h (07:00–07:00) a cada três dias.
  const plantao: WorkRoutine = { kind: 'cyclic', reference: '2026-04-01', workDays: 1, restDays: 2, day: window('07:00', '07:00', 0) };
  const april = monthPlan(calendar({ routines: [plantao], worksOnHolidays: true }), '2026-04');
  assert.equal(april.workDays, 10);
  assert.equal(hours(april.minutes), 240);
});

test('turno noturno conta no dia em que começa; janelas que se cruzam contam uma vez; o intervalo sem horário nunca é adivinhado (B02)', () => {
  // Segunda a sexta, 22:00–06:00 com 1 h de intervalo: 7 h, no dia do início.
  const night = weekdays(window('22:00', '06:00', 60));
  assert.equal(dayPlan(calendar({ routines: [night] }), '2026-03-06').minutes, 420, 'sexta à noite');
  assert.equal(dayPlan(calendar({ routines: [night] }), '2026-03-07').minutes, 0, 'sábado só recebe a madrugada, que é de sexta');
  // Duas rotinas com intervalo que se cruzam (08–14 e 12–18, 30 min cada): conforme a posição das pausas, de 9 h
  // (pausas fora do trecho em comum) a 10 h (pausas em horários diferentes dentro dele). Antes da R1, o motor dava
  // 540 (a menor das leituras); agora o dia fica sem cálculo seguro, e a configuração é recusada.
  const morning = weekdays(window('08:00', '14:00', 30));
  const afternoon = weekdays(window('12:00', '18:00', 30));
  const crossed = calendar({ routines: [morning, afternoon] });
  assert.equal(dayPlan(crossed, '2026-03-02').ambiguous, true);
  assert.equal(monthPlan(crossed, '2026-03').ambiguousDays.length, 22, 'todos os dias úteis de março/2026');
  assert.deepEqual(routinesAmbiguity(crossed.routines, '2026-03-01'), { date: '2026-03-02', routines: [0, 1] });
  // Sem intervalo, as mesmas janelas contam a união: 10 h.
  const morningNoBreak = weekdays(window('08:00', '14:00'));
  const afternoonNoBreak = weekdays(window('12:00', '18:00'));
  const union = dayPlan(calendar({ routines: [morningNoBreak, afternoonNoBreak] }), '2026-03-02');
  assert.deepEqual([union.minutes, union.ambiguous], [600, false]);
  // Rotina repetida (a mesma janela com o mesmo intervalo) é uma só: vale o mesmo que uma, sem ambiguidade.
  const repeated = dayPlan(calendar({ routines: [OFFICE, OFFICE] }), '2026-03-02');
  assert.deepEqual([repeated.minutes, repeated.ambiguous], [480, false], 'a mesma janela de 9 h com 1 h de intervalo, uma vez');
  // Janela com intervalo dentro de outra que também tem intervalo (13:00–17:00 com 30 min em 08:00–17:00 com 1 h):
  // de 8 h a 9 h, conforme as pausas. Antes da R1, o piso da maior janela dava 480; agora, sem cálculo seguro.
  const contained = weekdays(window('13:00', '17:00', 30));
  assert.equal(dayPlan(calendar({ routines: [OFFICE, contained] }), '2026-03-02').ambiguous, true);
  // Dentro de uma janela sem intervalo, o intervalo da contida não tira tempo de trabalho: vale a de fora,
  // e acrescentar a contida não muda as horas do mês.
  const fullDay = weekdays(window('08:00', '17:00'));
  const inside = dayPlan(calendar({ routines: [fullDay, contained] }), '2026-03-02');
  assert.deepEqual([inside.minutes, inside.ambiguous], [540, false]);
  assert.equal(monthPlan(calendar({ routines: [fullDay, contained] }), '2026-02').minutes,
    monthPlan(calendar({ routines: [fullDay] }), '2026-02').minutes);
  // Turno da véspera sem intervalo sobre a janela da manhã: a hora em comum conta uma vez, na véspera.
  const nightNoBreak = weekdays(window('22:00', '06:00'));
  const early = weekly(window('05:00', '09:00'), window('05:00', '09:00'), window('05:00', '09:00'),
    window('05:00', '09:00'), window('05:00', '09:00'), window('05:00', '09:00'), OFF);
  const both = calendar({ routines: [nightNoBreak, early], worksOnHolidays: true });
  const tuesday = dayPlan(both, '2026-03-03');
  assert.equal(tuesday.overlapMinutes, 60);
  assert.equal(tuesday.minutes, 480 + 240 - 60);
  // Sem turno na véspera (domingo), nada é descontado na segunda.
  assert.equal(dayPlan(both, '2026-03-02').overlapMinutes, 0);
  // Véspera de folga: o turno não aconteceu, então não há sobreposição.
  const offEve = calendar({ routines: [nightNoBreak, early], worksOnHolidays: true, exceptions: [{ kind: 'day_off', start: '2026-03-02', end: '2026-03-02' }] });
  assert.equal(dayPlan(offEve, '2026-03-03').overlapMinutes, 0);
  const month = monthPlan(both, '2026-03');
  assert.equal(month.minutes, 22 * 480 + 26 * 240 - 21 * 60);
  assert.equal(month.ambiguousDays.length, 0);
  // Com 1 h de intervalo no turno da noite, a madrugada em comum (05:00–06:00) pode ser a pausa ou não: sem cálculo
  // seguro nas duas pontas (a noite de segunda a sexta e a manhã de terça a sábado). Antes da R1, 420 + 240 − 60.
  const withBreak = calendar({ routines: [night, early], worksOnHolidays: true });
  assert.equal(dayPlan(withBreak, '2026-03-02').ambiguous, true, 'segunda: a noite avança sobre a manhã de terça');
  assert.equal(dayPlan(withBreak, '2026-03-03').ambiguous, true, 'terça: a manhã recebe a noite de segunda');
  assert.equal(dayPlan(withBreak, '2026-03-07').ambiguous, true, 'sábado: a manhã recebe a noite de sexta');
  assert.equal(dayPlan(withBreak, '2026-03-08').ambiguous, false, 'domingo: sem manhã nem noite');
  assert.equal(monthPlan(withBreak, '2026-03').ambiguousDays.length, 22 + 4, 'os 22 dias úteis e os 4 sábados');
});

// ------------------------------------------------------------- B02: rotinas sobrepostas (R1)

const mondays = (spec: DaySpec): WorkRoutine => weekly(spec, OFF, OFF, OFF, OFF, OFF, OFF);
const day = (input: WorkCalendar, date: string) => dayPlan(input, date);

test('B02: acrescentar uma rotina contida numa janela já contada não tira horas (08–12 + 13–17 = 8 h; com 09–11 e 90 min de pausa, 8 h)', () => {
  const base = calendar({ routines: [mondays(window('08:00', '12:00')), mondays(window('13:00', '17:00'))] });
  const plus = calendar({ routines: [...base.routines, mondays(window('09:00', '11:00', 90))] });
  // O cenário do parecer: segunda-feira, 05/10/2026. Antes da R1, 480 → 390 (a soma dos intervalos saía da união).
  const before = monthPlan(base, '2026-10').days.find((entry) => entry.date === '2026-10-05');
  const after = monthPlan(plus, '2026-10').days.find((entry) => entry.date === '2026-10-05');
  assert.deepEqual([before?.minutes, before?.ambiguous], [480, false]);
  assert.deepEqual([after?.minutes, after?.ambiguous], [480, false]);
  assert.equal(monthPlan(plus, '2026-10').minutes, monthPlan(base, '2026-10').minutes);
  assert.equal(routinesAmbiguity(plus.routines, '2026-10-01'), null, 'cálculo seguro: a pausa cai dentro da janela sem intervalo');
  // Uma rotina que de fato acrescenta horas (18:00–20:00) soma exatamente as dela.
  const extra = calendar({ routines: [...plus.routines, mondays(window('18:00', '20:00'))] });
  assert.equal(day(extra, '2026-10-05').minutes, 480 + 120);
});

test('B02: cruzamentos parciais, contenção, repetição, intervalos longos e vários intervalos', () => {
  // Intervalo longo (08:00–20:00 com 4 h): sozinho, 8 h; com uma janela sem intervalo no meio, depende da pausa.
  const long = mondays(window('08:00', '20:00', 240));
  assert.deepEqual([day(calendar({ routines: [long] }), '2026-10-05').minutes, day(calendar({ routines: [long] }), '2026-10-05').ambiguous], [480, false]);
  assert.equal(day(calendar({ routines: [long, mondays(window('12:00', '16:00'))] }), '2026-10-05').ambiguous, true);
  // A mesma janela longa dentro de um turno de 24 h sem intervalo: o turno vale, sem ambiguidade.
  const fullDay = mondays(window('00:00', '00:00'));
  const covered = day(calendar({ routines: [fullDay, long] }), '2026-10-05');
  assert.deepEqual([covered.minutes, covered.ambiguous], [1440, false]);
  // Vários intervalos em janelas que não se cruzam: cada um sai uma vez (4 h − 30 + 3 h − 45 + 2 h − 15).
  const separate = calendar({ routines: [mondays(window('06:00', '10:00', 30)), mondays(window('11:00', '14:00', 45)), mondays(window('15:00', '17:00', 15))] });
  assert.deepEqual([day(separate, '2026-10-05').minutes, day(separate, '2026-10-05').ambiguous], [240 - 30 + 180 - 45 + 120 - 15, false]);
  // Janelas que só se tocam (12:00) não se cruzam: cada uma com o seu intervalo.
  const touching = calendar({ routines: [mondays(window('08:00', '12:00', 30)), mondays(window('12:00', '16:00', 30))] });
  assert.deepEqual([day(touching, '2026-10-05').minutes, day(touching, '2026-10-05').ambiguous], [420, false]);
  // Repetida com outro intervalo (08–17 com 1 h e com 30 min): não é a mesma janela, e a pausa de cada uma é incerta.
  assert.equal(day(calendar({ routines: [mondays(window('08:00', '17:00', 60)), mondays(window('08:00', '17:00', 30))] }), '2026-10-05').ambiguous, true);
  // A mesma janela sem intervalo e com intervalo: a sem intervalo cobre a outra, e o dia tem 9 h.
  const both = day(calendar({ routines: [mondays(window('08:00', '17:00')), mondays(window('08:00', '17:00', 60))] }), '2026-10-05');
  assert.deepEqual([both.minutes, both.ambiguous], [540, false]);
  // Contida em duas janelas sem intervalo que se emendam (08–12 e 12–16 cobrem 10–14 com 1 h): cálculo seguro.
  const chained = calendar({ routines: [mondays(window('08:00', '12:00')), mondays(window('12:00', '16:00')), mondays(window('10:00', '14:00', 60))] });
  assert.deepEqual([day(chained, '2026-10-05').minutes, day(chained, '2026-10-05').ambiguous], [480, false]);
});

test('B02: turnos noturnos e cruzamentos entre dias, com escala semanal e cíclica', () => {
  // A janela com intervalo que passa da meia-noite fica coberta por janelas sem intervalo dos dois dias:
  // 20:00–02:00 com 30 min dentro de 18:00–24:00 (segunda) e 00:00–06:00 (terça). Segunda conta 18:00–02:00
  // (o trecho de terça em comum conta na véspera), terça conta 02:00–06:00.
  const coveredAcross = calendar({ routines: [
    weekly(window('18:00', '00:00'), OFF, OFF, OFF, OFF, OFF, OFF),
    weekly(window('20:00', '02:00', 30), OFF, OFF, OFF, OFF, OFF, OFF),
    weekly(OFF, window('00:00', '06:00'), OFF, OFF, OFF, OFF, OFF),
  ] });
  assert.deepEqual([day(coveredAcross, '2026-10-05').minutes, day(coveredAcross, '2026-10-05').ambiguous], [480, false]);
  assert.deepEqual([day(coveredAcross, '2026-10-06').minutes, day(coveredAcross, '2026-10-06').overlapMinutes], [240, 120]);
  assert.equal(routinesAmbiguity(coveredAcross.routines, '2026-10-01'), null);
  // Sem a janela de terça, a madrugada de segunda para terça fica só com a janela de intervalo: sem cálculo seguro.
  const uncovered = calendar({ routines: coveredAcross.routines.slice(0, 2) });
  assert.equal(day(uncovered, '2026-10-05').ambiguous, true);
  // A mesma rotina semanal que se cruza de um dia para o outro (segunda 20:00–10:00 com 1 h, terça 06:00–14:00).
  const selfCrossing = calendar({ routines: [weekly(window('20:00', '10:00', 60), window('06:00', '14:00'), OFF, OFF, OFF, OFF, OFF)] });
  assert.equal(day(selfCrossing, '2026-10-06').ambiguous, true, 'terça: a noite de segunda avança sobre a manhã');
  assert.deepEqual(routinesAmbiguity(selfCrossing.routines, '2026-10-01'), { date: '2026-10-05', routines: [0] });
  // Escala 12×36 noturna (19:00–07:00 com 1 h) e uma manhã semanal 06:00–10:00: só nos dias em que a escala da
  // véspera coincide com a manhã. O primeiro a partir de 01/10/2026: a escala de 01/10 (quinta) avança sobre a
  // manhã de sexta, 02/10.
  const shift: WorkRoutine = { kind: 'cyclic', reference: '2026-10-01', workDays: 1, restDays: 1, day: window('19:00', '07:00', 60) };
  const mornings = weekdays(window('06:00', '10:00'));
  const mixed = calendar({ routines: [shift, mornings], worksOnHolidays: true });
  const found = routinesAmbiguity(mixed.routines, '2026-10-01');
  assert.deepEqual(found, { date: '2026-10-01', routines: [0, 1] });
  assert.equal(day(mixed, '2026-10-02').ambiguous, true, 'sexta: a manhã recebe a escala de quinta');
  assert.equal(day(mixed, '2026-10-03').ambiguous, false, 'sábado: sem manhã, e a escala de sábado começa só às 19:00');
  // Escala que não avança sobre a manhã (19:00–05:00): cálculo seguro todos os dias.
  const early: WorkRoutine = { kind: 'cyclic', reference: '2026-10-01', workDays: 1, restDays: 1, day: window('19:00', '05:00', 60) };
  assert.equal(routinesAmbiguity([early, mornings], '2026-10-01'), null);
});

test('B02: feriados, plantões, horas extras, exceções e o limite de 24 h com rotinas que se cruzam', () => {
  const crossed = [mondays(window('08:00', '14:00', 30)), mondays(window('12:00', '18:00', 30))];
  // Feriado que tira o dia: as horas finais não dependem da rotina (0), então o dia não fica ambíguo.
  // 12/10/2026 é segunda-feira (Nossa Senhora Aparecida).
  assert.deepEqual([day(calendar({ routines: crossed }), '2026-10-12').minutes, day(calendar({ routines: crossed }), '2026-10-12').ambiguous], [0, false]);
  // Quem trabalha em feriados: o feriado segue a rotina, e o dia fica ambíguo.
  assert.equal(day(calendar({ routines: crossed, worksOnHolidays: true }), '2026-10-12').ambiguous, true);
  // Alteração de escala, folga e ausência definem o dia; jornada reduzida (o menor dos dois) ainda depende da rotina.
  assert.equal(day(calendar({ routines: crossed, exceptions: [{ kind: 'schedule_change', date: '2026-10-05', minutes: 300 }] }), '2026-10-05').ambiguous, false);
  assert.equal(day(calendar({ routines: crossed, exceptions: [{ kind: 'day_off', start: '2026-10-05', end: '2026-10-05' }] }), '2026-10-05').ambiguous, false);
  assert.equal(day(calendar({ routines: crossed, exceptions: [{ kind: 'reduced', start: '2026-10-05', end: '2026-10-05', minutes: 240 }] }), '2026-10-05').ambiguous, true);
  // Plantão e hora extra somam minutos, sem horário: não mudam a ambiguidade e nunca tiram horas.
  const plain = calendar({ routines: [mondays(window('08:00', '12:00')), mondays(window('10:00', '14:00'))] });
  const added = calendar({ ...plain, exceptions: [{ kind: 'on_call', date: '2026-10-05', minutes: 120 }, { kind: 'overtime', date: '2026-10-05', minutes: 60 }] });
  assert.deepEqual([day(plain, '2026-10-05').minutes, day(added, '2026-10-05').minutes], [360, 360 + 180]);
  // Limite diário: a união de janelas sem intervalo nunca passa de 24 h; com hora extra, o dia é limitado e sinalizado.
  const day24 = calendar({ routines: [mondays(window('00:00', '00:00')), mondays(window('08:00', '12:00'))], exceptions: [{ kind: 'overtime', date: '2026-10-05', minutes: 30 }] });
  assert.deepEqual([day(day24, '2026-10-05').minutes, day(day24, '2026-10-05').capped], [1440, true]);
  // Uma exceção pode tirar a cobertura: a escala da véspera (sem intervalo) cobria a janela de intervalo de terça;
  // com folga na véspera, ela não acontece, e a janela de terça passa a cruzar só a manhã: sem cálculo seguro.
  const cover = weekly(window('22:00', '08:00'), OFF, OFF, OFF, OFF, OFF, OFF);
  const tuesdayBreak = weekly(OFF, window('05:00', '09:00', 30), OFF, OFF, OFF, OFF, OFF);
  const tuesdayMorning = weekly(OFF, window('08:00', '12:00'), OFF, OFF, OFF, OFF, OFF);
  const coveredCalendar = calendar({ routines: [cover, tuesdayBreak, tuesdayMorning] });
  assert.equal(day(coveredCalendar, '2026-10-06').ambiguous, false);
  assert.equal(routinesAmbiguity(coveredCalendar.routines, '2026-10-01'), null);
  const withDayOff = calendar({ ...coveredCalendar, exceptions: [{ kind: 'day_off', start: '2026-10-05', end: '2026-10-05' }] });
  assert.equal(day(withDayOff, '2026-10-06').ambiguous, true);
  // O feriado também tira a cobertura: 12/10/2026 (segunda) é feriado nacional, e quem não trabalha em feriados
  // não faz a escala daquela noite; a terça 13/10 fica sem cálculo seguro, com ou sem a folga.
  assert.deepEqual(monthPlan(withDayOff, '2026-10').ambiguousDays, ['2026-10-06', '2026-10-13']);
  assert.deepEqual(monthPlan(coveredCalendar, '2026-10').ambiguousDays, ['2026-10-13']);
  assert.deepEqual(monthPlan({ ...coveredCalendar, worksOnHolidays: true }, '2026-10').ambiguousDays, []);
});

test('B02: o conferidor das rotinas percorre o período inteiro da combinação e é rápido no pior caso', () => {
  // Três escalas com ciclos primos entre si (53, 55 e 56 dias): o período (163.240 dias) passa do intervalo
  // 2000–2099, que é então percorrido inteiro. Cruzam-se só quando as três trabalham no mesmo dia.
  const cycle = (work: number, rest: number, spec: DaySpec): WorkRoutine => ({ kind: 'cyclic', reference: '2026-01-01', workDays: work, restDays: rest, day: spec });
  const routines = [cycle(1, 52, window('08:00', '12:00', 30)), cycle(1, 54, window('10:00', '14:00')), cycle(1, 55, window('20:00', '22:00'))];
  const started = performance.now();
  const found = routinesAmbiguity(routines, '2026-01-01');
  const elapsed = performance.now() - started;
  assert.deepEqual(found, { date: '2026-01-01', routines: [0, 1] });
  // Uma combinação sem cruzamento também percorre o intervalo inteiro.
  const free = [cycle(1, 52, window('08:00', '12:00', 30)), cycle(1, 54, window('13:00', '17:00', 30)), cycle(1, 55, window('18:00', '20:00', 30))];
  const startedFree = performance.now();
  assert.equal(routinesAmbiguity(free, '2026-01-01'), null);
  const elapsedFree = performance.now() - startedFree;
  assert.ok(elapsed < 2_000 && elapsedFree < 2_000, `tempo do conferidor: ${elapsed.toFixed(0)} ms e ${elapsedFree.toFixed(0)} ms`);
  // A primeira ocorrência a partir da data pedida: a escala só cruza a cada 53 × 55 dias com a segunda.
  const pair = [cycle(1, 52, window('08:00', '12:00', 30)), cycle(1, 54, window('10:00', '14:00'))];
  assert.equal(routinesAmbiguity(pair, '2026-01-02')?.date, addDays('2026-01-01', 53 * 55));
  // Sem nenhum intervalo, nada a conferir.
  assert.equal(routinesAmbiguity([weekdays(window('08:00', '14:00')), weekdays(window('12:00', '18:00'))], '2026-01-01'), null);
});

// ------------------------------------------------------- B02: propriedades com rotinas aleatórias

/** Gerador determinístico (mulberry32): as mesmas rotinas a cada execução. */
const random = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
  return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
};
const pick = <T,>(next: () => number, items: readonly T[]): T => items[Math.floor(next() * items.length)];
const randomWindow = (next: () => number): DaySpec => {
  const start = Math.floor(next() * 48) * 30;
  const length = (2 + Math.floor(next() * 46)) * 30;
  const breakMinutes = next() < 0.5 ? 0 : Math.min(length - 30, pick(next, [30, 60, 90, 120, 240]));
  return { kind: 'window', start, end: (start + length) % 1440, breakMinutes };
};
const randomRoutine = (next: () => number): WorkRoutine => (next() < 0.7
  ? { kind: 'weekly', days: Array.from({ length: 7 }, () => (next() < 0.45 ? OFF : randomWindow(next))) }
  : { kind: 'cyclic', reference: addDays('2026-01-01', Math.floor(next() * 60)) as string, workDays: 1 + Math.floor(next() * 3), restDays: 1 + Math.floor(next() * 3), day: randomWindow(next) });

/** Um trecho de dias com folga na véspera e no dia seguinte: nada entra nem sai pelas pontas. */
const SPAN_START = '2026-10-05';
const SPAN_DAYS = 14;
const spanDates = Array.from({ length: SPAN_DAYS }, (_, index) => addDays(SPAN_START, index) as string);
const spanCalendar = (routines: WorkRoutine[]): WorkCalendar => calendar({
  routines,
  worksOnHolidays: true,
  exceptions: [
    { kind: 'day_off', start: addDays(SPAN_START, -1) as string, end: addDays(SPAN_START, -1) as string },
    { kind: 'day_off', start: addDays(SPAN_START, SPAN_DAYS) as string, end: addDays(SPAN_START, SPAN_DAYS) as string },
  ],
});
const spanPlans = (input: WorkCalendar) => spanDates.map((date) => dayPlan(input, date));
const spanMinutes = (plans: ReturnType<typeof spanPlans>) => plans.reduce((sum, plan) => sum + plan.minutes, 0);

/** Janelas trabalhadas do trecho no eixo contínuo, com cada intervalo numa posição dada (fração da folga). */
const workedUnion = (routines: WorkRoutine[], placement: (index: number) => number): number => {
  const pieces: Array<[number, number]> = [];
  let index = 0;
  for (const date of spanDates) {
    const seen = new Set<string>();
    for (const routine of routines) {
      const spec = routine.kind === 'weekly' ? routine.days[weekdayIndex(date)] : routineIsWorking(routine, date) ? routine.day : OFF;
      if (spec.kind !== 'window') continue;
      const start = dayNumber(date) * 1440 + spec.start;
      const end = start + (spec.end > spec.start ? spec.end - spec.start : 1440 - spec.start + spec.end);
      const key = `${start}|${end}|${spec.breakMinutes}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (spec.breakMinutes === 0) { pieces.push([start, end]); continue; }
      const offset = Math.round(placement(index) * (end - start - spec.breakMinutes));
      index += 1;
      pieces.push([start, start + offset], [start + offset + spec.breakMinutes, end]);
    }
  }
  const sorted = pieces.filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let current: [number, number] | null = null;
  for (const [a, b] of sorted) {
    if (current && a <= current[1]) current[1] = Math.max(current[1], b);
    else { if (current) total += current[1] - current[0]; current = [a, b]; }
  }
  return total + (current ? current[1] - current[0] : 0);
};
const routineIsWorking = (routine: Extract<WorkRoutine, { kind: 'cyclic' }>, date: string) => {
  const length = routine.workDays + routine.restDays;
  const diff = dayNumber(date) - dayNumber(routine.reference);
  return ((diff % length) + length) % length < routine.workDays;
};

test('B02 (propriedade): com cálculo seguro, as horas são a união das janelas trabalhadas, em qualquer posição das pausas', () => {
  const next = random(20261105);
  let checked = 0;
  for (let sample = 0; sample < 400; sample += 1) {
    const routines = Array.from({ length: 1 + Math.floor(next() * 3) }, () => randomRoutine(next));
    const plans = spanPlans(spanCalendar(routines));
    if (plans.some((plan) => plan.ambiguous)) continue;
    checked += 1;
    const total = spanMinutes(plans);
    for (const placement of [() => 0, () => 1, () => 0.5, () => next(), () => next()]) {
      assert.equal(workedUnion(routines, placement), total, `amostra ${sample}: ${JSON.stringify(routines)}`);
    }
  }
  assert.ok(checked > 150, `amostras com cálculo seguro: ${checked}`);
});

test('B02 (propriedade): todo dia recusado depende mesmo da posição das pausas', () => {
  const next = random(5112026);
  let refused = 0;
  for (let sample = 0; sample < 300; sample += 1) {
    const routines = Array.from({ length: 1 + Math.floor(next() * 3) }, () => randomRoutine(next));
    const plans = spanPlans(spanCalendar(routines));
    if (!plans.some((plan) => plan.ambiguous)) continue;
    refused += 1;
    const values = new Set<number>();
    for (const fixed of [0, 1, 0.25, 0.5, 0.75]) values.add(workedUnion(routines, () => fixed));
    for (let attempt = 0; attempt < 60 && values.size < 2; attempt += 1) {
      const positions = Array.from({ length: 64 }, () => (next() < 0.5 ? Math.round(next()) : next()));
      values.add(workedUnion(routines, (index) => positions[index % positions.length]));
    }
    assert.ok(values.size > 1, `amostra ${sample} recusada sem depender das pausas: ${JSON.stringify(routines)}`);
  }
  assert.ok(refused > 50, `amostras recusadas: ${refused}`);
});

test('B02 (propriedade): acrescentar uma rotina, entre configurações com cálculo seguro, nunca tira horas', () => {
  const next = random(1730);
  let checked = 0;
  for (let sample = 0; sample < 2_000; sample += 1) {
    const routines = Array.from({ length: 1 + Math.floor(next() * 2) }, () => randomRoutine(next));
    const added = [...routines, randomRoutine(next)];
    const before = spanPlans(spanCalendar(routines));
    const after = spanPlans(spanCalendar(added));
    if (before.some((plan) => plan.ambiguous) || after.some((plan) => plan.ambiguous)) continue;
    checked += 1;
    assert.ok(spanMinutes(after) >= spanMinutes(before), `amostra ${sample}: ${spanMinutes(before)} → ${spanMinutes(after)}`);
    // Dia a dia, as horas só saem de um dia para a véspera (o trecho em comum conta no dia que começou antes).
    for (let index = 0; index < SPAN_DAYS; index += 1) {
      const lost = before[index].minutes - after[index].minutes;
      if (lost <= 0) continue;
      assert.ok(index > 0 && after[index].overlapMinutes > before[index].overlapMinutes,
        `amostra ${sample}, ${spanDates[index]}: perdeu ${lost} min sem ir para a véspera`);
      assert.ok(after[index - 1].minutes + after[index].minutes >= before[index - 1].minutes + before[index].minutes,
        `amostra ${sample}, ${spanDates[index]}: a véspera e o dia juntos perderam horas`);
    }
  }
  assert.ok(checked > 250, `pares com cálculo seguro: ${checked}`);
});

test('B02: o turno que começa na véspera do período não leva horas do primeiro dia; os minutos sem horário só ocupam o tempo livre do dia', () => {
  const everyDay = (spec: DaySpec): WorkRoutine => ({ kind: 'weekly', days: Array(7).fill(spec) });
  const onDays = (days: number[], spec: DaySpec): WorkRoutine => ({ kind: 'weekly', days: Array.from({ length: 7 }, (_, day) => (days.includes(day) ? spec : OFF)) });
  // 24 h todos os dias e, acrescentado, sexta 22:00–06:00 (31/07/2026 é sexta; 01/08, sábado).
  const allDay = calendar({ routines: [everyDay(window('00:00', '00:00'))], worksOnHolidays: true });
  const withFriday = calendar({ routines: [everyDay(window('00:00', '00:00')), onDays([4], window('22:00', '06:00'))], worksOnHolidays: true });
  const august = (input: WorkCalendar, periodStart: boolean) => monthPlan(input, '2026-08', { periodStart }).minutes;
  assert.equal(august(allDay, true), 31 * 1440);
  // No período (a janela da estimativa), nada sai pela véspera: o total não cai.
  assert.equal(august(withFriday, true), 31 * 1440);
  // No mês avulso (a vista do calendário), o trecho de 01/08 que o turno de 31/07 cobre conta em julho.
  assert.equal(august(withFriday, false), 31 * 1440 - 360);
  // Teto: segunda com 22 h sem horário e terça 00:00–08:00; acrescentar segunda 23:00–06:00 só soma.
  const untimed = onDays([0], { kind: 'duration', minutes: 1320 });
  const tuesday = onDays([1], window('00:00', '08:00'));
  const night = onDays([0], window('23:00', '06:00'));
  const before = monthPlan(calendar({ routines: [untimed, tuesday], worksOnHolidays: true }), '2026-10', { periodStart: true });
  const after = monthPlan(calendar({ routines: [untimed, tuesday, night], worksOnHolidays: true }), '2026-10', { periodStart: true });
  assert.ok(after.minutes > before.minutes, `${before.minutes} → ${after.minutes}`);
  // Segunda 12/10/2026: das 00:00 às 24:00, 1 h do turno e as 22 h sem horário (cabem nas 23 h livres); o
  // trecho de terça (6 h) conta na segunda, e terça fica com 2 h.
  const monday = after.days.find((day) => day.date === '2026-10-12');
  const tuesdayPlan = after.days.find((day) => day.date === '2026-10-13');
  assert.deepEqual([monday?.minutes, monday?.capped, tuesdayPlan?.minutes], [420 + 1320, false, 120]);
  // Com 24 h sem horário na segunda, só as 23 h livres contam.
  const fullMonday = monthPlan(calendar({ routines: [onDays([0], { kind: 'duration', minutes: 1440 }), tuesday, night], worksOnHolidays: true }), '2026-10');
  assert.deepEqual([fullMonday.days.find((day) => day.date === '2026-10-12')?.minutes, fullMonday.days.find((day) => day.date === '2026-10-12')?.capped], [420 + 1380, true]);
  // O dia depois de um turno noturno: 24 h sem horário ocupam só as 18 h livres (o turno ocupa 00:00–06:00).
  const afterNight = calendar({ routines: [onDays([0], window('22:00', '06:00')), onDays([1], { kind: 'duration', minutes: 1440 })], worksOnHolidays: true });
  assert.deepEqual([dayPlan(afterNight, '2026-10-13').minutes, dayPlan(afterNight, '2026-10-13').capped], [1080, true]);
});

const PERIOD_MONTHS = ['2026-08', '2026-09', '2026-10'];
/** Total da janela como a estimativa o calcula: o primeiro mês abre o período. */
const periodPlans = (input: WorkCalendar) => PERIOD_MONTHS.map((month, index) => monthPlan(input, month, { periodStart: index === 0 }));
const randomDay = (next: () => number): DaySpec => {
  const roll = next();
  if (roll < 0.1) return { kind: 'duration', minutes: (1 + Math.floor(next() * 24)) * 60 };
  if (roll < 0.15) {
    const start = Math.floor(next() * 24) * 60;
    return { kind: 'window', start, end: start, breakMinutes: next() < 0.5 ? 0 : 60 };
  }
  return randomWindow(next);
};
const randomRoutineWithDurations = (next: () => number): WorkRoutine => (next() < 0.7
  ? { kind: 'weekly', days: Array.from({ length: 7 }, () => (next() < 0.45 ? OFF : randomDay(next))) }
  : { kind: 'cyclic', reference: addDays('2026-01-01', Math.floor(next() * 60)) as string, workDays: 1 + Math.floor(next() * 3), restDays: 1 + Math.floor(next() * 3), day: randomDay(next) });
const randomDate = (next: () => number) => addDays('2026-07-30', Math.floor(next() * 96)) as string;
const randomExceptions = (next: () => number): WorkException[] => Array.from({ length: Math.floor(next() * 6) }, (): WorkException => {
  const start = randomDate(next);
  const end = addDays(start, Math.floor(next() * 4)) as string;
  const minutes = (1 + Math.floor(next() * 12)) * 60;
  switch (pick(next, ['vacation', 'day_off', 'absence', 'holiday_worked', 'on_call', 'overtime', 'reduced', 'schedule_change'] as const)) {
    case 'vacation': return { kind: 'vacation', start, end };
    case 'day_off': return { kind: 'day_off', start, end };
    case 'absence': return { kind: 'absence', start, end };
    case 'holiday_worked': return { kind: 'holiday_worked', date: '2026-10-12' };
    case 'on_call': return { kind: 'on_call', date: start, minutes };
    case 'overtime': return { kind: 'overtime', date: start, minutes };
    case 'reduced': return { kind: 'reduced', start, end, minutes };
    default: return { kind: 'schedule_change', date: start, minutes: Math.floor(next() * 13) * 60 };
  }
});

test('B02 (propriedade): na janela de meses da estimativa, com exceções, durações, turnos de 24 h e feriados, acrescentar uma rotina nunca tira horas', () => {
  const next = random(20261106);
  let checked = 0;
  for (let sample = 0; sample < 4_000; sample += 1) {
    const routines = Array.from({ length: 1 + Math.floor(next() * 2) }, () => randomRoutineWithDurations(next));
    const extra = { exceptions: randomExceptions(next), worksOnHolidays: next() < 0.5,
      localHolidays: next() < 0.3 ? [{ kind: 'date' as const, date: randomDate(next) }] : [] };
    const added = [...routines, randomRoutineWithDurations(next)];
    const before = periodPlans(calendar({ ...extra, routines }));
    const after = periodPlans(calendar({ ...extra, routines: added }));
    if ([...before, ...after].some((plan) => plan.ambiguousDays.length > 0)) continue;
    checked += 1;
    const total = (plans: MonthPlan[]) => plans.reduce((sum, plan) => sum + plan.minutes, 0);
    assert.ok(total(after) >= total(before), `amostra ${sample}: ${total(before)} → ${total(after)} ${JSON.stringify({ routines, added: added.at(-1), extra })}`);
  }
  assert.ok(checked > 600, `pares com cálculo seguro: ${checked}`);
});

const mondayOnly = (spec: DaySpec): WorkRoutine => weekly(spec, OFF, OFF, OFF, OFF, OFF, OFF);

test('B02 (revisão da R1, N01): num dia de jornada reduzida com plantão, acrescentar uma rotina válida não tira horas', () => {
  // O cenário da revisão: segunda 08:00–17:00, jornada reduzida a 10 h e plantão de 24 h em 05/10/2026, férias
  // no resto de outubro. Acrescentar segunda 18:00–20:00 passava o mês de 1.980 para 1.440 min.
  const exceptions: WorkException[] = [
    { kind: 'reduced', start: '2026-10-05', end: '2026-10-05', minutes: 600 },
    { kind: 'on_call', date: '2026-10-05', minutes: 1440 },
    { kind: 'vacation', start: '2026-10-12', end: '2026-10-31' },
  ];
  const office = mondayOnly(window('08:00', '17:00'));
  const before = monthPlan(calendar({ routines: [office], exceptions }), '2026-10', { periodStart: true });
  const after = monthPlan(calendar({ routines: [office, mondayOnly(window('18:00', '20:00'))], exceptions }), '2026-10', { periodStart: true });
  assert.ok(after.minutes >= before.minutes, `${before.minutes} → ${after.minutes}`);
  // Nenhuma janela passa da meia-noite: o dia fica em 24 h, com o teto, antes e depois (a redução morde só depois).
  for (const plan of [before, after]) {
    const day = plan.days.find((item) => item.date === '2026-10-05');
    assert.deepEqual([day?.minutes, day?.capped], [1440, true]);
  }
  assert.deepEqual([before.minutes, after.minutes], [1440, 1440]);
});

test('B02 (revisão da R1, N02): num dia de jornada reduzida, o dia civil nunca passa de 24 h; o trecho depois da meia-noite cabe além dele', () => {
  // A redução que não morde (9 h de rotina, limite de 10 h) com 1.000 min de hora extra: 24 h, não 25 h 40 min.
  const office = mondayOnly(window('08:00', '17:00'));
  const loose = dayPlan(calendar({ routines: [office], exceptions: [
    { kind: 'reduced', start: '2026-10-05', end: '2026-10-05', minutes: 600 },
    { kind: 'overtime', date: '2026-10-05', minutes: 1000 },
  ] }), '2026-10-05');
  assert.deepEqual([loose.minutes, loose.capped], [1440, true]);
  // A redução que morde (11 h reduzidas a 10 h) com 24 h de plantão: as mesmas 24 h.
  const tight = dayPlan(calendar({ routines: [office, mondayOnly(window('18:00', '20:00'))], exceptions: [
    { kind: 'reduced', start: '2026-10-05', end: '2026-10-05', minutes: 600 },
    { kind: 'on_call', date: '2026-10-05', minutes: 1440 },
  ] }), '2026-10-05');
  assert.deepEqual([tight.minutes, tight.capped], [1440, true]);
  // Turno 20:00–06:00 reduzido a 8 h, com 24 h de plantão: cabem 6 h da redução depois da meia-noite (00:00–06:00
  // de terça) e, no dia civil, as 2 h restantes e 22 h de plantão.
  const night = dayPlan(calendar({ routines: [mondayOnly(window('20:00', '06:00'))], exceptions: [
    { kind: 'reduced', start: '2026-10-05', end: '2026-10-05', minutes: 480 },
    { kind: 'on_call', date: '2026-10-05', minutes: 1440 },
  ] }), '2026-10-05');
  assert.deepEqual([night.minutes, night.capped], [360 + 1440, true]);
  // Com a véspera ocupando o dia civil: domingo 22:00–06:00 ocupa 00:00–06:00 de segunda. Segunda 20:00–08:00
  // reduzida a 4 h, com 24 h de plantão: as 4 h cabem depois da meia-noite e, no dia civil, só as 18 h que a
  // véspera deixa livres (1.440 − 360), não 24 h.
  const afterNight = dayPlan(calendar({ routines: [weekly(window('20:00', '08:00'), OFF, OFF, OFF, OFF, OFF, window('22:00', '06:00'))], exceptions: [
    { kind: 'reduced', start: '2026-10-05', end: '2026-10-05', minutes: 240 },
    { kind: 'on_call', date: '2026-10-05', minutes: 1440 },
  ] }), '2026-10-05');
  assert.deepEqual([afterNight.minutes, afterNight.capped], [240 + (1440 - 360), true]);
  // Sem acréscimos, a jornada reduzida conta inteira (o teto não a corta).
  const reducedOnly = dayPlan(calendar({ routines: [mondayOnly(window('20:00', '06:00'))], exceptions: [
    { kind: 'reduced', start: '2026-10-05', end: '2026-10-05', minutes: 480 },
  ] }), '2026-10-05');
  assert.deepEqual([reducedOnly.minutes, reducedOnly.capped], [480, false]);
});

const tuesdayOnly = (spec: DaySpec): WorkRoutine => weekly(OFF, spec, OFF, OFF, OFF, OFF, OFF);
const REDUCED_MONDAY = (minutes: number): WorkException => ({ kind: 'reduced', start: '2026-10-05', end: '2026-10-05', minutes });

test('B02 (P5-F.1-R2A, S01): segunda 20:00–06:00 reduzida a 8 h e terça 00:00–08:00 — os 960 min da R1 viram recusa, com a causa na véspera', () => {
  const routines = [weekly(window('20:00', '06:00'), window('00:00', '08:00'), OFF, OFF, OFF, OFF, OFF)];
  const base = calendar({ routines, worksOnHolidays: true });
  // Sem a redução: a segunda conta 600 min e a terça 120 (00:00–06:00 já contou na segunda), os 720 min de 20:00–08:00.
  assert.deepEqual([dayPlan(base, '2026-10-05').minutes, dayPlan(base, '2026-10-06').minutes], [600, 120]);
  assert.equal(calendarAmbiguity(base, '2026-11-06'), null);
  // Com a redução, a segunda conta 480 min, sem dizer quando. Das 20:00 à meia-noite cabem 240, então pelo menos 240
  // caem em 00:00–06:00 de terça, dentro da janela dela. A R1 contava 480 + 480 = 960, mais que os 720 do trecho.
  const reduced = calendar({ ...base, exceptions: [REDUCED_MONDAY(480)] });
  const tuesday = dayPlan(reduced, '2026-10-06');
  assert.deepEqual([dayPlan(reduced, '2026-10-05').minutes, tuesday.ambiguous, tuesday.reducedEve], [480, true, true]);
  // Duas partes possíveis da segunda, cada uma vista como a rotina inteira dela, dão terças diferentes:
  // 20:00–04:00 deixa 04:00–08:00 (240) e 22:00–06:00 deixa 06:00–08:00 (120). Não há um número só.
  const withMonday = (start: string, end: string) =>
    dayPlan(calendar({ worksOnHolidays: true, routines: [weekly(window(start, end), window('00:00', '08:00'), OFF, OFF, OFF, OFF, OFF)] }), '2026-10-06').minutes;
  assert.deepEqual([withMonday('20:00', '04:00'), withMonday('22:00', '06:00')], [240, 120]);
  const october = monthPlan(reduced, '2026-10', { periodStart: true });
  assert.deepEqual([october.ambiguousDays, october.reducedEveDays], [['2026-10-06'], ['2026-10-06']], 'só a terça depois da redução');
  assert.deepEqual(calendarAmbiguity(reduced, '2026-11-06'), { date: '2026-10-06', routines: [0], cause: { kind: 'reduced_eve', date: '2026-10-05' } });
  // A alteração de escala na segunda resolve: as horas dela ficam sem horário, no dia civil dela.
  const changed = calendar({ ...base, exceptions: [{ kind: 'schedule_change', date: '2026-10-05', minutes: 480 }] });
  assert.equal(calendarAmbiguity(changed, '2026-11-06'), null);
  assert.deepEqual([dayPlan(changed, '2026-10-05').minutes, dayPlan(changed, '2026-10-06').minutes, dayPlan(changed, '2026-10-06').ambiguous], [480, 480, false]);
  // A redução que não corta nada (limite de 10 h para um turno de 10 h) é a própria rotina: 600 + 120, aceita.
  const loose = calendar({ ...base, exceptions: [REDUCED_MONDAY(600)] });
  assert.deepEqual([dayPlan(loose, '2026-10-05').minutes, dayPlan(loose, '2026-10-06').minutes, dayPlan(loose, '2026-10-06').ambiguous], [600, 120, false]);
  assert.equal(calendarAmbiguity(loose, '2026-11-06'), null);
  // Com 2 h sem horário na segunda, o máximo da rotina passa a 720: o limite de 650 corta, e não se sabe se o corte
  // caiu no turno ou nas 2 h. A terça volta a ficar sem cálculo seguro.
  const withDuration = calendar({ ...base, routines: [...routines, mondayOnly(duration(120))], exceptions: [REDUCED_MONDAY(650)] });
  assert.deepEqual([dayPlan(withDuration, '2026-10-05').minutes, dayPlan(withDuration, '2026-10-06').ambiguous, dayPlan(withDuration, '2026-10-06').reducedEve], [650, true, true]);
  assert.equal(calendarAmbiguity(withDuration, '2026-11-06')?.cause.kind, 'reduced_eve');
  assert.equal(calendarAmbiguity(calendar({ ...withDuration, exceptions: [REDUCED_MONDAY(720)] }), '2026-11-06'), null, 'com 12 h, não corta nada');
  // A causa cita só as rotinas do turno que passa da meia-noite (a manhã de segunda, Rotina 1, não).
  const withMorning = calendar({ ...reduced, routines: [mondayOnly(window('08:00', '12:00')), ...routines] });
  assert.deepEqual(calendarAmbiguity(withMorning, '2026-11-06'), { date: '2026-10-06', routines: [1], cause: { kind: 'reduced_eve', date: '2026-10-05' } });
  // O máximo da rotina desconta a véspera que segue a rotina, salvo no primeiro dia de um mês (revisão independente da
  // R2A, R2A-01 e T13). Domingo 22:00–06:00 leva 01:00–06:00 do turno de 24 h de segunda (01:00–01:00), que fica com
  // 1.140 min: o limite de 1.200 não corta nada, e a terça, cuja janela 00:00–02:00 cruza o turno até 01:00, vale 60,
  // como com a segunda seguindo a rotina. A segunda 05/10 nunca abre um período da estimativa, que começa no dia 1.
  const sundayCover = calendar({ worksOnHolidays: true, exceptions: [REDUCED_MONDAY(1200)], routines: [
    weekly(window('01:00', '01:00'), window('00:00', '02:00'), OFF, OFF, OFF, OFF, window('22:00', '06:00')),
  ] });
  assert.deepEqual([dayPlan(sundayCover, '2026-10-05').minutes, dayPlan(sundayCover, '2026-10-06').minutes, dayPlan(sundayCover, '2026-10-06').ambiguous], [1140, 60, false]);
  assert.equal(calendarAmbiguity(sundayCover, '2026-11-06'), null);
  // A mesma segunda num dia 1 (01/06/2026): junho pode abrir o período, e lá a segunda conta sem o domingo 31/05, as
  // 24 h, e o limite corta 4 h que ninguém sabe onde caíram. A terça vale 120 sem nada da segunda e 60 com ela inteira:
  // a configuração é recusada, com a causa na segunda.
  const reducedFirst = (minutes: number): WorkException => ({ kind: 'reduced', start: '2026-06-01', end: '2026-06-01', minutes });
  const firstOfMonth = calendar({ ...sundayCover, exceptions: [reducedFirst(1200)] });
  assert.deepEqual([dayPlan(firstOfMonth, '2026-06-02').ambiguous, dayPlan(firstOfMonth, '2026-06-02').reducedEve], [true, true]);
  assert.deepEqual(monthPlan(firstOfMonth, '2026-06', { periodStart: true }).reducedEveDays, ['2026-06-02']);
  assert.deepEqual(calendarAmbiguity(firstOfMonth, '2026-11-06'), { date: '2026-06-02', routines: [0], cause: { kind: 'reduced_eve', date: '2026-06-01' } });
  // Com o limite de 24 h, a redução não corta em nenhum cálculo, nem no dia 1: a terça desconta o turno e vale 60.
  const firstOfMonthLoose = calendar({ ...sundayCover, exceptions: [reducedFirst(1440)] });
  assert.deepEqual([dayPlan(firstOfMonthLoose, '2026-06-02').minutes, dayPlan(firstOfMonthLoose, '2026-06-02').ambiguous], [60, false]);
  assert.equal(calendarAmbiguity(firstOfMonthLoose, '2026-11-06'), null);
});

test('B02 (P5-F.1-R2A, R2A-01): a jornada reduzida no dia que abre o período segue a mesma regra, e acrescentar uma rotina não tira horas do período', () => {
  // Achado da revisão independente da R2A. 30/09/2026 é quarta, 01/10 quinta e 02/10 sexta: quarta 20:00–10:00,
  // quinta 06:00–20:00 e sexta 00:00–04:00, com a quinta reduzida a 850 min e férias de 03/10 a 31/10.
  const wedThuFri = (wed: DaySpec, thu: DaySpec, fri: DaySpec) => weekly(OFF, OFF, wed, thu, fri, OFF, OFF);
  const exceptions: WorkException[] = [
    { kind: 'reduced', start: '2026-10-01', end: '2026-10-01', minutes: 850 },
    { kind: 'vacation', start: '2026-10-03', end: '2026-10-31' },
  ];
  const base = calendar({ worksOnHolidays: true, exceptions, routines: [wedThuFri(window('20:00', '10:00'), window('06:00', '20:00'), window('00:00', '04:00'))] });
  // Abrindo o período, a quinta conta sem a quarta (840) e a sexta, 240: 1.080. A redução não corta nada.
  const opening = monthPlan(base, '2026-10', { periodStart: true });
  assert.deepEqual([opening.minutes, opening.ambiguousDays], [1080, []]);
  assert.equal(calendarAmbiguity(base, '2026-11-06'), null);
  // Com a quinta 22:00–02:00 acrescentada, a quinta abre o período com 1.080 min de janelas, e o limite corta 230.
  // Com a regra anterior (o máximo descontando a quarta: 840 + 240 − 240 = 840), a sexta descontava as 2 h depois da
  // meia-noite como se a quinta tivesse trabalhado tudo: 850 + 120 = 970, menos que os 1.080 sem a rotina nova.
  // Agora a sexta fica sem cálculo seguro (240 sem nada da quinta, 120 com ela inteira), e a configuração é recusada.
  const added = calendar({ ...base, routines: [...base.routines, wedThuFri(OFF, window('22:00', '02:00'), OFF)] });
  const openingAdded = monthPlan(added, '2026-10', { periodStart: true });
  assert.deepEqual([openingAdded.ambiguousDays, openingAdded.reducedEveDays], [['2026-10-02'], ['2026-10-02']]);
  assert.deepEqual(calendarAmbiguity(added, '2026-11-06'), { date: '2026-10-02', routines: [1], cause: { kind: 'reduced_eve', date: '2026-10-01' } });
  // Solidez: quinta 06:00–02:00 (20 h) reduzida a 1.000. Abrindo o período, a quinta conta 1.000 de 1.200 min de
  // janelas, sem saber que parte foi trabalhada, e a sexta vale de 120 a 240. A regra anterior aceitava 120.
  const long = calendar({
    worksOnHolidays: true,
    exceptions: [{ kind: 'reduced', start: '2026-10-01', end: '2026-10-01', minutes: 1000 }],
    routines: [wedThuFri(window('20:00', '10:00'), window('06:00', '02:00'), window('00:00', '04:00'))],
  });
  assert.deepEqual(monthPlan(long, '2026-10', { periodStart: true }).reducedEveDays, ['2026-10-02']);
  assert.deepEqual(calendarAmbiguity(long, '2026-11-06'), { date: '2026-10-02', routines: [0], cause: { kind: 'reduced_eve', date: '2026-10-01' } });
});

test('B02 (P5-F.1-R2A, S01): o dia civil seguinte a uma jornada reduzida não recebe 24 h de plantão por cima do turno dela (contrato anterior, RR-R1-03, substituído)', () => {
  // Contrato da R1 (este teste fixava o contrário): segunda 20:00–06:00 reduzida a 8 h e terça com 24 h de plantão
  // contavam 480 + 1.440, embora pelo menos 4 h da segunda caiam no dia civil de terça (28 h num dia). Agora a terça
  // fica sem cálculo seguro: com o turno de segunda inteiro, ela teria 18 h; sem nada dele, 24 h. O mesmo com a
  // segunda 23:00–08:00 acrescentada, o caso que impedia descontar o trecho (rotinas-matematica.md §6).
  const onCall: WorkException = { kind: 'on_call', date: '2026-10-06', minutes: 1440 };
  const night = mondayOnly(window('20:00', '06:00'));
  for (const [routines, involved] of [[[night], [0]], [[night, mondayOnly(window('23:00', '08:00'))], [0, 1]]] as const) {
    const input = calendar({ routines: [...routines], exceptions: [REDUCED_MONDAY(480), onCall], worksOnHolidays: true });
    const tuesday = dayPlan(input, '2026-10-06');
    assert.deepEqual([dayPlan(input, '2026-10-05').minutes, tuesday.ambiguous, tuesday.reducedEve], [480, true, true]);
    assert.deepEqual(monthPlan(input, '2026-10', { periodStart: true }).reducedEveDays, ['2026-10-06']);
    assert.deepEqual(calendarAmbiguity(input, '2026-11-06'), { date: '2026-10-06', routines: [...involved], cause: { kind: 'reduced_eve', date: '2026-10-05' } });
  }
  // Com a véspera seguindo a rotina, a terça desconta o trecho dela depois da meia-noite (24 h − 6 h), como antes.
  const following = calendar({ routines: [night], exceptions: [onCall], worksOnHolidays: true });
  assert.deepEqual([dayPlan(following, '2026-10-06').minutes, dayPlan(following, '2026-10-06').capped, dayPlan(following, '2026-10-06').ambiguous], [1080, true, false]);
  // Com a redução que não corta nada, também.
  const loose = calendar({ routines: [night], exceptions: [REDUCED_MONDAY(600), onCall], worksOnHolidays: true });
  assert.deepEqual([dayPlan(loose, '2026-10-06').minutes, dayPlan(loose, '2026-10-06').ambiguous], [1080, false]);
  // E com um plantão que cabe mesmo com o turno inteiro (4 h), a terça tem cálculo seguro: 240 nos dois extremos.
  const small = calendar({ routines: [night], exceptions: [REDUCED_MONDAY(480), { ...onCall, minutes: 240 }], worksOnHolidays: true });
  assert.deepEqual([dayPlan(small, '2026-10-06').minutes, dayPlan(small, '2026-10-06').ambiguous], [240, false]);
  assert.equal(calendarAmbiguity(small, '2026-11-06'), null);
});

test('B02 (P5-F.1-R2A, S01): casos comuns de jornada reduzida continuam aceitos, com as mesmas horas', () => {
  const nights = weekdays(window('22:00', '06:00'));
  // Noturno de segunda a sexta, reduzido a 6 h na quarta 07/10/2026: a quinta não tem janela antes das 22:00 e o
  // teto não morde, então vale 480 com o turno de quarta inteiro ou sem nada dele.
  const wednesday = calendar({ routines: [nights], worksOnHolidays: true, exceptions: [{ kind: 'reduced', start: '2026-10-07', end: '2026-10-07', minutes: 360 }] });
  assert.deepEqual([dayPlan(wednesday, '2026-10-07').minutes, dayPlan(wednesday, '2026-10-08').minutes, dayPlan(wednesday, '2026-10-08').ambiguous], [360, 480, false]);
  assert.equal(calendarAmbiguity(wednesday, '2026-11-06'), null);
  // Com 2 h de hora extra na quinta: 600, também nos dois extremos.
  const overtime = calendar({ ...wednesday, exceptions: [...wednesday.exceptions, { kind: 'overtime', date: '2026-10-08', minutes: 120 }] });
  assert.deepEqual([dayPlan(overtime, '2026-10-08').minutes, dayPlan(overtime, '2026-10-08').ambiguous], [600, false]);
  assert.equal(calendarAmbiguity(overtime, '2026-11-06'), null);
  // O mês inteiro reduzido a 6 h: 22 noites de outubro de 2026, 6 h cada, sem dia ambíguo.
  const month = calendar({ routines: [nights], worksOnHolidays: true, exceptions: [{ kind: 'reduced', start: '2026-10-01', end: '2026-10-31', minutes: 360 }] });
  const october = monthPlan(month, '2026-10', { periodStart: true });
  assert.deepEqual([october.minutes, october.ambiguousDays], [22 * 360, []]);
  assert.equal(calendarAmbiguity(month, '2026-11-06'), null);
  // Escala 24 × 48 (07:00–07:00): o dia de trabalho reduzido a 12 h; o seguinte é folga da escala e conta 0, ou as
  // 4 h de hora extra, nos dois extremos.
  const shifts = calendar({ worksOnHolidays: true, routines: [{ kind: 'cyclic', reference: '2026-10-05', workDays: 1, restDays: 2, day: window('07:00', '07:00') }],
    exceptions: [REDUCED_MONDAY(720), { kind: 'overtime', date: '2026-10-06', minutes: 240 }] });
  assert.deepEqual([dayPlan(shifts, '2026-10-05').minutes, dayPlan(shifts, '2026-10-06').minutes, dayPlan(shifts, '2026-10-06').ambiguous], [720, 240, false]);
  assert.equal(calendarAmbiguity(shifts, '2026-11-06'), null);
  // Jornada reduzida em horário de escritório (nenhuma janela passa da meia-noite): nada muda.
  const office = calendar({ exceptions: [{ kind: 'reduced', start: '2026-10-05', end: '2026-10-09', minutes: 360 }] });
  assert.deepEqual(monthPlan(office, '2026-10').reducedEveDays, []);
  assert.equal(calendarAmbiguity(office, '2026-11-06'), null);
});

test('B02 (P5-F.1-R2A, S01): o dia seguinte só tem cálculo seguro com os dois extremos seguros, e o plano mostrado é o da véspera sem nada', () => {
  // Segunda 22:00–02:00 reduzida a 1 h; terça 01:00–05:00 com 60 min de intervalo; quarta de folga. Sem nada da segunda,
  // a janela de terça não cruza nada (180 min). Com o turno inteiro, ela cruza 01:00–02:00 sem ficar coberta, e as horas
  // dependem da pausa: com a segunda em 01:00–02:00, a terça conta 180 com a pausa nesse trecho e 120 com ela às 03:00.
  // As duas contas dão 180 por coincidência, e mesmo assim não há cálculo seguro.
  const crossing = calendar({ worksOnHolidays: true, routines: [mondayOnly(window('22:00', '02:00')), tuesdayOnly(window('01:00', '05:00', 60))],
    exceptions: [REDUCED_MONDAY(60), { kind: 'day_off', start: '2026-10-07', end: '2026-10-07' }] });
  assert.deepEqual([dayPlan(crossing, '2026-10-06').ambiguous, dayPlan(crossing, '2026-10-06').reducedEve], [true, true]);
  // Com cálculo seguro e o mesmo número nos dois extremos, o plano do dia é o da véspera sem nada (o que a R1 mostrava):
  // terça reduzida a 2 h depois de segunda 20:00–06:00 reduzida a 8 h. Sem nada da segunda, a janela 00:00–08:00 tem 480
  // min e a redução corta; com o turno inteiro, sobram 120 e ela não corta. As horas são 120 nos dois.
  const tuesdayReduced = calendar({ worksOnHolidays: true, routines: [weekly(window('20:00', '06:00'), window('00:00', '08:00'), OFF, OFF, OFF, OFF, OFF)],
    exceptions: [REDUCED_MONDAY(480), { kind: 'reduced', start: '2026-10-06', end: '2026-10-06', minutes: 120 }] });
  const tuesday = dayPlan(tuesdayReduced, '2026-10-06');
  assert.deepEqual([tuesday.minutes, tuesday.ambiguous, tuesday.routineMinutes, tuesday.overlapMinutes, tuesday.applied], [120, false, 480, 0, ['reduced']]);
});

test('B02 (P5-F.1-R2A, S01): a cobertura que vem da véspera reduzida aponta a véspera, com mensagem própria', () => {
  // Segunda 22:00–08:00 sem intervalo cobre a janela de terça 05:00–09:00 com 30 min, que cruza a manhã de terça.
  // Com a segunda reduzida a 5 h, não se sabe se o turno cobriu a pausa: a terça fica sem cálculo seguro pela véspera.
  const routines = [mondayOnly(window('22:00', '08:00')), tuesdayOnly(window('05:00', '09:00', 30)), tuesdayOnly(window('08:00', '12:00'))];
  const input = calendar({ routines, worksOnHolidays: true, exceptions: [REDUCED_MONDAY(300)] });
  assert.deepEqual([dayPlan(input, '2026-10-06').ambiguous, dayPlan(input, '2026-10-06').reducedEve], [true, true]);
  // A partir de 01/10/2026: a terça 06/10 vem antes do primeiro dia de mês numa terça (01/12/2026), que essa
  // cobertura deixa sem cálculo seguro no início do período, com ou sem a redução.
  assert.deepEqual(calendarAmbiguity(input, '2026-10-01'), { date: '2026-10-06', routines: [0], cause: { kind: 'reduced_eve', date: '2026-10-05' } });
  // Com a folga na segunda, o turno não acontece e a causa é o vizinho, como na R1.
  const dayOff = calendar({ routines, worksOnHolidays: true, exceptions: [{ kind: 'day_off', start: '2026-10-05', end: '2026-10-05' }] });
  assert.deepEqual(calendarAmbiguity(dayOff, '2026-10-01')?.cause, { kind: 'neighbor', date: '2026-10-05', reason: 'day_off', holiday: null });
});

test('B02 (P5-F.1-R2A, Teorema 2): a jornada reduzida que passa a cortar horas ao acrescentar uma rotina não tira horas do período', () => {
  // Segunda 22:00–02:00 reduzida a 5 h (não corta nada) e terça 08:00–12:00. Acrescentada segunda 18:00–21:00, a
  // redução corta (7 h > 5 h): a segunda passa de 240 para 300 e a terça, que não cruza o turno, fica em 240.
  const exceptions = [REDUCED_MONDAY(300), { kind: 'vacation', start: '2026-10-12', end: '2026-10-31' } as WorkException];
  const base = [mondayOnly(window('22:00', '02:00')), tuesdayOnly(window('08:00', '12:00'))];
  const plans = [base, [...base, mondayOnly(window('18:00', '21:00'))]].map((routines) => calendar({ routines, exceptions, worksOnHolidays: true }));
  assert.deepEqual(plans.map((input) => [dayPlan(input, '2026-10-05').minutes, dayPlan(input, '2026-10-06').minutes, dayPlan(input, '2026-10-06').ambiguous]),
    [[240, 240, false], [300, 240, false]]);
  for (const input of plans) assert.equal(calendarAmbiguity(input, '2026-11-06'), null);
  const [before, after] = plans.map((input) => monthPlan(input, '2026-10', { periodStart: true }).minutes);
  assert.ok(after >= before, `${before} → ${after}`);
});

test('B02 (revisão 2 da R1, M03): o intervalo da véspera coberto pelo dia conta na véspera e ocupa o dia civil; o teto do dia o desconta', () => {
  // Segunda 20:00–24:00 e terça 00:00–06:00, sem intervalo; acrescentada segunda 22:00–04:00 com 3 h de intervalo,
  // coberta pelas duas. Pela convenção da ocupação, 1 h do intervalo cai depois da meia-noite; coberta pela janela
  // de terça, essa hora conta na segunda (que começou antes) e ocupa o dia civil de terça.
  const base = [weekly(window('20:00', '00:00'), window('00:00', '06:00'), OFF, OFF, OFF, OFF, OFF)];
  const added = [...base, mondayOnly(window('22:00', '04:00', 180))];
  const exceptions: WorkException[] = [{ kind: 'overtime', date: '2026-10-06', minutes: 1440 }];
  // Trabalhando nos feriados: nenhum dia fica sem a rotina, e as duas configurações são aceitas (sem feriado de
  // folga numa terça, que tiraria a cobertura da segunda: 07/09/2027, por exemplo).
  const plans = [base, added].map((routines) => calendar({ routines, exceptions, worksOnHolidays: true }));
  for (const plan of plans) assert.equal(calendarAmbiguity(plan, '2026-11-05'), null);
  // A segunda passa a contar 00:00–04:00 de terça (240 → 480).
  assert.deepEqual(plans.map((plan) => dayPlan(plan, '2026-10-05').minutes), [240, 480]);
  // Com 24 h de hora extra, o dia civil de terça tem 360 min de janelas (240 contados na segunda e 120 na terça):
  // cabem 1.080 de hora extra, e a terça conta 120 + 1.080 = 1.200 (antes, 1.440). Nunca 25 h no dia civil.
  assert.deepEqual(plans.map((plan) => [dayPlan(plan, '2026-10-06').minutes, dayPlan(plan, '2026-10-06').capped]), [[1440, true], [1200, true]]);
  const [before, after] = plans.map((plan) => monthPlan(plan, '2026-10', { periodStart: true }).minutes);
  assert.ok(after >= before, `${before} → ${after}`);
});

const bigMinutes = (next: () => number) => (1 + Math.floor(next() * 24)) * 60;
/** Exceções com jornada reduzida, plantão e hora extra até 24 h, muitas vezes no mesmo dia (revisão da R1, N01). */
const heavyExceptions = (next: () => number): WorkException[] => {
  const out: WorkException[] = [];
  const used = new Map<string, string[]>();
  const free = (kind: string, dates: string[]) => {
    const taken = used.get(kind) ?? [];
    if (dates.some((date) => taken.includes(date))) return false;
    used.set(kind, [...taken, ...dates]);
    return true;
  };
  for (let index = 0; index < 1 + Math.floor(next() * 8); index += 1) {
    const start = randomDate(next);
    const span = Math.floor(next() * 3);
    const dates = Array.from({ length: span + 1 }, (_, offset) => addDays(start, offset) as string);
    const end = dates[dates.length - 1];
    const roll = next();
    if (roll < 0.35) {
      if (free('reduced', dates)) out.push({ kind: 'reduced', start, end, minutes: bigMinutes(next) });
      if (next() < 0.7 && free('on_call', [start])) out.push({ kind: 'on_call', date: start, minutes: bigMinutes(next) });
      if (next() < 0.5 && free('overtime', [start])) out.push({ kind: 'overtime', date: start, minutes: bigMinutes(next) });
    } else if (roll < 0.6) {
      if (free('on_call', [start])) out.push({ kind: 'on_call', date: start, minutes: bigMinutes(next) });
    } else if (roll < 0.8) {
      if (free('overtime', [start])) out.push({ kind: 'overtime', date: start, minutes: bigMinutes(next) });
    } else if (roll < 0.9) {
      if (free('schedule_change', [start])) out.push({ kind: 'schedule_change', date: start, minutes: Math.floor(next() * 25) * 60 });
    } else if (free('day_off', dates)) {
      out.push({ kind: 'day_off', start, end });
    }
  }
  return out;
};

test('B02 (propriedade, revisão da R1): com jornada reduzida, plantão e hora extra até 24 h, acrescentar uma rotina nunca tira horas', () => {
  // Dirigida ao caso da revisão (N01): a rotina acrescentada tem janela num só dia da semana D, as outras ocorrências
  // de D na janela de meses ficam em férias e, nas que sobram, há jornada reduzida com plantão ou hora extra até 24 h.
  // Assim, a soma do período só muda nesses dias. Na árvore revisada, cerca de 1 amostra em 5 perdia horas.
  const next = random(20261110);
  const hoursOf = (min: number, max: number) => (min + Math.floor(next() * (max - min + 1))) * 60;
  const sameDay = (min: number, max: number): DaySpec => {
    const length = hoursOf(min, max);
    const start = Math.floor(next() * ((1440 - length) / 60 + 1)) * 60;
    return { kind: 'window', start, end: (start + length) % 1440, breakMinutes: 0 };
  };
  const baseDay = (): DaySpec => {
    const roll = next();
    if (roll < 0.2) return OFF;
    if (roll < 0.3) return duration(bigMinutes(next));
    if (roll < 0.4) {
      const start = (18 + Math.floor(next() * 6)) * 60;
      return { kind: 'window', start, end: Math.floor(next() * 9) * 60, breakMinutes: 0 };
    }
    return sameDay(2, 10);
  };
  let checked = 0;
  let cappedReducedDays = 0;
  for (let sample = 0; sample < 1_500; sample += 1) {
    const target = Math.floor(next() * 7);
    const base = weekly(...Array.from({ length: 7 }, baseDay));
    const added = weekly(...Array.from({ length: 7 }, (_, day) => (day === target ? sameDay(1, 8) : OFF)));
    const exceptions: WorkException[] = [];
    for (let date = '2026-08-01'; date <= '2026-10-31'; date = addDays(date, 1) as string) {
      if (weekdayIndex(date) !== target) continue;
      if (next() < 0.75) { exceptions.push({ kind: 'vacation', start: date, end: date }); continue; }
      exceptions.push({ kind: 'reduced', start: date, end: date, minutes: hoursOf(4, 16) });
      if (next() < 0.5) exceptions.push({ kind: 'on_call', date, minutes: 1440 });
      else exceptions.push({ kind: 'on_call', date, minutes: hoursOf(6, 24) }, { kind: 'overtime', date, minutes: hoursOf(6, 24) });
    }
    const extra = { exceptions, worksOnHolidays: next() < 0.5, localHolidays: [] };
    const before = periodPlans(calendar({ ...extra, routines: [base] }));
    const after = periodPlans(calendar({ ...extra, routines: [base, added] }));
    if ([...before, ...after].some((plan) => plan.ambiguousDays.length > 0)) continue;
    checked += 1;
    cappedReducedDays += after.flatMap((plan) => plan.days).filter((day) => day.capped && day.applied.includes('reduced')).length;
    const total = (plans: MonthPlan[]) => plans.reduce((sum, plan) => sum + plan.minutes, 0);
    assert.ok(total(after) >= total(before), `amostra ${sample}: ${total(before)} → ${total(after)} ${JSON.stringify({ base, added, extra })}`);
  }
  assert.ok(checked > 1_000, `pares com cálculo seguro: ${checked}`);
  assert.ok(cappedReducedDays > 300, `dias reduzidos no teto (o caso da revisão): ${cappedReducedDays}`);
});

test('B02 (propriedade, revisão da R1): sem janela que passe da meia-noite, nenhum dia passa de 24 h, com qualquer exceção', () => {
  const next = random(20261108);
  const sameDayWindow = (): DaySpec => {
    const start = Math.floor(next() * 23) * 60;
    const end = start + (1 + Math.floor(next() * ((1440 - start) / 60))) * 60;
    return { kind: 'window', start, end: end % 1440, breakMinutes: next() < 0.5 ? 0 : Math.min(end - start - 60, 60) };
  };
  const sameDayRoutine = (): WorkRoutine => weekly(...Array.from({ length: 7 }, () => {
    const roll = next();
    return roll < 0.35 ? OFF : roll < 0.5 ? duration(bigMinutes(next)) : sameDayWindow();
  }));
  let days = 0;
  for (let sample = 0; sample < 1_500; sample += 1) {
    const input = calendar({ routines: [sameDayRoutine(), sameDayRoutine()], exceptions: heavyExceptions(next), worksOnHolidays: next() < 0.5 });
    for (const plan of periodPlans(input)) {
      for (const day of plan.days) {
        if (day.ambiguous) continue;
        days += 1;
        assert.ok(day.minutes <= 1440, `amostra ${sample}, ${day.date}: ${day.minutes} min ${JSON.stringify(input)}`);
      }
    }
  }
  assert.ok(days > 100_000, `dias conferidos: ${days}`);
});

// Segunda 20:00–24:00 sem intervalo, segunda 22:00–02:00 com 30 min e terça 00:00–08:00 sem intervalo: a janela com
// intervalo fica dentro das outras duas (a de terça cobre o trecho depois da meia-noite).
const COVERED_BY_TUESDAY: WorkRoutine[] = [
  mondayOnly(window('20:00', '00:00')),
  mondayOnly(window('22:00', '02:00', 30)),
  weekly(OFF, window('00:00', '08:00'), OFF, OFF, OFF, OFF, OFF),
];

test('B02 (revisão da R1, N07): o conferidor do calendário inteiro acha o dia sem cálculo seguro por exceção, feriado ou início do período', () => {
  const base = calendar({ routines: COVERED_BY_TUESDAY, worksOnHolidays: true });
  assert.equal(routinesAmbiguity(base.routines, '2026-10-01'), null);
  assert.equal(calendarAmbiguity(base, '2026-10-01'), null);
  assert.deepEqual(monthPlan(base, '2026-10').ambiguousDays, []);

  // Folga na terça 20/10: a janela de segunda 19/10 cruza a de 20:00–24:00 sem ficar coberta.
  const dayOff = calendar({ ...base, exceptions: [{ kind: 'day_off', start: '2026-10-20', end: '2026-10-20' }] });
  assert.deepEqual(calendarAmbiguity(dayOff, '2026-10-01'),
    { date: '2026-10-19', routines: [0, 1], cause: { kind: 'neighbor', date: '2026-10-20', reason: 'day_off', holiday: null } });
  assert.deepEqual(monthPlan(dayOff, '2026-10').ambiguousDays, ['2026-10-19'], 'o motor confirma o dia');
  // A jornada reduzida, as férias e a alteração de escala na terça fazem o mesmo.
  for (const exception of [
    { kind: 'reduced', start: '2026-10-20', end: '2026-10-22', minutes: 240 },
    { kind: 'vacation', start: '2026-10-20', end: '2026-10-30' },
    { kind: 'schedule_change', date: '2026-10-20', minutes: 0 },
  ] as WorkException[]) {
    const result = calendarAmbiguity(calendar({ ...base, exceptions: [exception] }), '2026-10-01');
    assert.deepEqual([result?.date, result?.cause], ['2026-10-19', { kind: 'neighbor', date: '2026-10-20', reason: exception.kind, holiday: null }], exception.kind);
  }
  // Plantão e hora extra na terça não tiram a rotina: nada muda.
  assert.equal(calendarAmbiguity(calendar({ ...base, exceptions: [{ kind: 'on_call', date: '2026-10-20', minutes: 600 }] }), '2026-10-01'), null);

  // Feriado local na terça 27/10, sem trabalhar em feriados: 26/10; trabalhado, ou trabalhando em feriados, nada.
  const local = calendar({ ...base, worksOnHolidays: false, localHolidays: [{ kind: 'date', date: '2026-10-27' }] });
  const onlyNational = calendarAmbiguity(calendar({ ...base, worksOnHolidays: false }), '2026-10-01');
  assert.deepEqual(calendarAmbiguity(local, '2026-10-01'),
    { date: '2026-10-26', routines: [0, 1], cause: { kind: 'neighbor', date: '2026-10-27', reason: 'holiday', holiday: 'Feriado local' } });
  assert.equal(calendarAmbiguity({ ...local, exceptions: [{ kind: 'holiday_worked', date: '2026-10-27' }] }, '2026-10-01')?.date, onlyNational?.date);
  assert.equal(calendarAmbiguity({ ...local, worksOnHolidays: true }, '2026-10-01'), null);
  // Feriado nacional numa terça: Tiradentes, 21/04/2026.
  assert.deepEqual(calendarAmbiguity(calendar({ ...base, worksOnHolidays: false }), '2026-04-01'),
    { date: '2026-04-20', routines: [0, 1], cause: { kind: 'neighbor', date: '2026-04-21', reason: 'holiday', holiday: 'Tiradentes' } });

  // Início do período: domingo 20:00–04:00, segunda 01:00–05:00 com 30 min e segunda 03:00–06:00. A janela com
  // intervalo fica dentro do turno de domingo e da janela das 03:00; no primeiro dia do período, sem a véspera, não.
  const sundayCover = calendar({ worksOnHolidays: true, routines: [
    weekly(OFF, OFF, OFF, OFF, OFF, OFF, window('20:00', '04:00')),
    mondayOnly(window('01:00', '05:00', 30)),
    mondayOnly(window('03:00', '06:00')),
  ] });
  assert.equal(routinesAmbiguity(sundayCover.routines, '2026-05-10'), null);
  assert.deepEqual(monthPlan(sundayCover, '2026-06').ambiguousDays, [], 'na vista do mês, a véspera conta');
  assert.deepEqual(monthPlan(sundayCover, '2026-06', { periodStart: true }).ambiguousDays, ['2026-06-01']);
  assert.deepEqual(calendarAmbiguity(sundayCover, '2026-05-10'), { date: '2026-06-01', routines: [1, 2], cause: { kind: 'period_start' } });

  // A partir de hoje: o primeiro dia assim depois de hoje; sem nenhum depois, o primeiro antes (até 12 meses).
  assert.equal(calendarAmbiguity(dayOff, '2026-11-05')?.date, '2026-10-19');
  const twoDaysOff = calendar({ ...base, exceptions: [
    { kind: 'day_off', start: '2026-10-20', end: '2026-10-20' }, { kind: 'day_off', start: '2026-12-01', end: '2026-12-01' },
  ] });
  assert.equal(calendarAmbiguity(twoDaysOff, '2026-11-05')?.date, '2026-11-30');
  assert.equal(calendarAmbiguity(twoDaysOff, '2026-10-01')?.date, '2026-10-19');
  // Mais de 12 meses antes do mês de hoje não conta: nenhuma estimativa usa esses dias.
  assert.equal(calendarAmbiguity(dayOff, '2027-11-05'), null);
});

test('B02 (propriedade, revisão da R1): o que o conferidor do calendário inteiro aceita nunca tem dia sem cálculo seguro, e o dia que ele aponta é ambíguo', () => {
  const next = random(20261109);
  const TODAY_CHECK = '2026-11-05';
  const months: string[] = [];
  for (let month: string | null = '2025-11'; month !== null && month <= '2027-02'; month = shiftMonthKey(month, 1)) months.push(month);
  const quarter = (value: number) => Math.floor(value / 15) * 15;
  // Metade das amostras: a cobertura vem da véspera (um turno sem intervalo que passa da meia-noite cobre uma
  // janela com intervalo da manhã seguinte, que cruza outra janela do mesmo dia); a outra metade, do próprio dia.
  const crossDay = (): WorkRoutine[] => {
    const cover: DaySpec[] = [];
    const morning: DaySpec[] = [];
    const after: DaySpec[] = [];
    const covers = Array.from({ length: 7 }, () => next() < 0.6);
    for (let day = 0; day < 7; day += 1) {
      const coverEnd = 240 + quarter(next() * 300);
      cover.push(covers[day] ? { kind: 'window', start: 1080 + quarter(next() * 300), end: coverEnd, breakMinutes: 0 } : OFF);
      const previousCovers = covers[(day + 6) % 7];
      if (!previousCovers || next() < 0.25) { morning.push(OFF); after.push(OFF); continue; }
      const start = quarter(next() * 120);
      const end = Math.min(start + 60 + quarter(next() * 120), 240);
      morning.push({ kind: 'window', start, end, breakMinutes: 15 + quarter(next() * (end - start - 30)) });
      after.push(next() < 0.8 ? { kind: 'window', start: start + 15, end: end + 60 + quarter(next() * 120), breakMinutes: 0 } : OFF);
    }
    return [weekly(...cover), weekly(...morning), weekly(...after)];
  };
  const sameDay = (): WorkRoutine[] => {
    const outer: DaySpec[] = [];
    const inner: DaySpec[] = [];
    for (let day = 0; day < 7; day += 1) {
      if (next() < 0.4) { outer.push(OFF); inner.push(OFF); continue; }
      const start = quarter(next() * 1440);
      const length = 15 * (8 + Math.floor(next() * 88));
      outer.push({ kind: 'window', start, end: (start + length) % 1440, breakMinutes: 0 });
      const offset = quarter(next() * Math.max(15, length - 30));
      const innerLength = Math.max(30, quarter(next() * (length - offset)));
      const innerStart = (start + offset) % 1440;
      inner.push(next() < 0.3 ? OFF : { kind: 'window', start: innerStart, end: (innerStart + innerLength) % 1440, breakMinutes: quarter(next() * (innerLength - 15)) });
    }
    return [weekly(...outer), weekly(...inner)];
  };
  let accepted = 0;
  let refusedByCalendar = 0;
  for (let sample = 0; sample < 220; sample += 1) {
    const routines = next() < 0.5 ? crossDay() : sameDay();
    const exceptions: WorkException[] = [];
    for (let index = 0; index < Math.floor(next() * 4); index += 1) {
      const start = addDays('2025-11-01', Math.floor(next() * 480)) as string;
      const kind = pick(next, ['day_off', 'vacation', 'reduced', 'schedule_change'] as const);
      if (exceptions.some((entry) => entry.kind === kind)) continue;
      if (kind === 'schedule_change') exceptions.push({ kind, date: start, minutes: 240 });
      else if (kind === 'reduced') exceptions.push({ kind, start, end: addDays(start, 2) as string, minutes: 300 });
      else exceptions.push({ kind, start, end: addDays(start, Math.floor(next() * 3)) as string });
    }
    const input = calendar({ routines, exceptions, worksOnHolidays: next() < 0.5,
      localHolidays: next() < 0.4 ? [{ kind: 'annual', month: 1 + Math.floor(next() * 12), day: 1 + Math.floor(next() * 28) }] : [] });
    const verdict = calendarAmbiguity(input, TODAY_CHECK);
    if (verdict === null) {
      accepted += 1;
      for (const month of months) {
        for (const periodStart of [false, true]) {
          assert.deepEqual(monthPlan(input, month, { periodStart }).ambiguousDays, [], `amostra ${sample}, ${month}${periodStart ? ' abrindo o período' : ''}: ${JSON.stringify(input)}`);
        }
      }
    } else if (verdict.cause.kind === 'routines') {
      assert.notEqual(routinesAmbiguity(input.routines, TODAY_CHECK), null);
    } else {
      refusedByCalendar += 1;
      const plan = monthPlan(input, verdict.date.slice(0, 7), { periodStart: verdict.cause.kind === 'period_start' });
      assert.ok(plan.ambiguousDays.includes(verdict.date), `amostra ${sample}: ${JSON.stringify(verdict)} ${JSON.stringify(input)}`);
    }
  }
  assert.ok(accepted > 60, `aceitas: ${accepted}`);
  assert.ok(refusedByCalendar > 20, `recusadas por feriado, exceção ou início do período: ${refusedByCalendar}`);
});

// ------------------------------------------- P5-F.1-R2A, S01: propriedades da véspera em jornada reduzida

/** Trechos no eixo de minutos a partir das 00:00 da segunda 05/10/2026 (terça: 1.440 a 2.880). */
type Span = readonly [number, number];
const unite = (spans: readonly Span[]): Span[] => {
  const merged: Array<[number, number]> = [];
  for (const [a, b] of spans.filter(([x, y]) => y > x).map(([x, y]): [number, number] => [x, y]).sort((p, q) => p[0] - q[0])) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  return merged;
};
const size = (spans: readonly Span[]) => spans.reduce((sum, [a, b]) => sum + b - a, 0);
const meet = (a: readonly Span[], b: readonly Span[]): Span[] =>
  unite(a.flatMap(([a0, a1]) => b.map(([b0, b1]): Span => [Math.max(a0, b0), Math.min(a1, b1)])));
const minus = (a: readonly Span[], b: readonly Span[]): Span[] => {
  let rest: Span[] = unite(a);
  for (const [b0, b1] of unite(b)) {
    rest = rest.flatMap(([a0, a1]): Span[] => [[a0, Math.min(a1, b0)], [Math.max(a0, b1), a1]]).filter(([x, y]) => y > x);
  }
  return rest;
};
/** Os primeiros `amount` minutos das regiões, na ordem dada (em cada região, do começo ou do fim). */
const take = (regions: ReadonlyArray<{ spans: readonly Span[]; fromEnd: boolean }>, amount: number): Span[] => {
  const out: Span[] = [];
  let left = amount;
  for (const region of regions) {
    const spans = region.fromEnd ? [...unite(region.spans)].reverse() : unite(region.spans);
    for (const [a, b] of spans) {
      if (left <= 0) break;
      const piece = Math.min(left, b - a);
      out.push(region.fromEnd ? [b - piece, b] : [a, a + piece]);
      left -= piece;
    }
  }
  return unite(out);
};
const MONDAY_CIVIL: Span = [0, 1440];
const TUESDAY_CIVIL: Span = [1440, 2880];

/** O dia seguinte (terça) como a pessoa o informou: janelas sem intervalo, durações, acréscimos e exceções. */
interface NextDay { windows: Span[]; durations: number; additions: number; reduced: number | null; scheduleChange: number | null; absent: boolean }

/**
 * Especificação executável do dia seguinte (rotinas-matematica.md §3), com a véspera tendo trabalhado exatamente
 * o trecho `worked` das janelas dela: o trecho em comum conta na véspera, e os minutos sem horário só ocupam o que
 * sobra do dia civil. Independente do código do motor: só aritmética de trechos e a fórmula do teto.
 */
const nextDaySpec = (day: NextDay, worked: readonly Span[]) => {
  const windows = unite(day.windows);
  const w = size(minus(windows, worked));
  const after = size(meet(windows, [[2880, 2880 + 1440]]));
  const occupied = size(meet(worked, [TUESDAY_CIVIL]));
  let r = w + day.durations;
  if (day.scheduleChange !== null) r = day.scheduleChange;
  else if (day.reduced !== null && r > day.reduced) r = day.reduced;
  if (day.absent && r > 0) r = 0;
  const happens = day.scheduleChange === null && !day.absent;
  const windowPart = happens ? Math.min(r, after) : 0;
  return { minutes: Math.min(r + day.additions, windowPart + Math.max(0, 1440 - occupied)), windowPart, occupied };
};

const grid15 = (next: () => number, max: number) => Math.floor(next() * (Math.floor(max / 15) + 1)) * 15;
const spanSpec = (start: number, length: number): DaySpec => ({ kind: 'window', start: start % 1440, end: (start + length) % 1440, breakMinutes: 0 });

test('B02 (propriedade, P5-F.1-R2A): depois de uma jornada reduzida, o dia aceito vale o mesmo em qualquer parte do turno da véspera que tenha acontecido, e o recusado depende mesmo dela', () => {
  const next = random(20261113);
  let accepted = 0;
  let refused = 0;
  let necessary = 0;
  let notBiting = 0;
  for (let sample = 0; sample < 4_000; sample += 1) {
    // Segunda: um turno que passa da meia-noite e, às vezes, outra janela qualquer (sem intervalo).
    const nightStart = 1020 + grid15(next, 405);
    const minLength = 1440 - nightStart + 15;
    const mondaySpans: Span[] = [[nightStart, nightStart + minLength + grid15(next, 1440 - minLength)]];
    if (next() < 0.3) { const start = grid15(next, 1425); mondaySpans.push([start, start + 15 + grid15(next, 1425)]); }
    // Terça: até duas janelas (metade começa entre 00:00 e 08:00, no trecho do turno), durações, acréscimos e exceções.
    const tuesdaySpans: Span[] = Array.from({ length: Math.floor(next() * 3) }, (): Span => {
      const start = next() < 0.5 ? grid15(next, 480) : grid15(next, 1425);
      return [1440 + start, 1440 + start + 15 + grid15(next, 945)];
    });
    const day: NextDay = { windows: tuesdaySpans, durations: next() < 0.25 ? 60 + grid15(next, 1380) : 0, additions: 0, reduced: null, scheduleChange: null, absent: false };
    const tuesdayExceptions: WorkException[] = [];
    const roll = next();
    if (roll >= 0.45) {
      if (roll < 0.7 || (roll >= 0.7 && roll < 0.8 && next() < 0.5)) {
        const minutes = 60 + grid15(next, 1380);
        tuesdayExceptions.push({ kind: next() < 0.5 ? 'on_call' : 'overtime', date: '2026-10-06', minutes });
        day.additions = minutes;
      }
      if (roll >= 0.7 && roll < 0.8) { day.reduced = 60 + grid15(next, 660); tuesdayExceptions.push({ kind: 'reduced', start: '2026-10-06', end: '2026-10-06', minutes: day.reduced }); }
      else if (roll >= 0.8 && roll < 0.9) { day.scheduleChange = grid15(next, 1440); tuesdayExceptions.push({ kind: 'schedule_change', date: '2026-10-06', minutes: day.scheduleChange }); }
      else if (roll >= 0.9) { day.absent = true; tuesdayExceptions.push({ kind: 'day_off', start: '2026-10-06', end: '2026-10-06' }); }
    }
    const limit = 15 + grid15(next, 1425);
    const input = calendar({
      worksOnHolidays: true,
      routines: [
        ...mondaySpans.map(([a, b]) => mondayOnly(spanSpec(a, b - a))),
        ...tuesdaySpans.map(([a, b]) => tuesdayOnly(spanSpec(a - 1440, b - a))),
        ...(day.durations > 0 ? [tuesdayOnly(duration(day.durations))] : []),
      ],
      exceptions: [
        { kind: 'day_off', start: '2026-10-04', end: '2026-10-04' },
        { kind: 'day_off', start: '2026-10-07', end: '2026-10-07' },
        REDUCED_MONDAY(limit),
        ...tuesdayExceptions,
      ],
    });
    const engine = dayPlan(input, '2026-10-06');
    const monday = unite(mondaySpans);
    const context = `amostra ${sample}: ${JSON.stringify({ mondaySpans, limit, day })}`;
    const full = nextDaySpec(day, monday).minutes;
    const none = nextDaySpec(day, []).minutes;
    if (limit >= size(monday)) {
      // A redução não corta nada: a segunda é a rotina, e a terça desconta o turno inteiro.
      notBiting += 1;
      assert.deepEqual([engine.ambiguous, engine.minutes], [false, full], context);
      continue;
    }
    // O motor recusa exatamente quando os dois extremos (nada do turno, o turno inteiro) diferem.
    assert.equal(engine.ambiguous, full !== none, context);
    // As partes possíveis com o total da redução: a mais tarde (sobre a terça e as janelas dela) e a mais cedo.
    const shared = meet(monday, unite(tuesdaySpans));
    const tuesdayRest = minus(meet(monday, [TUESDAY_CIVIL]), shared);
    const mondayPart = meet(monday, [MONDAY_CIVIL]);
    const late = take([{ spans: shared, fromEnd: false }, { spans: tuesdayRest, fromEnd: false }, { spans: mondayPart, fromEnd: true }], limit);
    const early = take([{ spans: mondayPart, fromEnd: false }, { spans: tuesdayRest, fromEnd: false }, { spans: shared, fromEnd: false }], limit);
    assert.deepEqual([size(late), size(early)], [limit, limit], context);
    if (engine.ambiguous) {
      refused += 1;
      assert.equal(engine.reducedEve, true, context);
      // Sem minutos sem horário nem exceções na terça, duas partes possíveis da segunda dão terças diferentes.
      const plain = day.durations === 0 && day.additions === 0 && day.reduced === null && day.scheduleChange === null && !day.absent;
      if (plain) {
        necessary += 1;
        assert.notEqual(nextDaySpec(day, late).minutes, nextDaySpec(day, early).minutes, context);
      }
      continue;
    }
    accepted += 1;
    const randomParts = Array.from({ length: 4 }, () => unite(monday.flatMap(([a, b]): Span[] => {
      if (next() < 0.4) return [];
      const u = a + Math.floor(next() * (b - a));
      return [[u, u + Math.floor(next() * (b - u + 1))]];
    })));
    for (const worked of [[], monday, late, early, ...randomParts]) {
      const spec = nextDaySpec(day, worked);
      assert.equal(spec.minutes, engine.minutes, `${context} parte ${JSON.stringify(worked)}`);
      // Nenhum dia civil passa de 24 h: o que a terça conta no dia civil dela mais o que a segunda ocupa nele.
      assert.ok(engine.minutes - Math.min(engine.minutes, spec.windowPart) + spec.occupied <= 1440, `${context} dia civil`);
    }
  }
  assert.ok(accepted > 800, `aceitas: ${accepted}`);
  assert.ok(refused > 500, `recusadas: ${refused}`);
  assert.ok(necessary > 150, `recusadas sem minutos sem horário: ${necessary}`);
  assert.ok(notBiting > 100, `reduções que não cortam: ${notBiting}`);
});

/** Um dia de rotina para as propriedades: folga, turno que passa da meia-noite, janela diurna ou duração. */
const nightOrDay = (next: () => number): DaySpec => {
  const roll = next();
  if (roll < 0.35) return OFF;
  if (roll < 0.65) return { kind: 'window', start: 1080 + grid15(next, 345), end: grid15(next, 540), breakMinutes: 0 };
  if (roll < 0.9) {
    const start = 360 + grid15(next, 600);
    return { kind: 'window', start, end: Math.min(start + 60 + grid15(next, 600), 1425), breakMinutes: 0 };
  }
  return duration(60 + grid15(next, 720));
};
/** Como `nightOrDay`, com mais janelas que começam na madrugada (o trecho do turno da véspera). */
const nightOrEarly = (next: () => number): DaySpec => {
  const roll = next();
  if (roll < 0.25) return OFF;
  if (roll < 0.6) return { kind: 'window', start: 1080 + grid15(next, 345), end: grid15(next, 540), breakMinutes: 0 };
  if (roll < 0.9) {
    const start = grid15(next, 360);
    return { kind: 'window', start, end: start + 120 + grid15(next, 480), breakMinutes: 0 };
  }
  return duration(60 + grid15(next, 720));
};
const passesMidnightOn = (routines: readonly WorkRoutine[], date: string): boolean => routines.some((routine) => {
  const spec = routine.kind === 'weekly' ? routine.days[weekdayIndex(date)] : routineIsWorking(routine, date) ? routine.day : OFF;
  return spec.kind === 'window' && spec.start + (spec.end > spec.start ? spec.end - spec.start : 1440 - spec.start + spec.end) > 1440;
});
const reducedAndAdditions = (next: () => number, firstDate: string, days: number): WorkException[] => {
  const out: WorkException[] = [];
  const takenRanges: Array<[string, string]> = [];
  for (let index = 0; index < 1 + Math.floor(next() * 3); index += 1) {
    const start = addDays(firstDate, Math.floor(next() * days)) as string;
    const end = addDays(start, Math.floor(next() * 5)) as string;
    if (takenRanges.some(([a, b]) => start <= b && end >= a)) continue;
    takenRanges.push([start, end]);
    out.push({ kind: 'reduced', start, end, minutes: 60 + grid15(next, 600) });
  }
  const dates = new Set<string>();
  for (let index = 0; index < Math.floor(next() * 4); index += 1) {
    const date = addDays(firstDate, Math.floor(next() * days)) as string;
    const kind = next() < 0.5 ? 'on_call' : 'overtime';
    if (dates.has(`${kind}${date}`)) continue;
    dates.add(`${kind}${date}`);
    out.push({ kind, date, minutes: 60 + grid15(next, 1380) });
  }
  if (next() < 0.2) { const date = addDays(firstDate, Math.floor(next() * days)) as string; out.push({ kind: 'day_off', start: date, end: date }); }
  if (next() < 0.2) out.push({ kind: 'schedule_change', date: addDays(firstDate, Math.floor(next() * days)) as string, minutes: grid15(next, 720) });
  return out;
};

test('B02 (propriedade, P5-F.1-R2A): com jornadas reduzidas em turnos que passam da meia-noite, acrescentar uma rotina nunca tira horas', () => {
  const next = random(20261114);
  let checked = 0;
  let reducedNights = 0;
  for (let sample = 0; sample < 2_500; sample += 1) {
    const routines = Array.from({ length: 1 + Math.floor(next() * 2) }, () => weekly(...Array.from({ length: 7 }, () => nightOrDay(next))));
    const added = [...routines, weekly(...Array.from({ length: 7 }, () => nightOrDay(next)))];
    const extra = { exceptions: reducedAndAdditions(next, '2026-07-30', 96), worksOnHolidays: next() < 0.5, localHolidays: [] };
    const before = periodPlans(calendar({ ...extra, routines }));
    const after = periodPlans(calendar({ ...extra, routines: added }));
    if ([...before, ...after].some((plan) => plan.ambiguousDays.length > 0)) continue;
    checked += 1;
    const total = (plans: MonthPlan[]) => plans.reduce((sum, plan) => sum + plan.minutes, 0);
    assert.ok(total(after) >= total(before), `amostra ${sample}: ${total(before)} → ${total(after)} ${JSON.stringify({ routines, added: added.at(-1), extra })}`);
    // Os casos novos: um dia reduzido que corta horas de um turno que passa da meia-noite, com o seguinte aceito.
    reducedNights += after.flatMap((plan) => plan.days).filter((day) => day.applied.includes('reduced') && passesMidnightOn(added, day.date)).length;
  }
  assert.ok(checked > 700, `pares com cálculo seguro: ${checked}`);
  assert.ok(reducedNights > 1_000, `dias reduzidos com turno que passa da meia-noite: ${reducedNights}`);
});

test('B02 (propriedade, P5-F.1-R2A, R2A-01): com a jornada reduzida no dia que abre o período, o segundo dia aceito não depende da parte trabalhada, e acrescentar uma rotina nunca tira horas', () => {
  // O período começa em 01/08/2026, um sábado reduzido. Sexta (fora do período) tem um turno que entra na manhã de
  // sábado; sábado, uma janela que começa nesse trecho e, às vezes, um turno que entra no domingo; domingo, uma janela
  // que começa nesse trecho ou uma duração. O limite cai perto da faixa entre o que o sábado conta com a sexta e sem ela:
  // é onde um critério que descontasse a sexta erraria (R2A-01).
  const next = random(20261116);
  const OPENING = '2026-08-01';
  const SECOND = '2026-08-02';
  const total = (plans: MonthPlan[]) => plans.reduce((sum, plan) => sum + plan.minutes, 0);
  const secondDay = (input: WorkCalendar, exceptions: WorkException[]) =>
    monthPlan(calendar({ ...input, exceptions }), '2026-08', { periodStart: true }).days.find((day) => day.date === SECOND);
  const early = (from: number): DaySpec => {
    const start = grid15(next, 480);
    return { kind: 'window', start, end: Math.min(start + from + grid15(next, 840), 1425), breakMinutes: 0 };
  };
  const night = (): DaySpec => ({ kind: 'window', start: 1080 + grid15(next, 345), end: 60 + grid15(next, 540), breakMinutes: 0 });
  /** Trechos absolutos de uma janela do dia `offset` (sexta = 0, sábado = 1). */
  const spansOf = (spec: DaySpec, offset: number): Span[] => (spec.kind !== 'window' ? [] : [[offset * 1440 + spec.start, offset * 1440 + spec.start + (spec.end > spec.start ? spec.end - spec.start : 1440 - spec.start + spec.end)]]);
  let compared = 0;
  let cutting = 0;
  let gap = 0;
  let pairs = 0;
  for (let sample = 0; sample < 1_500; sample += 1) {
    const friday = night();
    const saturdayEarly = early(60);
    const saturdayNight = next() < 0.7 ? night() : OFF;
    const sunday = next() < 0.8 ? early(60) : duration(60 + grid15(next, 900));
    const routines = [weekly(OFF, OFF, OFF, OFF, friday, saturdayEarly, sunday), ...(saturdayNight.kind === 'off' ? [] : [weekly(OFF, OFF, OFF, OFF, OFF, saturdayNight, OFF)])];
    const added = [...routines, next() < 0.5 ? weekly(OFF, OFF, OFF, OFF, OFF, night(), OFF) : weekly(...Array.from({ length: 7 }, () => nightOrDay(next)))];
    const saturday = unite([...spansOf(saturdayEarly, 1), ...spansOf(saturdayNight, 1)]);
    const withFriday = size(minus(saturday, spansOf(friday, 0)));
    const limit = Math.min(1440, Math.max(15, withFriday - 60 + grid15(next, size(saturday) - withFriday + 120)));
    if (limit >= withFriday && limit < size(saturday)) gap += 1;
    const reduced: WorkException = { kind: 'reduced', start: OPENING, end: OPENING, minutes: limit };
    const inputs = [routines, added].map((list) => calendar({ worksOnHolidays: true, exceptions: [reduced], routines: list }));
    const plans = inputs.map(periodPlans);
    inputs.forEach((input, index) => {
      if (plans[index].some((plan) => plan.ambiguousDays.length > 0)) return;
      compared += 1;
      const context = `amostra ${sample}, ${index === 0 ? 'antes' : 'depois'}: ${JSON.stringify(input)}`;
      // Os extremos da parte trabalhada do sábado: tudo (o dia segue a rotina) e nada (ausência no dia).
      const engine = plans[index][0].days.find((day) => day.date === SECOND);
      assert.equal(engine?.minutes, secondDay(input, [])?.minutes, `${context}: com o sábado inteiro`);
      // Quando o limite corta o que o sábado conta abrindo o período, a parte trabalhada não é conhecida.
      const uncapped = monthPlan(calendar({ ...input, exceptions: [] }), '2026-08', { periodStart: true }).days[0].minutes;
      if (uncapped > limit) {
        cutting += 1;
        assert.equal(engine?.minutes, secondDay(input, [{ kind: 'absence', start: OPENING, end: OPENING }])?.minutes, `${context}: sem nada do sábado`);
      }
    });
    if (plans.flat().some((plan) => plan.ambiguousDays.length > 0)) continue;
    pairs += 1;
    assert.ok(total(plans[1]) >= total(plans[0]), `amostra ${sample}: ${total(plans[0])} → ${total(plans[1])} ${JSON.stringify({ routines, added: added.at(-1), reduced })}`);
  }
  assert.ok(compared > 1_300, `configurações aceitas conferidas: ${compared}`);
  assert.ok(cutting > 850, `com o limite cortando o sábado que abre o período: ${cutting}`);
  assert.ok(gap > 350, `com o limite entre o sábado com a sexta e sem ela: ${gap}`);
  assert.ok(pairs > 550, `pares com cálculo seguro: ${pairs}`);
});

test('B02 (propriedade, P5-F.1-R2A): sem intervalo nenhum, o conferidor acha o dia seguinte a cada jornada reduzida sem cálculo seguro, e o que ele aceita nunca tem dia ambíguo', () => {
  const next = random(20261115);
  const TODAY_CHECK = '2026-11-05';
  const months: string[] = [];
  for (let month: string | null = '2025-11'; month !== null && month <= '2027-02'; month = shiftMonthKey(month, 1)) months.push(month);
  let accepted = 0;
  let refused = 0;
  for (let sample = 0; sample < 220; sample += 1) {
    const routines = Array.from({ length: 1 + Math.floor(next() * 2) }, () => weekly(...Array.from({ length: 7 }, () => nightOrEarly(next))));
    const input = calendar({ routines, exceptions: reducedAndAdditions(next, '2025-11-01', 480), worksOnHolidays: next() < 0.5 });
    const verdict = calendarAmbiguity(input, TODAY_CHECK);
    const context = `amostra ${sample}: ${JSON.stringify(input)}`;
    if (verdict === null) {
      accepted += 1;
      for (const month of months) {
        for (const periodStart of [false, true]) assert.deepEqual(monthPlan(input, month, { periodStart }).ambiguousDays, [], `${context} ${month}`);
      }
      continue;
    }
    // Sem intervalo, as rotinas sozinhas, os vizinhos e o início do período nunca tiram o cálculo seguro.
    refused += 1;
    assert.equal(verdict.cause.kind, 'reduced_eve', context);
    const plan = monthPlan(input, verdict.date.slice(0, 7));
    assert.ok(plan.reducedEveDays.includes(verdict.date), `${context} ${JSON.stringify(verdict)}`);
    const eve = verdict.cause.kind === 'reduced_eve' ? verdict.cause.date : '';
    assert.equal(eve, addDays(verdict.date, -1), context);
    assert.ok(input.exceptions.some((entry) => entry.kind === 'reduced' && entry.start <= eve && entry.end >= eve), context);
  }
  assert.ok(accepted > 40, `aceitas: ${accepted}`);
  assert.ok(refused > 40, `recusadas pela véspera reduzida: ${refused}`);
});

test('durações sem horário somam e a possível sobreposição é sinalizada; nenhum dia passa de 24 h', () => {
  const a = weekdays(duration(480));
  const b = weekdays(duration(300));
  const plan = monthPlan(calendar({ routines: [a, b] }), '2026-02');
  assert.equal(plan.minutes, 20 * 780);
  assert.equal(plan.untimedOverlapDays.length, 20);
  // Turno de 24 h com hora extra: o dia fica em 24 h e é sinalizado.
  const full = weekdays(window('00:00', '00:00'));
  const capped = dayPlan(calendar({ routines: [full], exceptions: [{ kind: 'overtime', date: '2026-02-02', minutes: 60 }] }), '2026-02-02');
  assert.equal(capped.minutes, 1440);
  assert.equal(capped.capped, true);
});

test('exceções: férias, folga, ausência, plantão, hora extra, jornada reduzida e alteração de escala', () => {
  const exceptions: WorkException[] = [
    { kind: 'vacation', start: '2026-07-06', end: '2026-07-17' },
    { kind: 'overtime', date: '2026-07-20', minutes: 120 },
    { kind: 'reduced', start: '2026-07-21', end: '2026-07-31', minutes: 360 },
    { kind: 'schedule_change', date: '2026-07-25', minutes: 300 },
  ];
  const plan = monthPlan(calendar({ exceptions }), '2026-07');
  // 23 dias úteis (184 h) − férias (10 dias, 80 h) + 2 h − jornada reduzida (9 dias × 2 h) + sábado de 5 h.
  assert.equal(hours(plan.minutes), 184 - 80 + 2 - 18 + 5);
  assert.equal(plan.exceptionDays.vacation, 10, 'férias só contam nos dias que tinham trabalho');
  assert.equal(plan.exceptionDays.reduced, 9);
  assert.equal(plan.exceptionDays.schedule_change, 1);
  // Folga e ausência zeram; o plantão soma mesmo em dia de folga.
  const onCall = calendar({ exceptions: [
    { kind: 'day_off', start: '2026-08-03', end: '2026-08-03' },
    { kind: 'on_call', date: '2026-08-03', minutes: 240 },
    { kind: 'absence', start: '2026-08-04', end: '2026-08-05' },
  ] });
  assert.equal(dayPlan(onCall, '2026-08-03').minutes, 240);
  assert.equal(dayPlan(onCall, '2026-08-04').minutes, 0);
  assert.equal(dayPlan(onCall, '2026-08-04').outcome, 'absent');
  // Jornada reduzida nunca aumenta o dia, e não cria trabalho em feriado nem em fim de semana.
  const reduced = calendar({ exceptions: [{ kind: 'reduced', start: '2026-11-01', end: '2026-11-30', minutes: 600 }] });
  assert.equal(hours(monthPlan(reduced, '2026-11').minutes), 152);
  const reducedShort = calendar({ exceptions: [{ kind: 'reduced', start: '2026-11-01', end: '2026-11-30', minutes: 240 }] });
  assert.equal(hours(monthPlan(reducedShort, '2026-11').minutes), 19 * 4);
  // Alteração de escala define o dia, inclusive num feriado; dentro das férias, as férias prevalecem.
  const change = calendar({ exceptions: [
    { kind: 'schedule_change', date: '2026-11-20', minutes: 360 },
    { kind: 'vacation', start: '2026-11-23', end: '2026-11-27' },
    { kind: 'schedule_change', date: '2026-11-24', minutes: 360 },
  ] });
  assert.equal(dayPlan(change, '2026-11-20').minutes, 360);
  // O feriado com jornada definida foi trabalhado: não aparece entre os que tiraram dias de trabalho.
  assert.equal(dayPlan(change, '2026-11-20').holidayEffect, 'worked');
  const changedMonth = monthPlan(change, '2026-11');
  assert.equal(changedMonth.holidaysOff.some((entry) => entry.date === '2026-11-20'), false);
  assert.equal(changedMonth.holidaysWorked.some((entry) => entry.date === '2026-11-20'), true);
  assert.equal(changedMonth.holidaysOff.some((entry) => entry.date === '2026-11-02'), true, 'o outro feriado segue tirando o dia');
  // Feriado em dia de folga com jornada definida também foi trabalhado (15/11/2026 é domingo).
  const sundayChange = calendar({ exceptions: [{ kind: 'schedule_change', date: '2026-11-15', minutes: 360 }] });
  assert.equal(dayPlan(sundayChange, '2026-11-15').minutes, 360);
  assert.equal(dayPlan(sundayChange, '2026-11-15').holidayEffect, 'worked');
  // Quem trabalha em feriados e está de férias no Natal: o feriado não aparece como trabalhado.
  const holidayVacation = calendar({ worksOnHolidays: true, exceptions: [{ kind: 'vacation', start: '2026-12-21', end: '2026-12-31' }] });
  assert.equal(dayPlan(holidayVacation, '2026-12-25').minutes, 0);
  assert.equal(dayPlan(holidayVacation, '2026-12-25').holidayEffect, 'rest_day');
  const december = monthPlan(holidayVacation, '2026-12');
  assert.equal(december.holidaysWorked.some((entry) => entry.date === '2026-12-25'), false);
  // Feriado trabalhado com alteração de escala para 0: dia sem trabalho, não trabalhado.
  const zeroChange = calendar({ worksOnHolidays: true, exceptions: [{ kind: 'schedule_change', date: '2026-12-25', minutes: 0 }] });
  assert.equal(dayPlan(zeroChange, '2026-12-25').minutes, 0);
  assert.equal(dayPlan(zeroChange, '2026-12-25').holidayEffect, 'rest_day');
  // Feriado que tiraria o dia, com a escala zerada pela pessoa: não foi o feriado que tirou o dia.
  const zeroOnRemoved = calendar({ exceptions: [{ kind: 'schedule_change', date: '2026-11-20', minutes: 0 }] });
  assert.equal(dayPlan(zeroOnRemoved, '2026-11-20').minutes, 0);
  assert.equal(dayPlan(zeroOnRemoved, '2026-11-20').holidayEffect, 'rest_day');
  assert.equal(monthPlan(zeroOnRemoved, '2026-11').holidaysOff.some((entry) => entry.date === '2026-11-20'), false);
  assert.equal(monthPlan(calendar(), '2026-11').holidaysOff.some((entry) => entry.date === '2026-11-20'), true, 'sem a escala, o feriado tira o dia');
  // Plantão num feriado de domingo (dia sem trabalho na rotina): 6 h, feriado trabalhado.
  const sundayOnCall = calendar({ exceptions: [{ kind: 'on_call', date: '2026-11-15', minutes: 360 }] });
  assert.equal(dayPlan(sundayOnCall, '2026-11-15').minutes, 360);
  assert.equal(dayPlan(sundayOnCall, '2026-11-15').holidayEffect, 'worked');
  const sundayMonth = monthPlan(sundayOnCall, '2026-11');
  assert.equal(sundayMonth.holidaysWorked.some((entry) => entry.date === '2026-11-15'), true);
  assert.equal(sundayMonth.holidaysOnRestDays.some((entry) => entry.date === '2026-11-15'), false);
  // Plantão de 12 h no Natal (sexta), sem trabalho em feriados: o feriado tirou a rotina, mas o dia teve trabalho.
  const christmasOnCall = calendar({ exceptions: [{ kind: 'on_call', date: '2026-12-25', minutes: 720 }] });
  assert.equal(dayPlan(christmasOnCall, '2026-12-25').minutes, 720);
  assert.equal(dayPlan(christmasOnCall, '2026-12-25').holidayEffect, 'worked');
  assert.equal(monthPlan(christmasOnCall, '2026-12').holidaysOff.some((entry) => entry.date === '2026-12-25'), false);
  // Hora extra num feriado que tirou o dia: também trabalhado.
  const holidayOvertime = calendar({ exceptions: [{ kind: 'overtime', date: '2026-11-20', minutes: 120 }] });
  assert.equal(dayPlan(holidayOvertime, '2026-11-20').minutes, 120);
  assert.equal(dayPlan(holidayOvertime, '2026-11-20').holidayEffect, 'worked');
  // "Feriado trabalhado" marcado e coberto por férias: 0 min, dia sem trabalho, e a marca não conta entre as exceções.
  const markedOnVacation = calendar({ exceptions: [
    { kind: 'vacation', start: '2026-12-21', end: '2026-12-31' },
    { kind: 'holiday_worked', date: '2026-12-25' },
  ] });
  assert.equal(dayPlan(markedOnVacation, '2026-12-25').minutes, 0);
  assert.equal(dayPlan(markedOnVacation, '2026-12-25').holidayEffect, 'rest_day');
  const markedDecember = monthPlan(markedOnVacation, '2026-12');
  assert.equal(markedDecember.exceptionDays.holiday_worked, 0);
  assert.equal(markedDecember.holidaysWorked.some((entry) => entry.date === '2026-12-25'), false);
  // Sem as férias, a marca conta uma vez e o feriado é trabalhado.
  const marked = monthPlan(calendar({ exceptions: [{ kind: 'holiday_worked', date: '2026-12-25' }] }), '2026-12');
  assert.equal(marked.exceptionDays.holiday_worked, 1);
  assert.equal(marked.holidaysWorked.some((entry) => entry.date === '2026-12-25'), true);
  assert.equal(dayPlan(change, '2026-11-24').minutes, 0);
  // Exceções de tipos diferentes no mesmo dia não descontam em dobro.
  const doubled = calendar({ exceptions: [
    { kind: 'vacation', start: '2026-09-14', end: '2026-09-18' },
    { kind: 'day_off', start: '2026-09-16', end: '2026-09-16' },
  ] });
  assert.equal(hours(monthPlan(doubled, '2026-09').minutes), hours(monthPlan(calendar(), '2026-09').minutes) - 40);
  // Folga num feriado não reduz de novo.
  const holidayOff = calendar({ exceptions: [{ kind: 'day_off', start: '2026-11-02', end: '2026-11-02' }] });
  assert.equal(hours(monthPlan(holidayOff, '2026-11').minutes), 152);
});

test('P5-F.1-R2A: a memória do conferidor vale só durante a chamada e não muda resultado', () => {
  // O mesmo objeto de calendário, com a lista de exceções mudada depois da conferência: nada fica guardado da chamada.
  const exceptions: WorkException[] = [];
  const input = calendar({ worksOnHolidays: true, exceptions, routines: [weekly(window('20:00', '06:00'), window('00:00', '08:00'), OFF, OFF, OFF, OFF, OFF)] });
  assert.equal(calendarAmbiguity(input, '2026-11-06'), null);
  exceptions.push(REDUCED_MONDAY(480));
  assert.deepEqual([dayPlan(input, '2026-10-06').ambiguous, calendarAmbiguity(input, '2026-11-06')?.cause.kind], [true, 'reduced_eve']);
  exceptions.pop();
  assert.deepEqual([dayPlan(input, '2026-10-06').minutes, calendarAmbiguity(input, '2026-11-06')], [120, null]);
});

test('P5-F.1-R2A: a memória do conferidor é de um calendário só: outro calendário lido no meio da chamada não a usa nem a suja', () => {
  // Revisão independente da R2A, T07. As exceções deste calendário, quando lidas, calculam a terça de outro calendário,
  // o mesmo sem a redução, no meio da conferência. A memória da chamada de fora não pode responder pelo outro nem
  // guardar o que o outro calculou.
  const routines = [weekly(window('20:00', '06:00'), window('00:00', '08:00'), OFF, OFF, OFF, OFF, OFF)];
  const other = calendar({ worksOnHolidays: true, routines });
  const seen: Array<[number, boolean]> = [];
  let nesting = false;
  const reentrant = calendar({ worksOnHolidays: true, routines });
  Object.defineProperty(reentrant, 'exceptions', { enumerable: true, get: () => {
    if (!nesting && seen.length < 50) {
      nesting = true;
      const tuesday = dayPlan(other, '2026-10-06');
      seen.push([tuesday.minutes, tuesday.ambiguous]);
      nesting = false;
    }
    return [REDUCED_MONDAY(480)];
  } });
  assert.deepEqual(calendarAmbiguity(reentrant, '2026-11-06'), { date: '2026-10-06', routines: [0], cause: { kind: 'reduced_eve', date: '2026-10-05' } });
  assert.ok(seen.length > 1, `leituras aninhadas: ${seen.length}`);
  for (const tuesday of seen) assert.deepEqual(tuesday, [120, false]);
});

test('o plano é determinístico e só depende das entradas (função pura)', () => {
  const input = calendar({ exceptions: [{ kind: 'overtime', date: '2026-05-04', minutes: 90 }] });
  const first = JSON.stringify(monthPlan(input, '2026-05'));
  const second = JSON.stringify(monthPlan(input, '2026-05'));
  assert.equal(first, second);
  assert.equal(JSON.stringify(input.exceptions), '[{"kind":"overtime","date":"2026-05-04","minutes":90}]', 'entrada não é alterada');
});
