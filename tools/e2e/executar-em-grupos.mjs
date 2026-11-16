#!/usr/bin/env node
/**
 * E2E oficial em grupos, cada um com o próprio Emulator (P5-F.1-R3.2, RR-R31-07). É o `npm run test:e2e` (e, com ele,
 * o `verify:all` e o job de CI), depois do build E2E.
 *
 * Por quê: o emulador de Functions mantém um processo por função chamada e não encerra os ociosos; numa sessão só, a
 * suíte inteira chegava a mais de 14 GB, e a função chamada pela primeira vez no fim subia a frio sob essa pressão, ou o
 * navegador era morto por falta de memória. Em grupos, cada Emulator começa vazio e é desligado no fim do grupo.
 *
 * O que não muda: os mesmos arquivos e testes, as mesmas asserções e prazos, a mesma configuração do Playwright e o mesmo
 * build, contra o projeto `minhas-financas-local`; cada spec cuida do próprio isolamento de dados (limpa o Emulator,
 * apaga o que criou ou usa ids próprios). Sem nova tentativa (`retries: 0`) e sem teste ignorado.
 *
 * Como:
 * 1. compila as Functions (as specs carregam `functions/lib`) e lista a suíte com os argumentos dados;
 * 2. para cada grupo (`--shard=i/N` do Playwright, N = `E2E_SHARDS`, padrão 3), espera as portas do Emulator e do
 *    frontend livres (sem encerrar processo nenhum), roda o Playwright, que sobe e desliga o Emulator do grupo
 *    (`webServer`), e guarda os logs do Emulator do grupo em `test-results/grupo-i/` (o `firebase-debug.log`, que o
 *    firebase-tools apaga ao sair limpo, por um link físico feito enquanto o grupo roda; EST-R3-01);
 * 3. confere, pelos relatórios JSON dos grupos, que cada teste da lista rodou exatamente uma vez, numa tentativa só, e
 *    passou. Qualquer diferença, grupo com saída diferente de 0 ou porta que não liberou é falha (saída 1).
 *
 * Interrupção (EST-02 e EST-11 da revisão de estabilidade): o Playwright de cada grupo roda num grupo de processos
 * próprio. O Ctrl+C do terminal e o SIGTERM, SIGHUP ou SIGQUIT enviados ao executor ou ao grupo de processos dele (por
 * `timeout`, pelo cancelamento do CI, pelo terminal fechado, pelo Ctrl+\) chegam só aqui, e o executor repassa cada um
 * como um SIGINT ao grupo do Playwright em curso, o mesmo que um Ctrl+C nele: no primeiro, o Playwright para e desliga o
 * Emulator do grupo pelo caminho limpo (`gracefulShutdown`); um segundo força a saída e pode deixar o Emulator de pé
 * (RB-04). Sem isso, um SIGTERM ao grupo de processos matava o Playwright sem desligar o Emulator, e a JVM ficava na
 * porta 8080. O sinal recebido entre os grupos ou depois do último também conta: os grupos seguintes não rodam, e a
 * execução falha com 128 + o número do sinal, nunca com "ok". Um sinal só ao `npm` de cima não chega aqui (RB-04).
 *
 * Uso: `npm run test:e2e [-- <argumentos do playwright test>]`; `E2E_SHARDS=<n>` muda a quantidade de grupos, e
 * `E2E_PORT_WAIT_MS` só encurta a espera pelas portas (padrão e teto: 60 s).
 */
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { constants } from 'node:os';
import { dirname, join } from 'node:path';

import { ACCEPTED_ARGUMENTS, checkGroupRuns, e2ePorts, effectiveGroups, filesOf, parseGroupCount, parsePortWait, refusedArgument, testsOfReport } from './grupos.mjs';
import { waitForFreePorts } from './portas.mjs';

const ROOT = process.cwd();
const REPORTS = join(ROOT, 'test-results', 'e2e-grupos');
const EMULATOR_LOGS = ['firebase-debug.log', 'firestore-debug.log'];

const fail = (message) => {
  console.error(`\n[e2e em grupos] ${message}`);
  process.exit(1);
};

