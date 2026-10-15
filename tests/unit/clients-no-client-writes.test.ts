import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * P3-I — guarda contra a volta do modelo antigo de clientes e recebíveis.
 *
 * Clientes e recebíveis são escritos só pelas callables do backend (D-24,
 * D-39); as Rules negam ao cliente `create`, `update` e `delete` nas seis
 * coleções do domínio. Esta guarda falha se:
 * - um arquivo do frontend usar escrita do Firestore (`addDoc`, `setDoc`,
 *   `updateDoc`, `deleteDoc`, `writeBatch`, `runTransaction`) junto de uma
 *   referência a essas coleções, ou se o módulo e as telas usarem qualquer
 *   escrita;
 * - voltar valor em ponto flutuante como autoridade (`parseFloat`, campo
 *   numérico do navegador, `value` do recebível), status do modelo
 *   substituído (`pending`, `paid`, `overdue` gravado), `as any`, erro
 *   engolido como lista vazia ou `new Date('AAAA-MM-DD')` para atraso.
 * Varre o disco (não o índice do git): arquivo novo ainda não rastreado
 * também entra.
 */

const ROOT = 'src';
const WRITE_APIS = ['addDoc', 'setDoc', 'updateDoc', 'deleteDoc', 'writeBatch', 'runTransaction'] as const;
const WRITE_PATTERN = new RegExp(`\\b(${WRITE_APIS.join('|')})\\b`, 'g');
const COLLECTIONS = [
  'clients', 'client_private', 'client_events',
  'receivables', 'receivable_movements', 'receivable_events',
];
/** Referência às coleções: literal do nome ou segmento de caminho. */
const COLLECTION_PATTERN = new RegExp(
  `(['"\`])(${COLLECTIONS.join('|')})\\1|/(${COLLECTIONS.join('|')})/`,
);

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });

/** Código sem comentários (o texto explicativo pode citar as APIs). */
const stripComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

export interface WriteFinding {
  file: string;
  apis: string[];
  reason: 'domain_collection' | 'domain_module';
}

/** Detector puro: escrita do Firestore sobre clientes/recebíveis neste código? */
export const findClientWrites = (
  file: string,
  code: string,
  inDomainModule: boolean,
): WriteFinding | null => {
  const clean = stripComments(code);
  const apis = [...new Set([...clean.matchAll(WRITE_PATTERN)].map((match) => match[1]))].sort();
  if (apis.length === 0) return null;
  if (inDomainModule) return { file, apis, reason: 'domain_module' };
  if (COLLECTION_PATTERN.test(clean)) return { file, apis, reason: 'domain_collection' };
  return null;
};

const isDomainModule = (file: string): boolean => {
  const path = relative(ROOT, file).replace(/\\/g, '/');
  return path.startsWith('modules/clients/') || path.startsWith('components/clients/') ||
    ['components/ClientsReceivablesView.tsx', 'components/ClientFormModal.tsx',
      'components/ReceivableFormModal.tsx'].includes(path);
};

