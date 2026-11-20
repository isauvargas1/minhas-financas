import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {compararRules, conteudoPublicado} from '../../tools/operacao/rules.mjs';

/** P6-A: comparação das Rules publicadas (JSON baixado pelo proprietário) com as do commit. Nada fala com a rede. */
const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const CLI = join(RAIZ, 'tools', 'operacao', 'comparar-rules.mjs');
const local = readFileSync(join(RAIZ, 'firestore.rules'), 'utf8');
const pasta = mkdtempSync(join(tmpdir(), 'comparar-rules-'));
test.after(() => rmSync(pasta, {recursive: true, force: true}));
const ruleset = (content) => ({name: 'projects/x/rulesets/abc', source: {files: [{name: 'firestore.rules', content}]}});
const gravar = (nome, valor) => {
  const caminho = join(pasta, nome);
  writeFileSync(caminho, JSON.stringify(valor));
  return caminho;
};
const rodar = (argumentos) => spawnSync(process.execPath, [CLI, ...argumentos], {encoding: 'utf8'});

test('idênticas, inclusive com fim de linha CRLF, aprovam', () => {
  assert.equal(compararRules(local, local.replace(/\n/g, '\r\n')).iguais, true);
  const r = rodar(['--servico', 'firestore', '--publicado', gravar('igual.json', ruleset(local))]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /idênticas/);
});

test('as Rules antigas permissivas (um allow a mais) reprovam e apontam a linha', () => {
  const linhas = local.split('\n');
  const alvo = linhas.findIndex((linha) => linha.includes('match /pilot_access/{entryId}'));
  assert.ok(alvo > 0);
  linhas.splice(alvo + 1, 1, '      allow read, write: if request.auth != null;');
  const r = rodar(['--servico', 'firestore', '--publicado', gravar('diferente.json', ruleset(linhas.join('\n')))]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, new RegExp(`a partir da linha ${alvo + 2}`));
  assert.equal(compararRules(local, linhas.join('\n')).primeiraDiferenca, alvo + 2);
});

test('JSON que não é ruleset de um arquivo e argumentos inválidos saem 2', () => {
  assert.throws(() => conteudoPublicado({source: {files: []}}), /exatamente um arquivo/);
  assert.equal(rodar(['--servico', 'firestore', '--publicado', gravar('ruim.json', {rules: local})]).status, 2);
  assert.equal(rodar(['--servico', 'database', '--publicado', gravar('ok.json', ruleset(local))]).status, 2);
  assert.equal(rodar(['--servico', 'firestore']).status, 2);
});

test('storage: compara com storage.rules', () => {
  const storage = readFileSync(join(RAIZ, 'storage.rules'), 'utf8');
  assert.equal(rodar(['--servico', 'storage', '--publicado', gravar('st.json', ruleset(storage))]).status, 0);
  assert.equal(rodar(['--servico', 'storage', '--publicado', gravar('st2.json', ruleset(local))]).status, 1);
});

test('a CLI chamada por um symlink também compara (sem guarda de módulo principal que falhe aberto, PLT-4)', async () => {
  const {symlinkSync} = await import('node:fs');
  const link = join(pasta, 'link-comparar-rules.mjs');
  symlinkSync(CLI, link);
  const linhas = local.split('\n');
  linhas[0] = `${linhas[0]} // alterada`;
  const r = spawnSync(process.execPath, [link, '--servico', 'firestore', '--publicado', gravar('link.json', ruleset(linhas.join('\n')))], {encoding: 'utf8'});
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /DIFEREM/);
});
