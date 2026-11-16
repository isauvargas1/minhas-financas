// A02 — "sem âncora e sem cadeia = ausente" só é verdade se toda escrita da história do workspace passou pelo
// gatilho com marcas (R3). Um lançamento anterior à implantação (ou restaurado/importado sem passar pelo
// gatilho) está na projeção da geração g0 sem marca nenhuma; o primeiro delta da R3 em cada mês grava a
// etiqueta g0, e daí em diante a prova o trata como "ausente": nada é tirado.
'use strict';
const { World, P, WS, incomeDoc, tsOfUs } = require('./mundo.cjs');
const { FieldValue } = require('firebase-admin/firestore');
const admin = require('firebase-admin');

(async () => {
  const w = new World();
  // Estado anterior à R3: o lançamento L (800,00) e o mês 2026-10 já somado pelo gatilho antigo (sem etiqueta, sem marca).
  const tx = w.store.tx();
  tx.set(admin.firestore().doc(P.tx('L')), { ...incomeDoc(80000, '2026-10-02'), updatedAt: FieldValue.serverTimestamp() });
  tx.set(admin.firestore().doc(P.month('2026-10')), { id: '2026-10', workspaceId: WS, period: '2026-10', incomeCents: 80000,
    netCents: 80000, transactionCount: 1, schemaVersion: 5, updatedAt: FieldValue.serverTimestamp() });
  tx.commit(1_000_000, 1_000_000);
  // Antes de qualquer escrita da R3 no mês: sem etiqueta, sem prova.
  let res = await w.prove(['2026-10'], ['L']);
  console.log(JSON.stringify({ momento: 'mês sem etiqueta', prova: res.proof.proven ? 'VERDADEIRA' : `recusada (${res.proof.reason})` }));
  // Depois da implantação, outra receita do mês (código R3) grava a etiqueta g0 no mês.
  const n = w.write('N', incomeDoc(20000, '2026-10-20'), 5_000_000);
  await w.deliver(n, 5_100_000);
  res = await w.prove(['2026-10'], ['L']);
  const month = res.snapshot.months['2026-10'];
  const eligible = month.incomeCents - res.subtracted['2026-10'];
  const correct = 20000;
  console.log(JSON.stringify({ momento: 'mês com etiqueta g0 (primeiro delta da R3)', geracao: month.generation?.id,
    receitaDoMes: month.incomeCents, prova: res.proof.proven ? 'VERDADEIRA' : `recusada (${res.proof.reason})`,
    itemTirado: res.subtracted['2026-10'], receitaElegivel: eligible, correto: correct,
    PROVA_VERDADEIRA_COM_VALOR_ERRADO: res.proof.proven && eligible !== correct }));
  process.exit(res.proof.proven && eligible !== correct ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
