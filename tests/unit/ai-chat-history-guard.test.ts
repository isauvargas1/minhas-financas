import assert from 'node:assert/strict';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

import {AI_CHAT_HISTORY_KEY_PREFIX, resolveAiChatScope} from '../../src/modules/reports/aiChatStorage.ts';

/*
 * Guardas de regressão do P5-A (PR-AI-04). Varrem só o código de produção
 * (`src/`): fixtures adversariais em testes e E2E podem citar o formato
 * antigo sem que isso seja dependência funcional dele.
 */
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const srcRoot = join(repoRoot, 'src');

const sourceFiles = (dir: string): string[] => readdirSync(dir).flatMap((entry) => {
  const path = join(dir, entry);
  if (statSync(path).isDirectory()) return sourceFiles(path);
  return /\.(ts|tsx)$/.test(entry) ? [path] : [];
});

const files = sourceFiles(srcRoot).map((path) => ({
  path: relative(repoRoot, path).replaceAll('\\', '/'),
  text: readFileSync(path, 'utf8'),
}));

const STORAGE_MODULE = 'src/modules/reports/aiChatStorage.ts';
const SESSION_CLEANUP = 'src/lib/sessionCleanup.ts';

test('o nome do histórico só aparece no módulo de armazenamento e na limpeza da sessão', () => {
  const offenders = files
    .filter(({text}) => text.includes('finance_ai_chat_history'))
    .map(({path}) => path)
    .filter((path) => path !== STORAGE_MODULE && path !== SESSION_CLEANUP);
  assert.deepEqual(offenders, []);
});

test('nenhuma chave de histórico montada só com o workspace (formato antigo)', () => {
  const offenders = files
    .filter(({text}) => /finance_ai_chat_history_\$\{/.test(text) || /finance_ai_chat_history_['"`]\s*\+/.test(text))
    .map(({path}) => path);
  assert.deepEqual(offenders, []);
});

test('o chat e os relatórios não acessam o localStorage diretamente', () => {
  const guarded = files.filter(({path}) =>
    (path.startsWith('src/modules/reports/') && path !== STORAGE_MODULE) ||
    path === 'src/components/ReportsAIChat.tsx');
  const offenders = guarded.filter(({text}) => /\blocalStorage\b/.test(text.replace(/^\s*(\*|\/\/).*$/gm, '')))
    .map(({path}) => path);
  assert.deepEqual(offenders, []);
});

test('o armazenamento lê e grava só a chave do escopo (sem fallback para outro formato)', () => {
  const storageModule = files.find(({path}) => path === STORAGE_MODULE);
  assert.ok(storageModule);
  const reads = storageModule.text.match(/\.getItem\(([^)]*)\)/g) ?? [];
  assert.deepEqual(reads, ['.getItem(scope.key)']);
  const writes = storageModule.text.match(/\.setItem\(([^,]*),/g) ?? [];
  assert.deepEqual(writes, ['.setItem(scope.key,']);
});

test('o escopo do chat vem da sessão autenticada e do workspace carregado para ela', () => {
  const hooks = files.find(({path}) => path === 'src/modules/reports/hooks.ts');
  assert.ok(hooks);
  const body = hooks.text.slice(hooks.text.indexOf('export const useFinanceAIChat'));
  assert.match(body, /useAuth\(\)/);
  assert.match(body, /activeWorkspaceUid === uid/);
  assert.match(body, /resolveAiChatScope\(uid, workspaceId\)/);
});

test('a chave é injetiva: decodificada, devolve exatamente o par (uid, workspace)', () => {
  const pairs: Array<[string, string]> = [
    ['uid', 'ws'], ['a:b', 'c'], ['a', 'b:c'], ['50%', 'ws:1'], ['ção', 'espaço PJ'],
  ];
  for (const [uid, workspaceId] of pairs) {
    const scope = resolveAiChatScope(uid, workspaceId);
    assert.ok(scope);
    const [encodedUid, encodedWorkspace, ...rest] = scope.key.slice(AI_CHAT_HISTORY_KEY_PREFIX.length).split(':');
    assert.deepEqual(rest, []);
    assert.equal(decodeURIComponent(encodedUid), uid);
    assert.equal(decodeURIComponent(encodedWorkspace), workspaceId);
  }
});
