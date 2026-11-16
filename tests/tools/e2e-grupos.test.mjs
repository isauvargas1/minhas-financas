import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_GROUPS,
  checkGroupRuns,
  e2ePorts,
  effectiveGroups,
  filesOf,
  MAX_PORT_WAIT_MS,
  parseGroupCount,
  parsePortWait,
  refusedArgument,
  testsOfReport,
} from '../../tools/e2e/grupos.mjs';
import { portInUse, waitForFreePorts } from '../../tools/e2e/portas.mjs';

/**
 * P5-F.1-R3.2 (RR-R31-07): o E2E oficial em grupos, cada um com o próprio Emulator. As decisões do executor
 * (`tools/e2e/executar-em-grupos.mjs`) e a fiação oficial (`npm run test:e2e`, `playwright.config.ts`, CI): uma execução
 * só vale com cada teste da lista completa rodando exatamente uma vez, numa tentativa só, e passando.
 */

const spec = (file, line, title, tests) => ({ file, line, column: 3, title, tests });
const result = (status) => ({ status });
const report = (suites) => ({ suites });
/** Dois arquivos, um `describe` e dois projetos num dos testes. */
const sample = (statusOf = () => 'expected', attemptsOf = () => ['passed']) => report([
  {
    title: 'a.spec.ts', file: 'a.spec.ts',
    specs: [spec('a.spec.ts', 10, 'abre', [{ projectName: 'chromium', status: statusOf('a1'), results: attemptsOf('a1').map(result) }])],
    suites: [{
      title: 'grupo', file: 'a.spec.ts',
      specs: [spec('a.spec.ts', 20, 'salva', [
        { projectName: 'chromium', status: statusOf('a2'), results: attemptsOf('a2').map(result) },
        { projectName: 'mobile', status: statusOf('a3'), results: attemptsOf('a3').map(result) },
      ])],
      suites: [],
    }],
  },
  {
    title: 'b.spec.ts', file: 'b.spec.ts',
    specs: [spec('b.spec.ts', 5, 'lista', [{ projectName: 'chromium', status: statusOf('b1'), results: attemptsOf('b1').map(result) }])],
    suites: [],
  },
]);

test('grupos: quantidade padrão 3, inteiros de 1 a 12, e recusa do resto', () => {
  assert.equal(parseGroupCount(undefined), DEFAULT_GROUPS);
  assert.equal(parseGroupCount(''), 3);
  assert.equal(parseGroupCount('1'), 1);
  assert.equal(parseGroupCount('12'), 12);
  for (const bad of ['0', '13', '-1', '1.5', 'x', ' 3']) assert.throws(() => parseGroupCount(bad), /E2E_SHARDS/, bad);
  assert.equal(effectiveGroups(3, 36), 3);
  assert.equal(effectiveGroups(3, 2), 2, 'nunca mais grupos do que arquivos');
  assert.equal(effectiveGroups(3, 0), 1);
});

test('grupos: o executor divide a suíte; --shard, --last-failed e --list são recusados', () => {
  assert.equal(refusedArgument(['--shard=1/3']), '--shard=1/3');
  assert.equal(refusedArgument(['--trace', 'off', '--shard', '2/3']), '--shard');
  assert.equal(refusedArgument(['--last-failed']), '--last-failed');
  assert.equal(refusedArgument(['--list']), '--list');
  assert.equal(refusedArgument(['--trace', 'off', 'e2e/work-time-b03.spec.ts', '-g', 'B03-g']), null);
  // Só os que escolhem o que roda e o rastro (EST-08; ADV-R2-03): qualquer outra opção é recusada, inclusive as que mudam
  // o critério dos testes (nova tentativa, repetição, prazo, paralelismo, outra configuração, instantâneos, `--debug`),
  // nas formas longa, curta e curta combinada, e o valor de uma opção aceita que começa com `-`.
  for (const args of [['--retries=1'], ['--retries', '1'], ['--repeat-each', '2'], ['--timeout=90000'], ['--workers', '2'], ['-j', '2'],
    ['-j2'], ['--config', 'outro.config.ts'], ['-c', 'outro.config.ts'], ['--update-snapshots'], ['-u'], ['--ignore-snapshots'],
    ['-xj2'], ['-xc', 'outro.config.ts'], ['-xu'], ['--debug'], ['--headed'], ['--reporter=list'], ['--ui-port', '0'], ['--pass-with-no-tests']]) {
    assert.equal(refusedArgument(['--trace', 'off', ...args]), args[0], JSON.stringify(args));
  }
  assert.equal(refusedArgument(['-g', '--shard=1/2']), '--shard=1/2', 'o valor de -g não pode ser outra opção');
  assert.equal(refusedArgument(['--project', '-j2']), '-j2');
  for (const args of [['--project', 'chromium'], ['--grep-invert', 'lento'], ['-g', 'ADV-01'], ['-gADV-01'], ['--grep=ADV-01'],
    ['--grep', 'B03-g'], ['-x'], ['--max-failures', '1'], ['--max-failures=1'], ['--trace', 'off'], ['--trace=on'],
    ['e2e/work-time-b03.spec.ts:729', 'e2e/work-time-p5f.spec.ts']]) {
    assert.equal(refusedArgument(args), null, JSON.stringify(args));
  }
});

test('grupos (EST-01): o prazo da espera pelas portas é 60 s e só encurta', () => {
  assert.equal(MAX_PORT_WAIT_MS, 60_000);
  assert.equal(parsePortWait(undefined), 60_000);
  assert.equal(parsePortWait(''), 60_000);
  assert.equal(parsePortWait('0'), 0);
  assert.equal(parsePortWait('500'), 500);
  assert.equal(parsePortWait('60000'), 60_000);
  for (const bad of ['60001', '120000', '-1', '1.5', 'x', ' 500']) assert.throws(() => parsePortWait(bad), /E2E_PORT_WAIT_MS inválido/, bad);
});

