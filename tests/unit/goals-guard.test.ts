import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * P5-B — guardas estáticas do frontend de metas. O progresso financeiro vem
 * do backend; o navegador não o calcula, não lê campo removido, não consulta
 * sem `limit` e não faz polling.
 */

const GOAL_FILES = [
  'src/modules/goals/api.ts',
  'src/modules/goals/hooks.ts',
  'src/modules/goals/model.ts',
  'src/modules/goals/timeline.ts',
  'src/components/GoalCard.tsx',
  'src/components/GoalsView.tsx',
  'src/components/GoalDetailsView.tsx',
  'src/components/GoalFormModal.tsx',
];

const stripComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const read = (path: string): string => stripComments(readFileSync(path, 'utf8'));

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });

test('o cálculo de indicador PJ no navegador não existe mais', () => {
  for (const file of sourceFiles('src')) {
    const code = read(file);
    assert.equal(/calculateBusinessGoalProgress/.test(code), false, file);
    assert.equal(/\bgetPeriodDates\b/.test(code), false, file);
  }
  const logic = (() => { try { return readFileSync('src/modules/goals/logic.ts', 'utf8'); } catch { return ''; } })();
  assert.equal(logic, '');
  const projection = (() => { try { return readFileSync('src/modules/goals/projection.ts', 'utf8'); } catch { return ''; } })();
  assert.equal(projection, '');
});

