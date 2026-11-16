// A04 — pendência que nunca é absorvida, sem registro nenhum: exclusão física e recriação com o mesmo id,
// entregues fora de ordem (recriação primeiro). Todas as entregas chegam; a projeção fica certa; a marca fica
// com pendências para sempre; markRecoveryNeeded continua falso. Funções reais num Firestore em memória.
'use strict';
const { World, incomeDoc } = require('./mundo.cjs');

(async () => {
  const w = new World();
  const e1 = w.write('T', incomeDoc(30000, '2026-10-05'), 1_000_000); // criação (A)
  const e2 = w.write('T', null, 1_100_000); // exclusão física (só Admin SDK)
  const e3 = w.write('T', incomeDoc(45000, '2026-10-06'), 1_200_000); // recriação com o mesmo id (B)
  await w.deliver(e3, 1_300_000);
  await w.deliver(e1, 1_400_000);
  await w.deliver(e2, 1_500_000);
  const res = await w.prove(['2026-10'], ['T']);
  const state = w.state();
  console.log(JSON.stringify({
    receitaDoMes: res.snapshot.months['2026-10'].incomeCents,
    conteudoAtual: 45000,
    prova: res.proof.proven ? 'VERDADEIRA' : `recusada (${res.proof.reason})`,
    markRecoveryNeeded: state.markRecoveryNeeded, needsRebuild: state.needsRebuild, markIssueCount: state.markIssueCount,
    todasAsEntregasFeitas: true,
  }));
})().catch((e) => { console.error(e); process.exit(2); });