test('grupos: as chaves dos testes do relatório são estáveis e distinguem arquivo, linha, títulos e projeto', () => {
  const tests = testsOfReport(sample());
  assert.deepEqual(tests.map((entry) => entry.key), [
    'a.spec.ts:10:3 › abre [chromium]',
    'a.spec.ts:20:3 › grupo › salva [chromium]',
    'a.spec.ts:20:3 › grupo › salva [mobile]',
    'b.spec.ts:5:3 › lista [chromium]',
  ]);
  assert.deepEqual(filesOf(tests), ['a.spec.ts', 'b.spec.ts']);
  assert.deepEqual(tests.map((entry) => entry.status), ['expected', 'expected', 'expected', 'expected']);
});

test('grupos: a execução vale só com cada teste da lista uma vez, numa tentativa, passando', () => {
  const listed = testsOfReport(sample(() => null, () => []));
  const all = testsOfReport(sample());
  const [first, second] = [all.slice(0, 2), all.slice(2)];
  assert.deepEqual(checkGroupRuns(listed, [first, second]), [], 'os grupos cobrem a lista, cada teste uma vez');
  // Teste que não rodou e teste repetido em dois grupos.
  assert.deepEqual(checkGroupRuns(listed, [first, [all[2]]]), ['não rodou: b.spec.ts:5:3 › lista [chromium]']);
  assert.deepEqual(checkGroupRuns(listed, [all, [all[3]]]), ['rodou 2 vezes: b.spec.ts:5:3 › lista [chromium]']);
  // Falha, instável, ignorado e mais de uma tentativa.
  const failed = testsOfReport(sample((id) => (id === 'a2' ? 'unexpected' : 'expected'), (id) => (id === 'a2' ? ['failed'] : ['passed'])));
  assert.deepEqual(checkGroupRuns(listed, [failed]), ['grupo 1: unexpected: a.spec.ts:20:3 › grupo › salva [chromium]']);
  const flaky = testsOfReport(sample((id) => (id === 'b1' ? 'flaky' : 'expected'), (id) => (id === 'b1' ? ['failed', 'passed'] : ['passed'])));
  assert.deepEqual(checkGroupRuns(listed, [flaky]), ['grupo 1: flaky: b.spec.ts:5:3 › lista [chromium]']);
  const skipped = testsOfReport(sample((id) => (id === 'a1' ? 'skipped' : 'expected'), (id) => (id === 'a1' ? ['skipped'] : ['passed'])));
  assert.deepEqual(checkGroupRuns(listed, [skipped]), ['grupo 1: skipped: a.spec.ts:10:3 › abre [chromium]']);
  const retried = testsOfReport(sample(() => 'expected', (id) => (id === 'a3' ? ['timedOut', 'passed'] : ['passed'])));
  assert.deepEqual(checkGroupRuns(listed, [retried]), ['grupo 1: tentativas ["timedOut","passed"]: a.spec.ts:20:3 › grupo › salva [mobile]']);
  // Resultado final "expected" com duas tentativas passando também não vale: uma execução é uma tentativa.
  const twice = testsOfReport(sample(() => 'expected', (id) => (id === 'a1' ? ['passed', 'passed'] : ['passed'])));
  assert.deepEqual(checkGroupRuns(listed, [twice]), ['grupo 1: tentativas ["passed","passed"]: a.spec.ts:10:3 › abre [chromium]']);
  // Grupo sem relatório, teste fora da lista e lista vazia.
  assert.deepEqual(checkGroupRuns(listed, [all, null]), ['grupo 2: sem relatório']);
  const outside = [...all, { key: 'c.spec.ts:1:3 › novo [chromium]', file: 'c.spec.ts', status: 'expected', attempts: ['passed'] }];
  assert.deepEqual(checkGroupRuns(listed, [outside]), ['grupo 1: rodou fora da lista: c.spec.ts:1:3 › novo [chromium]']);
  assert.deepEqual(checkGroupRuns([], []), ['a lista completa está vazia']);
});

test('grupos: as portas conferidas entre os grupos são as do Emulator e a do frontend', () => {
  assert.deepEqual(e2ePorts({ startEmulators: true, previewPort: 5173 }), [4000, 4400, 4500, 5001, 8080, 9099, 9150, 9299, 9499, 5173]);
  assert.deepEqual(e2ePorts({ startEmulators: false, previewPort: 5174 }), [5174], 'com o Emulator de fora, só a do frontend');
  const firebase = JSON.parse(readFileSync(new URL('../../firebase.json', import.meta.url), 'utf8'));
  const configured = Object.values(firebase.emulators).flatMap((entry) => (typeof entry === 'object' && entry.port ? [entry.port] : []));
  for (const port of configured) assert.ok(e2ePorts({ startEmulators: true, previewPort: 5173 }).includes(port), `porta ${port} do firebase.json`);
  // A liberação manual das portas (RB-09) cobre as mesmas portas que o executor confere entre os grupos.
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  const killed = /^lsof -tiTCP:([\d,]+) -sTCP:LISTEN \| xargs -r kill -9$/.exec(pkg.scripts['e2e:kill-ports']);
  assert.ok(killed, 'e2e:kill-ports no formato esperado');
  assert.deepEqual(killed[1].split(',').map(Number), e2ePorts({ startEmulators: true, previewPort: 5173 }));
});

test('grupos: a fiação oficial (npm run test:e2e, Playwright e CI) roda os grupos, sem nova tentativa, sem .only e com o Emulator desligado no fim de cada grupo', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts['test:e2e'], 'npm run build:e2e && node tools/e2e/executar-em-grupos.mjs');
  assert.match(pkg.scripts['verify:all'], /npm run test:e2e$/, 'o verify:all termina no E2E oficial');
  assert.match(pkg.scripts['verify:fast'], /npm run test:tools:e2e/, 'estes testes rodam no verify:fast');
  const config = readFileSync(new URL('../../playwright.config.ts', import.meta.url), 'utf8');
  assert.match(config, /^\s*retries: 0,$/m, 'sem nova tentativa automática, nem no CI');
  assert.doesNotMatch(config, /retries: process\.env\.CI/, 'nenhuma tentativa a mais no CI');
  assert.match(config, /^\s*forbidOnly: true,$/m);
  assert.match(config, /gracefulShutdown: \{ signal: 'SIGTERM' as const, timeout: 60_000 \},/, 'o Emulator desliga limpo no fim de cada grupo');
  assert.match(config, /--project minhas-financas-local/, 'só o projeto local do Emulator');
  assert.doesNotMatch(config, /sistema-financeiro-pesso-20698/);
  const ci = readFileSync(new URL('../../.github/workflows/quality-gate.yml', import.meta.url), 'utf8');
  assert.match(ci, /- name: Suíte E2E\n\s+run: npm run test:e2e\n/, 'o CI roda o E2E oficial');
  assert.match(ci, /run: npm run test:tools:e2e/, 'o CI roda estes testes');
  assert.doesNotMatch(ci, /firebase-tools@latest/, 'a versão do Emulator é a validada, não a mais nova do dia');
});