/** Padrões do modelo substituído, proibidos no módulo e nas telas. */
const LEGACY_PATTERNS: Array<[RegExp, string]> = [
  [/\bparseFloat\b/, 'parseFloat (valor em ponto flutuante)'],
  [/type=["']number["']/, 'campo numérico do navegador para dinheiro'],
  [/['"](pending|paid)['"]/, 'status do modelo substituído'],
  [/\bas any\b/, '`as any`'],
  [/catch\s*\([^)]*\)\s*=>\s*\[\]|\.catch\(\s*\(\)\s*=>\s*\[\]\s*\)|catch\s*(\([^)]*\))?\s*\{\s*return\s*\[\]/, 'erro engolido como lista vazia'],
  [/\bcleanPayload\b/, 'cleanPayload'],
  [/\b(useUpdateReceivableStatus|useDeleteClient|useDeleteReceivable|deleteClient|deleteReceivable)\b/, 'hook/escritor antigo'],
  [/\bvalue:\s*parse|\.value\s*\|\|\s*0|\br\.value\b|receivable\.value\b/, '`value` do recebível'],
  [/new Date\((?!Date\.UTC\(|value\.seconds)/, '`new Date(...)` (data civil vira UTC)'],
  [/toISOString\(\)\.split\('T'\)/, 'data de hoje em UTC'],
];

test('P3-I — detector: distingue leitura de escrita sobre as coleções do domínio', () => {
  const read = `
    import { collection, doc, getDoc, getDocs, query, where, sum, getAggregateFromServer } from 'firebase/firestore';
    const page = await getDocs(query(collection(db, 'workspaces', ws, 'receivables')));
    const one = await getDoc(doc(db, 'workspaces', ws, 'client_private', id));
    // updateDoc(doc(db, 'clients', id)) — comentário não conta
  `;
  assert.equal(findClientWrites('read.ts', read, false), null);
  assert.equal(findClientWrites('read.ts', read, true), null, 'leitura no próprio módulo também é permitida');
  for (const [api, code] of [
    ['addDoc', `await addDoc(collection(db, 'workspaces', ws, 'clients'), data);`],
    ['setDoc', `await setDoc(doc(db, \`workspaces/\${ws}/client_private/\${id}\`), data);`],
    ['updateDoc', `await updateDoc(doc(db, 'workspaces', ws, "receivables", id), { status: 'paid' });`],
    ['deleteDoc', `const COLL = 'receivables'; await deleteDoc(doc(db, 'workspaces', ws, COLL, id));`],
    ['writeBatch', `const batch = writeBatch(db); batch.delete(doc(db, 'workspaces', ws, 'receivable_movements', id));`],
    ['runTransaction', `await runTransaction(db, async (t) => t.set(doc(db, 'workspaces', ws, 'receivable_events', id), {}));`],
  ] as const) {
    assert.deepEqual(findClientWrites('x.ts', code, false)?.apis, [api], api);
  }
  assert.equal(findClientWrites('x.ts', `await addDoc(collection(db, 'workspaces', ws, 'transactions'), t);`, false), null);
  assert.deepEqual(findClientWrites('m.ts', `await addDoc(collection(db, 'outra'), t);`, true)?.reason, 'domain_module');
});

test('P3-I — detector do modelo substituído: reconhece cada padrão proibido', () => {
  const samples = [
    'const v = parseFloat(amount);',
    '<input type="number" step="0.01" />',
    "if (r.status === 'paid') return;",
    'const x = data as any;',
    'listReceivables().catch(() => [])',
    'const payload = cleanPayload(data);',
    'useUpdateReceivableStatus()',
    'total += r.value;',
    "const late = new Date(r.dueDate) < new Date();",
    "const today = new Date().toISOString().split('T')[0];",
  ];
  samples.forEach((sample, index) => {
    assert.ok(LEGACY_PATTERNS.some(([pattern]) => pattern.test(sample)), `amostra ${index}: ${sample}`);
  });
  for (const allowed of [
    'const date = new Date(Date.UTC(year, month - 1, day + days));',
    'const base = new Date(value.seconds * 1000).toISOString().slice(0, 19);',
    "receivable.status === 'open' && receivable.dueDate < today",
  ]) {
    assert.equal(LEGACY_PATTERNS.some(([pattern]) => pattern.test(allowed)), false, allowed);
  }
});

test('P3-I — nenhum escritor de clientes ou recebíveis no frontend', () => {
  const files = sourceFiles(ROOT);
  assert.ok(files.length > 50, 'varredura vazia');
  const domainFiles = files.filter(isDomainModule);
  assert.ok(domainFiles.some((file) => file.endsWith(join('modules', 'clients', 'api.ts'))), 'api.ts no escopo');
  assert.ok(domainFiles.some((file) => file.endsWith('ClientsReceivablesView.tsx')), 'tela no escopo');
  const findings = files
    .map((file) => findClientWrites(file, readFileSync(file, 'utf8'), isDomainModule(file)))
    .filter((finding): finding is WriteFinding => finding !== null);
  assert.deepEqual(findings, [], JSON.stringify(findings, null, 2));
});

test('P3-I — módulo e telas sem o modelo substituído', () => {
  const findings: string[] = [];
  for (const file of sourceFiles(ROOT).filter(isDomainModule)) {
    const code = stripComments(readFileSync(file, 'utf8'));
    for (const [pattern, label] of LEGACY_PATTERNS) {
      if (pattern.test(code)) findings.push(`${file}: ${label}`);
    }
  }
  assert.deepEqual(findings, []);
});

test('P3-I — status persistido só open/received/cancelled; atraso só derivado', () => {
  const types = stripComments(readFileSync(join(ROOT, 'modules', 'clients', 'types.ts'), 'utf8'));
  assert.match(types, /export type ReceivableStatus = 'open' \| 'received' \| 'cancelled';/);
  assert.doesNotMatch(types, /\bvalue\s*[?:]/, 'sem campo `value` em reais');
  // `overdue` aparece só como situação exibida/derivada.
  for (const file of sourceFiles(ROOT).filter(isDomainModule)) {
    const code = stripComments(readFileSync(file, 'utf8'));
    for (const match of code.matchAll(/status\s*(===|==|:)\s*['"]overdue['"]/g)) {
      assert.fail(`${file}: status 'overdue' tratado como persistido (${match[0]})`);
    }
  }
});

test('P3-I — o frontend de clientes não cria lançamento de caixa', () => {
  const transactionWriters = /\b(onAddTransaction|createTransaction|createTransactionsBatch|useCreateTransaction|createCashTransaction|useCreateCashTransaction)\b|from ['"][^'"]*transactions\/(api|cashApi)['"]/;
  for (const file of sourceFiles(ROOT).filter(isDomainModule)) {
    const code = stripComments(readFileSync(file, 'utf8'));
    assert.equal(transactionWriters.test(code), false, `${file} cria lançamento pelo cliente`);
  }
});

test('P3-I — dados pessoais só são pedidos com papel owner/admin; totais pelo saldo', () => {
  const hooks = stripComments(readFileSync(join(ROOT, 'modules', 'clients', 'hooks.ts'), 'utf8'));
  // Toda consulta a `client_private` passa pelo papel antes de habilitar.
  const privateHooks = hooks.split(/export const /).filter((block) =>
    /listClientPrivate\(|getClientPrivate\(/.test(block));
  assert.equal(privateHooks.length, 2, 'dois hooks de dados pessoais');
  for (const block of privateHooks) {
    assert.match(block, /canSeePrivateData/);
    assert.match(block, /enabled: allowed &&/);
  }
  const api = stripComments(readFileSync(join(ROOT, 'modules', 'clients', 'api.ts'), 'utf8'));
  assert.equal((api.match(/sum\('balanceCents'\)/g) ?? []).length, 3, 'totais e situação pelo saldo');
  assert.doesNotMatch(api, /sum\('(?!balanceCents'|principalReceivedCents')/, 'nenhum total por outro campo');
  assert.doesNotMatch(api, /onSnapshot/, 'sem listener');
});
