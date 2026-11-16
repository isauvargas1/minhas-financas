import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

import {GeoPoint, Timestamp} from 'firebase/firestore';

import {
  markViewFor,
  proveProjectionExclusions,
  readMarkDoc,
  transactionFingerprint,
  type ProjectionGeneration,
  type ProjectionProofInput,
  type ReadDocument,
  type SnapshotMonth,
} from '../../src/modules/work-time/projectionProof.ts';

// ------------------------------------------------------------------ fixtures

const readFixture = (name: string): {cases: Array<Record<string, unknown>>} =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));

/** Converte os marcadores das fixtures do backend nos tipos do SDK web. */
const fromMarkers = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(fromMarkers);
  if (typeof value !== 'object' || value === null) return value;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 1 && keys[0] === '__timestamp') {
    const [seconds, nanoseconds] = record.__timestamp as [number, number];
    return new Timestamp(seconds, nanoseconds);
  }
  if (keys.length === 1 && keys[0] === '__geopoint') {
    const [latitude, longitude] = record.__geopoint as [number, number];
    return new GeoPoint(latitude, longitude);
  }
  if (keys.length === 1 && keys[0] === '__number') return Number(record.__number);
  return Object.fromEntries(keys.map((key) => [key, fromMarkers(record[key])]));
};

// ------------------------------------------------------ impressão digital

test('impressão digital: bate com a fixture gerada pelo backend, caso a caso', async () => {
  const {cases} = readFixture('transaction-fingerprints.json');
  assert.ok(cases.length >= 9);
  for (const item of cases) {
    const doc = fromMarkers(item.doc) as Record<string, unknown>;
    assert.equal(await transactionFingerprint(doc), item.fingerprint, `caso: ${String(item.name)}`);
  }
});

test('impressão digital: a fixture cobre Timestamp, GeoPoint, NaN e Infinity convertidos', () => {
  const {cases} = readFixture('transaction-fingerprints.json');
  const docs = cases.map((item) => fromMarkers(item.doc) as Record<string, unknown>);
  assert.ok(docs.some((doc) => doc.createdAt instanceof Timestamp));
  assert.ok(docs.some((doc) => doc.where instanceof GeoPoint));
  assert.ok(docs.some((doc) => Number.isNaN(doc.b) && doc.c === Infinity));
});

test('impressão digital: ordem das chaves não importa e 1 microssegundo muda a impressão', async () => {
  const {cases} = readFixture('transaction-fingerprints.json');
  const [first, reordered, shifted] = await Promise.all(
    cases.slice(0, 3).map((item) => transactionFingerprint(fromMarkers(item.doc) as Record<string, unknown>)),
  );
  assert.equal(first, reordered);
  assert.notEqual(first, shifted);
});

// -------------------------------------------------------- visão da marca

test('visão da marca: paridade com a fixture gerada pelo backend, caso a caso', () => {
  const {cases} = readFixture('projection-mark-views.json');
  assert.ok(cases.length >= 14);
  for (const item of cases) {
    const mark = fromMarkers(item.mark);
    const generation = fromMarkers(item.generation) as ProjectionGeneration;
    assert.deepEqual(markViewFor(readMarkDoc(mark), generation), item.expected, `caso: ${String(item.name)}`);
  }
});

test('visão da marca: a paridade também vale com o corte como objeto {seconds, nanoseconds}', () => {
  const plain = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(plain);
    if (typeof value !== 'object' || value === null) return value;
    if (value instanceof Timestamp) return {seconds: value.seconds, nanoseconds: value.nanoseconds};
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)]));
  };
  for (const item of readFixture('projection-mark-views.json').cases) {
    const mark = plain(fromMarkers(item.mark));
    const generation = plain(fromMarkers(item.generation)) as ProjectionGeneration;
    assert.deepEqual(markViewFor(readMarkDoc(mark), generation), item.expected, `caso: ${String(item.name)}`);
  }
});

// ------------------------------------------------- checagens só do cliente

const FP_A = 'a'.repeat(64);
const FP_B = 'b'.repeat(64);
const ts = (seconds: number, nanoseconds = 0): Timestamp => new Timestamp(seconds, nanoseconds);
const aliveNode = (fp: string) => ({k: 'alive', fp});

const chainOf = (generation: string, cut: Timestamp | null, node: unknown, extra: Record<string, unknown> = {}) => ({
  g: generation,
  cut,
  root: 'absent',
  base: null,
  node,
  pending: [],
  broken: null,
  ...extra,
});

