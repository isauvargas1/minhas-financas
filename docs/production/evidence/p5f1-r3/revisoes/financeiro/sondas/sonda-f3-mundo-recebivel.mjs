// Sonda F3 (revisão financeira P5-F.1-R3): modelo aleatório de ponta a ponta com as funções REAIS do backend
// compilado (plano de caixa, marcas, gerações) e do cliente (normalização, impressão digital, prova, item
// desconsiderado, aplicação das exclusões). Foco no que a revisão de arquitetura não modelou:
//   - par recebimento (espelho `recvcash_`) + estorno (id determinístico), ambos imutáveis;
//   - várias desconsideradas no mesmo mês, com uma receita comum editada (valor, mês, pendente, anulação);
//   - leitura por id ANTES da transação de leitura (a ordem do hook), em instante sorteado;
//   - janela do Emulator: o corte (`serverTimestamp`) resolve antes do commit do checkpoint;
//   - varredura em páginas (leitura fora da transação, commit depois) e publicação com a cerca real.
// Oráculo independente das marcas: a parte de cada lançamento na projeção, somada por entrega aplicada e
// recalculada na publicação. Propriedade: prova verdadeira ⇒ receita elegível de cada mês da janela =
// projeção lida − (parte da desconsiderada + parte do estorno dela).
// Uso: node --experimental-strip-types sonda-f3-mundo-recebivel.mjs <WT> <cenários> <semente> [sem-a01] [aba] [poda]
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const [WT, COUNT = '3000', SEED = '1', ...flags] = process.argv.slice(2);
const WITHOUT_A01 = flags.includes('sem-a01');
const ABA = flags.includes('aba');
const PRUNE = flags.includes('poda');
const require = createRequire(`${WT}/functions/package.json`);
const { Timestamp } = require('firebase-admin/firestore');
const periods = require(`${WT}/functions/lib/cash/periods.js`);
const marks = require(`${WT}/functions/lib/cash/projectionMarks.js`);
const imp = (p) => import(pathToFileURL(`${WT}/${p}`).href);
const proof = await imp('src/modules/work-time/projectionProof.ts');
const basis = await imp('src/modules/work-time/incomeBasis.ts');
const contract = await imp('src/modules/transactions/contract.ts');
const reversalIds = await imp('src/modules/work-time/receivableReversal.ts');

let seed = Number(SEED) >>> 0;
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (items) => items[Math.floor(random() * items.length)];
const cmp = (a, b) => a.seconds - b.seconds || a.nanoseconds - b.nanoseconds;
const MONTHS = ['2026-07', '2026-08', '2026-09'];

const stats = { scenarios: 0, snapshots: 0, proven: 0, violations: 0, publications: 0, restarts: 0, a01Restarts: 0, refused: {} };
const examples = [];

