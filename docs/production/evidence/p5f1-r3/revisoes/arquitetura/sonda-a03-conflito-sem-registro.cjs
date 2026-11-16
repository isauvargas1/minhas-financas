// A03 — conflito da cadeia com a base (anchor_after_absent, anchor_mismatch, base_without_anchor) vira
// `broken` na VISÃO, antes do evento; applyCashPeriodWriteOnce só registra a quebra quando a visão anterior
// não era broken (`next.kind === "broken" && previous.kind !== "broken"`), então nenhum conflito liga
// `markRecoveryNeeded` nem gera o log `cash_projection_mark.broken`: só `pending_overflow` registra.
// Usa a função REAL do gatilho num Firestore em memória.
'use strict';
const { World, P, WS, B, incomeDoc } = require('./mundo.cjs');
const admin = require('firebase-admin');
const { FieldValue, Timestamp } = require('firebase-admin/firestore');

(async () => {
  const w = new World();
  // Geração publicada R1 (posição b, corte 1 s).
  const cut = Timestamp.fromMillis(1_000);
  let tx = w.store.tx();
  tx.set(admin.firestore().doc(P.state), { id: 'projection_state', workspaceId: WS, baselineCutoff: cut, baselineRebuildId: 'R1',
    lastPublishedAt: Timestamp.fromMillis(1_500), categoryGeneration: 'R1', markSlot: 'b', needsRebuild: false,
    markRecoveryNeeded: false, markIssueCount: 0 });
  // Conflitos possíveis na marca de T (cada um num lançamento).
  const conflicts = {
    T1: { anchors: { b: { g: 'R1', cut, fp: 'a'.repeat(64) } }, chains: { b: { g: 'R1', cut, root: 'absent', base: null, node: { k: 'alive', fp: 'c'.repeat(64) }, pending: [], broken: null } } },
    T2: { anchors: { b: { g: 'R1', cut, fp: 'a'.repeat(64) } }, chains: { b: { g: 'R1', cut, root: 'event', base: 'd'.repeat(64), node: { k: 'alive', fp: 'c'.repeat(64) }, pending: [], broken: null } } },
    T3: { chains: { b: { g: 'R1', cut, root: 'event', base: 'd'.repeat(64), node: { k: 'alive', fp: 'c'.repeat(64) }, pending: [], broken: null } } },
  };
  for (const [id, mark] of Object.entries(conflicts)) {
    tx.set(admin.firestore().doc(P.mark(id)), { schemaVersion: 1, workspaceId: WS, transactionId: id, ...mark });
    tx.set(admin.firestore().doc(P.tx(id)), { ...incomeDoc(10000, '2026-10-05'), updatedAt: FieldValue.serverTimestamp() });
  }
  tx.commit(2_000_000, 2_000_000);
  for (const id of Object.keys(conflicts)) {
    const before = w.store.snapshot(P.tx(id));
    const ev = w.write(id, incomeDoc(20000, '2026-10-05'), 3_000_000 + Number(id.slice(1)) * 1000);
    const out = await w.deliver(ev, 3_500_000 + Number(id.slice(1)) * 1000);
    const markAfter = w.store.snapshot(P.mark(id)).data();
    const state = w.state();
    console.log(JSON.stringify({ lancamento: id, visaoAntes: B.markViewOf(B.readMarkDoc(conflicts[id]), { id: 'R1', cutoff: cut, slot: 'b', role: 'published' }).code,
      resultado: out.outcome, markBroken: out.markBroken ?? null, cadeiaGravada: markAfter.chains.b.broken,
      markRecoveryNeeded: state.markRecoveryNeeded, markIssueCount: state.markIssueCount }));
  }
  // Controle: estouro de pendências registra.
  const id = 'T9';
  const pend = Array.from({ length: 16 }, (_, i) => ({ b: { k: 'alive', fp: String(i).padStart(64, '0') }, a: { k: 'alive', fp: String(i + 100).padStart(64, '0') } }));
  tx = w.store.tx();
  tx.set(admin.firestore().doc(P.mark(id)), { schemaVersion: 1, workspaceId: WS, transactionId: id,
    anchors: { b: { g: 'R1', cut, fp: 'a'.repeat(64) } }, chains: { b: { g: 'R1', cut, root: 'anchor', base: 'a'.repeat(64), node: { k: 'alive', fp: 'e'.repeat(64) }, pending: pend, broken: null } } });
  tx.set(admin.firestore().doc(P.tx(id)), { ...incomeDoc(10000, '2026-10-05'), updatedAt: FieldValue.serverTimestamp() });
  tx.commit(4_000_000, 4_000_000);
  const ev = w.write(id, incomeDoc(20000, '2026-10-05'), 4_100_000);
  const out = await w.deliver(ev, 4_200_000);
  console.log(JSON.stringify({ lancamento: id, controle: 'pending_overflow', markBroken: out.markBroken ?? null, markRecoveryNeeded: w.state().markRecoveryNeeded }));
})().catch((e) => { console.error(e); process.exit(2); });
