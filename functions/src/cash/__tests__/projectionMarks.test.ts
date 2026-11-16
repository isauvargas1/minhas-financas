import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import test from "node:test";
import {GeoPoint, Timestamp} from "firebase-admin/firestore";

import {
  FingerprintTypeError,
  MAX_MARK_PENDING,
  applyMarkEvent,
  canonicalFirestoreValue,
  markChainOf,
  markEventOf,
  markViewOf,
  otherMarkSlot,
  pruneMarkDoc,
  readMarkDoc,
  transactionFingerprint,
  type MarkDoc,
  type MarkGeneration,
  type MarkNode,
  type MarkSlot,
  type MarkView,
} from "../projectionMarks";

/**
 * P5-F.1-R3 (B03) — marcas de aplicação da projeção de caixa.
 *
 * 1. Impressão digital canônica (identidade de versão por conteúdo).
 * 2. Propriedade principal (INV-M), com um simulador independente do gatilho,
 *    da cerca da reconstrução e da publicação: escritas de um lançamento
 *    (criação, edição, edição sem efeito, mudança de mês, exclusão, recriação
 *    com o mesmo id e conteúdo repetido), entregas em qualquer ordem, com
 *    reentregas, e reconstruções concorrentes (corte, varredura, página,
 *    publicação e recomeço). Em cada ponto: parte do lançamento na projeção
 *    = efeito(nó) + Σ pendências. Prova falsa (nó limpo com parte diferente)
 *    é falha.
 */

// ------------------------------------------------------- impressão digital

test("impressão digital: ordem das chaves não importa; conteúdo importa",
  () => {
    const a = {type: "receita", valueCents: 100, date: "2026-10-05",
      cashEntry: {status: "paid", revision: 2}};
    const b = {cashEntry: {revision: 2, status: "paid"}, date: "2026-10-05",
      valueCents: 100, type: "receita"};
    assert.equal(transactionFingerprint(a), transactionFingerprint(b));
    assert.notEqual(transactionFingerprint(a),
      transactionFingerprint({...a, valueCents: 101}));
    assert.notEqual(transactionFingerprint(a),
      transactionFingerprint({...a, description: "x"}));
  });

test("impressão digital: tipos marcados não se confundem", () => {
  const ts = new Timestamp(1_790_000_000, 123_000);
  assert.notEqual(
    transactionFingerprint({at: ts}),
    transactionFingerprint({at: {$t: [1_790_000_000, 123_000]}}),
    "mapa com chave $t não é Timestamp",
  );
  assert.notEqual(
    transactionFingerprint({v: "1"}), transactionFingerprint({v: 1}));
  assert.notEqual(
    transactionFingerprint({v: null}), transactionFingerprint({}));
  assert.notEqual(
    transactionFingerprint({v: [1, 2]}), transactionFingerprint({v: [2, 1]}));
  assert.notEqual(
    transactionFingerprint({v: Number.NaN}), transactionFingerprint({v: null}));
  assert.equal(
    transactionFingerprint({v: -0}), transactionFingerprint({v: 0}),
    "-0 e 0 têm o mesmo efeito em centavos");
  assert.notEqual(
    transactionFingerprint({at: new Timestamp(1, 0)}),
    transactionFingerprint({at: new Timestamp(1, 1000)}),
    "microssegundo distingue",
  );
  assert.deepEqual(canonicalFirestoreValue({g: new GeoPoint(-23.5, -46.6)}),
    {$m: [["g", {$g: [-23.5, -46.6]}]]});
});

test("impressão digital: tipo desconhecido falha, nunca é ignorado", () => {
  class Estranho {
    readonly x = 1;
  }
  assert.throws(() => transactionFingerprint({a: {b: new Estranho()}}),
    (error: unknown) => error instanceof FingerprintTypeError &&
      error.fieldPath === "a.b");
  assert.throws(() => transactionFingerprint({f: () => 1}),
    FingerprintTypeError);
});

