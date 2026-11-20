import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * P5-F.1-R3.2 (EST-10 da revisão de estabilidade): o marco de fase completa da integração. O `firebase emulators:exec`
 * sai com 0 quando um sinal de desligamento interrompe a cadeia de suítes no meio; com o marco, `npm run
 * test:integration:emulator` só aprova a cadeia que chegou ao fim.
 */

const TOOLS = fileURLToPath(new URL('../../tools', import.meta.url));
const MARKER = join(TOOLS, 'integracao', 'marco-da-fase.mjs');
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const SCRIPT = pkg.scripts['test:integration:emulator'];

const marker = (cwd, step) => {
  const result = spawnSync(process.execPath, [MARKER, ...(step ? [step] : [])], { cwd, encoding: 'utf8' });
  return { code: result.status, output: `${result.stdout}${result.stderr}` };
};
const markPath = (cwd) => join(cwd, 'test-results', 'integracao', 'marco.json');

test('marco: só a cadeia iniciada e concluída aprova; sem marco, aberto ou já conferido, a fase reprova', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'integracao-marco-'));
  try {
    const none = marker(cwd, 'conferir');
    assert.equal(none.code, 1);
    assert.match(none.output, /sem o marco desta execução/);

    assert.equal(marker(cwd, 'iniciar').code, 0);
    const open = JSON.parse(readFileSync(markPath(cwd), 'utf8'));
    assert.equal(open.concluidoEm, null);
    assert.match(open.execucao, /^[0-9a-f-]{36}$/);
    const truncated = marker(cwd, 'conferir');
    assert.equal(truncated.code, 1, 'marco aberto: a cadeia não chegou ao fim');
    assert.match(truncated.output, /a fase de integração não chegou ao fim/);
    assert.equal(existsSync(markPath(cwd)), false, 'o marco é apagado na conferência');

    assert.equal(marker(cwd, 'iniciar').code, 0);
    assert.equal(marker(cwd, 'concluir').code, 0);
    const twice = marker(cwd, 'concluir');
    assert.equal(twice.code, 1, 'o marco fechado não é fechado de novo');
    assert.match(twice.output, /sem marco aberto/);
    const complete = marker(cwd, 'conferir');
    assert.equal(complete.code, 0, complete.output);
    assert.match(complete.output, /\[integração\] fase completa: todas as suítes rodaram até o fim/);
    assert.equal(existsSync(markPath(cwd)), false);
    assert.equal(marker(cwd, 'conferir').code, 1, 'a conferência não aproveita o marco de uma execução anterior');

    // Um marco fechado de uma execução anterior não vale para a próxima: `iniciar` grava um novo, aberto.
    assert.equal(marker(cwd, 'iniciar').code, 0);
    assert.equal(marker(cwd, 'concluir').code, 0);
    assert.equal(marker(cwd, 'iniciar').code, 0);
    assert.equal(marker(cwd, 'conferir').code, 1);

    assert.equal(marker(cwd, 'concluir').code, 1, 'concluir sem iniciar');
    const unknown = marker(cwd, 'aprovar');
    assert.equal(unknown.code, 1);
    assert.match(unknown.output, /passo desconhecido: aprovar/);
    assert.equal(marker(cwd).code, 1);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('marco: a fiação de npm run test:integration:emulator começa e termina no marco, e a cadeia fecha com todas as suítes de Rules', () => {
  assert.match(SCRIPT, /^node tools\/integracao\/marco-da-fase\.mjs iniciar && firebase emulators:exec --only auth,firestore,storage --project minhas-financas-local "/);
  assert.match(SCRIPT, / && node tools\/integracao\/marco-da-fase\.mjs concluir" && node tools\/integracao\/marco-da-fase\.mjs conferir$/);
  const chain = /"(.*)"/.exec(SCRIPT)[1].split(' && ');
  assert.equal(chain.at(-1), 'node tools/integracao/marco-da-fase.mjs concluir', 'concluir é o último passo da cadeia');
  assert.ok(chain.slice(0, -1).every((step) => /^npm run [\w:-]+$/.test(step)), 'antes dele, só suítes');
  const suites = chain.slice(0, -1).map((step) => step.slice('npm run '.length));
  assert.deepEqual(suites.slice(0, 4), ['functions:test:integration:emulator', 'test:tools:limpeza', 'test:tools:contas', 'test:tools:piloto']);
  const rules = Object.keys(pkg.scripts).filter((name) => name.startsWith('test:rules:'));
  assert.deepEqual(suites.slice(4).sort(), rules.sort(), 'todas as suítes de Rules do package.json, nenhuma a mais');
  // 20 desde o P5-GATE-FINAL (`test:rules:transactions-reads`, FIRESTORE-01); 22 na P6-A: `test:rules:pilot-access`
  // (lista do piloto) e `test:rules:storage` (bucket fechado, no emulador de Storage).
  assert.equal(rules.length, 22);
  assert.doesNotMatch(SCRIPT, /sistema-financeiro-pesso-20698/);
  assert.match(pkg.scripts['verify:all'], /npm run test:integration:emulator && npm run test:e2e$/);
  assert.match(pkg.scripts['verify:fast'], /npm run test:tools:integracao/, 'estes testes rodam no verify:fast');
  const ci = readFileSync(new URL('../../.github/workflows/quality-gate.yml', import.meta.url), 'utf8');
  assert.match(ci, /run: npm run test:tools:integracao/, 'e no CI');
});

/*
 * O script oficial, como o npm o roda (`sh -c`), com `firebase` e `npm` falsos no PATH: o `firebase` falso sai com 0
 * sem rodar a cadeia (o desligamento por sinal no meio das suítes), roda a cadeia inteira, ou a roda com uma suíte que
 * falha. As suítes falsas saem com 0, salvo a que falha; o marco é o de verdade.
 */
const FIREBASE = `#!/usr/bin/env node
const { appendFileSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const dir = process.env.STUB_DIR;
const args = process.argv.slice(2);
appendFileSync(join(dir, 'calls.log'), JSON.stringify({ tool: 'firebase', args }) + '\\n');
const mode = readFileSync(join(dir, 'mode'), 'utf8').trim();
if (mode === 'interrompido') {
  console.log('emulators: Received SIGINT (Ctrl-C) for the first time. Starting a clean shutdown.');
  process.exit(0);
}
const result = require('node:child_process').spawnSync('sh', ['-c', args.at(-1)], { stdio: 'inherit' });
process.exit(result.status ?? 1);
`;
const NPM = `#!/usr/bin/env node
const { appendFileSync, existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const dir = process.env.STUB_DIR;
const args = process.argv.slice(2);
appendFileSync(join(dir, 'calls.log'), JSON.stringify({ tool: 'npm', args }) + '\\n');
const failing = existsSync(join(dir, 'failing')) ? readFileSync(join(dir, 'failing'), 'utf8').trim() : null;
process.exit(args[0] === 'run' && args[1] === failing ? 1 : 0);
`;

const runScript = ({ mode, failing = null }) => {
  const root = mkdtempSync(join(tmpdir(), 'integracao-raiz-'));
  const stubs = mkdtempSync(join(tmpdir(), 'integracao-falsos-'));
  try {
    symlinkSync(TOOLS, join(root, 'tools'));
    for (const [name, body] of [['firebase', FIREBASE], ['npm', NPM]]) {
      writeFileSync(join(stubs, name), body);
      chmodSync(join(stubs, name), 0o755);
    }
    writeFileSync(join(stubs, 'mode'), mode);
    if (failing) writeFileSync(join(stubs, 'failing'), failing);
    const result = spawnSync('sh', ['-c', SCRIPT], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${stubs}${delimiter}${process.env.PATH}`, STUB_DIR: stubs },
    });
    const calls = existsSync(join(stubs, 'calls.log'))
      ? readFileSync(join(stubs, 'calls.log'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
      : [];
    return { code: result.status, output: `${result.stdout}${result.stderr}`, calls, markLeft: existsSync(markPath(root)) };
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(stubs, { recursive: true, force: true });
  }
};

test('marco (EST-10): o Emulator que sai com 0 no meio da cadeia reprova a fase; a cadeia inteira aprova; a suíte que falha reprova como antes', () => {
  const truncated = runScript({ mode: 'interrompido' });
  assert.equal(truncated.code, 1, truncated.output);
  assert.match(truncated.output, /a fase de integração não chegou ao fim/);
  assert.deepEqual(truncated.calls.map((call) => call.tool), ['firebase'], 'nenhuma suíte rodou');

  const complete = runScript({ mode: 'completo' });
  assert.equal(complete.code, 0, complete.output);
  assert.match(complete.output, /\[integração\] fase completa: todas as suítes rodaram até o fim/);
  const ran = complete.calls.filter((call) => call.tool === 'npm').map((call) => call.args[1]);
  assert.equal(ran.length, 26, 'a integração das Functions, as três ferramentas e as 22 suítes de Rules');
  assert.equal(ran.at(-1), 'test:rules:projection-marks');
  assert.equal(complete.markLeft, false);

  const failed = runScript({ mode: 'completo', failing: 'test:rules:reports' });
  assert.equal(failed.code, 1, failed.output);
  const ranUntil = failed.calls.filter((call) => call.tool === 'npm').map((call) => call.args[1]);
  assert.equal(ranUntil.at(-1), 'test:rules:reports', 'a cadeia para na suíte que falha');
  assert.doesNotMatch(failed.output, /fase completa/);
});