test('CI (P5-GATE-FINAL, RR-R3-14): todo script de unidade e de ferramentas do verify:fast tem passo próprio no CI', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  const ci = readFileSync(new URL('../../.github/workflows/quality-gate.yml', import.meta.url), 'utf8');
  const fast = [...pkg.scripts['verify:fast'].matchAll(/npm run (test:(?:unit|tools):[a-z0-9:-]+)/g)].map((match) => match[1]);
  assert.ok(fast.length >= 18, `scripts do verify:fast: ${fast.length}`);
  const missing = fast.filter((script) => !new RegExp(`\\n\\s+run: npm run ${script.replace(/[-:]/g, (c) => `\\${c}`)}\\n`).test(ci));
  assert.deepEqual(missing, [], 'scripts do verify:fast sem passo no CI');
});

/*
 * O executor de ponta a ponta (`executar-em-grupos.mjs`), com `npm` e `npx` falsos no PATH: o build das Functions, a
 * lista e cada grupo são simulados por um roteiro em disco, sem Emulator nem navegador. Confere a decisão final (saída
 * 0 ou 1) e o que foi chamado: os grupos em sequência, com `--shard`, o relatório e a saída de cada um e os argumentos
 * repassados.
 */
const EXECUTOR = fileURLToPath(new URL('../../tools/e2e/executar-em-grupos.mjs', import.meta.url));
const STUB = `#!/usr/bin/env node
const { appendFileSync, copyFileSync, existsSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const dir = process.env.STUB_DIR;
const args = process.argv.slice(2);
const tool = require('node:path').basename(process.argv[1]);
const code = (name) => (existsSync(join(dir, name)) ? Number(readFileSync(join(dir, name), 'utf8')) : 0);
if (process.env.STUB_NETO !== '1') {
  appendFileSync(join(dir, 'calls.log'), JSON.stringify({ tool, args, report: process.env.E2E_SHARD_REPORT ?? null,
    html: process.env.PLAYWRIGHT_HTML_OUTPUT_DIR ?? null, logBefore: existsSync('firebase-debug.log') }) + '\\n');
}
if (tool === 'npm') process.exit(code('build.code'));
if (args.includes('--list')) {
  process.stdout.write(readFileSync(join(dir, 'list.json'), 'utf8'));
  process.exit(code('list.code'));
}
const shard = args.find((arg) => arg.startsWith('--shard=')).slice('--shard='.length).split('/')[0];
if (existsSync(join(dir, 'shard-' + shard + '.wait')) && process.env.STUB_NETO !== '1') {
  // Como o npx de verdade (\`npm exec\` → \`sh\` → \`node\`; ADV-R2-02): o "Playwright" é o neto. O sinal que só chega a
  // este processo é repassado ao \`sh\`, que espera o filho: o neto só o recebe quando ele vai ao grupo de processos.
  const child = require('node:child_process').spawn('sh', ['-c', '"$0" "$@"; exit $?', process.execPath, process.argv[1], ...args],
    { stdio: 'inherit', env: { ...process.env, STUB_NETO: '1' } });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => child.kill(signal));
  // Sai como o npx do Playwright interrompido: 130 quando o filho termina pelo Ctrl+C.
  child.on('exit', (exitCode, signal) => process.exit(exitCode ?? (signal === 'SIGINT' ? 130 : 1)));
  return;
}
if (existsSync(join(dir, 'shard-' + shard + '.wait2'))) {
  // Um grupo que só termina no segundo sinal (ADV-R3-03): registra cada um; o primeiro não basta.
  let received = 0;
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      appendFileSync(join(dir, 'signals.log'), signal + '\\n');
      received += 1;
      if (received >= 2) process.exit(130);
    });
  }
  writeFileSync(join(dir, 'shard-' + shard + '.started'), String(process.pid));
  setInterval(() => {}, 1_000);
  return;
}
if (existsSync(join(dir, 'shard-' + shard + '.wait'))) {
  // O neto: um grupo que só termina com um sinal; registra cada sinal recebido e sai como o Playwright no Ctrl+C.
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      appendFileSync(join(dir, 'signals.log'), signal + '\\n');
      process.exit(130);
    });
  }
  writeFileSync(join(dir, 'shard-' + shard + '.started'), String(process.pid));
  setInterval(() => {}, 1_000);
  return;
}
if (existsSync(join(dir, 'shard-' + shard + '.json'))) copyFileSync(join(dir, 'shard-' + shard + '.json'), process.env.E2E_SHARD_REPORT);
if (existsSync(join(dir, 'shard-' + shard + '.limpo'))) {
  // Como o firebase-tools ao sair limpo: o log de depuração existe durante o grupo e é apagado na saída (EST-R3-01).
  writeFileSync('firebase-debug.log', 'grupo ' + shard + ' limpo');
  setTimeout(() => {
    require('node:fs').unlinkSync('firebase-debug.log');
    process.exit(code('shard-' + shard + '.code'));
  }, 1_500);
  return;
}
writeFileSync('firebase-debug.log', 'grupo ' + shard);
// O grupo morto por sinal depois de escrever o relatório completo (ADV-R3-03).
if (existsSync(join(dir, 'shard-' + shard + '.selfkill'))) process.kill(process.pid, 'SIGKILL');
const hold = existsSync(join(dir, 'shard-' + shard + '.hold')) ? Number(readFileSync(join(dir, 'shard-' + shard + '.hold'), 'utf8')) : 0;
if (hold > 0) {
  // O "Emulator" do grupo ainda desligando depois que o grupo sai: a porta do frontend fica ocupada por hold ms.
  const holder = require('node:child_process').spawn(process.execPath, ['-e',
    'const s = require("node:net").createServer().listen(Number(process.argv[1]), "127.0.0.1", () => { console.log("ouvindo"); setTimeout(() => s.close(() => process.exit(0)), Number(process.argv[2])); });',
    process.env.E2E_PORT, String(hold)], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
  holder.stdout.once('data', () => {
    writeFileSync(join(dir, 'holder.pid'), String(holder.pid));
    holder.unref();
    holder.stdout.destroy();
    process.exit(code('shard-' + shard + '.code'));
  });
  // A porta já estava ocupada (o processo não conseguiu ouvir): o grupo falha na hora, sem esperar.
  holder.once('exit', () => process.exit(97));
  return;
}
process.exit(code('shard-' + shard + '.code'));
`;