/**
 * Fixture compartilhada com o teste do leitor do cliente: o mesmo documento,
 * montado com os tipos de cada SDK, tem a mesma impressão digital nos dois
 * lados.
 */
interface FixtureCase {
  name: string;
  doc: unknown;
  fingerprint: string;
}

const fromFixture = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(fromFixture);
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    if (Array.isArray(object.__timestamp)) {
      const [seconds, nanoseconds] = object.__timestamp as number[];
      return new Timestamp(seconds, nanoseconds);
    }
    if (Array.isArray(object.__geopoint)) {
      const [lat, lng] = object.__geopoint as number[];
      return new GeoPoint(lat, lng);
    }
    if (typeof object.__number === "string") return Number(object.__number);
    return Object.fromEntries(Object.entries(object).map(([key, item]) =>
      [key, fromFixture(item)]));
  }
  return value;
};

test("impressão digital: fixture compartilhada com o cliente", () => {
  const path = join(__dirname, "../../../../tests/fixtures/" +
    "transaction-fingerprints.json");
  const fixture = JSON.parse(readFileSync(path, "utf8")) as {
    cases: FixtureCase[];
  };
  assert.ok(fixture.cases.length >= 6);
  for (const item of fixture.cases) {
    assert.equal(transactionFingerprint(
      fromFixture(item.doc) as Record<string, unknown>), item.fingerprint,
    item.name);
  }
});

// ------------------------------------------------------- casos dirigidos

const T0 = new Timestamp(1_790_000_000, 0);
const at = (step: number): Timestamp =>
  new Timestamp(T0.seconds + step, (step % 7) * 1000);

const g0: MarkGeneration = {id: "g0", cutoff: null, slot: "a",
  role: "published"};

const content = (month: string, value: number, tag = 0) => ({
  type: "receita", valueCents: value, date: `${month}-05`, tag,
});
const alive = (data: Record<string, unknown>): MarkNode =>
  ({k: "alive", fp: transactionFingerprint(data)});

const deliver = (
  doc: MarkDoc,
  generation: MarkGeneration,
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
  beforeUpdateTime: Timestamp | null = null,
): MarkView => {
  const view = applyMarkEvent(markViewOf(doc, generation),
    markEventOf(before, after, beforeUpdateTime), generation);
  doc.chains[generation.slot] = markChainOf(view, generation);
  return markViewOf(doc, generation);
};

test("fora de ordem: posterior antes do anterior fica pendente e não prova",
  () => {
    const doc: MarkDoc = {anchors: {}, chains: {}};
    const v1 = content("2026-03", 10_000);
    const v2 = content("2026-03", 30_000);
    const v3 = content("2026-02", 30_000);
    deliver(doc, g0, undefined, v1);
    let view = deliver(doc, g0, v2, v3); // e3 chega antes de e2
    assert.equal(view.kind, "rooted");
    if (view.kind !== "rooted") return;
    assert.deepEqual(view.node, alive(v1));
    assert.equal(view.pending.length, 1, "e3 pendente");
    view = deliver(doc, g0, v1, v2); // e2 chega
    assert.equal(view.kind, "rooted");
    if (view.kind !== "rooted") return;
    assert.deepEqual(view.node, alive(v3), "e3 absorvido depois de e2");
    assert.equal(view.pending.length, 0);
  });

test("criação, edição sem efeito, exclusão e recriação com o mesmo id", () => {
  const doc: MarkDoc = {anchors: {}, chains: {}};
  const v1 = content("2026-03", 10_000);
  const v1b = {...v1, description: "só a descrição"};
  deliver(doc, g0, undefined, v1);
  let view = deliver(doc, g0, v1, v1b);
  assert.deepEqual(view.kind === "rooted" && view.node, alive(v1b));
  view = deliver(doc, g0, v1b, undefined);
  assert.deepEqual(view.kind === "rooted" && view.node, {k: "deleted"});
  view = deliver(doc, g0, undefined, v1);
  assert.deepEqual(view.kind === "rooted" && view.node, alive(v1),
    "recriação casa com o estado apagado");
});

