import assert from 'node:assert/strict';
import test, {afterEach} from 'node:test';
import {createElement} from 'react';
import TestRenderer, {type ReactTestRenderer} from 'react-test-renderer';
import {QueryClient, QueryClientProvider, focusManager} from '@tanstack/react-query';

import {
  NOTIFICATIONS_STALE_TIME_MS,
  useNotificationActions,
  useNotificationFeed,
  useNotificationUnreadCount,
  type NotificationActions,
  type NotificationApi,
  type NotificationDeleteResult,
  type NotificationFeed,
  type NotificationUnreadCount,
} from '../../src/modules/notifications/feed.ts';
import {
  NOTIFICATIONS_PAGE_SIZE,
  buildNotificationPage,
  notificationKeys,
  type RawNotificationDoc,
} from '../../src/modules/notifications/model.ts';
import type {
  NotificationCursor,
  NotificationScope,
  NotificationUserState,
} from '../../src/modules/notifications/types.ts';

/**
 * P5-D1 (PR-NOTIF-01) — núcleo dos hooks do painel com React Query real
 * (React 18 + react-test-renderer, sem DOM) e uma API em memória que imita o
 * Firestore: eventos por workspace ordenados por (createdAt, ID) decrescentes
 * com cursor `startAfter`, e estado privado por (workspace, uid, notificação).
 */

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

const A1: NotificationScope = Object.freeze({workspaceId: 'ws-a', uid: 'u1'});
const A2: NotificationScope = Object.freeze({workspaceId: 'ws-a', uid: 'u2'});
const B1: NotificationScope = Object.freeze({workspaceId: 'ws-b', uid: 'u1'});

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}
const deferred = (): Deferred => {
  let resolve = () => {};
  const promise = new Promise<void>((done) => { resolve = done; });
  return {promise, resolve};
};

/** Timestamp do SDK web, só com o que o cliente usa. */
const ts = (ms: number) => ({toMillis: () => ms});
const FAR_FUTURE = Date.now() + 180 * 86_400_000;

const event = (ws: string, id: string, createdAt: string, expiresAtMs: number = FAR_FUTURE): RawNotificationDoc => ({
  id,
  data: {workspaceId: ws, title: `Aviso ${id}`, message: `Mensagem ${id}`, type: 'credit_card', createdAt, link: 'cards', expiresAt: ts(expiresAtMs)},
});

const compare = (a: RawNotificationDoc, b: RawNotificationDoc): number => {
  const ca = String(a.data.createdAt);
  const cb = String(b.data.createdAt);
  if (ca !== cb) return ca < cb ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
};

const isAfter = (entry: RawNotificationDoc, cursor: NotificationCursor): boolean => {
  const createdAt = String(entry.data.createdAt);
  return createdAt < cursor.createdAt || (createdAt === cursor.createdAt && entry.id < cursor.id);
};

const createBackend = () => {
  const events = new Map<string, RawNotificationDoc[]>();
  const states = new Map<string, NotificationUserState>();
  const stateKey = (scope: NotificationScope, id: string) => `${scope.workspaceId}|${scope.uid}|${id}`;
  const calls = {
    listPage: [] as Array<{scope: NotificationScope; cursor: NotificationCursor | null}>,
    markAsRead: [] as Array<{scope: NotificationScope; ids: string[]}>,
    dismiss: [] as Array<{scope: NotificationScope; id: string}>,
    deleteForMe: [] as Array<{scope: NotificationScope; id: string}>,
    getUnreadCount: [] as NotificationScope[],
  };
  const control = {
    listError: null as unknown,
    // Leitura já feita, resposta retida: simula a página lida antes de uma
    // gravação e entregue depois dela (resposta antiga).
    listGate: null as Deferred | null,
    markError: null as unknown,
    markGate: null as Deferred | null,
    deleteGate: null as Deferred | null,
    deleteError: null as unknown,
    deleteSkip: false,
    countError: null as unknown,
    countGate: null as Deferred | null,
    writes: 0,
  };

  const setMark = (scope: NotificationScope, id: string, patch: Partial<NotificationUserState>) => {
    const current = states.get(stateKey(scope, id)) ?? {read: false, dismissed: false, deleted: false};
    const next = {...current, ...patch};
    if (next.read !== current.read || next.dismissed !== current.dismissed || next.deleted !== current.deleted) control.writes += 1;
    states.set(stateKey(scope, id), next);
  };

  /** Total exato do "servidor": eventos vigentes do workspace sem marca do usuário. */
  const serverUnread = (scope: NotificationScope): number =>
    (events.get(scope.workspaceId) ?? []).filter((entry) => {
      const state = states.get(stateKey(scope, entry.id));
      const expiresAt = (entry.data.expiresAt as {toMillis: () => number}).toMillis();
      return expiresAt > Date.now() && !(state?.read || state?.dismissed || state?.deleted);
    }).length;

  const api: NotificationApi = {
    getUnreadCount: async (scope) => {
      calls.getUnreadCount.push(scope);
      if (control.countGate) await control.countGate.promise;
      if (control.countError) throw control.countError;
      return serverUnread(scope);
    },
    listPage: async (scope, cursor) => {
      calls.listPage.push({scope, cursor});
      if (control.listError) throw control.listError;
      const ordered = [...(events.get(scope.workspaceId) ?? [])].sort(compare);
      const after = cursor ? ordered.filter((entry) => isAfter(entry, cursor)) : ordered;
      const docs = after.slice(0, NOTIFICATIONS_PAGE_SIZE + 1);
      const pageStates = new Map<string, NotificationUserState>();
      for (const entry of docs.slice(0, NOTIFICATIONS_PAGE_SIZE)) {
        const state = states.get(stateKey(scope, entry.id));
        if (state) pageStates.set(entry.id, state);
      }
      const page = buildNotificationPage(docs, pageStates, NOTIFICATIONS_PAGE_SIZE);
      if (control.listGate) await control.listGate.promise;
      return page;
    },
    markAsRead: async (scope, ids) => {
      calls.markAsRead.push({scope, ids: [...ids]});
      if (control.markGate) await control.markGate.promise;
      if (control.markError) throw control.markError;
      for (const id of ids) setMark(scope, id, {read: true});
      return [...ids];
    },
    dismiss: async (scope, id) => {
      calls.dismiss.push({scope, id});
      setMark(scope, id, {dismissed: true});
      return [id];
    },
    deleteForMe: async (scope, id) => {
      calls.deleteForMe.push({scope, id});
      if (control.deleteGate) await control.deleteGate.promise;
      if (control.deleteError) throw control.deleteError;
      // Evento expirado ou ausente: a transação não grava nada.
      if (control.deleteSkip) return [];
      setMark(scope, id, {deleted: true});
      return [id];
    },
  };

  return {
    api,
    calls,
    control,
    add: (ws: string, list: RawNotificationDoc[]) => events.set(ws, [...(events.get(ws) ?? []), ...list]),
    serverUnread,
    state: (scope: NotificationScope, id: string) => states.get(stateKey(scope, id)),
    sharedEvent: (ws: string, id: string) => events.get(ws)?.find((entry) => entry.id === id),
  };
};

