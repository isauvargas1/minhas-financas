import assert from 'node:assert/strict';
import test from 'node:test';

import {
  saoPauloDayKey,
  saoPauloMonthKey,
} from '../../src/modules/reports/dateWindow.ts';

// INV-P2-048 — o domínio materializa toda chave de período em
// `America/Sao_Paulo`, e o recorte do frontend usava UTC. Entre 21:00 e 23:59
// BRT a data UTC já é a do dia seguinte, e na virada do mês é o mês seguinte:
// a janela do relatório incluía ou excluía um dia inteiro de movimentação em
// relação ao que o backend gravou.

/** 22:00 BRT de 31/08/2026 é 01:00 UTC de 01/09/2026. */
const LATE_NIGHT_BRT = new Date('2026-09-01T01:00:00.000Z');

/** 22:00 BRT de 31/12/2026 é 01:00 UTC de 01/01/2027. */
const NEW_YEAR_EVE_BRT = new Date('2027-01-01T01:00:00.000Z');

test('instante às 22:00 BRT permanece no dia e no mês corretos', () => {
  assert.equal(saoPauloDayKey(LATE_NIGHT_BRT), '2026-08-31');
  assert.equal(saoPauloMonthKey(LATE_NIGHT_BRT), '2026-08');
  // O que a implementação anterior devolveria: `toISOString()` daria
  // '2026-09-01', um mês adiante do que o backend gravou.
  assert.notEqual(saoPauloDayKey(LATE_NIGHT_BRT), LATE_NIGHT_BRT.toISOString().slice(0, 10));
});

test('virada do ano às 22:00 BRT: o mês corrente ainda é dezembro', () => {
  // Chave do documento do mês que o Dashboard escuta (P5-C1); as janelas do
  // relatório são resolvidas no servidor (`functions/src/reports/window.ts`).
  assert.equal(saoPauloDayKey(NEW_YEAR_EVE_BRT), '2026-12-31');
  assert.equal(saoPauloMonthKey(NEW_YEAR_EVE_BRT), '2026-12');
});

test('o offset é resolvido por data, e não fixado em -3', () => {
  // O mesmo instante do calendário cai em dias diferentes conforme o horário
  // de verão vigente no ano, e é exatamente por isso que o offset não pode ser
  // escrito à mão: em fevereiro de 2018 o Brasil estava em UTC−2, em fevereiro
  // de 2026 está em UTC−3.
  assert.equal(saoPauloDayKey(new Date('2018-02-15T02:30:00.000Z')), '2018-02-15');
  assert.equal(saoPauloDayKey(new Date('2026-02-15T02:30:00.000Z')), '2026-02-14');
});
