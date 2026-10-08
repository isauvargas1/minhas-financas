import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * P3-H — guarda contra a volta de escritores de empréstimo no frontend.
 *
 * Empréstimos são escritos só pelas callables do backend (D-13); as Rules
 * negam ao cliente `create`, `update` e `delete` em `loans` e
 * `loan_movements`. Esta guarda falha se um arquivo do frontend voltar a usar
 * uma operação de escrita do Firestore (`addDoc`, `setDoc`, `updateDoc`,
 * `deleteDoc`, `writeBatch`, `runTransaction`) junto de uma referência a essas
 * coleções, ou se o módulo e as telas de empréstimo usarem qualquer escrita.
 * Leitura (`getDoc`, `getDocs`, agregados) segue permitida. Varre o disco (não
 * o índice do git), então arquivo novo ainda não rastreado também entra.
 */

const ROOT = 'src';
const WRITE_APIS = ['addDoc', 'setDoc', 'updateDoc', 'deleteDoc', 'writeBatch', 'runTransaction'] as const;
const WRITE_PATTERN = new RegExp(`\\b(${WRITE_APIS.join('|')})\\b`, 'g');
/** Referência às coleções: literal do nome ou segmento de caminho. */
const LOAN_COLLECTION_PATTERN = /(['"`])(loans|loan_movements)\1|\/(loans|loan_movements)\//;

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
  reason: 'loan_collection' | 'loan_module';
}

/** Detector puro: escrita do Firestore sobre empréstimos neste código? */
export const findLoanWrites = (
  file: string,
  code: string,
  inLoanModule: boolean,
): WriteFinding | null => {
  const clean = stripComments(code);
  const apis = [...new Set([...clean.matchAll(WRITE_PATTERN)].map((match) => match[1]))].sort();
  if (apis.length === 0) return null;
  if (inLoanModule) return { file, apis, reason: 'loan_module' };
  if (LOAN_COLLECTION_PATTERN.test(clean)) return { file, apis, reason: 'loan_collection' };
  return null;
};

const isLoanModule = (file: string): boolean => {
  const path = relative(ROOT, file).replace(/\\/g, '/');
  return path.startsWith('modules/loans/') || path.startsWith('components/loans/') ||
    /^components\/(PJ)?Loan[A-Za-z]*\.tsx$/.test(path);
};

test('P3-H — detector: distingue leitura de escrita sobre loans/loan_movements', () => {
  const read = `
    import { collection, doc, getDoc, getDocs, query, where, sum, getAggregateFromServer } from 'firebase/firestore';
    const page = await getDocs(query(collection(db, 'workspaces', ws, 'loans')));
    const one = await getDoc(doc(db, 'workspaces', ws, 'loan_movements', id));
    // updateDoc(doc(db, 'loans', id)) — comentário não conta
  `;
  assert.equal(findLoanWrites('read.ts', read, false), null);
  assert.equal(findLoanWrites('read.ts', read, true), null, 'leitura no próprio módulo também é permitida');
  for (const [api, code] of [
    ['addDoc', `await addDoc(collection(db, 'workspaces', ws, 'loans'), data);`],
    ['setDoc', `await setDoc(doc(db, \`workspaces/\${ws}/loans/\${id}\`), data);`],
    ['updateDoc', `await updateDoc(doc(db, 'workspaces', ws, "loan_movements", id), { amount: 1 });`],
    ['deleteDoc', `const COLL = 'loans'; await deleteDoc(doc(db, 'workspaces', ws, COLL, id));`],
    ['writeBatch', `const batch = writeBatch(db); batch.set(doc(db, 'workspaces', ws, 'loan_movements', id), m);`],
    ['runTransaction', `await runTransaction(db, async (t) => t.update(doc(db, 'workspaces', ws, 'loans', id), {}));`],
  ] as const) {
    assert.deepEqual(findLoanWrites('x.ts', code, false)?.apis, [api], api);
  }
  // Escrita de outra coleção, fora do módulo: não é desta guarda.
  assert.equal(findLoanWrites('x.ts', `await addDoc(collection(db, 'workspaces', ws, 'transactions'), t);`, false), null);
  // Dentro do módulo de empréstimos, qualquer escrita é recusada.
  assert.deepEqual(findLoanWrites('m.ts', `await addDoc(collection(db, 'outra'), t);`, true)?.reason, 'loan_module');
});

test('P3-H — nenhum escritor de empréstimo no frontend', () => {
  const files = sourceFiles(ROOT);
  assert.ok(files.length > 50, 'varredura vazia');
  const loanFiles = files.filter(isLoanModule);
  assert.ok(loanFiles.some((file) => file.endsWith(join('modules', 'loans', 'api.ts'))), 'api.ts no escopo');
  assert.ok(loanFiles.some((file) => file.endsWith('LoanDetailsView.tsx')), 'telas no escopo');
  const findings = files
    .map((file) => findLoanWrites(file, readFileSync(file, 'utf8'), isLoanModule(file)))
    .filter((finding): finding is WriteFinding => finding !== null);
  assert.deepEqual(findings, [], JSON.stringify(findings, null, 2));
});

test('P3-H — o frontend de empréstimos não cria espelho de caixa', () => {
  // O espelho nasce no backend, no mesmo commit do movimento. Nenhuma tela ou
  // hook de empréstimo cria lançamento por conta própria.
  const transactionWriters = /\b(onAddTransaction|createTransaction|createTransactionsBatch|useCreateTransaction|createCashTransaction|useCreateCashTransaction)\b|from ['"][^'"]*transactions\/(api|cashApi)['"]/;
  for (const file of sourceFiles(ROOT).filter(isLoanModule)) {
    const code = stripComments(readFileSync(file, 'utf8'));
    assert.equal(transactionWriters.test(code), false, `${file} cria lançamento pelo cliente`);
  }
});

test('P3-H — leitura e totais pelo schema autoritativo; sem caminho antigo', () => {
  const api = stripComments(readFileSync(join(ROOT, 'modules', 'loans', 'api.ts'), 'utf8'));
  assert.match(api, /getDocs\(/, 'a leitura continua');
  assert.equal((api.match(/sum\('balanceCents'\)/g) ?? []).length, 2, 'a receber e a pagar por balanceCents');
  assert.doesNotMatch(api, /sum\('(?!balanceCents')/, 'nenhum total por outro campo');
  assert.match(api, /OPEN_STATUSES: LoanStatus\[\] = \['active', 'overdue'\]/, 'quitado e cancelado fora');
  for (const file of sourceFiles(ROOT).filter(isLoanModule)) {
    const code = stripComments(readFileSync(file, 'utf8'));
    for (const legacy of ['currentBalance', 'principalValue', 'totalPaidReceived', 'onAddTransaction',
      'generateInstallmentPlan', 'generatePJAmortizationPlan', 'createMovement', 'deleteLoan', 'Date.now(']) {
      assert.equal(code.includes(legacy), false, `${file}: ${legacy}`);
    }
  }
});
