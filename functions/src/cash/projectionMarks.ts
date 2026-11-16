import {createHash} from "node:crypto";
import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";

/**
 * Marcas de aplicação da projeção de caixa (P5-F.1-R3, B03).
 *
 * A projeção mensal (`cash_report_periods`) soma deltas por entrega do
 * gatilho, em qualquer ordem, e a reconstrução a substitui por valores
 * absolutos. Ela não diz, sozinha, qual estado de cada lançamento contém. A
 * marca de um lançamento diz isso, por **geração** da projeção (a inicial
 * `g0`, ou a de uma reconstrução publicada), e é escrita na mesma transação
 * que move a projeção.
 *
 * Invariante (INV-M), para cada lançamento `T` e geração `G`:
 *
 *   parte de `T` em `P_G` = efeito(nó) + Σ deltas das pendências
 *
 * - `nó`: o estado de `T` refletido (`ausente`, `vivo@fp` ou `apagado`);
 * - pendências: eventos já somados à projeção que chegaram antes do
 *   predecessor (fora de ordem).
 *
 * A identidade de um estado é a **impressão digital do conteúdo** (`fp`), e
 * não o `updatedAt`: no Firestore Emulator, o `updatedAt` gravado com
 * `serverTimestamp()` difere do `updateTime` e tem precisão de milissegundo
 * (sonda da R3). Conteúdos iguais têm o mesmo efeito na projeção, então
 * casar por conteúdo preserva a INV-M. Ordem e corte
 * continuam no `updateTime` do Admin SDK, exato.
 *
 * Duas posições (`a` e `b`): a geração vigente fica numa (`markSlot` no
 * estado da projeção) e a preparada por uma reconstrução, sempre na outra.
 * `anchors` é escrito pela varredura (o lançamento estava na base, com aquele
 * conteúdo); `chains`, pelo gatilho. Uma cadeia `broken` vale só para a sua
 * geração: a reconstrução seguinte começa outra, na outra posição.
 *
 * Nada aqui guarda valor, descrição, data, categoria ou preferência.
 */

export const CASH_PROJECTION_MARKS_COLLECTION = "cash_projection_marks";
export const CASH_PROJECTION_MARK_SCHEMA_VERSION = 1;

/** Teto de eventos fora de ordem por cadeia; acima dele, `broken`. */
export const MAX_MARK_PENDING = 16;

export type MarkSlot = "a" | "b";
export const MARK_SLOTS: readonly MarkSlot[] = ["a", "b"];
export const DEFAULT_MARK_SLOT: MarkSlot = "a";
export const otherMarkSlot = (slot: MarkSlot): MarkSlot =>
  slot === "a" ? "b" : "a";
export const isMarkSlot = (value: unknown): value is MarkSlot =>
  value === "a" || value === "b";

// ------------------------------------------------------- impressão digital

/** Documento fora do que a serialização canônica conhece: nunca é ignorado. */
export class FingerprintTypeError extends Error {
  constructor(readonly fieldPath: string) {
    super(`tipo não suportado na impressão digital: ${fieldPath}`);
    this.name = "FingerprintTypeError";
  }
}

const isTimestampLike = (value: object): value is {
  seconds: number;
  nanoseconds: number;
} => typeof (value as {toMillis?: unknown}).toMillis === "function" &&
  Number.isSafeInteger((value as {seconds?: unknown}).seconds) &&
  Number.isSafeInteger((value as {nanoseconds?: unknown}).nanoseconds);

const isGeoPointLike = (value: object): value is {
  latitude: number;
  longitude: number;
} => typeof (value as {isEqual?: unknown}).isEqual === "function" &&
  typeof (value as {latitude?: unknown}).latitude === "number" &&
  typeof (value as {longitude?: unknown}).longitude === "number";

const isReferenceLike = (value: object): value is {path: string} =>
  typeof (value as {path?: unknown}).path === "string" &&
  typeof (value as {id?: unknown}).id === "string" &&
  "firestore" in value;

