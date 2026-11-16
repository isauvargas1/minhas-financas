/*
 * Sonda de privacidade P5-F.1-R3, rodada 3 — a "Ordem obrigatória" do requisito da P8 (PRIVACY_LGPD.md §6.4)
 * e o resíduo da preparação abandonada (RR-R3-08, N01 da arquitetura).
 *
 * Usa as funções compiladas da árvore de código 377c2f3f numa cópia própria do revisor
 * (sandbox-r3/functions/lib), nunca o functions/lib do worktree. Nenhum Firestore, nenhum Emulator.
 *
 * O "gatilho" repete o laço de `applyCashPeriodWriteOnce` (periods.ts:1338-1406 na árvore 377c2f3f):
 * entrega coberta pelo corte publicado não toca a marca; senão markGenerationsFor → markViewOf →
 * applyMarkEvent → markChainOf, poda com as gerações do estado lido (vigente e preparada) e `set` sem merge.
 * A "página da reconstrução" grava só a âncora da posição preparada, com merge (rebuild.ts:1262-1276).
 * A "prova" usa a visão do backend (`markViewOf`); a paridade com o cliente é a da fixture de visões.
 *
 * Uso: NODE_PATH=<wt>/functions/node_modules node sonda-r3-ordem-p8.cjs <sandbox-r3>/functions/lib
 */
'use strict';
const path = require('node:path');
const lib = path.resolve(process.argv[2]);
const marks = require(path.join(lib, 'cash/projectionMarks.js'));
const periods = require(path.join(lib, 'cash/periods.js'));
const {Timestamp} = require('firebase-admin/firestore');

const WS = 'ws-sintetico';
const ID = 'tx-sintetico';
const ts = (sec, micros = 0) => new Timestamp(sec, micros * 1000);
const version = (base, over, sec) => ({...base, ...over, updatedAt: ts(sec, 777)});
const V0 = {
  type: 'despesa', description: 'Despesa', category: 'Outros', categoryId: 'cat_outros', valueCents: 25_000,
  date: '2026-10-05', isPaid: true, cashAccountId: 'acc_1', workspaceId: WS, profileId: WS, profileType: 'PF',
  userId: 'uid-owner', createdBy: 'uid-owner', updatedBy: 'uid-owner', createdAt: ts(1_790_000_000, 1),
  updatedAt: ts(1_790_000_000, 1), cashEntry: {domainVersion: 1, origin: 'manual', status: 'confirmed',
    currency: 'BRL', requestHash: 'f'.repeat(64), quotaPeriod: '2026-10', accountMovementId: 'mv_1'},
};
// V1 e V1b: versões com o dado a corrigir ou anonimizar; V2: corrigida; V3, V4: edições posteriores.
const V1 = version(V0, {description: 'Sessão de terapia com Dra. Ana Exemplo', category: 'Saúde'}, 1_790_010_000);
const V1b = version(V1, {valueCents: 26_000}, 1_790_020_000);
const V2 = version(V1b, {description: 'Despesa pessoal', category: 'Outros'}, 1_790_100_000);
const V3 = version(V2, {valueCents: 27_000}, 1_790_400_000);
const V4 = version(V3, {valueCents: 28_000}, 1_790_500_000);
const fp = (content) => marks.transactionFingerprint(content);
const OLD = {V1: fp(V1), V1b: fp(V1b)};

const st = (over) => ({categoryGeneration: 'g0', baselineCutoff: null, markSlot: 'a', categoryStaging: null,
  ...over});
const c1 = ts(1_790_005_000); // corte de R1 (depois de V0, antes de V1)
const c2 = ts(1_790_050_000); // corte de R2 (depois de V1b, antes da correção V2)
const c3 = ts(1_790_450_000); // corte de R3 (depois de V3)
const R1 = st({categoryGeneration: 'R1', baselineCutoff: c1, markSlot: 'b'});
const R1withR2 = {...R1, categoryStaging: {generation: 'R2', cutoff: c2}};
const R2pub = st({categoryGeneration: 'R2', baselineCutoff: c2, markSlot: 'a'});
const R1withR3 = {...R1, categoryStaging: {generation: 'R3', cutoff: c3}}; // R2 descartada (24 h)
const R3pub = st({categoryGeneration: 'R3', baselineCutoff: c3, markSlot: 'a'});
const R2withR3 = {...R2pub, categoryStaging: {generation: 'R3', cutoff: c3}};
const R3pubB = st({categoryGeneration: 'R3', baselineCutoff: c3, markSlot: 'b'});

