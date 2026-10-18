import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NOTIFICATION_MARK_BATCH_SIZE,
  NOTIFICATIONS_PAGE_SIZE,
  applyNotificationState,
  buildNotificationPage,
  canDeleteNotifications,
  chunkIds,
  keepConfirmedNotificationMarks,
  keepFirstNotificationPage,
  markNotificationBatch,
  nextExpiryDelayMs,
  notificationActionErrorMessage,
  notificationKeys,
  notificationLoadErrorMessage,
  resolveNotificationScope,
  summarizeUnreadCount,
  toAppNotification,
  toNotificationUserState,
  visibleNotifications,
  type MarkSnapshot,
  type MarkTransaction,
  type RawNotificationDoc,
} from '../../src/modules/notifications/model.ts';
import type {NotificationPage, UserNotification} from '../../src/modules/notifications/types.ts';

/**
 * P5-D1 (PR-NOTIF-01) — regras puras do painel de notificações: escopo e
 * chave de cache por (workspace, uid), forma do evento (sem estado), página
 * com sonda e cursor estável, itens visíveis, textos da contagem exata
 * (carregando, pronta, indisponível), aplicação do estado só nos alvos, lotes e mensagens pt-BR.
 */

const NOW = Date.parse('2026-10-11T12:00:00.000Z');
const DAY = 86_400_000;

/** Timestamp do SDK web, só com o que o cliente usa. */
const ts = (ms: number) => ({toMillis: () => ms});

/** Evento como o produtor de cartões grava (`functions/src/cards/closing.ts`). */
const cardsEvent = (id: string, createdAt: string, extra: Record<string, unknown> = {}): RawNotificationDoc => ({
  id,
  data: {
    id, workspaceId: 'ws-a', title: 'Fatura fechada', message: 'A fatura de janeiro do Cartão X fechou.',
    type: 'credit_card', link: 'cards', actionLabel: 'Ver cartões', createdAt,
    source: 'credit_card_invoice', domain: 'credit_card', domainEventType: 'invoice_closed',
    cardId: 'card-1', invoiceId: `inv-${id}`, expiresAt: ts(NOW + 180 * DAY), ...extra,
  },
});

const item = (id: string, state: Partial<UserNotification> = {}): UserNotification => ({
  id, title: id, message: 'm', type: 'info', createdAt: '2026-10-08T00:00:00.000Z',
  expiresAtMs: NOW + 180 * DAY, read: false, dismissed: false, deleted: false, ...state,
});

const pages = (...lists: UserNotification[][]) => ({
  pages: lists.map((items, index): NotificationPage => ({
    items, nextCursor: index < lists.length - 1 ? {createdAt: 'x', id: `c${index}`} : null,
  })),
  pageParams: lists.map((_, index) => (index === 0 ? null : {createdAt: 'x', id: `c${index - 1}`})),
});

test('escopo exige uid da sessão e workspace carregado para esse uid', () => {
  assert.deepEqual(resolveNotificationScope('u1', 'ws-a', 'u1'), {workspaceId: 'ws-a', uid: 'u1'});
  assert.equal(resolveNotificationScope('u1', 'ws-a', 'u2'), null, 'workspace carregado para outra conta');
  assert.equal(resolveNotificationScope('u1', 'ws-a', null), null, 'workspace ainda não carregado');
  assert.equal(resolveNotificationScope(null, 'ws-a', null), null);
  for (const invalid of ['', 'loading', 'undefined', 'null', ' ws', 'a/b', 'x'.repeat(257)]) {
    assert.equal(resolveNotificationScope('u1', invalid, 'u1'), null, `workspace inválido: ${JSON.stringify(invalid)}`);
    assert.equal(resolveNotificationScope(invalid, 'ws-a', invalid), null, `uid inválido: ${JSON.stringify(invalid)}`);
  }
});

test('chave de cache inclui workspace e uid; escopos diferentes nunca colidem', () => {
  const a1 = notificationKeys.scope({workspaceId: 'ws-a', uid: 'u1'});
  const a2 = notificationKeys.scope({workspaceId: 'ws-a', uid: 'u2'});
  const b1 = notificationKeys.scope({workspaceId: 'ws-b', uid: 'u1'});
  assert.deepEqual(a1, ['notifications', 'ws-a', 'u1']);
  assert.notDeepEqual(a1, a2);
  assert.notDeepEqual(a1, b1);
  assert.deepEqual(a1.slice(0, 1), notificationKeys.all);
});

