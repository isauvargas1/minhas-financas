/**
 * Prova da estimativa pelas marcas de aplicação da projeção (P5-F.1-R3, B03). Módulo PURO: sem React, sem
 * Firebase, imports com extensão `.ts`.
 *
 * O backend grava, na mesma transação que move a projeção mensal (`cash_report_periods`), a marca de cada
 * lançamento (`cash_projection_marks/{id}`): qual conteúdo dele a projeção contém, por geração da projeção
 * (`functions/src/cash/projectionMarks.ts`, invariante INV-M). O cliente lê, numa transação só de leitura, os
 * meses da janela e as marcas das desconsideradas e dos espelhos de estorno: as duas coisas no mesmo instante,
 * sem relógio e sem comparar horários. Os lançamentos são lidos por id, com a impressão digital do conteúdo.
 *
 * A estimativa só é provada quando, para cada desconsiderada (e o estorno dela), a marca da geração dos meses
 * lidos está íntegra e sem pendências e:
 * - diz `vivo@fp`, e o lançamento lido tem essa impressão: o item usa esse conteúdo (é o que a projeção soma);
 * - ou diz `ausente`/`apagado`: a projeção não tem nada do lançamento, e nada é tirado.
 * Com o mesmo conteúdo, o efeito na projeção é o mesmo; com outro, a prova falha e a leitura é refeita.
 *
 * As regras de visão da marca são as do backend (`markViewOf`, papel "publicada"), com paridade provada pela
 * fixture `tests/fixtures/projection-mark-views.json`; a impressão digital, pela fixture
 * `tests/fixtures/transaction-fingerprints.json` e por leitura real dos dois SDKs no Emulator.
 */
import { compareServerVersions, serverVersionOf, type MonthlyIncome, type ServerVersion } from '../reports/basisRefresh.ts';

// ------------------------------------------------------- impressão digital

/** Documento com um tipo que a serialização canônica não conhece: nunca é ignorado (a prova falha). */
export class FingerprintTypeError extends Error {
  readonly fieldPath: string;
  constructor(fieldPath: string) {
    super(`tipo não suportado na impressão digital: ${fieldPath}`);
    this.name = 'FingerprintTypeError';
    this.fieldPath = fieldPath;
  }
}

const isTimestampLike = (value: object): value is { seconds: number; nanoseconds: number } =>
  typeof (value as { toMillis?: unknown }).toMillis === 'function' &&
  Number.isSafeInteger((value as { seconds?: unknown }).seconds) &&
  Number.isSafeInteger((value as { nanoseconds?: unknown }).nanoseconds);

const isGeoPointLike = (value: object): value is { latitude: number; longitude: number } =>
  typeof (value as { isEqual?: unknown }).isEqual === 'function' &&
  typeof (value as { latitude?: unknown }).latitude === 'number' &&
  typeof (value as { longitude?: unknown }).longitude === 'number';

const isReferenceLike = (value: object): value is { path: string } =>
  typeof (value as { path?: unknown }).path === 'string' && typeof (value as { id?: unknown }).id === 'string' && 'firestore' in value;

const isBytesLike = (value: object): value is { toBase64: () => string } =>
  typeof (value as { toBase64?: unknown }).toBase64 === 'function' && typeof (value as { toUint8Array?: unknown }).toUint8Array === 'function';