type Backend = ReturnType<typeof createBackend>;

/*
 * Harness ainda montado ao fim de um teste (asserção falhou antes do
 * `unmount`): desmonta aqui, para que temporizadores do React Query e do
 * relógio de expiração não mantenham o processo vivo depois de uma falha.
 */
const mountedHarnesses = new Set<() => Promise<void>>();
afterEach(async () => {
  for (const unmount of [...mountedHarnesses]) await unmount();
});

const createHarness = (backend: Backend) => {
  // Mesmos padrões do aplicativo (`src/App.tsx`); gc infinito só para não
  // deixar temporizadores vivos no fim do teste.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {staleTime: 5 * 60_000, refetchOnWindowFocus: false, gcTime: Infinity, retryDelay: 0},
      mutations: {gcTime: Infinity},
    },
  });
  let feed: NotificationFeed | null = null;
  let actions: NotificationActions | null = null;
  let count: NotificationUnreadCount | null = null;
  let renderer: ReactTestRenderer | null = null;

  const Probe = ({scope}: {scope: NotificationScope | null}) => {
    feed = useNotificationFeed(scope, backend.api);
    actions = useNotificationActions(scope, backend.api);
    count = useNotificationUnreadCount(scope, backend.api);
    return null;
  };

  const unmountSelf = async () => {
    mountedHarnesses.delete(unmountSelf);
    await TestRenderer.act(async () => { renderer?.unmount(); });
    renderer = null;
    queryClient.clear();
  };

  const settle = async () => {
    for (let round = 0; round < 8; round += 1) {
      await TestRenderer.act(async () => {
        await new Promise((done) => setTimeout(done, 0));
      });
    }
  };

  return {
    queryClient,
    render: async (scope: NotificationScope | null) => {
      const element = createElement(QueryClientProvider, {client: queryClient}, createElement(Probe, {scope}));
      await TestRenderer.act(async () => {
        if (renderer) renderer.update(element);
        else renderer = TestRenderer.create(element);
      });
      mountedHarnesses.add(unmountSelf);
      await settle();
    },
    act: async (run: () => void) => {
      await TestRenderer.act(async () => { run(); });
      await settle();
    },
    settle,
    get feed(): NotificationFeed {
      assert.ok(feed);
      return feed;
    },
    get actions(): NotificationActions {
      assert.ok(actions);
      return actions;
    },
    get count(): NotificationUnreadCount {
      assert.ok(count);
      return count;
    },
    /** Não lidas entre as notificações carregadas (não é o total do workspace). */
    unreadLoaded: () => {
      assert.ok(feed);
      return feed.visible.filter((entry) => !entry.read).length;
    },
    ids: () => {
      assert.ok(feed);
      return feed.visible.map((entry) => entry.id);
    },
    unmount: unmountSelf,
  };
};

const seedThree = (backend: Backend, ws = 'ws-a') => backend.add(ws, [
  event(ws, 'n1', '2026-10-08T10:00:00.000Z'),
  event(ws, 'n2', '2026-10-08T11:00:00.000Z'),
  event(ws, 'n3', '2026-10-08T12:00:00.000Z'),
]);

test('carrega a primeira página do escopo, com cache por workspace e uid', async () => {
  const backend = createBackend();
  seedThree(backend);
  const harness = createHarness(backend);
  await harness.render(null);
  assert.equal(harness.feed.status, 'loading', 'sem escopo, nada é lido');
  assert.equal(backend.calls.listPage.length, 0);

  await harness.render(A1);
  assert.equal(harness.feed.status, 'ready');
  assert.deepEqual(harness.ids(), ['n3', 'n2', 'n1']);
  assert.equal(backend.calls.listPage.length, 1);
  assert.deepEqual(backend.calls.listPage[0], {scope: A1, cursor: null});
  assert.ok(harness.queryClient.getQueryData(notificationKeys.scope(A1)));
  assert.deepEqual(harness.count.state, {status: 'ready', count: 3});
  assert.equal(harness.count.summary.bellLabel, 'Notificações, 3 não lidas');
  await harness.unmount();
});

test('dois usuários do mesmo workspace têm estados independentes', async () => {
  const backend = createBackend();
  seedThree(backend);
  const harness = createHarness(backend);
  await harness.render(A1);
  await harness.act(() => harness.actions.markAsRead(['n3']));
  assert.equal(harness.feed.visible.find((entry) => entry.id === 'n3')?.read, true);
  await harness.act(() => harness.actions.dismiss('n2'));
  assert.deepEqual(harness.ids(), ['n3', 'n1'], 'arquivada some só para quem arquivou');

  await harness.render(A2);
  assert.deepEqual(harness.ids(), ['n3', 'n2', 'n1'], 'o outro usuário vê tudo');
  assert.ok(harness.feed.visible.every((entry) => !entry.read), 'e nada lido');
  assert.equal(backend.state(A2, 'n3'), undefined);
  assert.equal(backend.sharedEvent('ws-a', 'n2')?.data.dismissed, undefined, 'evento compartilhado intacto');
  assert.equal(backend.sharedEvent('ws-a', 'n3')?.data.read, undefined);
  await harness.unmount();
});

test('dois workspaces do mesmo usuário são independentes', async () => {
  const backend = createBackend();
  seedThree(backend, 'ws-a');
  backend.add('ws-b', [event('ws-b', 'b1', '2026-10-08T09:00:00.000Z')]);
  const harness = createHarness(backend);
  await harness.render(A1);
  await harness.act(() => harness.actions.markAsRead(['n1', 'n2', 'n3']));
  await harness.render(B1);
  assert.deepEqual(harness.ids(), ['b1']);
  assert.equal(harness.unreadLoaded(), 1);
  await harness.render(A1);
  assert.equal(harness.unreadLoaded(), 0, 'A continua lida, sem reler');
  assert.deepEqual(backend.calls.listPage.map((call) => call.scope.workspaceId), ['ws-a', 'ws-b']);
  await harness.unmount();
});

test('marcar de novo é inofensivo: nenhuma escrita a mais, estado igual', async () => {
  const backend = createBackend();
  seedThree(backend);
  const harness = createHarness(backend);
  await harness.render(A1);
  await harness.act(() => harness.actions.markAsRead(['n1']));
  await harness.act(() => harness.actions.markAsRead(['n1']));
  assert.equal(backend.control.writes, 1);
  assert.deepEqual(backend.state(A1, 'n1'), {read: true, dismissed: false, deleted: false});
  assert.equal(harness.actions.actionError, null);
  assert.equal(harness.unreadLoaded(), 2);
  await harness.unmount();
});

