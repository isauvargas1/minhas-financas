import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * P4-C (D-14) — guardas estáticas da Divisão de contas.
 *
 * Falham se:
 * 1. o frontend escrever no Firestore numa coleção `split_*`, ou se o módulo
 *    e as telas da Divisão usarem qualquer escrita do Firestore;
 * 2. voltar autoridade em ponto flutuante (`parseFloat`, `toFixed`, campos
 *    em reais) no módulo, nas telas ou no backend da Divisão;
 * 3. um ID nascer de `Date.now()` ou o participante voltar a ser um nome
 *    (`'Você'`, `nomeExibicao`, `userName`) em vez do `uid`;
 * 4. a Divisão voltar a usar os escritores diretos de `transactions`
 *    (`onAddTransaction`, lote do cliente) ou o App voltar a repassá-los;
 * 5. o formulário de lançamento voltar a gravar `parcelado`, `installments`
 *    ou `cardId` em `transactions` (PR-TX-06);
 * 6. a quota de grupos voltar a ser contada no cliente;
 * 7. o módulo, a callable, as telas, as Rules ou os índices do modelo
 *    anterior voltarem.
 * Varre o disco (não o índice do git): arquivo novo não rastreado entra.
 */

const sourceFiles = (dir: string): string[] =>
  !existsSync(dir) ? [] : readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });

/** Código sem comentários (o texto explicativo pode citar as APIs). */
const stripComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const read = (file: string): string => stripComments(readFileSync(file, 'utf8'));
const rel = (file: string): string => relative('.', file).replace(/\\/g, '/');