test('só do cliente: âncora numa posição e cadeia da mesma geração na outra dá slot_mismatch', () => {
  const generation: ProjectionGeneration = {id: 'r1', cutoff: {seconds: 100, nanoseconds: 0}};
  const mark = {
    anchors: {a: {g: 'r1', cut: ts(100), fp: FP_A}},
    chains: {b: chainOf('r1', ts(100), aliveNode(FP_A), {root: 'event', base: FP_A})},
  };
  assert.deepEqual(markViewFor(readMarkDoc(mark), generation), {kind: 'broken', code: 'slot_mismatch'});
  // A mesma configuração, na mesma posição, é válida.
  const same = {...mark, chains: {a: mark.chains.b}};
  assert.deepEqual(markViewFor(readMarkDoc(same), generation), {kind: 'rooted', node: aliveNode(FP_A), pending: 0});
});

test('só do cliente: componente de geração mais nova na posição lida dá superseded', () => {
  const generation: ProjectionGeneration = {id: 'r1', cutoff: {seconds: 100, nanoseconds: 0}};
  const base = {chains: {a: chainOf('r1', ts(100), aliveNode(FP_A))}};
  assert.deepEqual(markViewFor(readMarkDoc(base), generation), {kind: 'rooted', node: aliveNode(FP_A), pending: 0});

  const newerAnchor = {...base, anchors: {a: {g: 'r2', cut: ts(100, 1), fp: FP_B}}};
  assert.deepEqual(markViewFor(readMarkDoc(newerAnchor), generation), {kind: 'broken', code: 'superseded'});

  const newerChain = {chains: {a: chainOf('r2', ts(101), aliveNode(FP_B))}, anchors: {a: {g: 'r1', cut: ts(100), fp: FP_A}}};
  assert.deepEqual(markViewFor(readMarkDoc(newerChain), generation), {kind: 'broken', code: 'superseded'});
});

test('só do cliente: superseded também sem componente da geração lida e com geração inicial (corte nulo)', () => {
  const generation: ProjectionGeneration = {id: 'r1', cutoff: {seconds: 100, nanoseconds: 0}};
  const onlyNewer = {chains: {b: chainOf('r2', ts(500), aliveNode(FP_B))}};
  assert.deepEqual(markViewFor(readMarkDoc(onlyNewer), generation), {kind: 'broken', code: 'superseded'});

  const initial: ProjectionGeneration = {id: 'g0', cutoff: null};
  const newerThanInitial = {chains: {a: chainOf('g1', ts(1), aliveNode(FP_B))}};
  assert.deepEqual(markViewFor(readMarkDoc(newerThanInitial), initial), {kind: 'broken', code: 'superseded'});
  // Corte nulo (geração inicial) nunca é mais novo.
  const olderInitial = {chains: {a: chainOf('g0', null, aliveNode(FP_B))}};
  assert.deepEqual(markViewFor(readMarkDoc(olderInitial), {id: 'r1', cutoff: {seconds: 100, nanoseconds: 0}}), {kind: 'rooted', node: {k: 'absent'}, pending: 0});
});

test('só do cliente: componente de geração mais velha na mesma posição não atrapalha', () => {
  const generation: ProjectionGeneration = {id: 'r1', cutoff: {seconds: 100, nanoseconds: 0}};
  const mark = {
    anchors: {a: {g: 'r0', cut: ts(50), fp: FP_B}},
    chains: {a: chainOf('r1', ts(100), aliveNode(FP_A))},
  };
  assert.deepEqual(markViewFor(readMarkDoc(mark), generation), {kind: 'rooted', node: aliveNode(FP_A), pending: 0});
  // Corte igual ao da geração lida também não é "mais novo".
  const equalCut = {...mark, anchors: {a: {g: 'r0', cut: ts(100), fp: FP_B}}};
  assert.deepEqual(markViewFor(readMarkDoc(equalCut), generation), {kind: 'rooted', node: aliveNode(FP_A), pending: 0});
});

// ------------------------------------------------- proveProjectionExclusions

const G0: ProjectionGeneration = {id: 'g0', cutoff: null};
const MONTHS = ['2026-01', '2026-02', '2026-03'] as const;

const month = (incomeCents: number, generation: ProjectionGeneration | null = G0): SnapshotMonth => ({exists: true, incomeCents, generation});
const missing: SnapshotMonth = {exists: false, incomeCents: 0, generation: null};