test('arquivar persiste: some na releitura e o evento continua para os outros', async () => {
  const backend = createBackend();
  seedThree(backend);
  const first = createHarness(backend);
  await first.render(A1);
  await first.act(() => first.actions.dismiss('n3'));
  assert.deepEqual(first.ids(), ['n2', 'n1']);
  await first.unmount();

  // Nova sessão (recarga, logout/login): cache vazio, relê do "servidor".
  const second = createHarness(backend);
  await second.render(A1);
  assert.deepEqual(second.ids(), ['n2', 'n1']);
  await second.render(A2);
  assert.deepEqual(second.ids(), ['n3', 'n2', 'n1']);
  await second.unmount();
});

test('troca de workspace durante a marcação: só o escopo da ação muda', async () => {
  const backend = createBackend();
  seedThree(backend, 'ws-a');
  seedThree(backend, 'ws-b');
  const harness = createHarness(backend);
  await harness.render(A1);
  backend.control.markGate = deferred();
  await harness.act(() => harness.actions.markAsRead(['n1', 'n2', 'n3']));
  assert.equal(harness.actions.isMarking, true);

  await harness.render(B1);
  assert.equal(harness.actions.isMarking, false, 'B não mostra a ação pendente de A');
  backend.control.markGate.resolve();
  await harness.settle();

  assert.deepEqual(backend.calls.markAsRead.map((call) => call.scope), [A1], 'gravou só em A');
  assert.equal(harness.unreadLoaded(), 3, 'B continua sem nada lido');
  assert.equal(backend.state(B1, 'n1'), undefined);
  await harness.render(A1);
  assert.equal(harness.unreadLoaded(), 0, 'A recebeu o estado confirmado');
  await harness.unmount();
});

test('erro de marcação em outro workspace não aparece no atual; no próprio, aparece', async () => {
  const backend = createBackend();
  seedThree(backend, 'ws-a');
  seedThree(backend, 'ws-b');
  const harness = createHarness(backend);
  await harness.render(A1);
  backend.control.markGate = deferred();
  backend.control.markError = {code: 'permission-denied'};
  await harness.act(() => harness.actions.markAsRead(['n1']));
  await harness.render(B1);
  backend.control.markGate.resolve();
  await harness.settle();
  assert.equal(harness.actions.actionError, null, 'erro de A não aparece em B');
  await harness.render(A1);
  assert.equal(harness.actions.actionError, 'Você não tem permissão para atualizar notificações neste espaço.');
  assert.ok(harness.feed.visible.every((entry) => !entry.read), 'nada marcado em silêncio');
  await harness.unmount();
});

test('falha de permissão na leitura é erro, não lista vazia, e não é repetida', async () => {
  const backend = createBackend();
  seedThree(backend);
  backend.control.listError = {code: 'permission-denied', message: 'Missing or insufficient permissions.'};
  const harness = createHarness(backend);
  await harness.render(A1);
  assert.equal(harness.feed.status, 'error');
  assert.equal(harness.feed.loadError, 'Você não tem acesso às notificações deste espaço.');
  assert.equal(backend.calls.listPage.length, 1, 'sem novas tentativas automáticas');
  assert.equal(harness.feed.visible.length, 0);

  backend.control.listError = null;
  await harness.act(() => harness.feed.retry());
  assert.equal(harness.feed.status, 'ready');
  assert.deepEqual(harness.ids(), ['n3', 'n2', 'n1']);
  await harness.unmount();
});

test('mais de 50 notificações: páginas de 25, carregar mais e contagem exata do servidor', async () => {
  const backend = createBackend();
  backend.add('ws-a', Array.from({length: 60}, (_, index) =>
    event('ws-a', `n${String(index).padStart(2, '0')}`, `2026-10-0${1 + (index % 7)}T08:00:00.000Z`)));
  const harness = createHarness(backend);
  await harness.render(A1);
  assert.equal(harness.feed.visible.length, 25);
  assert.equal(harness.feed.hasMore, true);
  // A contagem é o total exato do servidor, não o que foi carregado.
  assert.deepEqual(harness.count.state, {status: 'ready', count: 60});
  assert.equal(harness.count.summary.badge, '9+');
  assert.equal(harness.count.summary.bellLabel, 'Notificações, 60 não lidas');

  await harness.act(() => harness.feed.loadMore());
  assert.equal(harness.feed.visible.length, 50);
  assert.equal(harness.feed.hasMore, true);
  await harness.act(() => harness.feed.loadMore());
  assert.equal(harness.feed.visible.length, 60);
  assert.equal(harness.feed.hasMore, false);
  assert.equal(harness.count.summary.bellLabel, 'Notificações, 60 não lidas', 'mesmo total com tudo carregado');
  assert.equal(new Set(harness.ids()).size, 60, 'nenhum item repetido entre páginas');
  assert.equal(backend.calls.listPage.length, 3);
  assert.equal(backend.calls.listPage[0].cursor, null);
  assert.ok(backend.calls.listPage.slice(1).every((call) => call.cursor !== null));

  // Fechar o painel volta à primeira página.
  await harness.act(() => harness.feed.collapse());
  assert.equal(harness.feed.visible.length, 25);
  assert.equal(harness.feed.hasMore, true);
  await harness.unmount();
});

test('três notificações no mesmo instante paginam sem repetir nem perder', async () => {
  const backend = createBackend();
  const same = '2026-10-08T12:00:00.000Z';
  backend.add('ws-a', [
    ...Array.from({length: 24}, (_, index) => event('ws-a', `z${String(index).padStart(2, '0')}`, '2026-10-09T00:00:00.000Z')),
    event('ws-a', 'tie-a', same), event('ws-a', 'tie-b', same), event('ws-a', 'tie-c', same),
  ]);
  const harness = createHarness(backend);
  await harness.render(A1);
  assert.equal(harness.ids()[24], 'tie-c', 'o empate é cortado no meio da página');
  await harness.act(() => harness.feed.loadMore());
  assert.deepEqual(harness.ids().slice(24), ['tie-c', 'tie-b', 'tie-a']);
  assert.equal(new Set(harness.ids()).size, 27);
  await harness.unmount();
});

