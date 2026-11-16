/*
 * Sonda de privacidade P5-F.1-R3 — a impressão digital permite inferir algo além do que o viewer lê?
 *
 * Usa a função real do backend (`transactionFingerprint`, build próprio idêntico a functions/lib).
 *
 * Modelo do atacante: membro ativo qualquer (inclusive viewer). Lê o lançamento atual (V2), a marca
 * (`anchors.*.fp`, `chains.*.base`, `chains.*.node.fp`) e `activity_logs` (catch-all, todo membro): no log de
 * cada evento, a descrição do estado "depois", `changedFields` (nomes de campos de 1º nível) e o carimbo do
 * gatilho. NÃO lê `cash_events` (só owner/admin), onde ficam antes/depois de valor, tipo e data.
 *
 * Casos:
 *  A. versão de criação (a mais comum numa âncora): `updatedAt == createdAt` (createTransaction.ts grava os dois
 *     com o mesmo serverTimestamp) e `createdAt` nunca muda, então o atacante conhece o instante exato: custo de
 *     uma impressão por hipótese.
 *  B. versão produzida por uma edição: `updatedAt` desconhecido, numa janela W antes do carimbo do log do
 *     gatilho, com precisão de microssegundo em produção (milissegundo no Emulator, sonda da R3).
 *
 * Uso: NODE_PATH=<wt>/functions/node_modules node sonda-confirmacao.cjs <dir do build das functions>
 */
'use strict';
const path = require('node:path');
const {performance} = require('node:perf_hooks');
const build = path.resolve(process.argv[2]);
const {transactionFingerprint: fp} = require(path.join(build, 'cash/projectionMarks.js'));
const {Timestamp} = require('firebase-admin/firestore');

const ts = (sec, micros) => new Timestamp(sec, micros * 1000);
const WS = 'ws-sintetico';
const CATEGORIES = Array.from({length: 40}, (_, i) => ({name: `Categoria ${i}`, id: `cat_${i}`}));
CATEGORIES[27] = {name: 'Saúde', id: 'cat_saude'};

const base = (over) => ({
  type: 'despesa', description: 'Despesa pessoal', category: 'Outros', categoryId: 'cat_outros', valueCents: 25_000,
  date: '2026-10-05', isPaid: true, cashAccountId: 'acc_1', workspaceId: WS, profileId: WS, profileType: 'PF',
  userId: 'uid-owner', createdBy: 'uid-owner', updatedBy: 'uid-owner',
  createdAt: ts(1_790_000_000, 123_456), updatedAt: ts(1_790_100_000, 654_321),
  cashEntry: {domainVersion: 1, origin: 'manual', status: 'confirmed', currency: 'BRL', requestHash: 'f'.repeat(64),
    quotaPeriod: '2026-10', accountMovementId: 'mv_apply_2', revision: 2},
  ...over,
});
const v2 = base({}); // o que o viewer lê hoje

// ---------------------------------------------------------------- vazão
const sample = base({});
let n = 0;
const t0 = performance.now();
while (performance.now() - t0 < 2000) { fp({...sample, valueCents: n}); n += 1; }
const rate = n / ((performance.now() - t0) / 1000);
console.log(`vazão de transactionFingerprint (1 núcleo, Node ${process.version}): ${Math.round(rate).toLocaleString('pt-BR')} impressões/s`);

// ---------------------------------------------------------------- caso A
// V1 = versão de criação: descrição e categoria antigas; instante = createdAt; sem revision; movimento de criação.
const v1A = base({description: 'Sessão de terapia com Dra. Ana Exemplo', category: 'Saúde', categoryId: 'cat_saude',
  updatedAt: v2.createdAt, cashEntry: {...v2.cashEntry, accountMovementId: 'mv_apply_1', revision: undefined}});
