import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryClient, QueryObserver, hashKey } from '@tanstack/react-query';

import {
  FINANCIAL_REPORT_KEY,
  needsReportRefetch,
  nextFinancialReportOrder,
  noteFinancialReportFetchStart,
  refreshFinancialReportsAfterChange,
} from '../../src/modules/reports/queryKeys.ts';

/**
 * P5-F.1-R3 (RR-R2A-04) — releitura do relatório do Dashboard pedida pela escuta do mês.
 *
 * A falha intermitente de `e2e/cash-pending-entries.spec.ts:169` (o cartão "Despesas" em R$ 0,00 depois da
 * confirmação) foi reconstruída do log da Functions: depois do gatilho, saíram as releituras do relatório, e as
 * que terminaram levaram ~10 s no Emulator carregado; a invalidação pela escuta cancelava, no cliente, a leitura
 * que já tinha começado depois da mudança, e a tela esperava uma chamada a mais. Aqui: a leitura em curso que
 * começou depois da mudança vista fica; qualquer outra é invalidada e relida, e nenhuma mudança se perde.
 */

interface Deferred {
  resolve: (value: string) => void;
}

/** Consulta do relatório com leituras controladas pelo teste; cada leitura anota o começo, como a `queryFn` real. */
const harness = (key: readonly unknown[] = [FINANCIAL_REPORT_KEY, 'u1', 'ws-a', 'owner', 'month:2026-11', 'cash']) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
  const pending: Deferred[] = [];
  let calls = 0;
  const options = {
    queryKey: key,
    queryFn: ({ queryKey }: { queryKey: readonly unknown[] }) => {
      noteFinancialReportFetchStart(hashKey(queryKey));
      calls += 1;
      return new Promise<string>((resolve) => { pending.push({ resolve }); });
    },
  };
  return {
    client,
    options,
    calls: () => calls,
    resolve: (index: number, value: string) => pending[index].resolve(value),
    data: () => client.getQueryData<string>(key),
    observe: () => {
      const observer = new QueryObserver<string>(client, options);
      const unsubscribe = observer.subscribe(() => undefined);
      return { observer, unsubscribe };
    },
  };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test('decisão pura: só fica a leitura em curso que começou depois da mudança', () => {
  assert.equal(needsReportRefetch({ fetching: true, fetchStartedOrder: 5 }, 4), false);
  assert.equal(needsReportRefetch({ fetching: true, fetchStartedOrder: 4 }, 4), true, 'mesma ordem não é depois');
  assert.equal(needsReportRefetch({ fetching: true, fetchStartedOrder: 3 }, 4), true);
  assert.equal(needsReportRefetch({ fetching: true, fetchStartedOrder: null }, 4), true);
  assert.equal(needsReportRefetch({ fetching: false, fetchStartedOrder: 9 }, 4), true, 'parada: relê');
});

test('leitura em curso que começou depois da mudança vista não é cancelada: uma chamada, com o dado novo', async () => {
  const h = harness();
  const { unsubscribe } = h.observe(); // a montagem lê (leitura 0)
  await flush();
  h.resolve(0, 'R$ 0,00');
  await flush();
  const change = nextFinancialReportOrder(); // a escuta mostrou o gatilho
  void h.client.invalidateQueries({ queryKey: h.options.queryKey, exact: true }); // a volta ao Dashboard relê (leitura 1)
  await flush();
  assert.equal(h.calls(), 2);
  const kept = refreshFinancialReportsAfterChange(h.client, change);
  await flush();
  assert.equal(h.calls(), 2, 'a leitura que já traz a mudança não é cancelada nem repetida');
  h.resolve(1, 'R$ 205,50');
  await kept;
  await flush();
  assert.equal(h.data(), 'R$ 205,50');
  unsubscribe();
});