test("limite de pendências: acima de 16, broken, e a geração seguinte " +
  "recupera pela âncora", () => {
  const doc: MarkDoc = {anchors: {}, chains: {}};
  deliver(doc, g0, undefined, content("2026-03", 1));
  let view: MarkView = markViewOf(doc, g0);
  for (let i = 0; i <= MAX_MARK_PENDING; i += 1) {
    view = deliver(doc, g0, content("2026-03", 1000 + i),
      content("2026-03", 2000 + i));
  }
  assert.deepEqual(view, {kind: "broken", code: "pending_overflow"});
  // Reconstrução: âncora da base na outra posição; a cadeia quebrada fica na
  // posição antiga e não vale para a geração nova.
  const g1: MarkGeneration = {id: "r1", cutoff: at(100),
    slot: otherMarkSlot("a"), role: "published"};
  const base = content("2026-03", 2016);
  doc.anchors[g1.slot] = {g: g1.id, cut: g1.cutoff,
    fp: transactionFingerprint(base)};
  const recovered = markViewOf(doc, g1);
  assert.equal(recovered.kind, "rooted");
  assert.deepEqual(recovered.kind === "rooted" && recovered.node, alive(base));
  assert.equal(markViewOf(doc, g0).kind, "broken", "a antiga segue quebrada");
});

test("conflitos com a base viram broken", () => {
  const staging: MarkGeneration = {id: "r2", cutoff: at(10), slot: "b",
    role: "staging"};
  const published = {...staging, role: "published" as const};
  const v = content("2026-03", 500);
  // criação encadeada como fora da base e, depois, âncora da varredura
  const docA: MarkDoc = {anchors: {}, chains: {}};
  deliver(docA, staging, undefined, v);
  docA.anchors.b = {g: "r2", cut: at(10), fp: transactionFingerprint(v)};
  assert.deepEqual(markViewOf(docA, published),
    {kind: "broken", code: "anchor_after_absent"});
  // raiz `event` com outra impressão
  const docB: MarkDoc = {anchors: {}, chains: {}};
  deliver(docB, staging, v, content("2026-03", 600), at(5));
  docB.anchors.b = {g: "r2", cut: at(10),
    fp: transactionFingerprint(content("2026-03", 499))};
  assert.deepEqual(markViewOf(docB, published),
    {kind: "broken", code: "anchor_mismatch"});
  // raiz `event` sem âncora numa geração publicada
  const docC: MarkDoc = {anchors: {}, chains: {}};
  deliver(docC, staging, v, content("2026-03", 600), at(5));
  assert.deepEqual(markViewOf(docC, published),
    {kind: "broken", code: "base_without_anchor"});
});

test("cadeia e âncora de outra geração (velha ou de preparação abandonada) " +
  "não valem para a geração lida", () => {
  const doc: MarkDoc = {anchors: {}, chains: {}};
  const old: MarkGeneration = {id: "r-abandonada", cutoff: at(3), slot: "b",
    role: "staging"};
  deliver(doc, old, undefined, content("2026-03", 1));
  doc.anchors.b = {g: "r-abandonada", cut: at(3),
    fp: transactionFingerprint(content("2026-03", 1))};
  const fresh: MarkGeneration = {id: "r-nova", cutoff: at(9), slot: "b",
    role: "published"};
  assert.deepEqual(markViewOf(doc, fresh),
    {kind: "rooted", root: "absent", base: null, node: {k: "absent"},
      pending: []});
});