delete v1A.cashEntry.revision;
const targetA = fp(v1A);
// Dicionário de descrições (a descrição de V1 está no log de criação por 365 dias; depois, só por hipótese).
const dictionary = Array.from({length: 2_000}, (_, i) => `Descrição candidata ${i}`);
dictionary[1_234] = 'Sessão de terapia com Dra. Ana Exemplo';
let triesA = 0; let foundA = null;
const tA = performance.now();
outer: for (const description of dictionary) {
  for (const category of CATEGORIES) {
    triesA += 1;
    const guess = base({description, category: category.name, categoryId: category.id, updatedAt: v2.createdAt,
      cashEntry: {domainVersion: 1, origin: 'manual', status: 'confirmed', currency: 'BRL', requestHash: 'f'.repeat(64),
        quotaPeriod: '2026-10', accountMovementId: 'mv_apply_1'}});
    if (fp(guess) === targetA) { foundA = {description, category: category.name}; break outer; }
  }
}
const msA = performance.now() - tA;
console.log(`\nCaso A (versão de criação, instante conhecido por createdAt): ${foundA ? 'CONFIRMADA' : 'não achada'} ` +
  `${JSON.stringify(foundA)} em ${triesA.toLocaleString('pt-BR')} tentativas, ${msA.toFixed(0)} ms`);

// ---------------------------------------------------------------- caso B
// V1 produzida por uma edição: updatedAt desconhecido. O log do gatilho daquela edição tem carimbo logTs;
// o commit veio antes, dentro da latência do gatilho. Demonstração com janela de 25 ms em microssegundos e a
// descrição conhecida pelo log (só a categoria antiga é hipótese).
const editAt = ts(1_790_050_000, 987_654);
const v1B = base({description: 'Sessão de terapia com Dra. Ana Exemplo', category: 'Saúde', categoryId: 'cat_saude',
  updatedAt: editAt, cashEntry: {...v2.cashEntry, accountMovementId: 'mv_apply_1', revision: 1}});
const targetB = fp(v1B);
const logTs = {sec: 1_790_050_000, micros: 999_000}; // gatilho ~11 ms depois do commit
const WINDOW_US = 25_000;
let triesB = 0; let foundB = null;
const tB = performance.now();
outerB: for (let back = 0; back <= WINDOW_US; back += 1) {
  let micros = logTs.micros - back; let sec = logTs.sec;
  if (micros < 0) { micros += 1_000_000; sec -= 1; }
  const at = ts(sec, micros);
  for (const category of CATEGORIES) {
    triesB += 1;
    const guess = base({description: 'Sessão de terapia com Dra. Ana Exemplo', category: category.name,
      categoryId: category.id, updatedAt: at, cashEntry: {...v2.cashEntry, accountMovementId: 'mv_apply_1', revision: 1}});
    if (fp(guess) === targetB) { foundB = {category: category.name, updatedAt: `${sec}.${String(micros).padStart(6, '0')}`}; break outerB; }
  }
}
const msB = performance.now() - tB;
console.log(`Caso B (versão de edição, janela de ${WINDOW_US / 1000} ms em µs × ${CATEGORIES.length} categorias): ` +
  `${foundB ? 'CONFIRMADA' : 'não achada'} ${JSON.stringify(foundB)} em ${triesB.toLocaleString('pt-BR')} tentativas, ${(msB / 1000).toFixed(1)} s`);

// ---------------------------------------------------------------- extrapolação
const human = (seconds) => seconds < 120 ? `${seconds.toFixed(1)} s` : seconds < 7_200 ? `${(seconds / 60).toFixed(1)} min` :
  seconds < 172_800 ? `${(seconds / 3600).toFixed(1)} h` : `${(seconds / 86_400).toFixed(1)} dias`;
console.log('\nExtrapolação pela vazão medida (1 núcleo de CPU; GPU dedicada é ordens de grandeza mais rápida):');
for (const [what, count] of [
  ['A: 1 hipótese (instante conhecido)', 1],
  ['A: 40 categorias × 365 datas', 40 * 365],
  ['A: 10^6 descrições (dicionário)', 1e6],
  ['B: janela 1 s em µs × 1 hipótese', 1e6],
  ['B: janela 1 s em µs × 40 categorias', 4e7],
  ['B: janela 5 s em µs × 40 categorias × 365 datas', 5e6 * 40 * 365],
  ['B: janela 5 s em µs × 10^6 descrições livres', 5e6 * 1e6],
]) console.log(`  ${what}: ${count.toExponential(1)} impressões ≈ ${human(count / rate)}`);
if (!foundA || !foundB) process.exitCode = 1;