test('primeira leitura (sem dado) em curso desde antes da mudança: o React Query a reaproveita, e a releitura vem depois dela', async () => {
  const h = harness();
  const { unsubscribe } = h.observe(); // leitura 0, antes do gatilho, sem dado ainda
  await flush();
  const change = nextFinancialReportOrder(); // o gatilho grava depois do começo da leitura 0
  const refreshed = refreshFinancialReportsAfterChange(h.client, change);
  await flush();
  assert.equal(h.calls(), 1, 'sem dado, o React Query não cancela: reaproveita a leitura 0');
  h.resolve(0, 'R$ 0,00'); // a leitura 0 não tem a mudança
  await flush();
  assert.equal(h.calls(), 2, 'a releitura vem depois dela');
  h.resolve(1, 'R$ 205,50');
  await refreshed;
  await flush();
  assert.equal(h.data(), 'R$ 205,50', 'a mudança nunca se perde');
  unsubscribe();
});

test('com dado, a leitura em curso desde antes da mudança é cancelada e relida', async () => {
  const h = harness();
  const { unsubscribe } = h.observe();
  await flush();
  h.resolve(0, 'R$ 0,00');
  await flush();
  void h.client.invalidateQueries({ queryKey: h.options.queryKey, exact: true }); // leitura 1, antes do gatilho
  await flush();
  const change = nextFinancialReportOrder();
  const refreshed = refreshFinancialReportsAfterChange(h.client, change);
  await flush();
  assert.equal(h.calls(), 3, 'a leitura 1 é trocada pela 2');
  h.resolve(1, 'R$ 0,00'); // a cancelada responde depois: descartada
  h.resolve(2, 'R$ 205,50');
  await refreshed;
  await flush();
  assert.equal(h.data(), 'R$ 205,50');
  unsubscribe();
});

test('consulta parada é invalidada e relida; desativada fica inválida e relê ao ativar', async () => {
  const h = harness();
  const { unsubscribe } = h.observe();
  await flush();
  h.resolve(0, 'R$ 0,00');
  await flush();
  const first = refreshFinancialReportsAfterChange(h.client, nextFinancialReportOrder());
  await flush();
  assert.equal(h.calls(), 2, 'parada: relida');
  h.resolve(1, 'R$ 205,50');
  await first;
  await flush();
  unsubscribe(); // a tela saiu do Dashboard
  await refreshFinancialReportsAfterChange(h.client, nextFinancialReportOrder());
  await flush();
  assert.equal(h.calls(), 2, 'sem observador, nenhuma chamada');
  assert.equal(h.client.getQueryCache().find({ queryKey: h.options.queryKey })?.state.isInvalidated, true);
  const again = h.observe(); // volta ao Dashboard
  await flush();
  assert.equal(h.calls(), 3, 'relê ao ativar');
  h.resolve(2, 'R$ 300,00');
  await flush();
  assert.equal(h.data(), 'R$ 300,00');
  again.unsubscribe();
});

test('rajada: uma mudança depois do começo da leitura obriga outra leitura', async () => {
  const h = harness();
  const { unsubscribe } = h.observe();
  await flush();
  h.resolve(0, 'R$ 0,00');
  await flush();
  const first = nextFinancialReportOrder();
  void first;
  void h.client.invalidateQueries({ queryKey: h.options.queryKey, exact: true }); // leitura 1 depois da 1ª mudança
  await flush();
  const second = nextFinancialReportOrder(); // 2ª mudança com a leitura 1 em curso
  const burst = refreshFinancialReportsAfterChange(h.client, second);
  await flush();
  assert.equal(h.calls(), 3, 'a leitura 1 não traz a 2ª mudança: relida');
  h.resolve(1, 'R$ 100,00');
  h.resolve(2, 'R$ 205,50');
  await burst;
  await flush();
  assert.equal(h.data(), 'R$ 205,50');
  unsubscribe();
});

test('só as consultas do relatório: outra chave não é tocada', async () => {
  const report = harness();
  const other = harness(['financialReportBasis', 'u1', 'ws-a']);
  const a = report.observe();
  const b = other.observe();
  await flush();
  report.resolve(0, 'x');
  other.resolve(0, 'y');
  await flush();
  const r = refreshFinancialReportsAfterChange(report.client, nextFinancialReportOrder());
  await refreshFinancialReportsAfterChange(other.client, nextFinancialReportOrder());
  await flush();
  assert.equal(report.calls(), 2);
  assert.equal(other.calls(), 1, 'a base de longa duração tem escuta própria');
  report.resolve(1, 'z');
  await r;
  a.unsubscribe();
  b.unsubscribe();
});