test('evento novo do produtor de cartões é aceito sem campo de estado', () => {
  const parsed = toAppNotification('ccclosed_x', cardsEvent('ccclosed_x', '2026-10-08T10:00:00.000Z').data);
  assert.ok(parsed);
  assert.equal(parsed.title, 'Fatura fechada');
  assert.equal(parsed.type, 'credit_card');
  assert.equal(parsed.link, 'cards');
  assert.equal(parsed.actionLabel, 'Ver cartões');
  assert.equal('read' in parsed, false);
});

test('estado gravado no evento é ignorado: o estado vem só do documento privado', () => {
  const page = buildNotificationPage(
    [cardsEvent('n1', '2026-10-08T10:00:00.000Z', {read: true, dismissed: true})],
    new Map(),
  );
  assert.equal(page.items[0].read, false);
  assert.equal(page.items[0].dismissed, false);
  assert.equal(page.items[0].deleted, false);
  assert.deepEqual(toNotificationUserState(undefined), {read: false, dismissed: false, deleted: false});
  assert.deepEqual(toNotificationUserState({read: true, readAt: 'x'}), {read: true, dismissed: false, deleted: false});
  assert.deepEqual(toNotificationUserState({deleted: true, read: true}), {read: true, dismissed: false, deleted: true});
  assert.deepEqual(toNotificationUserState({read: 'true', dismissed: 1, deleted: 'true'}), {read: false, dismissed: false, deleted: false});
});

test('evento malformado não vira notificação e tipo desconhecido vira informativo', () => {
  assert.equal(toAppNotification('x', {title: 'T', message: 'M'}), null, 'sem data');
  assert.equal(toAppNotification('x', {title: 'T', createdAt: '2026-10-08'}), null, 'sem mensagem');
  assert.equal(toAppNotification('x', {title: 1, message: 'M', createdAt: '2026-10-08'}), null, 'título não textual');
  const base = {title: 'T', message: 'M', createdAt: '2026-10-08', expiresAt: ts(NOW + DAY)};
  assert.equal(toAppNotification('x', {...base, type: 'outro'})?.type, 'info');
});

test('página: sonda de um a mais define o cursor; página final não tem cursor', () => {
  const docs = Array.from({length: NOTIFICATIONS_PAGE_SIZE + 1}, (_, index) =>
    cardsEvent(`n${String(index).padStart(2, '0')}`, `2026-10-08T10:${String(59 - index).padStart(2, '0')}:00.000Z`));
  const full = buildNotificationPage(docs, new Map([['n01', {read: true, dismissed: false, deleted: false}]]));
  assert.equal(full.items.length, NOTIFICATIONS_PAGE_SIZE, 'o excedente não é exibido');
  assert.equal(full.items[1].read, true, 'estado privado aplicado ao item certo');
  assert.deepEqual(full.nextCursor, {createdAt: docs[NOTIFICATIONS_PAGE_SIZE - 1].data.createdAt, id: 'n24'});
  const last = buildNotificationPage(docs.slice(0, 3), new Map());
  assert.equal(last.items.length, 3);
  assert.equal(last.nextCursor, null);
});

test('página: documento inválido não some com o cursor (nada repetido nem pulado)', () => {
  const docs: RawNotificationDoc[] = [
    cardsEvent('n3', '2026-10-08T10:00:00.000Z'),
    {id: 'n2', data: {createdAt: '2026-10-08T09:00:00.000Z'}},
    cardsEvent('n1', '2026-10-08T08:00:00.000Z'),
  ];
  const page = buildNotificationPage(docs, new Map(), 2);
  assert.deepEqual(page.items.map((entry) => entry.id), ['n3']);
  assert.deepEqual(page.nextCursor, {createdAt: '2026-10-08T09:00:00.000Z', id: 'n2'});
});

test('itens visíveis: sem repetição entre páginas e sem os arquivados para si', () => {
  const data = pages(
    [item('a'), item('b', {dismissed: true}), item('c', {read: true})],
    [item('c', {read: true}), item('d')],
  );
  assert.deepEqual(visibleNotifications(data, NOW).map((entry) => entry.id), ['a', 'c', 'd']);
  assert.deepEqual(visibleNotifications(undefined, NOW), []);
});