test('sem polling: nenhuma releitura sozinha e nenhum intervalo configurado', async () => {
  const backend = createBackend();
  seedThree(backend);
  const harness = createHarness(backend);
  const observed: Array<{refetchInterval?: unknown; staleTime?: unknown}> = [];
  const stop = harness.queryClient.getQueryCache().subscribe((cacheEvent) => {
    if (cacheEvent.type === 'observerAdded') observed.push(cacheEvent.observer.options);
  });
  await harness.render(A1);
  stop();
  assert.ok(observed.length > 0);
  for (const options of observed) {
    assert.ok(!options.refetchInterval, 'sem refetchInterval');
    assert.equal(options.staleTime, NOTIFICATIONS_STALE_TIME_MS);
  }
  await new Promise((done) => setTimeout(done, 120));
  await harness.settle();
  assert.equal(backend.calls.listPage.length, 1);

  // Abrir o painel com dado novo não relê; com dado vencido, relê uma vez.
  await harness.act(() => harness.feed.refreshIfStale());
  assert.equal(backend.calls.listPage.length, 1);
  await harness.act(() => { void harness.queryClient.invalidateQueries({queryKey: notificationKeys.scope(A1), refetchType: 'none'}); });
  await harness.render(A1);
  await harness.act(() => harness.feed.refreshIfStale());
  assert.equal(backend.calls.listPage.length, 2);
  await harness.unmount();
});

test('ação confirmada não relê a coleção; falha relê só o escopo da ação', async () => {
  const backend = createBackend();
  seedThree(backend);
  const harness = createHarness(backend);
  await harness.render(A1);
  await harness.act(() => harness.actions.markAsRead(['n1']));
  await harness.act(() => harness.actions.dismiss('n2'));
  assert.equal(backend.calls.listPage.length, 1, 'estado confirmado aplicado no cache');
  backend.control.markError = {code: 'unavailable'};
  await harness.act(() => harness.actions.markAsRead(['n3']));
  assert.equal(harness.actions.actionError, 'Sem conexão com o servidor. Verifique sua internet e tente novamente.');
  assert.equal(backend.calls.listPage.length, 2);
  assert.deepEqual(backend.calls.listPage[1].scope, A1);
  await harness.unmount();
});

test('excluir para mim: some só para quem excluiu, persiste e o evento continua para os outros', async () => {
  const backend = createBackend();
  seedThree(backend);
  const first = createHarness(backend);
  await first.render(A1);
  let deleted: NotificationDeleteResult | null = null;
  await first.act(() => { void first.actions.deleteForMe('n2').then((ok) => { deleted = ok; }); });
  assert.equal(deleted, 'deleted');
  assert.deepEqual(first.ids(), ['n3', 'n1']);
  assert.equal(first.actions.deleteError, null);
  assert.equal(first.actions.isDeleting, false);
  assert.equal(backend.sharedEvent('ws-a', 'n2')?.data.deleted, undefined, 'evento compartilhado intacto');
  assert.equal(backend.calls.listPage.length, 1, 'estado confirmado aplicado no cache, sem reler');
  await first.unmount();

  const second = createHarness(backend);
  await second.render(A1);
  assert.deepEqual(second.ids(), ['n3', 'n1'], 'continua excluída após recarregar');
  await second.render(A2);
  assert.deepEqual(second.ids(), ['n3', 'n2', 'n1'], 'o outro membro ainda vê');
  await second.unmount();
});

test('excluir depois de ler ou arquivar: some e não conta como não lida', async () => {
  const backend = createBackend();
  seedThree(backend);
  const harness = createHarness(backend);
  await harness.render(A1);
  await harness.act(() => harness.actions.markAsRead(['n1']));
  await harness.act(() => { void harness.actions.deleteForMe('n1'); });
  await harness.act(() => harness.actions.dismiss('n2'));
  await harness.act(() => { void harness.actions.deleteForMe('n2'); });
  assert.deepEqual(harness.ids(), ['n3']);
  assert.equal(harness.unreadLoaded(), 1);
  assert.deepEqual(backend.state(A1, 'n1'), {read: true, dismissed: false, deleted: true});
  assert.deepEqual(backend.state(A1, 'n2'), {read: false, dismissed: true, deleted: true});
  await harness.unmount();
});

test('exclusão com erro de permissão: sem falso sucesso, patch não aplicado, tentar de novo funciona', async () => {
  const backend = createBackend();
  seedThree(backend);
  const harness = createHarness(backend);
  await harness.render(A1);
  backend.control.deleteError = {code: 'permission-denied'};
  let deleted: NotificationDeleteResult | null = null;
  await harness.act(() => { void harness.actions.deleteForMe('n2').then((ok) => { deleted = ok; }); });
  assert.equal(deleted, 'failed');
  assert.equal(harness.actions.deleteError, 'Você não tem permissão para excluir esta notificação.');
  assert.equal(harness.actions.actionError, null, 'erro próprio, separado de marcar/arquivar');
  assert.ok(harness.ids().includes('n2'), 'o item só some depois do sucesso');
  assert.equal(backend.state(A1, 'n2'), undefined);

  backend.control.deleteError = null;
  await harness.act(() => { void harness.actions.deleteForMe('n2').then((ok) => { deleted = ok; }); });
  assert.equal(deleted, 'deleted');
  assert.equal(harness.actions.deleteError, null, 'nova tentativa limpa o erro');
  assert.deepEqual(harness.ids(), ['n3', 'n1']);

  backend.control.deleteError = {code: 'unavailable'};
  await harness.act(() => { void harness.actions.deleteForMe('n3'); });
  assert.equal(harness.actions.deleteError, 'Sem conexão com o servidor. Verifique sua internet e tente novamente.');
  await harness.act(() => harness.actions.resetDeleteError());
  assert.equal(harness.actions.deleteError, null, 'cancelar a confirmação descarta o erro');
  await harness.unmount();
});

test('troca de escopo durante a exclusão: sem vazar cache nem erro, ação presa ao escopo do clique', async () => {
  const backend = createBackend();
  seedThree(backend, 'ws-a');
  seedThree(backend, 'ws-b');
  const harness = createHarness(backend);
  await harness.render(A1);
  backend.control.deleteGate = deferred();
  await harness.act(() => { void harness.actions.deleteForMe('n1'); });
  assert.equal(harness.actions.isDeleting, true);

  await harness.render(B1);
  assert.equal(harness.actions.isDeleting, false, 'B não mostra a exclusão pendente de A');
  backend.control.deleteGate.resolve();
  await harness.settle();
  assert.deepEqual(backend.calls.deleteForMe.map((call) => call.scope), [A1], 'gravou só em A');
  assert.deepEqual(harness.ids(), ['n3', 'n2', 'n1'], 'B não perdeu o n1');
  assert.equal(backend.state(B1, 'n1'), undefined);
  await harness.render(A1);
  assert.deepEqual(harness.ids(), ['n3', 'n2'], 'A recebeu o estado confirmado');

  // Erro de A nunca aparece em B.
  backend.control.deleteGate = deferred();
  backend.control.deleteError = {code: 'permission-denied'};
  await harness.act(() => { void harness.actions.deleteForMe('n2'); });
  await harness.render(B1);
  backend.control.deleteGate.resolve();
  await harness.settle();
  assert.equal(harness.actions.deleteError, null, 'erro de A não aparece em B');
  assert.ok(harness.ids().includes('n2'));
  await harness.render(A1);
  assert.equal(harness.actions.deleteError, 'Você não tem permissão para excluir esta notificação.');
  await harness.unmount();
});

