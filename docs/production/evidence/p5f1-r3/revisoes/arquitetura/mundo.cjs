// Mundo simulado: ledger, gatilho (função REAL applyCashPeriodWriteOnce), reconstrução (passos de
// functions/src/cash/rebuild.ts reproduzidos linha a linha, com as funções REAIS de marcas e impressão
// digital) e a prova do cliente (função REAL proveProjectionExclusions). Sem Emulator e sem rede.
'use strict';
const path = require('node:path');
const admin = require('firebase-admin');
if (admin.apps.length === 0) admin.initializeApp({ projectId: 'sonda-pura-sem-rede' });
const { FieldValue, Timestamp } = require('firebase-admin/firestore');
const B = require(process.env.BACKEND_BUNDLE ?? path.join(__dirname, 'build/backend.cjs'));
const C = require(path.join(__dirname, 'build/client.cjs'));
const { Store, tsOfUs, usOfTs, clone } = require(path.join(__dirname, 'memfs.cjs'));

const WS = 'w1';
const P = {
  tx: (id) => `workspaces/${WS}/transactions/${id}`,
  month: (m) => `workspaces/${WS}/cash_report_periods/${m}`,
  mark: (id) => `workspaces/${WS}/cash_projection_marks/${id}`,
  state: `workspaces/${WS}/cash_period_events/projection_state`,
  events: `workspaces/${WS}/cash_period_events/`,
  months: `workspaces/${WS}/cash_report_periods/`,
  cp: `workspaces/${WS}/cash_report_periods/cash_periods_rebuild`,
};
const ref = (p) => admin.firestore().doc(p);

class World {
  constructor() {
    this.store = new Store();
    this.seq = 0;
    this.pendingEvents = []; // eventos ainda não entregues
    this.trace = [];
    this.shadow = new Map(); // id -> {anchors: {slot: {g: comp}}, chains: {slot: {g: comp}}}
    this.pruneLosses = [];   // componentes de geração viva que sumiram da marca
  }

  /** Atualiza a sombra com as componentes gravadas agora na marca de `id`. */
  shadowUpdate(id) {
    const s = this.store.snapshot(P.mark(id));
    if (!s.exists) return;
    const data = s.data();
    const sh = this.shadow.get(id) ?? { anchors: { a: {}, b: {} }, chains: { a: {}, b: {} } };
    for (const kind of ['anchors', 'chains']) {
      for (const slot of ['a', 'b']) {
        const comp = data[kind]?.[slot];
        if (comp && typeof comp.g === 'string') sh[kind][slot][comp.g] = JSON.stringify(comp);
      }
    }
    this.shadow.set(id, sh);
  }

  /** Nenhuma componente da geração vigente ou da preparada (estado atual) pode ter saído da marca. */
  checkLiveComponents(label) {
    const st = this.state();
    const live = [st.categoryGeneration, ...(st.categoryStaging ? [st.categoryStaging.generation] : [])];
    for (const [id, sh] of this.shadow) {
      const s = this.store.snapshot(P.mark(id));
      const data = s.exists ? s.data() : {};
      for (const kind of ['anchors', 'chains']) {
        for (const slot of ['a', 'b']) {
          for (const g of live) {
            const expected = sh[kind][slot][g];
            if (expected === undefined) continue;
            const actual = data[kind]?.[slot];
            if (!actual || actual.g !== g || JSON.stringify(actual) !== expected) {
              this.pruneLosses.push({ label, id, kind, slot, g, actual: actual ? actual.g : null });
            }
          }
        }
      }
    }
  }
  note(text) { this.trace.push(text); }