test('toda consulta de metas tem limit', () => {
  const api = read('src/modules/goals/api.ts');
  const queries = api.split(/\bquery\(/).slice(1);
  assert.ok(queries.length >= 3);
  for (const body of queries) {
    const closing = body.indexOf('));');
    const call = body.slice(0, closing === -1 ? body.length : closing);
    assert.match(call, /\blimit\(/);
  }
  // A lista usa exatamente a consulta do contrato, com a sonda de 26.
  assert.match(api, /orderBy\('priorityRank', 'desc'\)/);
  assert.match(api, /GOALS_PAGE_SIZE \+ 1/);
  assert.equal(/where\('archived', '==', false\),\s*orderBy\(documentId\(\)\)/.test(api), false);
});

test('valor de meta não passa por ponto flutuante', () => {
  for (const file of GOAL_FILES) {
    const code = read(file);
    assert.equal(/\bparseFloat\b/.test(code), false, file);
    assert.equal(/Number\.parseFloat/.test(code), false, file);
    assert.equal(/\btoFixed\(/.test(code), false, file);
  }
});

test('campos removidos do contrato não são lidos nem enviados', () => {
  const removed = [
    'targetAmount', 'currentAmount', 'currentAmountCents', 'currentValue',
    'currentValueCents', 'netContributionCents', 'isAutomatic',
    'startDateTimestamp', 'deadlineTimestamp',
  ];
  const files = [...GOAL_FILES, 'src/types.ts', 'src/App.tsx', 'src/modules/reports/hooks.ts'];
  for (const file of files) {
    const code = read(file);
    for (const field of removed) {
      assert.equal(new RegExp(`\\b${field}\\b`).test(code), false, `${file}: ${field}`);
    }
  }
});

test('não há polling, consulta legada nem leitura de transações nas metas', () => {
  for (const file of GOAL_FILES) {
    const code = read(file);
    assert.equal(/refetchInterval/.test(code), false, file);
    assert.equal(/\blegacy\b/i.test(code), false, file);
    assert.equal(/useCashPeriods|cashBalanceFromPeriods/.test(code), false, file);
  }
  for (const file of ['src/components/GoalCard.tsx', 'src/components/GoalsView.tsx', 'src/components/GoalDetailsView.tsx']) {
    assert.equal(/\btransactions\b/.test(read(file)), false, file);
  }
});

test('o frontend de metas só lê o Firestore: toda escrita é de callable', () => {
  for (const file of ['src/modules/goals/api.ts', 'src/modules/goals/hooks.ts', ...GOAL_FILES]) {
    const code = read(file);
    assert.equal(/\b(addDoc|setDoc|updateDoc|deleteDoc|writeBatch|runTransaction)\b/.test(code), false, file);
  }
});

test('seletores de investimento só listam metas de fonte investment', () => {
  const api = read('src/modules/goals/api.ts');
  assert.match(api, /where\('progressSource', '==', 'investment'\)/);
  assert.match(read('src/App.tsx'), /useInvestmentGoalOptions\(\)/);
});

test('P5-B.1: metas de investimento sem teto fixo, uma página por vez e só quando pedida', () => {
  const api = read('src/modules/goals/api.ts');
  assert.equal(/INVESTMENT_GOAL_OPTIONS_MAX/.test(api), false, 'teto fixo de metas voltou');
  const start = api.indexOf('export const listInvestmentGoalOptionsPage');
  assert.ok(start >= 0, 'consulta paginada das metas de investimento');
  const body = api.slice(start, api.indexOf('\n};', start));
  assert.equal(/\b(while|for)\s*\(/.test(body), false, 'a consulta não acumula páginas sozinha');
  assert.match(body, /where\('archived', '==', false\)/);
  assert.match(body, /where\('progressSource', '==', 'investment'\)/);
  assert.match(body, /startAfter\(cursor\.name, cursor\.id\)/);
  assert.match(body, /limit\(INVESTMENT_GOAL_OPTIONS_PAGE \+ 1\)/);
  assert.match(api, /export const INVESTMENT_GOAL_OPTIONS_PAGE = 25;/);
  // Busca por ID: lotes com `limit` dentro do teto das Rules, nunca a coleção inteira.
  const byIds = api.slice(api.indexOf('export const listActiveInvestmentGoalsByIds'));
  assert.match(byIds, /where\(documentId\(\), 'in', chunk\)/);
  assert.match(byIds, /limit\(GOALS_BY_ID_CHUNK\)/);
  // Por ID volta só meta de investimento não arquivada, como na lista.
  assert.match(byIds, /if \(!goal\.archived && goal\.progressSource === 'investment'\) goals\.push\(goal\);/);
  assert.match(api, /export const GOALS_BY_ID_CHUNK = 25;/);

  const hooks = read('src/modules/goals/hooks.ts');
  const hook = hooks.slice(hooks.indexOf('export const useInvestmentGoalOptions'));
  assert.match(hook, /useInfiniteQuery\(/);
  assert.match(hook, /getNextPageParam: \(lastPage\) => lastPage\.nextCursor \?\? undefined/);

  const app = read('src/App.tsx');
  assert.match(app, /const \{ goals, paging: investmentGoalPaging \} = useInvestmentGoalOptions\(\);/);
  assert.equal((app.match(/goalPaging=\{investmentGoalPaging\}/g) ?? []).length, 2,
    'Investimentos e o modal de lançamento recebem a paginação');
  const form = read('src/modules/investments/simple/components/SimpleInvestmentForm.tsx');
  assert.match(form, /onClick=\{goalPaging\.loadMore\}/);
  assert.match(form, /Carregar mais metas/);
  assert.match(form, /useInvestmentGoalsByIds\(selectedMissingIds\)/, 'meta selecionada fora da página continua visível');
  const view = read('src/modules/investments/simple/components/SimpleInvestmentsView.tsx');
  assert.match(view, /useInvestmentGoalsByIds\(unloadedGoalIds\)/, 'posição de meta além da página não vira "Meta removida"');
});

test('P5-B.1: o formulário PJ oferece meta manual ao lado dos indicadores', () => {
  const model = read('src/modules/goals/model.ts');
  const source = model.slice(model.indexOf('export const formProgressSource'));
  assert.match(source, /^export const formProgressSource[^]*?if \(state\.measure === 'manual'\) return 'manual';\n  if \(profile === 'PF'\)/,
    'manual decide antes do perfil');
  assert.match(model, /\.\.\.\(profile === 'PJ' && progressSource !== 'manual'\n      \? \{businessType: state\.businessType\}/);
  const modal = read('src/components/GoalFormModal.tsx');
  const pj = modal.slice(modal.indexOf('if (isPJ) {'));
  assert.match(pj, /onClick=\{\(\) => patch\(\{ measure: 'manual', icon: PJ_MANUAL_GOAL\.icon \}\)\}/);
  assert.match(pj, /aria-pressed=\{progressSource === 'manual'\}/);
  assert.match(pj, /id="goal-manual-value"/);
  assert.match(modal, /label: 'Valor informado'/);
});

test('P5-B.1: centro de custo aparece como informativo no formulário e no detalhe', () => {
  const modal = read('src/components/GoalFormModal.tsx');
  assert.match(modal, /aria-describedby="goal-cost-center-help"/);
  assert.match(modal, /<p id="goal-cost-center-help"[^>]*>\{GOAL_COST_CENTER_NOTE\}<\/p>/);
  const details = read('src/components/GoalDetailsView.tsx');
  assert.match(details, /Centro de custo: \{goal\.costCenter\}/);
  assert.match(details, /goal\.costCenter && goal\.progressSource === 'business_kpi'/);
  assert.match(details, /\{GOAL_COST_CENTER_KPI_NOTE\}/);
  // Nenhum cálculo por centro de custo no backend nesta etapa (D-37/P5-C).
  const kpi = stripComments(readFileSync('functions/src/goals/kpi.ts', 'utf8'));
  assert.equal(/costCenter/.test(kpi), false, 'indicador não filtra por centro de custo');
});

test('o modelo é puro: sem React, Firebase nem import sem extensão', () => {
  for (const file of ['src/modules/goals/model.ts', 'src/modules/goals/timeline.ts']) {
    const code = read(file);
    assert.equal(/from 'react'|from 'firebase|@tanstack/.test(code), false, file);
    for (const match of code.matchAll(/from '(\.[^']+)'/g)) {
      assert.match(match[1], /\.ts$/, `${file}: ${match[1]}`);
    }
  }
});
