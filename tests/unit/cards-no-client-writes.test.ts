import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * P4-A (D-36) — guardas estáticas do domínio de cartões.
 *
 * Falham se:
 * 1. o frontend escrever no Firestore em qualquer coleção `credit_card*`, ou
 *    se o módulo e as telas de cartões usarem qualquer escrita do Firestore;
 * 2. voltar autoridade em ponto flutuante nos cartões (`parseFloat`,
 *    `toFixed`, `Number.EPSILON`, `normalizeMoney`, arredondamento no
 *    módulo, campos de limite em reais);
 * 3. `walletId`, `manual_adjustment` ou carteira voltarem ao pagamento;
 * 4. `migration` voltar como origem de compra, ou a migração de parcelas;
 * 5. a camada de compatibilidade ou o módulo antigo voltarem (frontend e
 *    backend), ou campos `legacy*` no domínio novo;
 * 6. houver exclusão física de cartão (callable, `delete()` no backend);
 * 7. o lançamento manual voltar a criar `parcelado` ou a gravar compras de
 *    cartão pelos escritores diretos de `transactions`;
 * 8. um diálogo de cartão gerar chave de idempotência nova por clique, em
 *    vez da chave da intenção;
 * 9. `overdue` ser gravado (o atraso é sempre derivado);
 * 10. o backend de cartões usar classes do namespace `admin.firestore`
 *     como valor.
 * Varre o disco (não o índice do git): arquivo novo não rastreado entra.
 */

const ROOT = 'src';
const BACKEND = join('functions', 'src', 'cards');

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
const read = (file: string): string => stripComments(readFileSync(file, 'utf8'));

const CARD_VIEW_FILES = [
  'components/CreditCardsView.tsx',
  'components/CreditCardForm.tsx',
  'components/CreditCard3D.tsx',
];

const isCardsFile = (file: string): boolean => {
  const path = rel(file);
  return path.startsWith('modules/cards/') ||
    path.startsWith('components/cards/') ||
    CARD_VIEW_FILES.includes(path);
};

const frontendFiles = (): string[] => sourceFiles(ROOT);
const cardFiles = (): string[] => frontendFiles().filter(isCardsFile);
const backendFiles = (): string[] =>
  sourceFiles(BACKEND).filter((file) => !/__tests__|\.test\.ts$/.test(file));

