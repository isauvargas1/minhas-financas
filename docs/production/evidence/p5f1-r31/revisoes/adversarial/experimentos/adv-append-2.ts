
test('ADV-4: a série relida falha durante a sincronização (uma base, sem desconsiderada): erro com "Tentar de novo", sem conversão; com o relatório de volta, o "Tentar de novo" do erro traz a estimativa nova', async () => {
  const w = world();
  standard(w);
  const original = w.deps.basis.fetchReport;
  let seriesFailing = false;
  w.deps.basis.fetchReport = async (payload) => {
    if (payload.range.kind !== 'month' && seriesFailing) {
      w.calls.series += 1;
      await wait(2);
      throw new Error('Não foi possível carregar o relatório. Tente novamente.');
    }
    return original(payload);
  };
  const {renders, latest} = mount(w, params({excludedIds: []}));
  await until(() => incomeOf(latest()) === 1_106_000, 'estimativa');
  await settle(60);
  seriesFailing = true;
  w.income['ws-a']['2026-09'] = 382_000;
  const from = renders.length;
  w.publish();
  await until(() => latest()?.status === 'error', 'o erro da releitura');
  await settle(300);
  const failed = latest() as Failed;
  console.log(`ADV-4 com a série falhando: mostrados=${JSON.stringify(doneIncomes(renders.slice(from)))}; último=${failed.status} "${failed.message}"`);
  seriesFailing = false;
  const reads = w.calls.series;
  act(() => failed.retry());
  await until(() => incomeOf(latest()) === 1_136_000, 'a estimativa nova pelo "Tentar de novo" do erro');
  await settle(100);
  console.log(`ADV-4 depois do "Tentar de novo": leituras=${w.calls.series - reads}; mostrados=${JSON.stringify(doneIncomes(renders.slice(from)))}; refreshFailed=${(latest() as Done).refreshFailed}`);
});
