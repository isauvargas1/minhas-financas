import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * P4-E (D-23) — guardas estáticas do catálogo de configurações.
 *
 * Falham se:
 * 1. o frontend escrever no Firestore em `settings_catalog` (ou qualquer
 *    escrita do Firestore no módulo do catálogo), voltar o `runTransaction`
 *    do catálogo no cliente ou mencionar `settings_catalog_uniques`;
 * 2. um payload do catálogo levar autoria, datas, escopo, nome normalizado ou
 *    chave de unicidade;
 * 3. `parcelado` voltar como subtipo do catálogo (tipo, configuração, chips
 *    de Configurações) — sem tocar na aba Parcelado do lançamento, que segue
 *    no domínio de cartões com categorias de despesa;
 * 4. voltar `legacyCatalogSeedDocumentId`, os helpers do catálogo dentro de
 *    Investimentos, os grupos `wallet`/`investment_type`/profissionais ou a
 *    lista mock de categorias;
 * 5. as Rules voltarem a aceitar escrita do cliente no catálogo, ou a abrir
 *    as reservas e a auditoria;
 * 6. o backend do catálogo apagar item (hard delete) ou aceitar autoria do
 *    payload.
 * Varre o disco (não o índice do git); comentários não contam.
 */

const ROOT = 'src';

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });

const stripComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const rel = (file: string): string => relative(ROOT, file).replace(/\\/g, '/');
const read = (path: string): string => stripComments(readFileSync(path, 'utf8'));

const WRITE_APIS = ['addDoc', 'setDoc', 'updateDoc', 'deleteDoc', 'writeBatch', 'runTransaction',
  'serverTimestamp'] as const;
