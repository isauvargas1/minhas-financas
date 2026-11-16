// A01 — o corte da reconstrução é um serverTimestamp; a sonda da R3 mediu que ele fica alguns ms ANTES do
// commit do próprio checkpoint (sonda-updatetime.log: 40/40). Uma criação que commita nessa janela e cujo
// gatilho lê o estado antes do commit do checkpoint entra na projeção publicada (pela soma das marcas de
// entrega com eventTime > corte), mas não na cadeia da geração preparada: a marca diz "ausente" e o cliente
// prova a estimativa sem tirar o lançamento desconsiderado.
'use strict';
const { World, incomeDoc } = require('./mundo.cjs');

const MONTHS = ['2026-10'];
const run = async (label, { requestUs, commitUs, triggerBeforeCheckpoint, checkStaging = false, defense = false }) => {
  const w = new World();
  // Lançamento estável U (1.000,00) e o lançamento T (500,00) que o usuário desconsidera.
  const u = w.write('U', incomeDoc(100000, '2026-10-03'), 1_000_000);
  await w.deliver(u, 1_050_000);
  // O checkpoint pede o commit em `requestUs` (serverTimestamp resolvido aqui) e só commita em `commitUs`
  // (no Emulator, alguns ms depois; mais, se o commit esperar a trava de projection_state).
  const tWrite = requestUs + 4_000;
  const t = w.write('T', incomeDoc(50000, '2026-10-10'), tWrite);
  if (triggerBeforeCheckpoint) await w.deliver(t, tWrite + 1_000); // gatilho de T lê o estado antes do commit do checkpoint
  w.checkpoint(requestUs, commitUs);
  if (!triggerBeforeCheckpoint) await w.deliver(t, commitUs + 1_000);
  const page = w.readPage(commitUs + 10_000);
  if (page.restart) throw new Error('inesperado');
  w.commitPage(page, commitUs + 20_000);
  const published = w.publish(commitUs + 30_000, commitUs + 30_000, { checkStaging });
  const res = await w.prove(MONTHS, ['T']);
  const p = res.snapshot.months['2026-10'];
  const staticIncome = 100000;
  const partOfT = p.incomeCents - staticIncome; // parte de T na projeção lida
  let proven = res.proof.proven;
  if (proven && defense) {
    // Defesa sugerida no cliente: nó ausente/apagado com o lançamento encontrado -> sem prova.
    for (const [id, applied] of Object.entries(res.proof.applied)) if (applied.document === null && res.read[id]) proven = false;
  }
  const eligible = p.incomeCents - res.subtracted['2026-10'];
  const wrong = proven && eligible !== staticIncome;
  console.log(JSON.stringify({
    caso: label,
    publicacao: published.kind + (published.reason ? `:${published.reason}` : ''),
    mesLido: { incomeCents: p.incomeCents, geracao: p.generation?.id },
    parteDeTNaProjecao: partOfT,
    prova: proven ? 'VERDADEIRA' : `recusada (${res.proof.proven ? 'defesa' : res.proof.reason})`,
    tiradoPelaEstimativa: res.subtracted['2026-10'],
    receitaElegivel: proven ? eligible : null,
    correto: staticIncome,
    PROVA_VERDADEIRA_COM_VALOR_ERRADO: wrong,
  }));
  if (wrong) for (const line of w.trace) console.log('   ', line);
  return wrong;
};

(async () => {
  // Corte = commit (o que a cerca supõe): T é posterior ao corte e o gatilho vê a preparação.
  await run('corte igual ao commit, gatilho depois do checkpoint', { requestUs: 2_000_000, commitUs: 2_000_000, triggerBeforeCheckpoint: false });
  // Corte 8 ms antes do commit (valor medido no Emulator), gatilho depois do checkpoint: correto.
  await run('corte 8 ms antes, gatilho depois do commit do checkpoint', { requestUs: 2_000_000, commitUs: 2_008_000, triggerBeforeCheckpoint: false });
  // Corte antes do commit e o gatilho de T serializado ANTES do checkpoint (commit do checkpoint esperando a trava).
  const bad = await run('corte antes do commit, gatilho de T antes do commit do checkpoint', { requestUs: 2_000_000, commitUs: 2_008_000, triggerBeforeCheckpoint: true });
  // Correção 1 (backend): a publicação recomeça se uma marca de entrega posterior ao corte não alimentou a geração preparada.
  await run('mesmo caso, com a correção na publicação', { requestUs: 2_000_000, commitUs: 2_008_000, triggerBeforeCheckpoint: true, checkStaging: true });
  // Correção 2 (cliente, defesa em profundidade): "ausente" com o lançamento encontrado não prova.
  await run('mesmo caso, com a defesa no cliente', { requestUs: 2_000_000, commitUs: 2_008_000, triggerBeforeCheckpoint: true, defense: true });
  process.exit(bad ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
