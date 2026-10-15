import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { REPORT_PRESETS, createReportCallables, reportErrorMessage } from '../../src/modules/reports/official.ts';
import {
  monthRange,
  presetRange,
  rangeKey,
  rangeLabel,
  sectionsKey,
} from '../../src/modules/reports/range.ts';
import {
  FINANCIAL_REPORT_KEY,
  financialReportKey,
  invalidateFinancialReports,
} from '../../src/modules/reports/queryKeys.ts';

test('P5-C1 — faixas do seletor viram faixas "preset" do contrato', () => {
  for (const preset of REPORT_PRESETS) {
    assert.deepEqual(presetRange(preset), { kind: 'preset', preset });
  }
  assert.equal(rangeKey(presetRange('12m')), 'preset:12m');
  assert.equal(rangeKey(monthRange(new Date(2026, 9, 5))), 'month:2026-10');
  assert.equal(rangeLabel(presetRange('7d')), 'Últimos 7 dias');
  assert.equal(rangeLabel(presetRange('all')), 'Todo o Período');
  assert.equal(rangeLabel({ kind: 'month', month: '2026-03' }), 'Mês 03/2026');
});

test('P5-C1 — mês do Dashboard sai dos campos locais do seletor, não de toISOString', () => {
  assert.deepEqual(monthRange(new Date(2026, 0, 1, 0, 5)), { kind: 'month', month: '2026-01' });
  assert.deepEqual(monthRange(new Date(2026, 9, 31, 23, 59)), { kind: 'month', month: '2026-10' });
  assert.deepEqual(monthRange(new Date(2026, 11, 31, 23, 59, 59)), { kind: 'month', month: '2026-12' });
  assert.deepEqual(monthRange(new Date(2026, 1, 15)), { kind: 'month', month: '2026-02' });
});

test('P5-C1 — o mês independe do fuso do navegador (UTC e fusos extremos)', () => {
  const url = pathToFileURL(new URL('../../src/modules/reports/range.ts', import.meta.url).pathname).href;
  const script = `
    import { monthRange } from ${JSON.stringify(url)};
    const edge = new Date(2026, 9, 31, 23, 30);
    const start = new Date(2026, 0, 1, 0, 30);
    console.log(JSON.stringify([monthRange(edge).month, monthRange(start).month, edge.toISOString().slice(0, 7)]));
  `;
  const results: Record<string, string[]> = {};
  for (const timeZone of ['UTC', 'America/Sao_Paulo', 'Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
    const output = execFileSync(process.execPath, [
      '--experimental-strip-types',
      '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
      '--disable-warning=ExperimentalWarning',
      '--input-type=module',
      '-e',
      script,
    ], { env: { ...process.env, TZ: timeZone }, encoding: 'utf8' });
    results[timeZone] = JSON.parse(output.trim().split('\n').pop() ?? '[]');
    // O mês civil escolhido no seletor é o mesmo em qualquer fuso.
    assert.equal(results[timeZone][0], '2026-10', timeZone);
    assert.equal(results[timeZone][1], '2026-01', timeZone);
  }
  // Prova de que `toISOString()` erraria em algum desses fusos.
  assert.ok(Object.values(results).some(([, , iso]) => iso !== '2026-10'));
});

test('P5-C1 — chaves de cache distinguem usuário, workspace, papel, faixa e blocos', () => {
  assert.equal(sectionsKey(undefined), 'all');
  assert.equal(sectionsKey([]), 'all');
  assert.equal(sectionsKey(['kpis', 'accounts']), 'accounts,kpis');
  const key = financialReportKey('u1', 'ws1', 'viewer', 'preset:30d', 'all');
  assert.deepEqual(key, [FINANCIAL_REPORT_KEY, 'u1', 'ws1', 'viewer', 'preset:30d', 'all']);
  assert.notDeepEqual(key, financialReportKey('u1', 'ws1', 'owner', 'preset:30d', 'all'));
  assert.notDeepEqual(key, financialReportKey('u2', 'ws1', 'viewer', 'preset:30d', 'all'));
});

test('P5-C1 — a invalidação usa o prefixo do relatório', async () => {
  const calls: unknown[] = [];
  await invalidateFinancialReports({
    invalidateQueries: (filters?: unknown) => {
      calls.push(filters);
      return Promise.resolve();
    },
  } as never);
  assert.deepEqual(calls, [{ queryKey: ['financialReport'] }]);
});

test('P5-C1 — callable: payload estrito, sections só quando pedidas; erros em pt-BR', async () => {
  const sent: Array<[string, Record<string, unknown>]> = [];
  const callables = createReportCallables((async (name: string, payload: Record<string, unknown>) => {
    sent.push([name, payload]);
    return { ok: true };
  }) as never);
  await callables.getFinancialReport({ workspaceId: 'ws', range: { kind: 'month', month: '2026-10' } });
  await callables.getFinancialReport({
    workspaceId: 'ws',
    range: { kind: 'preset', preset: '30d' },
    sections: ['accounts', 'cash'],
  });
  assert.deepEqual(sent[0], ['getFinancialReport', { workspaceId: 'ws', range: { kind: 'month', month: '2026-10' } }]);
  assert.deepEqual(sent[1][1].sections, ['accounts', 'cash']);
  assert.equal('sections' in sent[0][1], false);
  assert.equal(reportErrorMessage({ code: 'functions/unavailable', message: 'internal' }),
    'Não foi possível carregar o relatório. Tente novamente.');
  assert.match(reportErrorMessage({ code: 'functions/permission-denied' }), /permissão/);
  // Limite de frequência do kernel: pré-condição com texto pt-BR do backend.
  assert.equal(reportErrorMessage({ code: 'functions/failed-precondition',
    message: 'Muitas solicitações em pouco tempo. Aguarde alguns minutos e tente novamente.' }),
  'Muitas solicitações em pouco tempo. Aguarde alguns minutos e tente novamente.');
  assert.equal(reportErrorMessage({ code: 'functions/failed-precondition' }),
    'Não foi possível carregar o relatório. Tente novamente.');
  // Código desconhecido nunca mostra o texto do SDK.
  assert.equal(reportErrorMessage({ code: 'functions/resource-exhausted', message: 'quota exceeded' }),
    'Não foi possível carregar o relatório. Tente novamente.');
  assert.equal(reportErrorMessage(new Error('boom')), 'Não foi possível carregar o relatório. Tente novamente.');
});
