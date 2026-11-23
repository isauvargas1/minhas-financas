import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { runCashRefreshAfterCommit } from '../../src/modules/transactions/confirmedRefresh.ts';

const hooksSource = readFileSync(new URL('../../src/modules/transactions/hooks.ts', import.meta.url), 'utf8');

test('as quatro callables de caixa revalidam após sucesso sem aguardar as consultas no onSuccess', () => {
  const callSites = hooksSource.match(/onSuccess:\s*\(\)\s*=>\s*\{\s*refreshAfterConfirmedCashMutation\(queryClient, workspaceId\);/g) ?? [];
  assert.equal(callSites.length, 4, 'create, update, confirm e void devem seguir o mesmo contrato');
  assert.doesNotMatch(hooksSource, /onSuccess:\s*async\s*\(\)\s*=>\s*\{\s*await invalidateCashDependents/);
  assert.match(hooksSource, /runCashRefreshAfterCommit\(/);
});

test('revalidação que nunca termina não bloqueia a confirmação da escrita', async () => {
  let started = false;
  let failures = 0;
  const pending = new Promise<void>(() => {});
  const result = runCashRefreshAfterCommit(() => {
    started = true;
    return pending;
  }, () => { failures += 1; });
  assert.equal(result, undefined, 'o callback da mutação não deve devolver Promise');
  await Promise.resolve();
  assert.equal(started, true, 'as leituras devem continuar a ser revalidadas');
  assert.equal(failures, 0);
});

test('falha assíncrona de releitura não se transforma em falha do commit já confirmado', async () => {
  let failures = 0;
  const result = runCashRefreshAfterCommit(
    async () => { throw new Error('consulta indisponível'); },
    () => { failures += 1; },
  );
  assert.equal(result, undefined);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(failures, 1);
});

test('falha síncrona ao iniciar releitura também é isolada da operação financeira', async () => {
  let failures = 0;
  assert.doesNotThrow(() => runCashRefreshAfterCommit(
    () => { throw new Error('falha síncrona'); },
    () => { failures += 1; },
  ));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(failures, 1);
});
