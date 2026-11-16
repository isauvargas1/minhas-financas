/*
 * Sonda de privacidade P5-F.1-R3, rodada 2 — poda (L-PRI-02) e o requisito da P8 (M-PRI-01, §6.4).
 *
 * Usa as funções puras compiladas da árvore congelada 377c2f3f (cópia própria do revisor, fora do worktree):
 * o mesmo laço de `applyCashPeriodWriteOnce` (markGenerationsFor → markViewOf → applyMarkEvent → markChainOf),
 * agora com `pruneMarkDoc` antes de `markDocumentData` (set sem merge), e a âncora da varredura com merge.
 * Nenhum Firestore, nenhum Emulator.
 *
 * Cenários (V1 = conteúdo com o dado a eliminar; V2 = conteúdo corrigido ou anonimizado):
 *  1. poda na regravação seguinte à publicação: a geração superada sai.
 *  2. "duas reconstruções seguidas" depois da correção, sem apagar a marca: sobra fp(V1)?
 *  3. requisito da P8 na ordem certa: o gatilho aplica V1 → V2, depois apaga-se a marca e reconstrói-se.
 *  4. requisito da P8 na ordem errada: apaga-se a marca ANTES de o gatilho aplicar V1 → V2.
 *
 * Uso: NODE_PATH=<wt>/functions/node_modules node sonda-r2-poda-e-p8.cjs <cópia>/functions/lib
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
const created = ts(1_790_000_000, 123_456);
const V1 = {
  type: 'despesa', description: 'Sessão de terapia com Dra. Ana Exemplo', category: 'Saúde', categoryId: 'cat_saude',
  valueCents: 25_000, date: '2026-10-05', isPaid: true, cashAccountId: 'acc_1', workspaceId: WS, profileId: WS,
  profileType: 'PF', userId: 'uid-owner', createdBy: 'uid-owner', updatedBy: 'uid-owner', createdAt: created,
  updatedAt: created, cashEntry: {domainVersion: 1, origin: 'manual', status: 'confirmed', currency: 'BRL',
    requestHash: 'f'.repeat(64), quotaPeriod: '2026-10', accountMovementId: 'mv_apply_1'},
};
const V2 = {...V1, description: 'Despesa pessoal', category: 'Outros', categoryId: 'cat_outros',
  updatedAt: ts(1_790_100_000, 654_321), cashEntry: {...V1.cashEntry, revision: 2, accountMovementId: 'mv_apply_2'}};
const V3 = {...V2, valueCents: 26_000, updatedAt: ts(1_790_400_000, 111_111),
  cashEntry: {...V2.cashEntry, revision: 3, accountMovementId: 'mv_apply_3'}};
const FP1 = marks.transactionFingerprint(V1);

const state = (over) => ({categoryGeneration: 'g0', baselineCutoff: null, markSlot: 'a', categoryStaging: null, ...over});

const run = () => {
  let stored; // documento da marca "no Firestore"
  const trigger = (st, before, after, eventTime) => {
    const event = marks.markEventOf(before, after, before ? before.updatedAt : null);
    const doc = marks.readMarkDoc(stored);
    for (const generation of periods.markGenerationsFor(st, eventTime)) {
      const next = marks.applyMarkEvent(marks.markViewOf(doc, generation), event, generation);
      doc.chains[generation.slot] = marks.markChainOf(next, generation);
    }
    const live = st.categoryStaging ? [st.categoryGeneration, st.categoryStaging.generation] : [st.categoryGeneration];
    stored = marks.markDocumentData(WS, ID, marks.pruneMarkDoc(doc, live)); // periods.ts:1402-1406
  };
  const anchor = (slot, g, cut, content) => { // rebuild.ts: set com merge da posição
    const patch = marks.markAnchorPatch(WS, ID, slot, {g, cut, fp: marks.transactionFingerprint(content)});
    stored = {...(stored ?? {}), ...patch, anchors: {...(stored?.anchors ?? {}), ...patch.anchors}};
  };
  const remove = () => { stored = undefined; };
  const hasFp1 = () => JSON.stringify(stored ?? {}).includes(FP1);
  const where = () => {
    const found = [];
    const walk = (value, at) => {
      if (value === FP1) found.push(at);
      else if (value && typeof value === 'object' && !(value instanceof Timestamp)) {
        for (const [k, v] of Object.entries(value)) walk(v, at ? `${at}.${k}` : k);
      }
    };
    walk({anchors: stored?.anchors, chains: stored?.chains}, '');
    return found;
  };
  const view = (st) => marks.markViewOf(marks.readMarkDoc(stored),
    {id: st.categoryGeneration, cutoff: st.baselineCutoff, slot: st.markSlot, role: 'published'});
  return {trigger, anchor, remove, hasFp1, where, view};
};

// Linha de base comum: criação V1 na g0 e reconstrução R1 publicada (âncora de V1 em b).
const c1 = ts(1_790_050_000);
const R1 = state({categoryGeneration: 'R1', baselineCutoff: c1, markSlot: 'b'});
const base = () => {
  const m = run();
  m.trigger(state(), undefined, V1, ts(1_790_000_000, 200_000));
  m.anchor('b', 'R1', c1, V1);
  return m;
};
const out = [];
const report = (title, m, extra = '') => {
  out.push(`${title}: fp(V1) ${m.hasFp1() ? `PRESENTE em ${m.where().join(', ')}` : 'ausente'}${extra}`);
};

// 1. Poda na regravação seguinte à publicação de R1.
{
  const m = base();
  report('1a. depois da publicação de R1, antes de qualquer regravação', m);
  m.trigger(R1, V1, V2, ts(1_790_100_000, 900_000));
  report('1b. correção V1 → V2 aplicada pelo gatilho (poda da g0)', m,
    ` | visão R1: ${JSON.stringify(m.view(R1).node)}`);
}
// 2. Duas reconstruções seguidas depois da correção, sem apagar a marca e sem novo evento.
{
  const m = base();
  m.trigger(R1, V1, V2, ts(1_790_100_000, 900_000));
  const c2 = ts(1_790_200_000);
  m.anchor('a', 'R2', c2, V2); // varredura de R2 na posição preparada (a)
  const R2 = state({categoryGeneration: 'R2', baselineCutoff: c2, markSlot: 'a'});
  report('2a. depois de R2 publicada', m);
  const c3 = ts(1_790_300_000);
  m.anchor('b', 'R3', c3, V2); // varredura de R3 na posição b (sobrescreve só a âncora)
  const R3 = state({categoryGeneration: 'R3', baselineCutoff: c3, markSlot: 'b'});
  report('2b. depois de R3 publicada (duas reconstruções seguidas)', m,
    ` | visão R3: ${JSON.stringify(m.view(R3).node)}`);
  m.trigger(R3, V2, V3, ts(1_790_400_000, 500_000));
  report('2c. depois da próxima regravação pelo gatilho', m);
  void R2;
}
// 3. Requisito da P8, ordem certa: o gatilho aplica V1 → V2; depois apagar a marca e reconstruir.
{
  const m = base();
  m.trigger(R1, V1, V2, ts(1_790_100_000, 900_000));
  m.remove();
  const c2 = ts(1_790_200_000);
  m.anchor('a', 'R2', c2, V2);
  const R2 = state({categoryGeneration: 'R2', baselineCutoff: c2, markSlot: 'a'});
  report('3. ordem certa (aplicar, apagar, reconstruir)', m, ` | visão R2: ${JSON.stringify(m.view(R2).node)}`);
}
// 4. Requisito da P8, ordem errada: apagar a marca antes de o gatilho aplicar V1 → V2, depois reconstruir.
{
  const m = base();
  m.remove();
  m.trigger(R1, V1, V2, ts(1_790_100_000, 900_000)); // entrega depois da exclusão da marca
  report('4a. ordem errada: entrega da correção depois de apagar a marca', m,
    ` | visão R1: ${JSON.stringify(m.view(R1))}`);
  const c2 = ts(1_790_200_000);
  m.anchor('a', 'R2', c2, V2);
  const R2 = state({categoryGeneration: 'R2', baselineCutoff: c2, markSlot: 'a'});
  report('4b. ordem errada, depois da reconstrução R2 publicada', m, ` | visão R2: ${JSON.stringify(m.view(R2).node)}`);
}
for (const line of out) console.log(line);
