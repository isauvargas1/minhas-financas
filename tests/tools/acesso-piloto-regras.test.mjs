import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {LIMITE_DE_ATIVOS_POR_GATE, avaliarNovoConvite} from '../../tools/piloto/regras.mjs';

/** P6-A (MT-2): no G0 só o convite do proprietário fica ativo; a regra é aplicada na transação do `adicionar`. */

test('G0: o primeiro convite ativo passa, o segundo é recusado', () => {
  assert.deepEqual(avaliarNovoConvite({gate: 'G0', outrosAtivos: 0}), []);
  const recusa = avaliarNovoConvite({gate: 'G0', outrosAtivos: 1});
  assert.equal(recusa.length, 1);
  assert.match(recusa[0], /No G0 só um convite pode estar ativo \(o do proprietário\)/);
  assert.match(recusa[0], /liberação G1/);
  assert.equal(avaliarNovoConvite({gate: 'G0', outrosAtivos: 5}).length, 1);
});

test('G1 e Emulator (sem gate) não limitam pela ferramenta', () => {
  assert.deepEqual(avaliarNovoConvite({gate: 'G1', outrosAtivos: 10}), []);
  assert.deepEqual(avaliarNovoConvite({gate: null, outrosAtivos: 100}), []);
  assert.deepEqual(Object.keys(LIMITE_DE_ATIVOS_POR_GATE), ['G0']);
});

test('a ferramenta aplica a regra na transação do adicionar, com o gate da liberação da produção', () => {
  const fonte = readFileSync(new URL('../../tools/piloto/acesso-piloto.mjs', import.meta.url), 'utf8');
  assert.match(fonte, /const gate = producao \? cfg\.producao\.liberacao\.gate : null;/);
  assert.match(fonte, /transacao\.get\(db\.collection\(COLECAO\)\.where\('status', '==', 'active'\)\.limit\(2\)\)/);
  assert.match(fonte, /avaliarNovoConvite\(\{gate, outrosAtivos\}\)/);
});
