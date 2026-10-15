/* P5-D2.1 §11 — cenários de volume contra o Emulator (instrumentação).
 * Semeia recebíveis autoritativos + itens da fila no formato do domínio,
 * mais um histórico de recebíveis já avisados (confirmação, sem fila), e
 * executa a rotina real com os limites de produção até esvaziar.
 * Conta leituras/escritas por interceptação do SDK. Saída: JSON.
 * Cenário concentrado (sufixo "s", ex.: 20000s): 90% dos itens num único
 * workspace; mede se os demais são atendidos já na primeira execução. */
const LIB = "/home/user/minhas-financas/functions/lib/";
const admin = require("/home/user/minhas-financas/functions/node_modules/firebase-admin");
if (!admin.apps.length) admin.initializeApp({projectId: "minhas-financas-local"});
const {mock} = require("node:test");
const fs = require("node:fs");
const {runReceivableOverdueNotifications} = require(LIB + "notifications/producers/receivables.js");
const {notificationIdFor} = require(LIB + "notifications/ids.js");
const {addDaysToDayKey} = require(LIB + "shared/dateKeys.js");
const db = admin.firestore();
const {Timestamp, Query, Transaction, DocumentReference} = admin.firestore;
const {AggregateQuery} = require("/home/user/minhas-financas/functions/node_modules/@google-cloud/firestore/build/src/reference/aggregate-query.js");
const TODAY = "2031-03-10";
const NOW = Date.parse("2031-03-10T10:00:00-03:00");

const counters = () => ({queryCalls: 0, queryDocs: 0, queryReads: 0, countCalls: 0, countReads: 0,
  txRuns: 0, getAllCalls: 0, getAllDocs: 0, txCreate: 0, txDelete: 0, txUpdate: 0, refUpdate: 0});
let c = counters();
const wrap = (proto, name, fn) => { const orig = proto[name]; mock.method(proto, name, function (...args) { return fn.call(this, orig, args); }); };
wrap(Query.prototype, "get", async function (orig, args) { const snap = await orig.apply(this, args); c.queryCalls++; c.queryDocs += snap.size; c.queryReads += Math.max(1, snap.size); return snap; });
wrap(AggregateQuery.prototype, "get", async function (orig, args) { const snap = await orig.apply(this, args); c.countCalls++; const n = snap.data().count; c.countReads += Math.max(1, Math.ceil(n / 1000)); return snap; });
wrap(Transaction.prototype, "getAll", function (orig, args) { c.getAllCalls++; c.getAllDocs += args.length; return orig.apply(this, args); });
wrap(Transaction.prototype, "create", function (orig, args) { c.txCreate++; return orig.apply(this, args); });
wrap(Transaction.prototype, "delete", function (orig, args) { c.txDelete++; return orig.apply(this, args); });
wrap(Transaction.prototype, "update", function (orig, args) { c.txUpdate++; return orig.apply(this, args); });
wrap(DocumentReference.prototype, "update", function (orig, args) { c.refUpdate++; return orig.apply(this, args); });
wrap(admin.firestore.Firestore.prototype, "runTransaction", function (orig, args) { c.txRuns++; return orig.apply(this, args); });

const receivable = (ws, id, dueDate, balanceCents = 100000) => ({schemaVersion: 1, id, workspaceId: ws, clientId: "c-bench",
  description: "Bench", category: null, dueDate, createdBy: "u-bench", revision: 1, requestHash: "h", updatedAt: Timestamp.now(),
  amountCents: 100000, principalReceivedCents: 100000 - balanceCents, discountGrantedCents: 0, interestReceivedCents: 0,
  penaltyReceivedCents: 0, activeReceiptCount: balanceCents === 100000 ? 0 : 1, balanceCents, status: "open"});

const commitAll = async (writes) => {
  for (let i = 0; i < writes.length; i += 450) {
    const batch = db.batch();
    for (const [ref, data] of writes.slice(i, i + 450)) batch.set(ref, data);
    await batch.commit();
  }
};

