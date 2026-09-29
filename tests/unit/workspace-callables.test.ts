import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  P1_CALLABLES,
  createWorkspaceCallables,
  type P1CallableName,
} from '../../src/modules/workspaces/callables.ts';

/**
 * Contrato cliente das callables de P1.
 *
 * Os schemas do backend são estritos: um campo a mais recusa a chamada, um a
 * menos também. Este teste amarra os dois lados sem subir o Firebase: os
 * nomes das callables exportadas pelo backend, as chaves de cada schema Zod e
 * o payload que cada wrapper realmente envia.
 */
const backendCallables = readFileSync(
  new URL('../../functions/src/workspaces/callables.ts', import.meta.url),
  'utf8',
);
const backendContracts = readFileSync(
  new URL('../../functions/src/workspaces/contracts.ts', import.meta.url),
  'utf8',
);

/** Chaves de primeiro nível de `export const <name>PayloadSchema = z.object({...})`. */
const schemaKeys = (callable: P1CallableName): string[] => {
  const match = new RegExp(
    `export const ${callable}PayloadSchema = z\\.object\\(\\{([\\s\\S]*?)\\}\\)\\.strict\\(\\);`,
  ).exec(backendContracts);
  assert.ok(match, `schema de ${callable} não encontrado`);
  return [...match[1].matchAll(/^\s{2}(\w+):/gm)].map((entry) => entry[1]).sort();
};

const recorder = () => {
  const calls: Array<{ name: P1CallableName; payload: Record<string, unknown> }> = [];
  const callables = createWorkspaceCallables(async <T,>(
    name: P1CallableName,
    payload: Record<string, unknown>,
  ) => {
    calls.push({ name, payload });
    return {} as T;
  });
  return { calls, callables };
};

test('toda callable de P1 exportada pelo backend tem wrapper, e só elas', () => {
  const exported = [...backendCallables.matchAll(/export const (\w+) = defineCallable\(/g)]
    .map((entry) => entry[1])
    .sort();
  assert.deepEqual([...P1_CALLABLES].sort(), exported);
  const { callables } = recorder();
  assert.deepEqual(Object.keys(callables).sort(), exported);
});

test('cada wrapper chama a callable do próprio nome com o payload do schema', async () => {
  const { calls, callables } = recorder();
  await callables.bootstrapAccount();
  await callables.createWorkspace(
    { type: 'PJ', name: 'Empresa', cnpj: '11.222.333/0001-81', themeColor: '#0f766e' },
    'idem-create-0001',
  );
  await callables.updateWorkspaceSettings('ws-1', {
    name: 'Novo nome',
    cnpj: null,
    themeColor: '#4f46e5',
    alertPreferences: { billing: true, accountsPayable: true, delinquency: true, lowMargin: false },
  });
  await callables.archiveWorkspace('ws-1');
  await callables.inviteWorkspaceMember('ws-1', 'pessoa@exemplo.com', 'viewer', 'idem-invite-0001');
  await callables.acceptWorkspaceInvite('token-opaco');
  await callables.revokeWorkspaceInvite('ws-1', 'invite-1');
  await callables.changeWorkspaceMemberRole('ws-1', 'uid-2', 'member');
  await callables.removeWorkspaceMember('ws-1', 'uid-2');
  await callables.leaveWorkspace('ws-1');
  await callables.transferWorkspaceOwnership('ws-1', 'uid-2', 'idem-transfer-0001');

  assert.deepEqual(calls.map((entry) => entry.name).sort(), [...P1_CALLABLES].sort());
  for (const { name, payload } of calls) {
    assert.deepEqual(Object.keys(payload).sort(), schemaKeys(name), name);
  }
});

test('os contratos novos enviam só o que o backend não deriva do token', async () => {
  const { calls, callables } = recorder();
  await callables.acceptWorkspaceInvite('token-opaco');
  await callables.revokeWorkspaceInvite('ws-1', 'invite-1');
  await callables.leaveWorkspace('ws-1');
  await callables.archiveWorkspace('ws-1');
  assert.deepEqual(calls, [
    // O workspace e o papel vêm do convite; o UID, do token.
    { name: 'acceptWorkspaceInvite', payload: { token: 'token-opaco' } },
    { name: 'revokeWorkspaceInvite', payload: { workspaceId: 'ws-1', inviteId: 'invite-1' } },
    { name: 'leaveWorkspace', payload: { workspaceId: 'ws-1' } },
    { name: 'archiveWorkspace', payload: { workspaceId: 'ws-1' } },
  ]);
});

test('campo ausente não vai no payload estrito; chave de idempotência sempre vai', async () => {
  const { calls, callables } = recorder();
  await callables.createWorkspace({ type: 'PF', name: 'Pessoal', cnpj: '' });
  const [{ payload }] = calls;
  assert.deepEqual(Object.keys(payload).sort(), ['idempotencyKey', 'name', 'type']);
  assert.equal(typeof payload.idempotencyKey, 'string');
  assert.ok(String(payload.idempotencyKey).length >= 8);
});