test("poda (L-PRI-02): a marca guarda só a geração vigente e a " +
  "preparada", () => {
  const v = content("2026-03", 1);
  const w = content("2026-03", 2);
  const doc: MarkDoc = {anchors: {}, chains: {}};
  deliver(doc, g0, undefined, v);
  const staging: MarkGeneration = {id: "r1", cutoff: at(5), slot: "b",
    role: "staging"};
  doc.anchors.b = {g: "r1", cut: at(5), fp: transactionFingerprint(v)};
  deliver(doc, staging, v, w, at(4));
  const snapshot = JSON.stringify(doc);
  // Durante a preparação, as duas gerações ficam inteiras.
  assert.deepEqual(pruneMarkDoc(doc, ["g0", "r1"]), doc);
  // Publicada a r1, a posição da g0 sai, e a visão da r1 não muda.
  const published = {...staging, role: "published" as const};
  const afterPublish = pruneMarkDoc(doc, ["r1"]);
  assert.deepEqual(afterPublish, {anchors: {b: doc.anchors.b},
    chains: {b: doc.chains.b}});
  assert.deepEqual(markViewOf(afterPublish, published),
    markViewOf(doc, published));
  assert.deepEqual(markViewOf(afterPublish, published),
    {kind: "rooted", root: "anchor", base: transactionFingerprint(v),
      node: alive(w), pending: []});
  // Preparação abandonada (r1) e recomeço (r2) na mesma posição: sai a r1.
  assert.deepEqual(pruneMarkDoc(doc, ["g0", "r2"]),
    {anchors: {}, chains: {a: doc.chains.a}});
  // Nenhuma geração viva: nada fica; a entrada não é alterada.
  assert.deepEqual(pruneMarkDoc(doc, []), {anchors: {}, chains: {}});
  assert.equal(JSON.stringify(doc), snapshot);
});

test("índices: nenhum campo das marcas tem índice de campo único (nenhuma " +
  "consulta lê a coleção)", () => {
  const indexes = JSON.parse(readFileSync(
    join(__dirname, "../../../../firestore.indexes.json"), "utf8")) as {
    indexes: Array<Record<string, unknown>>;
    fieldOverrides: Array<Record<string, unknown>>;
  };
  assert.deepEqual(indexes.fieldOverrides.filter((entry) =>
    entry.collectionGroup === "cash_projection_marks"), [
    "schemaVersion", "workspaceId", "transactionId", "anchors", "chains",
    "updatedAt",
  ].map((fieldPath) => ({collectionGroup: "cash_projection_marks", fieldPath,
    indexes: []})));
  assert.equal(indexes.indexes.filter((entry) =>
    entry.collectionGroup === "cash_projection_marks").length, 0);
});

test("leitura: formato desconhecido de cadeia vira broken; âncora inválida " +
  "é ignorada", () => {
  const doc = readMarkDoc({
    anchors: {a: {g: "g0", cut: null}},
    chains: {a: {g: "g0", cut: null, root: "outro", pending: []}},
  });
  assert.equal(doc.anchors.a, undefined);
  assert.deepEqual(markViewOf(doc, g0),
    {kind: "broken", code: "invalid_chain"});
});

// ------------------------------------------------------- simulador (INV-M)

/** PRNG determinístico (mulberry32). */
const prng = (seed: number) => () => {
  seed |= 0;
  seed = seed + 0x6d2b79f5 | 0;
  let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};

type Content = {type: string; valueCents: number; date: string; tag: number};
type Effect = Record<string, number>;

const effectOf = (data: Content | null): Effect =>
  data ? {[data.date.slice(0, 7)]: data.valueCents} : {};
const addEffect = (target: Effect, delta: Effect, sign = 1): void => {
  for (const [month, value] of Object.entries(delta)) {
    const sum = (target[month] ?? 0) + sign * value;
    if (sum === 0) delete target[month];
    else target[month] = sum;
  }
};
const sameEffect = (a: Effect, b: Effect): boolean => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => (a[key] ?? 0) === (b[key] ?? 0));
};