const isPlainObject = (value: object): boolean => {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const base64Of = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

/** A mesma serialização canônica do backend (`canonicalFirestoreValue`), com os tipos do SDK web. */
export const canonicalFirestoreValue = (value: unknown, fieldPath = ''): unknown => {
  if (value === null) return null;
  if (typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? (Object.is(value, -0) ? 0 : value) : { $n: String(value) };
  if (typeof value !== 'object') throw new FingerprintTypeError(fieldPath || '(raiz)');
  if (Array.isArray(value)) return value.map((item, index) => canonicalFirestoreValue(item, `${fieldPath}[${index}]`));
  if (isTimestampLike(value)) return { $t: [value.seconds, value.nanoseconds] };
  if (value instanceof Uint8Array) return { $b: base64Of(value) };
  if (isBytesLike(value)) return { $b: value.toBase64() };
  if (isGeoPointLike(value)) return { $g: [value.latitude, value.longitude] };
  if (isReferenceLike(value)) return { $r: value.path };
  if (!isPlainObject(value)) throw new FingerprintTypeError(fieldPath || '(raiz)');
  const record = value as Record<string, unknown>;
  return {
    $m: Object.keys(record).sort().map((key) => [key, canonicalFirestoreValue(record[key], fieldPath ? `${fieldPath}.${key}` : key)]),
  };
};

/** SHA-256 (hex) da serialização canônica do documento inteiro, como lido do servidor (antes de normalizar). */
export const transactionFingerprint = async (data: Record<string, unknown>): Promise<string> => {
  const text = JSON.stringify(canonicalFirestoreValue(data));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

// ------------------------------------------------------------------ marcas

export type MarkNode = { k: 'absent' } | { k: 'alive'; fp: string } | { k: 'deleted' };
type MarkBefore = { k: 'none' } | { k: 'alive'; fp: string };
type MarkAfter = { k: 'alive'; fp: string } | { k: 'deleted' };
interface MarkPending { b: MarkBefore; a: MarkAfter }
type MarkRoot = 'anchor' | 'event' | 'absent';
type MarkSlot = 'a' | 'b';
const SLOTS: readonly MarkSlot[] = ['a', 'b'];

interface MarkChain {
  g: string;
  cut: ServerVersion | null;
  root: MarkRoot | null;
  base: string | null;
  node: MarkNode | null;
  pending: MarkPending[];
  broken: string | null;
}

interface MarkAnchor {
  g: string;
  cut: ServerVersion | null;
  fp: string;
}

export interface MarkDoc {
  anchors: Partial<Record<MarkSlot, MarkAnchor>>;
  chains: Partial<Record<MarkSlot, MarkChain>>;
}

/** A geração da projeção que os meses lidos mostram (`projectionGeneration` de cada mês). */
export interface ProjectionGeneration {
  id: string;
  cutoff: ServerVersion | null;
}

export type MarkView =
  | { kind: 'broken'; code: string }
  | { kind: 'rooted'; node: MarkNode; pending: number };

const readNode = (value: unknown): MarkNode | null => {
  if (typeof value !== 'object' || value === null) return null;
  const node = value as Record<string, unknown>;
  if (node.k === 'absent') return { k: 'absent' };
  if (node.k === 'deleted') return { k: 'deleted' };
  return node.k === 'alive' && typeof node.fp === 'string' ? { k: 'alive', fp: node.fp } : null;
};

const readBefore = (value: unknown): MarkBefore | null => {
  if (typeof value !== 'object' || value === null) return null;
  const before = value as Record<string, unknown>;
  if (before.k === 'none') return { k: 'none' };
  return before.k === 'alive' && typeof before.fp === 'string' ? { k: 'alive', fp: before.fp } : null;
};

const readAfter = (value: unknown): MarkAfter | null => {
  const node = readNode(value);
  return node && node.k !== 'absent' ? node : null;
};

/** `null` para a geração inicial; `undefined` quando o corte não é um `Timestamp`. */
const readCut = (value: unknown): ServerVersion | null | undefined => (value === null ? null : serverVersionOf(value) ?? undefined);

const ROOTS: readonly MarkRoot[] = ['anchor', 'event', 'absent'];

const readChain = (value: unknown): MarkChain | null => {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const cut = readCut(raw.cut);
  if (typeof raw.g !== 'string' || cut === undefined) return null;
  const broken = (code: string): MarkChain => ({ g: raw.g as string, cut, root: null, base: null, node: null, pending: [], broken: code });
  if (typeof raw.broken === 'string') return broken(raw.broken);
  const root = raw.root === null ? null : ROOTS.includes(raw.root as MarkRoot) ? (raw.root as MarkRoot) : undefined;
  if (root === undefined || !Array.isArray(raw.pending)) return broken('invalid_chain');
  const pending: MarkPending[] = [];
  for (const item of raw.pending) {
    const b = readBefore((item as Record<string, unknown> | null)?.b);
    const a = readAfter((item as Record<string, unknown> | null)?.a);
    if (!b || !a) return broken('invalid_chain');
    pending.push({ b, a });
  }
  const node = readNode(raw.node);
  if (root !== null && node === null) return broken('invalid_chain');
  return { g: raw.g, cut, root, base: typeof raw.base === 'string' ? raw.base : null, node: root === null ? null : node, pending, broken: null };
};

const readAnchor = (value: unknown): MarkAnchor | null => {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const cut = readCut(raw.cut);
  if (typeof raw.g !== 'string' || typeof raw.fp !== 'string' || cut === undefined) return null;
  return { g: raw.g, cut, fp: raw.fp };
};

/** Marca lida do servidor (`null`: não existe). */
export const readMarkDoc = (data: unknown): MarkDoc => {
  const doc: MarkDoc = { anchors: {}, chains: {} };
  if (typeof data !== 'object' || data === null) return doc;
  const anchors = ((data as Record<string, unknown>).anchors ?? {}) as Record<string, unknown>;
  const chains = ((data as Record<string, unknown>).chains ?? {}) as Record<string, unknown>;
  for (const slot of SLOTS) {
    const anchor = readAnchor(anchors[slot]);
    if (anchor) doc.anchors[slot] = anchor;
    const chain = readChain(chains[slot]);
    if (chain) doc.chains[slot] = chain;
  }
  return doc;
};

const matches = (node: MarkNode, before: MarkBefore): boolean =>
  before.k === 'none' ? node.k === 'absent' || node.k === 'deleted' : node.k === 'alive' && node.fp === before.fp;

const absorb = (node: MarkNode, pending: readonly MarkPending[]): MarkView => {
  let current = node;
  const remaining = [...pending];
  for (;;) {
    const index = remaining.findIndex((item) => matches(current, item.b));
    if (index < 0) return { kind: 'rooted', node: current, pending: remaining.length };
    current = remaining[index].a;
    remaining.splice(index, 1);
  }
};

const newer = (cut: ServerVersion | null, than: ServerVersion | null): boolean =>
  cut !== null && (than === null || compareServerVersions(cut, than) > 0);

/**
 * A marca vista para a geração dos meses lidos (sempre publicada), com as regras do backend: âncora presente dá o
 * nó inicial; sem âncora, o lançamento não está na base; conflito vira `broken`. A âncora e a cadeia da geração
 * são procuradas pelo `g` nas duas posições; um componente de geração mais nova na mesma posição (que só a leitura
 * fora do mesmo instante poderia mostrar) também tira a prova.
 */
export const markViewFor = (doc: MarkDoc, generation: ProjectionGeneration): MarkView => {
  const anchorSlot = SLOTS.find((slot) => doc.anchors[slot]?.g === generation.id);
  const chainSlot = SLOTS.find((slot) => doc.chains[slot]?.g === generation.id);
  if (anchorSlot !== undefined && chainSlot !== undefined && anchorSlot !== chainSlot) return { kind: 'broken', code: 'slot_mismatch' };
  const slot = anchorSlot ?? chainSlot;
  const slots = slot === undefined ? SLOTS : [slot];
  for (const candidate of slots) {
    const others = [doc.anchors[candidate], doc.chains[candidate]].filter((part) => part !== undefined && part.g !== generation.id);
    if (others.some((part) => newer(part?.cut ?? null, generation.cutoff))) return { kind: 'broken', code: 'superseded' };
  }
  const anchor = anchorSlot === undefined ? null : doc.anchors[anchorSlot] ?? null;
  const chain = chainSlot === undefined ? null : doc.chains[chainSlot] ?? null;
  if (chain?.broken) return { kind: 'broken', code: chain.broken };
  if (anchor) {
    if (!chain) return { kind: 'rooted', node: { k: 'alive', fp: anchor.fp }, pending: 0 };
    if (chain.root === 'absent') return { kind: 'broken', code: 'anchor_after_absent' };
    if (chain.root === null) return absorb({ k: 'alive', fp: anchor.fp }, chain.pending);
    if (chain.base !== anchor.fp || chain.node === null) return { kind: 'broken', code: 'anchor_mismatch' };
    return absorb(chain.node, chain.pending);
  }
  if (!chain) return { kind: 'rooted', node: { k: 'absent' }, pending: 0 };
  if (chain.root === null) return absorb({ k: 'absent' }, chain.pending);
  if (chain.root !== 'absent' || chain.node === null) return { kind: 'broken', code: 'base_without_anchor' };
  return absorb(chain.node, chain.pending);
};

// ------------------------------------------------------------------- prova

/** Um mês da janela como a transação de leitura o viu. */
export interface SnapshotMonth {
  exists: boolean;
  incomeCents: number;
  generation: ProjectionGeneration | null;
}

/** O que a transação de leitura devolve: os meses da janela e as marcas, no mesmo instante. */
export interface ProjectionMarksRead {
  months: Readonly<Record<string, SnapshotMonth>>;
  /** Marca por id (`null`: não existe). */
  marks: Readonly<Record<string, unknown>>;
}

/** Um lançamento lido por id: o documento normalizado e a impressão digital do conteúdo bruto. */
export interface ReadDocument {
  document: Record<string, unknown>;
  fingerprint: string | null;
}

export type ProjectionProofReason =
  /** Sem etiqueta de geração, ou com etiquetas diferentes entre os meses lidos. */
  | 'generation'
  /** A receita das bases não é a dos meses lidos na transação. */
  | 'bases'
  /** A marca de algum lançamento tem evento fora de ordem esperando o anterior (o gatilho ainda vai aplicar). */
  | 'mark_pending'
  /** A marca de algum lançamento está quebrada ou fora da geração: só uma reconstrução recupera. */
  | 'mark_broken'
  /**
   * O lançamento lido não é o conteúdo que a projeção contém (o gatilho ainda não aplicou, ou já aplicou outro), ou a
   * marca diz que a projeção não o contém e a leitura por id o encontrou.
   */
  | 'content';

/** O conteúdo de cada desconsiderada (e do estorno) que a projeção contém; `null` quando ela não contém nada. */
export interface AppliedExclusion {
  document: Record<string, unknown> | null;
  reversal: Record<string, unknown> | null;
}

export type ProjectionProof =
  | { proven: true; applied: Readonly<Record<string, AppliedExclusion>> }
  | { proven: false; reason: ProjectionProofReason };

export interface ProjectionProofInput {
  months: readonly string[];
  snapshot: ProjectionMarksRead;
  /** Receita das bases por mês. */
  basisIncome: MonthlyIncome;
  excludedIds: readonly string[];
  /** Lidos por id: desconsideradas e espelhos de estorno. */
  read: Readonly<Record<string, ReadDocument>>;
  /** Espelho do estorno de cada desconsiderada que é recebimento de cliente. */
  reversalIds: Readonly<Record<string, string>>;
}

const sameGeneration = (a: ProjectionGeneration, b: ProjectionGeneration): boolean =>
  a.id === b.id && (a.cutoff === null ? b.cutoff === null : b.cutoff !== null && compareServerVersions(a.cutoff, b.cutoff) === 0);

/** Etiqueta da geração gravada num mês (`projectionGeneration`), ou `null` quando ausente ou malformada. */
export const generationOf = (value: unknown): ProjectionGeneration | null => {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const cutoff = readCut(raw.cutoff);
  return typeof raw.id === 'string' && raw.id !== '' && cutoff !== undefined ? { id: raw.id, cutoff } : null;
};

/** O conteúdo que a projeção contém de um lançamento, pela marca: o lido (mesma impressão), nenhum, ou sem prova. */
const appliedOf = (
  id: string,
  generation: ProjectionGeneration | null,
  snapshot: ProjectionMarksRead,
  read: Readonly<Record<string, ReadDocument>>,
): { document: Record<string, unknown> | null } | ProjectionProofReason => {
  // Sem nenhum mês na janela, a projeção da janela é zero: nada de nenhum lançamento a tirar.
  if (generation === null) return { document: null };
  const view = markViewFor(readMarkDoc(snapshot.marks[id] ?? null), generation);
  if (view.kind === 'broken') return 'mark_broken';
  if (view.pending > 0) return 'mark_pending';
  // Nó ausente ou apagado: a projeção não contém o lançamento. Lido presente pela leitura por id, ou o gatilho
  // ainda não aplicou o conteúdo lido (passageiro), ou o lançamento entrou na projeção sem marca (dado anterior
  // às marcas, restauração ou importação sem reconstrução): sem prova nos dois casos. Recusa a mais, nunca prova a
  // mais (revisão de arquitetura da P5-F.1-R3, A02).
  if (view.node.k !== 'alive') return read[id] ? 'content' : { document: null };
  const found = read[id];
  if (!found || found.fingerprint === null || found.fingerprint !== view.node.fp) return 'content';
  return { document: found.document };
};

export const proveProjectionExclusions = (input: ProjectionProofInput): ProjectionProof => {
  let generation: ProjectionGeneration | null = null;
  for (const month of input.months) {
    const seen = input.snapshot.months[month];
    if (!seen?.exists) continue;
    if (seen.generation === null) return { proven: false, reason: 'generation' };
    if (generation === null) generation = seen.generation;
    else if (!sameGeneration(generation, seen.generation)) return { proven: false, reason: 'generation' };
  }
  for (const month of input.months) {
    const seen = input.snapshot.months[month];
    if ((input.basisIncome[month] ?? 0) !== (seen?.exists ? seen.incomeCents : 0)) return { proven: false, reason: 'bases' };
  }
  const applied: Record<string, AppliedExclusion> = {};
  for (const id of input.excludedIds) {
    const own = appliedOf(id, generation, input.snapshot, input.read);
    if (typeof own === 'string') return { proven: false, reason: own };
    const reversalId = input.reversalIds[id];
    let reversal: Record<string, unknown> | null = null;
    if (reversalId !== undefined) {
      const other = appliedOf(reversalId, generation, input.snapshot, input.read);
      if (typeof other === 'string') return { proven: false, reason: other };
      reversal = other.document;
      // O estorno na projeção sem o recebimento: caso que a regra do B01 não cobre; sem prova.
      if (reversal !== null && own.document === null) return { proven: false, reason: 'content' };
    }
    applied[id] = { document: own.document, reversal };
  }
  return { proven: true, applied };
};