/** O primeiro sinal de interrupção recebido (`SIGINT`, `SIGTERM`, `SIGHUP` ou `SIGQUIT`), e o grupo do Playwright em curso. */
let interrupted = null;
let current = null;
const interrupt = (signal) => {
  if (interrupted === null) {
    interrupted = signal;
    console.error(`\n[e2e em grupos] ${signal} recebido: o grupo em curso para e desliga o Emulator; os seguintes não rodam.`);
  }
  // Só o grupo do Playwright que este executor criou e que ainda roda (RR-R32-13): o filho sai do `current` no mesmo
  // passo em que é colhido, e a conferência de saída cobre a janela entre os dois.
  if (current === null || current.exitCode !== null || current.signalCode !== null) return;
  try {
    process.kill(-current.pid, 'SIGINT');
  } catch {
    // O grupo do Playwright já terminou.
  }
};
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT']) process.on(signal, () => interrupt(signal));

/**
 * O firebase-tools apaga o `firebase-debug.log` ao sair com saída 0 ou 1 (sem `DEBUG`), e o `gracefulShutdown` faz o
 * Emulator de cada grupo sair assim. Enquanto o grupo roda, um link físico em `test-results/grupo-i/` guarda o arquivo
 * (EST-R3-01 da revisão de estabilidade). A pasta é criada aqui porque o Playwright a apaga antes de subir o Emulator.
 */
const keepDebugLog = (output) => {
  const source = join(ROOT, 'firebase-debug.log');
  const kept = join(ROOT, output, 'firebase-debug.log');
  const timer = setInterval(() => {
    if (existsSync(kept) || !existsSync(source)) return;
    try {
      mkdirSync(dirname(kept), { recursive: true });
      linkSync(source, kept);
    } catch {
      // Tenta de novo no próximo passo; sem o link, a cópia do fim do grupo ainda vale.
    }
  }, 500);
  return () => clearInterval(timer);
};

const run = (command, args, env, output) => new Promise((resolve) => {
  const child = spawn(command, args, { cwd: ROOT, env, stdio: 'inherit', detached: true });
  current = child;
  const stopKeeping = keepDebugLog(output);
  child.once('error', (error) => {
    stopKeeping();
    current = null;
    console.error(error);
    resolve(1);
  });
  child.once('exit', (code, signal) => {
    stopKeeping();
    current = null;
    resolve(signal ? 1 : (code ?? 1));
  });
});

const readReport = (path) => {
  if (!existsSync(path)) return null;
  try {
    return testsOfReport(JSON.parse(readFileSync(path, 'utf8')));
  } catch (error) {
    console.error(`[e2e em grupos] relatório ilegível: ${path}: ${error.message}`);
    return null;
  }
};

