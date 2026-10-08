import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SETTINGS_CATALOG_CALLABLES,
  SettingsCatalogInputError,
  buildArchiveCatalogPayload,
  buildCreateCatalogPayload,
  buildUpdateCatalogPayload,
  categorySubtypeForTransactionType,
  createSettingsCatalogCallables,
  isSettingsCatalogDuplicateError,
  settingsCatalogErrorView,
  settingsCatalogPermissions,
} from '../../src/modules/settings-catalog/callables.ts';
import { buildLegacyTransactionCatalogOptions } from '../../src/modules/settings-catalog/transactionFormAdapters.ts';
import { filterSettingsCatalogItems } from '../../src/modules/settings-catalog/utils.ts';
import { SETTINGS_CATALOG_GROUP_CONFIG } from '../../src/modules/settings-catalog/constants.ts';
import type { SettingsCatalogItem } from '../../src/modules/settings-catalog/types.ts';

/**
 * P4-E (D-23) — cliente do catálogo de configurações, sem SDK: contrato das
 * callables, payloads só com a intenção, permissões por papel, subtipos sem
 * `parcelado` (a aba Parcelado usa despesa) e mensagens pt-BR.
 */
const STAMP = { seconds: 1_790_000_000, nanoseconds: 123_456_789 };
const VERSION = '2026-09-21T14:13:20.123456789Z';

const item = (overrides: Partial<SettingsCatalogItem> = {}): SettingsCatalogItem => ({
  id: 'cat_1', workspaceId: 'ws', group: 'category', name: 'Mercado', normalizedName: 'mercado',
  dedupeKey: 'category::despesa::both::mercado', workspaceScope: 'both', transactionSubtype: 'despesa',
  sortOrder: 10, status: 'active', createdBy: 'owner', updatedBy: 'owner',
  updatedAt: STAMP as unknown as SettingsCatalogItem['updatedAt'], ...overrides,
});

const FORBIDDEN_KEYS = ['userId', 'createdBy', 'updatedBy', 'createdAt', 'updatedAt', 'dedupeKey',
  'normalizedName', 'workspaceScope', 'schemaVersion', 'catalogItemId'];

const assertNoAuthority = (payload: Record<string, unknown>) => {
  const keys = new Set([...Object.keys(payload),
    ...Object.keys((payload.changes as Record<string, unknown> | undefined) ?? {})]);
  for (const key of FORBIDDEN_KEYS) assert.equal(keys.has(key), false, `payload levou ${key}`);
};

test('callables: só as três do catálogo, com a chave da intenção', async () => {
  assert.deepEqual([...SETTINGS_CATALOG_CALLABLES],
    ['createSettingsCatalogItem', 'updateSettingsCatalogItem', 'archiveSettingsCatalogItem']);
  const calls: Array<[string, Record<string, unknown>]> = [];
  const callables = createSettingsCatalogCallables(async <T>(name: string, payload: Record<string, unknown>) => {
    calls.push([name, payload]);
    return { itemId: 'cat_1', status: 'active', replayed: false } as T;
  });
  await callables.createSettingsCatalogItem({ workspaceId: 'ws', group: 'category', name: 'X' }, 'idem-12345678');
  await callables.archiveSettingsCatalogItem({ workspaceId: 'ws', itemId: 'cat_1' }, 'idem-87654321');
  assert.deepEqual(calls.map(([name]) => name), ['createSettingsCatalogItem', 'archiveSettingsCatalogItem']);
  assert.equal(calls[0][1].idempotencyKey, 'idem-12345678');
});

test('criação: grupo, nome, subtipo só em categoria e aparência só com ícone', () => {
  const category = buildCreateCatalogPayload('ws', {
    group: 'category', name: '  Farmácia ', transactionSubtype: 'despesa', icon: 'IconPill',
    color: '#ff0000', stroke: 1.5, status: 'active',
  });
  assert.deepEqual(category, {
    workspaceId: 'ws', group: 'category', name: 'Farmácia', transactionSubtype: 'despesa',
    icon: 'IconPill', color: '#ff0000', stroke: 1.5, status: 'active',
  });
  assertNoAuthority(category);
  const payment = buildCreateCatalogPayload('ws', {
    group: 'payment_method', name: 'Pix', transactionSubtype: 'despesa', color: '#000000', stroke: 2,
  });
  assert.deepEqual(payment, { workspaceId: 'ws', group: 'payment_method', name: 'Pix' });
  assert.throws(() => buildCreateCatalogPayload('ws', { group: 'category', name: '   ' }),
    (error: unknown) => error instanceof SettingsCatalogInputError && /Informe o nome/.test(String(error)));
});

