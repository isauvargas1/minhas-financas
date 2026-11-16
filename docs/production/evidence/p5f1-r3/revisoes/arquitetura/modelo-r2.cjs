// Verificação aleatória da solidez da prova (P5-F.1-R3, B03) com as funções REAIS do gatilho, das marcas,
// da impressão digital e da prova do cliente, num Firestore em memória (memfs.cjs). Sem Emulator e sem rede.
//
// Cada cenário: um lançamento estável U e um lançamento T com história aleatória (criação, alterações de valor,
// mês, liquidação e anulação; exclusão física e recriação com o mesmo id, raras), entregas do gatilho com
// atraso aleatório, fora de ordem e repetidas; reconstrução em instante aleatório (checkpoint, leitura da página
// fora da transação, commit da página e publicação separados, com recomeços); leituras do cliente (por id e,
// depois, a transação de leitura) em instantes aleatórios.
//
// Propriedade: prova verdadeira => o que a estimativa tira de cada mês é exatamente a parte de T na projeção
// lida. Uso: node modelo-aleatorio.cjs <cenários> <janela_ms> [semente] [correcao]
//   janela_ms = 0: corte igual ao commit do checkpoint (o que a cerca supõe);
//   janela_ms > 0: o commit do checkpoint acontece até janela_ms depois do serverTimestamp do corte.
//   correcao = 'publicacao' ou 'cliente' liga a correção sugerida correspondente.
'use strict';
const { World, incomeDoc } = require('./mundo.cjs');

const N = Number(process.argv[2] ?? 2000);
const WINDOW_MS = Number(process.argv[3] ?? 0);
let seed = Number(process.argv[4] ?? 20261109);
const FIX = process.argv[5] ?? '';
const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (xs) => xs[int(0, xs.length - 1)];

const MONTHS = ['2026-10', '2026-11'];
const STATIC = { '2026-10': 100000, '2026-11': 0 };
const randomContent = () => incomeDoc(int(1, 9) * 10000, pick(['2026-10-10', '2026-11-12']),
  rnd() < 0.15 ? { isPaid: false } : rnd() < 0.1 ? { voidedAt: { __void: true } } : {});

