import assert from 'node:assert/strict';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

/**
 * P5-E2 (D-09, PR-MSG-01) — guarda estática da remoção do módulo simulado de
 * Mensagens: os arquivos saíram, nenhum código de produção volta a usar seus
 * componentes, hooks, tipos, chaves locais ou o vínculo do painel com a
 * Divisão de contas, e o Header não oferece mais o botão. As regras são do
 * módulo removido: "mensagem", "message", "chat" e "conversa" continuam livres
 * para notificações, erros e o assistente de IA.
 */

// Sem remover comentários: nem um comentário pode voltar a citar o módulo.
const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (path: string) => readFileSync(join(root, path), 'utf8');

const sourceFiles = (dir: string): string[] =>
  readdirSync(join(root, dir), {withFileTypes: true}).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|js|jsx|css)$/.test(entry.name) ? [path] : [];
  });

const REMOVED_PATHS = [
  'src/components/MessagesPanel.tsx',
  'src/components/NewConversationModal.tsx',
  'src/modules/messages',
];

const REMOVED_IDENTIFIERS: Array<[string, RegExp]> = [
  ['painel de Mensagens', /\bMessagesPanel\b/],
  ['modal de nova conversa', /\bNewConversationModal\b/],
  ['caminho do módulo', /modules\/messages\b/],
  ['contador de não lidas das Mensagens', /\buseUnreadMessagesCount\b/],
  ['hooks do módulo', /\b(useChatThreads|useThreadMessages|useSendMessage|useMarkThreadAsRead|useCreateConversation|useSearchUsers)\b/],
  ['tipos do módulo', /\b(ChatThread|ChatUser|ChatMessage)\b/],
  ['chaves locais das conversas simuladas', /app_chat_(threads|messages)/],
  ['estado do painel no Header', /\b(isMessagesOpen|setIsMessagesOpen|toggleMessages)\b/],
  ['vínculo do painel com a Divisão de contas', /\b(onOpenSplitGroup|handleOpenSplitGroup)\b/],
];

test('os arquivos do módulo simulado de Mensagens não existem', () => {
  // A raiz precisa apontar para o repositório, senão a ausência seria trivial.
  assert.ok(existsSync(join(root, 'src/components/Header.tsx')), 'raiz do repositório não encontrada');
  for (const path of REMOVED_PATHS) assert.equal(existsSync(join(root, path)), false, `${path} voltou`);
});

test('nenhum código de produção usa o módulo removido', () => {
  const files = sourceFiles('src');
  assert.ok(files.length > 100, 'a varredura precisa alcançar o código do frontend');
  for (const path of files) {
    const source = read(path);
    for (const [what, pattern] of REMOVED_IDENTIFIERS) {
      assert.doesNotMatch(source, pattern, `${path}: ${what}`);
    }
  }
});

test('o Header não oferece botão, contador nem painel de Mensagens', () => {
  const header = read('src/components/Header.tsx');
  assert.doesNotMatch(header, /['"`]Mensagens\b/, 'rótulo do botão de Mensagens');
  assert.doesNotMatch(header, /\bunreadMessages\b/, 'contador de não lidas das Mensagens');
  assert.doesNotMatch(header, /<Badge\s+count=/, 'contador numérico das Mensagens no badge');
  // O que fica: sino com painel e contagem, tema e menu da conta.
  assert.match(header, /<NotificationsPanel\b/);
  assert.match(header, /aria-label=\{unreadSummary\.bellLabel\}/);
  assert.match(header, /\{unreadSummary\.badge !== '' && <Badge label=\{unreadSummary\.badge\} \/>\}/);
  assert.match(header, /aria-label=\{isDarkMode \? 'Ativar modo claro' : 'Ativar modo escuro'\}/);
  assert.match(header, /aria-label=\{isUserMenuOpen \? 'Fechar menu da conta' : 'Abrir menu da conta'\}/);
});

test('a navegação real da Divisão de contas continua no App', () => {
  const app = read('src/App.tsx');
  assert.match(app, /<SplitGroupsView onSelectGroup=\{id => \{ setSelectedGroupId\(id\); setView\('split_group_details'\); \}\}/);
  assert.match(app, /<SplitGroupDetailsView groupId=\{selectedGroupId\} onBack=\{\(\) => setView\('shared_expenses'\)\}/);
  assert.match(app, /<Header onToggleSidebar=[^\n]*\bonNavigate=\{handleNavigate\} \/>/);
});