test('resumo da contagem exata: carregando, indisponível e pronta (n = 0, 1, 2, 9, 10, 137)', () => {
  assert.deepEqual(summarizeUnreadCount({status: 'loading'}), {
    badge: '',
    bellLabel: 'Notificações',
    chip: '…',
    chipLabel: 'Carregando o total de não lidas',
  });
  assert.deepEqual(summarizeUnreadCount({status: 'unavailable'}), {
    badge: '?',
    bellLabel: 'Notificações, total de não lidas indisponível',
    chip: '?',
    chipLabel: 'Total de não lidas indisponível',
  });
  const ready = (count: number) => summarizeUnreadCount({status: 'ready', count});
  assert.deepEqual(ready(0), {
    badge: '',
    bellLabel: 'Notificações, nenhuma não lida',
    chip: '0',
    chipLabel: 'Nenhuma não lida',
  });
  assert.deepEqual(ready(1), {
    badge: '1',
    bellLabel: 'Notificações, 1 não lida',
    chip: '1',
    chipLabel: '1 não lida',
  });
  assert.deepEqual(ready(2), {
    badge: '2',
    bellLabel: 'Notificações, 2 não lidas',
    chip: '2',
    chipLabel: '2 não lidas',
  });
  assert.deepEqual(ready(9), {
    badge: '9',
    bellLabel: 'Notificações, 9 não lidas',
    chip: '9',
    chipLabel: '9 não lidas',
  });
  assert.deepEqual(ready(10), {
    badge: '9+',
    bellLabel: 'Notificações, 10 não lidas',
    chip: '10',
    chipLabel: '10 não lidas',
  });
  assert.deepEqual(ready(137), {
    badge: '9+',
    bellLabel: 'Notificações, 137 não lidas',
    chip: '137',
    chipLabel: '137 não lidas',
  });
  // Indisponível nunca se confunde com zero.
  assert.notEqual(summarizeUnreadCount({status: 'unavailable'}).badge, ready(0).badge);
  assert.notEqual(summarizeUnreadCount({status: 'unavailable'}).chip, '0');
});

test('chave da contagem: por workspace e uid, sem reaproveitar entre escopos', () => {
  assert.deepEqual(notificationKeys.unreadCount({workspaceId: 'ws-a', uid: 'u1'}), ['notifications', 'ws-a', 'u1', 'unread-count']);
  assert.notDeepEqual(
    notificationKeys.unreadCount({workspaceId: 'ws-a', uid: 'u1'}),
    notificationKeys.unreadCount({workspaceId: 'ws-b', uid: 'u1'}),
  );
  assert.notDeepEqual(
    notificationKeys.unreadCount({workspaceId: 'ws-a', uid: 'u1'}),
    notificationKeys.unreadCount({workspaceId: 'ws-a', uid: 'u2'}),
  );
});

test('estado confirmado entra só nos itens alvo, sem tocar em páginas e cursores', () => {
  const data = pages([item('a'), item('b')], [item('c')]);
  const next = applyNotificationState(data, ['b', 'c'], {read: true});
  assert.ok(next);
  assert.deepEqual(next.pages.flatMap((page) => page.items).map((entry) => [entry.id, entry.read]),
    [['a', false], ['b', true], ['c', true]]);
  assert.deepEqual(next.pageParams, data.pageParams);
  assert.deepEqual(next.pages.map((page) => page.nextCursor), data.pages.map((page) => page.nextCursor));
  assert.equal(data.pages[0].items[1].read, false, 'sem mutar o cache anterior');
  assert.equal(applyNotificationState(undefined, ['a'], {read: true}), undefined);
  assert.equal(applyNotificationState(data, [], {read: true}), data);
});

test('fechar o painel volta o cache à primeira página', () => {
  const data = pages([item('a')], [item('b')], [item('c')]);
  const first = keepFirstNotificationPage(data);
  assert.ok(first);
  assert.equal(first.pages.length, 1);
  assert.deepEqual(first.pageParams, [null]);
  const single = pages([item('a')]);
  assert.equal(keepFirstNotificationPage(single), single);
  assert.equal(keepFirstNotificationPage(undefined), undefined);
});