  // ------------------------------------------------------------- ledger
  /** Escrita de lançamento (escritor do backend): devolve o evento do gatilho. */
  write(id, nextData, us) {
    const before = this.store.snapshot(P.tx(id));
    const tx = this.store.tx();
    if (nextData === null) tx.delete(ref(P.tx(id)));
    else tx.set(ref(P.tx(id)), { ...nextData, updatedAt: FieldValue.serverTimestamp() });
    tx.commit(us, us); // escrita sem transação: pedido ~ commit (o pedido só afeta updatedAt, ms)
    const after = this.store.snapshot(P.tx(id));
    const event = {
      eventId: `ev-${++this.seq}`,
      transactionId: id,
      before: before.exists ? before.data() : undefined,
      after: after.exists ? after.data() : undefined,
      eventTime: after.exists ? after.updateTime : tsOfUs(us),
      beforeCreateTime: before.exists ? before.createTime : undefined,
      beforeUpdateTime: before.exists ? before.updateTime : undefined,
      commitUs: us,
    };
    this.pendingEvents.push(event);
    this.note(`${us}: escrita ${id} ${nextData === null ? 'excluída' : JSON.stringify({ v: nextData.valueCents, d: nextData.date, pago: nextData.isPaid !== false, anulada: !!nextData.voidedAt })}`);
    return event;
  }

  // ------------------------------------------------------------- gatilho (código real)
  async deliver(event, us) {
    const comps = (id) => { const d = this.store.snapshot(P.mark(id)); if (!d.exists) return []; const x = d.data();
      return ['anchors', 'chains'].flatMap((k) => ['a', 'b'].filter((sl) => x[k]?.[sl]).map((sl) => `${k}.${sl}.${x[k][sl].g}`)); };
    const beforeComps = comps(event.transactionId);
    const tx = this.store.tx();
    const action = !event.before ? 'CREATE' : !event.after ? 'DELETE' : 'UPDATE';
    const out = await B.applyCashPeriodWriteOnce(tx, WS, B.cashPeriodEventKey(event.eventId), event.before, event.after, {
      transactionId: event.transactionId, action, eventTime: event.eventTime,
      beforeCreateTime: event.beforeCreateTime, beforeUpdateTime: event.beforeUpdateTime,
    });
    tx.commit(us, us);
    const afterComps = new Set(comps(event.transactionId));
    this.prunedCount = (this.prunedCount ?? 0) + beforeComps.filter((c) => !afterComps.has(c) && !afterComps.has(c.replace(/\.[^.]+$/, ''))).filter((c) => ![...afterComps].some((a) => a.startsWith(c.split('.').slice(0, 2).join('.') + '.'))).length;
    this.shadowUpdate(event.transactionId);
    this.checkLiveComponents(`entrega ${event.eventId}`);
    this.note(`${us}: gatilho ${event.eventId} (${action} ${event.transactionId}, commit ${usOfTs(event.eventTime)}) -> ${out.outcome}${out.markBroken ? ` markBroken=${out.markBroken}` : ''}`);
    return out;
  }

  state() { return B.readCashProjectionState(this.store.snapshot(P.state)); }