const docOf = (id: string, valueCents: number): Record<string, unknown> => ({id, valueCents, type: 'receita'});
const readOf = (id: string, valueCents: number, fingerprint: string | null = `fp-${id}-${valueCents}`): ReadDocument => ({
  document: docOf(id, valueCents),
  fingerprint,
});

const liveMark = (fp: string, generation = 'g0') => ({chains: {a: chainOf(generation, null, aliveNode(fp))}});
const absentMark = (generation = 'g0') => ({chains: {a: chainOf(generation, null, {k: 'absent'})}});
const deletedMark = (generation = 'g0') => ({chains: {a: chainOf(generation, null, {k: 'deleted'})}});

const baseInput = (overrides: Partial<ProjectionProofInput> = {}): ProjectionProofInput => ({
  months: MONTHS,
  snapshot: {
    months: {'2026-01': month(1000), '2026-02': month(2000), '2026-03': month(3000)},
    marks: {x: liveMark('fp-x-500')},
  },
  basisIncome: {'2026-01': 1000, '2026-02': 2000, '2026-03': 3000},
  excludedIds: ['x'],
  read: {x: readOf('x', 500)},
  reversalIds: {},
  ...overrides,
});

const expectRefused = (input: ProjectionProofInput, reason: string): void => {
  assert.deepEqual(proveProjectionExclusions(input), {proven: false, reason});
};

test('prova: mês da janela existente sem projectionGeneration recusa com generation', () => {
  const input = baseInput();
  expectRefused(
    {...input, snapshot: {...input.snapshot, months: {...input.snapshot.months, '2026-02': month(2000, null)}}},
    'generation',
  );
});

test('prova: meses com gerações diferentes recusam com generation (id ou corte diferente)', () => {
  const input = baseInput();
  const withMonth = (value: SnapshotMonth) => ({...input, snapshot: {...input.snapshot, months: {...input.snapshot.months, '2026-03': value}}});
  expectRefused(withMonth(month(3000, {id: 'g1', cutoff: null})), 'generation');
  const cutA = baseInput({snapshot: {months: {'2026-01': month(1000, {id: 'r1', cutoff: {seconds: 10, nanoseconds: 0}}), '2026-02': month(2000, {id: 'r1', cutoff: {seconds: 10, nanoseconds: 1}}), '2026-03': missing}, marks: {x: liveMark('fp-x-500', 'r1')}}, basisIncome: {'2026-01': 1000, '2026-02': 2000}});
  expectRefused(cutA, 'generation');
  // Mês inexistente na janela não conta para a etiqueta.
  const withGap = baseInput({
    snapshot: {months: {'2026-01': month(1000), '2026-02': missing, '2026-03': month(3000)}, marks: {x: liveMark('fp-x-500')}},
    basisIncome: {'2026-01': 1000, '2026-03': 3000},
  });
  assert.equal(proveProjectionExclusions(withGap).proven, true);
});

test('prova: receita das bases diferente da dos meses recusa com bases', () => {
  expectRefused(baseInput({basisIncome: {'2026-01': 1000, '2026-02': 2001, '2026-03': 3000}}), 'bases');
  // Mês inexistente com base > 0.
  const input = baseInput();
  expectRefused(
    {...input, snapshot: {...input.snapshot, months: {...input.snapshot.months, '2026-03': missing}}},
    'bases',
  );
  // Mês existente com base ausente (conta como zero) e receita > 0.
  expectRefused(baseInput({basisIncome: {'2026-01': 1000, '2026-02': 2000}}), 'bases');
});

test('prova: mês inexistente com base zero (ou ausente) não atrapalha', () => {
  const input = baseInput({
    snapshot: {months: {'2026-01': month(1000), '2026-02': month(2000), '2026-03': missing}, marks: {x: liveMark('fp-x-500')}},
    basisIncome: {'2026-01': 1000, '2026-02': 2000, '2026-03': 0},
  });
  assert.equal(proveProjectionExclusions(input).proven, true);
});

test('prova: marca quebrada recusa com mark_broken', () => {
  const broken = {chains: {a: chainOf('g0', null, null, {root: null, broken: 'pending_overflow'})}};
  expectRefused(baseInput({snapshot: {...baseInput().snapshot, marks: {x: broken}}}), 'mark_broken');
  // Formato desconhecido também é quebra.
  const unknown = {chains: {a: {g: 'g0', cut: null, root: 'outro', pending: []}}};
  expectRefused(baseInput({snapshot: {...baseInput().snapshot, marks: {x: unknown}}}), 'mark_broken');
});

