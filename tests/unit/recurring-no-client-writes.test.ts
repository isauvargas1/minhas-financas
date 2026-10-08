import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * P4-B (D-12) — guardas estáticas de Recorrentes.
 *
 * Falham se:
 * 1. o frontend escrever no Firestore numa coleção `recurring_*`, ou se o
 *    módulo e as telas de Recorrentes usarem qualquer escrita do Firestore;
 * 2. voltar autoridade em ponto flutuante (`parseFloat`, `toFixed`,
 *    `valorPadrao`, `adjustments` em reais) no módulo, nas telas ou no
 *    backend de Recorrentes;
 * 3. um ID nascer de `Date.now()`;
 * 4. a ocorrência voltar a ser identificada pela competência
 *    (`occ_${id}_${competencia}`) em vez da data civil completa;
 * 5. voltar `parseInt(cardId)`, `parcelado` ou `cardId` em `transactions`
 *    por Recorrentes (PR-TX-06), ou a Divisão de contas direta;
 * 6. voltar `new Date('AAAA-MM-DD')`, `toISOString().split('T')[0]` ou
 *    equivalentes na lógica de agenda e nas telas de Recorrentes;
 * 7. Recorrentes voltar a usar os escritores diretos de `transactions`
 *    (`onAddTransaction`, `useCreateTransaction`…);
 * 8. o cliente puder escolher a origem da compra de cartão, ou `recurring`
 *    for gravado fora da geração do backend;
 * 9. o módulo, o cron, o checkpoint, as Rules ou os índices do modelo
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

const RECURRING_VIEWS = [
  'src/components/RecurringExpensesView.tsx',
  'src/components/RecurringExpenseDetailsView.tsx',
  'src/components/RecurringExpenseFormModal.tsx',
  'src/components/RecurringExpenseCard.tsx',
  'src/components/RecurringExpenseList.tsx',
  'src/components/RecurringDashboardWidget.tsx',
];

const frontendRecurring = (): string[] => [
  ...sourceFiles('src/modules/recurring'),
  ...RECURRING_VIEWS,
];
const backendRecurring = (): string[] =>
  sourceFiles(join('functions', 'src', 'recurring'))
    .filter((file) => !/__tests__|testSupport|\.test\.ts$/.test(file));

