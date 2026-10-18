import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NOTIFICATION_CALLABLES,
  UNREAD_COUNT_INVALID_RESPONSE,
  bindNotificationCallables,
  parseUnreadCountResponse,
  type NotificationInvoke,
} from '../../src/modules/notifications/callables.ts';

/**
 * P5-D2 — contrato cliente da callable `getNotificationUnreadCount`: nome e
 * payload (só `workspaceId`), e validação estrita da resposta. Resposta fora
 * do contrato vira erro (contagem indisponível), nunca zero.
 */

const ASOF = '2026-10-11T12:00:00.000Z';

test('o nome da callable e o payload: só workspaceId, nunca uid', async () => {
  assert.deepEqual([...NOTIFICATION_CALLABLES], ['getNotificationUnreadCount']);
  const sent: Array<{name: string; payload: Record<string, unknown>}> = [];
  const invoke: NotificationInvoke = async <TResult>(name: string, payload: Record<string, unknown>) => {
    sent.push({name, payload});
    return {unreadCount: 7, asOf: ASOF} as TResult;
  };
  const callables = bindNotificationCallables(invoke);
  assert.equal(await callables.getUnreadCount({workspaceId: 'ws-a', uid: 'u1'}), 7);
  assert.deepEqual(sent, [{name: 'getNotificationUnreadCount', payload: {workspaceId: 'ws-a'}}]);
  assert.deepEqual(Object.keys(sent[0].payload), ['workspaceId']);
});

test('resposta válida: zero e inteiros seguros', () => {
  assert.deepEqual(parseUnreadCountResponse({unreadCount: 0, asOf: ASOF}), {unreadCount: 0, asOf: ASOF});
  assert.deepEqual(parseUnreadCountResponse({unreadCount: 1, asOf: ASOF}), {unreadCount: 1, asOf: ASOF});
  assert.deepEqual(parseUnreadCountResponse({unreadCount: 137, asOf: ASOF}), {unreadCount: 137, asOf: ASOF});
  assert.equal(parseUnreadCountResponse({unreadCount: Number.MAX_SAFE_INTEGER, asOf: ASOF})?.unreadCount, Number.MAX_SAFE_INTEGER);
});

test('resposta fora do contrato é rejeitada', () => {
  const invalid: unknown[] = [
    {unreadCount: -1, asOf: ASOF},
    {unreadCount: 1.5, asOf: ASOF},
    {unreadCount: Number.NaN, asOf: ASOF},
    {unreadCount: Number.POSITIVE_INFINITY, asOf: ASOF},
    {unreadCount: Number.NEGATIVE_INFINITY, asOf: ASOF},
    {unreadCount: '3', asOf: ASOF},
    {unreadCount: null, asOf: ASOF},
    {unreadCount: undefined, asOf: ASOF},
    {unreadCount: Number.MAX_SAFE_INTEGER + 1, asOf: ASOF},
    {unreadCount: 2 ** 60, asOf: ASOF},
    {asOf: ASOF},
    {},
    {unreadCount: 3},
    {unreadCount: 3, asOf: ''},
    {unreadCount: 3, asOf: 'ontem'},
    {unreadCount: 3, asOf: 12345},
    null,
    undefined,
    '3',
    3,
    [],
  ];
  for (const value of invalid) assert.equal(parseUnreadCountResponse(value), null, JSON.stringify(value) ?? String(value));
});

test('resposta fora do contrato sobe como erro, nunca como zero; erro da callable também sobe', async () => {
  const scope = {workspaceId: 'ws-a', uid: 'u1'};
  for (const data of [{unreadCount: -1, asOf: ASOF}, {unreadCount: '3', asOf: ASOF}, {}, null]) {
    const callables = bindNotificationCallables((async () => data) as NotificationInvoke);
    await assert.rejects(
      callables.getUnreadCount(scope),
      (error: {code?: string}) => error.code === UNREAD_COUNT_INVALID_RESPONSE,
    );
  }
  const failing = bindNotificationCallables((async () => {
    throw Object.assign(new Error('x'), {code: 'functions/resource-exhausted'});
  }) as NotificationInvoke);
  await assert.rejects(failing.getUnreadCount(scope), (error: {code?: string}) => error.code === 'functions/resource-exhausted');
});
