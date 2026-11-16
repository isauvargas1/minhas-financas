
// ================================================================== REVISÃO ADVERSARIAL (experimentos, fora do repositório)

const doneIncomes = (renders: readonly Render[]) => renders
  .filter((render) => render.state.status === 'done')
  .map((render) => `${incomeOf(render.state)}${(render.state as Done).refreshFailed ? '+aviso' : ''}`);

test('ADV-1: volta ao workspace anterior com a base no cache do React Query, uma base e sem desconsiderada, antes do primeiro retorno da escuta', async () => {
  const w = world();
  standard(w);
  w.income['ws-b'] = {'2026-08': 200_000, '2026-09': 200_000, '2026-10': 200_000, '2026-11': 50_000};
  const {renders, latest, setParams} = mount(w, params({excludedIds: []}));
  await until(() => incomeOf(latest()) === 1_106_000, 'ws-a');
  await settle(60);
  setParams(params({excludedIds: [], workspaceId: 'ws-b'}));
  await until(() => incomeOf(latest()) === 600_000, 'ws-b');
  await settle(60);
  // Outra sessão lança R$ 300,00 em setembro de ws-a (nenhuma escuta de ws-a aberta agora).
  w.income['ws-a']['2026-09'] = 382_000;
  // A escuta de ws-a demora a ter retorno do servidor (por exemplo, sem rede: só cache local).
  w.autoListen = false;
  const from = renders.length;
  const seriesBefore = w.calls.series;
  setParams(params({excludedIds: []}));
  await settle(300);
  console.log(`ADV-1 depois da volta (escuta sem retorno): ${JSON.stringify(doneIncomes(renders.slice(from)))}; último=${latest()?.status} ${incomeOf(latest())}; leituras da série=${w.calls.series - seriesBefore}`);
  w.publish('ws-a');
  await until(() => incomeOf(latest()) === 1_136_000, 'ws-a com a receita nova');
  await settle(60);
  console.log(`ADV-1 sequência completa: ${JSON.stringify(doneIncomes(renders.slice(from)))}`);
});

test('ADV-2: escuta encerrada com uma base e sem desconsiderada: a conversão continua, com aviso imediato', async () => {
  const w = world();
  standard(w);
  const {renders, latest} = mount(w, params({excludedIds: []}));
  await until(() => incomeOf(latest()) === 1_106_000, 'ws-a');
  await settle(60);
  const from = renders.length;
  w.failListen();
  await settle(60);
  // Outra sessão lança R$ 300,00 em setembro: com a escuta encerrada, nada relê.
  w.income['ws-a']['2026-09'] = 382_000;
  await settle(300);
  console.log(`ADV-2 com a escuta encerrada: ${JSON.stringify([...new Set(doneIncomes(renders.slice(from)))])}; último=${latest()?.status} refreshFailed=${(latest() as Done).refreshFailed}`);
  // O primeiro render depois do erro já traz o aviso?
  const firstAfter = renders.slice(from).find((render) => render.state.status === 'done');
  console.log(`ADV-2 primeira renderização depois do erro: ${firstAfter ? doneIncomes([firstAfter]) : 'nenhuma'}`);
});

test('ADV-3: troca de conta (uid) com a prova pendente: nada da conta anterior aparece', async () => {
  const w = world();
  standard(w);
  const {renders, latest, setUid} = mount(w, params());
  await until(() => incomeOf(latest()) === 1_056_000, 'u1 provado');
  await settle(60);
  const from = divergeWithoutTrigger(w, renders);
  await until(() => w.calls.byIds >= 2 && w.calls.marks >= 2, 'relido, sem prova');
  await settle(100);
  const switched = renders.length;
  setUid('u2');
  await settle(300);
  const afterSwitch = renders.slice(switched);
  console.log(`ADV-3 depois da troca de conta: ${JSON.stringify(doneIncomes(afterSwitch))}; uids=${JSON.stringify([...new Set(afterSwitch.map((r) => r.uid))])}; último=${latest()?.status} ${incomeOf(latest())}`);
  assertNoConversion(renders.slice(from, switched), 'antes da troca, sem prova');
});
