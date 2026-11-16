/*
 * Sonda de privacidade (contexto, PRÉ-EXISTENTE à P5-F.1-R3): `transactions/{id}.cashEntry.requestHash`.
 *
 * createTransaction.ts grava no próprio lançamento (legível por todo membro ativo, inclusive viewer) o
 * `requestHash` da reserva de idempotência: sha256(stableStringify(payload sem idempotencyKey/correlationId))
 * (functions/src/shared/idempotency.ts:49-51). O payload da criação não tem instante nem segredo
 * (functions/src/cash/contracts.ts: workspaceId, description, amountCents, supplier, costCenter, categoryId,
 * status/date/dueDate, cashAccountId, type, incomeType/expenseType/paymentMethod). A âncora "nunca muda"
 * (mutateTransaction.ts:99-100). Pergunta: depois de uma correção da descrição, o conteúdo original continua
 * confirmável por tentativa, sem marca nenhuma?
 *
 * Usa as funções reais `sha256` e `stableStringify` (build próprio de functions/src/shared/hashing.ts).
 * Uso: NODE_PATH=<wt>/functions/node_modules node sonda-requesthash-preexistente.cjs <dir do build das functions>
 */
'use strict';
const path = require('node:path');
const {performance} = require('node:perf_hooks');
const build = path.resolve(process.argv[2]);
const {sha256, stableStringify} = require(path.join(build, 'shared/hashing.js'));

const payloadOf = (description) => ({
  workspaceId: 'ws-sintetico', type: 'despesa', description, amountCents: 25_000, categoryId: 'cat_saude',
  status: 'confirmed', date: '2026-10-05', cashAccountId: 'acc_1', paymentMethod: 'Pix',
});
// O que ficou gravado na criação (a descrição original tinha o nome de uma terceira pessoa).
const requestHash = sha256(stableStringify(payloadOf('Sessão de terapia com Dra. Ana Exemplo')));
// O viewer lê hoje o lançamento corrigido: description = "Despesa pessoal", e o mesmo requestHash.
const dictionary = Array.from({length: 500_000}, (_, i) => `Sessão de terapia com Dra. Candidata ${i}`);
dictionary[421_337] = 'Sessão de terapia com Dra. Ana Exemplo';
const t0 = performance.now();
let found = null; let tries = 0;
for (const guess of dictionary) {
  tries += 1;
  if (sha256(stableStringify(payloadOf(guess))) === requestHash) { found = guess; break; }
}
const ms = performance.now() - t0;
console.log(`requestHash do lançamento (visível a viewer): ${requestHash.slice(0, 16)}…`);
console.log(`descrição original ${found ? 'CONFIRMADA' : 'não achada'}: ${JSON.stringify(found)} em ${tries.toLocaleString('pt-BR')} tentativas, ${ms.toFixed(0)} ms ` +
  `(${Math.round(tries / (ms / 1000)).toLocaleString('pt-BR')} hipóteses/s, sem janela de tempo)`);
if (!found) process.exitCode = 1;
