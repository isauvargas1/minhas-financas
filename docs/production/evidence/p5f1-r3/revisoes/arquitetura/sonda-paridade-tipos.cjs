// Paridade da impressão digital entre os dois SDKs, com objetos REAIS de cada SDK construídos localmente
// (nenhuma leitura, nenhuma rede): Timestamp, GeoPoint, DocumentReference, bytes, números especiais, mapas
// aninhados e chaves com caracteres especiais. Backend: functions/src/cash/projectionMarks.ts; cliente:
// src/modules/work-time/projectionProof.ts (ambos pelo bundle em build/).
'use strict';
const path = require('node:path');
const { createRequire } = require('node:module');
const WT = process.env.WT;
const admin = require('firebase-admin');
if (admin.apps.length === 0) admin.initializeApp({ projectId: 'sonda-pura-sem-rede' });
const A = require('firebase-admin/firestore');
const web = createRequire(path.join(WT, 'package.json'));
const { initializeApp } = web('firebase/app');
const W = web('firebase/firestore');
const B = require('./build/backend.cjs');
const C = require('./build/client.cjs');

const app = initializeApp({ projectId: 'sonda-pura-sem-rede', apiKey: 'x' }, 'sonda');
const wdb = W.getFirestore(app);
const adb = admin.firestore();

const bytes = [0, 1, 2, 250, 255, 128];
const pairs = {
  timestamp: [new A.Timestamp(1790000000, 123456000), new W.Timestamp(1790000000, 123456000)],
  timestampNegativo: [new A.Timestamp(-5, 999999000), new W.Timestamp(-5, 999999000)],
  geopoint: [new A.GeoPoint(-23.55, -46.63), new W.GeoPoint(-23.55, -46.63)],
  referencia: [adb.doc('workspaces/w1/transactions/t1'), W.doc(wdb, 'workspaces/w1/transactions/t1')],
  bytes: [Buffer.from(bytes), W.Bytes.fromUint8Array(new Uint8Array(bytes))],
  numeros: [{ i: 1, d: 1.5, z: -0, nan: NaN, inf: -Infinity, big: 2 ** 53 + 2 }, { i: 1, d: 1.5, z: -0, nan: NaN, inf: -Infinity, big: 2 ** 53 + 2 }],
  mapa: [{ 'z': 1, 'a': { 'b': [true, null, 'ç'], '$t': 'x' }, '': 0 }, { '': 0, 'a': { '$t': 'x', 'b': [true, null, 'ç'] }, 'z': 1 }],
};
const out = {};
let ok = true;
(async () => {
  for (const [name, [adminValue, webValue]] of Object.entries(pairs)) {
    const back = JSON.stringify(B.canonicalFirestoreValue({ campo: adminValue }));
    const front = JSON.stringify(C.canonicalFirestoreValue({ campo: webValue }));
    const fpBack = B.transactionFingerprint({ campo: adminValue });
    const fpFront = await C.transactionFingerprint({ campo: webValue });
    out[name] = { igual: back === front && fpBack === fpFront, backend: back.slice(0, 120), cliente: front.slice(0, 120) };
    ok = ok && out[name].igual;
  }
  // VectorValue: os dois lados recusam (falha, nunca ignorado).
  const vectors = {};
  try { B.canonicalFirestoreValue({ v: A.FieldValue.vector([1, 2]) }); vectors.backend = 'aceito'; } catch (e) { vectors.backend = e.name; }
  try { C.canonicalFirestoreValue({ v: W.vector([1, 2]) }); vectors.cliente = 'aceito'; } catch (e) { vectors.cliente = e.name; }
  out.vetor = vectors;
  console.log(JSON.stringify(out, null, 1));
  process.exit(ok ? 0 : 1);
})();