interface Write {
  id: number;
  t: Timestamp;
  before: Content | null;
  after: Content | null;
  beforeUpdateTime: Timestamp | null;
  beforeCreateTime: Timestamp | null;
}

interface Generation {
  id: string;
  cutoff: Timestamp | null;
  slot: MarkSlot;
}

interface Rebuild extends Generation {
  /** A varredura leu o lançamento (`undefined`: ainda não). */
  scanned?: {fp: string | null; content: Content | null};
  anchorWritten: boolean;
  postCut: Effect;
  deleteFence: boolean;
}

const cmp = (a: Timestamp, b: Timestamp): number =>
  a.seconds - b.seconds || a.nanoseconds - b.nanoseconds;

interface Stats {
  scenarios: number;
  checks: number;
  clean: number;
  pending: number;
  broken: number;
  publications: number;
  restarts: number;
  outOfOrder: number;
  deletes: number;
  recreations: number;
  finalClean: number;
  pruned: number;
}

/**
 * Um cenário: as escritas acontecem em ordem de commit; as entregas, em
 * qualquer ordem e repetidas; a reconstrução corta, varre, grava a página e
 * publica em instantes sorteados, com a mesma cerca do código de produção.
 * A cada passo, a INV-M é conferida na geração vigente.
 */
const runScenario = (seed: number, stats: Stats): void => {
  const random = prng(seed);
  const pick = <T>(items: readonly T[]): T =>
    items[Math.floor(random() * items.length)];
  const months = ["2026-01", "2026-02", "2026-03"];
  const contents: Content[] = [];
  for (let i = 0; i < 4; i += 1) {
    contents.push({type: "receita", valueCents: pick([0, 100, 250, 900]),
      date: `${pick(months)}-05`, tag: Math.floor(random() * 2)});
  }
  const byFp = new Map(contents.map((c) => [transactionFingerprint(c), c]));

  let clock = 0;
  const tick = (): Timestamp => at(++clock);
  let state: Content | null = null;
  let stateUpdateTime: Timestamp | null = null;
  let createTime: Timestamp | null = null;
  const writes: Write[] = [];
  const undelivered: Write[] = [];

  let current: Generation = {id: "g0", cutoff: null, slot: "a"};
  let rebuild: Rebuild | null = null;
  let rebuildSeq = 0;
  let lastPublishedAt: Timestamp | null = null;
  let projection: Effect = {};
  const applied = new Set<number>();
  const doc: MarkDoc = {anchors: {}, chains: {}};

  const doWrite = (): void => {
    let after: Content | null;
    if (state === null) after = pick(contents);
    else if (random() < 0.15) after = null;
    else after = pick(contents);
    const t = tick();
    const write: Write = {
      id: writes.length, t, before: state, after,
      beforeUpdateTime: state ? stateUpdateTime : null,
      beforeCreateTime: state ? createTime : null,
    };
    if (state === null && writes.length > 0) stats.recreations += 1;
    if (after === null) stats.deletes += 1;
    if (state === null) createTime = t;
    state = after;
    stateUpdateTime = after ? t : null;
    if (after === null) createTime = null;
    writes.push(write);
    undelivered.push(write);
  };

  const generationsFor = (eventTime: Timestamp): MarkGeneration[] => {
    const list: MarkGeneration[] = [{...current, role: "published"}];
    if (rebuild && rebuild.cutoff && cmp(eventTime, rebuild.cutoff) > 0) {
      list.push({id: rebuild.id, cutoff: rebuild.cutoff, slot: rebuild.slot,
        role: "staging"});
    }
    return list;
  };

  const doDeliver = (): void => {
    if (writes.length === 0) return;
    // Entrega pendente (fora de ordem) ou reentrega de qualquer uma.
    const write = undelivered.length > 0 && random() < 0.8 ?
      undelivered.splice(Math.floor(random() * undelivered.length), 1)[0] :
      pick(writes);
    if (write !== writes[writes.length - 1] && undelivered.length > 0) {
      stats.outOfOrder += 1;
    }
    if (applied.has(write.id)) return; // marca de entrega: duplicate
    applied.add(write.id);
    if (current.cutoff && cmp(write.t, current.cutoff) <= 0) return; // covered
    const isDelete = write.after === null && write.before !== null;
    if (
      isDelete && current.cutoff && lastPublishedAt &&
      cmp(write.t, lastPublishedAt) < 0 &&
      (!write.beforeCreateTime || cmp(write.beforeCreateTime,
        current.cutoff) <= 0)
    ) {
      return; // ambiguous_delete: não soma, needsRebuild
    }
    const delta = effectOf(write.after);
    addEffect(delta, effectOf(write.before), -1);
    addEffect(projection, delta);
    if (rebuild && rebuild.cutoff && cmp(write.t, rebuild.cutoff) > 0) {
      addEffect(rebuild.postCut, delta);
      if (isDelete && (!write.beforeCreateTime ||
        cmp(write.beforeCreateTime, rebuild.cutoff) <= 0)) {
        rebuild.deleteFence = true;
      }
    }
    const event = markEventOf(write.before ?? undefined,
      write.after ?? undefined, write.beforeUpdateTime);
    for (const generation of generationsFor(write.t)) {
      const view = applyMarkEvent(markViewOf(doc, generation), event,
        generation);
      doc.chains[generation.slot] = markChainOf(view, generation);
    }
    // Poda do gatilho (L-PRI-02): a marca regravada guarda só a geração
    // vigente e a preparada; a âncora da preparada sobrevive às entregas.
    const components = (d: MarkDoc): number =>
      Object.keys(d.anchors).length + Object.keys(d.chains).length;
    const pruned = pruneMarkDoc(doc,
      rebuild ? [current.id, rebuild.id] : [current.id]);
    if (components(pruned) < components(doc)) stats.pruned += 1;
    doc.anchors = pruned.anchors;
    doc.chains = pruned.chains;
    if (rebuild && rebuild.anchorWritten && rebuild.scanned?.fp) {
      assert.equal(doc.anchors[rebuild.slot]?.g, rebuild.id,
        `semente ${seed}: a poda apagou a âncora da preparada`);
    }
  };

  const doRebuildStep = (): void => {
    if (!rebuild) {
      rebuildSeq += 1;
      rebuild = {id: `r${rebuildSeq}`, cutoff: tick(),
        slot: otherMarkSlot(current.slot), anchorWritten: false, postCut: {},
        deleteFence: false};
      return;
    }
    const cutoff = rebuild.cutoff as Timestamp;
    if (rebuild.scanned === undefined) {
      // Varredura: lê o lançamento agora.
      if (state !== null && stateUpdateTime &&
        cmp(stateUpdateTime, cutoff) > 0) {
        if (createTime && cmp(createTime, cutoff) > 0) {
          rebuild.scanned = {fp: null, content: null}; // criado depois: pula
        } else {
          rebuild = null; // mudou depois do corte: recomeça
          stats.restarts += 1;
        }
      } else {
        rebuild.scanned = state ?
          {fp: transactionFingerprint(state), content: state} :
          {fp: null, content: null};
      }
      return;
    }
    if (!rebuild.anchorWritten) {
      // Commit da página: âncora sem ler a marca (merge da posição).
      if (rebuild.scanned.fp !== null) {
        doc.anchors[rebuild.slot] = {g: rebuild.id, cut: cutoff,
          fp: rebuild.scanned.fp};
      }
      rebuild.anchorWritten = true;
      return;
    }
    // Publicação, com a cerca de exclusão.
    if (rebuild.deleteFence) {
      rebuild = null;
      stats.restarts += 1;
      return;
    }
    projection = effectOf(rebuild.scanned.content);
    addEffect(projection, rebuild.postCut);
    current = {id: rebuild.id, cutoff, slot: rebuild.slot};
    lastPublishedAt = tick();
    rebuild = null;
    stats.publications += 1;
  };

  const check = (label: string): void => {
    stats.checks += 1;
    const view = markViewOf(doc, {...current, role: "published"});
    if (view.kind === "broken") {
      stats.broken += 1;
      return;
    }
    assert.equal(view.kind, "rooted", `${label}: geração vigente sem raiz`);
    if (view.kind !== "rooted") return;
    const claimed: Effect = {};
    if (view.node.k === "alive") {
      const node = byFp.get(view.node.fp);
      assert.ok(node, `${label}: nó com conteúdo desconhecido`);
      addEffect(claimed, effectOf(node ?? null));
    }
    for (const item of view.pending) {
      if (item.a.k === "alive") {
        addEffect(claimed, effectOf(byFp.get(item.a.fp) ?? null));
      }
      if (item.b.k === "alive") {
        addEffect(claimed, effectOf(byFp.get(item.b.fp) ?? null), -1);
      }
    }
    assert.ok(sameEffect(claimed, projection),
      `${label} (semente ${seed}): INV-M violada: marca ` +
        `${JSON.stringify(claimed)}, projeção ${JSON.stringify(projection)}`);
    if (view.pending.length === 0) stats.clean += 1;
    else stats.pending += 1;
  };

  const steps = 6 + Math.floor(random() * 22);
  for (let step = 0; step < steps; step += 1) {
    const roll = random();
    if (roll < 0.35 && writes.length < 9) doWrite();
    else if (roll < 0.85) doDeliver();
    else if (rebuildSeq < 3 || rebuild) doRebuildStep();
    check(`passo ${step}`);
  }
  // Fim: tudo entregue e, se houver, a reconstrução publicada.
  while (undelivered.length > 0) {
    doDeliver();
    check("entrega final");
  }
  let guard = 0;
  while (rebuild && guard++ < 8) {
    doRebuildStep();
    check("reconstrução final");
  }
  const finalView = markViewOf(doc, {...current, role: "published"});
  if (
    finalView.kind === "rooted" && finalView.pending.length === 0 &&
    sameEffect(projection, effectOf(state))
  ) {
    stats.finalClean += 1;
  }
  stats.scenarios += 1;
};