test('exclusão sem gravação (evento expirado ou ausente): resultado próprio, sem falso sucesso nem patch', async () => {
  const backend = createBackend();
  seedThree(backend);
  const harness = createHarness(backend);
  await harness.render(A1);
  backend.control.deleteSkip = true;
  let result: NotificationDeleteResult | null = null;
  await harness.act(() => { void harness.actions.deleteForMe('n2').then((value) => { result = value; }); });
  assert.equal(result, 'expired');
  assert.equal(harness.actions.deleteError, null, 'não é erro de servidor');
  assert.equal(backend.state(A1, 'n2'), undefined, 'nada gravado');
  assert.ok(harness.ids().includes('n2'), 'sem patch local de excluída');
  await harness.unmount();
});

test('sem escopo, excluir não faz nada', async () => {
  const backend = createBackend();
  seedThree(backend);
  const harness = createHarness(backend);
  await harness.render(null);
  let result: NotificationDeleteResult | null = null;
  await harness.act(() => { void harness.actions.deleteForMe('n1').then((ok) => { result = ok; }); });
  assert.equal(result, 'failed');
  assert.equal(backend.calls.deleteForMe.length, 0);
  await harness.unmount();
});

test('expiração: o item some sozinho por relógio local, sem reler o Firestore', async () => {
  const backend = createBackend();
  backend.add('ws-a', [
    event('ws-a', 'n1', '2026-10-08T10:00:00.000Z', Date.now() + 120),
    event('ws-a', 'n2', '2026-10-08T11:00:00.000Z', Date.now() + 100_000),
    event('ws-a', 'old', '2026-10-08T09:00:00.000Z', Date.now() - 1),
  ]);
  const harness = createHarness(backend);
  await harness.render(A1);
  assert.deepEqual(harness.ids(), ['n2', 'n1'], 'já expirada nunca aparece');
  assert.equal(harness.unreadLoaded(), 2);
  await TestRenderer.act(async () => { await new Promise((done) => setTimeout(done, 220)); });
  await harness.settle();
  assert.deepEqual(harness.ids(), ['n2'], 'n1 expirou no relógio local');
  assert.equal(harness.unreadLoaded(), 1);
  assert.equal(backend.calls.listPage.length, 1, 'sem polling');
  // A expiração real relê o total exato (o sino acompanha a lista).
  assert.equal(countCalls(backend, A1), 2, 'expiração real relê o total exato');
  assert.equal(harness.count.summary.bellLabel, 'Notificações, 1 não lida');
  await harness.unmount();
});

test('disparo antecipado do temporizador (teto do setTimeout ou relógio ajustado) arma o próximo', async () => {
  const backend = createBackend();
  backend.add('ws-a', [event('ws-a', 'a1', '2026-10-08T10:00:00.000Z', Date.now() + 4_000)]);
  const harness = createHarness(backend);
  const original = globalThis.setTimeout;
  const expiryHandlers: Array<() => void> = [];
  globalThis.setTimeout = ((handler: () => void, delay?: number, ...rest: unknown[]) => {
    // Captura só o temporizador de expiração (~4 s); os demais seguem normais.
    if (typeof delay === 'number' && delay > 2_000 && delay <= 4_000) {
      expiryHandlers.push(handler);
      return original(() => undefined, 0);
    }
    return original(handler, delay, ...rest);
  }) as typeof setTimeout;
  try {
    await harness.render(A1);
    assert.deepEqual(harness.ids(), ['a1']);
    assert.equal(expiryHandlers.length, 1, 'um temporizador armado');
    // Dispara antes da hora: nada expira, mas o próximo temporizador é armado.
    await harness.act(() => expiryHandlers[0]());
    assert.deepEqual(harness.ids(), ['a1'], 'ainda vigente');
    assert.equal(expiryHandlers.length, 2, 'rearmado depois do disparo antecipado');
    assert.equal(countCalls(backend, A1), 1, 'disparo antecipado não relê o total');
  } finally {
    globalThis.setTimeout = original;
  }
  await harness.unmount();
});