const isPlainObject = (value: object): boolean => {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const canonicalNumber = (value: number): unknown =>
  Number.isFinite(value) ? (Object.is(value, -0) ? 0 : value) :
    {$n: String(value)};

/**
 * Serialização canônica de um valor do Firestore, com marcação de tipo e
 * chaves ordenadas. Mapas vão como `{$m: [[chave, valor], ...]}`, então uma
 * chave chamada `$t` nunca se confunde com um `Timestamp`. A mesma regra está
 * no leitor do cliente que confere as marcas; a paridade é provada pela
 * fixture `tests/fixtures/transaction-fingerprints.json` e pela leitura real
 * dos dois SDKs no Emulator.
 */
export const canonicalFirestoreValue = (
  value: unknown,
  fieldPath = "",
): unknown => {
  if (value === null) return null;
  switch (typeof value) {
  case "boolean":
  case "string":
    return value;
  case "number":
    return canonicalNumber(value);
  case "object":
    break;
  default:
    throw new FingerprintTypeError(fieldPath || "(raiz)");
  }
  const object = value as object;
  if (Array.isArray(object)) {
    return object.map((item, index) =>
      canonicalFirestoreValue(item, `${fieldPath}[${index}]`));
  }
  if (isTimestampLike(object)) {
    return {$t: [object.seconds, object.nanoseconds]};
  }
  if (object instanceof Uint8Array) {
    return {$b: Buffer.from(object).toString("base64")};
  }
  if (isGeoPointLike(object)) return {$g: [object.latitude, object.longitude]};
  if (isReferenceLike(object)) return {$r: object.path};
  if (!isPlainObject(object)) {
    throw new FingerprintTypeError(fieldPath || "(raiz)");
  }
  const entries = Object.keys(object).sort().map((key) => [
    key,
    canonicalFirestoreValue(
      (object as Record<string, unknown>)[key],
      fieldPath ? `${fieldPath}.${key}` : key,
    ),
  ]);
  return {$m: entries};
};

/** SHA-256 (hex) da serialização canônica do documento inteiro. */
export const transactionFingerprint = (
  data: admin.firestore.DocumentData,
): string => createHash("sha256")
  .update(JSON.stringify(canonicalFirestoreValue(data)))
  .digest("hex");

// ------------------------------------------------------------------ estado

export type MarkNode =
  | {k: "absent"}
  | {k: "alive"; fp: string}
  | {k: "deleted"};

/** Estado anterior de um evento: nenhum (criação) ou um conteúdo. */
export type MarkBefore = {k: "none"} | {k: "alive"; fp: string};

/** Estado posterior de um evento: um conteúdo, ou apagado. */
export type MarkAfter = {k: "alive"; fp: string} | {k: "deleted"};

export interface MarkPending {
  b: MarkBefore;
  a: MarkAfter;
}

/** Como o nó inicial da geração foi estabelecido. */
export type MarkRoot = "anchor" | "event" | "absent";

export interface MarkChain {
  /** Geração (`g0` ou o `rebuildId` da reconstrução). */
  g: string;
  /** Corte da geração (`null` na inicial). */
  cut: Timestamp | null;
  /** `null`: sem raiz ainda (só em preparação), com eventos pendentes. */
  root: MarkRoot | null;
  /** Impressão do estado na base (raízes `anchor` e `event`). */
  base: string | null;
  node: MarkNode | null;
  pending: MarkPending[];
  broken: string | null;
}

export interface MarkAnchor {
  g: string;
  cut: Timestamp | null;
  fp: string;
}

export interface MarkDoc {
  anchors: Partial<Record<MarkSlot, MarkAnchor>>;
  chains: Partial<Record<MarkSlot, MarkChain>>;
}

/** Geração vista por quem escreve: identidade, posição e papel. */
export interface MarkGeneration {
  id: string;
  cutoff: Timestamp | null;
  slot: MarkSlot;
  /** `published`: a vigente (base definitiva); `staging`: em preparação. */
  role: "published" | "staging";
}

export type MarkView =
  | {kind: "broken"; code: string}
  | {kind: "unrooted"; pending: MarkPending[]}
  | {
    kind: "rooted";
    root: MarkRoot;
    base: string | null;
    node: MarkNode;
    pending: MarkPending[];
  };

/** Evento entregue pelo gatilho, já reduzido ao que a cadeia precisa. */
export interface MarkEvent {
  before: MarkBefore;
  after: MarkAfter;
  /** `updateTime` do estado anterior (UPDATE e DELETE), para a raiz `event`. */
  beforeUpdateTime: Timestamp | null;
}

export const compareMarkTimes = (left: Timestamp, right: Timestamp): number =>
  left.seconds !== right.seconds ?
    left.seconds - right.seconds :
    left.nanoseconds - right.nanoseconds;

const isNonexistent = (node: MarkNode): boolean =>
  node.k === "absent" || node.k === "deleted";

/** O evento parte do estado que o nó representa. */
export const markMatches = (node: MarkNode, before: MarkBefore): boolean =>
  before.k === "none" ?
    isNonexistent(node) :
    node.k === "alive" && node.fp === before.fp;

/** Absorve, em ordem, toda pendência que passa a casar com o nó. */
export const absorbPending = (
  node: MarkNode,
  pending: readonly MarkPending[],
): {node: MarkNode; pending: MarkPending[]} => {
  let current = node;
  const remaining = [...pending];
  for (;;) {
    const index = remaining.findIndex((item) => markMatches(current, item.b));
    if (index < 0) return {node: current, pending: remaining};
    current = remaining[index].a;
    remaining.splice(index, 1);
  }
};

const rooted = (
  root: MarkRoot,
  base: string | null,
  node: MarkNode,
  pending: readonly MarkPending[],
): MarkView => ({kind: "rooted", root, base, ...absorbPending(node, pending)});

/**
 * A marca vista para uma geração: âncora da varredura e cadeia do gatilho da
 * mesma geração (pelo `g`), com a raiz resolvida (§5 do desenho).
 *
 * - âncora presente: o nó inicial é o conteúdo da âncora; uma cadeia com raiz
 *   `absent`, ou com outra base, é conflito (`broken`);
 * - geração publicada sem âncora: o lançamento não está na base (a varredura
 *   grava a âncora de todo documento da base antes de publicar); uma cadeia
 *   com raiz `anchor` ou `event` é conflito;
 * - geração em preparação sem âncora: a cadeia vale como está (raiz
 *   provisória), ou fica sem raiz.
 */
export const markViewOf = (
  doc: MarkDoc,
  generation: MarkGeneration,
): MarkView => {
  const anchorRaw = doc.anchors[generation.slot];
  const chainRaw = doc.chains[generation.slot];
  const anchor = anchorRaw?.g === generation.id ? anchorRaw : null;
  const chain = chainRaw?.g === generation.id ? chainRaw : null;
  if (chain?.broken) return {kind: "broken", code: chain.broken};
  if (anchor) {
    if (!chain) {
      return rooted("anchor", anchor.fp, {k: "alive", fp: anchor.fp}, []);
    }
    if (chain.root === "absent") {
      return {kind: "broken", code: "anchor_after_absent"};
    }
    if (chain.root === null) {
      return rooted("anchor", anchor.fp, {k: "alive", fp: anchor.fp},
        chain.pending);
    }
    if (chain.base !== anchor.fp || chain.node === null) {
      return {kind: "broken", code: "anchor_mismatch"};
    }
    return rooted(chain.root, chain.base, chain.node, chain.pending);
  }
  if (generation.role === "published") {
    if (!chain) return rooted("absent", null, {k: "absent"}, []);
    if (chain.root === null) {
      return rooted("absent", null, {k: "absent"}, chain.pending);
    }
    if (chain.root !== "absent" || chain.node === null) {
      return {kind: "broken", code: "base_without_anchor"};
    }
    return rooted("absent", null, chain.node, chain.pending);
  }
  if (!chain) return {kind: "unrooted", pending: []};
  if (chain.root === null) {
    return {kind: "unrooted", pending: [...chain.pending]};
  }
  if (chain.root === "anchor" || chain.node === null) {
    return {kind: "broken", code: "anchor_missing"};
  }
  return rooted(chain.root, chain.base, chain.node, chain.pending);
};

const withPending = (
  view: Extract<MarkView, {kind: "rooted" | "unrooted"}>,
  event: MarkEvent,
): MarkView => {
  if (view.pending.length >= MAX_MARK_PENDING) {
    return {kind: "broken", code: "pending_overflow"};
  }
  const item: MarkPending = {b: event.before, a: event.after};
  return {...view, pending: [...view.pending, item]};
};

/**
 * Aplica à visão de uma geração um evento cujo delta **foi somado** à
 * projeção dessa geração. Função pura e total: estado inesperado vira
 * `broken`, nunca exceção.
 */
export const applyMarkEvent = (
  view: MarkView,
  event: MarkEvent,
  generation: MarkGeneration,
): MarkView => {
  if (view.kind === "broken") return view;
  if (view.kind === "unrooted") {
    if (event.before.k === "none") {
      return applyMarkEvent(rooted("absent", null, {k: "absent"}, view.pending),
        event, generation);
    }
    const covered = event.beforeUpdateTime !== null &&
      generation.cutoff !== null &&
      compareMarkTimes(event.beforeUpdateTime, generation.cutoff) <= 0;
    if (covered) {
      // O estado anterior é o do corte: é a base desta geração.
      return applyMarkEvent(
        rooted("event", event.before.fp, {k: "alive", fp: event.before.fp},
          view.pending),
        event, generation);
    }
    return withPending(view, event);
  }
  if (!markMatches(view.node, event.before)) return withPending(view, event);
  return rooted(view.root, view.base, event.after, view.pending);
};

/** A cadeia a gravar para uma visão (o `broken` guarda só o código). */
export const markChainOf = (
  view: MarkView,
  generation: MarkGeneration,
): MarkChain => {
  const head = {g: generation.id, cut: generation.cutoff};
  if (view.kind === "broken") {
    return {...head, root: null, base: null, node: null, pending: [],
      broken: view.code};
  }
  if (view.kind === "unrooted") {
    return {...head, root: null, base: null, node: null,
      pending: view.pending, broken: null};
  }
  return {...head, root: view.root, base: view.base, node: view.node,
    pending: view.pending, broken: null};
};

// -------------------------------------------------------------- leitura

const readNode = (value: unknown): MarkNode | null => {
  if (typeof value !== "object" || value === null) return null;
  const node = value as Record<string, unknown>;
  if (node.k === "absent") return {k: "absent"};
  if (node.k === "deleted") return {k: "deleted"};
  if (node.k === "alive" && typeof node.fp === "string") {
    return {k: "alive", fp: node.fp};
  }
  return null;
};

const readBefore = (value: unknown): MarkBefore | null => {
  if (typeof value !== "object" || value === null) return null;
  const before = value as Record<string, unknown>;
  if (before.k === "none") return {k: "none"};
  if (before.k === "alive" && typeof before.fp === "string") {
    return {k: "alive", fp: before.fp};
  }
  return null;
};

const readAfter = (value: unknown): MarkAfter | null => {
  const node = readNode(value);
  return node && node.k !== "absent" ? node : null;
};

const readCut = (value: unknown): Timestamp | null | undefined =>
  value === null ? null : value instanceof Timestamp ? value : undefined;

const ROOTS: readonly MarkRoot[] = ["anchor", "event", "absent"];

/**
 * Cadeia gravada, ou `broken` quando o documento não fecha com o formato:
 * nunca uma cadeia inventada a partir de dado incompleto.
 */
const readChain = (value: unknown): MarkChain | null => {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const cut = readCut(raw.cut);
  if (typeof raw.g !== "string" || cut === undefined) return null;
  const head = {g: raw.g, cut};
  const broken = (code: string): MarkChain => ({...head, root: null,
    base: null, node: null, pending: [], broken: code});
  if (typeof raw.broken === "string") return broken(raw.broken);
  const root = raw.root === null ? null :
    ROOTS.includes(raw.root as MarkRoot) ? raw.root as MarkRoot : undefined;
  if (root === undefined || !Array.isArray(raw.pending)) {
    return broken("invalid_chain");
  }
  const pending: MarkPending[] = [];
  for (const item of raw.pending) {
    const b = readBefore((item as Record<string, unknown> | null)?.b);
    const a = readAfter((item as Record<string, unknown> | null)?.a);
    if (!b || !a) return broken("invalid_chain");
    pending.push({b, a});
  }
  const node = readNode(raw.node);
  const base = typeof raw.base === "string" ? raw.base : null;
  if (root !== null && node === null) return broken("invalid_chain");
  return {...head, root, base, node: root === null ? null : node, pending,
    broken: null};
};

const readAnchor = (value: unknown): MarkAnchor | null => {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const cut = readCut(raw.cut);
  if (typeof raw.g !== "string" || typeof raw.fp !== "string" ||
    cut === undefined) {
    return null;
  }
  return {g: raw.g, cut, fp: raw.fp};
};

export const readMarkDoc = (
  data: admin.firestore.DocumentData | undefined,
): MarkDoc => {
  const doc: MarkDoc = {anchors: {}, chains: {}};
  const anchors = (data?.anchors ?? {}) as Record<string, unknown>;
  const chains = (data?.chains ?? {}) as Record<string, unknown>;
  for (const slot of MARK_SLOTS) {
    const anchor = readAnchor(anchors[slot]);
    if (anchor) doc.anchors[slot] = anchor;
    const chain = readChain(chains[slot]);
    if (chain) doc.chains[slot] = chain;
  }
  return doc;
};

// -------------------------------------------------------------- escrita

export const cashProjectionMarkRef = (
  workspaceId: string,
  transactionId: string,
): admin.firestore.DocumentReference =>
  admin.firestore().doc(
    `workspaces/${workspaceId}/${CASH_PROJECTION_MARKS_COLLECTION}/` +
      transactionId,
  );

/**
 * Documento inteiro da marca, para `set` sem merge pelo gatilho: a transação
 * leu a marca, então as âncoras lidas voltam como estavam (uma âncora gravada
 * depois da leitura invalida a transação, que relê).
 */
export const markDocumentData = (
  workspaceId: string,
  transactionId: string,
  doc: MarkDoc,
): admin.firestore.DocumentData => ({
  schemaVersion: CASH_PROJECTION_MARK_SCHEMA_VERSION,
  workspaceId,
  transactionId,
  anchors: {...doc.anchors},
  chains: {...doc.chains},
  updatedAt: FieldValue.serverTimestamp(),
});

/**
 * Só as componentes (âncora e cadeia de cada posição) das gerações que ainda
 * contam: a vigente e a preparada por uma reconstrução em andamento. As de
 * geração superada ou de preparação abandonada ninguém lê (o backend filtra
 * pelo `g`; o cliente lê a geração dos meses, que a publicação etiqueta toda
 * de uma vez) e saem na próxima regravação da marca, em vez de guardar sem
 * finalidade as impressões de versões antigas (revisão de privacidade da
 * P5-F.1-R3, L-PRI-02).
 */
export const pruneMarkDoc = (
  doc: MarkDoc,
  generations: readonly string[],
): MarkDoc => {
  const keep = new Set(generations);
  const pruned: MarkDoc = {anchors: {}, chains: {}};
  for (const slot of MARK_SLOTS) {
    const anchor = doc.anchors[slot];
    if (anchor && keep.has(anchor.g)) pruned.anchors[slot] = anchor;
    const chain = doc.chains[slot];
    if (chain && keep.has(chain.g)) pruned.chains[slot] = chain;
  }
  return pruned;
};

/**
 * Âncora da varredura, gravada sem ler a marca (`set` com merge só da
 * posição): os campos da âncora são sempre os três, e a cadeia fica intacta.
 */
export const markAnchorPatch = (
  workspaceId: string,
  transactionId: string,
  slot: MarkSlot,
  anchor: MarkAnchor,
): admin.firestore.DocumentData => ({
  schemaVersion: CASH_PROJECTION_MARK_SCHEMA_VERSION,
  workspaceId,
  transactionId,
  anchors: {[slot]: {g: anchor.g, cut: anchor.cut, fp: anchor.fp}},
  updatedAt: FieldValue.serverTimestamp(),
});

/** Evento da cadeia a partir do par antes/depois da entrega. */
export const markEventOf = (
  before: admin.firestore.DocumentData | undefined,
  after: admin.firestore.DocumentData | undefined,
  beforeUpdateTime: Timestamp | null,
): MarkEvent => ({
  before: before ? {k: "alive", fp: transactionFingerprint(before)} :
    {k: "none"},
  after: after ? {k: "alive", fp: transactionFingerprint(after)} :
    {k: "deleted"},
  beforeUpdateTime: before ? beforeUpdateTime : null,
});