const freePort = () => new Promise((resolve) => {
  const server = createServer();
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    server.close(() => resolve(port));
  });
});

/** Os `--shard` dos grupos chamados, na ordem. */
const shardsOf = (calls) => calls.flatMap((call) => call.args.filter((arg) => arg.startsWith('--shard=')));

/** Lista e relatórios no formato do Playwright: dois arquivos, quatro testes. */
const listed = sample(() => null, () => []);
const passedRun = sample();
const fileReport = (fileIndex, base = passedRun) => ({ suites: [base.suites[fileIndex]] });

/**
 * O processo `pid` é um falso `npx` (ou neto, como o que segura a porta) deste teste: o ambiente dele traz o `STUB_DIR`
 * do teste (Linux, `/proc`). Todo sinal deste arquivo a um PID solto passa por aqui (RR-R32-13, P5-GATE-FINAL): um PID
 * que já saiu pode ter sido dado a outro processo, e esse outro processo não tem o `STUB_DIR` deste teste. Um processo
 * que já saiu e ainda não foi colhido (zumbi) não tem ambiente legível e também não conta.
 */
const ownStub = (pid, stubs) => {
  if (!Number.isSafeInteger(pid) || pid <= 1) return false;
  try {
    return readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').includes(`STUB_DIR=${stubs}`);
  } catch {
    return false;
  }
};

/** Encerra `pid` só se for um processo deste teste (RR-R32-13). */
const killOwnStub = (pid, stubs, signal) => {
  if (pid === null || !ownStub(pid, stubs)) return false;
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false; // já saiu
  }
};

const runExecutor = async ({ files = {}, args = [], env = {}, rootFiles = {} } = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'e2e-grupos-raiz-'));
  const stubs = mkdtempSync(join(tmpdir(), 'e2e-grupos-falsos-'));
  try {
    // Arquivos que já estavam na raiz, como os de uma execução anterior.
    for (const [name, content] of Object.entries(rootFiles)) {
      mkdirSync(dirname(join(root, name)), { recursive: true });
      writeFileSync(join(root, name), typeof content === 'string' ? content : JSON.stringify(content));
    }
    for (const tool of ['npm', 'npx']) {
      writeFileSync(join(stubs, tool), STUB);
      chmodSync(join(stubs, tool), 0o755);
    }
    writeFileSync(join(stubs, 'list.json'), JSON.stringify(listed));
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(stubs, name), typeof content === 'string' ? content : JSON.stringify(content));
    }
    const result = spawnSync(process.execPath, [EXECUTOR, ...args], {
      cwd: root,
      encoding: 'utf8',
      // Um executor travado reprova o teste em vez de prendê-lo (o SIGTERM vira o SIGINT ao grupo, EST-02).
      timeout: 120_000,
      env: {
        ...process.env,
        PATH: `${stubs}${delimiter}${process.env.PATH}`,
        STUB_DIR: stubs,
        E2E_START_EMULATORS: 'false',
        E2E_PORT: String(await freePort()),
        E2E_SHARDS: '2',
        ...env,
      },
    });
    const calls = existsSync(join(stubs, 'calls.log'))
      ? readFileSync(join(stubs, 'calls.log'), 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
      : [];
    // Os logs do Emulator guardados por grupo, lidos antes de a raiz temporária sair.
    const groupLogs = [1, 2].map((index) => {
      const path = join(root, 'test-results', `grupo-${index}`, 'firebase-debug.log');
      return existsSync(path) ? readFileSync(path, 'utf8') : null;
    });
    const holderPid = existsSync(join(stubs, 'holder.pid')) ? Number(readFileSync(join(stubs, 'holder.pid'), 'utf8')) : null;
    return { code: result.status, output: `${result.stdout}${result.stderr}`, calls, groupLogs, holderPid, stubs };
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(stubs, { recursive: true, force: true });
  }
};

test('executor: os grupos completos e passando terminam com saída 0, em sequência, cada um com relatório e saída próprios', async () => {
  const run = await runExecutor({ files: { 'shard-1.json': fileReport(0), 'shard-2.json': fileReport(1) }, args: ['--trace', 'off'] });
  assert.equal(run.code, 0, run.output);
  assert.match(run.output, /ok: 4 testes, cada um uma vez, todos passaram/);
  assert.deepEqual(run.calls.map((call) => [call.tool, ...call.args.filter((arg) => !arg.startsWith('--output='))]), [
    ['npm', '--prefix', 'functions', 'run', 'build'],
    ['npx', 'playwright', 'test', '--list', '--reporter=json', '--trace', 'off'],
    ['npx', 'playwright', 'test', '--shard=1/2', '--trace', 'off'],
    ['npx', 'playwright', 'test', '--shard=2/2', '--trace', 'off'],
  ]);
  assert.equal(run.calls[1].report, '', 'a lista não escreve relatório de grupo');
  for (const index of [1, 2]) {
    const call = run.calls[index + 1];
    assert.ok(call.args.includes(`--output=${join('test-results', `grupo-${index}`)}`));
    assert.match(call.report, new RegExp(`e2e-grupos[\\\\/]grupo-${index}\\.json$`));
    assert.equal(call.html, join('playwright-report', `grupo-${index}`));
    assert.equal(call.logBefore, false, 'o log do Emulator do grupo anterior sai antes do grupo');
    assert.equal(run.groupLogs[index - 1], `grupo ${index}`, 'o log do Emulator fica com o grupo');
  }
});

