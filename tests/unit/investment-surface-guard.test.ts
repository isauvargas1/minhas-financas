import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
import {dirname, join, normalize, relative} from 'node:path';

/**
 * P4-D (D-15) — guarda estática da superfície única de investimentos.
 *
 * Falha se:
 * 1. voltar qualquer arquivo da experiência profissional removida (telas,
 *    painel, onboarding, operações avançadas) ou dos jobs de backfill e
 *    rebuild — e, mais importante, se algum código **importar** um módulo com
 *    esses caminhos ou montar um desses componentes, mesmo com outro nome de
 *    arquivo;
 * 2. o frontend ou o E2E chamar uma callable removida;
 * 3. `walletId` ou o grupo `investment_type` voltarem ao código, às Rules ou
 *    aos índices;
 * 4. o espelho em `transactions` voltar a ser fonte patrimonial: metadado
 *    antigo (`investmentMetadata`), meta no espelho ou o card do dashboard
 *    somado do espelho.
 *
 * Varre o disco (não o índice do git): arquivo novo não rastreado entra.
 */

const walk = (dir: string, pattern: RegExp): string[] =>
  existsSync(dir)
    ? readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (name === 'node_modules' || name === 'lib' || name === 'dist') return [];
      if (statSync(path).isDirectory()) return walk(path, pattern);
      return pattern.test(name) ? [path] : [];
    })
    : [];

const CODE = /\.(ts|tsx|mjs|js)$/;
const isTestFile = (path: string): boolean =>
  /(^|\/)(__tests__|tests|e2e)\//.test(path) || /\.test\.(ts|tsx|mjs|js)$/.test(path);

/** Código sem comentários: o texto explicativo pode citar o que foi removido. */
const stripComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

const read = (path: string): string => readFileSync(path, 'utf8');

const frontendFiles = walk('src', CODE);
const backendFiles = walk('functions/src', CODE);
const productionFiles = [...frontendFiles, ...backendFiles].filter((path) => !isTestFile(path));
const everyCodeFile = [...frontendFiles, ...backendFiles, ...walk('tests', CODE), ...walk('e2e', CODE)];

/** Módulos removidos, sem extensão (é assim que um import os nomeia). */
const REMOVED_MODULES = [
  'src/modules/investments/components/InvestmentAllocationSection',
  'src/modules/investments/components/InvestmentDashboardOverview',
  'src/modules/investments/components/InvestmentOnboardingCard',
  'src/modules/investments/components/InvestmentOperationsPanel',
  'src/modules/investments/components/InvestmentRegistrySection',
  'src/modules/investments/components/InvestmentsPortfolioView',
  'src/modules/investments/components/shared',
  'src/modules/investments/persistence/operationsApi',
  'functions/src/investments/onboarding',
  'functions/src/investments/backfill',
  'functions/src/investments/rebuild',
  'functions/src/investments/projectionRebuild',
];

const REMOVED_COMPONENTS = [
  'InvestmentAllocationSection',
  'InvestmentDashboardOverview',
  'InvestmentOnboardingCard',
  'InvestmentOperationsPanel',
  'InvestmentRegistrySection',
  'InvestmentsPortfolioView',
];

/** Callables removidas na D-15 (o backend é coberto em `deploymentContract`). */
const REMOVED_CALLABLES = [
  'onboardInvestmentWorkspace',
  'createInvestmentContribution',
  'createInvestmentRedemption',
  'settleInvestmentRedemption',
  'saveInvestmentAccount',
  'archiveInvestmentAccount',
  'saveInvestmentAsset',
  'archiveInvestmentAsset',
  'recordInvestmentValuation',
  'registerInvestmentImportBatch',
  'recalculateInvestmentPosition',
  'recalculateGoalInvestmentProgress',
  'rebuildInvestmentProjections',
  'backfillInvestmentWorkspace',
];

/** Especificadores de import/export/require/import() de um arquivo. */
export const importSpecifiers = (code: string): string[] => {
  const clean = stripComments(code);
  const found = new Set<string>();
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[\w*{}\s,]+?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bexport\s+(?:type\s+)?[\w*{}\s,]+?\s+from\s+['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of clean.matchAll(pattern)) found.add(match[1]);
  }
  return [...found];
};

