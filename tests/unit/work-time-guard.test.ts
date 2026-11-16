import assert from 'node:assert/strict';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

import {
  BRAZILIAN_UFS,
  WORK_TIME_ESTIMATE_MODES,
  WORK_TIME_HISTORY_MONTHS,
  WORK_TIME_PREFERENCE_FIELDS,
} from '../../src/modules/work-time/contract.ts';
import {
  ANNUAL_PATTERN,
  CYCLE_COUNT_PATTERN,
  DATE_PATTERN,
  DAY_PATTERN,
  EXCEPTION_PATTERN,
  LOCAL_HOLIDAY_PATTERN,
  MAX_EXCEPTIONS,
  MAX_EXCEPTIONS_LENGTH,
  MAX_EXCLUDED_IDS_LENGTH,
  MAX_EXCLUDED_INCOME_IDS,
  MAX_LOCAL_HOLIDAYS,
  MAX_LOCAL_HOLIDAYS_LENGTH,
  MAX_MUNICIPALITY_LENGTH,
  MAX_ROUTINES,
  MAX_ROUTINES_LENGTH,
  MINUTES_0_PATTERN,
  MINUTES_1_PATTERN,
  MUNICIPALITY_PATTERN,
  RECORD_ID_PATTERN,
  ROUTINE_PATTERN,
  TIME_PATTERN,
  WORK_DAY_PATTERN,
} from '../../src/modules/work-time/grammar.ts';

/**
 * P5-F (REQ-FUT-01), contrato v2 da P5-F.1 — guarda estática da privacidade
 * e da matriz de cobertura do tempo de trabalho equivalente.
 *
 * - A configuração (rotina, feriados, exceções, fonte e exclusões de renda)
 *   só existe no documento privado do usuário: nenhuma Function, nenhum
 *   caminho da IA, notificação, relatório ou DTO financeiro a lê ou grava;
 *   nenhuma cópia local (`localStorage`, React Query no módulo) e nenhum log
 *   com dados. A renda, os minutos e o valor da hora são derivados em
 *   memória e nunca gravados.
 * - A conversão é só exibição: os arquivos de entrada, confirmação, termo
 *   contratual, histórico e preço (BRL obrigatório na matriz) não importam a
 *   camada de exibição; os pontos elegíveis a usam.
 * - As Rules aceitam exatamente o contrato do cliente.
 */

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (path: string) => readFileSync(join(root, path), 'utf8');
/** Mesmo critério de `investment-surface-guard.test.ts`: comentário pode explicar o que o código não faz. */
const stripComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const readCode = (path: string) => stripComments(read(path));

const sourceFiles = (dir: string): string[] =>
  readdirSync(join(root, dir), {withFileTypes: true}).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(path);
    return /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name) ? [path] : [];
  });