test('executor: teste que não rodou, teste instável ou grupo com saída diferente de 0 reprovam a execução', async () => {
  const missing = await runExecutor({ files: { 'shard-1.json': fileReport(0), 'shard-2.json': { suites: [] } } });
  assert.equal(missing.code, 1);
  assert.match(missing.output, /não rodou: b\.spec\.ts:5:3 › lista \[chromium\]/);
  assert.match(missing.output, /FALHOU/);

  const flakyRun = sample((id) => (id === 'b1' ? 'flaky' : 'expected'), (id) => (id === 'b1' ? ['failed', 'passed'] : ['passed']));
  const flaky = await runExecutor({ files: { 'shard-1.json': fileReport(0), 'shard-2.json': fileReport(1, flakyRun) } });
  assert.equal(flaky.code, 1);
  assert.match(flaky.output, /grupo 2: flaky: b\.spec\.ts:5:3 › lista \[chromium\]/);

  const exited = await runExecutor({ files: { 'shard-1.json': fileReport(0), 'shard-1.code': '1', 'shard-2.json': fileReport(1) } });
  assert.equal(exited.code, 1, 'relatório completo não salva o grupo que terminou com falha');
  assert.match(exited.output, /grupo 1 terminou com saída 1/);

  const crashed = await runExecutor({ files: { 'shard-1.json': fileReport(0), 'shard-2.code': '1' } });
  assert.equal(crashed.code, 1);
  assert.match(crashed.output, /grupo 2: sem relatório/);

  const twice = await runExecutor({ files: { 'shard-1.json': passedRun, 'shard-2.json': fileReport(1) } });
  assert.equal(twice.code, 1);
  assert.match(twice.output, /rodou 2 vezes: b\.spec\.ts:5:3 › lista \[chromium\]/);
});

/*
 * EST-01 da revisão de estabilidade: a espera pelas portas entre os grupos. Só consulta: o processo que ocupa a porta
 * nunca é encerrado pelo executor; a porta que continua ocupada no fim do prazo reprova a execução.
 */
test('portas (EST-01): a espera libera a porta que fecha no meio e devolve a que continua ocupada no fim do prazo', async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    assert.equal(await portInUse(port), true);
    const started = Date.now();
    assert.deepEqual(await waitForFreePorts([port], 600, 100), [port], 'ocupada até o fim do prazo');
    assert.ok(Date.now() - started >= 600, 'esperou o prazo inteiro');
    assert.equal(await portInUse(port), true, 'quem ocupa a porta continua lá: nada é encerrado');
    assert.deepEqual(await waitForFreePorts([port], 0), [port], 'prazo 0: confere uma vez e devolve a porta ocupada (ADV-R2-04)');
    setTimeout(() => server.close(), 300);
    assert.deepEqual(await waitForFreePorts([port], 10_000, 100), [], 'livre quando o ouvinte fecha, antes do prazo');
    assert.equal(await portInUse(port), false);
    assert.deepEqual(await waitForFreePorts([port], 0), [], 'porta livre: sem espera');
  } finally {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  }
});

