
test('ADV-6: uma base, sem desconsiderada, a escuta mostra uma projeção que a base relida não alcança: depois das releituras, a base divergente aparece provada e sem aviso', async () => {
  const w = world();
  standard(w);
  const original = w.deps.basis.fetchReport;
  let lagging = false;
  w.deps.basis.fetchReport = async (payload) => {
    const report = await original(payload);
    if (!lagging || payload.range.kind === 'month') return report;
    // O relatório devolve setembro ainda com o valor antigo (a base não alcança a projeção).
    const points = (report as unknown as {series: {data: {points: Array<{month: string; receiptsCents: number}>}}}).series.data.points;
    for (const point of points) if (point.month === '2026-09') point.receiptsCents = 352_000;
    return report;
  };
  const {renders, latest} = mount(w, params({excludedIds: []}));
  await until(() => incomeOf(latest()) === 1_106_000, 'estimativa');
  await settle(60);
  lagging = true;
  w.income['ws-a']['2026-09'] = 382_000;
  const from = renders.length;
  const reads = w.calls.series;
  w.publish();
  await until(() => w.calls.series >= reads + 2, 'as releituras da divergência');
  await settle(400);
  console.log(`ADV-6 releituras=${w.calls.series - reads}; mostrados=${JSON.stringify(doneIncomes(renders.slice(from)))}; último=${latest()?.status} ${incomeOf(latest())} refreshFailed=${(latest() as Done).refreshFailed}`);
});