test('prova: marca de geração mais nova (superseded) recusa com mark_broken', () => {
  const mark = {chains: {a: chainOf('g0', null, aliveNode('fp-x-500'))}, anchors: {a: {g: 'g9', cut: ts(5), fp: FP_A}}};
  expectRefused(baseInput({snapshot: {...baseInput().snapshot, marks: {x: mark}}}), 'mark_broken');
});

test('prova: pendência recusa com mark_pending', () => {
  const pending = {
    chains: {a: chainOf('g0', null, aliveNode('fp-x-500'), {pending: [{b: aliveNode('fp-x-700'), a: aliveNode('fp-x-900')}]})},
  };
  expectRefused(baseInput({snapshot: {...baseInput().snapshot, marks: {x: pending}}}), 'mark_pending');
});

test('prova: pendência absorvível pela cadeia não é pendência', () => {
  const absorbable = {
    chains: {a: chainOf('g0', null, aliveNode('fp-x-500'), {pending: [{b: aliveNode('fp-x-500'), a: aliveNode('fp-x-900')}]})},
  };
  const proof = proveProjectionExclusions(
    baseInput({snapshot: {...baseInput().snapshot, marks: {x: absorbable}}, read: {x: readOf('x', 900)}}),
  );
  assert.deepEqual(proof, {proven: true, applied: {x: {document: docOf('x', 900), reversal: null}}});
});

test('prova: nó vivo com impressão diferente da lida recusa com content', () => {
  expectRefused(baseInput({read: {x: readOf('x', 501)}}), 'content');
  expectRefused(baseInput({read: {x: readOf('x', 500, null)}}), 'content');
});

test('prova: lido ausente com nó vivo recusa com content', () => {
  expectRefused(baseInput({read: {}}), 'content');
});

test('prova: nó vivo com a mesma impressão devolve o documento lido', () => {
  const read = readOf('x', 500);
  const proof = proveProjectionExclusions(baseInput({read: {x: read}}));
  assert.equal(proof.proven, true);
  if (proof.proven) {
    assert.equal(proof.applied.x.document, read.document);
    assert.equal(proof.applied.x.reversal, null);
  }
});

test('prova: marca ausente, nó absent ou deleted: com o lançamento lido presente recusa com content (A02); não encontrado, document nulo', () => {
  for (const mark of [undefined, null, absentMark(), deletedMark()]) {
    const marks = mark === undefined ? {} : {x: mark};
    // A marca diz que a projeção não contém o lançamento e a leitura por id o encontrou: o gatilho ainda não aplicou
    // o conteúdo lido, ou ele entrou na projeção sem marca. Sem prova nos dois casos.
    expectRefused(baseInput({snapshot: {...baseInput().snapshot, marks}, read: {x: readOf('x', 500)}}), 'content');
    expectRefused(baseInput({snapshot: {...baseInput().snapshot, marks}, read: {x: readOf('x', 500, null)}}), 'content');
    // Não encontrado: a projeção não contém nada dele; nada a tirar.
    const proof = proveProjectionExclusions(baseInput({snapshot: {...baseInput().snapshot, marks}, read: {}}));
    assert.deepEqual(proof, {proven: true, applied: {x: {document: null, reversal: null}}});
  }
});

test('regressão A02 (revisão de arquitetura da R3): lançamento sem marca, num mês etiquetado depois por outro evento, nunca prova', () => {
  // L (R$ 800,00) gravado antes das marcas está na projeção de outubro; outra receita (R$ 200,00) etiquetou o mês.
  const input = baseInput({
    months: ['2026-10'],
    snapshot: {months: {'2026-10': month(100_000)}, marks: {}},
    basisIncome: {'2026-10': 100_000},
    excludedIds: ['L'],
    read: {L: readOf('L', 80_000)},
  });
  expectRefused(input, 'content');
});

test('prova: nenhum mês da janela existente e bases zero prova com tudo nulo (marcas são ignoradas)', () => {
  const pending = {chains: {a: chainOf('g0', null, aliveNode('fp-x-500'), {pending: [{b: aliveNode('z'), a: aliveNode('w')}]})}};
  const input = baseInput({
    snapshot: {months: {'2026-01': missing, '2026-02': missing, '2026-03': missing}, marks: {x: pending, y: liveMark('fp-y-1')}},
    basisIncome: {},
    excludedIds: ['x', 'y'],
    read: {x: readOf('x', 500), y: readOf('y', 1)},
    reversalIds: {x: 'rx'},
  });
  assert.deepEqual(proveProjectionExclusions(input), {
    proven: true,
    applied: {x: {document: null, reversal: null}, y: {document: null, reversal: null}},
  });
  // Com base maior que zero, a prova falha antes.
  expectRefused({...input, basisIncome: {'2026-02': 1}}, 'bases');
});