test('executor (EST-01): porta ocupada antes do primeiro grupo e depois de um grupo é esperada, sem encerrar processo, e a execução segue quando ela libera', async () => {
  const port = await freePort();
  const holder = spawn(process.execPath, ['-e',
    'const s = require("node:net").createServer().listen(Number(process.argv[1]), "127.0.0.1", () => { console.log("ouvindo"); setTimeout(() => s.close(() => process.exit(0)), 1500); });',
    String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
  await once(holder.stdout, 'data');
  const exited = once(holder, 'exit');
  const started = Date.now();
  const run = await runExecutor({
    files: { 'shard-1.json': fileReport(0), 'shard-1.hold': '1500', 'shard-2.json': fileReport(1) },
    env: { E2E_PORT: String(port) },
  });
  assert.equal(run.code, 0, run.output);
  assert.match(run.output, /ok: 4 testes, cada um uma vez, todos passaram/);
  assert.ok(Date.now() - started >= 2_500, 'esperou a porta antes do grupo 1 e depois dele');
  assert.deepEqual(await exited, [0, null], 'o processo que ocupava a porta saiu sozinho, sem sinal do executor');
  const shards = run.calls.filter((call) => call.args.some((arg) => arg.startsWith('--shard=')));
  assert.equal(shards.length, 2, 'os dois grupos rodaram');
});

test('executor (EST-01): porta ocupada antes do primeiro grupo reprova sem rodar grupo nenhum, e quem a ocupa continua lá', async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const started = Date.now();
    const run = await runExecutor({
      files: { 'shard-1.json': fileReport(0), 'shard-2.json': fileReport(1) },
      env: { E2E_PORT: String(port), E2E_PORT_WAIT_MS: '400' },
    });
    assert.equal(run.code, 1, run.output);
    assert.match(run.output, new RegExp(`portas em uso antes do primeiro grupo: ${port}\\. Libere-as \\(nenhum processo é encerrado por aqui\\)\\.`));
    assert.ok(Date.now() - started >= 400, 'esperou o prazo dado');
    assert.equal(shardsOf(run.calls).length, 0, 'nenhum grupo rodou');
    assert.equal(await portInUse(port), true, 'o ouvinte não foi encerrado');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('executor (EST-01): porta que não libera depois de um grupo reprova com "ainda em uso" e para os grupos seguintes', async () => {
  // O processo que segura a porta só é encerrado se ainda for deste teste (RR-R32-13).
  const stop = (run) => killOwnStub(run.holderPid, run.stubs, 'SIGTERM');
  const last = await runExecutor({
    files: { 'shard-1.json': fileReport(0), 'shard-2.json': fileReport(1), 'shard-2.hold': '8000' },
    env: { E2E_PORT_WAIT_MS: '500' },
  });
  stop(last);
  assert.equal(last.code, 1, last.output);
  assert.ok(last.holderPid, 'o falso npx deixou um processo na porta');
  assert.match(last.output, /portas ainda em uso depois do grupo 2: \d+ \(o Emulator do grupo não desligou\)/);
  assert.match(last.output, /FALHOU/);
  assert.deepEqual(shardsOf(last.calls), ['--shard=1/2', '--shard=2/2'], 'os relatórios completos não salvam a porta presa no fim');

  const first = await runExecutor({
    files: { 'shard-1.json': fileReport(0), 'shard-1.hold': '8000', 'shard-2.json': fileReport(1) },
    env: { E2E_PORT_WAIT_MS: '500' },
  });
  stop(first);
  assert.equal(first.code, 1, first.output);
  assert.match(first.output, /portas ainda em uso depois do grupo 1: \d+ \(o Emulator do grupo não desligou\)/);
  assert.deepEqual(shardsOf(first.calls), ['--shard=1/2'], 'o grupo 2 não roda com a porta presa');
  assert.match(first.output, /grupo 2: sem relatório/);
});

/*
 * EST-02 da revisão de estabilidade: o Playwright de cada grupo roda num grupo de processos próprio, e o sinal que chega
 * ao executor vira um SIGINT ao grupo em curso (o Ctrl+C do Playwright, que desliga o Emulator pelo caminho limpo). O
 * executor sob teste roda no próprio grupo de processos, para o SIGTERM ao grupo inteiro não chegar a este processo.
 */

const runExecutorSignaled = async ({ files = {}, send, ready = null, env = {} }) => {
  const root = mkdtempSync(join(tmpdir(), 'e2e-grupos-raiz-'));
  const stubs = mkdtempSync(join(tmpdir(), 'e2e-grupos-falsos-'));
  let child = null;
  let stubPid = null;
  let completed = false;
  try {
    for (const tool of ['npm', 'npx']) {
      writeFileSync(join(stubs, tool), STUB);
      chmodSync(join(stubs, tool), 0o755);
    }
    writeFileSync(join(stubs, 'list.json'), JSON.stringify(listed));
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(stubs, name), typeof content === 'string' ? content : JSON.stringify(content));
    }
    child = spawn(process.execPath, [EXECUTOR], {
      cwd: root,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PATH: `${stubs}${delimiter}${process.env.PATH}`,
        STUB_DIR: stubs,
        E2E_START_EMULATORS: 'false',
        E2E_PORT: String(await freePort()),
        E2E_SHARDS: '2',
        ...env,
      },
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    const exited = once(child, 'exit');
    // O instante do sinal: por padrão, com o grupo 1 em curso (o "Playwright" de pé); `ready` escolhe outro, pela saída.
    const startedFile = join(stubs, 'shard-1.started');
    const isReady = ready ?? (() => existsSync(startedFile));
    const deadline = Date.now() + 20_000;
    while (!isReady(output)) {
      assert.ok(Date.now() < deadline, `o instante do sinal não chegou: ${output}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    stubPid = existsSync(startedFile) ? Number(readFileSync(startedFile, 'utf8')) : null;
    await send(child, stubs);
    const timer = setTimeout(() => {
      // O grupo do executor só enquanto ele ainda é filho não colhido deste processo (o PID não foi reaproveitado).
      if (child.exitCode === null && child.signalCode === null) {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { /* já saiu */ }
      }
      killOwnStub(stubPid, stubs, 'SIGKILL');
    }, 20_000);
    const [code, signal] = await exited;
    clearTimeout(timer);
    // O grupo em curso terminou antes do executor? (Se não, ele é encerrado aqui, para não ficar órfão.) Pelo
    // ambiente, e não só pelo número: um PID que já saiu pode ter ido para outro processo (RR-R32-13).
    const stubAlive = stubPid !== null && ownStub(stubPid, stubs);
    if (stubAlive) killOwnStub(stubPid, stubs, 'SIGKILL');
    const read = (name) => (existsSync(join(stubs, name)) ? readFileSync(join(stubs, name), 'utf8').trim().split('\n').filter(Boolean) : []);
    const holderPid = existsSync(join(stubs, 'holder.pid')) ? Number(readFileSync(join(stubs, 'holder.pid'), 'utf8')) : null;
    completed = true;
    return { code, signal, output, stubAlive, holderPid, signals: read('signals.log'), calls: read('calls.log').map((line) => JSON.parse(line)) };
  } finally {
    // Só no caminho de erro (o teste falhou antes de terminar, por exemplo esperando um sinal que não chegou), e nunca
    // por um PID que outro processo possa ter recebido (EST-R4-01, EST-R5-01): o executor, se ainda não saiu, é filho
    // deste processo (o PID dele não foi reaproveitado) e sai com o grupo; o falso `npx` que ficou de pé, só se é mesmo
    // deste teste (o `STUB_DIR` dele no ambiente). No caminho normal, o grupo em curso já foi conferido e encerrado
    // acima. Os pipes do executor também não prendem este processo: uma regressão reprova o teste em vez de travá-lo.
    if (!completed) {
      if (child !== null && child.exitCode === null && child.signalCode === null) {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { /* já saiu */ }
      }
      const started = join(stubs, 'shard-1.started');
      const running = stubPid ?? (existsSync(started) ? Number(readFileSync(started, 'utf8')) : null);
      killOwnStub(running, stubs, 'SIGKILL');
    }
    child?.stdout?.destroy();
    child?.stderr?.destroy();
    rmSync(root, { recursive: true, force: true });
    rmSync(stubs, { recursive: true, force: true });
  }
};

test('RR-R32-13: o teste só sinaliza um PID solto se o processo for dele (o STUB_DIR no ambiente); um processo de fora ou que já saiu fica de fora', async () => {
  const stubs = mkdtempSync(join(tmpdir(), 'e2e-grupos-pid-'));
  const sleeper = (env) => spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { env, stdio: 'ignore' });
  const own = sleeper({ ...process.env, STUB_DIR: stubs });
  const foreign = sleeper({ ...process.env, STUB_DIR: `${stubs}-outro` });
  const unmarked = sleeper(Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'STUB_DIR')));
  try {
    await Promise.all([own, foreign, unmarked].map((child) => once(child, 'spawn')));
    assert.equal(ownStub(own.pid, stubs), true, 'o processo do teste é reconhecido pelo ambiente');
    assert.equal(ownStub(foreign.pid, stubs), false, 'outro STUB_DIR não é deste teste');
    assert.equal(ownStub(unmarked.pid, stubs), false, 'um processo sem STUB_DIR não é deste teste');
    assert.equal(ownStub(process.pid, stubs), false, 'nem este processo');
    assert.equal(ownStub(1, stubs), false, 'nem o init');
    assert.equal(killOwnStub(foreign.pid, stubs, 'SIGKILL'), false, 'o processo de fora não recebe o sinal');
    assert.equal(killOwnStub(null, stubs, 'SIGKILL'), false);
    assert.equal(foreign.exitCode, null);
    assert.equal(foreign.signalCode, null, 'o processo de fora continua vivo');
    const ownExit = once(own, 'exit');
    assert.equal(killOwnStub(own.pid, stubs, 'SIGKILL'), true, 'o processo do teste recebe o sinal');
    assert.deepEqual(await ownExit, [null, 'SIGKILL']);
    assert.equal(ownStub(own.pid, stubs), false, 'depois de sair, o PID não conta mais como do teste');
  } finally {
    for (const child of [own, foreign, unmarked]) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    rmSync(stubs, { recursive: true, force: true });
  }
});

test('executor (EST-02): SIGTERM no executor, SIGTERM no grupo de processos dele e Ctrl+C viram um SIGINT só ao grupo em curso; os seguintes não rodam e a saída é 128 + o sinal', async () => {
  const files = { 'shard-1.wait': '', 'shard-2.json': fileReport(1) };
  const alone = await runExecutorSignaled({ files, send: (child) => child.kill('SIGTERM') });
  assert.equal(alone.code, 143, alone.output);
  assert.equal(alone.signal, null, 'o executor sai pelo próprio caminho, não morto pelo sinal');
  assert.deepEqual(alone.signals, ['SIGINT'], 'o grupo do Playwright recebe um SIGINT, e só ele');
  assert.equal(alone.stubAlive, false, 'o grupo em curso terminou antes do executor: nada fica órfão');
  assert.deepEqual(shardsOf(alone.calls), ['--shard=1/2'], 'o grupo 2 não roda');
  assert.match(alone.output, /SIGTERM recebido: o grupo em curso para e desliga o Emulator; os seguintes não rodam\./);
  assert.match(alone.output, /grupo 1: saída 130, sem relatório/);
  assert.match(alone.output, /execução interrompida por SIGTERM: 1 de 2 grupo\(s\) rodaram/);
  assert.match(alone.output, /FALHOU/);

  // O SIGTERM ao grupo de processos inteiro (como o de um `timeout` ou de um supervisor) não chega ao Playwright, que
  // está noutro grupo: ele recebe o SIGINT do executor e desliga pelo caminho limpo.
  const group = await runExecutorSignaled({ files, send: (child) => process.kill(-child.pid, 'SIGTERM') });
  assert.equal(group.code, 143, group.output);
  assert.deepEqual(group.signals, ['SIGINT'], 'nenhum SIGTERM direto no grupo do Playwright');
  assert.equal(group.stubAlive, false);
  assert.deepEqual(shardsOf(group.calls), ['--shard=1/2']);

  // O Ctrl+C do terminal (SIGINT ao grupo de processos do executor).
  const ctrlC = await runExecutorSignaled({ files, send: (child) => process.kill(-child.pid, 'SIGINT') });
  assert.equal(ctrlC.code, 130, ctrlC.output);
  assert.deepEqual(ctrlC.signals, ['SIGINT'], 'um SIGINT só, o repassado');
  assert.equal(ctrlC.stubAlive, false);
  assert.deepEqual(shardsOf(ctrlC.calls), ['--shard=1/2']);
  assert.match(ctrlC.output, /execução interrompida por SIGINT/);
});

test('executor (EST-11): SIGHUP (o terminal fechado) e SIGQUIT (Ctrl+\\) no executor também viram um SIGINT só ao grupo em curso; a saída é 129 e 131', async () => {
  const files = { 'shard-1.wait': '', 'shard-2.json': fileReport(1) };
  for (const [name, exitCode] of [['SIGHUP', 129], ['SIGQUIT', 131]]) {
    const run = await runExecutorSignaled({ files, send: (child) => child.kill(name) });
    assert.equal(run.code, exitCode, `${name}: ${run.output}`);
    assert.equal(run.signal, null, `${name}: o executor sai pelo próprio caminho, não morto pelo sinal`);
    assert.deepEqual(run.signals, ['SIGINT'], `${name}: o grupo do Playwright recebe um SIGINT, e só ele`);
    assert.equal(run.stubAlive, false, `${name}: o grupo em curso terminou antes do executor`);
    assert.deepEqual(shardsOf(run.calls), ['--shard=1/2'], `${name}: o grupo 2 não roda`);
    assert.match(run.output, new RegExp(`${name} recebido: o grupo em curso para e desliga o Emulator; os seguintes não rodam\\.`));
    assert.match(run.output, new RegExp(`execução interrompida por ${name}: 1 de 2 grupo\\(s\\) rodaram`));
    assert.match(run.output, /FALHOU/);
  }
});

/*
 * EST-11: o sinal que chega sem grupo em curso também conta. O falso `npx` do grupo sai com o relatório completo e
 * deixa a porta do frontend ocupada por 3 s (o "Emulator" desligando); o sinal vai ao executor depois da linha do
 * grupo, enquanto ele espera a porta, e não há grupo do Playwright para receber o SIGINT.
 */
test('executor (EST-11): o sinal durante a espera das portas entre os grupos para a execução: o grupo seguinte não roda e a saída é 143', async () => {
  const run = await runExecutorSignaled({
    files: { 'shard-1.json': fileReport(0), 'shard-1.hold': '3000', 'shard-2.json': fileReport(1) },
    ready: (output) => /grupo 1: saída 0, \d+\/\d+ passaram/.test(output),
    send: (child) => child.kill('SIGTERM'),
  });
  assert.equal(run.code, 143, run.output);
  assert.ok(run.holderPid, 'o grupo 1 deixou a porta ocupada: o sinal chegou durante a espera');
  assert.deepEqual(run.signals, [], 'nenhum grupo em curso para receber o SIGINT');
  assert.deepEqual(shardsOf(run.calls), ['--shard=1/2'], 'o grupo 2 não roda depois do sinal');
  assert.match(run.output, /SIGTERM recebido: o grupo em curso para e desliga o Emulator; os seguintes não rodam\./);
  assert.match(run.output, /execução interrompida por SIGTERM: 1 de 2 grupo\(s\) rodaram/);
  assert.match(run.output, /FALHOU/);
  assert.doesNotMatch(run.output, /ok: \d+ testes/);
});

test('executor (EST-11): o sinal depois do último grupo reprova a execução com 128 + o sinal, mesmo com todos os testes passando', async () => {
  const run = await runExecutorSignaled({
    files: { 'shard-1.json': fileReport(0), 'shard-2.json': fileReport(1), 'shard-2.hold': '3000' },
    ready: (output) => /grupo 2: saída 0, \d+\/\d+ passaram/.test(output),
    send: (child) => child.kill('SIGTERM'),
  });
  assert.equal(run.code, 143, run.output);
  assert.ok(run.holderPid, 'o grupo 2 deixou a porta ocupada: o sinal chegou durante a espera depois do último grupo');
  assert.deepEqual(run.signals, []);
  assert.deepEqual(shardsOf(run.calls), ['--shard=1/2', '--shard=2/2'], 'os dois grupos rodaram antes do sinal');
  assert.match(run.output, /execução interrompida por SIGTERM: 2 de 2 grupo\(s\) rodaram/);
  assert.match(run.output, /FALHOU/);
  assert.doesNotMatch(run.output, /ok: \d+ testes/, 'a interrupção nunca termina em "ok"');
});

test('executor (ADV-R3-03): cada sinal recebido vira um SIGINT ao grupo em curso; o segundo chega ao Playwright, que é o jeito de forçar a saída', async () => {
  const run = await runExecutorSignaled({
    files: { 'shard-1.wait2': '', 'shard-2.json': fileReport(1) },
    send: async (child, stubs) => {
      child.kill('SIGTERM');
      const log = join(stubs, 'signals.log');
      const deadline = Date.now() + 10_000;
      while (!existsSync(log) || readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).length < 1) {
        assert.ok(Date.now() < deadline, 'o primeiro SIGINT não chegou ao grupo');
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      child.kill('SIGTERM');
    },
  });
  assert.equal(run.code, 143, run.output);
  assert.deepEqual(run.signals, ['SIGINT', 'SIGINT'], 'o segundo sinal também foi repassado ao grupo do Playwright');
  assert.equal(run.stubAlive, false, 'o grupo saiu no segundo sinal: nada fica órfão');
  assert.deepEqual(shardsOf(run.calls), ['--shard=1/2'], 'o grupo 2 não roda');
  assert.match(run.output, /execução interrompida por SIGTERM: 1 de 2 grupo\(s\) rodaram/);
});

test('executor (ADV-R3-03): o grupo morto por sinal é falha, mesmo com o relatório completo e todos os testes passando', async () => {
  const run = await runExecutor({ files: { 'shard-1.json': fileReport(0), 'shard-1.selfkill': '', 'shard-2.json': fileReport(1) } });
  assert.equal(run.code, 1, run.output);
  assert.match(run.output, /grupo 1: saída 1, \d+\/\d+ passaram/);
  assert.match(run.output, /grupo 1 terminou com saída 1/);
  assert.match(run.output, /FALHOU/);
  assert.deepEqual(shardsOf(run.calls), ['--shard=1/2', '--shard=2/2'], 'o grupo seguinte roda: não foi interrupção do executor');
});

test('executor (EST-R3-01): o firebase-debug.log que o firebase-tools apaga ao sair limpo fica guardado com o grupo', async () => {
  const run = await runExecutor({ files: { 'shard-1.json': fileReport(0), 'shard-1.limpo': '', 'shard-2.json': fileReport(1) } });
  assert.equal(run.code, 0, run.output);
  assert.equal(run.groupLogs[0], 'grupo 1 limpo', 'o log apagado na saída do grupo 1 ficou em test-results/grupo-1/');
  assert.equal(run.groupLogs[1], 'grupo 2', 'o log que continua no fim do grupo é copiado, como antes');
});

test('executor (EST-R3-02): o relatório de uma execução anterior não conta: o grupo que não escreve o seu reprova com "sem relatório"', async () => {
  const run = await runExecutor({
    rootFiles: { [join('test-results', 'e2e-grupos', 'grupo-2.json')]: fileReport(1) },
    files: { 'shard-1.json': fileReport(0) },
  });
  assert.equal(run.code, 1, run.output);
  assert.match(run.output, /grupo 2: saída 0, sem relatório/);
  assert.match(run.output, /FALHOU/);
});

test('executor (EST-R3-02): o sinal durante a espera das portas antes do primeiro grupo para a execução: nenhum grupo roda e a saída é 143', async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const run = await runExecutorSignaled({
      files: { 'shard-1.json': fileReport(0), 'shard-2.json': fileReport(1) },
      env: { E2E_PORT: String(port) },
      ready: (output) => /\d+ testes em \d+ arquivos/.test(output),
      send: async (child) => {
        child.kill('SIGTERM');
        await new Promise((resolve) => setTimeout(resolve, 300));
        await new Promise((resolve) => server.close(resolve));
      },
    });
    assert.equal(run.code, 143, run.output);
    assert.deepEqual(shardsOf(run.calls), [], 'nenhum grupo roda');
    assert.match(run.output, /execução interrompida por SIGTERM: 0 de 2 grupo\(s\) rodaram/);
    assert.match(run.output, /FALHOU/);
  } finally {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  }
});

test('executor: argumento recusado, quantidade inválida, build ou lista com falha param antes de qualquer grupo', async () => {
  const shard = await runExecutor({ args: ['--shard=1/2'] });
  assert.equal(shard.code, 1);
  assert.match(shard.output, /o argumento --shard=1\/2 não vale aqui/);
  assert.deepEqual(shard.calls, [], 'nada roda');

  const count = await runExecutor({ env: { E2E_SHARDS: '0' } });
  assert.equal(count.code, 1);
  assert.match(count.output, /E2E_SHARDS fora do intervalo/);
  assert.deepEqual(count.calls, []);

  const build = await runExecutor({ files: { 'build.code': '1' } });
  assert.equal(build.code, 1);
  assert.match(build.output, /o build das Functions falhou/);
  assert.deepEqual(build.calls.map((call) => call.tool), ['npm'], 'sem lista nem grupo');

  const list = await runExecutor({ files: { 'list.code': '1' } });
  assert.equal(list.code, 1);
  assert.match(list.output, /a lista da suíte falhou/);
  assert.equal(list.calls.filter((call) => call.args.some((arg) => arg.startsWith('--shard='))).length, 0, 'nenhum grupo');
});
