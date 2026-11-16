#!/usr/bin/env node
/**
 * Marco de fase completa da integração (P5-F.1-R3.2, EST-10 da revisão de estabilidade).
 *
 * O `firebase emulators:exec` trata SIGINT, SIGTERM, SIGHUP e SIGQUIT como pedido de desligamento: para a cadeia de
 * suítes no meio, desliga os emuladores e termina com saída 0 (firebase-tools 15.32.1: `lib/commands/emulators-exec.js:18`
 * e `processKillSignal`/`shutdownWhenKilled` em `lib/emulator/commandUtils.js:164-230`). Só pela saída,
 * `npm run test:integration:emulator` aprovaria a fase pela metade, e o `verify:all` seguiria para o E2E.
 * Com o marco:
 *
 * 1. `iniciar`, antes do `emulators:exec`: grava um marco aberto, novo, em `test-results/integracao/marco.json`;
 * 2. `concluir`, último passo da cadeia que o `emulators:exec` roda: a cadeia é ligada por `&&`, então só chega aqui
 *    com todas as suítes passando; fecha o marco;
 * 3. `conferir`, depois do `emulators:exec` com saída 0: aprova só com o marco fechado, e o apaga. Sem marco ou com o
 *    marco aberto, a cadeia não chegou ao fim: saída 1.
 *
 * O marco não aprova nada sozinho: suíte que falha continua reprovando pela saída do `emulators:exec`; o marco separa a
 * cadeia completa da interrompida, que também sai com 0. Testado em `tests/tools/integracao-marco.test.mjs`.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const MARK = join(process.cwd(), 'test-results', 'integracao', 'marco.json');

const fail = (message) => {
  console.error(`[integração] ${message}`);
  process.exit(1);
};

const read = () => {
  if (!existsSync(MARK)) return null;
  try {
    return JSON.parse(readFileSync(MARK, 'utf8'));
  } catch {
    return null;
  }
};

const step = process.argv[2];
if (step === 'iniciar') {
  mkdirSync(dirname(MARK), { recursive: true });
  writeFileSync(MARK, JSON.stringify({ execucao: randomUUID(), iniciadoEm: new Date().toISOString(), concluidoEm: null }));
} else if (step === 'concluir') {
  const mark = read();
  if (mark === null || mark.concluidoEm !== null) {
    fail('sem marco aberto: a cadeia de suítes rodou fora de `npm run test:integration:emulator`.');
  }
  writeFileSync(MARK, JSON.stringify({ ...mark, concluidoEm: new Date().toISOString() }));
} else if (step === 'conferir') {
  const mark = read();
  rmSync(MARK, { force: true });
  if (mark === null) fail('sem o marco desta execução: a fase de integração não começou por `npm run test:integration:emulator`.');
  if (mark.concluidoEm === null) {
    fail('a fase de integração não chegou ao fim: o Emulator terminou antes da última suíte (por exemplo, por um sinal de desligamento), mesmo saindo com 0.');
  }
  console.log(`[integração] fase completa: todas as suítes rodaram até o fim (execução ${mark.execucao}).`);
} else {
  fail(`passo desconhecido: ${step ?? '(nenhum)'} (use iniciar, concluir ou conferir).`);
}
