
// ================================================================== REVISÃO ADVERSARIAL, RODADA 2 (experimento, fora do repositório)

test('ADV-7: a série relida falha durante a sincronização; com o relatório de volta e SEM clicar em "Tentar de novo", a releitura automática do agendador traz a estimativa nova', async () => {
  const w = world();
  const time = manualClock(w);
  standard(w);
  const original = w.deps.basis.fetchReport;
  let seriesFailing = false;
  let seriesFailures = 0;
  w.deps.basis.fetchReport = async (payload) => {
    if (payload.range.kind !== 'month' && seriesFailing) {
      w.calls.series += 1;
      seriesFailures += 1;
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
  await drive(time, () => latest()?.status === 'error', 'o primeiro erro da releitura');
  const failuresAtError = seriesFailures;
  // Como no E2E: o relatório volta logo depois do primeiro erro. Aqui, NINGUÉM clica em "Tentar de novo".
  seriesFailing = false;
  const reads = w.calls.series;
  await drive(time, () => incomeOf(latest()) === 1_136_000, 'a estimativa nova sem clique');
  console.log(`ADV-7 falhas até o primeiro erro=${failuresAtError}; leituras automáticas depois=${w.calls.series - reads}; mostrados=${JSON.stringify(renders.slice(from).filter((r) => r.state.status === 'done').map((r) => incomeOf(r.state)))}; último=${latest()?.status} ${incomeOf(latest())}`);
});
