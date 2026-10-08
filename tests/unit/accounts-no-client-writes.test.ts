import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * P3-J (D-30) — guardas estáticas de contas/carteiras e transferências.
 *
 * Falham se:
 * 1. o frontend escrever no Firestore em `cash_accounts`,
 *    `cash_account_movements`, `cash_transfers` ou na auditoria — ou se o
 *    módulo e as telas de contas usarem qualquer escrita do Firestore;
 * 2. algum payload do frontend levar `balanceCents` (o saldo não é editável);
 * 3. o grupo genérico `wallet` do catálogo voltar (literal do grupo,
 *    `wallets`, `initialWallets`, `walletSnapshot`, `walletId`) em qualquer
 *    lugar do frontend — investimentos inclusive, desde a P4-D;
 * 4. um módulo ou tela do domínio P3 (caixa manual, contas, empréstimos,
 *    clientes/recebíveis) usar os escritores diretos de `transactions`, ou
 *    qualquer arquivo voltar a declará-los ou consumi-los (removidos na P4-D);
 * 5. voltar autoridade em ponto flutuante nas contas (`parseFloat`, campo
 *    numérico do navegador, divisão ou multiplicação por 100);
 * 6. o backend da P3 usar as classes do namespace `admin.firestore` como
 *    valor (quebram no runtime das Functions).
 * Varre o disco (não o índice do git): arquivo novo não rastreado entra.
 */

const ROOT = 'src';

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });

/** Código sem comentários (o texto explicativo pode citar as APIs). */
const stripComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const rel = (file: string): string => relative(ROOT, file).replace(/\\/g, '/');

const WRITE_APIS = ['addDoc', 'setDoc', 'updateDoc', 'deleteDoc', 'writeBatch', 'runTransaction'] as const;
const WRITE_PATTERN = new RegExp(`\\b(${WRITE_APIS.join('|')})\\b`, 'g');
const COLLECTIONS = ['cash_accounts', 'cash_account_movements', 'cash_transfers', 'cash_account_events'];
const COLLECTION_PATTERN = new RegExp(
  `(['"\`])(${COLLECTIONS.join('|')})\\1|/(${COLLECTIONS.join('|')})/`,
);

const isAccountsModule = (file: string): boolean => {
  const path = rel(file);
  return path.startsWith('modules/accounts/') || path.startsWith('components/accounts/');
};

/** Detector puro: escrita do Firestore sobre contas neste código? */
export const findAccountWrites = (code: string, inAccountsModule: boolean): string[] => {
  const clean = stripComments(code);
  const apis = [...new Set([...clean.matchAll(WRITE_PATTERN)].map((match) => match[1]))].sort();
  if (apis.length === 0) return [];
  if (inAccountsModule || COLLECTION_PATTERN.test(clean)) return apis;
  return [];
};

test('P3-J — detector: distingue leitura de escrita sobre as coleções de contas', () => {
  const read = `import { getDocs, query, collection } from 'firebase/firestore';
    getDocs(query(collection(db, 'workspaces', ws, 'cash_accounts')));`;
  assert.deepEqual(findAccountWrites(read, false), []);
  const write = `import { updateDoc, doc } from 'firebase/firestore';
    updateDoc(doc(db, 'workspaces', ws, 'cash_accounts', id), { balanceCents: 0 });`;
  assert.deepEqual(findAccountWrites(write, false), ['updateDoc']);
  assert.deepEqual(findAccountWrites(`await setDoc(ref, {});`, true), ['setDoc'],
    'no módulo de contas, qualquer escrita é proibida');
  assert.deepEqual(findAccountWrites(`// setDoc(x) só em comentário`, true), []);
});

test('P3-J — nenhum arquivo do frontend escreve em contas, movimentos ou transferências', () => {
  const findings = sourceFiles(ROOT)
    .map((file) => ({ file: rel(file), apis: findAccountWrites(readFileSync(file, 'utf8'), isAccountsModule(file)) }))
    .filter((finding) => finding.apis.length > 0);
  assert.deepEqual(findings, []);
});