test('troca de escopo cancela o temporizador de expiração do escopo anterior', async () => {
  const backend = createBackend();
  backend.add('ws-a', [event('ws-a', 'a1', '2026-10-08T10:00:00.000Z', Date.now() + 5_000)]);
  backend.add('ws-b', [event('ws-b', 'b1', '2026-10-08T10:00:00.000Z', Date.now() + 100_000)]);
  const harness = createHarness(backend);
  const original = globalThis.setTimeout;
  const expiryTimers: unknown[] = [];
  const cleared: unknown[] = [];
  const originalClear = globalThis.clearTimeout;
  globalThis.setTimeout = ((handler: () => void, delay?: number, ...rest: unknown[]) => {
    const handle = original(handler, delay, ...rest);
    // Só o temporizador de expiração de A (~5 s); o de B é ~100 s.
    if (typeof delay === 'number' && delay > 3_000 && delay <= 5_000) expiryTimers.push(handle);
    return handle;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((handle?: unknown) => {
    cleared.push(handle);
    return originalClear(handle as Parameters<typeof clearTimeout>[0]);
  }) as typeof clearTimeout;
  try {
    await harness.render(A1);
    assert.deepEqual(harness.ids(), ['a1']);
    await harness.render(B1);
    assert.deepEqual(harness.ids(), ['b1']);
    assert.equal(expiryTimers.length, 1, 'um temporizador de expiração para A');
    assert.ok(cleared.includes(expiryTimers[0]), 'o temporizador de A foi limpo na troca de escopo');
  } finally {
    globalThis.setTimeout = original;
    globalThis.clearTimeout = originalClear;
  }
  await harness.unmount();
});

test('página com poucos visíveis e cursor continua com "carregar mais"', async () => {
  const backend = createBackend();
  const old = Date.now() - 1;
  // 25 mais recentes expiradas (ainda no "Firestore") + 5 válidas mais antigas.
  backend.add('ws-a', [
    ...Array.from({length: 25}, (_, index) =>
      event('ws-a', `e${String(index).padStart(2, '0')}`, `2026-10-09T10:${String(index).padStart(2, '0')}:00.000Z`, old)),
    ...Array.from({length: 5}, (_, index) =>
      event('ws-a', `v${index}`, `2026-10-08T10:0${index}:00.000Z`)),
  ]);
  const harness = createHarness(backend);
  await harness.render(A1);
  assert.equal(harness.ids().length, 0);
  assert.equal(harness.feed.hasMore, true, 'cursor no último bruto: não é fim de histórico');
  await harness.act(() => harness.feed.loadMore());
  assert.equal(harness.ids().length, 5);
  assert.equal(harness.feed.hasMore, false);
  await harness.unmount();
});

/*
 * P5-D2 — contagem exata de não lidas (callable do backend): consulta por
 * escopo, sem polling nem listener, "indisponível" em qualquer falha.
 */

const countCalls = (backend: Backend, scope: NotificationScope): number =>
  backend.calls.getUnreadCount.filter((call) => call.workspaceId === scope.workspaceId && call.uid === scope.uid).length;

test('contagem: carrega (loading → ready) com o total exato do servidor, por escopo', async () => {
  const backend = createBackend();
  seedThree(backend);
  const harness = createHarness(backend);
  await harness.render(null);
  assert.deepEqual(harness.count.state, {status: 'loading'}, 'sem escopo, nada é consultado');
  assert.equal(harness.count.summary.badge, '');
  assert.equal(backend.calls.getUnreadCount.length, 0);

  backend.control.countGate = deferred();
  await harness.render(A1);
  assert.deepEqual(harness.count.state, {status: 'loading'});
  assert.equal(harness.count.summary.chip, '…');
  backend.control.countGate.resolve();
  await harness.settle();
  assert.deepEqual(harness.count.state, {status: 'ready', count: 3});
  assert.deepEqual(backend.calls.getUnreadCount, [A1], 'uma consulta, para o escopo da sessão');
  assert.ok(harness.queryClient.getQueryData(notificationKeys.unreadCount(A1)) === 3);
  assert.equal(harness.count.summary.badge, '3');
  assert.equal(harness.count.summary.chipLabel, '3 não lidas');
  await harness.unmount();
});

test('contagem: erro vira indisponível ("?"), nunca zero, e volta ao tentar de novo', async () => {
  const backend = createBackend();
  seedThree(backend);
  backend.control.countError = {code: 'functions/internal'};
  const harness = createHarness(backend);
  await harness.render(A1);
  assert.deepEqual(harness.count.state, {status: 'unavailable'});
  assert.equal(harness.count.summary.badge, '?');
  assert.equal(harness.count.summary.chip, '?');
  assert.equal(harness.count.summary.bellLabel, 'Notificações, total de não lidas indisponível');
  assert.notEqual(harness.count.summary.badge, '');
  assert.notEqual(harness.count.summary.chip, '0');
  assert.equal(countCalls(backend, A1), 2, 'uma nova tentativa, no máximo');
  assert.equal(harness.feed.status, 'ready', 'o feed segue funcionando');

  backend.control.countError = null;
  await harness.act(() => harness.count.refreshIfStale());
  assert.deepEqual(harness.count.state, {status: 'ready', count: 3}, 'abrir o painel tenta de novo');
  await harness.unmount();
});

test('contagem: resposta fora do contrato (erro do módulo puro) é indisponível', async () => {
  const backend = createBackend();
  seedThree(backend);
  backend.control.countError = Object.assign(new Error('fora do contrato'), {code: 'invalid-response'});
  const harness = createHarness(backend);
  await harness.render(A1);
  assert.deepEqual(harness.count.state, {status: 'unavailable'});
  await harness.unmount();
});

test('contagem: sem nova tentativa para permissão, sessão, limite de frequência e pré-condição', async () => {
  for (const code of ['permission-denied', 'unauthenticated', 'resource-exhausted', 'failed-precondition']) {
    for (const prefix of ['', 'functions/']) {
      const backend = createBackend();
      seedThree(backend);
      backend.control.countError = {code: `${prefix}${code}`};
      const harness = createHarness(backend);
      await harness.render(A1);
      assert.deepEqual(harness.count.state, {status: 'unavailable'}, code);
      assert.equal(countCalls(backend, A1), 1, `${prefix}${code}: sem nova tentativa`);
      await harness.unmount();
    }
  }
});

test('contagem: a última tentativa falhou, então o número antigo não é mostrado como atual', async () => {
  const backend = createBackend();
  seedThree(backend);
  const harness = createHarness(backend);
  await harness.render(A1);
  assert.deepEqual(harness.count.state, {status: 'ready', count: 3});

  backend.control.countError = {code: 'unavailable'};
  await harness.act(() => { void harness.queryClient.invalidateQueries({queryKey: notificationKeys.unreadCount(A1)}); });
  assert.equal(harness.queryClient.getQueryData(notificationKeys.unreadCount(A1)), 3, 'o cache ainda guarda o antigo');
  assert.deepEqual(harness.count.state, {status: 'unavailable'});
  assert.equal(harness.count.summary.badge, '?');
  await harness.unmount();
});

test('contagem: enquanto relê, mantém o valor anterior do mesmo escopo', async () => {
  const backend = createBackend();
  seedThree(backend);
  const harness = createHarness(backend);
  await harness.render(A1);
  backend.control.countGate = deferred();
  await harness.act(() => { void harness.queryClient.invalidateQueries({queryKey: notificationKeys.unreadCount(A1)}); });
  assert.deepEqual(harness.count.state, {status: 'ready', count: 3}, 'valor anterior durante a releitura');
  backend.control.countGate.resolve();
  await harness.settle();
  assert.deepEqual(harness.count.state, {status: 'ready', count: 3});
  await harness.unmount();
});

test('contagem: troca de escopo nunca mostra o número do outro workspace ou conta', async () => {
  const backend = createBackend();
  seedThree(backend, 'ws-a');
  backend.add('ws-b', [event('ws-b', 'b1', '2026-10-08T09:00:00.000Z')]);
  const harness = createHarness(backend);
  await harness.render(A1);
  assert.deepEqual(harness.count.state, {status: 'ready', count: 3});

  backend.control.countGate = deferred();
  await harness.render(B1);
  assert.deepEqual(harness.count.state, {status: 'loading'}, 'B não herda os 3 de A');
  backend.control.countGate.resolve();
  await harness.settle();
  assert.deepEqual(harness.count.state, {status: 'ready', count: 1});

  // Outra conta no mesmo workspace: chave própria, também sem herdar.
  backend.control.countGate = deferred();
  await harness.render(A2);
  assert.deepEqual(harness.count.state, {status: 'loading'}, 'A2 não herda o número de A1');
  backend.control.countGate.resolve();
  await harness.settle();
  assert.deepEqual(harness.count.state, {status: 'ready', count: 3});

  // Voltar a A1 reaproveita só o cache de A1 (dentro do prazo, sem reler).
  await harness.render(A1);
  assert.deepEqual(harness.count.state, {status: 'ready', count: 3});
  assert.equal(countCalls(backend, A1), 1);
  assert.deepEqual(backend.calls.getUnreadCount, [A1, B1, A2]);
  await harness.unmount();
});

test('contagem: toda ação do painel, em sucesso ou erro, relê a contagem do escopo da ação', async () => {
  const backend = createBackend();
  seedThree(backend);
  const harness = createHarness(backend);
  await harness.render(A1);
  assert.equal(countCalls(backend, A1), 1);

  await harness.act(() => harness.actions.markAsRead(['n1']));
  assert.equal(countCalls(backend, A1), 2, 'marcar como lida');
  assert.deepEqual(harness.count.state, {status: 'ready', count: 2});
  await harness.act(() => harness.actions.markAsRead(['n2', 'n3']));
  assert.equal(countCalls(backend, A1), 3, 'marcar exibidas como lidas');
  assert.deepEqual(harness.count.state, {status: 'ready', count: 0});
  assert.equal(harness.count.summary.badge, '', 'zero verdadeiro só com a resposta do servidor');

  backend.add('ws-a', [event('ws-a', 'n4', '2026-10-08T13:00:00.000Z'), event('ws-a', 'n5', '2026-10-08T14:00:00.000Z')]);
  await harness.act(() => { void harness.queryClient.invalidateQueries({queryKey: notificationKeys.scope(A1), exact: true}); });
  const before = countCalls(backend, A1);
  await harness.act(() => harness.actions.dismiss('n4'));
  assert.equal(countCalls(backend, A1), before + 1, 'arquivar');
  await harness.act(() => { void harness.actions.deleteForMe('n5'); });
  assert.equal(countCalls(backend, A1), before + 2, 'excluir para mim');
  assert.deepEqual(harness.count.state, {status: 'ready', count: 0});

  // Erro: a contagem é relida do mesmo jeito (o estado real é desconhecido).
  backend.add('ws-a', [event('ws-a', 'n6', '2026-10-08T15:00:00.000Z')]);
  await harness.act(() => { void harness.queryClient.invalidateQueries({queryKey: notificationKeys.scope(A1), exact: true}); });
  backend.control.markError = {code: 'unavailable'};
  const beforeError = countCalls(backend, A1);
  await harness.act(() => harness.actions.markAsRead(['n6']));
  assert.ok(harness.actions.actionError);
  assert.equal(countCalls(backend, A1), beforeError + 1, 'ação com erro também relê');
  await harness.unmount();
});

test('contagem: ação concluída depois da troca de escopo atualiza só a contagem do escopo da ação', async () => {
  const backend = createBackend();
  seedThree(backend, 'ws-a');
  seedThree(backend, 'ws-b');
  const harness = createHarness(backend);
  await harness.render(A1);
  await harness.render(B1);
  await harness.render(A1);
  assert.equal(countCalls(backend, A1), 1);
  assert.equal(countCalls(backend, B1), 1);

  backend.control.markGate = deferred();
  await harness.act(() => harness.actions.markAsRead(['n1', 'n2', 'n3']));
  await harness.render(B1);
  backend.control.markGate.resolve();
  await harness.settle();
  assert.equal(countCalls(backend, B1), 1, 'a ação de A não relê a contagem de B');
  assert.deepEqual(harness.count.state, {status: 'ready', count: 3}, 'B segue com o seu total');
  assert.deepEqual(harness.queryClient.getQueryState(notificationKeys.unreadCount(A1))?.isInvalidated, true, 'A foi invalidada');

  await harness.render(A1);
  assert.equal(countCalls(backend, A1), 2, 'ao voltar, A relê');
  assert.deepEqual(harness.count.state, {status: 'ready', count: 0});

  // Erro da ação de A com B ativo: também só A é invalidada.
  backend.control.markGate = deferred();
  backend.control.markError = {code: 'permission-denied'};
  backend.add('ws-a', [event('ws-a', 'n7', '2026-10-08T16:00:00.000Z')]);
  await harness.act(() => { void harness.queryClient.invalidateQueries({queryKey: notificationKeys.scope(A1), exact: true}); });
  await harness.act(() => harness.actions.markAsRead(['n7']));
  await harness.render(B1);
  const bBefore = countCalls(backend, B1);
  backend.control.markGate.resolve();
  await harness.settle();
  assert.equal(countCalls(backend, B1), bBefore, 'erro de A não relê B');
  assert.equal(harness.queryClient.getQueryState(notificationKeys.unreadCount(A1))?.isInvalidated, true);
  await harness.unmount();
});

test('contagem: primeira página com ID novo invalida a contagem; sem mudança de IDs, não', async () => {
  const backend = createBackend();
  seedThree(backend);
  const harness = createHarness(backend);
  await harness.render(A1);
  assert.equal(countCalls(backend, A1), 1);
  assert.deepEqual(harness.count.state, {status: 'ready', count: 3});

  // Releitura do feed com o mesmo conjunto de IDs: a contagem não é relida.
  await harness.act(() => { void harness.queryClient.invalidateQueries({queryKey: notificationKeys.scope(A1), exact: true}); });
  assert.equal(backend.calls.listPage.length, 2);
  assert.equal(countCalls(backend, A1), 1, 'mesmos IDs: sem nova consulta de contagem');

  // Publicação nova: a releitura traz um ID novo na primeira página.
  backend.add('ws-a', [event('ws-a', 'n4', '2026-10-08T13:00:00.000Z')]);
  await harness.act(() => { void harness.queryClient.invalidateQueries({queryKey: notificationKeys.scope(A1), exact: true}); });
  assert.equal(backend.calls.listPage.length, 3);
  assert.equal(countCalls(backend, A1), 2, 'ID novo: contagem relida');
  assert.deepEqual(harness.count.state, {status: 'ready', count: 4});
  await harness.unmount();
});

test('contagem: trocar de escopo não conta como publicação nova', async () => {
  const backend = createBackend();
  seedThree(backend, 'ws-a');
  backend.add('ws-b', [event('ws-b', 'b1', '2026-10-08T09:00:00.000Z')]);
  const harness = createHarness(backend);
  await harness.render(A1);
  await harness.render(B1);
  await harness.render(A1);
  assert.deepEqual(backend.calls.getUnreadCount, [A1, B1], 'uma consulta por escopo, nenhuma extra pela troca');
  await harness.unmount();
});

test('contagem: abrir o painel relê só se estiver obsoleta; sem polling nem intervalo', async () => {
  const backend = createBackend();
  seedThree(backend);
  const harness = createHarness(backend);
  const observed: Array<{refetchInterval?: unknown; staleTime?: unknown; refetchOnWindowFocus?: unknown}> = [];
  const stop = harness.queryClient.getQueryCache().subscribe((cacheEvent) => {
    if (cacheEvent.type === 'observerAdded' && cacheEvent.query.queryKey.at(-1) === 'unread-count') {
      observed.push(cacheEvent.observer.options);
    }
  });
  await harness.render(A1);
  stop();
  assert.ok(observed.length > 0);
  for (const options of observed) {
    assert.ok(!options.refetchInterval, 'sem refetchInterval');
    assert.equal(options.staleTime, NOTIFICATIONS_STALE_TIME_MS);
    assert.equal(options.refetchOnWindowFocus, true);
  }
  await new Promise((done) => setTimeout(done, 120));
  await harness.settle();
  assert.equal(countCalls(backend, A1), 1, 'nenhuma releitura sozinha');

  await harness.act(() => harness.count.refreshIfStale());
  assert.equal(countCalls(backend, A1), 1, 'dado novo: abrir o painel não relê');
  await harness.act(() => { void harness.queryClient.invalidateQueries({queryKey: notificationKeys.unreadCount(A1), refetchType: 'none'}); });
  await harness.render(A1);
  await harness.act(() => harness.count.refreshIfStale());
  assert.equal(countCalls(backend, A1), 2, 'dado obsoleto: abrir o painel relê');
  await harness.unmount();
});

test('contagem: o foco da aba relê a contagem obsoleta e não a atual', async () => {
  const backend = createBackend();
  seedThree(backend);
  const harness = createHarness(backend);
  await harness.render(A1);
  assert.equal(countCalls(backend, A1), 1);
  await harness.act(() => { focusManager.setFocused(false); focusManager.setFocused(true); });
  assert.equal(countCalls(backend, A1), 1, 'dentro do prazo: sem releitura');
  await harness.act(() => { void harness.queryClient.invalidateQueries({queryKey: notificationKeys.unreadCount(A1), refetchType: 'none'}); });
  await harness.act(() => { focusManager.setFocused(false); focusManager.setFocused(true); });
  assert.equal(countCalls(backend, A1), 2, 'obsoleta: relê ao voltar o foco');
  await harness.act(() => { focusManager.setFocused(undefined); });
  await harness.unmount();
});

/*
 * P5-E1.1 — resposta antiga. Uma leitura do feed (atualização ao abrir, foco,
 * "Tentar novamente", releitura após erro ou "Carregar mais") que leu o estado
 * antes de uma marca confirmada e chega depois dela não pode desligar a marca:
 * lida, arquivada e excluída só ligam (as Rules recusam desligar).
 */

const seedPages = (backend: Backend, total: number, ws = 'ws-a') => backend.add(ws, Array.from({length: total}, (_, index) =>
  event(ws, `p${String(index).padStart(3, '0')}`, new Date(Date.UTC(2026, 9, 8, 10, index)).toISOString())));

test('P5-E1.1 releitura que leu antes do arquivamento não traz o item de volta', async () => {
  const backend = createBackend();
  seedThree(backend);
  const harness = createHarness(backend);
  await harness.render(A1);
  const gate = deferred();
  backend.control.listGate = gate;
  await harness.act(() => harness.feed.retry());
  backend.control.listGate = null;
  assert.equal(backend.calls.listPage.length, 2, 'a releitura já leu o estado (antes do arquivamento)');

  await harness.act(() => harness.actions.dismiss('n2'));
  assert.equal(backend.state(A1, 'n2')?.dismissed, true);
  assert.deepEqual(harness.ids(), ['n3', 'n1'], 'arquivamento confirmado sai da lista');

  await harness.act(() => gate.resolve());
  assert.deepEqual(harness.ids(), ['n3', 'n1'], 'a resposta antiga não restaura o item arquivado');
  await harness.unmount();
});

test('P5-E1.1 "Carregar mais" em curso não desfaz arquivamento confirmado na primeira página', async () => {
  const backend = createBackend();
  seedPages(backend, NOTIFICATIONS_PAGE_SIZE + 3);
  const harness = createHarness(backend);
  await harness.render(A1);
  assert.equal(harness.feed.hasMore, true);
  const first = harness.ids()[0];
  assert.ok(first);

  const gate = deferred();
  backend.control.listGate = gate;
  await harness.act(() => harness.feed.loadMore());
  backend.control.listGate = null;
  await harness.act(() => harness.actions.dismiss(first));
  assert.equal(harness.ids().includes(first), false);

  await harness.act(() => gate.resolve());
  assert.equal(harness.feed.hasMore, false, 'a segunda página chegou');
  assert.equal(harness.ids().includes(first), false, 'a página nova não restaura o item arquivado');
  assert.equal(harness.ids().length, NOTIFICATIONS_PAGE_SIZE + 2);
  await harness.unmount();
});

test('P5-E1.1 leitura antiga não desmarca lida nem desfaz "Excluir para mim"', async () => {
  const backend = createBackend();
  seedThree(backend);
  const harness = createHarness(backend);
  await harness.render(A1);
  const gate = deferred();
  backend.control.listGate = gate;
  await harness.act(() => harness.feed.retry());
  backend.control.listGate = null;

  await harness.act(() => harness.actions.markAsRead(['n3']));
  let deleted: NotificationDeleteResult | null = null;
  await harness.act(() => { void harness.actions.deleteForMe('n1').then((result) => { deleted = result; }); });
  assert.equal(deleted, 'deleted');
  assert.deepEqual(harness.ids(), ['n3', 'n2']);
  assert.equal(harness.unreadLoaded(), 1);

  await harness.act(() => gate.resolve());
  assert.deepEqual(harness.ids(), ['n3', 'n2'], 'excluída para mim continua fora da lista');
  assert.equal(harness.feed.visible.find((entry) => entry.id === 'n3')?.read, true, 'lida continua lida');
  assert.equal(harness.unreadLoaded(), 1);
  await harness.unmount();
});

test('P5-E1.1 dois arquivamentos em sequência com releitura antiga no meio: contagem final certa', async () => {
  const backend = createBackend();
  seedPages(backend, 6);
  const harness = createHarness(backend);
  await harness.render(A1);
  const [a, b] = harness.ids();
  assert.ok(a && b);
  await harness.act(() => harness.actions.dismiss(a));
  const gate = deferred();
  backend.control.listGate = gate;
  await harness.act(() => harness.feed.retry());
  backend.control.listGate = null;
  await harness.act(() => harness.actions.dismiss(b));
  await harness.act(() => gate.resolve());
  assert.deepEqual(harness.ids().filter((id) => id === a || id === b), [], 'nenhum dos dois volta');
  assert.equal(harness.ids().length, 4);
  assert.equal(backend.calls.dismiss.length, 2, 'uma gravação por arquivamento');
  assert.equal(backend.control.writes, 2);
  await harness.unmount();
});

test('P5-E1.1 a fusão só preserva marcas do mesmo escopo e nunca inventa marca', async () => {
  const backend = createBackend();
  seedThree(backend);
  const harness = createHarness(backend);
  await harness.render(A1);
  await harness.act(() => harness.actions.dismiss('n2'));
  await harness.render(A2);
  assert.deepEqual(harness.ids(), ['n3', 'n2', 'n1'], 'o outro usuário não herda a marca');
  await harness.act(() => harness.feed.retry());
  assert.deepEqual(harness.ids(), ['n3', 'n2', 'n1']);
  assert.ok(harness.feed.visible.every((entry) => !entry.read));
  await harness.render(A1);
  await harness.act(() => harness.feed.retry());
  assert.deepEqual(harness.ids(), ['n3', 'n1'], 'releitura nova reflete o servidor');
  await harness.unmount();
});