const WORK_TIME_MODULE = 'src/modules/work-time';
const SETTINGS_VIEW = 'src/components/WorkTimeSettingsView.tsx';
/** Componentes do assistente e das Configurações (P5-F.1). */
const WORK_TIME_COMPONENTS = 'src/components/workTime';
/** Fora da pasta do módulo, só um caminho com `work-time/` chega até ele (import estático ou dinâmico). */
const importsWorkTime = (source: string) => /(?:from\s+|import\s*\(\s*)['"][^'"]*work-time\/[^'"]*['"]/.test(source);

/** Identificadores que só existem no domínio privado da preferência (v2) e o v1 removido. */
const PRIVATE_IDENTIFIERS = /private_preferences|work_time_equivalent|incomeWorkspaceId|excludedIncomeIds|allowBusinessIncome|worksOnHolidays|localHolidays|monthlyIncomeCents|monthlyWorkMinutes|modules\/work-time\//;

test('a varredura alcança o repositório real', () => {
  assert.ok(existsSync(join(root, 'src/components/Header.tsx')), 'raiz do repositório não encontrada');
  assert.ok(existsSync(join(root, `${WORK_TIME_MODULE}/calculation.ts`)), 'módulo do tempo de trabalho não encontrado');
  assert.ok(sourceFiles('src').length > 100);
  assert.ok(sourceFiles('functions/src').length > 50);
});

test('nenhuma Function lê, grava ou menciona a preferência privada', () => {
  for (const path of sourceFiles('functions/src')) {
    assert.doesNotMatch(read(path), PRIVATE_IDENTIFIERS, path);
    assert.doesNotMatch(read(path), /\bwork[_-]?time\b|tempo de trabalho/i, path);
  }
});

test('IA, notificações e relatórios autoritativos não recebem a preferência', () => {
  const sensitive = [
    ...sourceFiles('src/modules/ai'),
    ...sourceFiles('src/modules/notifications'),
    ...sourceFiles('src/modules/reports'),
    'src/components/ReportsAIChat.tsx',
    'src/components/AiShareConsentDialog.tsx',
    'src/components/NotificationsPanel.tsx',
    'src/components/ReportsAlertsPanel.tsx',
  ];
  for (const path of sensitive) {
    const source = read(path);
    assert.equal(importsWorkTime(source), false, `${path} importa o módulo do tempo de trabalho`);
    assert.doesNotMatch(source, PRIVATE_IDENTIFIERS, path);
  }
});

test('DTOs, chamadas e adaptadores financeiros não carregam tempo de trabalho', () => {
  const dataModules = sourceFiles('src/modules').filter((path) =>
    !path.startsWith(WORK_TIME_MODULE) &&
    /\/(payloads|callables|api|cashApi|cashCallables|officialApi|adapters?|hooks|model|contract|presentation|types)\.tsx?$/.test(path));
  assert.ok(dataModules.length > 40, 'a varredura precisa alcançar os módulos de dados');
  for (const path of dataModules) {
    const source = read(path);
    assert.equal(importsWorkTime(source), false, `${path} importa o módulo do tempo de trabalho`);
    assert.doesNotMatch(source, /workTime|WorkTime|minutosEquivalentes|equivalentMinutes/, path);
  }
});

test('nenhuma cópia local da preferência e nenhuma leitura do cache do SDK no app', () => {
  const privateFiles = [...sourceFiles(WORK_TIME_MODULE), ...sourceFiles(WORK_TIME_COMPONENTS), SETTINGS_VIEW];
  for (const path of privateFiles) {
    const source = readCode(path);
    assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/, `${path}: armazenamento local`);
    assert.doesNotMatch(source, /@tanstack\/react-query|useQuery|queryClient/, `${path}: cache do React Query`);
  }
  for (const path of sourceFiles('src')) {
    assert.doesNotMatch(readCode(path), /\bget(Doc|Docs)FromCache\b/, `${path}: leitura do cache local do Firestore`);
  }
});

/** Único formato aceito: mensagem fixa (literal, ou o rótulo do `logCode`) e só o código do erro. */
const FIXED_ERROR_LOG = /^console\.error\((?:'[^'\n]*'|label), typeof code === 'string' \? code : 'desconhecido'\);$/;

test('logs da preferência só levam mensagem fixa e código de erro', () => {
  const files = [...sourceFiles(WORK_TIME_MODULE), ...sourceFiles(WORK_TIME_COMPONENTS), SETTINGS_VIEW, 'src/components/Header.tsx'];
  for (const path of files) {
    const source = read(path);
    assert.doesNotMatch(source, /console\.(log|info|debug|warn|trace|table|dir)\s*\(/, `${path}: log fora do padrão`);
    const errorCalls = source.match(/console\.error\s*\([^;]*\);/g) ?? [];
    assert.equal(errorCalls.length, (source.match(/console\.error\b/g) ?? []).length, `${path}: console.error fora do formato verificável`);
    for (const call of errorCalls) {
      assert.match(call, FIXED_ERROR_LOG, `${path}: ${call}`);
      assert.doesNotMatch(call, /income|Income|preference|Preference|Cents|Minutes|form\b|draft|hourly/, `${path}: ${call}`);
    }
  }
  // O rótulo do `logCode` da tela de Configurações é sempre uma mensagem fixa, e o segundo argumento é o erro.
  const settings = read(SETTINGS_VIEW);
  const labelled = settings.match(/logCode\([^;]*\);/g) ?? [];
  assert.ok(labelled.length >= 2, 'salvar e excluir registram falha só com o código');
  for (const call of labelled) assert.match(call, /^logCode\('[^'\n]*', error\);$/, call);
});

test('sessão: troca de conta e respostas atrasadas não expõem a preferência de outra conta', () => {
  const source = readCode(`${WORK_TIME_MODULE}/WorkTimeContext.tsx`);
  // Toda gravação do estado leva o uid do listener que a produziu.
  const writes = source.match(/setState\(\{[^}]*\}\)/g) ?? [];
  assert.equal(writes.length, 4, 'ocioso, carregando, pronto e erro');
  for (const write of writes) assert.match(write, /^setState\(\{ uid(: null)?, status: /, write);
  assert.doesNotMatch(source, /setState\(\s*\(/, 'atualização funcional herdaria o uid anterior');
  // O estado exposto só vale para o uid atual: o de outra conta vira "carregando", com valores em reais.
  assert.match(source, /const current: ListenerState = state\.uid === uid\s*\? state\s*: \{ uid, status: uid \? 'loading' : 'idle', snapshot: null \};/);
  // Tudo o que sai do provedor vem de `current`; `state` só aparece na derivação acima.
  assert.match(source, /const snapshot = current\.status === 'ready' \? current\.snapshot : null;/);
  assert.match(source, /status: current\.status,/);
  assert.equal(source.match(/\bstate\./g)?.length, 1, '`state.` só na derivação de `current`');
  // O listener é cancelado quando o uid muda: o efeito devolve o cancelamento e depende do uid.
  assert.match(source, /return subscribeWorkTimePreference\(\s*uid,/);
  assert.match(source, /\}, \[uid, retryNonce\]\);/);
});

test('a preferência só é lida e gravada no documento privado do próprio usuário', () => {
  const api = read(`${WORK_TIME_MODULE}/api.ts`);
  assert.match(api, /workTimePreferencePathSegments\(uid\)/);
  assert.doesNotMatch(api, /\bcollection\(|collectionGroup|workspaces|query\(/, 'nenhuma consulta nem caminho de workspace');
  for (const path of sourceFiles(WORK_TIME_MODULE)) {
    // Só `projectionReads.ts` lê documentos de workspace (as coleções da projeção de caixa, só leitura): guarda própria abaixo.
    if (path === `${WORK_TIME_MODULE}/projectionReads.ts`) continue;
    assert.doesNotMatch(read(path), /['"`]workspaces['"`/]/, `${path}: caminho de workspace`);
  }
  const contract = read(`${WORK_TIME_MODULE}/contract.ts`);
  assert.match(contract, /\['users', uid, WORK_TIME_PREFERENCES_COLLECTION, WORK_TIME_PREFERENCE_ID\]/);
});

/**
 * Avalia as funções sem parâmetro `wt*` das Rules: cada uma devolve uma
 * concatenação de literais e de chamadas a outras `wt*()`. Assim o padrão
 * que as Rules usam é comparado, texto a texto, com o do cliente.
 */
const rulesPatterns = (rules: string) => {
  const bodies = new Map<string, string>();
  for (const match of rules.matchAll(/function (wt\w+)\(\) \{\s*return ([\s\S]*?);\s*\}/g)) bodies.set(match[1], match[2]);
  const token = /\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|(wt\w+)\(\))\s*(\+|$)/y;
  const evaluate = (name: string, depth = 0): string => {
    assert.ok(depth < 10, `recursão em ${name}`);
    const body = bodies.get(name);
    assert.ok(body !== undefined, `função ${name} ausente nas Rules`);
    let out = '';
    const text = body.trim();
    let position = 0;
    while (position < text.length) {
      token.lastIndex = position;
      const part = token.exec(text);
      assert.ok(part, `${name}: expressão fora do formato (${text.slice(position, position + 30)})`);
      const end = token.lastIndex;
      const literal = part[1] ?? part[2];
      out += literal !== undefined ? literal.replace(/\\\\/g, '\\') : evaluate(part[3], depth + 1);
      position = end;
      if (part[4] === '') break;
    }
    return out;
  };
  return {names: [...bodies.keys()], evaluate};
};

test('Rules: bloco explícito do titular, campos, gramáticas e limites iguais ao contrato v2 do cliente', () => {
  const rules = read('firestore.rules');
  const usersBlock = rules.slice(rules.indexOf('match /users/{userId} {'), rules.indexOf('match /billing_accounts/{billingOwnerUid}'));
  assert.match(usersBlock, /match \/private_preferences\/\{preferenceId\} \{/);
  assert.match(usersBlock, /allow get, delete: if isOwnWorkTimePreference\(userId, preferenceId\);/);
  assert.match(usersBlock, /allow create, update: if isOwnWorkTimePreference\(userId, preferenceId\) &&\s+isValidWorkTimePreference\(request\.resource\.data\);/);
  assert.match(usersBlock, /allow list: if false;/);
  assert.match(rules, /hasActiveAccount\(\) &&\s+request\.auth\.uid == userId &&\s+preferenceId == 'work_time_equivalent'/);
  const fieldList = `[\n          ${[
    "'schemaVersion', 'enabled', 'displayMode', 'estimateMode',",
    "'historyMonths', 'incomeWorkspaceId', 'allowBusinessIncome',",
    "'excludedIncomeIds', 'routines', 'worksOnHolidays', 'uf',",
    "'municipality', 'localHolidays', 'exceptions', 'updatedAt',",
  ].join('\n          ')}\n        ]`;
  assert.equal(rules.split(`hasOnly(${fieldList})`).length - 1, 1, 'hasOnly com a lista exata');
  assert.equal(rules.split(`hasAll(${fieldList})`).length - 1, 1, 'hasAll com a lista exata');
  assert.deepEqual([...WORK_TIME_PREFERENCE_FIELDS], [
    'schemaVersion', 'enabled', 'displayMode', 'estimateMode', 'historyMonths', 'incomeWorkspaceId', 'allowBusinessIncome',
    'excludedIncomeIds', 'routines', 'worksOnHolidays', 'uf', 'municipality', 'localHolidays', 'exceptions', 'updatedAt',
  ]);
  // O v1 (renda e carga digitadas) não existe mais nas Rules.
  assert.doesNotMatch(rules, /monthlyIncomeCents|monthlyWorkMinutes/);
  assert.match(rules, /data\.schemaVersion is int &&\s+data\.schemaVersion == 2 &&/);

  // Gramáticas: o padrão avaliado de cada função das Rules é o do cliente.
  const {evaluate} = rulesPatterns(rules);
  const expected: Record<string, string> = {
    wtDate: DATE_PATTERN,
    wtAnnual: ANNUAL_PATTERN,
    wtMinutes0: MINUTES_0_PATTERN,
    wtMinutes1: MINUTES_1_PATTERN,
    wtTime: TIME_PATTERN,
    wtCycleCount: CYCLE_COUNT_PATTERN,
    wtRecordId: RECORD_ID_PATTERN,
    wtMunicipality: MUNICIPALITY_PATTERN,
    wtDay: DAY_PATTERN,
    wtWorkDay: WORK_DAY_PATTERN,
    wtRoutine: ROUTINE_PATTERN,
    wtException: EXCEPTION_PATTERN,
    wtLocalHoliday: LOCAL_HOLIDAY_PATTERN,
  };
  for (const [name, pattern] of Object.entries(expected)) assert.equal(evaluate(name), pattern, name);
  // Listas: uma cópia do item sobre o texto com o separador no fim; vazia só onde o contrato permite.
  assert.match(rules, /function wtListMatches\(text, item, separator\) \{\s*return text == '' \|\| \(text \+ separator\)\.matches\('\(\?:' \+ item \+ separator \+ '\)\+'\);\s*\}/);
  assert.match(rules, /\(data\.routines \+ ';'\)\.matches\('\(\?:' \+ wtRoutine\(\) \+ ';\)\{1,3\}'\) &&/);
  assert.equal(MAX_ROUTINES, 3);
  assert.match(rules, /wtListMatches\(data\.excludedIncomeIds, wtRecordId\(\), ','\) &&/);
  assert.match(rules, /wtListMatches\(data\.localHolidays, wtLocalHoliday\(\), ';'\) &&/);
  assert.match(rules, /wtListMatches\(data\.exceptions, wtException\(\), ';'\) &&/);
  assert.match(rules, /data\.incomeWorkspaceId\.matches\(wtRecordId\(\)\) &&/);
  assert.match(rules, /data\.municipality\.matches\(wtMunicipality\(\)\) &&/);
  // Tamanhos e quantidades.
  assert.match(rules, new RegExp(`data\\.routines\\.size\\(\\) <= ${MAX_ROUTINES_LENGTH} &&`));
  assert.match(rules, new RegExp(`data\\.excludedIncomeIds\\.size\\(\\) <= ${MAX_EXCLUDED_IDS_LENGTH} &&`));
  assert.match(rules, new RegExp(`data\\.excludedIncomeIds\\.split\\(','\\)\\.size\\(\\) <= ${MAX_EXCLUDED_INCOME_IDS} &&`));
  assert.match(rules, new RegExp(`data\\.localHolidays\\.size\\(\\) <= ${MAX_LOCAL_HOLIDAYS_LENGTH} &&`));
  assert.match(rules, new RegExp(`data\\.localHolidays\\.split\\(';'\\)\\.size\\(\\) <= ${MAX_LOCAL_HOLIDAYS} &&`));
  assert.match(rules, new RegExp(`data\\.exceptions\\.size\\(\\) <= ${MAX_EXCEPTIONS_LENGTH} &&`));
  assert.match(rules, new RegExp(`data\\.exceptions\\.split\\(';'\\)\\.size\\(\\) <= ${MAX_EXCEPTIONS} &&`));
  assert.match(rules, new RegExp(`data\\.municipality\\.size\\(\\) <= ${MAX_MUNICIPALITY_LENGTH} &&`));
  // Enumerações iguais às do cliente.
  assert.ok(rules.includes(`data.estimateMode in [${WORK_TIME_ESTIMATE_MODES.map((mode) => `'${mode}'`).join(', ')}] &&`));
  assert.ok(rules.includes(`data.historyMonths in [${WORK_TIME_HISTORY_MONTHS.join(', ')}] &&`));
  const ufs = rules.slice(rules.indexOf('data.uf in ['), rules.indexOf('] &&', rules.indexOf('data.uf in [')));
  assert.deepEqual([...ufs.matchAll(/'([A-Z]{0,2})'/g)].map((match) => match[1]), ['', ...BRAZILIAN_UFS]);
  for (const field of ['enabled', 'allowBusinessIncome', 'worksOnHolidays']) assert.match(rules, new RegExp(`data\\.${field} is bool &&`));
  for (const field of ['incomeWorkspaceId', 'excludedIncomeIds', 'routines', 'municipality', 'localHolidays', 'exceptions']) {
    assert.match(rules, new RegExp(`data\\.${field} is string &&`), field);
  }
  assert.match(rules, /data\.updatedAt == request\.time;/);
  // Nenhuma regra de collection group nem curinga recursivo, com qualquer nome, fora do billing alcança a subcoleção.
  const recursive = [...rules.matchAll(/match\s+\/\{\w+=\*\*\}/g)];
  assert.equal(recursive.length, 1, 'um único curinga recursivo');
  assert.equal(recursive[0][0], 'match /{document=**}');
  assert.ok((recursive[0].index ?? 0) > rules.indexOf('match /billing_accounts/{billingOwnerUid}'), 'curinga recursivo só no billing_accounts');
  assert.equal(rules.split('private_preferences').length - 1, 2, 'só o comentário e o match do bloco do usuário');
});

test('nada derivado é gravado: só a API do módulo escreve, e só os campos do contrato', () => {
  const writers = /\b(setDoc|updateDoc|addDoc|deleteDoc|writeBatch|runTransaction)\s*\(/;
  for (const path of [...sourceFiles(WORK_TIME_MODULE), ...sourceFiles(WORK_TIME_COMPONENTS), SETTINGS_VIEW]) {
    if (path === `${WORK_TIME_MODULE}/api.ts`) continue;
    // `projectionReads.ts` usa `runTransaction` só para ler (guarda própria abaixo): nenhuma escrita na transação.
    if (path === `${WORK_TIME_MODULE}/projectionReads.ts`) continue;
    assert.doesNotMatch(readCode(path), writers, `${path} grava no Firestore`);
  }
  const api = readCode(`${WORK_TIME_MODULE}/api.ts`);
  assert.match(api, /setDoc\(preferenceRef\(uid\), \{ \.\.\.workTimePreferenceFields\(preference\), updatedAt: serverTimestamp\(\) \}\)/);
  assert.match(api, /updateDoc\(preferenceRef\(uid\), \{ displayMode, updatedAt: serverTimestamp\(\) \}\)/);
  assert.equal(api.match(/\b(setDoc|updateDoc|deleteDoc)\(/g)?.length, 3, 'só gravar, trocar o modo e apagar');
  const contract = readCode(`${WORK_TIME_MODULE}/contract.ts`);
  const fieldsBody = contract.slice(contract.indexOf('export const workTimePreferenceFields'), contract.indexOf('const roundTrip'));
  assert.doesNotMatch(fieldsBody, /incomeCents|workMinutes|hourlyRate|receipts|config/, 'nenhum valor derivado no documento');
});

test('leitura das marcas de aplicação (P5-F.1-R3): só uma transação de leitura, só nas coleções da projeção, sem escrita, escuta nem cache', () => {
  const path = `${WORK_TIME_MODULE}/projectionReads.ts`;
  const source = readCode(path);
  assert.match(source, /^import \{ doc, runTransaction \} from 'firebase\/firestore';/, 'só `doc` e `runTransaction` do SDK');
  assert.equal(source.match(/\brunTransaction\(/g)?.length, 1, 'uma transação');
  // A transação só lê: `transaction.get` (os meses e as marcas) e nenhum outro método dela.
  assert.equal(source.match(/\btransaction\.get\(/g)?.length, 2, 'os meses e as marcas');
  assert.equal(source.match(/\btransaction\.\w+/g)?.length, 2, 'nenhum outro método da transação');
  assert.doesNotMatch(source, /\b(set|update|delete|create)\s*\(/, 'nenhum set/update/delete');
  assert.doesNotMatch(source, /\b(setDoc|updateDoc|deleteDoc|addDoc|writeBatch)\s*\(/, 'nenhuma escrita');
  assert.doesNotMatch(source, /\b(onSnapshot|getDoc|getDocs|getDocFromCache|getDocsFromCache|getDocFromServer|getDocsFromServer|query|collection|collectionGroup)\s*\(/,
    'nenhuma escuta, consulta nem leitura fora da transação (que não usa o cache local)');
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|persistence|Cache|@tanstack\/react-query|useQuery|queryClient/i, 'nenhum cache');
  // Só os documentos dos meses e das marcas, sempre sob o workspace validado.
  const refs = [...source.matchAll(/\bdoc\(db, 'workspaces', workspaceId, '([a-z_]+)', /g)].map((match) => match[1]).sort();
  assert.deepEqual(refs, ['cash_projection_marks', 'cash_report_periods']);
  assert.equal(source.match(/\bdoc\(/g)?.length, 2, 'nenhum outro `doc(`');
  assert.equal(source.match(/['"`]workspaces['"`]/g)?.length, 2, 'o único caminho de workspace é o dos dois documentos');
  assert.match(source, /if \(!workspaceId \|\| workspaceId === 'loading'\) throw new Error\(/, 'workspace validado antes de qualquer leitura');
  assert.ok(source.indexOf("workspaceId === 'loading'") < source.indexOf('runTransaction(db'), 'validação antes da transação');
  // Tetos: nenhuma leitura sem limite.
  assert.match(source, /uniqueMonths\.length > PROJECTION_MONTHS_MAX \|\| uniqueIds\.length > PROJECTION_MARKS_MAX/);
  assert.match(source, /\{ maxAttempts: 5 \}/);
  // As Rules só deixam ler (membro do workspace) e negam qualquer escrita do cliente nas duas coleções.
  const rules = read('firestore.rules');
  for (const collection of ['cash_projection_marks', 'cash_report_periods']) {
    assert.match(rules, new RegExp(`match /${collection}/\\{\\w+\\} \\{[^}]*?allow (?:write|create, update, delete): if false;`), `${collection}: sem escrita do cliente`);
    assert.match(rules, new RegExp(`match /${collection}/\\{\\w+\\} \\{\\s*allow get: if canReadWorkspaceScopedData\\(workspaceId\\);`), `${collection}: leitura só por quem lê o workspace`);
  }
  // As marcas não são consultadas: o cliente só as lê por id, na transação.
  assert.match(rules, /match \/cash_projection_marks\/\{\w+\} \{\s*allow get: if canReadWorkspaceScopedData\(workspaceId\);\s*allow list: if false;\s*allow create, update, delete: if false;\s*\}/, 'cash_projection_marks: sem consulta e sem escrita');
});

test('estimativa: uma por contexto, sem polling nem listener por lançamento', () => {
  // Sem `setInterval`, `refetchInterval` nem listener fora do documento da própria preferência.
  for (const path of [...sourceFiles(WORK_TIME_MODULE), ...sourceFiles(WORK_TIME_COMPONENTS), SETTINGS_VIEW]) {
    const source = readCode(path);
    assert.doesNotMatch(source, /setInterval|refetchInterval/, `${path}: polling`);
    if (path !== `${WORK_TIME_MODULE}/api.ts`) assert.doesNotMatch(source, /onSnapshot/, `${path}: listener`);
  }
  // A exibição lê só a configuração pronta do contexto; o cálculo da estimativa fica no provedor
  // (e nas prévias das Configurações e do assistente, sobre o rascunho).
  const users = [...sourceFiles('src')].filter((path) => /\buseIncomeEstimate\(/.test(readCode(path)) && !path.endsWith('useIncomeEstimate.ts'));
  assert.deepEqual(users.sort(), [
    'src/components/WorkTimeSettingsView.tsx',
    'src/components/workTime/WorkTimeWizard.tsx',
    'src/modules/work-time/WorkTimeContext.tsx',
  ]);
  const display = readCode(`${WORK_TIME_MODULE}/display.tsx`);
  assert.match(display, /const config = !forcedMoney && workTime\?\.displayMode === 'time' \? workTime\.config : null;/);
  // As bases do relatório não acompanham a invalidação dos relatórios das telas (mutação nesta aba,
  // listener do mês do App): elas relêem pela escuta das projeções e, na virada do mês, pela
  // invalidação própria, que só as marca e pede a releitura pelo agendador de cada base carregada
  // (falhas zeradas). O comportamento está em `report-basis-sync.test.ts`; aqui, a fiação real.
  const keys = read('src/modules/reports/queryKeys.ts');
  const reportsBody = keys.slice(keys.indexOf('export const invalidateFinancialReports'), keys.indexOf('export const invalidateFinancialReportBases'));
  assert.ok(reportsBody.length > 0);
  assert.match(reportsBody, /await queryClient\.invalidateQueries\(\{ queryKey: \[FINANCIAL_REPORT_KEY\] \}\);/);
  assert.doesNotMatch(reportsBody, /FINANCIAL_REPORT_BASIS_KEY|refreshRegisteredBases/, 'a invalidação das telas não toca as bases');
  assert.match(keys, /const invalidated = queryClient\.invalidateQueries\(\{ queryKey: \[FINANCIAL_REPORT_BASIS_KEY\], refetchType: 'none' \}\);\s*refreshRegisteredBases\(\);\s*await invalidated;/);
  const registry = read('src/modules/reports/basisRegistry.ts');
  assert.match(registry, /if \(\(keys && !keys\.includes\(key\)\) \|\| !entry\.loaded\(\)\) continue;/, 'base que nunca carregou fica fora do agendador');
  // A projeção e a virada do mês relêem pelo agendador da escuta, com as falhas zeradas.
  assert.match(registry, /entry\.failure = \{ \.\.\.entry\.failure, failures: 0 \};\s*scheduleBasisReread\(key, entry\.scheduler\);/);
  // A mutação nesta aba relê as bases carregadas do workspace dela, sem zerar as falhas (o teto continua
  // valendo), pelo agendador da mutação: orçamento próprio, que não atrasa a escuta (R6-03).
  assert.match(registry, /if \(entry\.workspaceId !== workspaceId \|\| !entry\.loaded\(\) \|\| entry\.failure\.failures >= entry\.maxFailures\) continue;\s*scheduleBasisReread\(key, entry\.mutationScheduler\);/);
  // Todo pedido de releitura de uma base passa pelo registro, que guarda a ordem dele (R8-01).
  assert.match(registry, /export const scheduleBasisReread = \(key: string, scheduler: \{ notify: \(\) => void \}\): void => \{\s*basisOrder \+= 1;\s*const open = openRequests\.get\(key\) \?\? \[\];\s*open\.push\(basisOrder\);\s*openRequests\.set\(key, open\);\s*scheduler\.notify\(\);\s*\};/);
  assert.match(registry, /export const noteBasisReadStart = \(key: string\): number => \{\s*basisOrder \+= 1;\s*readStartedAt\.set\(key, basisOrder\);\s*return basisOrder;\s*\};/);
  // A leitura com dados cobre os pedidos anteriores ao começo dela, se nenhuma outra começou depois (a nova cancela
  // a anterior); as bases ficam fora de passo só quando uma leu um pedido que outra ainda vai ler (R10-01).
  assert.match(registry, /export const noteBasisReadServed = \(key: string, started: number\): void => \{\s*if \(readStartedAt\.get\(key\) !== started\) return;\s*servedReadStartedAt\.set\(key, started\);\s*const open = \(openRequests\.get\(key\) \?\? \[\]\)\.filter\(\(request\) => request > started\);/);
  assert.match(registry, /export const basesOutOfStep = \(keys: readonly string\[\]\): boolean =>\s*keys\.some\(\(behind\) => \{\s*const firstOpen = openRequests\.get\(behind\)\?\.\[0\];\s*if \(firstOpen === undefined \|\| !rereadPending\(behind\)\) return false;\s*return keys\.some\(\(other\) => other !== behind && \(servedReadStartedAt\.get\(other\) \?\? 0\) > firstOpen\);\s*\}\);/);
  assert.doesNotMatch(registry, /forgetBasisOrder|\.delete\(key\);\s*readStartedAt/, 'a ordem fica quando a base sai de uso');
  assert.equal(registry.match(/\.notify\(\)/g)?.length, 1, 'nenhum agendador notificado fora de scheduleBasisReread');
  assert.match(keys, /export const FINANCIAL_REPORT_BASIS_MUTATION_REFRESH = \{\s*coalesceMs: 30_000,\s*burst: 2,\s*refillMs: 600_000,\s*\} as const;/);
  assert.match(keys, /export const FINANCIAL_REPORT_BASIS_REFRESH = \{\s*coalesceMs: 5_000,\s*burst: 5,\s*refillMs: 120_000,\s*\} as const;/);
  // A escuta real: uma consulta das projeções mensais da janela (até 13 documentos), com os metadados
  // de cache (o retorno só do cache não conta) e a contagem de documentos que mudaram.
  const hooks = readCode('src/modules/reports/hooks.ts');
  assert.match(readCode('src/modules/reports/basisSync.ts'), /export const BASIS_PERIODS_MAX = 13;/);
  assert.match(hooks, /export const firebaseBasisDeps: BasisSyncDeps = \{/);
  assert.match(hooks, /collection\(db, 'workspaces', workspaceId, 'cash_report_periods'\),\s*where\(documentId\(\), '>=', firstMonth\),\s*where\(documentId\(\), '<=', lastMonth\),\s*limit\(BASIS_PERIODS_MAX\),\s*\),\s*\{ includeMetadataChanges: true \},/);
  assert.match(hooks, /fromCache: snapshot\.metadata\.fromCache,\s*changes: snapshot\.docChanges\(\)\.length,/);
  assert.equal(hooks.match(/onSnapshot\(/g)?.length, 2, 'a escuta das bases e a do mês do App, nada mais');
  // O listener do mês do App relê só os relatórios das telas; a virada do mês relê também as bases.
  // (RR-R2A-04: a releitura pela escuta do mês pula a leitura em curso que já começou depois da mudança vista.)
  assert.match(hooks, /createLiveRefreshScheduler\(\(\) => \{\s*void refreshFinancialReportsAfterChange\(queryClient, lastChange\.current\);\s*\}\);/);
  assert.match(hooks, /setMonthKey\(current\);\s*void invalidateFinancialReports\(queryClient\);\s*void invalidateFinancialReportBases\(queryClient\);/);
  assert.equal(hooks.match(/invalidateFinancialReportBases\(queryClient\)/g)?.length, 1, 'só na virada do mês');
  const sync = readCode('src/modules/reports/basisSync.ts');
  assert.doesNotMatch(sync, /firebase|onSnapshot|getDocs/, 'a lógica não importa o SDK');
  // Uma leitura com dados zera as falhas também sem a base desatualizada (a base relida com sucesso sai do
  // teto); a falha dessa releitura fica registrada sem contar, nem depois; só a base desatualizada conta a
  // falha e é relida de novo depois dela (R8-01, R9-04).
  assert.match(sync, /if \(!enabled \|\| isFetching \|\| dataUpdatedAt === 0\) return;\s*const entry = basisRefreshes\.get\(refreshKey\);\s*if \(!entry\) return;\s*if \(!isStale\) \{\s*entry\.failure = \{ dataUpdatedAt, errorUpdatedAt, failures: dataUpdatedAt !== entry\.failure\.dataUpdatedAt \? 0 : entry\.failure\.failures \};\s*return;\s*\}\s*const decision = basisRefreshAfter\(entry\.failure, \{ dataUpdatedAt, errorUpdatedAt \}, BASIS_RETRIES_AFTER_ERROR\);\s*entry\.failure = decision\.state;\s*if \(decision\.notify\) scheduleBasisReread\(refreshKey, entry\.scheduler\);/);
  assert.doesNotMatch(sync, /\.notify\(\)/, 'a sincronização pede releitura só pelo registro');
  assert.match(sync, /maxFailures: BASIS_RETRIES_AFTER_ERROR,\s*workspaceId: workspaceId as string,\s*loaded: \(\) => \(queryClient\.getQueryState\(exactKey\)\?\.dataUpdatedAt \?\? 0\) !== 0,/);
  // O pedido da escuta relê só as bases da própria estimativa e não marca as leituras de receitas.
  assert.match(sync, /refreshRegisteredBases\(current\.keys\);\s*setWaitingKey\(key\);/);
  for (const path of sourceFiles('src')) assert.doesNotMatch(readCode(path), /markIncomeReadsStale/, `${path}: leituras de receitas marcadas fora da liberação`);
  // Escuta encerrada por erro: a projeção recebida deixa de valer, aviso na estimativa e registro para
  // a reabertura (R6-01, R6-02); a escuta que volta a responder e o "Tentar de novo" de qualquer
  // estimativa da mesma conta e do mesmo workspace reabrem as encerradas, e só elas.
  assert.match(sync, /\}, \(\) => \{\s*projected\.current = null;\s*changed\.current = false;\s*attempts\.current = new Map\(\);\s*setConfirmed\(null\);\s*setListenFailedKey\(syncKey\);\s*unregister\?\.\(\);\s*unregister = registerFailedListener\(syncKey, \(\) => setListenAttempt\(\(attempt\) => attempt \+ 1\)\);\s*evaluate\.current\(false\);\s*\}\);\s*return \(\) => \{\s*unregister\?\.\(\);\s*unsubscribe\(\);\s*\};\s*\}, \[enabled, syncKey, uid, workspaceId, firstMonth, lastMonth, monthsKey, deps, listenAttempt\]\);/);
  // O retorno só do cache local (sem conexão, ou antes do retorno do servidor) derruba a projeção confirmada e não conta
  // como retorno do servidor (P5-F.1-R3.2, RR-R31-05); até a R3.1 ele só era ignorado, e a confirmação anterior ficava.
  assert.match(sync, /if \(snapshot\.fromCache\) \{\s*setConfirmed\(null\);\s*return;\s*\}\s*noteServerSnapshot\(syncKey\);\s*reopenFailedListeners\(syncKey\);/);
  // A leitura de cada base guarda quantos retornos do servidor já tinham chegado quando começou (R7-02),
  // e a base nova sem pedido só libera com todas as bases da estimativa fora de leitura (R7-01). Com mais
  // de uma base, as bases fora de passo (alguma em leitura ou com releitura pendente pedida depois do começo
  // da última leitura dela, nos dois agendadores) seguram na renderização, com ou sem leitura dependente; a
  // base que sai de uso com releitura pendente fica desatualizada (R8-01, R9-01, R9-02).
  assert.match(sync, /queryFn: async \(\) => \{\s*(?:\/\/[^\n]*\n\s*)*basisFetchStarts\.set\(refreshKey, serverSnapshotCount\(syncKeyOf\(uid as string, workspaceId as string\)\)\);\s*const started = noteBasisReadStart\(refreshKey\);\s*const report = await deps\.fetchReport\(\{[^}]*\}\);\s*noteBasisReadServed\(refreshKey, started\);\s*return report;/);
  assert.match(sync, /basisRefreshes\.delete\(refreshKey\);\s*basisFetchStarts\.delete\(refreshKey\);\s*\}/);
  // A base que sai de uso com releitura pendente fica marcada e é relida na volta pelo agendador, se ninguém a lê
  // (a leitura em curso na saída, terminando depois, desfaz a desatualização) (R10-03).
  assert.match(sync, /if \(takeRereadOnReturn\(refreshKey\) && entry\.loaded\(\) && \(queryClient\.getQueryState\(exactKey\)\?\.fetchStatus \?\? 'idle'\) === 'idle'\) \{\s*void queryClient\.invalidateQueries\(\{ queryKey: exactKey, exact: true, refetchType: 'none' \}\);\s*scheduleBasisReread\(refreshKey, entry\.scheduler\);\s*\}/);
  assert.match(sync, /paired\.current = \{ key, income: current\.income, reads: value \};\s*return;\s*\}\s*if \(current\.exact && !current\.fetching && !sameIncome\(current\.income, pair\.income\)\) release\.current\(\);/);
  assert.match(sync, /const outOfStep = syncKey !== null && basis !== null && basis\.keys\.length > 1 &&\s*\(basis\.fetching \|\| basesOutOfStep\(basis\.keys\)\);/);
  assert.match(sync, /if \(current\.users === 0\) \{\s*(?:\/\/[^\n]*\n\s*)*if \(basisRereadScheduled\(refreshKey\)\) \{\s*void queryClient\.invalidateQueries\(\{ queryKey: JSON\.parse\(refreshKey\) as unknown\[\], exact: true, refetchType: 'none' \}\);\s*markRereadOnReturn\(refreshKey\);\s*\}\s*current\.scheduler\.cancel\(\);/);
  assert.match(registry, /return entry !== undefined && \(entry\.scheduler\.scheduled\(\) \|\| entry\.mutationScheduler\.scheduled\(\)\);/);
  assert.match(registry, /if \(!rereadPending\(key\)\) return false;\s*const open = openRequests\.get\(key\);\s*return open !== undefined && open\[open\.length - 1\] > \(readStartedAt\.get\(key\) \?\? 0\);/);
  assert.match(readCode('src/modules/reports/liveRefresh.ts'), /scheduled: \(\) => pending !== null,/);
  assert.match(sync, /const retryListen = useCallback\(\(\) => \{\s*const key = keyRef\.current;\s*if \(key !== null\) reopenFailedListeners\(key\);\s*\}, \[\]\);/);
  // Base exata com outra receita, pedida ou não, segura já na renderização (R6-02).
  assert.match(sync, /holding: syncing \|\| readsBehind \|\| ahead \|\| outOfStep,/);
  assert.match(sync, /mutationScheduler: createLiveRefreshScheduler\(\s*refetch,\s*deps\.refresh\?\.clock,\s*deps\.refresh\?\.mutationOptions \?\? \{ \.\.\.FINANCIAL_REPORT_BASIS_MUTATION_REFRESH \},\s*\),/);
  assert.match(sync, /current\.scheduler\.cancel\(\);\s*current\.mutationScheduler\.cancel\(\);/);
  assert.match(sync, /staleTime: Infinity,\s*refetchOnMount: false,\s*refetchOnReconnect: false,\s*retry: 1,/);
  // A estimativa liga as dependências reais; a lógica, a sincronização e a retenção (testadas em
  // `work-time-income-estimate.test.ts`) ficam no módulo sem SDK.
  const estimateWiring = readCode(`${WORK_TIME_MODULE}/useIncomeEstimate.ts`);
  assert.match(estimateWiring, /basis: firebaseBasisDeps,\s*readByIds: getTransactionsByIds,/);
  assert.match(estimateWiring, /return useIncomeEstimateWith\(firebaseIncomeEstimateDeps, user\?\.uid \?\? null, params\);/);
  const estimateHook = readCode(`${WORK_TIME_MODULE}/useIncomeEstimateWith.ts`);
  const consistencySource = readCode(`${WORK_TIME_MODULE}/consistency.ts`);
  assert.doesNotMatch(estimateHook, /firebase|onSnapshot|getDocs/, 'a lógica da estimativa não importa o SDK');
  assert.match(estimateHook, /if \(!series\.data \|\| \(needsExtra && !extra\.data\)\) return null;/, 'base nula enquanto alguma carrega');
  assert.match(estimateHook, /versions: needsExtra \? \[series\.dataUpdatedAt, extra\.dataUpdatedAt\] : \[series\.dataUpdatedAt\],/);
  // Em leitura inclui a busca pausada sem rede (`fetchStatus`), que não chama a `queryFn` (R10-03).
  assert.match(estimateHook, /fetching: series\.fetchStatus !== 'idle' \|\| \(needsExtra && extra\.fetchStatus !== 'idle'\),/);
  // A base é recalculada também quando só a leitura em curso muda (por exemplo, o mês avulso que falha) (R8-03).
  assert.match(estimateHook, /\}, \[series\.data, series\.dataUpdatedAt, series\.fetchStatus, extra\.data, extra\.dataUpdatedAt, extra\.fetchStatus, needsExtra, extraMonth, extraRange, uid, workspaceId\]\);/);
  assert.doesNotMatch(estimateHook, /isFetching/, 'a base da estimativa não usa isFetching (sem a busca pausada)');
  // A leitura dependente vai pelo objeto do resultado, não pelo `dataUpdatedAt` (em milissegundos): uma releitura
  // que termina no mesmo milissegundo da anterior chega como nova (R6-02).
  assert.match(estimateHook, /const \{ holding, listenFailed, retryListen, confirmed \} = useFinancialReportBasisLiveRefreshWith\(\s*deps\.basis, uid, workspaceId, windowMonths, basis, needsExcluded \? excluded\.data : null, \{ enabled \},\s*\);/);
  assert.match(sync, /export type DependentRead = object \| undefined \| null;/);
  assert.match(sync, /basis: BasisView \| null,\s*reads: DependentRead,\s*options: \{ enabled\?: boolean \} = \{\},/);
  assert.match(estimateHook, /if \(excludedIds\.length > 0 && !listenFailed\) void refetchExcluded\(\);\s*retryListen\(\);/);
  // Fail-closed (P5-F.1-R3.1, R3-AUD-01): a conversão só aparece com a prova e a sincronização concluída, e é o estado
  // atual; nenhuma estimativa anterior é guardada nem mostrada (a retenção da R1 e o aviso dela, N06, saíram).
  assert.match(estimateHook, /const shown = holdEstimate\(proof\.proven, holding, current, unproven\);/);
  // Toda estimativa que depende das leituras de receita (a que converte, a indisponível com a memória de cálculo
  // preenchida, a de rotinas ambíguas e um motivo novo) espera a prova e o fim da sincronização; só a indisponível por um
  // motivo decidido antes das receitas aparece como está (P5-F.1-R3.2, ADV-01: preservar estados legitimamente
  // indisponíveis; F-08 e ADV-R3-01: nenhum número nem motivo de estado misto ou divergente). A lista é a dos motivos
  // devolvidos antes de `applyIncomeExclusions` em `computeWorkTimeEstimate`, e só eles vêm antes dela.
  assert.match(estimateHook, /export const DECIDED_BEFORE_INCOME: ReadonlySet<EstimateUnavailableReason> = new Set<EstimateUnavailableReason>\(\[\s*'business_not_confirmed',\s*'report_unavailable',\s*'exclusion_unconfirmed',\s*\]\);/);
  assert.match(estimateHook, /export const dependsOnIncomeReadings = \(estimate: WorkTimeEstimate\): boolean =>\s*!\(estimate\.status === 'unavailable' && DECIDED_BEFORE_INCOME\.has\(estimate\.reason\)\);/);
  assert.match(estimateHook, /\): IncomeEstimateState =>\s*\(state\.status === 'done' && dependsOnIncomeReadings\(state\.estimate\) && \(!proven \|\| settling\) \? unproven : state\);/);
  const computeSource = readCode(`${WORK_TIME_MODULE}/estimate.ts`);
  const computeBody = computeSource.slice(computeSource.indexOf('export const computeWorkTimeEstimate'));
  const beforeIncome = computeBody.slice(0, computeBody.indexOf('applyIncomeExclusions('));
  assert.ok(computeBody.includes('applyIncomeExclusions(') && beforeIncome.length > 0, 'a leitura das receitas em computeWorkTimeEstimate');
  assert.deepEqual([...beforeIncome.matchAll(/unavailable\(\s*\w+,\s*'(\w+)'\s*\)/g)].map((match) => match[1]).sort(),
    ['business_not_confirmed', 'exclusion_unconfirmed', 'report_unavailable'], 'os motivos decididos antes das receitas são exatamente os da lista');
  assert.doesNotMatch(computeBody.slice(beforeIncome.length), /'(business_not_confirmed|report_unavailable|exclusion_unconfirmed)'/,
    'nenhum deles depois da leitura das receitas');
  assert.doesNotMatch(estimateHook, /HeldEstimate|EstimateIdentity|sameEstimateIdentity|sameEstimateInputs|heldTooLong|heldSince|decision\.|last\.current|lastProven/,
    'nenhuma estimativa anterior guardada nem reexibida');
  assert.doesNotMatch(estimateHook, /useRef<(?:IncomeEstimateState|Extract<IncomeEstimateState)|useState<(?:IncomeEstimateState|Extract<IncomeEstimateState)/,
    'nenhum estado da estimativa guardado entre renderizações');
  assert.match(estimateHook, /if \(waitingProof && waitedTooLong\) return \{ status: 'error', message: ESTIMATE_UPDATING, retry \};\s*return shown;\s*\};/);
  // Com a escuta encerrada antes do primeiro retorno do servidor e desconsideradas, o erro com "Tentar de novo" (N05).
  assert.match(estimateHook, /const blockedByListen = listenFailed && needsExcluded && excluded\.data === undefined && projectionReady !== windowKey;/);
  assert.match(estimateHook, /const current: IncomeEstimateState = state\.status === 'loading' && blockedByListen\s*\? \{ status: 'error', message: ESTIMATE_UNCONFIRMED_FAILED, retry \}\s*: state;/);
  // Tempo de interface, nunca de prova (P5-F.1-R3, R3.1): no relógio injetável dos agendadores, ele só troca o texto de
  // "calculando" para "estimativa em atualização". A prova não recebe relógio, prazo nem escrita pendente: a presunção
  // temporal da R1 (regra 5 antiga, `bounded`, `expired`) foi removida.
  assert.match(estimateHook, /export const ESTIMATE_PENDING_WAIT_MS = 30_000;/);
  assert.match(estimateHook, /const clock = deps\.basis\.refresh\?\.clock \?\? SYSTEM_LIVE_REFRESH_CLOCK;/);
  assert.match(estimateHook, /const proof = useMemo\(\(\) => proveEstimateConsistency\(proofInput\), \[proofInput\]\);/);
  assert.doesNotMatch(estimateHook, /observeExcludedRead|inherentWritesOf|pendingWriteKey|unappliedWrites|\bexpired\b|\bbounded\b|pendingWrites|versionsAtRead/, 'nenhum resto da regra 5 antiga');
  assert.doesNotMatch(consistencySource, /observeExcludedRead|inherentWritesOf|pendingWriteKey|unappliedWrites|\bexpired\b|\bbounded\b|pendingWrites|projection_pending/, 'nenhum resto da regra 5 antiga na prova');
  const proofMemo = estimateHook.slice(estimateHook.indexOf('const exclusionsProof = useMemo'), estimateHook.indexOf('const state = useMemo<IncomeEstimateState>'))
    + estimateHook.slice(estimateHook.indexOf('const proofInput = useMemo'), estimateHook.indexOf('const clock = deps.basis.refresh'));
  assert.ok(proofMemo.length > 500, 'as duas entradas da prova foram encontradas');
  assert.doesNotMatch(proofMemo, /clock|waitMs|waitedTooLong|heldTooLong|Date|now\(|setTimer/, 'a entrada da prova não tem relógio nem prazo');
  // O texto "em atualização" só sai como erro com "Tentar de novo", no lugar de "calculando" (as leituras prontas, sem prova
  // ou com a sincronização em curso); nunca converte.
  assert.match(estimateHook, /const waitingProof = current\.status === 'done' && shown\.status === 'loading';/);
  assert.equal(estimateHook.match(/ESTIMATE_UPDATING/g)?.length, 2, 'importado e usado uma vez');
  // Sem prova, ou sincronizando, uma estimativa pronta nunca aparece (R9-03, R10-02, R3.1); a função não recebe estimativa
  // anterior nenhuma.
  assert.match(estimateHook, /export const holdEstimate = \(\s*proven: boolean,\s*settling: boolean,\s*state: IncomeEstimateState,\s*unproven: Exclude<IncomeEstimateState, \{ status: 'done' \}>,\s*\): IncomeEstimateState =>/);
  // A prova usa a projeção confirmada da escuta, a ordem da leitura por id e as escritas das desconsideradas.
  assert.match(estimateHook, /enabled: enabled && needsExcluded && projectionReady === windowKey,/);
  assert.match(estimateHook, /scope: windowList,/, 'a janela de meses da prova faz parte da chave da leitura');
  // A ordem da leitura começa ANTES de qualquer leitura (a por id e a das marcas, nessa ordem), e a transação de marcas
  // recebe os meses da janela e os ids das desconsideradas e dos espelhos de estorno (P5-F.1-R3).
  const readBody = estimateHook.slice(estimateHook.indexOf('const readExcluded = useCallback('), estimateHook.indexOf('const excluded = useTransactionsByIdsWith('));
  assert.ok(readBody.length > 0, 'o corpo de `readExcluded` foi encontrado');
  assert.equal(readBody.match(/noteDependentReadStart\(\)/g)?.length, 1);
  const startAt = readBody.indexOf('noteDependentReadStart()');
  const idsAt = readBody.indexOf('readExcludedIncome(');
  const marksAt = readBody.indexOf('readProjectionMarks(');
  assert.ok(startAt >= 0 && startAt < idsAt && idsAt < marksAt, 'a ordem começa antes da leitura por id, que vem antes da leitura das marcas');
  assert.match(readBody, /const startedOrder = noteDependentReadStart\(\);\s*const read = await readExcludedIncome\(readByIds, sourceId, ids\);/);
  assert.match(readBody, /const months = windowList === '' \? \[\] : windowList\.split\(','\);\s*const snapshot = await readProjectionMarks\(sourceId, months, \[\.\.\.new Set\(\[\.\.\.ids, \.\.\.Object\.values\(read\.reversalIds\)\]\)\]\);\s*return \{ \.\.\.read, startedOrder, snapshot, window: windowList \};/);
  assert.match(estimateHook, /projection: confirmed,\s*excludedStartedOrder: read\?\.startedOrder \?\? null,\s*excludedMonths,\s*exclusionsProof,/);
  assert.match(estimateHook, /return proveProjectionExclusions\(\{\s*months: windowMonths,\s*snapshot: read\.snapshot,\s*basisIncome: basis\.income,\s*excludedIds: \[\.\.\.new Set\(excludedIds\)\],\s*read: documents,\s*reversalIds: read\.reversalIds,\s*\}\);/);
  assert.match(estimateHook, /if \(read === undefined \|\| basis === null \|\| read\.window !== windowMonths\.join\(','\)\) return null;/, 'só vale a leitura feita para esta janela');
  // Sem prova, a estimativa calculada com o conteúdo lido nunca é mostrada; com ela, cada item é o que a projeção contém.
  assert.match(estimateHook, /if \(needsExcluded && excluded\.data && exclusionsProof\?\.proven\) \{\s*for \(const \[id, applied\] of Object\.entries\(exclusionsProof\.applied\)\) \{/);
  // A leitura real liga as duas dependências; a das marcas é a transação só de leitura.
  assert.match(estimateWiring, /readByIds: getTransactionsByIds,\s*readProjectionMarks,/);
  assert.match(estimateWiring, /import \{ readProjectionMarks \} from '\.\/projectionReads';/);
  assert.match(sync, /setConfirmed\(\{ key, projection: \{ income: projected\.current, versions, seen \} \}\);/);
  assert.match(sync, /confirmed: confirmed !== null && confirmed\.key === confirmedKey \? confirmed\.projection : null,/);
  assert.match(hooks, /incomeCents: entry\.data\(\)\.incomeCents,\s*updatedAt: entry\.data\(\)\.updatedAt,/);
  // A leitura por id é sempre do servidor: sem rede, falha em vez de devolver o cache local (revisão da R1, N04).
  const transactionsApi = readCode('src/modules/transactions/api.ts');
  const byIdsBody = transactionsApi.slice(transactionsApi.indexOf('export const getTransactionsByIds'), transactionsApi.indexOf('export const INCOME_WINDOW_MAX_PAGES'));
  assert.ok(byIdsBody.length > 0);
  assert.match(byIdsBody, /const snapshot = await getDocsFromServer\(query\(txCol\(workspaceId\), where\(documentId\(\), "in", chunk\)\)\);/);
  assert.doesNotMatch(byIdsBody, /getDocs\(/, 'nunca a leitura que aceita o cache');
  // O conteúdo bruto de cada encontrado (antes de normalizar) é o que a impressão digital da prova das marcas confere (P5-F.1-R3).
  assert.match(byIdsBody, /raw\[document\.id\] = document\.data\(\);/);
  assert.match(byIdsBody, /return \{ found, missing: unique\.filter\(\(id\) => !foundIds\.has\(id\)\), raw \};/);
  assert.doesNotMatch(consistencySource, /from 'react'|firebase|onSnapshot|getDocs|Date\.now\(|performance|setTimeout|clock/i, 'a prova é pura e sem relógio');
  const projectionProof = readCode(`${WORK_TIME_MODULE}/projectionProof.ts`);
  assert.doesNotMatch(projectionProof, /from 'react'|firebase|onSnapshot|getDocs|Date\.now\(|performance|setTimeout|clock/i, 'a prova das marcas é pura e sem relógio');
  // Marcos sem relógio (R4-05): só igualdade (o `dataUpdatedAt` das bases; a leitura dependente, pelo objeto).
  for (const source of [sync, estimateHook]) assert.doesNotMatch(source, /Date\.now\(/);
  // As leituras de receitas usam as chaves que a sincronização relê, e nenhuma mutação as relê antes da base.
  const incomeReads = readCode('src/modules/transactions/incomeReads.ts');
  // A janela de meses da prova (`scope`) faz parte da chave: outra janela é outra leitura (P5-F.1-R3).
  assert.match(incomeReads, /queryKey: \[\.\.\.incomeReadsKey\(workspaceId \?\? '', 'by-ids'\), sorted\.join\(','\), options\.scope \?\? ''\] as const,/);
  // A leitura por id só segue a base: sem prazo de validade nem releitura na montagem ou na volta da rede (R5-01);
  // sem compartilhamento de estrutura, cada leitura concluída traz um objeto novo (R6-02, mesmo milissegundo).
  assert.match(incomeReads, /sorted\.length > 0,\s*staleTime: Infinity,\s*refetchOnReconnect: false,\s*structuralSharing: false,\s*\}\);/);
  assert.match(incomeReads, /\) => \{\s*rereadWorkspaceBases\(workspaceId\);\s*return Promise\.all\(\[/);
  assert.match(incomeReads, /queryKey: \['transactions', workspaceId\],\s*predicate: \(query\) => !isIncomeReadKey\(query\.queryKey\),/);
  assert.match(incomeReads, /queryClient\.invalidateQueries\(\{ queryKey: incomeReadsKey\(workspaceId, 'income-window'\), refetchType: 'none' \}\),/);
  const transactionHooks = readCode('src/modules/transactions/hooks.ts');
  assert.match(transactionHooks, /queryKey: \[\.\.\.incomeReadsKey\(workspaceId \?\? "", "income-window"\), since \?\? "", until \?\? ""\] as const,/);
  assert.doesNotMatch(transactionHooks, /useTransactionsByIds/, 'sem invólucro sem uso: a estimativa liga a leitura real');
  const dependents = transactionHooks.slice(transactionHooks.indexOf('export const invalidateTransactionDependents'), transactionHooks.indexOf('export const useMonthTransactions '));
  assert.match(dependents, /invalidateTransactionReads\(queryClient, workspaceId\),/);
  assert.doesNotMatch(dependents, /transactionKey\(workspaceId\)/);
  // Em nenhum outro lugar uma mutação invalida o prefixo inteiro dos lançamentos.
  for (const path of sourceFiles('src')) {
    if (path === 'src/modules/transactions/incomeReads.ts') continue;
    assert.doesNotMatch(readCode(path), /invalidateQueries\(\{\s*queryKey: \[\s*["']transactions["']/, `${path}: prefixo de lançamentos invalidado fora de invalidateTransactionReads`);
  }
  assert.doesNotMatch(transactionHooks, /invalidateIncomeReads/);
});

test('falhas de leitura: mensagens fixas em pt-BR, com nova tentativa, e só o código do erro no log', () => {
  // Relatório e receitas desconsideradas: a mensagem vem de `estimateFailureMessage` (testada em
  // work-time-estimate), nunca do SDK; só sem dados (com dados antigos, eles continuam valendo, e a
  // tela avisa que a última atualização falhou, com "Tentar de novo").
  const estimate = readCode(`${WORK_TIME_MODULE}/useIncomeEstimateWith.ts`);
  assert.match(estimate, /\.find\(\(query\) => query\.isError && query\.data === undefined\);\s*if \(failedReport\) return \{ status: 'error', message: estimateFailureMessage\('report', failedReport\.error\), retry \};/);
  assert.match(estimate, /if \(needsExcluded && excluded\.isError && excluded\.data === undefined\) \{\s*return \{ status: 'error', message: estimateFailureMessage\('excluded', excluded\.error\), retry \};/);
  assert.match(estimate, /const refreshFailed = series\.isError \|\| \(needsExtra && extra\.isError\) \|\| \(needsExcluded && excluded\.isError\) \|\| listenFailed;/);
  const details = readCode(`${WORK_TIME_COMPONENTS}/EstimateDetails.tsx`);
  assert.match(details, /\{state\.refreshFailed && \(\s*<div[^>]*role="status"[^>]*>\s*<p[^>]*>\{ESTIMATE_REFRESH_FAILED\}<\/p>\s*<button type="button" className=\{linkButtonClass\} onClick=\{state\.retry\}>Tentar de novo<\/button>/);
  // RR-R32-11 (P5-GATE-FINAL): sem meses calculados, a memória não afirma "nenhuma" desconsiderada, feriado ou
  // exceção; os textos fixos (testados em work-time-estimate) entram antes das afirmações.
  assert.match(details, /\{!calculationReachedMonths\(estimate\)\s*\?\s*DETAILS_EXCLUSIONS_NOT_APPLIED\s*:\s*estimate\.excludedCount > 0/);
  assert.match(details, /\{!calculationReachedMonths\(estimate\) \? <p>\{DETAILS_CALENDAR_NOT_APPLIED\}<\/p> : <>\s*<p><strong>Feriados que tiraram dias de trabalho:<\/strong>/);
  // Preferência: estado de erro sem dados de outra sessão, aviso fixo com "Tentar de novo" e só o código no log.
  const context = readCode(`${WORK_TIME_MODULE}/WorkTimeContext.tsx`);
  assert.match(context, /console\.error\('Falha ao ler a preferência de tempo de trabalho', typeof code === 'string' \? code : 'desconhecido'\);\s*setState\(\{ uid, status: 'error', snapshot: null \}\);/);
  const settings = readCode(SETTINGS_VIEW);
  assert.match(settings, /\{status === 'error' && \(\s*<div[^>]*role="alert">\s*<p[^>]*>\s*Não foi possível carregar sua preferência agora\. Enquanto isso, os valores continuam em reais\.\s*<\/p>\s*<button type="button" onClick=\{workTime\.retry\}/);
  // O aviso do topo usa as ressalvas puras (testadas em work-time-estimate), com a da atualização que falhou.
  assert.match(readCode('src/components/Header.tsx'), /estimateQualifiers\(readyEstimate, workTime\.estimate\.refreshFailed\)/);
  // Revisão da R1 (N07, N09): o rascunho é validado uma vez por mudança (o conferidor do calendário inteiro percorre
  // rotinas, feriados e exceções), e a recusa por feriado, exceção ou início do período aparece junto do botão de salvar.
  assert.match(settings, /const draftCheck = useMemo\(\(\) => \(draft === null \? null : validateDraft\(draft, today\)\), \[draft, today\]\);/);
  assert.match(settings, /const draftIsValid = draftCheck !== null && draftCheck\.ok && routineResult\.ok;/);
  assert.equal(settings.match(/validateDraft\(/g)?.length, 2, 'só no memo e ao salvar');
  assert.match(settings, /\{calendarProblem !== null && \(\s*<p className=\{errorTextClass\} role="alert" data-testid="work-time-calendar-ambiguity">\{calendarProblem\}<\/p>\s*\)\}/);
  // Revisão 4 da R1 (Q02): só uma mudança da pessoa nas rotinas põe Configurações em edição. A configuração gravada
  // que o editor recusa ao montar não marca a tela; o comportamento está no E2E "B02 (P5-F.1-R1)".
  assert.match(settings, /else if \('message' in result && result\.edited\) \{\s*if \(!isDirty\) editBaseRef\.current = preference;\s*setIsDirty\(true\);/);
  const routineEditor = readCode(`${WORK_TIME_COMPONENTS}/RoutineEditor.tsx`);
  assert.match(routineEditor, /const \[models, setModels\] = useState<RoutineModel\[\]>\(initialModels\);/);
  // P5-F.1-R2A (S03): a lógica de `edited` fica no módulo puro `routineModels.ts`, testado em work-time-preference;
  // a tela usa as mesmas funções: a chave da montagem, o resultado a cada mudança e "Aplicar aos dias marcados".
  assert.match(routineEditor, /const initialKey = useMemo\(\(\) => routinesKey\(initialModels\), \[initialModels\]\);/);
  assert.match(routineEditor, /const combined = useMemo\(\(\) => editorResultOf\(models, initialKey, defaultReference\), \[models, defaultReference, initialKey\]\);/);
  assert.match(routineEditor, /onClick=\{\(\) => update\(index, applyTemplate\(model\)\)\}/);
  assert.doesNotMatch(routineEditor, /const routinesKey|const routineOf|const modelOf/, 'sem cópia local do modelo');
  const routineModels = readCode(`${WORK_TIME_MODULE}/routineModels.ts`);
  assert.match(routineModels, /const edited = routinesKey\(models\) !== initialKey;/);
  assert.equal(routineModels.match(/\{ ok: false, message: [^}]*, edited \}/g)?.length, 2, 'as duas recusas levam `edited`');
});

test('janela de receitas: a leitura paginada real usa `readPagedWindow` com um documento a mais', () => {
  // O laço (sonda, cursor no último da página, teto) está em `transactions-paging.test.ts`; aqui, a
  // fiação: a mesma consulta indexada, o cursor do laço e o limite que ele pede (as Rules aceitam 501).
  const api = readCode('src/modules/transactions/api.ts');
  const body = api.slice(api.indexOf('const pagedWindow'), api.indexOf('export const getIncomeWindow'));
  assert.ok(body.length > 0);
  assert.match(body, /await readPagedWindow<QueryDocumentSnapshot<DocumentData>>\(\s*async \(after, limitCount\) => \(await getDocs\(query\(/);
  assert.match(body, /orderBy\("date", "desc"\),\s*orderBy\(documentId\(\), "desc"\),\s*\.\.\.\(after \? \[startAfter\(after\)\] : \[\]\),\s*limit\(limitCount\),\s*\)\)\)\.docs,\s*TRANSACTION_PAGE_SIZE,\s*maxPages,/);
  assert.match(api, /export const INCOME_WINDOW_MAX_PAGES = 4;/);
});

/** BRL obrigatório na matriz (entrada, confirmação, termo, histórico, preço, texto). */
const BRL_ONLY_FILES = [
  'src/components/TransactionModal.tsx',
  'src/components/accounts/CashTransferModal.tsx',
  'src/components/accounts/CashAccountStatementModal.tsx',
  'src/components/accounts/CashAccountFormModal.tsx',
  'src/components/CreditCard3D.tsx',
  'src/components/CreditCardForm.tsx',
  'src/components/cards/CardInvoicePaymentModal.tsx',
  'src/components/cards/CardAdjustmentModal.tsx',
  'src/components/loans/LoanSchedule.tsx',
  'src/components/loans/LoanMovementHistory.tsx',
  'src/components/loans/LoanPaymentModal.tsx',
  'src/components/loans/useLoanOperations.tsx',
  'src/components/loans/LoanDialog.tsx',
  'src/components/loans/LoanTermsFields.tsx',
  'src/components/LoanFormModal.tsx',
  'src/components/PJLoanFormModal.tsx',
  'src/components/clients/ReceiptModal.tsx',
  'src/components/clients/ReceivableHistoryModal.tsx',
  'src/components/ReceivableFormModal.tsx',
  'src/components/RecurringExpenseFormModal.tsx',
  'src/modules/investments/simple/components/LinkGoalInvestmentsModal.tsx',
  'src/modules/investments/simple/components/WithdrawInvestmentModal.tsx',
  'src/modules/investments/simple/components/SimpleInvestmentForm.tsx',
  'src/components/GoalFormModal.tsx',
  'src/components/SplitBillFormModal.tsx',
  'src/components/SplitReimbursementPayModal.tsx',
  'src/modules/billing/components/PricingTable.tsx',
  'src/components/AdminDashboard.tsx',
  'src/components/ReportsAlertsPanel.tsx',
  'src/components/ReportsAIChat.tsx',
  'src/components/NotificationsPanel.tsx',
];

test('matriz: entradas, confirmações, termos, históricos e preços ficam em BRL', () => {
  for (const path of BRL_ONLY_FILES) {
    assert.ok(existsSync(join(root, path)), `${path} não existe (atualize a matriz)`);
    assert.equal(importsWorkTime(read(path)), false, `${path} não pode usar a camada de exibição`);
  }
});

/** Pontos elegíveis (T e G) da matriz: cada arquivo usa a camada de exibição. */
const ELIGIBLE_FILES = [
  'src/App.tsx',
  'src/components/DistributionChart.tsx',
  'src/components/RecurringDashboardWidget.tsx',
  'src/components/ReportsWidget.tsx',
  'src/components/RecentTransactions.tsx',
  'src/components/TransactionsView.tsx',
  'src/components/ReportsOverview.tsx',
  'src/components/ReportsChartsView.tsx',
  'src/components/accounts/CashAccountsView.tsx',
  'src/components/CreditCardsView.tsx',
  'src/components/cards/CardInvoiceDetailsDrawer.tsx',
  'src/components/LoanCard.tsx',
  'src/components/PJLoanCard.tsx',
  'src/components/LoansView.tsx',
  'src/components/PJLoansView.tsx',
  'src/components/LoanDetailsView.tsx',
  'src/components/PJLoanDetailsView.tsx',
  'src/components/ClientsReceivablesView.tsx',
  'src/components/RecurringExpensesView.tsx',
  'src/components/RecurringExpenseList.tsx',
  'src/components/RecurringExpenseCard.tsx',
  'src/components/RecurringExpenseDetailsView.tsx',
  'src/modules/investments/simple/components/SimpleInvestmentsView.tsx',
  'src/modules/investments/simple/components/AllocationPanels.tsx',
  'src/components/GoalCard.tsx',
  'src/components/GoalDetailsView.tsx',
  'src/components/SplitGroupList.tsx',
  'src/components/SplitGroupCard.tsx',
  'src/components/SplitGroupDetailsView.tsx',
  'src/components/SplitBillDetailsModal.tsx',
  'src/components/SplitGroupCharts.tsx',
];

/**
 * Pontos que ficam em BRL dentro de arquivos elegíveis (R-* da matriz): a
 * expressão em reais precisa existir e a versão convertida, não. A versão
 * convertida é procurada pelo método da camada (`.cents(`, `.reais(`), sem o
 * nome da variável: a tela pode chamar o hook de `display` ou `moneyDisplay`.
 */
const BRL_POINTS_IN_ELIGIBLE_FILES: Array<{ path: string; brl: string; converted?: string; why: string }> = [
  { path: 'src/components/SplitBillDetailsModal.tsx', brl: '{formatSplitCents(share.amountDueCents)}', converted: '.cents(share.amountDueCents', why: 'parte ao lado de "Registrar recebimento", "Estornar recebimento" e "Perdoar" (um clique)' },
  { path: 'src/components/SplitGroupDetailsView.tsx', brl: '{formatSplitCents(item.amountCents)}', converted: '.cents(item.amountCents', why: 'reembolso ao lado de aprovar, rejeitar, cancelar e estornar' },
  { path: 'src/modules/investments/simple/components/SimpleInvestmentsView.tsx', brl: '{formatCurrency(row.valueCents)}', converted: '.cents(row.valueCents', why: 'movimento ao lado de confirmar, cancelar e desfazer' },
  { path: 'src/components/RecurringExpenseDetailsView.tsx', brl: '{formatCents(occ.plannedAmountCents)}', converted: '.cents(occ.plannedAmountCents, formatCents)}</p>', why: 'ocorrência que aguarda ação (pagar, confirmar, tentar de novo)' },
  { path: 'src/components/CreditCardsView.tsx', brl: 'openInvoiceCreditNote(invoice);', converted: 'openInvoiceCreditNote(invoice, ', why: 'frase composta do crédito da fatura' },
  { path: 'src/components/cards/CardInvoiceDetailsDrawer.tsx', brl: 'openInvoiceCreditNote(invoice);', converted: 'openInvoiceCreditNote(invoice, ', why: 'frase composta do crédito da fatura' },
  { path: 'src/components/cards/CardInvoiceDetailsDrawer.tsx', brl: '{purchaseAction.purchase.description} · {formatCents(purchaseAction.purchase.totalCents)}', converted: '.cents(purchaseAction.purchase.totalCents', why: 'confirmação de cancelamento ou estorno da compra' },
  { path: 'src/components/cards/CardInvoiceDetailsDrawer.tsx', brl: '{formatCents(paymentToReverse.amountCents)} pago em', converted: '.cents(paymentToReverse.amountCents', why: 'confirmação de estorno do pagamento' },
  { path: 'src/components/ReportsOverview.tsx', brl: '{formatCurrency(snapshot.debtProfile.creditCardLimitUsed)}', converted: '.reais(snapshot.debtProfile.creditCardLimitUsed', why: 'limite usado do cartão (termo do emissor)' },
  { path: 'src/components/ReportsOverview.tsx', brl: 'formatCurrency(card.limitAvailable)', converted: '.reais(card.limitAvailable', why: 'limite disponível do cartão' },
  { path: 'src/components/ReportsOverview.tsx', brl: '` · crédito de ${formatCurrency(card.openCreditAmount)} a compensar`', converted: '.reais(card.openCreditAmount', why: 'frase composta do crédito a compensar' },
  { path: 'src/components/accounts/CashAccountsView.tsx', brl: 'Estornar a transferência de {formatCents(confirmation.transfer.amountCents)} de', converted: '.cents(confirmation.transfer.amountCents', why: 'confirmação de estorno de transferência' },
  // Sem `converted`: o total da despesa, no topo do mesmo modal, é convertido (T na matriz).
  { path: 'src/components/SplitBillDetailsModal.tsx', brl: '? `A despesa de ${formatSplitCents(bill.amountCents)} continua no histórico como anulada', why: 'confirmação de anulação da despesa dividida no modo tempo' },
  { path: 'src/components/ClientsReceivablesView.tsx', brl: '<td className="px-6 py-3 text-right font-bold text-on-surface">{formatCents(receivable.amountCents)}</td>', converted: '.cents(receivable.amountCents', why: 'valor original cobrado do cliente' },
  { path: 'src/components/ClientsReceivablesView.tsx', brl: '{dialog.receivable.description}: {formatCents(dialog.receivable.amountCents)}', converted: '.cents(dialog.receivable.amountCents', why: 'confirmação de cancelamento do recebível' },
  { path: 'src/components/LoanCard.tsx', brl: '{formatCents(loan.principalCents)}', converted: '.cents(loan.principalCents', why: 'principal contratado' },
  { path: 'src/components/RecurringExpenseDetailsView.tsx', brl: '{formatCents(adj.previousCents ?? 0)}', converted: '.cents(adj.previousCents', why: 'histórico de reajustes (anterior)' },
  { path: 'src/components/RecurringExpenseDetailsView.tsx', brl: '{formatCents(adj.nextCents)}', converted: '.cents(adj.nextCents', why: 'histórico de reajustes (novo)' },
  { path: 'src/components/cards/CardInvoiceDetailsDrawer.tsx', brl: "{payment.kind === 'payment' ? formatCents(payment.amountCents) : formatCents(-payment.amountCents)}", converted: '.cents(payment.amountCents', why: 'pagamentos e estornos da fatura' },
];

test('matriz: pontos em BRL dentro de arquivos elegíveis continuam em reais, linha a linha', () => {
  for (const point of BRL_POINTS_IN_ELIGIBLE_FILES) {
    const source = read(point.path);
    assert.ok(source.includes(point.brl), `${point.path}: falta o valor em reais (${point.why})`);
    if (point.converted) assert.ok(!source.includes(point.converted), `${point.path}: convertido indevidamente (${point.why})`);
  }
  // A anulação de lançamento confirma com o valor exato em reais quando a lista está em tempo.
  const app = read('src/App.tsx');
  assert.match(app, /message=\{display\.isTime && transactionToVoid\s*\? `O lançamento de \$\{formatCentsBRL\(transactionToVoid\.valueCents\)\}/);
  // Eixos de gráfico usam o rótulo compacto, que cabe no eixo; o texto longo fica no tooltip.
  const charts = read('src/components/ReportsChartsView.tsx');
  const axisFormatters = charts.match(/tickFormatter=\{display\.isTime \? \(v\) => display\.\w+\(/g) ?? [];
  assert.equal(axisFormatters.length, 5, 'cinco eixos convertidos');
  for (const formatter of axisFormatters) assert.match(formatter, /display\.reaisAxis\($/);
  // Só no modo tempo os gráficos de margem negativa vão a 0, para o sinal e o `≈` não serem cortados.
  assert.match(charts, /<AreaChart data=\{investmentEvolutionData\} margin=\{\{ top: 10, right: 10, left: display\.isTime \? 0 : -10, bottom: 0 \}\}>/);
  assert.match(charts, /<AreaChart data=\{cashFlowData\} margin=\{\{ top: 10, right: 10, left: display\.isTime \? 0 : -20, bottom: 0 \}\}>/);
  // Só no modo tempo o eixo ganha largura; no modo dinheiro, `undefined` mantém o padrão do recharts.
  assert.equal(charts.split('width={display.isTime ? AXIS_WIDTH_IN_TIME_MODE : undefined}').length - 1, 5, 'largura do eixo só no modo tempo');
});

test('matriz: os pontos elegíveis usam a camada de exibição, e a prévia do tema força reais', () => {
  for (const path of ELIGIBLE_FILES) {
    const source = read(path);
    assert.match(source, /\buseMoneyDisplay\(\)/, `${path} deveria usar useMoneyDisplay`);
    assert.match(source, /from ['"][./]+(?:modules\/)?work-time\/display(?:\.tsx)?['"]/, `${path}: import da camada de exibição`);
  }
  const personalization = read('src/components/PersonalizationView.tsx');
  assert.match(personalization, /<ForceMoneyDisplay>[\s\S]*<RecentTransactions[\s\S]*<\/ForceMoneyDisplay>/);
  // O Header real da prévia fica em dinheiro: sem alternador nem aviso do modo tempo.
  assert.match(personalization, /<ForceMoneyDisplay>\s*<Header\b[\s\S]*?\/>\s*<\/ForceMoneyDisplay>/);
  const header = read('src/components/Header.tsx');
  assert.match(header, /const moneyForced = useIsMoneyForced\(\);/);
  assert.match(header, /const isWorkTimeMode = !moneyForced && workTime\.displayMode === 'time';/);
  assert.match(header, /\{workTime\.isAvailable && !moneyForced && \(/);
});

test('modo dinheiro idêntico: a camada devolve o formatador da tela, sem elemento novo', () => {
  const display = read(`${WORK_TIME_MODULE}/display.tsx`);
  assert.match(display, /return presentation \? <WorkTimeAmount presentation=\{presentation\} \/> : formatMoney\(cents\);/);
  assert.match(display, /return presentation \? <WorkTimeAmount presentation=\{presentation\} \/> : formatMoney\(reais\);/);
  const presentation = read(`${WORK_TIME_MODULE}/presentation.ts`);
  assert.match(presentation, /config \? presentWorkTime\(cents, config\) : null/);
});

test('prova (P5-F.1-R3.2, RR-R31-05): nada é provado sem bloco exato, sem a projeção confirmada e sem a base igual a ela; sem exceção por base única ou falta de desconsiderada', () => {
  const consistency = readCode(`${WORK_TIME_MODULE}/consistency.ts`);
  // A ordem das regras: carregando, sem bloco exato (nada provado: F-03), projeção confirmada, bases na projeção.
  assert.match(consistency, /export const proveEstimateConsistency = \(input: ConsistencyInput\): ConsistencyResult => \{\s*if \(input\.basis === null\) return \{ proven: false, reason: 'loading' \};\s*if \(!input\.basis\.exact\) return \{ proven: false, reason: 'inexact' \};\s*const projection = input\.projection;\s*if \(projection === null\) return \{ proven: false, reason: 'projection' \};\s*if \(incomeDiverges\(projection\.income, input\.basis\.income, input\.months\)\) return \{ proven: false, reason: 'bases' \};\s*if \(!input\.hasExclusions\) return \{ proven: true \};/);
  // Nenhum atalho pela quantidade de bases (a "leitura única" da R3.1) nem campo que o sustente.
  assert.doesNotMatch(consistency, /multipleBases/, 'a prova não depende da quantidade de bases');
  assert.equal(consistency.match(/return \{ proven: true \}/g)?.length, 2, 'só duas aprovações: sem desconsiderada e a prova das marcas');
  const hook = readCode(`${WORK_TIME_MODULE}/useIncomeEstimateWith.ts`);
  assert.doesNotMatch(hook, /multipleBases/, 'o gancho não passa a quantidade de bases para a prova');
  assert.match(hook, /projection: confirmed,/, 'a projeção da prova é a confirmada pela escuta desta montagem');
  // A projeção confirmada é do estado da montagem: zerada a cada escuta nova, no erro e no retorno do cache local.
  const sync = readCode('src/modules/reports/basisSync.ts');
  assert.equal(sync.match(/setConfirmed\(null\);/g)?.length, 3, 'zerada na escuta nova, no retorno do cache local e no erro');
  assert.match(sync, /confirmed: confirmed !== null && confirmed\.key === confirmedKey \? confirmed\.projection : null,/);
  // A queda de conexão chega da escuta real: com as mudanças de metadados, o SDK entrega o retorno só do cache local, e
  // o adaptador o marca como tal.
  const adapter = readCode('src/modules/reports/hooks.ts');
  assert.match(adapter, /subscribePeriods: \(workspaceId, firstMonth, lastMonth, onNext, onError\) => onSnapshot\(/);
  assert.match(adapter, /\{ includeMetadataChanges: true \},/, 'a escuta recebe a queda de conexão');
  assert.match(adapter, /fromCache: snapshot\.metadata\.fromCache,/, 'o retorno do cache local é marcado como tal');
});