test('P5-E1.1 marca confirmada não volta atrás quando chega leitura antiga', () => {
  const cached = pages([item('a', {dismissed: true}), item('b', {read: true}), item('c')]);
  const stale = pages([item('a'), item('b'), item('c')]);
  const merged = keepConfirmedNotificationMarks(cached, stale);
  assert.deepEqual(merged.pages.flatMap((page) => page.items).map((entry) => [entry.id, entry.read, entry.dismissed, entry.deleted]),
    [['a', false, true, false], ['b', true, false, false], ['c', false, false, false]]);
  assert.equal(merged.pages[0].items[2], stale.pages[0].items[2], 'item sem marca no cache segue o da leitura');
  assert.equal(stale.pages[0].items[0].dismissed, false, 'sem mutar a leitura');
});

test('P5-E1.1 a fusão soma marcas, nunca inventa marca nem item e preserva referências sem mudança', () => {
  const fresh = pages([item('a', {read: true}), item('b')], [item('d', {deleted: true})]);
  assert.equal(keepConfirmedNotificationMarks(undefined, fresh), fresh, 'primeira leitura entra como veio');
  assert.equal(keepConfirmedNotificationMarks(pages([item('a'), item('b')]), fresh), fresh, 'cache sem marcas não muda nada');

  const cached = pages([item('a', {dismissed: true}), item('x', {deleted: true})]);
  const merged = keepConfirmedNotificationMarks(cached, fresh);
  assert.deepEqual(merged.pages.flatMap((page) => page.items).map((entry) => [entry.id, entry.read, entry.dismissed, entry.deleted]),
    [['a', true, true, false], ['b', false, false, false], ['d', false, false, true]],
    'marcas somadas por ID; "x" (fora da leitura) não volta à lista');
  assert.equal(merged.pages[1], fresh.pages[1], 'página sem mudança mantém a referência');
  assert.deepEqual(merged.pageParams, fresh.pageParams);
  assert.deepEqual(merged.pages.map((page) => page.nextCursor), fresh.pages.map((page) => page.nextCursor));

  const already = pages([item('a', {read: true, dismissed: true})]);
  assert.equal(keepConfirmedNotificationMarks(pages([item('a', {dismissed: true})]), already), already,
    'leitura que já traz as marcas não é copiada');
});

test('P5-E1.1 evento recriado com o mesmo ID (outra expiração) não herda marca do cache', () => {
  const cached = pages([item('a', {dismissed: true, expiresAtMs: NOW + 10 * DAY})]);
  const recreated = pages([item('a', {expiresAtMs: NOW + 180 * DAY})]);
  const merged = keepConfirmedNotificationMarks(cached, recreated);
  assert.equal(merged, recreated, 'nada copiado');
  assert.equal(merged.pages[0].items[0].dismissed, false);
});

test('lotes de marcação: no máximo 10 IDs, sem repetição', () => {
  assert.equal(NOTIFICATION_MARK_BATCH_SIZE, 10);
  const ids = Array.from({length: 32}, (_, index) => `n${index}`);
  const chunks = chunkIds([...ids, 'n0', 'n1']);
  assert.deepEqual(chunks.map((chunk) => chunk.length), [10, 10, 10, 2]);
  assert.deepEqual(chunks.flat(), ids);
  assert.deepEqual(chunkIds([]), []);
});

test('mensagens de erro em pt-BR, sem detalhe interno', () => {
  const permission = {code: 'permission-denied', message: 'Missing or insufficient permissions.'};
  assert.equal(notificationLoadErrorMessage(permission), 'Você não tem acesso às notificações deste espaço.');
  assert.equal(notificationLoadErrorMessage({code: 'firestore/unavailable'}),
    'Sem conexão com o servidor. Verifique sua internet e tente novamente.');
  assert.equal(notificationLoadErrorMessage(new Error('boom')), 'Não foi possível carregar as notificações. Tente novamente.');
  assert.equal(notificationActionErrorMessage(permission),
    'Você não tem permissão para atualizar notificações neste espaço.');
  assert.equal(notificationActionErrorMessage({code: 'unauthenticated'}), 'Sua sessão expirou. Entre novamente para continuar.');
  assert.equal(notificationActionErrorMessage(null), 'Não foi possível atualizar a notificação. Tente novamente.');
  for (const message of [notificationLoadErrorMessage(permission), notificationActionErrorMessage(permission)]) {
    assert.doesNotMatch(message, /permission|insufficient|firestore|Missing/i);
  }
});

