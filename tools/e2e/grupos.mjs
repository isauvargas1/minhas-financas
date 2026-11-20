/**
 * E2E oficial em grupos (P5-F.1-R3.2, RR-R31-07): as decisões puras do executor (`executar-em-grupos.mjs`), sem
 * processo, rede nem disco. Testadas em `tests/tools/e2e-grupos.test.mjs`.
 *
 * O executor roda a mesma suíte do `playwright test` em grupos de arquivos (`--shard` do Playwright), um depois do
 * outro, cada um com o próprio Emulator. Uma execução só vale quando cada teste da lista completa rodou exatamente uma
 * vez, numa tentativa só, com o resultado esperado: nenhum teste some, nenhum é repetido e nenhum é ignorado.
 */

/**
 * Grupos padrão: três, cada um com o próprio Emulator, a quantidade validada na P5-F.1-R3.1. A divisão é a do `--shard`
 * do Playwright (por arquivo, na ordem da lista), e não a divisão manual da R3.1 (EST-06 da revisão de estabilidade).
 */
export const DEFAULT_GROUPS = 3;
/** Teto de grupos: cada grupo sobe um Emulator novo. */
export const MAX_GROUPS = 12;

/** Quantidade de grupos de `E2E_SHARDS` (padrão 3). Recusa valor que não seja inteiro de 1 a 12. */
export const parseGroupCount = (value) => {
  if (value === undefined || value === '') return DEFAULT_GROUPS;
  if (!/^\d+$/.test(value)) throw new Error(`E2E_SHARDS inválido: "${value}" (use um inteiro de 1 a ${MAX_GROUPS}).`);
  const count = Number(value);
  if (count < 1 || count > MAX_GROUPS) throw new Error(`E2E_SHARDS fora do intervalo: ${count} (use de 1 a ${MAX_GROUPS}).`);
  return count;
};

/** Prazo da espera pelas portas entre os grupos: o padrão, e o teto. */
export const MAX_PORT_WAIT_MS = 60_000;

/**
 * Prazo da espera pelas portas, de `E2E_PORT_WAIT_MS` (padrão 60 s). Só encurta, de 0 a 60.000 ms: os testes do executor
 * exercitam a porta que não libera sem esperar o prazo inteiro (EST-01 da revisão de estabilidade). Encurtar só torna a
 * reprovação mais cedo; nunca aprova uma porta ocupada.
 */
export const parsePortWait = (value) => {
  if (value === undefined || value === '') return MAX_PORT_WAIT_MS;
  if (!/^\d+$/.test(value) || Number(value) > MAX_PORT_WAIT_MS) {
    throw new Error(`E2E_PORT_WAIT_MS inválido: "${value}" (use um inteiro de 0 a ${MAX_PORT_WAIT_MS}; ele só encurta a espera).`);
  }
  return Number(value);
};

/**
 * Argumentos aceitos (EST-08 da revisão de estabilidade; ADV-R2-03 da adversarial). O executor divide a suíte em grupos,
 * lista a suíte e confere o resultado de cada teste: só valem os que escolhem o que roda e o rastro, sem mudar o
 * critério dos testes que rodam. São os filtros de arquivo e linha (posicionais), `-g`/`--grep`, `--grep-invert`,
 * `--project`, `--trace`, `-x` e `--max-failures`. Qualquer outro é recusado: os que dividem e listam (`--shard`,
 * `--last-failed`, `--list`), os que mudam o critério (nova tentativa, repetição, prazo, paralelismo, outra configuração,
 * instantâneos, `--debug`) e as formas curtas combinadas (`-xj2`, `-xc …`, `-xu`). O valor de uma opção não pode
 * começar com `-`. A linha final diz quantos testes rodaram.
 */
