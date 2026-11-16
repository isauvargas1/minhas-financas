// A02 (resíduo) — importação que não é instantâneo consistente: meses de um instante, marcas e lançamentos de
// outro. A defesa do cliente (ausente/apagado com o lançamento encontrado não prova) não cobre o nó VIVO igual
// ao lido com a projeção de outro instante: a prova sai verdadeira com valor errado até a reconstrução.
// Contradiz a frase de BACKUP_RESTORE_DR.md §3 ("a prova recusa; nunca converte errado"). Funções reais
// (cliente da árvore final), Firestore em memória.
'use strict';
const { World, P, incomeDoc } = require('./mundo.cjs');
const { clone } = require('./memfs.cjs');

(async () => {
  const w = new World();
  const u = w.write('U', incomeDoc(100000, '2026-10-03'), 1_000_000);
  await w.deliver(u, 1_010_000);
  const t1 = w.write('T', incomeDoc(30000, '2026-10-10'), 1_100_000);
  await w.deliver(t1, 1_110_000);
  // A exportação lê o mês agora (instante t1)...
  const monthAtT1 = clone(w.store.docs.get(P.month('2026-10')));
  // ...e, mais tarde na mesma exportação, as marcas e os lançamentos, depois de uma alteração de T aplicada.
  const t2 = w.write('T', incomeDoc(70000, '2026-10-10'), 1_200_000);
  await w.deliver(t2, 1_210_000);
  // Importação: meses do instante t1, marcas e lançamentos do instante t2.
  w.store.docs.set(P.month('2026-10'), monthAtT1);
  const res = await w.prove(['2026-10'], ['T']);
  const month = res.snapshot.months['2026-10'];
  const eligible = month.incomeCents - res.subtracted['2026-10'];
  console.log(JSON.stringify({ receitaDoMesImportado: month.incomeCents, parteDeTNoMes: 30000, itemTirado: res.subtracted['2026-10'],
    prova: res.proof.proven ? 'VERDADEIRA' : `recusada (${res.proof.reason})`, receitaElegivel: eligible, correto: 100000,
    PROVA_VERDADEIRA_COM_VALOR_ERRADO: res.proof.proven && eligible !== 100000 }));
})().catch((e) => { console.error(e); process.exit(2); });