const scenario = async (n, workspaces, history, brokenRatio, skewed = false) => {
  const tag = `bench-n${n}-${Date.now().toString(36)}`;
  const wss = Array.from({length: workspaces}, (_, i) => `${tag}-w${String(i).padStart(2, "0")}`);
  const expected = new Map(wss.map((ws) => [ws, new Set()]));
  const broken = [];
  const writes = [];
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    // concentrado: 9 de cada 10 itens no workspace 0; o resto em rodízio
    const ws = skewed ? (i % 10 !== 0 ? wss[0] : wss[1 + ((i / 10) % (workspaces - 1))]) : wss[i % workspaces];
    const id = `r${i}`;
    // antigos e novos: de ontem até ~3 anos atrás
    const dueDate = addDaysToDayKey(TODAY, -(1 + ((i * 7919) % 1100)));
    const isBroken = i % Math.round(1 / brokenRatio) === 0;
    const data = receivable(ws, id, dueDate);
    if (isBroken) { data.balanceCents = 1; broken.push([ws, id]); } else expected.get(ws).add(id);
    writes.push([db.doc(`workspaces/${ws}/receivables/${id}`), data]);
    writes.push([db.doc(`workspaces/${ws}/receivable_overdue_queue/${id}`), {schemaVersion: 1, workspaceId: ws, receivableId: id,
      dueDate, runAfterDay: addDaysToDayKey(dueDate, 1), attempts: 0, lastErrorCode: null, lastAttemptAt: null, updatedAt: Timestamp.now()}]);
  }
  // histórico já avisado: recebível aberto + confirmação, sem item na fila
  for (let i = 0; i < history; i++) {
    const ws = wss[i % workspaces];
    const id = `h${i}`;
    const dueDate = addDaysToDayKey(TODAY, -(30 + (i % 900)));
    writes.push([db.doc(`workspaces/${ws}/receivables/${id}`), receivable(ws, id, dueDate)]);
    const nid = notificationIdFor({workspaceId: ws, domain: "receivable", entityId: id, eventType: "receivable_overdue", episode: dueDate});
    writes.push([db.doc(`workspaces/${ws}/receivable_overdue_deliveries/${nid}`), {schemaVersion: 1, workspaceId: ws,
      receivableId: id, episode: dueDate, notificationId: nid, origin: "published", runId: "hist", deliveredAt: Timestamp.now()}]);
  }
  await commitAll(writes);
  const seedMs = Date.now() - t0;
  const runs = [];
  for (let round = 0; round < 60; round++) {
    c = counters();
    const started = Date.now();
    const s = await runReceivableOverdueNotifications({today: TODAY, nowMs: NOW, runId: `${tag}-${round}`});
    runs.push({round, wallMs: Date.now() - started, ...s, ops: c,
      reads: c.queryReads + c.countReads + c.getAllDocs, writes: c.txCreate + c.txDelete + c.txUpdate + c.refUpdate});
    if (round === 0) {
      // atendidos por workspace já na 1ª execução (justiça entre workspaces)
      runs[0].publishedByWorkspace = {};
      for (const ws of wss) {
        runs[0].publishedByWorkspace[ws] = (await db.collection(`workspaces/${ws}/notifications`).count().get()).data().count;
      }
    }
    if (s.scanned === 0) break;
  }
  // verificação por conjunto: IDs notificados por workspace == esperados
  let setsOk = true; let notices = 0; let deliveries = 0;
  for (const ws of wss) {
    const got = new Set((await db.collection(`workspaces/${ws}/notifications`).select("receivableId").get()).docs.map((d) => d.get("receivableId")));
    notices += got.size;
    const exp = expected.get(ws);
    if (got.size !== exp.size || [...exp].some((id) => !got.has(id))) setsOk = false;
    deliveries += (await db.collection(`workspaces/${ws}/receivable_overdue_deliveries`).count().get()).data().count;
  }
  const brokenKept = (await Promise.all(broken.map(([ws, id]) => db.doc(`workspaces/${ws}/receivable_overdue_queue/${id}`).get())))
    .every((snap) => snap.exists && snap.get("lastErrorCode") === "receivable_invalid");
  const work = runs.filter((r) => r.scanned > 0);
  const expectedByWorkspace = Object.fromEntries(wss.map((ws) => [ws, expected.get(ws).size]));
  const othersServedInFirstRun = wss.slice(1).every((ws) =>
    runs[0].publishedByWorkspace[ws] === expected.get(ws).size);
  return {n, skewed, workspaces, history, broken: broken.length, expectedByWorkspace,
    firstRunByWorkspace: runs[0].publishedByWorkspace, othersServedInFirstRun, expectedPublished: n - broken.length, seedMs,
    runsUntilEmpty: work.length, totalPublished: runs.reduce((a, r) => a + r.published, 0),
    maxPerRun: Math.max(...runs.map((r) => r.published)), setsOk, notices, deliveriesIncludingHistory: deliveries, brokenKept,
    totalReads: runs.reduce((a, r) => a + r.reads, 0), totalWrites: runs.reduce((a, r) => a + r.writes, 0),
    idleRun: runs[runs.length - 1], firstRun: runs[0], outcomes: runs.map((r) => r.outcome),
    perRun: runs.map((r) => ({round: r.round, wallMs: r.wallMs, scanned: r.scanned, published: r.published, invalid: r.invalid,
      pages: r.pages, throttled: r.throttled, deferred: r.deferred, retriedSameDay: r.retriedSameDay,
      budgetExhausted: r.budgetExhausted, pendingDueAtEnd: r.pendingDueAtEnd, backlog: r.backlog, reads: r.reads,
      writes: r.writes, outcome: r.outcome}))};
};

(async () => {
  const plan = (process.argv[2] || "100,1000,5000,10000,50000,20000s").split(",");
  const out = [];
  for (const entry of plan) {
    const skewed = entry.endsWith("s");
    const n = Number(skewed ? entry.slice(0, -1) : entry);
    const workspaces = n >= 1000 ? 10 : 2;
    const history = Math.min(n, 10000);
    const r = await scenario(n, workspaces, history, 0.01, skewed);
    console.error(JSON.stringify({n: r.n, skewed, runs: r.runsUntilEmpty, published: r.totalPublished,
      expected: r.expectedPublished, setsOk: r.setsOk, brokenKept: r.brokenKept, reads: r.totalReads,
      writes: r.totalWrites, maxPerRun: r.maxPerRun, othersServedInFirstRun: r.othersServedInFirstRun}));
    out.push(r);
    fs.writeFileSync(process.argv[3], JSON.stringify(out, null, 2));
  }
})().catch((e) => { console.error(e); process.exit(1); });