  // ------------------------------------------------------------- reconstrução (rebuild.ts reproduzido)
  /** ensureCheckpoint/writeNewCheckpoint: corte = serverTimestamp do commit (resolvido em `requestUs`). */
  checkpoint(requestUs, commitUs, restarts = 0) {
    const state = this.state();
    const rebuildId = `R${++this.seq}`;
    const garbage = [...state.categoryGarbage];
    const previous = state.categoryStaging?.generation;
    if (previous && previous !== state.categoryGeneration && !garbage.includes(previous)) garbage.push(previous);
    const tx = this.store.tx();
    tx.set(ref(P.state), { id: 'projection_state', workspaceId: WS, kind: 'cash_projection_state',
      categoryStaging: { generation: rebuildId, cutoff: FieldValue.serverTimestamp() }, categoryGarbage: garbage,
      updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(ref(P.cp), { id: 'cash_periods_rebuild', workspaceId: WS, kind: 'cash_periods_rebuild', schemaVersion: 3,
      dryRun: false, status: 'running', rebuildId, cutoff: FieldValue.serverTimestamp(), cursor: null, processed: 0,
      periods: {}, scanComplete: false, restarts, markSlot: B.otherMarkSlot(state.markSlot), updatedAt: FieldValue.serverTimestamp() });
    tx.commit(requestUs, commitUs);
    const cp = this.store.snapshot(P.cp).data();
    this.checkLiveComponents('checkpoint');
    this.note(`${requestUs}..${commitUs}: checkpoint ${rebuildId} corte=${usOfTs(cp.cutoff)} posição=${cp.markSlot} (commit ${commitUs})`);
    return cp;
  }

  /** Leitura da página (fora da transação) + processPage. */
  readPage(us) {
    const cp = this.store.snapshot(P.cp).data();
    const work = { restart: null, anchors: [], months: {}, cp };
    for (const entry of this.store.list(`workspaces/${WS}/transactions/`)) {
      if (B.compareCommitTimes(entry.createTime, cp.cutoff) > 0) continue; // criado depois do corte
      if (B.compareCommitTimes(entry.updateTime, cp.cutoff) > 0) { work.restart = 'ledger_changed_during_rebuild'; return work; }
      const plan = B.cashWritePlanFor(undefined, entry.data());
      for (const [m, d] of Object.entries(plan.months)) {
        work.months[m] = work.months[m] ?? { incomeCents: 0, netCents: 0, transactionCount: 0 };
        for (const f of ['incomeCents', 'netCents', 'transactionCount']) work.months[m][f] += d[f];
      }
      work.anchors.push({ id: entry.id, fp: B.transactionFingerprint(entry.data()) });
    }
    this.note(`${us}: varredura lê a página (${work.anchors.length} na base${work.restart ? `, recomeço: ${work.restart}` : ''})`);
    return work;
  }

  /** Commit da página: âncoras (markAnchorPatch real, merge), totais e cursor. */
  commitPage(work, us) {
    const cp = this.store.snapshot(P.cp).data();
    if (!cp || cp.rebuildId !== work.cp.rebuildId || cp.cursor !== work.cp.cursor) return false;
    const tx = this.store.tx();
    for (const a of work.anchors) {
      tx.set(ref(P.mark(a.id)), B.markAnchorPatch(WS, a.id, cp.markSlot, { g: cp.rebuildId, cut: cp.cutoff, fp: a.fp }), { merge: true });
    }
    tx.set(ref(P.cp), { cursor: 'fim', periods: work.months, scanComplete: true, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.commit(us, us);
    for (const a of work.anchors) this.shadowUpdate(a.id);
    this.checkLiveComponents('commit da página');
    this.note(`${us}: commit da página com ${work.anchors.length} âncora(s) na posição ${cp.markSlot}`);
    return true;
  }

  /** publishRebuild. `checkStaging`: a correção sugerida (marca de entrega sem a geração preparada recomeça). */
  publish(requestUs, commitUs, { checkStaging = false } = {}) {
    const cp = this.store.snapshot(P.cp).data();
    const state = this.state();
    if (!cp || !cp.scanComplete) return { kind: 'concurrent' };
    if (state.categoryStaging?.generation !== cp.rebuildId) return { kind: 'restart', reason: 'category_staging_changed' };
    const cutoff = cp.cutoff;
    const markers = this.store.list(P.events).filter((s) => s.id !== 'projection_state')
      .map((s) => s.data()).filter((d) => d.eventTime && B.compareCommitTimes(d.eventTime, cutoff) > 0)
      .sort((a, b) => B.compareCommitTimes(a.eventTime, b.eventTime));
    const totals = clone(cp.periods);
    for (const d of markers) {
      if (d.action === 'DELETE' && (!d.beforeCreateTime || B.compareCommitTimes(d.beforeCreateTime, cutoff) <= 0)) {
        return { kind: 'restart', reason: 'delete_during_rebuild' };
      }
      if (d.outcome !== 'applied') continue;
      if (checkStaging && !(d.categoryGenerations ?? []).includes(cp.rebuildId)) {
        return { kind: 'restart', reason: 'marca_de_entrega_sem_a_geracao_preparada' };
      }
      for (const [m, delta] of Object.entries(d.deltas ?? {})) {
        totals[m] = totals[m] ?? { incomeCents: 0, netCents: 0, transactionCount: 0 };
        for (const f of ['incomeCents', 'netCents', 'transactionCount']) totals[m][f] += delta[f] ?? 0;
      }
    }
    const existing = this.store.list(P.months).map((s) => s.id).filter((id) => /^\d{4}-\d{2}$/.test(id));
    const tx = this.store.tx();
    const projectionGeneration = { id: cp.rebuildId, cutoff };
    for (const [m, t] of Object.entries(totals)) {
      tx.set(ref(P.month(m)), { id: m, workspaceId: WS, period: m, ...t, schemaVersion: 5, projectionGeneration,
        rebuildId: cp.rebuildId, updatedAt: FieldValue.serverTimestamp() });
    }
    for (const m of existing.filter((x) => !totals[x])) {
      tx.set(ref(P.month(m)), { incomeCents: 0, netCents: 0, transactionCount: 0, projectionGeneration,
        rebuildId: cp.rebuildId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    tx.set(ref(P.state), { id: 'projection_state', workspaceId: WS, kind: 'cash_projection_state', baselineCutoff: cutoff,
      baselineRebuildId: cp.rebuildId, lastPublishedAt: FieldValue.serverTimestamp(),
      needsRebuild: state.issueMaxEventTime !== null && B.compareCommitTimes(state.issueMaxEventTime, cutoff) > 0,
      categoryGeneration: cp.rebuildId, categoryStaging: FieldValue.delete(), markSlot: cp.markSlot,
      markRecoveryNeeded: state.markIssueMaxEventTime !== null && B.compareCommitTimes(state.markIssueMaxEventTime, cutoff) > 0,
      updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.delete(ref(P.cp));
    tx.commit(requestUs, commitUs);
    this.checkLiveComponents('publicação');
    this.note(`${commitUs}: publicação ${cp.rebuildId} (corte ${usOfTs(cutoff)}, ${markers.length} marca(s) de entrega depois do corte, posição ${cp.markSlot})`);
    return { kind: 'published', rebuildId: cp.rebuildId };
  }

  // ------------------------------------------------------------- cliente (código real)
  /** Leitura por id (getTransactionsByIds): conteúdo bruto + impressão digital do cliente. */
  async readById(ids) {
    const read = {};
    for (const id of ids) {
      const s = this.store.snapshot(P.tx(id));
      if (!s.exists) continue;
      const raw = s.data();
      read[id] = { document: { ...raw, id }, fingerprint: await C.transactionFingerprint(raw) };
    }
    return read;
  }
  /** Transação só de leitura do SDK web: um instante (aqui, entre duas operações do mundo). */
  readProjectionMarks(months, ids) {
    const out = { months: {}, marks: {} };
    for (const m of months) {
      const s = this.store.snapshot(P.month(m));
      const data = s.exists ? s.data() : null;
      out.months[m] = { exists: data !== null, incomeCents: Number.isSafeInteger(data?.incomeCents) ? data.incomeCents : NaN,
        generation: C.generationOf(data?.projectionGeneration) };
    }
    for (const id of ids) { const s = this.store.snapshot(P.mark(id)); out.marks[id] = s.exists ? s.data() : null; }
    return out;
  }
  /** Prova real + item que a estimativa tira; `basisIncome` = receita dos meses lidos (melhor caso das bases). */
  async prove(months, excludedIds, readSnapshot = null, byId = null) {
    const read = byId ?? await this.readById(excludedIds);
    const snapshot = readSnapshot ?? this.readProjectionMarks(months, excludedIds);
    const basisIncome = Object.fromEntries(months.map((m) => [m, snapshot.months[m].exists ? snapshot.months[m].incomeCents : 0]));
    const proof = C.proveProjectionExclusions({ months, snapshot, basisIncome, excludedIds, read, reversalIds: {} });
    const subtracted = Object.fromEntries(months.map((m) => [m, 0]));
    if (proof.proven) {
      for (const [, applied] of Object.entries(proof.applied)) {
        if (applied.document === null) continue;
        const item = C.excludedItemOf(applied.document, applied.reversal);
        if (item.month && item.month in subtracted && item.classification) subtracted[item.month] += item.classification.contributionCents;
      }
    }
    return { proof, read, snapshot, basisIncome, subtracted };
  }
}

const incomeDoc = (valueCents, date, extra = {}) => ({ workspaceId: WS, type: 'receita', valueCents, date, isPaid: true, ...extra });

module.exports = { World, P, WS, B, C, incomeDoc, tsOfUs, usOfTs };
