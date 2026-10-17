import assert from 'node:assert/strict';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import test from 'node:test';

/**
 * P5-D1 (PR-NOTIF-01) — guardas estáticas do contrato de notificações:
 * o cliente nunca grava nem apaga o evento compartilhado, toda consulta tem
 * limite, não há polling nem listener permanente, o produtor não grava estado
 * de leitura no evento e o código morto (sino antigo, criação pelo cliente)
 * foi removido.
 */

const root = new URL('../../', import.meta.url).pathname;
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const code = (path: string) => read(path)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const MODULE_DIR = 'src/modules/notifications';
const moduleFiles = readdirSync(join(root, MODULE_DIR)).map((name) => `${MODULE_DIR}/${name}`);

test('o cliente não cria, altera nem apaga o evento compartilhado', () => {
  for (const path of [...moduleFiles, 'src/components/Header.tsx', 'src/components/NotificationsPanel.tsx', 'src/App.tsx']) {
    const source = code(path);
    assert.doesNotMatch(source, /\b(addDoc|deleteDoc|updateDoc|writeBatch)\b/, `${path}: escrita direta`);
  }
  const api = code(`${MODULE_DIR}/api.ts`);
  // A API não escreve direto: a única escrita é `transaction.set` no estado
  // privado (`stateRef`), dentro de `markNotificationBatch` (model.ts).
  assert.doesNotMatch(api, /transaction\.set\(/);
  const model = code(`${MODULE_DIR}/model.ts`);
  const sets = [...model.matchAll(/transaction\.set\(\s*([\w.]+)/g)].map((match) => match[1]);
  assert.deepEqual(sets, ['target.stateRef', 'target.stateRef']);
  assert.match(api, /stateRef: doc\(statesRef\(scope\), id\)/);
  assert.match(api, /markNotificationBatch\(/);
  assert.match(api, /notification_user_states/);
  assert.doesNotMatch(api, /\bsetDoc\b/);
  // Todas as leituras (estados e, para os criados, o evento) antes da 1ª escrita.
  const batch = /export const markNotificationBatch[\s\S]*$/.exec(model)?.[0] ?? '';
  assert.ok(batch.indexOf('transaction.get(target.eventRef)') < batch.indexOf('transaction.set('));
  assert.ok(batch.indexOf('transaction.get(target.stateRef)') < batch.indexOf('transaction.set('));
  // Marca já gravada não é regravada; a atualização não envia `expiresAt`.
  assert.match(batch, /if \(data\[mark\] === true\) \{/);
  assert.match(batch, /\{ \[mark\]: true, \[NOTIFICATION_STAMP\[mark\]\]: stamp \}, \{ merge: true \}/);
  assert.match(batch, /expiresAt: eventData\.expiresAt/);
});

test('estado privado em notification_entries; a subcoleção antiga items não existe mais no módulo', () => {
  const api = code(`${MODULE_DIR}/api.ts`);
  assert.match(api, /const ENTRIES = 'notification_entries';/);
  assert.match(api, /STATES, scope\.uid, ENTRIES\)/);
  for (const path of moduleFiles) {
    const source = code(path);
    assert.doesNotMatch(source, /['"`]items['"`]/, `${path}: caminho antigo items`);
    assert.doesNotMatch(source, /notification_user_states\/\{?[\w]*\}?\/items/, `${path}: caminho antigo items`);
  }
  for (const path of ['src/components/Header.tsx', 'src/components/NotificationsPanel.tsx']) {
    assert.doesNotMatch(code(path), /notification_user_states/, `${path}: não acessa o Firestore`);
  }
});

test('toda consulta de notificações e de estado tem limite', () => {
  const api = code(`${MODULE_DIR}/api.ts`);
  const queries = [...api.matchAll(/getDocs\(query\(([\s\S]*?)\)\);/g)].map((match) => match[1]);
  assert.equal(queries.length, 2, 'eventos e estados');
  for (const body of queries) assert.match(body, /\blimit\(/, 'consulta sem limit');
  assert.match(api, /limit\(NOTIFICATIONS_PAGE_SIZE \+ 1\)/);
  assert.match(api, /orderBy\('createdAt', 'desc'\),\s*orderBy\(documentId\(\), 'desc'\)/, 'desempate pelo ID');
  assert.doesNotMatch(api, /getDocs\(\s*(collection|notificationsRef|statesRef)\(/, 'coleção lida sem consulta');
  assert.doesNotMatch(api, /\.slice\(0, NOTIFICATIONS_PAGE_SIZE\)\.length/);
});

test('sem polling e sem listener permanente', () => {
  for (const path of [...moduleFiles, 'src/components/Header.tsx', 'src/components/NotificationsPanel.tsx']) {
    const source = code(path);
    assert.doesNotMatch(source, /refetchInterval/, `${path}: polling`);
    assert.doesNotMatch(source, /onSnapshot/, `${path}: listener`);
    assert.doesNotMatch(source, /setInterval/, `${path}: temporizador`);
  }
});

test('cache por workspace e uid em toda leitura e escrita', () => {
  const feed = code(`${MODULE_DIR}/feed.ts`);
  assert.doesNotMatch(feed, /queryKey:\s*\[\s*'notifications'\s*,\s*[a-zA-Z.]+\s*\]/, 'chave só com workspace');
  assert.match(code(`${MODULE_DIR}/model.ts`), /\['notifications', scope\.workspaceId, scope\.uid\]/);
  assert.match(code(`${MODULE_DIR}/hooks.ts`), /activeWorkspaceUid/, 'escopo exige workspace carregado para o uid');
});

test('código morto removido: sino antigo e criação de notificação pelo cliente', () => {
  assert.equal(existsSync(join(root, 'src/components/NotificationBell.tsx')), false);
  const app = code('src/App.tsx');
  assert.doesNotMatch(app, /useCreateNotification|createNotification/);
  for (const path of moduleFiles) {
    const source = code(path);
    assert.doesNotMatch(source, /createNotification|\bdeleteNotification\b|useArchiveNotification|useUnreadNotificationCount/, path);
  }
  assert.doesNotMatch(code('src/components/Header.tsx'), /NotificationBell/);
});

test('o produtor de cartões não grava estado de leitura no evento', () => {
  const closing = code('functions/src/cards/closing.ts');
  assert.doesNotMatch(closing, /\bread:\s*(false|true)/);
  assert.doesNotMatch(closing, /\bdismissed:/);
  assert.doesNotMatch(read('src/types.ts'), /^\s*read:\s*boolean;/m, 'AppNotification sem read compartilhado');
});

test('Rules: evento fechado ao cliente, estado só do dono, catch-all não reabre', () => {
  const rules = read('firestore.rules');
  const block = /match \/notifications\/\{notificationId\} \{([\s\S]*?)\n\}/.exec(rules)?.[1] ?? '';
  assert.match(block, /allow list: if canReadWorkspaceScopedData\(workspaceId\) &&\s*request\.query\.limit <= 50;/);
  assert.match(block, /allow create, update, delete: if false;/);
  assert.doesNotMatch(block, /allow (update|delete|write): if (?!false)/);
  assert.match(rules, /'notifications',\s*'notification_user_states'\s*\];/);
  const states = /match \/notification_user_states\/\{stateOwner\} \{([\s\S]*?)\n\}/.exec(rules)?.[1] ?? '';
  assert.match(states, /allow read, write: if false;/);
  assert.match(states, /allow delete: if false;/);
  assert.match(rules, /request\.auth\.uid == stateOwner &&\s*isMember\(workspaceId\)/);
});

test('painel: texto da ação explícito e estados de carregamento e erro', () => {
  const panel = read('src/components/NotificationsPanel.tsx');
  assert.match(panel, /Marcar exibidas como lidas/);
  assert.doesNotMatch(panel, /Marcar todas lidas/);
  assert.match(panel, /Carregar mais/);
  assert.match(panel, /Carregando notificações…/);
  assert.match(panel, /Tentar novamente/);
  assert.match(panel, /aria-label=\{`Arquivar para mim: \$\{notif\.title\}`\}/);
  assert.match(panel, /aria-label=\{`Excluir para mim: \$\{notif\.title\}`\}/);
  assert.doesNotMatch(panel, /onDelete\b/, 'onDelete foi renomeado para onArchive');
  // "Excluir para mim" só quando permitido; sem propagar o clique ao item; sem clique duplo.
  assert.match(panel, /\{canDelete && \(/);
  assert.match(panel, /e\.stopPropagation\(\); onDeleteForMe\(notif\.id\)/);
  assert.match(panel, /e\.stopPropagation\(\); onArchive\(notif\.id\)/);
  // P5-E1.1: o clique de um toque vai para o dono em que o toque começou
  // (item, "Arquivar" ou "Excluir"), mesmo com a lista se deslocando.
  assert.match(panel, /usePointerOriginTracking\(\);/);
  assert.equal(panel.match(/\{\.\.\.pressTargetProps\}/g)?.length, 3, 'item, arquivar e excluir são donos de gesto');
  assert.match(panel, /\{\.\.\.pressTargetProps\}\s*onClick=\{\(\) => handleItemClick\(notif\)\}/);
  // P5-E1.1: a animação do item é a original (layout, entrada e saída) e o painel
  // re-renderiza a cada `onExitComplete` do `AnimatePresence`: no framer-motion 10.16,
  // um aviso que começa a sair logo depois de outro terminar ficaria preso no DOM
  // (invisível e clicável). A atualização é funcional, para valer mesmo quando o
  // `AnimatePresence` chama uma versão antiga do manipulador.
  assert.match(panel, /key=\{notif\.id\}\s*layout\s*initial=\{\{ opacity: 0, x: -20 \}\}\s*animate=\{\{ opacity: 1, x: 0 \}\}/);
  assert.match(panel, /exit=\{\{ opacity: 0, height: 0, overflow: 'hidden' \}\}/);
  assert.match(panel, /<AnimatePresence initial=\{false\} onExitComplete=\{handleExitComplete\}>/);
  assert.match(panel, /const \[, setExitCompletions\] = useState\(0\);/);
  assert.match(panel, /const handleExitComplete = \(\) => setExitCompletions\(\(count\) => count \+ 1\);/);
  assert.equal(panel.match(/<AnimatePresence\b/g)?.length, 1, 'uma lista animada, com a correção');
  assert.match(panel, /\{\.\.\.pressTargetProps\}\s*onClick=\{\(e\) => \{ e\.stopPropagation\(\); onDeleteForMe\(notif\.id\); \}\}/);
  assert.match(panel, /\{\.\.\.pressTargetProps\}\s*onClick=\{\(e\) => \{ e\.stopPropagation\(\); onArchive\(notif\.id\); \}\}/);
  assert.match(panel, /disabled=\{isDeleting\}/);
  // Acessível sem hover: no celular as ações ficam visíveis; no teclado, por foco.
  assert.match(panel, /\[@media\(hover:hover\)\]:opacity-0/);
  assert.match(panel, /group-focus-within:opacity-100/);
  assert.match(panel, /focus-visible:ring-2/);
  assert.match(panel, /aria-label="Fechar notificações"/);
  // Ação protegida contra clique duplo enquanto a marcação está em curso.
  assert.match(panel, /onClick=\{onMarkAllRead\}\s*disabled=\{isMarking\}/);
  assert.match(read('src/components/Header.tsx'), /isMarking=\{notificationActions\.isMarking\}/);
});

test('P5-E1.1 Header: o fundo transparente é dono de gesto (só recebe o clique de gesto iniciado nele)', () => {
  const header = read('src/components/Header.tsx');
  assert.match(header, /usePointerOriginTracking\(\);/);
  const backdrop = /<div\s+className="fixed inset-0 z-30 bg-transparent"([\s\S]*?)\/>/.exec(header)?.[1] ?? '';
  assert.match(backdrop, /\{\.\.\.pressTargetProps\}/);
  assert.match(backdrop, /onClick=\{\(\) => \{ setIsNotificationsOpen\(false\); setIsMessagesOpen\(false\); setIsUserMenuOpen\(false\); \}\}/);
});

test('P5-E1.1 roteamento do clique: ouvintes de captura no documento, sem reimplementar o toque', () => {
  const press = read('src/lib/pressOrigin.ts');
  assert.match(press, /document\.addEventListener\('pointerdown', recordPointerDown, true\)/);
  assert.match(press, /document\.addEventListener\('click', routeClick, true\)/);
  assert.doesNotMatch(press, /onTouch(Start|End)|addEventListener\('touch/, 'o navegador decide se houve clique');
});

test('Header: confirmação de exclusão em pt-BR, canDelete por papel e ligação das ações', () => {
  const header = read('src/components/Header.tsx');
  assert.match(header, /title="Excluir notificação"/);
  assert.match(header, /message="Excluir esta notificação apenas para você\? Ela continuará disponível para os demais membros\. Esta ação não poderá ser desfeita\."/);
  assert.match(header, /confirmLabel="Excluir para mim"/);
  assert.match(header, /isBusy=\{notificationActions\.isDeleting\}/);
  assert.match(header, /error=\{notificationActions\.deleteError \?\? deleteNotice\}/);
  // Gravação em curso: o diálogo não fecha; o resultado só vale para o mesmo pedido.
  assert.match(header, /if \(isDeletingNotification\) return;/);
  assert.match(header, /current\?\.id !== target\.id \|\| current\.scopeKey !== target\.scopeKey/);
  assert.match(header, /canDelete=\{canDeleteNotifications\}/);
  assert.match(header, /onArchive=\{\(id\) => notificationActions\.dismiss\(id\)\}/);
  assert.doesNotMatch(header, /onDelete=/);
  const hooks = code(`${MODULE_DIR}/hooks.ts`);
  assert.match(hooks, /canDeleteNotifications\(scope, activeWorkspaceUid, activeWorkspaceRole\)/);
  assert.match(hooks, /deleteForMe: deleteNotificationForMe/);
});

test('o módulo não apaga documentos: excluir para mim é só a marca deleted', () => {
  for (const path of moduleFiles) {
    assert.doesNotMatch(code(path), /\b(deleteDoc|transaction\.delete|batch\.delete)\b/, path);
  }
  assert.match(code(`${MODULE_DIR}/api.ts`), /applyMark\(scope, \[id\], 'deleted'\)/);
});

test('contagem exata (P5-D2): vem da callable, sem contagem parcial, agregação no cliente, polling nem listener', () => {
  for (const path of [...moduleFiles, 'src/components/Header.tsx', 'src/components/NotificationsPanel.tsx']) {
    const source = code(path);
    assert.doesNotMatch(source, /\bsummarizeUnread\b|\bUnreadSummary\b/, `${path}: contagem parcial antiga`);
    assert.doesNotMatch(source, /getCountFromServer|getAggregateFromServer|\bcount\(\)/, `${path}: agregação no cliente`);
    assert.doesNotMatch(source, /refetchInterval|onSnapshot|setInterval/, `${path}: polling ou listener`);
  }
  // Módulo puro (sem SDK); a ligação ao `httpsCallable` fica em api.ts.
  const callables = code(`${MODULE_DIR}/callables.ts`);
  assert.doesNotMatch(callables, /from 'firebase\//);
  assert.match(callables, /'getNotificationUnreadCount', \{ workspaceId: scope\.workspaceId \}/);
  assert.doesNotMatch(callables, /\buid\b[^,\n]*\}\s*\)/, 'o uid não vai no payload');
  assert.match(code(`${MODULE_DIR}/api.ts`), /httpsCallable/);
  // Consulta por escopo, no máximo uma nova tentativa, sem releitura automática.
  const model = code(`${MODULE_DIR}/model.ts`);
  assert.match(model, /\['notifications', scope\.workspaceId, scope\.uid, 'unread-count'\]/);
  const feed = code(`${MODULE_DIR}/feed.ts`);
  const hook = /export const useNotificationUnreadCount[\s\S]*?\n\};\n/.exec(feed)?.[0] ?? '';
  assert.match(hook, /enabled: scope !== null/);
  assert.match(hook, /staleTime: NOTIFICATIONS_STALE_TIME_MS/);
  assert.match(hook, /refetchOnWindowFocus: true/);
  assert.match(hook, /failureCount < 1/);
  assert.match(hook, /isError\) return \{ status: 'unavailable' \}/);
  // Ações do painel releem a contagem do escopo em que começaram (sucesso e erro).
  assert.match(feed, /onSettled: \(_marked, _error, \{ scope \}\) => \{[\s\S]*?notificationKeys\.unreadCount\(scope\)/);
  // Header: o sino e o chip vêm da contagem exata; a abertura do painel a relê se obsoleta.
  const header = code('src/components/Header.tsx');
  assert.match(header, /notificationUnreadCount\.summary/);
  assert.match(header, /refreshUnreadCountIfStale\(\)/);
  assert.match(header, /aria-label=\{unreadSummary\.bellLabel\}/);
  assert.match(header, /unreadSummary\.badge !== '' && <Badge label=\{unreadSummary\.badge\} \/>/);
  assert.match(header, /unreadChip=\{unreadSummary\.chip\}/);
  assert.match(header, /unreadChipLabel=\{unreadSummary\.chipLabel\}/);
});
