
test('ADV-5: volta ao workspace anterior com a base no cache, COM desconsiderada, antes do primeiro retorno da escuta', async () => {
  const w = world();
  standard(w);
  w.income['ws-b'] = {'2026-08': 200_000, '2026-09': 200_000, '2026-10': 200_000, '2026-11': 50_000};
  w.write('ws-b', 'r500', {date: '2026-10-20', type: 'receita', valueCents: 20_000, isPaid: true});
  w.apply('ws-b', ['r500']);
  const {renders, latest, setParams} = mount(w, params());
  await until(() => incomeOf(latest()) === 1_056_000, 'ws-a');
  await settle(60);
  setParams(params({workspaceId: 'ws-b'}));
  await until(() => incomeOf(latest()) === 580_000, 'ws-b');
  await settle(60);
  w.income['ws-a']['2026-09'] = 382_000;
  w.autoListen = false;
  const from = renders.length;
  setParams(params());
  await settle(300);
  console.log(`ADV-5 depois da volta (escuta sem retorno): ${JSON.stringify(doneIncomes(renders.slice(from)))}; último=${latest()?.status}`);
  w.publish('ws-a');
  await until(() => incomeOf(latest()) === 1_086_000, 'ws-a com a receita nova');
  await settle(60);
  console.log(`ADV-5 sequência completa: ${JSON.stringify(doneIncomes(renders.slice(from)))}`);
});