const VALUE_OPTIONS = new Set(['-g', '--grep', '--grep-invert', '--project', '--trace', '--max-failures']);
const FLAG_OPTIONS = new Set(['-x']);
export const ACCEPTED_ARGUMENTS = 'arquivos e linhas, -g/--grep, --grep-invert, --project, --trace, -x e --max-failures';
export const refusedArgument = (args) => {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('-') || FLAG_OPTIONS.has(arg)) continue;
    if (VALUE_OPTIONS.has(arg)) {
      const value = args[index + 1];
      if (value !== undefined && value.startsWith('-')) return value;
      index += 1;
      continue;
    }
    const equals = arg.indexOf('=');
    if (arg.startsWith('--') && equals > 0 && VALUE_OPTIONS.has(arg.slice(0, equals))) continue;
    // `-g` com o valor junto (`-gADV-01`).
    if (/^-g[^-]/.test(arg)) continue;
    return arg;
  }
  return null;
};

/**
 * Os testes de um relatório JSON do Playwright (da lista ou de uma execução): a chave estável de cada um (arquivo,
 * linha, coluna, títulos e projeto), o resultado final (`expected`, `unexpected`, `flaky`, `skipped`) e o resultado de
 * cada tentativa.
 */
export const testsOfReport = (report) => {
  const tests = [];
  const walk = (suite, titles) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        tests.push({
          key: `${spec.file}:${spec.line}:${spec.column} › ${[...titles, spec.title].join(' › ')} [${test.projectName ?? ''}]`,
          file: spec.file,
          status: test.status ?? null,
          attempts: (test.results ?? []).map((result) => result.status),
        });
      }
    }
    for (const child of suite.suites ?? []) walk(child, [...titles, child.title]);
  };
  // O primeiro nível é o arquivo: o título dele já está em `spec.file`.
  for (const suite of report.suites ?? []) {
    for (const spec of suite.specs ?? []) walk({ specs: [spec] }, []);
    for (const child of suite.suites ?? []) walk(child, [child.title]);
  }
  return tests;
};

/** Arquivos distintos de uma lista de testes. */
export const filesOf = (tests) => [...new Set(tests.map((test) => test.file))];

/**
 * Quantos grupos rodar: o pedido, limitado pela quantidade de arquivos (com `fullyParallel: false`, o Playwright divide
 * por arquivo; um grupo vazio não teria o que rodar).
 */
export const effectiveGroups = (requested, fileCount) => Math.max(1, Math.min(requested, fileCount));

/**
 * Confere a execução em grupos contra a lista completa. Devolve os problemas (vazio: a execução vale):
 * - teste da lista que não rodou, ou que rodou mais de uma vez (em grupos diferentes ou repetido);
 * - teste que rodou fora da lista;
 * - resultado diferente de `expected` (falha, instável ou ignorado) ou mais de uma tentativa;
 * - grupo sem relatório (o processo caiu antes de escrevê-lo).
 */
export const checkGroupRuns = (listed, runs) => {
  const problems = [];
  const seen = new Map(listed.map((test) => [test.key, 0]));
  if (listed.length === 0) problems.push('a lista completa está vazia');
  if (new Set(listed.map((test) => test.key)).size !== listed.length) problems.push('a lista completa tem chaves repetidas');
  runs.forEach((run, index) => {
    const group = `grupo ${index + 1}`;
    if (run === null) {
      problems.push(`${group}: sem relatório`);
      return;
    }
    for (const test of run) {
      if (!seen.has(test.key)) {
        problems.push(`${group}: rodou fora da lista: ${test.key}`);
        continue;
      }
      seen.set(test.key, seen.get(test.key) + 1);
      if (test.status !== 'expected') problems.push(`${group}: ${test.status ?? 'sem resultado'}: ${test.key}`);
      else if (test.attempts.length !== 1 || test.attempts[0] !== 'passed') {
        problems.push(`${group}: tentativas ${JSON.stringify(test.attempts)}: ${test.key}`);
      }
    }
  });
  for (const [key, count] of seen) {
    if (count === 0) problems.push(`não rodou: ${key}`);
    else if (count > 1) problems.push(`rodou ${count} vezes: ${key}`);
  }
  return problems;
};

/** Portas do Emulator (`firebase.json` e as auxiliares que o firebase-tools sobe) e a do servidor do frontend. */
export const e2ePorts = ({ startEmulators, previewPort }) => [
  ...(startEmulators ? [4000, 4400, 4500, 5001, 8080, 9099, 9150, 9199, 9299, 9499] : []),
  previewPort,
];