const WRITE_APIS = ['addDoc', 'setDoc', 'updateDoc', 'deleteDoc', 'writeBatch', 'runTransaction'] as const;
const WRITE_PATTERN = new RegExp(`\\b(${WRITE_APIS.join('|')})\\b`, 'g');
const COLLECTION_PATTERN = /(['"`])credit_card[a-z_]*\1|\/credit_card[a-z_]*\//;

/** Detector puro: escrita do Firestore sobre cartões neste código? */
export const findCardWrites = (code: string, inCardsModule: boolean): string[] => {
  const clean = stripComments(code);
  const apis = [...new Set([...clean.matchAll(WRITE_PATTERN)].map((match) => match[1]))].sort();
  if (apis.length === 0) return [];
  if (inCardsModule || COLLECTION_PATTERN.test(clean)) return apis;
  return [];
};

test('P4-A — detector: distingue leitura de escrita sobre as coleções de cartões', () => {
  const reading = `import { getDocs, query, collection } from 'firebase/firestore';
    getDocs(query(collection(db, 'workspaces', ws, 'credit_card_invoices')));`;
  assert.deepEqual(findCardWrites(reading, false), []);
  const writing = `import { updateDoc, doc } from 'firebase/firestore';
    updateDoc(doc(db, 'workspaces', ws, 'credit_cards', id), { limitUsedCents: 0 });`;
  assert.deepEqual(findCardWrites(writing, false), ['updateDoc']);
  assert.deepEqual(findCardWrites(`writeBatch(db).set(doc(x, 'credit_card_purchases'))`, false), ['writeBatch']);
  assert.deepEqual(findCardWrites(`await setDoc(ref, {});`, true), ['setDoc'],
    'no módulo de cartões, qualquer escrita é proibida');
  assert.deepEqual(findCardWrites(`// setDoc(x) só em comentário`, true), []);
});

test('P4-A — nenhum arquivo do frontend escreve em cartões, compras, faturas ou limite', () => {
  const findings = frontendFiles()
    .map((file) => ({ file: rel(file), apis: findCardWrites(readFileSync(file, 'utf8'), isCardsFile(file)) }))
    .filter((finding) => finding.apis.length > 0);
  assert.deepEqual(findings, []);
});

test('P4-A — o módulo e as telas de cartões existem (a varredura não é vazia)', () => {
  const paths = cardFiles().map(rel).sort();
  for (const expected of [
    'modules/cards/api.ts', 'modules/cards/payloads.ts', 'modules/cards/hooks.ts',
    'components/cards/CardInvoicePaymentModal.tsx', 'components/CreditCardsView.tsx',
  ]) {
    assert.ok(paths.includes(expected), `${expected} não foi encontrado`);
  }
});

const FLOAT_PATTERNS: Array<[RegExp, string]> = [
  [/\bparseFloat\b/, 'parseFloat'],
  [/\btoFixed\(/, 'toFixed'],
  [/\bNumber\.EPSILON\b/, 'Number.EPSILON'],
  [/\bnormalizeMoney\b/, 'normalizeMoney'],
  [/\bparseBrlToCents\b/, 'leitura em formato brasileiro de campo numérico'],
];

/** Arredondamento ou campos de valor em reais no núcleo do módulo. */
const MODULE_FLOAT_PATTERNS: Array<[RegExp, string]> = [
  [/\bMath\.round\b/, 'Math.round'],
  [/\*\s*100\b/, 'multiplicação por 100'],
  [/\b(limitTotal|limitUsed|limitAvailable|installmentValue|totalAmount)\s*\??:\s*number\b/, 'campo de valor em reais'],
  [/\bbillingCycleStatus\b/, '`billingCycleStatus` (ciclo manual antigo)'],
];

test('P4-A — cartões sem autoridade em ponto flutuante', () => {
  const findings: string[] = [];
  for (const file of cardFiles()) {
    const clean = read(file);
    for (const [pattern, label] of FLOAT_PATTERNS) {
      if (pattern.test(clean)) findings.push(`${rel(file)}: ${label}`);
    }
    if (!rel(file).startsWith('modules/cards/')) continue;
    for (const [pattern, label] of MODULE_FLOAT_PATTERNS) {
      if (pattern.test(clean)) findings.push(`${rel(file)}: ${label}`);
    }
  }
  assert.deepEqual(findings, []);
});

test('P4-A — tipos de cartão só em centavos inteiros', () => {
  const types = read(join(ROOT, 'modules', 'cards', 'types.ts'));
  for (const field of ['limitTotalCents', 'limitUsedCents', 'totalCents', 'paidCents', 'amountCents']) {
    assert.match(types, new RegExp(`\\b${field}\\s*:\\s*number`), `${field} ausente dos tipos`);
  }
  assert.doesNotMatch(types, /\b(limitTotal|limitUsed|limitAvailable|amount|value)\s*\??:\s*number/);
});

test('P4-A — pagamento sem carteira, `walletId` nem `manual_adjustment`', () => {
  const findings: string[] = [];
  const files = [...cardFiles(), ...backendFiles()];
  for (const file of files) {
    const clean = read(file);
    if (/\bwalletId\b/.test(clean)) findings.push(`${file}: walletId`);
    if (/manual_adjustment/.test(clean)) findings.push(`${file}: manual_adjustment`);
    if (/['"`]wallet['"`]|\bpaymentMethod\b/.test(clean)) findings.push(`${file}: método de pagamento/carteira`);
  }
  assert.deepEqual(findings, []);
  const contracts = read(join(BACKEND, 'contracts.ts'));
  const payment = /registerInvoicePaymentPayloadSchema\s*=([\s\S]*?)\.strict\(\)/.exec(contracts)?.[1] ?? '';
  assert.match(payment, /cashAccountId\s*:/, 'o pagamento exige conta de origem');
});

test('P4-A — `migration` não é origem de compra; não há migração de parcelas', () => {
  const findings: string[] = [];
  for (const file of [...cardFiles(), ...backendFiles()]) {
    const clean = read(file);
    if (/['"`]migration['"`]/.test(clean)) findings.push(`${file}: origem migration`);
    if (/migrateLegacy|migrateInstallments|legacyInstallment/i.test(clean)) findings.push(`${file}: migração`);
  }
  assert.deepEqual(findings, []);
  const model = read(join(BACKEND, 'model.ts'));
  assert.match(model, /PURCHASE_SOURCES\s*=\s*\[\s*"manual",\s*"recurring",\s*"split",?\s*\]/,
    'origens permitidas: manual, recurring e split');
  // A origem nunca vem do cliente: o contrato estrito da compra não tem `source`.
  const contracts = read(join(BACKEND, 'contracts.ts'));
  const purchase = /createCreditCardPurchasePayloadSchema\s*=([\s\S]*?)\.strict\(\)/.exec(contracts)?.[1] ?? '';
  assert.ok(purchase.length > 0, 'contrato da compra não encontrado');
  assert.doesNotMatch(purchase, /\bsource\s*:/);
  const index = read(join('functions', 'src', 'index.ts'));
  assert.doesNotMatch(index, /migrate[A-Za-z]*(Legacy|Installments|Card)/);
  const rules = readFileSync('firestore.rules', 'utf8').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(rules, /'migration'/);
});

test('P4-A — sem camada de compatibilidade nem módulo antigo de cartões', () => {
  assert.equal(existsSync(join(ROOT, 'modules', 'credit-cards')), false, 'src/modules/credit-cards voltou');
  assert.equal(existsSync(join('functions', 'src', 'creditCards')), false, 'functions/src/creditCards voltou');
  assert.equal(existsSync(join('functions', 'src', 'crons', 'creditCardInvoices.ts')), false,
    'cron antigo de faturas voltou');
  const findings: string[] = [];
  for (const file of frontendFiles()) {
    const clean = read(file);
    if (/from\s+['"][^'"]*credit-cards\//.test(clean)) findings.push(`${rel(file)}: import do módulo antigo`);
    if (/from\s+['"][^'"]*compatibility['"]/.test(clean) && /card/i.test(clean)) {
      findings.push(`${rel(file)}: camada de compatibilidade`);
    }
    if (/\b(CreditCardCompat|toLegacyCard|legacyInvoice|creditCardInvoiceId|creditCardPurchaseId|creditCardInstallment)\b/.test(clean)) {
      findings.push(`${rel(file)}: chave de compatibilidade de cartão`);
    }
  }
  for (const file of [...cardFiles(), ...backendFiles()]) {
    if (/\blegacy[A-Z_]\w*/.test(read(file))) findings.push(`${file}: campo legacy*`);
  }
  for (const file of sourceFiles(join('functions', 'src')).filter((path) => !/__tests__|\.test\.ts$/.test(path))) {
    if (/from\s+['"][^'"]*creditCards\//.test(read(file))) findings.push(`${file}: import do backend antigo`);
  }
  assert.deepEqual(findings, []);
});

test('P4-A — sem exclusão física de cartão', () => {
  const findings: string[] = [];
  for (const file of frontendFiles()) {
    if (/\b(deleteCreditCard|useDeleteCreditCard|deleteCard)\b/.test(read(file))) findings.push(rel(file));
  }
  for (const file of backendFiles()) {
    const clean = read(file);
    if (/\.delete\(|recursiveDelete|FieldValue\.delete\(/.test(clean)) findings.push(`${file}: exclusão física`);
  }
  const index = read(join('functions', 'src', 'index.ts'));
  if (/\bdeleteCreditCard\b/.test(index)) findings.push('functions/src/index.ts: deleteCreditCard');
  assert.deepEqual(findings, []);
});

test('P4-A — lançamento manual no cartão só pela callable; nunca cria `parcelado`', () => {
  const modal = read(join(ROOT, 'components', 'TransactionModal.tsx'));
  assert.doesNotMatch(modal, /type:\s*['"]parcelado['"]/, 'o modal voltou a montar `parcelado`');
  assert.doesNotMatch(modal, /\bonAddTransactions\b/, 'o modal voltou a gravar em lote');
  assert.match(modal, /toCreateCardPurchasePayload\(/);
  assert.match(modal, /onAddCreditCardPurchase\(payload,\s*intent\.key\)/);
  const app = read(join(ROOT, 'App.tsx'));
  const modalProps = /<TransactionModal\b([\s\S]*?)\/>/.exec(app)?.[1] ?? '';
  assert.ok(modalProps.length > 0, '<TransactionModal> não encontrado em App.tsx');
  assert.doesNotMatch(modalProps, /\bonAddTransactions\s*=/);
  assert.match(modalProps, /\bonAddCreditCardPurchase\s*=/);
  const findings = cardFiles()
    .filter((file) => /\b(createTransaction|createTransactionsBatch|updateTransaction|deleteTransaction)\b/.test(read(file)))
    .map(rel);
  assert.deepEqual(findings, [], 'telas de cartões usam escritores diretos de `transactions`');
});

test('P4-A — chave de idempotência é da intenção, não do clique', () => {
  const findings: string[] = [];
  for (const file of cardFiles()) {
    if (rel(file) === 'modules/cards/hooks.ts') continue;
    const clean = read(file);
    if (/randomUUID|getRandomValues|newCardIdempotencyKey\s*\(|Date\.now\(\)/.test(clean)) {
      findings.push(`${rel(file)}: chave gerada no clique`);
    }
    // Valor de `idempotencyKey:` só pode ser a chave da intenção (ou o tipo).
    for (const match of clean.matchAll(/\bidempotencyKey\s*:\s*([^,)}\n]+)/g)) {
      const value = match[1].trim();
      if (!/^(\w+\.keyFor\(|string\b|idempotencyKey\b)/.test(value)) {
        findings.push(`${rel(file)}: chave fora de keyFor (${value})`);
      }
    }
  }
  assert.deepEqual(findings, []);
  const hooks = read(join(ROOT, 'modules', 'cards', 'hooks.ts'));
  assert.match(hooks, /resolveIntentKey\(intentRef\.current,/);
  assert.match(hooks, /useMemo\(\(\) => \(\{ keyFor, reset \}\), \[keyFor, reset\]\)/,
    'o objeto da intenção precisa de identidade estável entre renderizações');
  const modal = read(join(ROOT, 'components', 'TransactionModal.tsx'));
  assert.match(modal, /resolveIntentKey\(\s*intentRef\.current,\s*'createCreditCardPurchase'/);
});

test('P4-A — `overdue` nunca é gravado; o atraso é derivado', () => {
  const model = read(join(BACKEND, 'model.ts'));
  const paymentStatus = /type InvoicePaymentStatus\s*=([^;]*);/.exec(model)?.[1] ?? '';
  assert.match(paymentStatus, /"unpaid"\s*\|\s*"partial"\s*\|\s*"paid"/);
  assert.doesNotMatch(paymentStatus, /overdue/);
  const findings: string[] = [];
  for (const file of backendFiles()) {
    const clean = read(file);
    if (/(paymentStatus|cycleStatus|status)\s*:\s*["']overdue["']/.test(clean)) findings.push(file);
  }
  for (const file of cardFiles()) {
    if (/(paymentStatus|cycleStatus)\s*:\s*['"]overdue['"]/.test(read(file))) findings.push(rel(file));
  }
  assert.deepEqual(findings, []);
  const rules = readFileSync('firestore.rules', 'utf8').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(rules, /'overdue'/);
});

test('P4-A — backend de cartões sem classes do namespace `admin.firestore` como valor', () => {
  const findings: string[] = [];
  for (const file of backendFiles()) {
    const match = /\badmin\.firestore\.(Timestamp|FieldValue|FieldPath|AggregateField)\s*[.(]/.exec(read(file));
    if (match) findings.push(`${file}: admin.firestore.${match[1]}`);
  }
  assert.deepEqual(findings, []);
});

test('P4-A — Rules: coleções de cartões somente leitura para o cliente', () => {
  const rules = readFileSync('firestore.rules', 'utf8').replace(/\/\/.*$/gm, '');
  const backendOwned = /function isBackendOwnedCollection\(collectionName\)\s*\{([\s\S]*?)\}/.exec(rules)?.[1] ?? '';
  assert.ok(backendOwned.length > 0, 'isBackendOwnedCollection não encontrada');
  for (const collection of [
    'credit_cards', 'credit_card_purchases', 'credit_card_invoices', 'credit_card_invoice_entries',
    'credit_card_invoice_payments', 'credit_card_limit_ledger', 'credit_card_events',
  ]) {
    // `credit_card_*` entra pelo prefixo da regex; `credit_cards`, pela lista.
    const owned = backendOwned.includes(`'${collection}'`) ||
      (collection.startsWith('credit_card_') && /\^\([^)]*\bcredit_card_\|/.test(backendOwned));
    assert.ok(owned, `${collection} fora de isBackendOwnedCollection`);
    const block = new RegExp(`match /${collection}/\\{[^}]+\\}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`).exec(rules)?.[1] ?? '';
    assert.ok(block.length > 0, `bloco de ${collection} não encontrado`);
    assert.match(block, /allow create, update, delete: if false;/, `${collection} sem negação explícita de escrita`);
    assert.doesNotMatch(block, /allow\s+(write|create|update|delete)\b[^;]*:\s*if\s+(?!false;)/,
      `${collection} aceita escrita do cliente`);
  }
  for (const removed of ['card_limit_ledger', 'card_limit_snapshots', 'invoice_views', 'financial_events']) {
    assert.doesNotMatch(rules, new RegExp(`match /${removed}/`), `${removed} voltou às Rules`);
  }
});