const scenario = async (index) => {
  const w = new World();
  const ops = [];
  let counter = 0;
  const at = (t, kind, data) => ops.push({ t, kind, data, order: counter++ });
  // U estável, aplicado antes de tudo.
  const u = w.write('U', incomeDoc(STATIC['2026-10'], '2026-10-03'), 1_000_000);
  await w.deliver(u, 1_010_000);
  // História de T.
  let t = 1_100_000;
  let exists = false;
  const steps = int(1, 6);
  for (let i = 0; i < steps; i += 1) {
    t += int(1, 40) * 1000 + int(0, 999);
    if (!exists) { at(t, 'write', randomContent()); exists = true; continue; }
    if (rnd() < 0.08) { at(t, 'write', null); exists = false; continue; } // exclusão física (só Admin SDK)
    at(t, 'write', randomContent());
  }
  const lastWrite = t;
  // Reconstrução.
  const rebuild = rnd() < 0.8;
  if (rebuild) at(int(1_090_000, lastWrite + 60_000), 'checkpoint', { attempt: 1 });
  // Leituras do cliente: por id em x, transação em y >= x.
  for (let k = 0; k < 6; k += 1) {
    const y = int(1_100_000, lastWrite + 900_000);
    at(Math.max(1_100_000, y - int(0, 80_000)), 'byid', { k });
    at(y, 'prove', { k });
  }
  at(5_000_000, 'prove-final', {});
  const reads = {};
  const results = { violations: [], proofs: 0, refusals: {}, final: null, publications: 0, restarts: 0 };
  const writeAt = new Map();
  ops.sort((a, b) => a.t - b.t || a.order - b.order);
  for (let i = 0; i < ops.length; i += 1) {
    const op = ops[i];
    const insert = (time, kind, data) => {
      const o = { t: time, kind, data, order: counter++ };
      let j = i + 1; while (j < ops.length && (ops[j].t < o.t || (ops[j].t === o.t && ops[j].order <= o.order))) j += 1;
      ops.splice(j, 0, o);
    };
    switch (op.kind) {
      case 'write': {
        const data = op.data === null ? null : { ...op.data };
        if (data && data.voidedAt) data.voidedAt = require('firebase-admin/firestore').Timestamp.fromMillis(1_790_000_000_000);
        const ev = w.write('T', data, op.t);
        writeAt.set(ev.eventId, op.t);
        // Entrega com atraso aleatório; às vezes repetida. Na janela do checkpoint, o gatilho pode vir logo.
        insert(op.t + int(500, 120_000), 'deliver', ev);
        if (rnd() < 0.15) insert(op.t + int(500, 240_000), 'deliver', ev);
        break;
      }
      case 'deliver': await w.deliver(op.data, op.t); break;
      case 'checkpoint': {
        if (op.data.attempt > 4) break;
        const gap = WINDOW_MS > 0 ? int(1, WINDOW_MS) * 1000 : 0;
        // Pedido em op.t (serverTimestamp); commit em op.t + gap. Escritas e entregas com instante no meio
        // acontecem antes do commit (o commit espera a trava de projection_state).
        insert(op.t + gap, 'checkpoint-commit', { attempt: op.data.attempt, requestUs: op.t });
        break;
      }
      case 'checkpoint-commit': {
        w.checkpoint(op.data.requestUs, op.t, op.data.attempt - 1);
        insert(op.t + int(1_000, 60_000), 'page-read', { attempt: op.data.attempt });
        break;
      }
      case 'page-read': {
        const page = w.readPage(op.t);
        if (page.restart) { results.restarts += 1; insert(op.t + 1_000, 'checkpoint', { attempt: op.data.attempt + 1 }); break; }
        insert(op.t + int(0, 60_000), 'page-commit', { attempt: op.data.attempt, page });
        break;
      }
      case 'page-commit': {
        if (!w.commitPage(op.data.page, op.t)) break;
        insert(op.t + int(1_000, 90_000), 'publish', { attempt: op.data.attempt });
        break;
      }
      case 'publish': {
        const r = w.publish(op.t, op.t, { checkStaging: FIX === 'publicacao' || FIX === 'ambas' });
        if (r.kind === 'published') results.publications += 1;
        else if (r.kind === 'restart') { results.restarts += 1; insert(op.t + 1_000, 'checkpoint', { attempt: op.data.attempt + 1 }); }
        break;
      }
      case 'byid': reads[op.data.k] = await w.readById(['T']); break;
      case 'prove':
      case 'prove-final': {
        // O relatório oficial não é exato com needsRebuild (functions/src/reports/report.ts): a estimativa fica
        // indisponível, sem conversão. A prova só importa fora disso.
        if (w.state().needsRebuild) {
          results.refusals.indisponivel_needsRebuild = (results.refusals.indisponivel_needsRebuild ?? 0) + 1;
          if (op.kind === 'prove-final') results.final = 'indisponivel_needsRebuild';
          break;
        }
        const byId = op.kind === 'prove-final' ? await w.readById(['T']) : reads[op.data.k];
        const res = await w.prove(MONTHS, ['T'], null, byId);
        let proven = res.proof.proven;
        if (proven && (FIX === 'cliente' || FIX === 'ambas')) {
          for (const [id, applied] of Object.entries(res.proof.applied)) if (applied.document === null && res.read[id]) proven = false;
        }
        const reason = proven ? 'provada' : res.proof.proven ? 'defesa_cliente' : res.proof.reason;
        results.refusals[reason] = (results.refusals[reason] ?? 0) + 1;
        if (op.kind === 'prove-final') results.final = reason;
        if (!proven) break;
        results.proofs += 1;
        for (const m of MONTHS) {
          const seen = res.snapshot.months[m];
          const part = (seen.exists ? seen.incomeCents : 0) - STATIC[m];
          if (part !== res.subtracted[m]) {
            results.violations.push({ month: m, partOfT: part, subtracted: res.subtracted[m], at: op.t });
          }
        }
        break;
      }
      default: throw new Error(op.kind);
    }
  }
  return { results, trace: w.trace, physicalDelete: w.trace.some((l) => l.includes('excluída')), pruneLosses: w.pruneLosses, pruned: w.prunedCount ?? 0 };
};

(async () => {
  const summary = { perdasDePoda: 0, cenarios: N, janelaMs: WINDOW_MS, correcao: FIX || 'nenhuma', violacoes: 0, cenariosComViolacao: 0,
    provas: 0, publicacoes: 0, recomecos: 0, motivos: {}, finalSemProva: {}, finalSemProvaSemExclusaoFisica: {} };
  let shown = 0;
  for (let i = 0; i < N; i += 1) {
    const { results, trace, physicalDelete, pruneLosses, pruned } = await scenario(i);
    summary.podas = (summary.podas ?? 0) + pruned;
    summary.perdasDePoda = (summary.perdasDePoda ?? 0) + pruneLosses.length;
    if (pruneLosses.length > 0 && !summary.primeiraPerda) summary.primeiraPerda = { cenario: i, perda: pruneLosses[0], rastro: trace };
    summary.provas += results.proofs;
    summary.publicacoes += results.publications;
    summary.recomecos += results.restarts;
    for (const [k, v] of Object.entries(results.refusals)) summary.motivos[k] = (summary.motivos[k] ?? 0) + v;
    if (results.final !== 'provada') {
      summary.finalSemProva[results.final] = (summary.finalSemProva[results.final] ?? 0) + 1;
      if (!physicalDelete) summary.finalSemProvaSemExclusaoFisica[results.final] = (summary.finalSemProvaSemExclusaoFisica[results.final] ?? 0) + 1;
    }
    if (results.violations.length > 0) {
      summary.violacoes += results.violations.length;
      summary.cenariosComViolacao += 1;
      if (shown < 1) {
        shown += 1;
        console.log(`--- contraexemplo (cenário ${i}):`, JSON.stringify(results.violations[0]));
        for (const line of trace) console.log('   ', line);
      }
    }
  }
  console.log(JSON.stringify(summary, null, 1));
})().catch((e) => { console.error(e); process.exit(2); });