/** Caminho do repositório (sem extensão) que um especificador relativo nomeia. */
const resolveSpecifier = (fromFile: string, specifier: string): string | null => {
  if (!specifier.startsWith('.')) return null;
  return relative('.', normalize(join(dirname(fromFile), specifier)))
    .replace(/\\/g, '/')
    .replace(/\.(ts|tsx|js|mjs)$/, '')
    .replace(/\/index$/, '');
};

test('P4-D — detector de import: estático, tipo, reexport, dinâmico e require', () => {
  const code = `
    import X from '../components/InvestmentOperationsPanel';
    import type { Y } from "./persistence/operationsApi.ts";
    export { Z } from '../investments/rebuild';
    const lazy = () => import('./components/InvestmentsPortfolioView');
    const legacy = require('../investments/backfill');
    // import Nope from './comentario';
  `;
  assert.deepEqual(importSpecifiers(code).sort(), [
    '../components/InvestmentOperationsPanel',
    '../investments/backfill',
    '../investments/rebuild',
    './components/InvestmentsPortfolioView',
    './persistence/operationsApi.ts',
  ]);
  assert.equal(
    resolveSpecifier('src/modules/investments/simple/api.ts', '../components/InvestmentOperationsPanel'),
    'src/modules/investments/components/InvestmentOperationsPanel',
  );
  assert.equal(resolveSpecifier('src/App.tsx', 'react'), null);
});

test('P4-D — os módulos da experiência profissional e dos jobs removidos não existem', () => {
  const present = REMOVED_MODULES.filter((module) =>
    ['.ts', '.tsx', '.js', '.mjs'].some((ext) => existsSync(`${module}${ext}`)));
  assert.deepEqual(present, []);
  // A pasta de componentes profissionais não voltou com outro conteúdo.
  assert.equal(existsSync('src/modules/investments/components'), false);
});

test('P4-D — nenhum código importa módulo removido (frontend, backend, testes e E2E)', () => {
  const findings: string[] = [];
  for (const file of everyCodeFile) {
    for (const specifier of importSpecifiers(read(file))) {
      const target = resolveSpecifier(file, specifier);
      if (target && REMOVED_MODULES.includes(target)) findings.push(`${file} → ${specifier}`);
      // O diretório de componentes profissionais, por qualquer caminho.
      if (target?.startsWith('src/modules/investments/components/')) {
        findings.push(`${file} → ${specifier}`);
      }
    }
  }
  assert.deepEqual(findings, []);
});

test('P4-D — nenhum componente profissional é montado ou referenciado no frontend', () => {
  const pattern = new RegExp(`\\b(${REMOVED_COMPONENTS.join('|')})\\b`);
  const findings = frontendFiles
    .filter((file) => pattern.test(stripComments(read(file))))
    .map((file) => relative('.', file));
  assert.deepEqual(findings, []);
});

/**
 * Única menção permitida: a lista que o E2E usa para provar, pelo runtime das
 * Functions, que as callables removidas respondem 404.
 */
const REMOVED_LIST_BLOCK = /const REMOVED_INVESTMENT_CALLABLES = \[[\s\S]*?\];/;

test('P4-D — frontend e E2E não chamam callable removida', () => {
  const pattern = new RegExp(`['"\`](${REMOVED_CALLABLES.join('|')})['"\`]`);
  const findings = [...frontendFiles, ...walk('e2e', CODE)]
    .filter((file) => pattern.test(stripComments(read(file)).replace(REMOVED_LIST_BLOCK, '')))
    .map((file) => relative('.', file));
  assert.deepEqual(findings, []);
  // E a lista do E2E cobre exatamente as removidas.
  const operations = stripComments(read('e2e/investment-operations.spec.ts'));
  const block = REMOVED_LIST_BLOCK.exec(operations)?.[0] ?? '';
  assert.deepEqual([...block.matchAll(/'([A-Za-z]+)'/g)].map((match) => match[1]).sort(),
    [...REMOVED_CALLABLES].sort());
});

test('P4-D — `walletId` e `investment_type` não existem no código, nas Rules nem nos índices', () => {
  const findings: string[] = [];
  for (const file of productionFiles) {
    const clean = stripComments(read(file));
    if (/\bwalletId\b/.test(clean)) findings.push(`${file}: walletId`);
    if (/investment_type/.test(clean)) findings.push(`${file}: investment_type`);
  }
  for (const file of ['firestore.rules', 'firestore.indexes.json']) {
    const content = read(file).replace(/\/\/.*$/gm, '');
    if (/walletId/.test(content)) findings.push(`${file}: walletId`);
    if (/investment_type/.test(content)) findings.push(`${file}: investment_type`);
  }
  assert.deepEqual(findings, []);
});