test('P3-J — nenhum payload do frontend edita o saldo da conta', () => {
  for (const file of sourceFiles(ROOT)) {
    const clean = stripComments(readFileSync(file, 'utf8'));
    const path = rel(file);
    if (!path.startsWith('modules/accounts/') && !path.startsWith('components/accounts/')) continue;
    // `balanceCents` só pode ser lido (adaptador, exibição), nunca enviado.
    if (path === 'modules/accounts/payloads.ts' || path === 'modules/accounts/callables.ts') {
      assert.doesNotMatch(clean, /\bbalanceCents\b\s*:/, `${path} envia balanceCents`);
    }
  }
});

/**
 * Sem exceção: cartões (P4-A) e investimentos (P4-D) usam a conta do Caixa
 * (`cashAccountId`); a carteira de investimentos é `investment_class`.
 */
const WALLET_P4_ALLOWLIST: string[] = [];
const WALLET_PATTERNS: Array<[RegExp, string]> = [
  [/['"`]wallet['"`]/, 'grupo `wallet` do catálogo'],
  [/\bwallets\b/, '`wallets` (cadastro genérico)'],
  [/\binitialWallets\b/, '`initialWallets`'],
  [/\bwalletSnapshot\b/, '`walletSnapshot`'],
  [/\bwalletId\b/, '`walletId` em lançamento'],
];

test('P3-J/P4-D — o grupo genérico `wallet` e o `walletId` não voltam ao frontend', () => {
  const findings: string[] = [];
  for (const file of sourceFiles(ROOT)) {
    const path = rel(file);
    if (WALLET_P4_ALLOWLIST.some((prefix) => path.startsWith(prefix))) continue;
    const clean = stripComments(readFileSync(file, 'utf8'))
      // Termos de busca de ícone em inglês ("wallet bank cash") não são o grupo.
      .replace(/term:\s*'[^']*'/g, '');
    for (const [pattern, label] of WALLET_PATTERNS) {
      if (pattern.test(clean)) findings.push(`${path}: ${label}`);
    }
  }
  assert.deepEqual(findings, []);
});

test('P3-J — o backend e as Rules não semeiam nem aceitam o grupo `wallet`', () => {
  for (const file of ['functions/src/workspaces/provisioning.ts', 'functions/src/settingsCatalog/seeds.ts']) {
    assert.doesNotMatch(stripComments(readFileSync(file, 'utf8')), /['"]wallet['"]/, file);
  }
  // D-23 (P4-E): a lista de grupos aceitos é do domínio do catálogo no
  // backend; as Rules não aceitam escrita do cliente em grupo nenhum.
  const model = stripComments(readFileSync('functions/src/settingsCatalog/model.ts', 'utf8'));
  const catalogGroups = /SETTINGS_CATALOG_GROUPS = \[([\s\S]*?)\]/.exec(model)?.[1] ?? '';
  assert.ok(catalogGroups.includes('"income_type"'), 'lista de grupos do catálogo não encontrada');
  assert.doesNotMatch(catalogGroups, /"wallet"/);
  const rules = readFileSync('firestore.rules', 'utf8').replace(/\/\/.*$/gm, '');
  const catalogBlock = rules.slice(rules.indexOf('match /settings_catalog/'),
    rules.indexOf('match /settings_catalog_uniques/'));
  assert.match(catalogBlock, /allow create, update, delete: if false;/);
  assert.doesNotMatch(rules, /'walletId'/, '`walletId` voltou à superfície do cliente nas Rules');
});

/** Escritores diretos de `transactions` (cliente) — removidos na P4-D. */
const DIRECT_WRITERS = /\b(createTransaction|createTransactionsBatch|updateTransaction|deleteTransaction|useCreateTransaction|useCreateTransactionsBatch|useUpdateTransaction|useDeleteTransaction)\b/;

const P3_DOMAIN_FILES = (path: string): boolean =>
  ['modules/accounts/', 'components/accounts/', 'modules/clients/', 'components/clients/',
    'modules/loans/', 'components/loans/'].some((prefix) => path.startsWith(prefix)) ||
  [
    'modules/transactions/cashEntry.ts', 'modules/transactions/cashCallables.ts',
    'modules/transactions/cashApi.ts', 'components/ClientsReceivablesView.tsx',
    'components/ClientFormModal.tsx', 'components/ReceivableFormModal.tsx',
    'components/LoanFormModal.tsx', 'components/PJLoanFormModal.tsx',
    'components/LoansView.tsx', 'components/PJLoansView.tsx',
    'components/LoanDetailsView.tsx', 'components/PJLoanDetailsView.tsx',
    'components/SettingsView.tsx',
  ].includes(path);

test('P3-J — nenhum módulo ou tela do domínio P3 usa escritor direto de `transactions`', () => {
  const findings = sourceFiles(ROOT)
    .filter((file) => P3_DOMAIN_FILES(rel(file)))
    .filter((file) => DIRECT_WRITERS.test(stripComments(readFileSync(file, 'utf8'))))
    .map(rel);
  assert.deepEqual(findings, []);
});

test('P4-D — os escritores diretos de `transactions` não existem mais no cliente', () => {
  // Os produtores da P4 (cartões, recorrências, divisão de contas,
  // investimentos) passaram às callables, e as Rules negam toda escrita do
  // cliente em `transactions`. Nem definição, nem consumidor.
  const consumers = sourceFiles(ROOT)
    .filter((file) => DIRECT_WRITERS.test(stripComments(readFileSync(file, 'utf8'))))
    .map(rel)
    .sort();
  assert.deepEqual(consumers, []);
});

const FLOAT_PATTERNS: Array<[RegExp, string]> = [
  [/\bparseFloat\b/, 'parseFloat'],
  [/type=["']number["']/, 'campo numérico do navegador'],
  [/\/\s*100\b/, 'divisão por 100'],
  [/\*\s*100\b/, 'multiplicação por 100'],
  [/\btoFixed\(/, 'toFixed'],
];

test('P3-J — contas e transferências sem autoridade em ponto flutuante', () => {
  const findings: string[] = [];
  for (const file of sourceFiles(ROOT)) {
    if (!isAccountsModule(file)) continue;
    const clean = stripComments(readFileSync(file, 'utf8'));
    for (const [pattern, label] of FLOAT_PATTERNS) {
      if (pattern.test(clean)) findings.push(`${rel(file)}: ${label}`);
    }
  }
  assert.deepEqual(findings, []);
});

/**
 * Runtime das Functions: o namespace `admin.firestore` não expõe as classes
 * como valor (`Timestamp`, `FieldValue`, `FieldPath` chegam `undefined`),
 * embora os testes de integração — que chamam as funções exportadas
 * diretamente — passem. Os domínios do backend da P3 usam a API modular
 * (`firebase-admin/firestore`); uso como tipo continua permitido.
 */
const P3_BACKEND_DIRS = ['accounts', 'cash', 'loans', 'receivables'];
const NAMESPACE_VALUE = /\badmin\.firestore\.(Timestamp|FieldValue|FieldPath)\s*[.(]/;

test('P3-J — backend da P3 sem classes do namespace `admin.firestore` como valor', () => {
  const findings: string[] = [];
  const files = [
    ...P3_BACKEND_DIRS.flatMap((dir) => sourceFiles(join('functions', 'src', dir))),
    join('functions', 'src', 'workspaces', 'provisioning.ts'),
  ].filter((file) => !/__tests__|testSupport|\.test\.ts$/.test(file));
    for (const file of files) {
    const clean = stripComments(readFileSync(file, 'utf8'));
    const match = NAMESPACE_VALUE.exec(clean);
    if (match) findings.push(`${file}: admin.firestore.${match[1]}`);
  }
  assert.deepEqual(findings, []);
});