test('evento sem expiresAt (ou com expiresAt que não é Timestamp) está fora do contrato e é ignorado', () => {
  const valid = {title: 'T', message: 'M', createdAt: '2026-10-08T10:00:00.000Z'};
  assert.equal(toAppNotification('x', valid), null, 'sem expiresAt');
  assert.equal(toAppNotification('x', {...valid, expiresAt: '2027-01-01T00:00:00.000Z'}), null, 'texto');
  assert.equal(toAppNotification('x', {...valid, expiresAt: NOW + DAY}), null, 'número');
  assert.equal(toAppNotification('x', {...valid, expiresAt: {seconds: 1, nanoseconds: 0}}), null, 'sem toMillis');
  assert.equal(toAppNotification('x', {...valid, expiresAt: {toMillis: () => Number.NaN}}), null, 'NaN');
  assert.equal(toAppNotification('x', {...valid, expiresAt: ts(NOW + DAY)})?.expiresAtMs, NOW + DAY);
  const page = buildNotificationPage([{id: 'a', data: valid}, cardsEvent('b', '2026-10-08T09:00:00.000Z')], new Map());
  assert.deepEqual(page.items.map((entry) => entry.id), ['b']);
});

test('expiração em 179, 180 e 181 dias: o limite é inclusivo (expiresAt <= agora some)', () => {
  const created = NOW - 180 * DAY;
  const expiresAt = created + 180 * DAY; // = NOW
  const at = (nowMs: number) => visibleNotifications(
    pages([item('a', {expiresAtMs: expiresAt})]), nowMs).length;
  assert.equal(at(created + 179 * DAY), 1, 'dia 179: visível');
  assert.equal(at(created + 180 * DAY - 1), 1, 'um milissegundo antes: visível');
  assert.equal(at(created + 180 * DAY), 0, 'dia 180: expira (<=)');
  assert.equal(at(created + 181 * DAY), 0, 'dia 181: fora');
  assert.deepEqual(visibleNotifications(pages([item('a', {expiresAtMs: expiresAt})]), NOW), [], 'no instante exato do vencimento, fora');
});

test('excluída tem precedência: some, não conta como não lida, mesmo lida ou arquivada antes', () => {
  const data = pages([
    item('a'),
    item('del', {deleted: true}),
    item('del-read', {deleted: true, read: true}),
    item('del-dismissed', {deleted: true, dismissed: true}),
    item('read', {read: true}),
  ]);
  const visible = visibleNotifications(data, NOW);
  assert.deepEqual(visible.map((entry) => entry.id), ['a', 'read']);
  assert.equal(visible.filter((entry) => !entry.read).length, 1, 'só \'a\' é visível e não lida');
  // Excluir depois de ler/arquivar: o cache aplica a marca nova sobre as anteriores.
  const afterRead = applyNotificationState(pages([item('a', {read: true})]), ['a'], {deleted: true});
  assert.deepEqual(visibleNotifications(afterRead, NOW), []);
  const afterArchive = applyNotificationState(pages([item('a', {dismissed: true})]), ['a'], {deleted: true});
  assert.equal(afterArchive?.pages[0].items[0].deleted, true);
  assert.equal(afterArchive?.pages[0].items[0].dismissed, true, 'marcas anteriores permanecem');
});

test('cursor sobre o último documento BRUTO lido, mesmo expirado ou excluído; filtragem só na lista visível', () => {
  const docs: RawNotificationDoc[] = [
    cardsEvent('n5', '2026-10-08T14:00:00.000Z'),
    cardsEvent('n4', '2026-10-08T13:00:00.000Z'),
    cardsEvent('n3', '2026-10-08T12:00:00.000Z', {expiresAt: ts(NOW - 1)}), // expirada (ainda no Firestore)
    cardsEvent('n2', '2026-10-08T11:00:00.000Z'), // excluída
    cardsEvent('n1', '2026-10-08T10:00:00.000Z'), // sonda
  ];
  const states = new Map([['n2', {read: false, dismissed: false, deleted: true}]]);
  const page = buildNotificationPage(docs, states, 4);
  assert.equal(page.items.length, 4, 'a página guarda os brutos válidos');
  assert.deepEqual(page.nextCursor, {createdAt: '2026-10-08T11:00:00.000Z', id: 'n2'}, 'cursor no último bruto (excluído)');
  const visible = visibleNotifications({pages: [page], pageParams: [null]}, NOW);
  assert.deepEqual(visible.map((entry) => entry.id), ['n5', 'n4']);

  // Expirado sem Timestamp válido (fora do contrato) no fim da página: cursor continua nele.
  const tail: RawNotificationDoc[] = [
    cardsEvent('m3', '2026-10-08T12:00:00.000Z'),
    {id: 'm2', data: {title: 'x', message: 'y', createdAt: '2026-10-08T11:00:00.000Z'}},
    cardsEvent('m1', '2026-10-08T10:00:00.000Z'),
  ];
  assert.deepEqual(buildNotificationPage(tail, new Map(), 2).nextCursor, {createdAt: '2026-10-08T11:00:00.000Z', id: 'm2'});
});