test('P4-D — o espelho em `transactions` não é lido como fonte patrimonial', () => {
  const findings: string[] = [];
  for (const file of frontendFiles) {
    const clean = stripComments(read(file));
    if (/\binvestmentMetadata\b/.test(clean)) findings.push(`${file}: investmentMetadata`);
    if (/\b(redeemedPrincipalCents|remainingPrincipalCents)\b/.test(clean)) {
      findings.push(`${file}: principal do espelho`);
    }
  }
  assert.deepEqual(findings, []);

  // O tipo `Transaction` não carrega meta nem metadado antigo.
  const types = stripComments(read('src/types.ts'));
  const transaction = types.slice(types.indexOf('export interface Transaction '),
    types.indexOf('\n}', types.indexOf('export interface Transaction ')));
  assert.ok(transaction.length > 0, 'interface Transaction não encontrada');
  assert.doesNotMatch(transaction, /\bgoalId\b|\binvestmentMetadata\b/);
  assert.match(transaction, /\binvestmentEntry\?: TransactionInvestmentEntry/);

  // O backend do espelho não grava meta nem metadado antigo.
  const cash = stripComments(read('functions/src/investments/cash.ts'));
  assert.doesNotMatch(cash, /\bgoalId\b|\binvestmentMetadata\b|\bwalletId\b|settlementDate/);
});

test('P5-C1 — o card "Investimentos" lê o relatório oficial, não o espelho', () => {
  // O Dashboard lê o aporte do mês do relatório do servidor (D-37.5), não a
  // projeção mensal no navegador nem o espelho de caixa.
  const app = stripComments(read('src/App.tsx'));
  assert.match(app, /useFinancialReport\(/);
  assert.match(app, /<SummaryCard title="Investimentos" \{\.\.\.summaryFigure\(dashboard\.investments, 'Mensal'\)\}/);
  assert.doesNotMatch(app, /useInvestmentMonthContribution|summary\.investments|\binvestmentOutflowOf\b/);
  const adapter = stripComments(read('src/modules/reports/adapter.ts'));
  assert.match(adapter, /data\.flows\.contributionsCents/);
  // A fórmula antiga do Dashboard no navegador não existe mais (sem fonte de
  // verdade concorrente): o fluxo de caixa oficial é o do servidor.
  const legacyCashFormula = frontendFiles.filter((path) =>
    /\b(summarizeCashFlow|operationalIncomeOf|operationalExpenseOf|isOperationalIncome|isOperationalExpense|isSplitCashMirror|isLoanCashMirror|isReceivableCashMirror)\b/
      .test(stripComments(read(path))));
  assert.deepEqual(legacyCashFormula, []);
  const api = stripComments(read('src/modules/investments/simple/api.ts'));
  assert.doesNotMatch(api, /useInvestmentMonthContribution|investment-month/);
  assert.doesNotMatch(api, /investment-transactions|listTransactions|transactionsRef/);
});

test('P4-D — a tela simples envia a conta do Caixa só nos fatos liquidados', () => {
  const confirm = stripComments(read('src/modules/investments/simple/components/ConfirmMovementModal.tsx'));
  // Confirmar depósito/recebimento leva a conta; desfazer e cancelar não.
  assert.match(confirm, /if \(intent === 'settleContribution' \|\| intent === 'settleWithdrawal'\) \{\s*payload\.settledAt = instant;\s*payload\.cashAccountId = cashAccountId;/);
  const undoBranch = confirm.slice(confirm.indexOf("} else if (intent === 'undo') {"),
    confirm.indexOf('submittingRef.current = true;'));
  assert.doesNotMatch(undoBranch, /cashAccountId/);
  const form = stripComments(read('src/modules/investments/simple/form.ts'));
  assert.match(form, /\.\.\.\(state\.deposited \? \{ cashAccountId: state\.cashAccountId \} : \{\}\)/);
  assert.match(form, /\.\.\.\(state\.received \? \{ cashAccountId: state\.cashAccountId \} : \{\}\)/);
});
