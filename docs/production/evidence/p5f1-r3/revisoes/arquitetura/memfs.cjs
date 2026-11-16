// Firestore em memória, mínimo, para rodar as funções REAIS do backend (applyCashPeriodWriteOnce,
// markAnchorPatch, transactionFingerprint...) sem Emulator e sem rede. Só o que essas funções usam:
// getAll/get por referência, create, set (com e sem merge), delete, e os sentinelas do Admin SDK
// (serverTimestamp, increment, delete, arrayUnion, arrayRemove). Cada transação aplica as escritas num
// instante de commit (updateTime) e resolve serverTimestamp num "instante de pedido" que pode ser anterior
// ao commit, como a sonda da R3 mediu no Emulator (sonda-updatetime.log).
'use strict';
const { Timestamp } = require('firebase-admin/firestore');

const tsOfUs = (us) => new Timestamp(Math.floor(us / 1e6), (us % 1e6) * 1000);
const usOfTs = (ts) => ts.seconds * 1e6 + Math.floor(ts.nanoseconds / 1000);
const msTsOfUs = (us) => tsOfUs(Math.floor(us / 1000) * 1000); // precisão de milissegundo (serverTimestamp do Emulator)

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) &&
  (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const isSentinel = (v) => v !== null && typeof v === 'object' && typeof v.methodName === 'string' &&
  v.methodName.startsWith('FieldValue.');

const clone = (v) => {
  if (Array.isArray(v)) return v.map(clone);
  if (isPlain(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)]));
  return v; // Timestamp e primitivos são imutáveis
};

const DELETE = Symbol('delete');
const resolveLeaf = (value, existing, requestTs) => {
  switch (value.methodName) {
    case 'FieldValue.serverTimestamp': return requestTs;
    case 'FieldValue.increment': return (typeof existing === 'number' ? existing : 0) + value.operand;
    case 'FieldValue.delete': return DELETE;
    case 'FieldValue.arrayUnion': {
      const base = Array.isArray(existing) ? [...existing] : [];
      for (const e of value.elements) if (!base.some((x) => JSON.stringify(x) === JSON.stringify(e))) base.push(e);
      return base;
    }
    case 'FieldValue.arrayRemove': {
      const base = Array.isArray(existing) ? existing : [];
      return base.filter((x) => !value.elements.some((e) => JSON.stringify(x) === JSON.stringify(e)));
    }
    default: throw new Error(`sentinela não suportado: ${value.methodName}`);
  }
};

// merge: mapas não vazios entram campo a campo; mapa vazio, array, Timestamp e primitivo substituem.
const mergeInto = (target, source, requestTs) => {
  for (const [key, value] of Object.entries(source)) {
    if (isSentinel(value)) {
      const r = resolveLeaf(value, target[key], requestTs);
      if (r === DELETE) delete target[key]; else target[key] = r;
    } else if (isPlain(value) && Object.keys(value).length > 0) {
      if (!isPlain(target[key])) target[key] = {};
      mergeInto(target[key], value, requestTs);
    } else {
      target[key] = clone(value);
    }
  }
  return target;
};

class Store {
  constructor() { this.docs = new Map(); this.log = []; }
  snapshot(path) {
    const d = this.docs.get(path);
    return {
      exists: !!d,
      id: path.split('/').pop(),
      ref: { path },
      data: () => (d ? clone(d.data) : undefined),
      createTime: d?.createTime,
      updateTime: d?.updateTime,
    };
  }
  list(prefix) {
    return [...this.docs.keys()].filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/')).sort()
      .map((p) => this.snapshot(p));
  }
  tx() { return new FakeTx(this); }
}

class FakeTx {
  constructor(store) { this.store = store; this.writes = []; }
  async getAll(...refs) { return refs.map((r) => this.store.snapshot(r.path)); }
  async get(ref) { return this.store.snapshot(ref.path); }
  create(ref, data) { this.writes.push({ op: 'create', path: ref.path, data }); return this; }
  set(ref, data, options) { this.writes.push({ op: 'set', path: ref.path, data, merge: !!options?.merge }); return this; }
  delete(ref) { this.writes.push({ op: 'delete', path: ref.path }); return this; }
  /** Aplica tudo de uma vez: `requestUs` resolve serverTimestamp; `commitUs` é o updateTime. */
  commit(requestUs, commitUs, { msPrecision = true } = {}) {
    const requestTs = msPrecision ? msTsOfUs(requestUs) : tsOfUs(requestUs);
    const commitTs = tsOfUs(commitUs);
    for (const w of this.writes) {
      if (w.op === 'create' && this.store.docs.has(w.path)) {
        const e = new Error(`ALREADY_EXISTS ${w.path}`); e.code = 6; throw e;
      }
    }
    for (const w of this.writes) {
      const existing = this.store.docs.get(w.path);
      if (w.op === 'delete') { this.store.docs.delete(w.path); continue; }
      const base = w.op === 'set' && w.merge && existing ? clone(existing.data) : {};
      const data = mergeInto(base, w.data, requestTs);
      this.store.docs.set(w.path, { data, createTime: existing?.createTime ?? commitTs, updateTime: commitTs });
    }
    this.store.log.push({ requestUs, commitUs, writes: this.writes.map((w) => `${w.op}:${w.path}`) });
  }
}

module.exports = { Store, FakeTx, tsOfUs, usOfTs, msTsOfUs, clone };