test('edição: só o que mudou, com a versão lida; remover ícone envia null', () => {
  const current = item({ icon: 'IconCart', color: '#111111', stroke: 2 });
  assert.equal(buildUpdateCatalogPayload('ws', current, {
    name: 'Mercado', icon: 'IconCart', color: '#111111', stroke: 2, status: 'active',
  }), null, 'nada mudou: nada a enviar');
  const renamed = buildUpdateCatalogPayload('ws', current, {
    name: ' Supermercado ', icon: 'IconCart', color: '#111111', stroke: 2, status: 'active',
  });
  assert.deepEqual(renamed, {
    workspaceId: 'ws', itemId: 'cat_1', expectedUpdatedAt: VERSION, changes: { name: 'Supermercado' },
  });
  assertNoAuthority(renamed!);
  const cleared = buildUpdateCatalogPayload('ws', current, { name: 'Mercado', status: 'active' });
  assert.deepEqual(cleared?.changes, { icon: null });
  const reactivated = buildUpdateCatalogPayload('ws', item({ status: 'inactive' }), {
    name: 'Mercado', status: 'active',
  });
  assert.deepEqual(reactivated?.changes, { status: 'active' });
  assert.throws(() => buildUpdateCatalogPayload('ws', item({ updatedAt: null }), { name: 'Outro' }),
    SettingsCatalogInputError, 'sem versão lida não há edição');
  assert.deepEqual(buildArchiveCatalogPayload('ws', current),
    { workspaceId: 'ws', itemId: 'cat_1', expectedUpdatedAt: VERSION });
});

test('permissões: owner e admin administram; member e viewer só leem', () => {
  assert.equal(settingsCatalogPermissions('owner').canManage, true);
  assert.equal(settingsCatalogPermissions('admin').canManage, true);
  for (const role of ['member', 'viewer', null, undefined, 'outro']) {
    assert.equal(settingsCatalogPermissions(role).canManage, false, String(role));
  }
});

test('subtipos: receita, despesa e investimento; a aba Parcelado usa despesa', () => {
  assert.deepEqual(SETTINGS_CATALOG_GROUP_CONFIG.category.allowedTransactionSubtypes,
    ['receita', 'despesa', 'investimento']);
  assert.equal(categorySubtypeForTransactionType('parcelado'), 'despesa');
  assert.equal(categorySubtypeForTransactionType('despesa'), 'despesa');
  assert.equal(categorySubtypeForTransactionType('receita'), 'receita');
  assert.equal(categorySubtypeForTransactionType('investimento'), 'investimento');
  assert.equal(categorySubtypeForTransactionType(null), null);
  for (const config of Object.values(SETTINGS_CATALOG_GROUP_CONFIG)) {
    assert.equal('workspaceScope' in config, false, 'o cliente não decide escopo');
  }
});

test('seletores: inativo fica fora de lançamento novo; centro de custo só em PJ', () => {
  const items = [
    item({ id: 'd1', name: 'Mercado' }),
    item({ id: 'd2', name: 'Antiga', status: 'inactive' }),
    item({ id: 'r1', name: 'Salário', transactionSubtype: 'receita' }),
    item({ id: 'i1', name: 'CDB', transactionSubtype: 'investimento' }),
    item({ id: 'cc', group: 'cost_center', name: 'Diretoria', workspaceScope: 'PJ', transactionSubtype: undefined }),
  ];
  const despesa = buildLegacyTransactionCatalogOptions({
    items, workspaceType: 'PJ', transactionType: categorySubtypeForTransactionType('parcelado'),
  });
  assert.deepEqual(despesa.settingsCategories.map((entry) => entry.id), ['d1']);
  assert.deepEqual(despesa.costCenters.map((entry) => entry.id), ['cc']);
  const pf = buildLegacyTransactionCatalogOptions({ items, workspaceType: 'PF', transactionType: 'investimento' });
  assert.deepEqual(pf.settingsCategories.map((entry) => entry.id), ['i1']);
  assert.deepEqual(pf.costCenters, []);
  // Histórico: com inativos incluídos, o item antigo continua resolvível.
  assert.ok(filterSettingsCatalogItems(items, { includeInactive: true }).some((entry) => entry.id === 'd2'));
  assert.equal(filterSettingsCatalogItems(items, {}).some((entry) => entry.id === 'd2'), false);
});

test('erros: nome repetido, papel e versão em pt-BR, com a mensagem do backend', () => {
  const duplicate = { code: 'functions/already-exists',
    message: 'Já existe um cadastro inativo com esse nome neste grupo. Reative-o em vez de criar outro.' };
  assert.equal(isSettingsCatalogDuplicateError(duplicate), true);
  assert.deepEqual(settingsCatalogErrorView(duplicate),
    { kind: 'conflict', message: duplicate.message, refresh: true });
  assert.equal(settingsCatalogErrorView({ code: 'functions/already-exists', message: '' }).message,
    'Já existe um cadastro com esse nome neste grupo.');
  const role = settingsCatalogErrorView({ code: 'functions/permission-denied',
    message: 'Seu papel neste espaço de trabalho não permite esta operação.' });
  assert.equal(role.kind, 'forbidden');
  assert.match(role.message, /papel/);
  const stale = settingsCatalogErrorView({ code: 'functions/aborted',
    message: 'Este cadastro foi alterado por outra operação depois que você o abriu. Atualize e tente novamente.' });
  assert.deepEqual([stale.kind, stale.refresh], ['conflict', true]);
  const invalid = settingsCatalogErrorView({ code: 'functions/invalid-argument', message: 'Dados inválidos.',
    details: { issues: [{ message: 'Nome do cadastro: até 120 caracteres.' }] } });
  assert.equal(invalid.message, 'Nome do cadastro: até 120 caracteres.');
  assert.equal(settingsCatalogErrorView(new SettingsCatalogInputError('Informe o nome do cadastro.')).kind,
    'validation');
});