test('prova de estorno: recebimento e estorno vivos e conferidos dão {document, reversal}', () => {
  const input = baseInput({
    snapshot: {...baseInput().snapshot, marks: {x: liveMark('fp-x-500'), rx: liveMark('fp-rx--500')}},
    read: {x: readOf('x', 500), rx: readOf('rx', -500)},
    reversalIds: {x: 'rx'},
  });
  const proof = proveProjectionExclusions(input);
  assert.equal(proof.proven, true);
  if (proof.proven) {
    assert.equal(proof.applied.x.document, input.read.x.document);
    assert.equal(proof.applied.x.reversal, input.read.rx.document);
  }
});

test('prova de estorno: estorno lido sem marca (ou absent/deleted) recusa com content; estorno não encontrado dá reversal nulo', () => {
  const input = baseInput({read: {x: readOf('x', 500), rx: readOf('rx', -500)}, reversalIds: {x: 'rx'}});
  expectRefused(input, 'content');
  const found = {proven: true, applied: {x: {document: docOf('x', 500), reversal: null}}};
  assert.deepEqual(proveProjectionExclusions({...input, read: {x: readOf('x', 500)}}), found);
  for (const mark of [absentMark(), deletedMark()]) {
    const marks = {...input.snapshot.marks, rx: mark};
    expectRefused({...input, snapshot: {...input.snapshot, marks}}, 'content');
    assert.deepEqual(proveProjectionExclusions({...input, snapshot: {...input.snapshot, marks}, read: {x: readOf('x', 500)}}), found);
  }
});

test('prova de estorno: estorno vivo com recebimento ausente na projeção recusa com content', () => {
  const input = baseInput({
    snapshot: {...baseInput().snapshot, marks: {x: absentMark(), rx: liveMark('fp-rx--500')}},
    read: {x: readOf('x', 500), rx: readOf('rx', -500)},
    reversalIds: {x: 'rx'},
  });
  expectRefused(input, 'content');
  // Sem marca do recebimento: o mesmo.
  expectRefused({...input, snapshot: {...input.snapshot, marks: {rx: liveMark('fp-rx--500')}}}, 'content');
  // Recebimento não encontrado pela leitura por id (parte zero pela marca) e o estorno vivo e conferido na projeção:
  // a regra do par não cobre o estorno sozinho; sem prova.
  for (const marks of [{x: absentMark(), rx: liveMark('fp-rx--500')}, {rx: liveMark('fp-rx--500')}]) {
    expectRefused({...input, snapshot: {...input.snapshot, marks}, read: {rx: readOf('rx', -500)}}, 'content');
  }
});

test('prova de estorno: marca do estorno pendente, quebrada ou com conteúdo diferente recusa', () => {
  const withReversal = (mark: unknown, rx: ReadDocument = readOf('rx', -500)) =>
    baseInput({
      snapshot: {...baseInput().snapshot, marks: {x: liveMark('fp-x-500'), rx: mark}},
      read: {x: readOf('x', 500), rx},
      reversalIds: {x: 'rx'},
    });
  const pending = {chains: {a: chainOf('g0', null, aliveNode('fp-rx--500'), {pending: [{b: aliveNode('q'), a: aliveNode('w')}]})}};
  expectRefused(withReversal(pending), 'mark_pending');
  const broken = {chains: {a: chainOf('g0', null, null, {root: null, broken: 'x'})}};
  expectRefused(withReversal(broken), 'mark_broken');
  expectRefused(withReversal(liveMark('fp-rx--500'), readOf('rx', -501)), 'content');
});

test('prova: a primeira desconsiderada recusada define o motivo e vários ids são provados juntos', () => {
  const marks = {a: liveMark('fp-a-1'), b: absentMark(), c: liveMark('fp-c-3')};
  // b não foi encontrado pela leitura por id (a marca absent confirma: nada dele na projeção).
  const input = baseInput({
    snapshot: {...baseInput().snapshot, marks},
    excludedIds: ['a', 'b', 'c'],
    read: {a: readOf('a', 1), c: readOf('c', 3)},
  });
  assert.deepEqual(proveProjectionExclusions(input), {
    proven: true,
    applied: {
      a: {document: docOf('a', 1), reversal: null},
      b: {document: null, reversal: null},
      c: {document: docOf('c', 3), reversal: null},
    },
  });
  expectRefused({...input, read: {...input.read, c: readOf('c', 4)}}, 'content');
  // b encontrado com a marca absent: sem prova (A02).
  expectRefused({...input, read: {...input.read, b: readOf('b', 2)}}, 'content');
});