const world = () => {
  let stored; // documento da marca "no Firestore"
  const trigger = (state, before, after) => {
    const eventTime = ts(after ? after.updatedAt.seconds : 1_799_000_000, 999);
    if (state.baselineCutoff && periods.compareCommitTimes(eventTime, state.baselineCutoff) <= 0) return 'covered';
    const event = marks.markEventOf(before, after, before ? before.updatedAt : null);
    const doc = marks.readMarkDoc(stored);
    for (const generation of periods.markGenerationsFor(state, eventTime)) {
      const next = marks.applyMarkEvent(marks.markViewOf(doc, generation), event, generation);
      doc.chains[generation.slot] = marks.markChainOf(next, generation);
    }
    const live = state.categoryStaging ? [state.categoryGeneration, state.categoryStaging.generation] :
      [state.categoryGeneration];
    stored = marks.markDocumentData(WS, ID, marks.pruneMarkDoc(doc, live));
    return 'applied';
  };
  const anchor = (slot, g, cut, content) => {
    const patch = marks.markAnchorPatch(WS, ID, slot, {g, cut, fp: fp(content)});
    stored = {...(stored ?? {}), ...patch, anchors: {...(stored?.anchors ?? {}), ...patch.anchors}};
  };
  const remove = () => { stored = undefined; };
  const where = () => {
    const found = [];
    const walk = (value, at) => {
      for (const [name, print] of Object.entries(OLD)) if (value === print) found.push(`${name}@${at}`);
      if (value && typeof value === 'object' && !(value instanceof Timestamp)) {
        for (const [k, v] of Object.entries(value)) walk(v, at ? `${at}.${k}` : k);
      }
    };
    walk({anchors: stored?.anchors, chains: stored?.chains}, '');
    return found;
  };
  const proof = (state, current) => {
    const view = marks.markViewOf(marks.readMarkDoc(stored),
      {id: state.categoryGeneration, cutoff: state.baselineCutoff, slot: state.markSlot, role: 'published'});
    const ok = view.kind === 'rooted' && view.pending.length === 0 && view.node.k === 'alive' &&
      view.node.fp === fp(current);
    const node = view.kind === 'rooted' ? (view.node.k === 'alive' ?
      Object.entries({V0, V1, V1b, V2, V3, V4}).find(([, c]) => fp(c) === view.node.fp)?.[0] ?? '?' :
      view.node.k) : view.kind;
    return `prova ${ok ? 'VERDADEIRA' : 'recusada'} (nó ${node}, pendências ${view.pending?.length ?? '-'})`;
  };
  return {trigger, anchor, remove, where, proof};
};

const out = [];
const report = (title, w, extra = '') => {
  const found = w.where();
  out.push(`${title}: ${found.length ? `impressão antiga PRESENTE em ${found.join(', ')}` : 'nenhuma impressão antiga'}` +
    (extra ? ` | ${extra}` : ''));
};
// Linha de base: criação V0 na g0; R1 publicada com a âncora de V0 em b; edição V0 → V1 (dado a corrigir).
const base = () => {
  const w = world();
  w.trigger(st(), undefined, V0);
  w.anchor('b', 'R1', c1, V0);
  w.trigger(R1, V0, V1);
  return w;
};