const main = async () => {
  let requested;
  let portWaitMs;
  try {
    requested = parseGroupCount(process.env.E2E_SHARDS);
    portWaitMs = parsePortWait(process.env.E2E_PORT_WAIT_MS);
  } catch (error) {
    fail(error.message);
  }
  const args = process.argv.slice(2);
  const refused = refusedArgument(args);
  if (refused) fail(`o argumento ${refused} não vale aqui: este executor divide a suíte em grupos, confere a lista inteira e não muda o critério dos testes (aceitos: ${ACCEPTED_ARGUMENTS}).`);
  const startEmulators = process.env.E2E_START_EMULATORS !== 'false';
  const ports = e2ePorts({ startEmulators, previewPort: Number(process.env.E2E_PORT || 5173) });
  if (!startEmulators) console.warn('[e2e em grupos] E2E_START_EMULATORS=false: os grupos usam o Emulator já de pé, sem isolamento.');

  // 1. Functions compiladas e a lista completa (sem Emulator: `--list` não sobe o webServer).
  const built = spawnSync('npm', ['--prefix', 'functions', 'run', 'build'], { cwd: ROOT, stdio: 'inherit' });
  if (built.status !== 0) fail('o build das Functions falhou.');
  const listing = spawnSync('npx', ['playwright', 'test', '--list', '--reporter=json', ...args], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, E2E_SHARD_REPORT: '' },
  });
  if (listing.status !== 0) {
    process.stderr.write(listing.stderr ?? '');
    fail('a lista da suíte falhou.');
  }
  let listed;
  try {
    listed = testsOfReport(JSON.parse(listing.stdout));
  } catch (error) {
    fail(`a lista da suíte não é um JSON do Playwright: ${error.message}`);
  }
  const groups = effectiveGroups(requested, filesOf(listed).length);
  console.log(`[e2e em grupos] ${listed.length} testes em ${filesOf(listed).length} arquivos, em ${groups} grupo(s), cada um com o próprio Emulator.`);

  rmSync(REPORTS, { recursive: true, force: true });
  mkdirSync(REPORTS, { recursive: true });
  const busyBefore = await waitForFreePorts(ports, portWaitMs);
  if (busyBefore.length > 0) fail(`portas em uso antes do primeiro grupo: ${busyBefore.join(', ')}. Libere-as (nenhum processo é encerrado por aqui).`);

  // 2. Os grupos, um depois do outro.
  const runs = [];
  const summary = [];
  for (let index = 1; index <= groups; index += 1) {
    if (interrupted !== null) break;
    const report = join(REPORTS, `grupo-${index}.json`);
    const output = join('test-results', `grupo-${index}`);
    const env = { ...process.env, E2E_SHARD_REPORT: report, PLAYWRIGHT_HTML_OUTPUT_DIR: join('playwright-report', `grupo-${index}`) };
    for (const log of EMULATOR_LOGS) rmSync(join(ROOT, log), { force: true });
    console.log(`\n[e2e em grupos] grupo ${index} de ${groups}`);
    const started = Date.now();
    const code = await run('npx', ['playwright', 'test', `--shard=${index}/${groups}`, `--output=${output}`, ...args], env, output);
    const seconds = Math.round((Date.now() - started) / 1000);
    mkdirSync(join(ROOT, output), { recursive: true });
    for (const log of EMULATOR_LOGS) {
      // O que o link já guarda (o mesmo arquivo) não é copiado de novo.
      if (existsSync(join(ROOT, log)) && !existsSync(join(ROOT, output, log))) copyFileSync(join(ROOT, log), join(ROOT, output, log));
    }
    const tests = readReport(report);
    runs.push(tests);
    const passed = tests ? tests.filter((test) => test.status === 'expected').length : 0;
    summary.push(`grupo ${index}: saída ${code}, ${tests ? `${passed}/${tests.length} passaram` : 'sem relatório'}, ${seconds} s`);
    console.log(`[e2e em grupos] ${summary[summary.length - 1]}`);
    const busyAfter = await waitForFreePorts(ports, portWaitMs);
    if (busyAfter.length > 0) {
      summary.push(`portas ainda em uso depois do grupo ${index}: ${busyAfter.join(', ')} (o Emulator do grupo não desligou)`);
      break;
    }
    if (code !== 0) summary.push(`grupo ${index} terminou com saída ${code}`);
  }

  // 3. A conferência contra a lista completa.
  if (interrupted !== null) summary.push(`execução interrompida por ${interrupted}: ${runs.length} de ${groups} grupo(s) rodaram`);
  while (runs.length < groups) runs.push(null);
  const problems = checkGroupRuns(listed, runs);
  const ok = interrupted === null && problems.length === 0 && summary.every((line) => !/terminou com saída|ainda em uso/.test(line));
  console.log('\n[e2e em grupos] resumo');
  for (const line of summary) console.log(`  ${line}`);
  for (const problem of problems.slice(0, 50)) console.log(`  problema: ${problem}`);
  if (problems.length > 50) console.log(`  … e mais ${problems.length - 50} problemas`);
  console.log(`[e2e em grupos] ${ok ? `ok: ${listed.length} testes, cada um uma vez, todos passaram` : 'FALHOU'}`);
  process.exit(ok ? 0 : interrupted !== null ? 128 + constants.signals[interrupted] : 1);
};

await main();