// --------------------------------------------- regressão T02 da R2A

test('regressão T02: leitura antiga, mudança de mês e posterior aplicado antes do predecessor', async () => {
  // T lida em v1 (março). Os eventos: e2 muda março -> fevereiro (v2 -> v3 do ponto de vista do conteúdo) e e3 foi
  // aplicado antes de e2.
  const v1 = {id: 'T', valueCents: 700, date: '2026-03-10', rev: 1};
  const v2 = {id: 'T', valueCents: 700, date: '2026-03-10', rev: 2};
  const v3 = {id: 'T', valueCents: 700, date: '2026-02-10', rev: 3};
  const [fp1, fp2, fp3] = await Promise.all([v1, v2, v3].map((doc) => transactionFingerprint(doc)));
  assert.equal(new Set([fp1, fp2, fp3]).size, 3);

  const readAt = (doc: Record<string, unknown>, fp: string): Record<string, ReadDocument> => ({T: {document: doc, fingerprint: fp}});

  // Estado intermediário: nó vivo@fp(v1) e pendência {b: vivo@fp(v2), a: vivo@fp(v3)}.
  const intermediate = {
    chains: {a: chainOf('g0', null, aliveNode(fp1), {pending: [{b: aliveNode(fp2), a: aliveNode(fp3)}]})},
  };
  const during = baseInput({
    snapshot: {...baseInput().snapshot, marks: {T: intermediate}},
    excludedIds: ['T'],
  });
  // Nunca prova, qualquer que seja a leitura.
  for (const [doc, fp] of [[v1, fp1], [v2, fp2], [v3, fp3]] as const) {
    expectRefused({...during, read: readAt(doc, fp)}, 'mark_pending');
  }

  // Depois de e2: nó vivo@fp(v3), sem pendência.
  const after = baseInput({
    snapshot: {...baseInput().snapshot, marks: {T: {chains: {a: chainOf('g0', null, aliveNode(fp3))}}}},
    excludedIds: ['T'],
  });
  expectRefused({...after, read: readAt(v1, fp1)}, 'content');
  const proof = proveProjectionExclusions({...after, read: readAt(v3, fp3)});
  assert.equal(proof.proven, true);
  if (proof.proven) {
    assert.deepEqual(proof.applied.T.document, v3);
    assert.equal(proof.applied.T.document?.date, '2026-02-10');
  }
});

// ---------------------------------------------------------- propriedade