// 3 e 4 da rodada 2, de novo: ordem certa e ordem errada, sem reconstrução em andamento.
{
  const w = base();
  w.trigger(R1, V1, V2);
  w.remove();
  w.anchor('a', 'R2', c2, V2);
  report('3. ordem certa: entrega aplicada, apagar, reconstruir (R2 nova)', w, w.proof(R2pub, V2));
}
{
  const w = base();
  w.remove();
  w.trigger(R1, V1, V2);
  report('4a. ordem errada: entrega da correção depois de apagar', w);
  w.anchor('a', 'R2', c2, V2);
  report('4b. ordem errada, depois de R2 publicada', w, w.proof(R2pub, V2));
}
// 5. Entregas fora de ordem: W_a (V1 → V1b) e a correção W_b (V1b → V2); W_b chega primeiro.
{
  const w = base();
  w.trigger(R1, V1b, V2); // W_b antes de W_a: pendência
  report('5a. W_b aplicada antes de W_a (cadeia com pendência)', w);
  w.remove(); // ordem errada: apagar com pendência (W_a sem marca de entrega)
  w.trigger(R1, V1, V1b); // W_a chega depois
  w.anchor('a', 'R2', c2, V2);
  report('5b. apagar com pendência, W_a chega depois, R2 publicada', w, w.proof(R2pub, V2));
}
{
  const w = base();
  w.trigger(R1, V1b, V2);
  w.trigger(R1, V1, V1b); // W_a chega: absorve a pendência
  report('5c. W_a aplicada (cadeia sem pendência), antes de apagar', w, w.proof(R1, V2));
  w.remove();
  w.anchor('a', 'R2', c2, V2);
  report('5d. ordem certa: apagar sem pendência e reconstruir (R2 nova)', w, w.proof(R2pub, V2));
}
// 6. Reconstrução R2 em andamento (corte c2 antes da correção) durante o procedimento.
{
  const w = base();
  w.trigger(R1, V1, V1b);
  w.anchor('a', 'R2', c2, V1b); // a varredura de R2 já passou por T (antes da correção)
  w.trigger(R1withR2, V1b, V2); // correção aplicada nas duas gerações
  w.remove(); // ordem certa: entrega aplicada, sem pendência
  // "reconstruir": a chamada retoma R2 (checkpoint com menos de 24 h); T não é relido
  report('6a. R2 retomada depois de apagar; T já varrido', w, w.proof(R2pub, V2));
}
{
  const w = base();
  w.trigger(R1, V1, V1b);
  // a página de R2 leu T = V1b (updateTime <= c2) e ainda não fez o commit
  w.trigger(R1withR2, V1b, V2); // correção: na preparada, raiz `event` com base fp(V1b)
  w.remove(); // ordem certa
  w.anchor('a', 'R2', c2, V1b); // commit da página depois da exclusão: merge recria a marca
  report('6b. commit da página de R2 depois da exclusão, R2 publicada', w, w.proof(R2pub, V2));
  w.trigger(R2pub, V2, V3);
  report('6c. próxima regravação pelo gatilho sob R2', w, w.proof(R2pub, V3));
  w.anchor('b', 'R3', c3, V3);
  w.trigger(R3pubB, V3, V4);
  report('6d. R3 publicada e regravação seguinte', w, w.proof(R3pubB, V4));
}
{
  const w = base();
  w.trigger(R1, V1, V1b);
  w.remove(); // ordem errada, com R2 em preparação e T ainda não varrido
  w.trigger(R1withR2, V1b, V2);
  report('6e. ordem errada com R2 em preparação: entrega da correção depois de apagar', w);
}
// 7. N01: preparação R2 abandonada (sem nova chamada), T varrido com V1b, edições depois.
{
  const w = base();
  w.trigger(R1, V1, V1b);
  w.anchor('a', 'R2', c2, V1b);
  w.trigger(R1withR2, V1b, V2);
  report('7a. preparação R2 abandonada, depois da correção', w, w.proof(R1, V2));
  w.trigger(R1withR2, V2, V3);
  report('7b. preparação R2 abandonada, regravação seguinte', w, w.proof(R1, V3));
  // chamada da reconstrução depois de 24 h: checkpoint novo, R2 vai para o descarte, R3 preparada em a
  w.anchor('a', 'R3', c3, V3);
  w.trigger(R1withR3, V3, V4);
  report('7c. nova chamada (R3 preparada) e regravação seguinte', w, w.proof(R1, V4));
  void R3pub;
}
for (const line of out) console.log(line);