test('página com menos de 25 visíveis e cursor não é fim do histórico', () => {
  // 25 brutos lidos + sonda; 20 deles excluídos: restam 5 visíveis, mas há cursor.
  const docs = Array.from({length: NOTIFICATIONS_PAGE_SIZE + 1}, (_, index) =>
    cardsEvent(`n${String(index).padStart(2, '0')}`, `2026-10-08T10:${String(59 - index).padStart(2, '0')}:00.000Z`));
  const states = new Map(Array.from({length: 20}, (_, index) =>
    [`n${String(index).padStart(2, '0')}`, {read: false, dismissed: false, deleted: true}] as const));
  const page = buildNotificationPage(docs, states);
  const visible = visibleNotifications({pages: [page], pageParams: [null]}, NOW);
  assert.equal(visible.length, 5);
  assert.ok(visible.length < NOTIFICATIONS_PAGE_SIZE);
  assert.notEqual(page.nextCursor, null, 'há mais páginas (hasMore)');
});

test('nextExpiryDelayMs: ms até a próxima expiração entre as carregadas', () => {
  assert.equal(nextExpiryDelayMs([], NOW), null);
  assert.equal(nextExpiryDelayMs([{expiresAtMs: NOW + 5000}, {expiresAtMs: NOW + 1000}, {expiresAtMs: NOW + 9000}], NOW), 1000);
  assert.equal(nextExpiryDelayMs([{expiresAtMs: NOW}, {expiresAtMs: NOW - 10}], NOW), null, 'já expiradas não contam');
  assert.equal(nextExpiryDelayMs([{expiresAtMs: NOW - 10}, {expiresAtMs: NOW + 1}], NOW), 1);
});

test('canDelete: só owner, admin e member do mesmo uid do escopo; viewer e indefinido não', () => {
  const scope = {workspaceId: 'ws-a', uid: 'u1'};
  for (const role of ['owner', 'admin', 'member']) {
    assert.equal(canDeleteNotifications(scope, 'u1', role), true, role);
  }
  for (const role of ['viewer', undefined, null, '', 'Owner', 'guest']) {
    assert.equal(canDeleteNotifications(scope, 'u1', role), false, String(role));
  }
  assert.equal(canDeleteNotifications(null, 'u1', 'owner'), false, 'sem escopo');
  assert.equal(canDeleteNotifications(scope, 'u2', 'owner'), false, 'papel de outra conta');
  assert.equal(canDeleteNotifications(scope, null, 'owner'), false, 'workspace ainda não carregado');
});

test('erro de exclusão em pt-BR: permissão específica e sem falso detalhe interno', () => {
  const permission = {code: 'permission-denied', message: 'Missing or insufficient permissions.'};
  assert.equal(notificationActionErrorMessage(permission, 'delete'), 'Você não tem permissão para excluir esta notificação.');
  assert.equal(notificationActionErrorMessage(permission, 'update'), 'Você não tem permissão para atualizar notificações neste espaço.');
  assert.equal(notificationActionErrorMessage({code: 'unavailable'}, 'delete'),
    'Sem conexão com o servidor. Verifique sua internet e tente novamente.');
  assert.equal(notificationActionErrorMessage(new Error('x'), 'delete'), 'Não foi possível excluir a notificação. Tente novamente.');
});

// --- Marcação em transação por lote (API) com uma transação falsa -----------

type Doc = Record<string, unknown> | undefined;

const snapshot = (data: Doc): MarkSnapshot => ({exists: () => data !== undefined, data: () => data});

/** Transação em memória que registra leituras e escritas na ordem em que ocorrem. */
const fakeTransaction = (store: Map<string, Record<string, unknown>>) => {
  const log: string[] = [];
  const writes: Array<{ref: string; data: Record<string, unknown>; merge: boolean}> = [];
  const transaction: MarkTransaction<string> = {
    get: async (ref) => {
      log.push(`get:${ref}`);
      return snapshot(store.get(ref));
    },
    set: (ref, data, options) => {
      log.push(`set:${ref}`);
      writes.push({ref, data, merge: options.merge});
    },
  };
  return {transaction, log, writes};
};