/** Gerador pseudoaleatório determinístico (mulberry32). */
const rng = (seed: number) => {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

type Kind = 'coherent' | 'absorb' | 'anchor' | 'pending' | 'broken' | 'superseded' | 'stale';
type ReadKind = 'same' | 'newer' | 'absent' | 'nullfp';
type MonthKind = 'ok' | 'noGeneration' | 'twoGenerations' | 'none';

const CASES = 6000;

test('propriedade: só há prova com o conteúdo realmente aplicado, nunca com marca pendente ou quebrada', () => {
  const random = rng(20261109);
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
  const weighted = <T,>(items: ReadonlyArray<readonly [T, number]>): T => {
    const total = items.reduce((sum, [, weight]) => sum + weight, 0);
    let roll = random() * total;
    for (const [item, weight] of items) {
      roll -= weight;
      if (roll < 0) return item;
    }
    return items[items.length - 1][0];
  };

  const coverage = {proven: 0, refused: {generation: 0, bases: 0, mark_pending: 0, mark_broken: 0, content: 0} as Record<string, number>, aliveApplied: 0, nullApplied: 0};

  for (let index = 0; index < CASES; index += 1) {
    // Meses da janela.
    const monthKind = weighted<MonthKind>([['ok', 70], ['noGeneration', 8], ['twoGenerations', 8], ['none', 14]]);
    const cutoff = random() < 0.5 ? null : {seconds: 1000 + Math.floor(random() * 50), nanoseconds: Math.floor(random() * 1000)};
    const generation: ProjectionGeneration = {id: random() < 0.5 ? 'g0' : 'r7', cutoff};
    const genTimestamp = cutoff === null ? null : new Timestamp(cutoff.seconds, cutoff.nanoseconds);
    const months: Record<string, SnapshotMonth> = {};
    const basis: Record<string, number> = {};
    const existing = monthKind === 'none' ? [] : MONTHS.filter(() => random() < 0.8);
    if (monthKind !== 'none' && existing.length === 0) existing.push(MONTHS[1]);
    for (const name of MONTHS) {
      if (!existing.includes(name)) {
        months[name] = missing;
        continue;
      }
      const income = 100 * (1 + Math.floor(random() * 50));
      months[name] = month(income, generation);
      basis[name] = income;
    }
    if (monthKind === 'noGeneration') months[existing[0]] = {...months[existing[0]], generation: null};
    if (monthKind === 'twoGenerations' && existing.length > 1) {
      const last = existing[existing.length - 1];
      months[last] = {...months[last], generation: {id: `${generation.id}-outra`, cutoff}};
    }
    const basesBroken = random() < 0.12;
    if (basesBroken) {
      const name = pick(MONTHS);
      basis[name] = (basis[name] ?? 0) + (random() < 0.5 ? 1 : 100);
    }

    // Desconsideradas.
    const ids = Array.from({length: 1 + Math.floor(random() * 3)}, (_, i) => `t${i}`);
    const marks: Record<string, unknown> = {};
    const read: Record<string, ReadDocument> = {};
    const truth: Record<string, number | null> = {};
    const kinds: Record<string, Kind> = {};
    const readKinds: Record<string, ReadKind> = {};
    const fpOf = (id: string, version: number): string => `fp-${id}-${version}`;

    for (const id of ids) {
      const version = 1 + Math.floor(random() * 3);
      const alive = random() < 0.6;
      const kind = weighted<Kind>([['coherent', 32], ['absorb', 12], ['anchor', 12], ['pending', 12], ['broken', 8], ['superseded', 6], ['stale', 6]]);
      kinds[id] = kind;
      // O conteúdo aplicado de verdade (a visão que a marca descreve para a geração lida).
      let applied: number | null = alive ? version : null;
      const node = alive ? aliveNode(fpOf(id, version)) : pick([{k: 'absent'}, {k: 'deleted'}]);
      const noMark = !alive && kind === 'coherent' && random() < 0.4;
      switch (kind) {
        case 'coherent':
          if (!noMark) marks[id] = {chains: {a: chainOf(generation.id, genTimestamp, node)}};
          break;
        case 'absorb':
          marks[id] = random() < 0.5
            ? {chains: {a: chainOf(generation.id, genTimestamp, aliveNode(fpOf(id, 9)), {pending: [{b: aliveNode(fpOf(id, 9)), a: alive ? node : {k: 'deleted'}}]})}}
            : {chains: {a: chainOf(generation.id, genTimestamp, null, {root: null, pending: [{b: {k: 'none'}, a: alive ? node : {k: 'deleted'}}]})}};
          break;
        case 'anchor':
          // Âncora (base) e cadeia 'event' coerentes, ou âncora sem cadeia (o nó é a própria âncora).
          if (alive && random() < 0.5) {
            marks[id] = {
              anchors: {b: {g: generation.id, cut: genTimestamp, fp: fpOf(id, 8)}},
              chains: {b: chainOf(generation.id, genTimestamp, node, {root: 'event', base: fpOf(id, 8)})},
            };
          } else if (alive) {
            marks[id] = {anchors: {b: {g: generation.id, cut: genTimestamp, fp: fpOf(id, version)}}};
          } else {
            marks[id] = {anchors: {a: {g: generation.id, cut: genTimestamp, fp: fpOf(id, version)}}};
            applied = version;
          }
          break;
        case 'pending':
          marks[id] = {chains: {a: chainOf(generation.id, genTimestamp, node, {pending: [{b: aliveNode(`nunca-${id}`), a: aliveNode(fpOf(id, 7))}]})}};
          break;
        case 'broken':
          marks[id] = random() < 0.5
            ? {chains: {a: chainOf(generation.id, genTimestamp, null, {root: null, broken: pick(['pending_overflow', 'base_mismatch'])})}}
            : {chains: {a: {g: generation.id, cut: genTimestamp, root: 'desconhecida', pending: []}}};
          break;
        case 'superseded':
          marks[id] = {
            anchors: {a: {g: 'g-nova', cut: new Timestamp(5000, 0), fp: FP_A}},
            chains: {a: chainOf(generation.id, genTimestamp, node)},
          };
          break;
        case 'stale': {
          const oldCut = cutoff === null ? null : new Timestamp(cutoff.seconds - 10, 0);
          marks[id] = {chains: {a: chainOf('g-velha', oldCut, aliveNode(fpOf(id, 5)))}};
          applied = null;
          break;
        }
      }
      truth[id] = applied;

      // Leitura atual. Sem conteúdo aplicado, o "não encontrado" é o caso que prova (o encontrado recusa, A02).
      const readKind = applied === null
        ? weighted<ReadKind>([['absent', 50], ['same', 25], ['newer', 15], ['nullfp', 10]])
        : weighted<ReadKind>([['same', 55], ['newer', 25], ['absent', 12], ['nullfp', 8]]);
      readKinds[id] = readKind;
      const readVersion = applied === null ? 1 + Math.floor(random() * 3) : applied;
      if (readKind === 'same') read[id] = readOf(id, readVersion, fpOf(id, readVersion));
      else if (readKind === 'newer') read[id] = readOf(id, readVersion + 1, fpOf(id, readVersion + 1));
      else if (readKind === 'nullfp') read[id] = readOf(id, readVersion, null);
    }

    const input: ProjectionProofInput = {
      months: MONTHS,
      snapshot: {months, marks},
      basisIncome: basis,
      excludedIds: ids,
      read,
      reversalIds: {},
    };
    const proof = proveProjectionExclusions(input);

    // Oráculo independente das regras, montado a partir dos rótulos do cenário.
    const generationRefused = monthKind === 'noGeneration' || (monthKind === 'twoGenerations' && existing.length > 1);
    const basesRefused = MONTHS.some((name) => (basis[name] ?? 0) !== (months[name].exists ? months[name].incomeCents : 0));
    const noMonth = existing.length === 0;
    let expected: string | null = null;
    if (generationRefused) expected = 'generation';
    else if (basesRefused) expected = 'bases';
    else if (!noMonth) {
      for (const id of ids) {
        const kind = kinds[id];
        if (kind === 'pending') expected = 'mark_pending';
        else if (kind === 'broken' || kind === 'superseded') expected = 'mark_broken';
        else if (truth[id] !== null && readKinds[id] !== 'same') expected = 'content';
        // A02: a marca diz que a projeção não contém o lançamento, e a leitura por id o encontrou.
        else if (truth[id] === null && readKinds[id] !== 'absent') expected = 'content';
        if (expected !== null) break;
      }
    }

    if (expected !== null) {
      assert.deepEqual(proof, {proven: false, reason: expected}, `caso ${index}`);
      coverage.refused[expected] += 1;
      assert.equal(proof.proven, false);
      continue;
    }

    assert.equal(proof.proven, true, `caso ${index}`);
    if (!proof.proven) continue;
    coverage.proven += 1;
    for (const id of ids) {
      // Sem nenhum mês da janela, a projeção da janela é zero: nada a tirar. Fora isso, é o aplicado de verdade.
      const truthVersion = noMonth ? null : truth[id];
      if (truthVersion === null) {
        assert.equal(proof.applied[id].document, null, `caso ${index} ${id}`);
        coverage.nullApplied += 1;
      } else {
        assert.equal(proof.applied[id].document, read[id].document, `caso ${index} ${id}`);
        assert.deepEqual(proof.applied[id].document, docOf(id, truthVersion), `caso ${index} ${id}`);
        coverage.aliveApplied += 1;
      }
      assert.equal(proof.applied[id].reversal, null);
      if (!noMonth) {
        // Nunca há prova com marca pendente ou quebrada (fora o caso sem meses, em que as marcas não são consultadas).
        assert.ok(kinds[id] !== 'pending' && kinds[id] !== 'broken' && kinds[id] !== 'superseded', `caso ${index} ${id}`);
      }
    }
  }

  // Cobertura mínima do gerador: o teste não passa vazio.
  assert.ok(coverage.proven >= 800, `provados: ${coverage.proven}`);
  assert.ok(coverage.aliveApplied >= 600, `provados com conteúdo vivo: ${coverage.aliveApplied}`);
  assert.ok(coverage.nullApplied >= 300, `provados com conteúdo nulo: ${coverage.nullApplied}`);
  for (const reason of ['generation', 'bases', 'mark_pending', 'mark_broken', 'content']) {
    assert.ok(coverage.refused[reason] >= 100, `recusados por ${reason}: ${coverage.refused[reason]}`);
  }
  console.log(`propriedade: ${CASES} casos, cobertura ${JSON.stringify(coverage)}`);
});
