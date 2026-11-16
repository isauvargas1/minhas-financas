// Sonda F2 (revisão financeira P5-F.1-R3): a visão do cliente (`markViewFor`, busca a geração pelo `g` nas duas
// posições) nunca pode ser menos conservadora que a do backend (`markViewOf`, posição do estado, papel "publicada").
// Gera documentos de marca realistas (gerações em posições alternadas, cortes crescentes, preparações abandonadas,
// restos de gerações antigas) e compara. Violação: o cliente diz "enraizada, sem pendência, nó N" e o backend diz
// outra coisa (quebrada, pendente ou outro nó).
// Uso: node --experimental-strip-types sonda-f2-visao-cliente-backend.mjs <WT>
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const WT = process.argv[2];
const require = createRequire(`${WT}/functions/package.json`);
const { Timestamp } = require('firebase-admin/firestore');
const marks = require(`${WT}/functions/lib/cash/projectionMarks.js`);
const client = await import(pathToFileURL(`${WT}/src/modules/work-time/projectionProof.ts`).href);

let seed = 7;
const random = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const pick = (items) => items[Math.floor(random() * items.length)];
const FPS = ['fpA', 'fpB', 'fpC'];
const node = () => pick([{ k: 'absent' }, { k: 'deleted' }, { k: 'alive', fp: pick(FPS) }, null]);
const before = () => pick([{ k: 'none' }, { k: 'alive', fp: pick(FPS) }]);
const after = () => pick([{ k: 'deleted' }, { k: 'alive', fp: pick(FPS) }]);
const chainFor = (g, cut) => {
  if (random() < 0.15) return { g, cut, root: null, base: null, node: null, pending: [], broken: pick(['pending_overflow', 'anchor_mismatch']) };
  const root = pick(['anchor', 'event', 'absent', null]);
  const pending = Array.from({ length: pick([0, 0, 0, 1, 2]) }, () => ({ b: before(), a: after() }));
  return { g, cut, root, base: root === 'anchor' || root === 'event' ? pick(FPS) : null, node: root === null ? null : node(), pending, broken: null };
};

let compared = 0;
let clientClean = 0;
const violations = [];
for (let i = 0; i < 300000; i += 1) {
  // Linha do tempo: g0 em a; reconstruções publicadas alternam a posição; cortes crescentes.
  const published = [{ id: 'g0', cut: null, slot: 'a' }];
  const count = pick([0, 1, 2, 3]);
  for (let r = 1; r <= count; r += 1) {
    const previous = published[published.length - 1];
    published.push({ id: `r${r}`, cut: Timestamp.fromMillis(1_000_000 * r), slot: previous.slot === 'a' ? 'b' : 'a' });
  }
  const current = published[published.length - 1];
  // Possível preparação em andamento (ou abandonada) na outra posição, com corte depois do vigente.
  const stagingSlot = current.slot === 'a' ? 'b' : 'a';
  const staging = random() < 0.5 ? { id: `s${i}`, cut: Timestamp.fromMillis(1_000_000 * (count + 1) + 500), slot: stagingSlot } : null;
  // Quem pode ter gravado cada posição: gerações publicadas daquela posição e a preparação.
  const writersOf = (slot) => [...published.filter((g) => g.slot === slot), ...(staging && staging.slot === slot ? [staging] : [])];
  const raw = { anchors: {}, chains: {} };
  for (const slot of ['a', 'b']) {
    const writers = writersOf(slot);
    if (writers.length === 0) continue;
    if (random() < 0.6) {
      const g = pick(writers);
      if (g.id !== 'g0') raw.anchors[slot] = { g: g.id, cut: g.cut, fp: pick(FPS) };
    }
    if (random() < 0.7) {
      const g = pick(writers);
      raw.chains[slot] = chainFor(g.id, g.cut);
    }
  }
  const backendView = marks.markViewOf(marks.readMarkDoc(raw), { id: current.id, cutoff: current.cut, slot: current.slot, role: 'published' });
  const clientView = client.markViewFor(client.readMarkDoc(raw), { id: current.id, cutoff: current.cut === null ? null : { seconds: current.cut.seconds, nanoseconds: current.cut.nanoseconds } });
  compared += 1;
  if (clientView.kind === 'rooted' && clientView.pending === 0) {
    clientClean += 1;
    const ok = backendView.kind === 'rooted' && backendView.pending.length === 0 &&
      JSON.stringify(backendView.node) === JSON.stringify(clientView.node);
    if (!ok && violations.length < 10) violations.push({ raw, current: current.id, backendView, clientView });
  }
}
console.log(JSON.stringify({ compared, clientClean, violations: violations.length }));
for (const item of violations) console.log(JSON.stringify(item));