const runScenario = async (scenario) => {
  let clock = 1000;
  const tick = () => Timestamp.fromMillis((clock += 1) * 1000);
  // Ledger: id → {data, createTime, updateTime}
  const ledger = new Map();
  const writes = [];
  const undelivered = [];
  // Projeção: mês → {incomeCents, tag}; parte de cada id por mês (oráculo).
  const months = new Map();
  const part = new Map();
  const markDocs = new Map();
  const markers = new Map();
  const state = {
    baselineCutoff: null, baselineRebuildId: null, lastPublishedAt: null, needsRebuild: false, issueCount: 0,
    issueMaxEventTime: null, categoryGeneration: 'g0', categoryStaging: null, categoryGarbage: [], markSlot: 'a',
    markRecoveryNeeded: false, markIssueCount: 0, markIssueMaxEventTime: null,
  };
  let rebuild = null; // {phase, rid, cut, slot, base: Map(month→income), baseParts, cursor, pageRead}
  let rebuildSeq = 0;

  const addPart = (id, month, value) => {
    const byMonth = part.get(id) ?? new Map();
    byMonth.set(month, (byMonth.get(month) ?? 0) + value);
    part.set(id, byMonth);
  };

  // Lançamentos: U receita comum (editável), W receita estável, T recebimento, R estorno de T.
  const T = `recvcash_${'1'.repeat(40)}`;
  const movement = reversalIds.receiptMovementIdOfMirror(T);
  const R = await reversalIds.reversalMirrorIdOf(T);
  const reversalMovement = `rmv_${R.slice('recvcash_'.length)}`;
  const principal = pick([10_000, 25_000]);
  const tMonth = pick(MONTHS);
  const receiptEntry = (reversal) => ({
    domainVersion: 1, receivableId: 'rcv_1', receivableMovementId: reversal ? reversalMovement : movement, clientId: 'cli_1',
    kind: 'receipt', reversal, principalCents: principal, interestCents: 500, penaltyCents: 0, discountCents: 0, currency: 'BRL',
    ...(reversal ? { reversalOf: movement } : {}),
  });
  const contentT = { type: 'receita', valueCents: principal + 500, date: `${tMonth}-10`, isPaid: true, receivableEntry: receiptEntry(false), description: 'recebimento' };
  const contentR = { type: 'despesa', valueCents: principal + 500, date: `${tMonth}-10`, isPaid: true, receivableEntry: receiptEntry(true), description: 'estorno' };
  const incomeContent = (t) => {
    const base = { type: 'receita', valueCents: pick([1_000, 2_000, 7_000]), date: `${pick(MONTHS)}-0${pick([1, 5, 9])}`, description: 'receita' };
    const kind = random();
    if (kind < 0.15) base.isPaid = false;
    else if (kind < 0.25) { base.isPaid = true; base.voidedAt = Timestamp.fromMillis(5); }
    else base.isPaid = true;
    if (!ABA) base.updatedAt = t;
    return base;
  };

  const doWrite = (id, after) => {
    const t = tick();
    const current = ledger.get(id);
    const before = current?.data;
    const write = {
      id: writes.length, txId: id, t, before, after,
      beforeUpdateTime: current ? current.updateTime : null,
      beforeCreateTime: current ? current.createTime : null,
    };
    if (after === undefined) ledger.delete(id);
    else ledger.set(id, { data: after, createTime: current ? current.createTime : t, updateTime: t });
    writes.push(write);
    undelivered.push(write);
  };

  const writeAction = () => {
    const roll = random();
    if (!ledger.has('W')) return doWrite('W', { type: 'receita', valueCents: 50_000, date: `${pick(MONTHS)}-02`, isPaid: true, description: 'fixa' });
    if (!ledger.has(T) && !writes.some((w) => w.txId === T)) return doWrite(T, contentT);
    if (roll < 0.15 && writes.some((w) => w.txId === T) && !writes.some((w) => w.txId === R)) return doWrite(R, contentR);
    if (roll < 0.9 || !ledger.has('U')) return doWrite('U', incomeContent(Timestamp.fromMillis((clock + 1) * 1000)));
    // Exclusão física (só Admin SDK), rara.
    if (ledger.has('U')) return doWrite('U', undefined);
    return undefined;
  };

  // ------------------------------------------------------------- gatilho (applyCashPeriodWriteOnce)
  const deliver = (write) => {
    if (markers.has(write.id)) return; // duplicate
    const action = !write.before ? 'CREATE' : !write.after ? 'DELETE' : 'UPDATE';
    const markerBase = { eventTime: write.t, action, txId: write.txId, beforeCreateTime: write.beforeCreateTime };
    const cutoff = state.baselineCutoff;
    if (cutoff && cmp(write.t, cutoff) <= 0) {
      markers.set(write.id, { ...markerBase, outcome: 'covered_by_rebuild' });
      return;
    }
    if (action === 'DELETE' && cutoff && state.lastPublishedAt && cmp(write.t, state.lastPublishedAt) < 0 &&
      (!write.beforeCreateTime || cmp(write.beforeCreateTime, cutoff) <= 0)) {
      markers.set(write.id, { ...markerBase, outcome: 'ambiguous_delete' });
      state.needsRebuild = true;
      return;
    }
    const plan = periods.cashWritePlanFor(write.before, write.after);
    const categoryGenerations = periods.categoryGenerationsFor(state, write.t);
    const event = marks.markEventOf(write.before, write.after, write.beforeUpdateTime);
    const raw = markDocs.get(write.txId);
    const doc = marks.readMarkDoc(raw);
    for (const generation of periods.markGenerationsFor(state, write.t)) {
      const next = marks.applyMarkEvent(marks.markViewOf(doc, generation), event, generation);
      doc.chains[generation.slot] = marks.markChainOf(next, generation);
    }
    // `periods.ts` (19:21): a marca regravada só guarda a geração vigente e a preparada (`pruneMarkDoc`).
    const live = state.categoryStaging ? [state.categoryGeneration, state.categoryStaging.generation] : [state.categoryGeneration];
    const kept = PRUNE ? marks.pruneMarkDoc(doc, live) : doc;
    markDocs.set(write.txId, { anchors: { ...kept.anchors }, chains: { ...kept.chains } });
    const tag = { id: state.categoryGeneration, cutoff: state.baselineCutoff };
    const deltas = {};
    for (const period of periods.cashPlanPeriods(plan)) {
      const income = plan.months[period]?.incomeCents ?? 0;
      const month = months.get(period) ?? { incomeCents: 0, tag };
      month.incomeCents += income;
      month.tag = tag;
      months.set(period, month);
      if (income !== 0) addPart(write.txId, period, income);
      deltas[period] = income;
    }
    markers.set(write.id, { ...markerBase, outcome: 'applied', deltas, categoryGenerations });
  };

  // ------------------------------------------------------------- reconstrução
  const startCheckpoint = () => {
    rebuildSeq += 1;
    // O corte resolve agora; o commit (e a preparação visível) vem depois: a janela do Emulator.
    rebuild = { phase: 'resolved', rid: `r${scenario}_${rebuildSeq}`, cut: tick(), slot: marks.otherMarkSlot(state.markSlot) };
  };
  const restart = (reason) => {
    stats.restarts += 1;
    if (reason === 'post_cutoff_event_missed_staging') stats.a01Restarts += 1;
    startCheckpoint();
  };
  const rebuildStep = () => {
    if (!rebuild) return startCheckpoint();
    if (rebuild.phase === 'resolved') {
      state.categoryStaging = { generation: rebuild.rid, cutoff: rebuild.cut };
      rebuild.phase = 'scanning';
      rebuild.cursor = 0;
      rebuild.base = new Map();
      rebuild.baseParts = new Map();
      return undefined;
    }
    if (rebuild.phase === 'scanning') {
      const ids = [...ledger.keys()].sort();
      if (!rebuild.pageRead) {
        const size = pick([1, 2, 4]);
        const slice = ids.filter((id) => id > (rebuild.lastId ?? '')).slice(0, size);
        rebuild.pageRead = slice.map((id) => ({ id, ...ledger.get(id) }));
        rebuild.pageDone = slice.length < size;
        return undefined;
      }
      // `processPage`: um documento mudado depois do corte (e criado antes) recomeça sem gravar nada da página.
      if (rebuild.pageRead.some((entry) => cmp(entry.createTime, rebuild.cut) <= 0 && cmp(entry.updateTime, rebuild.cut) > 0)) {
        return restart('ledger_changed_during_rebuild');
      }
      // Commit da página: âncora sem ler a marca, base no corte.
      for (const entry of rebuild.pageRead) {
        if (cmp(entry.createTime, rebuild.cut) > 0) { rebuild.lastId = entry.id; continue; }
        const plan = periods.cashWritePlanFor(undefined, entry.data);
        for (const [period, delta] of Object.entries(plan.months)) {
          rebuild.base.set(period, (rebuild.base.get(period) ?? 0) + delta.incomeCents);
          const byMonth = rebuild.baseParts.get(entry.id) ?? new Map();
          byMonth.set(period, (byMonth.get(period) ?? 0) + delta.incomeCents);
          rebuild.baseParts.set(entry.id, byMonth);
        }
        for (const period of Object.keys(plan.days)) if (!rebuild.base.has(period)) rebuild.base.set(period, 0);
        const raw = markDocs.get(entry.id) ?? { anchors: {}, chains: {} };
        raw.anchors = { ...raw.anchors, [rebuild.slot]: { g: rebuild.rid, cut: rebuild.cut, fp: marks.transactionFingerprint(entry.data) } };
        markDocs.set(entry.id, raw);
        rebuild.lastId = entry.id;
      }
      if (rebuild.pageRead.length > 0) rebuild.lastId = rebuild.pageRead[rebuild.pageRead.length - 1].id;
      const done = rebuild.pageDone;
      rebuild.pageRead = null;
      if (done) rebuild.phase = 'publish';
      return undefined;
    }
    // Publicação (transação): cerca das entregas posteriores ao corte.
    const post = [...markers.values()].filter((m) => cmp(m.eventTime, rebuild.cut) > 0);
    if (post.length > 200) return restart('too_many_concurrent_changes');
    const postParts = new Map();
    const totals = new Map(rebuild.base);
    for (const m of post) {
      if (m.action === 'DELETE' && (!m.beforeCreateTime || cmp(m.beforeCreateTime, rebuild.cut) <= 0)) return restart('delete_during_rebuild');
      if (m.outcome !== 'applied') continue;
      if (!WITHOUT_A01 && !m.categoryGenerations.includes(rebuild.rid)) return restart('post_cutoff_event_missed_staging');
      for (const [period, income] of Object.entries(m.deltas)) {
        totals.set(period, (totals.get(period) ?? 0) + income);
        const byMonth = postParts.get(m.txId) ?? new Map();
        byMonth.set(period, (byMonth.get(period) ?? 0) + income);
        postParts.set(m.txId, byMonth);
      }
    }
    const tag = { id: rebuild.rid, cutoff: rebuild.cut };
    for (const period of new Set([...months.keys(), ...totals.keys()])) months.set(period, { incomeCents: totals.get(period) ?? 0, tag });
    part.clear();
    for (const source of [rebuild.baseParts, postParts]) {
      for (const [id, byMonth] of source) for (const [period, value] of byMonth) addPart(id, period, value);
    }
    Object.assign(state, {
      baselineCutoff: rebuild.cut, baselineRebuildId: rebuild.rid, lastPublishedAt: tick(), categoryGeneration: rebuild.rid,
      categoryStaging: null, markSlot: rebuild.slot,
    });
    stats.publications += 1;
    rebuild = null;
    return undefined;
  };

  // ------------------------------------------------------------- cliente
  const excluded = ['U', T];
  let byIdRead = null; // {found, missing, raw}
  const readById = () => {
    const ids = [...new Set([...excluded, R])];
    const found = [];
    const raw = {};
    for (const id of ids) {
      const entry = ledger.get(id);
      if (!entry) continue;
      const normalized = contract.normalizeTransactionData(id, entry.data, 'ws');
      if (!normalized) continue;
      found.push(normalized);
      raw[id] = entry.data;
    }
    byIdRead = { found, missing: ids.filter((id) => !found.some((doc) => doc.id === id)), raw };
  };
  const snapshotCheck = async (label) => {
    if (byIdRead === null) return;
    stats.snapshots += 1;
    // Conferência do próprio oráculo: a projeção é a soma das partes.
    for (const month of MONTHS) {
      let sum = 0;
      for (const byMonth of part.values()) sum += byMonth.get(month) ?? 0;
      if (sum !== (months.get(month)?.incomeCents ?? 0)) throw new Error(`oráculo incoerente em ${month} (cenário ${scenario})`);
    }
    // A transação de leitura: meses da janela e marcas, no mesmo instante.
    const snapshot = { months: {}, marks: {} };
    for (const month of MONTHS) {
      const doc = months.get(month);
      snapshot.months[month] = { exists: doc !== undefined, incomeCents: doc?.incomeCents ?? 0, generation: doc ? proof.generationOf(doc.tag) : null };
    }
    for (const id of [...excluded, R]) snapshot.marks[id] = markDocs.get(id) ?? null;
    // Bases = a projeção lida (a regra das bases passa); o oráculo é a parte real no mesmo instante.
    const basisIncome = Object.fromEntries(MONTHS.map((m) => [m, months.get(m)?.incomeCents ?? 0]));
    // Leitura por id (feita antes): impressão do conteúdo bruto, como `readExcludedIncome`.
    const read = {};
    const fingerprints = {};
    for (const doc of byIdRead.found) fingerprints[doc.id] = await proof.transactionFingerprint(byIdRead.raw[doc.id]);
    const found = byIdRead.found.filter((doc) => excluded.includes(doc.id));
    const reversals = {};
    const reversalDoc = byIdRead.found.find((doc) => doc.id === R);
    if (reversalDoc) reversals[T] = reversalDoc;
    for (const doc of [...found, ...Object.values(reversals)]) read[doc.id] = { document: doc, fingerprint: fingerprints[doc.id] ?? null };
    const result = proof.proveProjectionExclusions({
      months: MONTHS, snapshot, basisIncome, excludedIds: excluded, read, reversalIds: { [T]: R },
    });
    if (!result.proven) {
      stats.refused[result.reason] = (stats.refused[result.reason] ?? 0) + 1;
      return;
    }
    const items = Object.entries(result.applied).map(([id, applied]) => (applied.document === null
      ? { id, month: null, classification: null }
      : basis.excludedItemOf(applied.document, applied.reversal)));
    if (items.some((item) => item.unconfirmed && item.month !== null && MONTHS.includes(item.month))) {
      stats.refused.unconfirmed = (stats.refused.unconfirmed ?? 0) + 1;
      return;
    }
    stats.proven += 1;
    const receipts = MONTHS.map((month) => ({ month, receiptsCents: basisIncome[month], partial: false }));
    const outcome = basis.applyIncomeExclusions(receipts, items);
    for (const month of outcome.months) {
      const expected = basisIncome[month.month] - (part.get('U')?.get(month.month) ?? 0) -
        (part.get(T)?.get(month.month) ?? 0) - (part.get(R)?.get(month.month) ?? 0);
      if (month.eligibleCents !== expected) {
        stats.violations += 1;
        if (examples.length < 6) {
          examples.push({ scenario, label, month: month.month, shown: month.eligibleCents, expected, skipped: month.exclusionsSkipped,
            parts: Object.fromEntries([...part].map(([id, m]) => [id.slice(0, 12), Object.fromEntries(m)])), basisIncome,
            ledger: Object.fromEntries([...ledger].map(([id, e]) => [id.slice(0, 12), e.data.receivableEntry ? 'mirror' : `${e.data.valueCents}@${e.data.date}${e.data.voidedAt ? ' anulada' : ''}${e.data.isPaid === false ? ' pendente' : ''}`])) });
        }
        return;
      }
    }
  };

  const steps = 10 + Math.floor(random() * 40);
  for (let step = 0; step < steps; step += 1) {
    const roll = random();
    if (roll < 0.3 && writes.length < 14) writeAction();
    else if (roll < 0.7 && writes.length > 0) {
      const write = undelivered.length > 0 && random() < 0.85
        ? undelivered.splice(Math.floor(random() * undelivered.length), 1)[0]
        : pick(writes);
      deliver(write);
    } else if (roll < 0.82) {
      if (rebuild || rebuildSeq < 3) rebuildStep();
    } else if (roll < 0.9) readById();
    else await snapshotCheck(`passo ${step}`);
  }
  while (undelivered.length > 0) {
    deliver(undelivered.splice(Math.floor(random() * undelivered.length), 1)[0]);
    if (random() < 0.3) readById();
    await snapshotCheck('entrega final');
  }
  let guard = 0;
  while (rebuild && guard++ < 30) rebuildStep();
  readById();
  await snapshotCheck('fim');
  stats.scenarios += 1;
};

for (let i = 0; i < Number(COUNT); i += 1) await runScenario(i);
console.log(JSON.stringify({ variant: { WITHOUT_A01, ABA, PRUNE }, ...stats }));
for (const example of examples) console.log(JSON.stringify(example));