/** Telas da Divisão: os componentes que importam o módulo (descoberta pelo disco). */
const splitViews = (): string[] => sourceFiles('src/components')
  .filter((file) => /modules\/split-bills\//.test(readFileSync(file, 'utf8')));

const frontendSplit = (): string[] => [...sourceFiles('src/modules/split-bills'), ...splitViews()];
const backendSplit = (): string[] => sourceFiles(join('functions', 'src', 'splitBills'))
  .filter((file) => !/__tests__|testSupport|\.test\.ts$/.test(file));

const WRITE_APIS = ['addDoc', 'setDoc', 'updateDoc', 'deleteDoc', 'writeBatch', 'runTransaction'] as const;
const WRITE_PATTERN = new RegExp(`\\b(${WRITE_APIS.join('|')})\\b`, 'g');
const COLLECTION_PATTERN = /(['"`])split_[a-z_]*\1|\/split_[a-z_]*\//;

/** Detector puro: escrita do Firestore sobre a Divisão neste código? */
export const findSplitWrites = (code: string, inSplitModule: boolean): string[] => {
  const clean = stripComments(code);
  const apis = [...new Set([...clean.matchAll(WRITE_PATTERN)].map((match) => match[1]))].sort();
  if (apis.length === 0) return [];
  if (inSplitModule || COLLECTION_PATTERN.test(clean)) return apis;
  return [];
};

const offenders = (files: string[], pattern: RegExp): string[] =>
  files.filter((file) => pattern.test(read(file))).map(rel);

test('P4-C — detector: distingue leitura de escrita sobre a Divisão', () => {
  const reading = `getDocs(query(collection(db, 'workspaces', ws, 'split_bills'), limit(21)));`;
  const writing = `updateDoc(doc(db, 'workspaces', ws, 'split_shares', id), { status: 'settled' });`;
  const elsewhere = `setDoc(doc(db, 'workspaces', ws, 'recurring_expenses', id), {});`;
  assert.deepEqual(findSplitWrites(reading, false), []);
  assert.deepEqual(findSplitWrites(writing, false), ['updateDoc']);
  assert.deepEqual(findSplitWrites(elsewhere, false), []);
  assert.deepEqual(findSplitWrites(elsewhere, true), ['setDoc']);
  assert.deepEqual(findSplitWrites('// addDoc em split_groups', false), []);
});

test('P4-C — nenhuma escrita do Firestore na Divisão no frontend', () => {
  const files = frontendSplit();
  assert.ok(splitViews().length >= 11, `telas da Divisão: ${splitViews().length}`);
  assert.ok(files.length >= 18, `arquivos da Divisão: ${files.length}`);
  const inModule = new Set(files.map(rel));
  const found = sourceFiles('src')
    .map((file) => [rel(file), findSplitWrites(readFileSync(file, 'utf8'), inModule.has(rel(file)))] as const)
    .filter(([, apis]) => apis.length > 0);
  assert.deepEqual(found, []);
  assert.deepEqual(offenders(files, /\bcleanPayload\b|\bserverTimestamp\b|\bTimestamp\.fromDate\b|\bonSnapshot\b/),
    []);
  // Só as callables mudam o domínio: toda mutação passa por `splitCallables`.
  const hooks = read('src/modules/split-bills/hooks.ts');
  assert.match(hooks, /splitCallables/);
  assert.doesNotMatch(hooks, /^import\s+(?!type\b)[^;]*from 'firebase\/firestore'/m);
});

test('P4-C — sem autoridade em ponto flutuante nem campos em reais', () => {
  const all = [...frontendSplit(), ...backendSplit()];
  assert.deepEqual(offenders(all, /\bparseFloat\b|\.toFixed\(|Number\.EPSILON|normalizeMoney|Math\.round\(/), []);
  assert.deepEqual(offenders(all, /\bvalorReal\b|\bvalorDevido\b|\bvalorPago\b|\bstatusPagamento\b|\baPagar\b/), []);
  assert.deepEqual(offenders(all, /(cents|amount|value|valor)\w*\s*\*\s*100\b/i), []);
  // Nenhuma divisão por 100 no backend: o espelho no Caixa só tem
  // `valueCents` (o campo `value` em reais não existe mais).
  const divisions = backendSplit().flatMap((file) => read(file).split('\n')
    .filter((line) => /\/\s*100\b/.test(line)).map((line) => `${rel(file)}: ${line.trim()}`));
  assert.deepEqual(divisions, []);
});

test('P4-C — identidade pelo uid; nenhum ID nasce de Date.now()', () => {
  const all = [...frontendSplit(), ...backendSplit()];
  assert.deepEqual(offenders(all, /Date\.now\(\)\.toString|\$\{Date\.now\(\)|id:\s*Date\.now|String\(Date\.now/), []);
  assert.deepEqual(offenders(frontendSplit(), /\bDate\.now\b/), []);
  assert.deepEqual(offenders(all, /['"`]Você['"`]|\bnomeExibicao\b|\buserName\b|\bcriadoPor\b|\bparticipantes\s*:/), []);
  // O frontend não gera código de convite nem ID de documento: o único
  // aleatório é a chave de idempotência da intenção (CSPRNG).
  assert.deepEqual(offenders(frontendSplit(), /Math\.random/), []);
  assert.deepEqual(offenders(frontendSplit(), /randomUUID|getRandomValues/), ['src/modules/split-bills/hooks.ts']);
  const hooks = read('src/modules/split-bills/hooks.ts');
  const keyFn = hooks.slice(hooks.indexOf('export const newSplitIdempotencyKey'),
    hooks.indexOf('\n};\n', hooks.indexOf('export const newSplitIdempotencyKey')));
  assert.equal(hooks.split(/randomUUID|getRandomValues/).length - 1,
    keyFn.split(/randomUUID|getRandomValues/).length - 1, 'aleatório fora da chave de idempotência');
  const participants = read('functions/src/splitBills/participantOperations.ts');
  assert.match(participants, /randomInt\(/);
  assert.doesNotMatch(participants, /Math\.random/);
});

test('P4-C — Divisão fora dos escritores diretos de transactions', () => {
  assert.deepEqual(offenders(frontendSplit(),
    /onAddTransaction|useCreateTransaction|useCreateTransactionsBatch|useUpdateTransaction|useDeleteTransaction|modules\/transactions\/hooks/),
  []);
  const app = read('src/App.tsx');
  for (const view of ['SplitGroupsView', 'SplitGroupDetailsView']) {
    const start = app.indexOf(`<${view} `);
    assert.ok(start > 0, view);
    const usage = app.slice(start, app.indexOf('/>', start));
    assert.doesNotMatch(usage, /onAddTransaction/, view);
  }
  assert.doesNotMatch(app, /handleAddTransactions\b|createTxBatchMutation|useCreateTransactionsBatch/);
  const handler = app.slice(app.indexOf('const handleAddTransaction ='),
    app.indexOf('};', app.indexOf('const handleAddTransaction =')));
  assert.doesNotMatch(handler, /split|Split|parcelado|installments|cardId/);
  const txModule = [...sourceFiles('src/modules/transactions')].map(read).join('\n');
  assert.doesNotMatch(txModule, /createTransactionsBatch|writeBatch/);
});

test('P4-C — formulário de lançamento sem parcelado, parcelas nem cartão em transactions', () => {
  // A aba "parcelado" vai só para a callable de compra no cartão (P4-A); o
  // formulário manual (callables do caixa) não leva parcela nem cartão.
  const modal = read('src/components/TransactionModal.tsx');
  const cardRoute = modal.slice(modal.indexOf("if (activeTab === 'parcelado' && !isEditing)"),
    modal.indexOf('const isManualTab'));
  assert.match(cardRoute, /toCreateCardPurchasePayload\(/);
  assert.match(cardRoute, /return;/);
  const manualForm = modal.slice(modal.indexOf('const manualForm'), modal.indexOf('if (isEditing)', modal.indexOf('const manualForm')));
  assert.ok(manualForm.length > 0);
  assert.doesNotMatch(manualForm, /installments|currentInstallment|cardId|splitEntry|splitGroup/);
  assert.doesNotMatch(modal, /transactionData/);
  // P4-D: `transactions` não aceita escrita alguma do cliente.
  const rules = readFileSync('firestore.rules', 'utf8');
  assert.match(rules,
    /match \/transactions\/\{docId\} \{\s*allow read: if isMember\(workspaceId\);\s*allow create, update, delete: if false;\s*\}/);
  assert.doesNotMatch(rules, /function hasOnlyClientTransactionKeys/);
  const typeCheck = rules.slice(rules.indexOf('function isValidTransactionType'),
    rules.indexOf('}', rules.indexOf('function isValidTransactionType')));
  assert.doesNotMatch(typeCheck, /parcelado/);
});

test('P4-C — quota de grupos só do servidor', () => {
  const view = read('src/components/SplitGroupsView.tsx');
  assert.match(view, /splitGroupsQuotaView\(/);
  assert.doesNotMatch(view, /groups\.length|checkWorkspaceLimit|limits\.splitGroups/);
  const billing = [...sourceFiles('src/modules/billing')].map(read).join('\n');
  assert.doesNotMatch(billing, /checkWorkspaceLimit|WorkspaceLimitKey/);
  const operations = read('functions/src/splitBills/groupOperations.ts');
  assert.match(operations, /reserveSplitGroupSlot/);
  assert.match(operations, /releaseSplitGroupSlot/);
});

test('P4-C — modelo anterior removido: módulo, callable, telas, Rules e índices', () => {
  for (const path of [
    'src/modules/split-bills/logic.ts',
    'src/components/SharedExpensesView.tsx',
    'functions/src/callables/splitGroups.ts',
    'functions/src/callables/__tests__/splitGroups.integration.test.ts',
  ]) {
    assert.equal(existsSync(path), false, path);
  }
  const index = read('functions/src/index.ts');
  assert.doesNotMatch(index, /callables\/splitGroups/);
  const everything = [...sourceFiles('functions/src'), ...sourceFiles('src')]
    .filter((file) => !/__tests__|testSupport|\.test\.ts$/.test(file));
  assert.deepEqual(offenders(everything, /\bSharedExpensesView\b|\bsplitGroupIdOpcional\b|\bdividirAutomaticamente\b/),
    []);
  // Tipos antigos do Split fora de `src/types.ts`.
  assert.doesNotMatch(read('src/types.ts'), /interface (SplitGroup|SplitBill|SplitShare|SplitParticipant)\b/);
  const rules = readFileSync('firestore.rules', 'utf8');
  for (const coll of ['split_groups', 'split_participants', 'split_invites', 'split_bills', 'split_shares',
    'split_reimbursements', 'split_events']) {
    const start = rules.indexOf(`match /${coll}/`);
    assert.ok(start > 0, coll);
    const block = rules.slice(start, rules.indexOf('\n}', start));
    assert.match(block, /allow create, update, delete: if false;/, coll);
    assert.doesNotMatch(block, /canMemberWrite|canWrite|request\.resource/, coll);
    assert.match(block, /request\.query\.limit <= \d+/, coll);
  }
  assert.match(rules, /\^\(investment_\|credit_card_\|goal_\|recurring_\|split_\)/);
  const indexes = readFileSync('firestore.indexes.json', 'utf8');
  assert.doesNotMatch(indexes, /"valorReal"|"statusPagamento"|"aPagar"|"valorDevido"/);
});

test('P4-C — leituras com teto, filtradas no servidor, por cursor e com índice', () => {
  const api = read('src/modules/split-bills/api.ts');
  const queries = api.split('getDocs(query(').slice(1).map((chunk) => chunk.slice(0, chunk.indexOf('));')));
  // Títulos e reembolsos compartilham a mesma consulta paginada (`datedPage`).
  assert.ok(queries.length >= 7, `consultas encontradas: ${queries.length}`);
  for (const body of queries) assert.match(body, /limit\(/, body.slice(0, 80));
  const fn = (name: string) => {
    const start = api.indexOf(`export const ${name} =`);
    assert.ok(start >= 0, name);
    return api.slice(start, api.indexOf('\n};\n', start));
  };
  const paged = api.slice(api.indexOf('const datedPage ='), api.indexOf('\n};\n', api.indexOf('const datedPage =')));
  assert.match(paged, /where\('groupId', '==', groupId\)/);
  assert.match(paged, /startAfter\(cursor\.expenseDate, cursor\.id\)/);
  assert.match(paged, /hasMore: snapshot\.size > SPLIT_BILLS_PAGE_SIZE/);
  assert.match(fn('listSplitBills'), /datedPage\(/);
  assert.match(fn('listSplitReimbursements'), /datedPage\(/);
  assert.match(fn('listSplitShares'), /where\('billId', '==', billId\)/);
  assert.match(fn('listSplitShares'), /truncated: snapshot\.size > SPLIT_SHARES_LIMIT/);
  // Convite de não admin: só os que o próprio usuário criou (a Rule exige).
  assert.match(fn('listSplitInvites'), /isWorkspaceAdmin \? \[\] : \[where\('createdBy', '==', options\.uid\)\]/);
  const indexes = JSON.parse(readFileSync('firestore.indexes.json', 'utf8')) as {
    indexes: { collectionGroup: string; fields: { fieldPath: string; order?: string }[] }[];
    fieldOverrides: { collectionGroup: string; fieldPath: string; ttl?: boolean }[];
  };
  const shapes = (group: string) => indexes.indexes.filter((index) => index.collectionGroup === group)
    .map((index) => index.fields.map((field) => `${field.fieldPath}:${field.order}`).join(','));
  assert.deepEqual(shapes('split_bills'), ['groupId:ASCENDING,expenseDate:DESCENDING,__name__:DESCENDING']);
  assert.deepEqual(shapes('split_reimbursements'), ['groupId:ASCENDING,expenseDate:DESCENDING,__name__:DESCENDING']);
  assert.deepEqual(shapes('split_groups'), ['status:ASCENDING,createdAt:DESCENDING,__name__:DESCENDING']);
  assert.ok(indexes.fieldOverrides.some((item) => item.collectionGroup === 'split_invites' &&
    item.fieldPath === 'expiresAt' && item.ttl === true), 'TTL do convite');
});