const WRITE_APIS = ['addDoc', 'setDoc', 'updateDoc', 'deleteDoc', 'writeBatch', 'runTransaction'] as const;
const WRITE_PATTERN = new RegExp(`\\b(${WRITE_APIS.join('|')})\\b`, 'g');
const COLLECTION_PATTERN = /(['"`])recurring_[a-z_]*\1|\/recurring_[a-z_]*\//;

/** Detector puro: escrita do Firestore sobre Recorrentes neste código? */
export const findRecurringWrites = (code: string, inRecurringModule: boolean): string[] => {
  const clean = stripComments(code);
  const apis = [...new Set([...clean.matchAll(WRITE_PATTERN)].map((match) => match[1]))].sort();
  if (apis.length === 0) return [];
  if (inRecurringModule || COLLECTION_PATTERN.test(clean)) return apis;
  return [];
};

const offenders = (files: string[], pattern: RegExp): string[] =>
  files.filter((file) => pattern.test(read(file))).map(rel);

test('P4-B — detector: distingue leitura de escrita sobre Recorrentes', () => {
  const reading = `getDocs(query(collection(db, 'workspaces', ws, 'recurring_expenses')));`;
  const writing = `addDoc(collection(db, 'workspaces', ws, 'recurring_occurrences'), {});`;
  const elsewhere = `setDoc(doc(db, 'workspaces', ws, 'split_groups', id), {});`;
  assert.deepEqual(findRecurringWrites(reading, false), []);
  assert.deepEqual(findRecurringWrites(writing, false), ['addDoc']);
  assert.deepEqual(findRecurringWrites(elsewhere, false), []);
  assert.deepEqual(findRecurringWrites(elsewhere, true), ['setDoc']);
  // Comentário que cita a API não conta.
  assert.deepEqual(findRecurringWrites('// addDoc em recurring_expenses', false), []);
});

test('P4-B — nenhuma escrita do Firestore em Recorrentes no frontend', () => {
  const files = frontendRecurring();
  assert.ok(files.length >= 12, `arquivos de Recorrentes: ${files.length}`);
  const inModule = new Set(files.map(rel));
  const found = sourceFiles('src')
    .map((file) => [rel(file), findRecurringWrites(readFileSync(file, 'utf8'), inModule.has(rel(file)))] as const)
    .filter(([, apis]) => apis.length > 0);
  assert.deepEqual(found, []);
  assert.deepEqual(offenders(files, /\bcleanPayload\b|\bserverTimestamp\b|\bTimestamp\.fromDate\b/), []);
});

test('P4-B — sem autoridade em ponto flutuante nem campos em reais', () => {
  const all = [...frontendRecurring(), ...backendRecurring()];
  assert.deepEqual(offenders(all, /\bparseFloat\b|\.toFixed\(|Number\.EPSILON|normalizeMoney/), []);
  assert.deepEqual(offenders(all, /\bvalorPadrao\b|\bvalorReal\b|\badjustments\b|\bRecurringAdjustment\b/), []);
  assert.deepEqual(offenders(backendRecurring(), /(cents|amount|value|valor)\w*\s*[*/]\s*100\b/i), []);
});

test('P4-B — nenhum ID nasce de Date.now()', () => {
  const all = [...frontendRecurring(), ...backendRecurring()];
  assert.deepEqual(offenders(all, /Date\.now\(\)\.toString|\$\{Date\.now\(\)|id:\s*Date\.now|String\(Date\.now/), []);
  assert.deepEqual(offenders(frontendRecurring(), /\bDate\.now\b/), []);
});

test('P4-B — ocorrência pela data civil completa, nunca pela competência', () => {
  const all = [...frontendRecurring(), ...backendRecurring()];
  assert.deepEqual(offenders(all, /\bocc_\$\{|\bcompetencia\b|\bdataPrevista\b/), []);
  const model = read('functions/src/recurring/model.ts');
  const idFn = /export const recurringOccurrenceIdFor = \([\s\S]*?\) => `rocc_\$\{hash40\(`\$\{workspaceId\}:\$\{recurringExpenseId\}:\$\{dueDate\}`\)\}`;/;
  assert.match(model, idFn);
});

test('P4-B — sem parseInt(cardId), parcelado, Divisão direta nem cardId em transactions', () => {
  const all = [...frontendRecurring(), ...backendRecurring()];
  assert.deepEqual(offenders(all, /parseInt\([^)]*card/i), []);
  assert.deepEqual(offenders(all, /parcelado|\binstallments\b|currentInstallment/), []);
  assert.deepEqual(offenders(frontendRecurring(),
    /split-bills|useSplitGroups|useSplitParticipants|useCreateSplitBill|SplitBill|splitGroup|dividirAutomaticamente/), []);
  assert.deepEqual(offenders(backendRecurring(), /split_|splitGroup/), []);
  // O lançamento do Caixa gerado por Recorrentes não tem cartão: o documento
  // do caixa não carrega `cardId` e a geração usa só esse documento.
  const cashDocument = read('functions/src/cash/createTransaction.ts');
  const builder = cashDocument.slice(cashDocument.indexOf('export const cashEntryDocument'),
    cashDocument.indexOf('/** Relógio e ponto de falha'));
  assert.doesNotMatch(builder, /cardId|parcelado|installments/);
  const facts = read('functions/src/recurring/facts.ts');
  assert.match(facts, /type: "despesa"/);
  assert.match(facts, /installmentsCount: 1/);
  assert.doesNotMatch(facts, /collection\("transactions"\)[\s\S]{0,200}cardId/);
});

test('P4-B — datas civis sem instantes UTC na agenda e nas telas', () => {
  const all = [...frontendRecurring(), ...backendRecurring()];
  assert.deepEqual(offenders(all, /toISOString\(\)\.(split|slice|substring)/), []);
  assert.deepEqual(offenders(all, /new Date\(\s*['"`]\d{4}-\d{2}-\d{2}/), []);
  assert.deepEqual(offenders(all,
    /new Date\([a-zA-Z_.?!]*(dueDate|startDate|endDate|nextDueDate|dataFim|dataInicio|adjustmentDate)\)/), []);
  assert.deepEqual(offenders(all, /\.setMonth\(|\.setDate\(|getTimezoneOffset/), []);
});

test('P4-B — Recorrentes fora dos escritores diretos de transactions', () => {
  assert.deepEqual(offenders(frontendRecurring(),
    /onAddTransaction|useCreateTransaction|useCreateTransactionsBatch|useUpdateTransaction|useDeleteTransaction|modules\/transactions\/hooks/), []);
  const app = read('src/App.tsx');
  for (const view of ['RecurringExpensesView', 'RecurringExpenseDetailsView']) {
    const usage = app.slice(app.indexOf(`<${view} `), app.indexOf('/>', app.indexOf(`<${view} `)));
    assert.ok(usage.length > 0, view);
    assert.doesNotMatch(usage, /onAddTransaction/, view);
  }
});

test('P4-B — origem da compra de cartão só pelo backend', () => {
  const contracts = read('functions/src/cards/contracts.ts');
  const purchaseSchema = contracts.slice(contracts.indexOf('export const createCreditCardPurchasePayloadSchema'),
    contracts.indexOf('export type CreateCreditCardPurchasePayload'));
  assert.doesNotMatch(purchaseSchema, /\bsource\b/);
  const operations = read('functions/src/cards/purchaseOperations.ts');
  assert.match(operations, /origin: \{source: "manual"\}/);
  // `source: "recurring"` só nasce na geração de Recorrentes.
  const recurringLiterals = [...sourceFiles('functions/src'), ...sourceFiles('src')]
    .filter((file) => !/__tests__|testSupport|\.test\.ts$/.test(file))
    .filter((file) => /source:\s*["']recurring["']\s*,/.test(read(file)))
    .map(rel);
  assert.deepEqual(recurringLiterals, ['functions/src/recurring/facts.ts']);
});

test('P4-B — modelo anterior removido: módulo, cron, checkpoint, Rules e índices', () => {
  assert.equal(existsSync('src/modules/recurring-expenses'), false);
  assert.equal(existsSync('functions/src/crons/recurringSchedule.test.ts'), false);
  const cron = read('functions/src/crons/recurring.ts');
  assert.match(cron, /runRecurringGeneration/);
  assert.doesNotMatch(cron, /transactions|collectionGroup|gerarDespesaAutomaticamente|job_checkpoints/);
  const everything = [...sourceFiles('functions/src'), ...sourceFiles('src')]
    .filter((file) => !/__tests__|\.test\.ts$/.test(file));
  assert.deepEqual(offenders(everything, /job_checkpoints\/recurring|gerarDespesaAutomaticamente|RECURRING_SYSTEM_ACTOR_ID/), []);
  for (const file of ['functions/src/cash/eligibility.ts', 'src/modules/transactions/cashEntry.ts']) {
    assert.doesNotMatch(read(file), /["']recurringId["']/, file);
  }
  const rules = readFileSync('firestore.rules', 'utf8');
  for (const coll of ['recurring_expenses', 'recurring_occurrences', 'recurring_events']) {
    const start = rules.indexOf(`match /${coll}/`);
    assert.ok(start > 0, coll);
    const block = rules.slice(start, rules.indexOf('\n      }', start));
    assert.match(block, /allow create, update, delete: if false;/, coll);
    assert.doesNotMatch(block, /canMemberWrite|canWrite/, coll);
  }
  const indexes = readFileSync('firestore.indexes.json', 'utf8');
  assert.doesNotMatch(indexes, /gerarDespesaAutomaticamente|dataPrevista/);
  assert.match(indexes, /"nextDueDate"/);
});

test('P4-B — leituras com teto, filtradas no servidor, por cursor e com índice', () => {
  const api = read('src/modules/recurring/api.ts');
  assert.doesNotMatch(read('src/modules/recurring/hooks.ts') + api, /onSnapshot/);
  const queries = api.split('getDocs(query(').slice(1).map((chunk) => chunk.slice(0, chunk.indexOf('));')));
  assert.ok(queries.length >= 6, 'consultas encontradas');
  for (const body of queries) assert.match(body, /limit\(/, body.slice(0, 80));
  const fn = (name: string) => {
    const start = api.indexOf(`export const ${name} =`);
    assert.ok(start >= 0, name);
    return api.slice(start, api.indexOf('\n};\n', start));
  };
  // Histórico: só resolvidas, mais recentes primeiro, cursor por (vencimento, ID).
  assert.match(fn('listRecurringOccurrences'), /where\('status', 'in', RESOLVED_STATUSES\)/);
  assert.match(fn('listRecurringOccurrences'), /startAfter\(options\.cursor\.dueDate, options\.cursor\.id\)/);
  // Ações pendentes: filtradas no servidor, com corte sinalizado.
  assert.match(fn('listOpenOccurrences'), /where\('status', 'in', OPEN_STATUSES\)/);
  assert.match(fn('listOpenOccurrences'), /truncated: snapshot\.size > RECURRING_OPEN_OCCURRENCES_LIMIT/);
  assert.match(fn('listAmountHistory'), /truncated: snapshot\.size > RECURRING_AMOUNT_HISTORY_LIMIT/);
  const indexes = JSON.parse(readFileSync('firestore.indexes.json', 'utf8')) as {
    indexes: { collectionGroup: string; fields: { fieldPath: string; order?: string }[] }[];
  };
  const shapes = indexes.indexes.filter((index) => index.collectionGroup === 'recurring_occurrences')
    .map((index) => index.fields.map((field) => `${field.fieldPath}:${field.order}`).join(','));
  assert.deepEqual(shapes.sort(), [
    'recurringExpenseId:ASCENDING,status:ASCENDING,dueDate:ASCENDING,__name__:ASCENDING',
    'recurringExpenseId:ASCENDING,status:ASCENDING,dueDate:DESCENDING,__name__:DESCENDING',
  ]);
});
