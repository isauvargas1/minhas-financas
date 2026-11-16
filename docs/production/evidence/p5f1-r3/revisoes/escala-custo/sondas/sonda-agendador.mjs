// Sonda (revisão escala/custo P5-F.1-R3): quantas releituras o agendador REAL (`createLiveRefreshScheduler`,
// src/modules/reports/liveRefresh.ts) dispara quando a prova fica "passageira" para sempre (A04): cada
// releitura termina depois de L ms e a prova continua sem prova, o que notifica de novo
// (`useIncomeEstimateWith.ts`, efeito de `staleExcluded`). Relógio simulado; sem rede.
const WT = process.argv[2];
const { createLiveRefreshScheduler, LIVE_REFRESH_COALESCE_MS, LIVE_REFRESH_BURST, LIVE_REFRESH_REFILL_MS } = await import(`${WT}/src/modules/reports/liveRefresh.ts`);
const queryKeysSrc = (await import('node:fs')).readFileSync(`${WT}/src/modules/reports/queryKeys.ts`, 'utf8');
const m = queryKeysSrc.match(/FINANCIAL_REPORT_BASIS_REFRESH = \{\s*coalesceMs: ([\d_]+),\s*burst: (\d+),\s*refillMs: ([\d_]+),/);
const BASIS = { coalesceMs: Number(m[1].replace(/_/g, '')), burst: Number(m[2]), refillMs: Number(m[3].replace(/_/g, '')) };
const simulate = (options, latencyMs, horizonMs) => {
  let now = 0; const timers = new Map(); let id = 0;
  const clock = { now: () => now, setTimer: (run, ms) => { id += 1; timers.set(id, { at: now + ms, run }); return id; }, clearTimer: (h) => { timers.delete(h); } };
  let fires = 0; const firesAt = [];
  let scheduler;
  scheduler = createLiveRefreshScheduler(() => {
    fires += 1; firesAt.push(now);
    // a releitura termina depois de L ms e a prova continua passageira: nova notificação
    clock.setTimer(() => scheduler.notify(), latencyMs);
  }, clock, options);
  scheduler.notify();
  while (true) {
    let next = null; for (const [k, t] of timers) if (next === null || t.at < timers.get(next).at) next = k;
    if (next === null) break;
    const t = timers.get(next); if (t.at > horizonMs) break;
    timers.delete(next); now = t.at; t.run();
  }
  const firstHour = firesAt.filter((t) => t < 3_600_000).length;
  const lastHour = firesAt.filter((t) => t >= horizonMs - 3_600_000).length;
  return { fires, primeiraHora: firstHour, ultimaHora: lastHour };
};
const out = {
  orcamentoBasesEProva: BASIS,
  orcamentoDashboard: { coalesceMs: LIVE_REFRESH_COALESCE_MS, burst: LIVE_REFRESH_BURST, refillMs: LIVE_REFRESH_REFILL_MS },
  provaPassageiraPara24h_L1s: simulate(BASIS, 1_000, 24 * 3_600_000),
  provaPassageiraPara24h_L10s: simulate(BASIS, 10_000, 24 * 3_600_000),
  dashboardEscritaContinua24h_L1s: simulate({ coalesceMs: LIVE_REFRESH_COALESCE_MS, burst: LIVE_REFRESH_BURST, refillMs: LIVE_REFRESH_REFILL_MS }, 1_000, 24 * 3_600_000),
};
console.log(JSON.stringify(out, null, 1));