const STAMP = {sentinel: 'serverTimestamp'};
const target = (id: string) => ({id, stateRef: `state/${id}`, eventRef: `event/${id}`});

test('marcação: criação copia o expiresAt do evento e lê todos os dados antes de qualquer escrita', async () => {
  const expiresAt = ts(NOW + 10 * DAY);
  const store = new Map<string, Record<string, unknown>>([
    ['event/a', {expiresAt}],
    ['event/b', {expiresAt: ts(NOW + 20 * DAY)}],
    ['state/b', {read: true, readAt: 'x', expiresAt: ts(NOW + 20 * DAY)}], // já existe
  ]);
  const {transaction, log, writes} = fakeTransaction(store);
  const done = await markNotificationBatch(transaction, [target('a'), target('b')], 'deleted', NOW, STAMP);
  assert.deepEqual(done, ['a', 'b']);
  const firstWrite = log.findIndex((entry) => entry.startsWith('set:'));
  assert.ok(firstWrite > 0);
  assert.ok(log.slice(firstWrite).every((entry) => entry.startsWith('set:')), 'nenhuma leitura depois da primeira escrita');
  assert.deepEqual(log.slice(0, firstWrite).sort(), ['get:event/a', 'get:state/a', 'get:state/b']);
  assert.equal(log.includes('get:event/b'), false, 'evento só é lido quando o estado será criado');
  const created = writes.find((write) => write.ref === 'state/a');
  assert.deepEqual(created?.data, {deleted: true, deletedAt: STAMP, expiresAt});
  assert.strictEqual(created?.data.expiresAt, expiresAt, 'copia o Timestamp do evento');
  assert.equal(created?.merge, true);
});

test('marcação: atualização grava só a marca nova (sem expiresAt) e marca repetida não regrava', async () => {
  const store = new Map<string, Record<string, unknown>>([
    ['state/a', {read: true, readAt: 'r', expiresAt: ts(NOW + DAY)}],
    ['state/b', {deleted: true, deletedAt: 'd', read: true, readAt: 'r', expiresAt: ts(NOW + DAY)}],
  ]);
  const {transaction, writes, log} = fakeTransaction(store);
  const done = await markNotificationBatch(transaction, [target('a'), target('b')], 'deleted', NOW, STAMP);
  assert.deepEqual(done, ['a', 'b'], 'devolve marcados e já marcados');
  assert.equal(writes.length, 1, 'b já excluída: nenhuma regravação');
  assert.deepEqual(writes[0], {ref: 'state/a', data: {deleted: true, deletedAt: STAMP}, merge: true});
  assert.equal('expiresAt' in writes[0].data, false);
  assert.equal(log.some((entry) => entry.startsWith('get:event/')), false, 'atualização não lê o evento');

  const again = fakeTransaction(new Map([['state/a', {read: true, readAt: 'r', expiresAt: ts(NOW + DAY)}]]));
  assert.deepEqual(await markNotificationBatch(again.transaction, [target('a')], 'read', NOW, STAMP), ['a']);
  assert.deepEqual(again.writes, [], 'ler de novo não regrava nem muda o carimbo');
});

test('marcação: evento ausente, sem expiresAt ou expirado é pulado sem gravar; estado expirado também', async () => {
  const store = new Map<string, Record<string, unknown>>([
    ['event/noexp', {title: 'x'}],
    ['event/expired', {expiresAt: ts(NOW)}], // expiresAt <= agora
    ['event/ok', {expiresAt: ts(NOW + 1)}],
    ['state/stale', {read: true, readAt: 'r', expiresAt: ts(NOW - 1)}],
    ['state/edge', {read: true, readAt: 'r', expiresAt: ts(NOW)}],
  ]);
  const {transaction, writes} = fakeTransaction(store);
  const done = await markNotificationBatch(
    transaction,
    ['missing', 'noexp', 'expired', 'ok', 'stale', 'edge'].map(target),
    'dismissed',
    NOW,
    STAMP,
  );
  assert.deepEqual(done, ['ok']);
  assert.deepEqual(writes.map((write) => write.ref), ['state/ok']);
});