test("propriedade INV-M: nenhuma prova falsa em entregas fora de ordem, " +
  "reentregas, exclusões, recriações e reconstruções concorrentes", () => {
  const stats: Stats = {scenarios: 0, checks: 0, clean: 0, pending: 0,
    broken: 0, publications: 0, restarts: 0, outOfOrder: 0, deletes: 0,
    recreations: 0, finalClean: 0, pruned: 0};
  for (let seed = 1; seed <= 4000; seed += 1) runScenario(seed, stats);
  // Cobertura mínima do gerador: o teste só vale se exercitar cada caminho.
  assert.equal(stats.scenarios, 4000);
  assert.ok(stats.publications > 1500, `publicações ${stats.publications}`);
  assert.ok(stats.restarts > 100, `recomeços ${stats.restarts}`);
  assert.ok(stats.outOfOrder > 4000, `fora de ordem ${stats.outOfOrder}`);
  assert.ok(stats.pending > 1000, `pontos com pendência ${stats.pending}`);
  assert.ok(stats.deletes > 800, `exclusões ${stats.deletes}`);
  assert.ok(stats.recreations > 300, `recriações ${stats.recreations}`);
  assert.ok(stats.clean > 20000, `pontos limpos ${stats.clean}`);
  // Vivacidade: com tudo entregue, a grande maioria termina provável.
  assert.ok(stats.finalClean > 3000, `finais limpos ${stats.finalClean}`);
  // A poda do gatilho foi exercitada (gerações superadas e abandonadas).
  assert.ok(stats.pruned > 400, `podas ${stats.pruned}`);
  console.log(`[INV-M] ${JSON.stringify(stats)}`);
});