const WRITE_PATTERN = new RegExp(`\\b(${WRITE_APIS.join('|')})\\b`, 'g');
const CATALOG_PATTERN = /(['"`])settings_catalog\1|\/settings_catalog\/|SETTINGS_CATALOG_COLLECTION/;

/** Detector puro: escrita do Firestore sobre o catálogo neste código? */
export const findCatalogWrites = (code: string, inCatalogModule: boolean): string[] => {
  const clean = stripComments(code);
  const apis = [...new Set([...clean.matchAll(WRITE_PATTERN)].map((match) => match[1]))].sort();
  if (apis.length === 0) return [];
  if (inCatalogModule || CATALOG_PATTERN.test(clean)) return apis;
  return [];
};

test('P4-E — detector: distingue leitura de escrita sobre o catálogo', () => {
  assert.deepEqual(findCatalogWrites(
    `getDocs(query(collection(db, 'workspaces', ws, 'settings_catalog'), limit(10)));`, false), []);
  assert.deepEqual(findCatalogWrites(
    `runTransaction(db, async (t) => t.set(doc(db, 'workspaces', ws, 'settings_catalog', id), {}));`, false),
  ['runTransaction']);
  assert.deepEqual(findCatalogWrites(`await setDoc(ref, { createdAt: serverTimestamp() });`, true),
    ['serverTimestamp', 'setDoc']);
  assert.deepEqual(findCatalogWrites(`// runTransaction só em comentário`, true), []);
});

test('P4-E — nenhum arquivo do frontend escreve no catálogo; o módulo só lê e chama callables', () => {
  const findings = sourceFiles(ROOT)
    .map((file) => ({
      file: rel(file),
      apis: findCatalogWrites(readFileSync(file, 'utf8'), rel(file).startsWith('modules/settings-catalog/')),
    }))
    .filter((finding) => finding.apis.length > 0);
  assert.deepEqual(findings, []);
  const api = read('src/modules/settings-catalog/api.ts');
  assert.match(api, /httpsCallable/);
  assert.match(api, /createSettingsCatalogCallables\(invoke\)/);
});

test('P4-E — o frontend não conhece as reservas de nome nem a auditoria do catálogo', () => {
  const findings = sourceFiles(ROOT)
    .filter((file) => /settings_catalog_(uniques|events)|SETTINGS_CATALOG_UNIQUES/.test(read(file)))
    .map(rel);
  assert.deepEqual(findings, []);
});

test('P4-E — payloads do catálogo levam só a intenção', () => {
  const callables = read('src/modules/settings-catalog/callables.ts');
  const builders = callables.slice(callables.indexOf('export const buildCreateCatalogPayload'),
    callables.indexOf('export const settingsCatalogErrorView'));
  for (const key of ['userId', 'createdBy', 'updatedBy', 'createdAt', 'updatedAt', 'dedupeKey',
    'normalizedName', 'workspaceScope', 'serverTimestamp']) {
    // Como chave de objeto (`chave:` ou `{ chave }`): ler `item.updatedAt`
    // para derivar a versão não é enviar `updatedAt`.
    assert.doesNotMatch(builders, new RegExp(`(^|[{,\\s])${key}\\s*[:,}]`, 'm'),
      `payload do catálogo leva ${key}`);
  }
  const screen = read('src/modules/settings-catalog/useSettingsCatalogScreen.ts');
  assert.doesNotMatch(screen, /workspaceScope|userId|user\?\.uid/);
  const hooks = read('src/modules/settings-catalog/hooks.ts');
  assert.doesNotMatch(hooks, /useAuth|user\?\.uid/);
});

test('P4-E — parcelado não é subtipo do catálogo; a aba Parcelado segue em Cartões com despesa', () => {
  const types = read('src/modules/settings-catalog/types.ts');
  const subtype = types.slice(types.indexOf('export type SettingsCatalogTransactionSubtype'),
    types.indexOf(';', types.indexOf('export type SettingsCatalogTransactionSubtype')));
  assert.doesNotMatch(subtype, /parcelado/);
  assert.doesNotMatch(read('src/modules/settings-catalog/constants.ts'), /parcelado/);
  const settings = read('src/components/SettingsView.tsx');
  const chips = settings.slice(settings.indexOf('const CATEGORY_SUBTYPE_OPTIONS'),
    settings.indexOf('];', settings.indexOf('const CATEGORY_SUBTYPE_OPTIONS')));
  assert.doesNotMatch(chips, /parcelado|Parcelados/);
  const modal = read('src/components/TransactionModal.tsx');
  assert.match(modal, /if \(activeTab === 'parcelado'/, 'a aba Parcelado continua');
  assert.match(modal, /toCreateCardPurchasePayload\(/, 'compra pelo domínio de cartões');
  assert.match(modal, /categorySubtypeForTransactionType\(type\)/, 'categorias da aba pelo subtipo despesa');
  assert.match(read('src/modules/settings-catalog/useTransactionCatalogOptions.ts'),
    /categorySubtypeForTransactionType\(transactionType\)/);
  assert.match(read('src/modules/settings-catalog/callables.ts'),
    /type === 'parcelado' \? 'despesa' : type/);
});

test('P4-E — sem helper legado, sem grupos removidos e sem categorias mock', () => {
  const everywhere = [
    ...sourceFiles('src'),
    ...sourceFiles('functions/src').filter((file) => !file.includes('__tests__')),
  ];
  for (const file of everywhere) {
    const code = read(file);
    assert.doesNotMatch(code, /legacyCatalogSeedDocumentId|investmentCatalogSeedDocumentId/, file);
    assert.doesNotMatch(code, /['"`](wallet|investment_type|investment_risk|investment_liquidity|investment_indexer|investment_strategy)['"`]/,
      `${file} recria grupo removido`);
  }
  const simpleMode = read('functions/src/investments/simpleMode.ts');
  for (const helper of ['export const normalizeCatalogName', 'export const catalogDedupeKey',
    'INVESTMENT_CATEGORY_SEEDS']) {
    assert.equal(simpleMode.includes(helper), false, `${helper} voltou para Investimentos`);
  }
  const constants = read('src/constants.ts');
  assert.doesNotMatch(constants, /initialProductsServices|initialExpenseTypes|initialPaymentTypes|initialIncomeTypes/);
  assert.doesNotMatch(constants, /parcelado: \[|type: 'parcelado'/);
  const app = read('src/App.tsx');
  assert.doesNotMatch(app, /handleSettingsUpdate|settingsCategories=|setCategories/);
  assert.match(read('src/components/RecurringExpenseFormModal.tsx'), /useTransactionCatalogOptions\('despesa'\)/,
    'Recorrentes classificam pelas categorias de despesa do catálogo');
});

test('P4-E — UI: ações de Cadastros só para quem administra', () => {
  const settings = read('src/components/SettingsView.tsx');
  const guarded = (label: string) => {
    const at = settings.indexOf(label);
    assert.ok(at > 0, `${label} não encontrado`);
    const before = settings.slice(Math.max(0, at - 900), at);
    assert.match(before, /\{canManageCatalog && \(/, `${label} sem guarda de papel`);
  };
  guarded('Novo cadastro\n');
  guarded('Criar primeiro item');
  assert.equal((settings.match(/\{canManageCatalog && \(/g) ?? []).length, 4,
    'botões de criar (2) e blocos Editar/Inativar (cards e lista)');
  assert.doesNotMatch(settings, /libera a chave de unicidade/);
});

test('P4-E — Rules: catálogo somente leitura no cliente; reservas e auditoria fechadas', () => {
  const rules = readFileSync('firestore.rules', 'utf8');
  const block = (name: string) => {
    const start = rules.indexOf(`match /${name}/`);
    assert.ok(start > 0, `bloco ${name} ausente`);
    return rules.slice(start, rules.indexOf('\n      }', start));
  };
  const catalog = block('settings_catalog');
  assert.match(catalog, /allow create, update, delete: if false;/);
  assert.match(catalog, /request\.query\.limit <= 2001/);
  assert.doesNotMatch(catalog, /allow (write|create|update)[^;]*: if (?!false)/);
  assert.match(block('settings_catalog_uniques'), /allow read, write: if false;/);
  assert.match(block('settings_catalog_events'), /allow read, write: if false;/);
  assert.doesNotMatch(rules, /isValidCatalogCreate|isValidCatalogUpdate|canManageWorkspaceCatalog/);
  const backendOwned = rules.slice(rules.indexOf('function isBackendOwnedCollection'),
    rules.indexOf('];', rules.indexOf('function isBackendOwnedCollection')));
  for (const name of ['settings_catalog', 'settings_catalog_uniques', 'settings_catalog_events']) {
    assert.match(backendOwned, new RegExp(`'${name}'`), `${name} fora da lista server-owned`);
  }
});

test('P4-E — backend: sem hard delete de item e sem autoria vinda do payload', () => {
  const operations = read('functions/src/settingsCatalog/operations.ts');
  // A única exclusão é a da reserva antiga no renomear, depois de reservar a nova.
  const deletes = operations.match(/transaction\.delete\(([^)]*)\)/g) ?? [];
  assert.deepEqual(deletes, ['transaction.delete(loaded.lockRef)']);
  assert.doesNotMatch(operations, /payload\.(createdBy|updatedBy|userId|workspaceScope|dedupeKey|normalizedName)/);
  assert.match(operations, /reassertWorkspaceActor\(\s*transaction, actor, SETTINGS_CATALOG_ADMIN_ROLES\)/);
  const contracts = read('functions/src/settingsCatalog/contracts.ts');
  assert.equal((contracts.match(/\.strict\(\)/g) ?? []).length >= 4, true, 'contratos estritos');
});

test('P4-E — índices: cada consulta do catálogo tem índice e nenhum índice do catálogo fica sem consulta', () => {
  type Index = { collectionGroup: string; queryScope: string; fields: Array<{ fieldPath: string; order?: string }> };
  const indexes = (JSON.parse(readFileSync('firestore.indexes.json', 'utf8')).indexes as Index[])
    .filter((index) => index.collectionGroup === 'settings_catalog')
    .map((index) => `${index.queryScope}:${index.fields.map((field) => `${field.fieldPath} ${field.order}`).join(',')}`)
    .sort();
  const tail = 'sortOrder ASCENDING,normalizedName ASCENDING,__name__ ASCENDING';
  // Leitura completa (`listSettingsCatalogSnapshot`) e as quatro combinações da
  // paginação de Cadastros (`listSettingsCatalogPage`: subtipo e status opcionais).
  const expected = [
    `COLLECTION:${tail}`,
    `COLLECTION:group ASCENDING,${tail}`,
    `COLLECTION:group ASCENDING,status ASCENDING,${tail}`,
    `COLLECTION:group ASCENDING,transactionSubtype ASCENDING,${tail}`,
    `COLLECTION:group ASCENDING,transactionSubtype ASCENDING,status ASCENDING,${tail}`,
  ].sort();
  assert.deepEqual(indexes, expected);
  const api = read('src/modules/settings-catalog/api.ts');
  assert.match(api, /orderBy\('sortOrder', 'asc'\),\s*orderBy\('normalizedName', 'asc'\),\s*orderBy\(documentId\(\), 'asc'\),\s*limit\(SETTINGS_CATALOG_READ_LIMIT \+ 1\)/);
  assert.match(api, /where\('group', '==', filters\.group\)/);
  assert.match(api, /where\('transactionSubtype', '==', filters\.transactionSubtype\)/);
  assert.match(api, /where\('status', '==', 'active'\)/);
  assert.match(api, /export const SETTINGS_CATALOG_READ_LIMIT = 2000;/);
});
