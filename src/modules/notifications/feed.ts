import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { replaceEqualDeep, useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';

import {
  applyNotificationState,
  keepConfirmedNotificationMarks,
  keepFirstNotificationPage,
  nextExpiryDelayMs,
  notificationActionErrorMessage,
  notificationKeys,
  notificationLoadErrorMessage,
  summarizeUnreadCount,
  visibleNotifications,
  type UnreadCountState,
  type UnreadCountSummary,
} from './model.ts';
import type {
  NotificationCursor,
  NotificationPage,
  NotificationScope,
  NotificationUserState,
  UserNotification,
} from './types.ts';

/**
 * Painel de notificações (P5-D1, PR-NOTIF-01): leitura paginada e ações
 * sobre o estado privado, sem o SDK do Firebase (a API é injetada; a ligação
 * real fica em `./hooks.ts`).
 *
 * - Cache por (workspace, uid): troca de workspace ou de conta nunca mostra
 *   o que era do outro escopo.
 * - Sem polling e sem listener: lê a primeira página quando o escopo surge,
 *   ao abrir o painel e ao voltar o foco para a aba — nos dois últimos casos
 *   só se o dado tem mais de um minuto. "Carregar mais" lê a página seguinte.
 * - Notificações expiradas (`expiresAt` do evento) saem da lista por um
 *   relógio local: `setTimeout` até a próxima expiração entre as carregadas,
 *   sem polling do Firestore.
 * - A contagem de não lidas é exata e vem da callable do backend
 *   (`useNotificationUnreadCount`), numa consulta própria por escopo, sem
 *   polling e sem listener: relê ao surgir o escopo, ao abrir o painel e ao
 *   voltar o foco (se passou de um minuto), depois de toda ação do painel e
 *   quando a primeira página do feed traz notificações novas. Falha ou
 *   resposta fora do contrato é "indisponível", nunca zero.
 * - Marcar, arquivar e excluir para si gravam só o estado do próprio usuário; o resultado
 *   confirmado entra no cache do escopo em que a ação começou, mesmo que o
 *   workspace tenha mudado no meio, e nunca no de outro escopo.
 * - Marca confirmada não volta atrás (P5-E1.1): uma leitura que leu o estado
 *   antes dela e chega depois não desliga lida, arquivada nem excluída
 *   (`keepConfirmedNotificationMarks`).
 */

export interface NotificationApi {
  listPage: (scope: NotificationScope, cursor: NotificationCursor | null) => Promise<NotificationPage>;
  markAsRead: (scope: NotificationScope, ids: readonly string[]) => Promise<string[]>;
  dismiss: (scope: NotificationScope, id: string) => Promise<string[]>;
  deleteForMe: (scope: NotificationScope, id: string) => Promise<string[]>;
  /** Total exato de não lidas do escopo; erro ou resposta inválida sobem. */
  getUnreadCount: (scope: NotificationScope) => Promise<number>;
}

export const NOTIFICATIONS_STALE_TIME_MS = 60_000;

/** Maior atraso aceito por `setTimeout` (acima disso dispara na hora). */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

type NotificationData = InfiniteData<NotificationPage, NotificationCursor | null>;

/**
 * Toda gravação de dados no cache do feed (resposta de leitura ou
 * `setQueryData`) conserva as marcas que o cache já tinha e mantém o
 * compartilhamento estrutural padrão do React Query.
 */
const shareNotificationData = (previous: unknown, next: unknown): unknown =>
  replaceEqualDeep(
    previous,
    keepConfirmedNotificationMarks(previous as NotificationData | undefined, next as NotificationData),
  );

const NO_SCOPE_KEY = ['notifications', 'sem-escopo'] as const;

const isTerminalError = (error: unknown): boolean =>
  /permission-denied|unauthenticated/.test(String((error as { code?: unknown } | null)?.code ?? ''));

/** Limite de frequência, pré-condição, permissão e sessão não melhoram repetindo. */
const isUnrepeatableCountError = (error: unknown): boolean =>
  /permission-denied|unauthenticated|resource-exhausted|failed-precondition/.test(
    String((error as { code?: unknown } | null)?.code ?? ''),
  );

export interface NotificationFeed {
  readonly scope: NotificationScope | null;
  readonly visible: readonly UserNotification[];
  readonly status: 'loading' | 'error' | 'ready';
  readonly loadError: string | null;
  readonly hasMore: boolean;
  readonly isLoadingMore: boolean;
  readonly loadMore: () => void;
  readonly retry: () => void;
  readonly refreshIfStale: () => void;
  readonly collapse: () => void;
}

export const useNotificationFeed = (scope: NotificationScope | null, api: NotificationApi): NotificationFeed => {
  const queryClient = useQueryClient();
  const result = useInfiniteQuery({
    queryKey: scope ? notificationKeys.scope(scope) : NO_SCOPE_KEY,
    enabled: scope !== null,
    initialPageParam: null as NotificationCursor | null,
    queryFn: ({ pageParam }) => {
      if (!scope) throw new Error('Notificações sem escopo.');
      return api.listPage(scope, pageParam);
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: NOTIFICATIONS_STALE_TIME_MS,
    refetchOnWindowFocus: true,
    // Falha de permissão ou de sessão não melhora repetindo.
    retry: (failureCount, error) => !isTerminalError(error) && failureCount < 2,
    structuralSharing: shareNotificationData as <T>(oldData: T | undefined, newData: T) => T,
  });

  // Ao sair de um escopo (outro workspace, outra conta), o cache dele volta à
  // primeira página: uma volta posterior relê uma página só.
  const scopeId = scope ? `${scope.workspaceId}/${scope.uid}` : null;
  useEffect(() => {
    if (!scope) return undefined;
    const left = scope;
    return () => {
      queryClient.setQueryData<NotificationData>(notificationKeys.scope(left), keepFirstNotificationPage);
    };
    // O ciclo é do escopo (identificadores), não da identidade do objeto.
  }, [scopeId, queryClient]);

  // Relógio local: avança só quando uma notificação carregada vai expirar.
  const [nowMs, setNowMs] = useState(() => Date.now());
  const { data, dataUpdatedAt } = result;
  useEffect(() => {
    setNowMs(Date.now());
  }, [scopeId, dataUpdatedAt]);

  const visible = useMemo(() => visibleNotifications(data, nowMs), [data, nowMs]);
  const expiryDelay = useMemo(() => nextExpiryDelayMs(visible, nowMs), [visible, nowMs]);
  const expiryAt = expiryDelay === null ? null : nowMs + expiryDelay;
  // Conta os disparos: um disparo antecipado (teto do `setTimeout` ou relógio
  // do sistema ajustado) arma o próximo em vez de parar.
  const [expiryTick, setExpiryTick] = useState(0);
  useEffect(() => {
    if (!scope || expiryAt === null) return undefined;
    const timer = setTimeout(
      () => {
        const firedAt = Date.now();
        setNowMs(firedAt);
        setExpiryTick((tick) => tick + 1);
        // Um item carregado expirou: o total exato do servidor também mudou.
        // Só no disparo real (não no antecipado pelo teto do `setTimeout`).
        if (firedAt >= expiryAt) {
          void queryClient.invalidateQueries({ queryKey: notificationKeys.unreadCount(scope) });
        }
      },
      Math.min(Math.max(expiryAt - Date.now(), 0), MAX_TIMER_DELAY_MS),
    );
    return () => clearTimeout(timer);
    // Reagenda por escopo (identificadores), por instante de expiração e a
    // cada disparo.
  }, [scopeId, expiryAt, expiryTick]);

  const hasMore = Boolean(result.hasNextPage);

  // Publicação nova: o conjunto de IDs da primeira página mudou em relação à
  // leitura anterior do mesmo escopo. A contagem exata é relida (sem polling).
  const firstPageKey = data?.pages[0] ? data.pages[0].items.map((item) => item.id).join('|') : null;
  const lastFirstPage = useRef<{ scopeId: string; key: string } | null>(null);
  useEffect(() => {
    if (!scope || scopeId === null || firstPageKey === null) return;
    const previous = lastFirstPage.current;
    lastFirstPage.current = { scopeId, key: firstPageKey };
    if (previous && previous.scopeId === scopeId && previous.key !== firstPageKey) {
      void queryClient.invalidateQueries({ queryKey: notificationKeys.unreadCount(scope) });
    }
    // O ciclo é do escopo (identificadores) e do conjunto de IDs.
  }, [scopeId, firstPageKey, queryClient]);

  const { refetch, isStale, fetchStatus, fetchNextPage, isFetchingNextPage } = result;

  const refreshIfStale = useCallback(() => {
    if (scope && isStale && fetchStatus === 'idle') void refetch();
  }, [scope, isStale, fetchStatus, refetch]);

  const collapse = useCallback(() => {
    if (scope) queryClient.setQueryData<NotificationData>(notificationKeys.scope(scope), keepFirstNotificationPage);
  }, [scope, queryClient]);

  const loadMore = useCallback(() => {
    if (hasMore && !isFetchingNextPage) void fetchNextPage();
  }, [hasMore, isFetchingNextPage, fetchNextPage]);

  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  let status: NotificationFeed['status'] = 'ready';
  if (result.isError && !result.data) status = 'error';
  else if (scope === null || result.isPending) status = 'loading';

  return {
    scope,
    visible,
    status,
    loadError: result.isError ? notificationLoadErrorMessage(result.error) : null,
    hasMore,
    isLoadingMore: isFetchingNextPage,
    loadMore,
    retry,
    refreshIfStale,
    collapse,
  };
};

export interface NotificationUnreadCount {
  readonly state: UnreadCountState;
  readonly summary: UnreadCountSummary;
  /** Relê a contagem só se estiver obsoleta (ao abrir o painel). */
  readonly refreshIfStale: () => void;
}

const NO_COUNT_SCOPE_KEY = ['notifications', 'sem-escopo', 'unread-count'] as const;

/**
 * Total exato de não lidas do escopo, vindo do backend. Sem escopo a consulta
 * fica desligada; o cache é por (workspace, uid). Se a última tentativa
 * falhou (após uma nova tentativa, exceto erro de permissão, sessão, limite
 * de frequência ou pré-condição), o estado é indisponível: o número antigo
 * não é mostrado como atual.
 */
export const useNotificationUnreadCount = (scope: NotificationScope | null, api: NotificationApi): NotificationUnreadCount => {
  const result = useQuery({
    queryKey: scope ? notificationKeys.unreadCount(scope) : NO_COUNT_SCOPE_KEY,
    enabled: scope !== null,
    queryFn: () => {
      if (!scope) throw new Error('Contagem de notificações sem escopo.');
      return api.getUnreadCount(scope);
    },
    staleTime: NOTIFICATIONS_STALE_TIME_MS,
    refetchOnWindowFocus: true,
    retry: (failureCount, error) => !isUnrepeatableCountError(error) && failureCount < 1,
  });

  const { data, isError, isPending, isStale, fetchStatus, refetch } = result;
  const state = useMemo<UnreadCountState>(() => {
    if (scope === null) return { status: 'loading' };
    if (isError) return { status: 'unavailable' };
    if (isPending || data === undefined) return { status: 'loading' };
    return { status: 'ready', count: data };
  }, [scope, isError, isPending, data]);
  const summary = useMemo(() => summarizeUnreadCount(state), [state]);

  const refreshIfStale = useCallback(() => {
    if (scope && isStale && fetchStatus === 'idle') void refetch();
  }, [scope, isStale, fetchStatus, refetch]);

  return { state, summary, refreshIfStale };
};

interface MarkVariables {
  readonly scope: NotificationScope;
  readonly ids: readonly string[];
}

const useStateMutation = (
  run: (variables: MarkVariables) => Promise<string[]>,
  patch: Partial<NotificationUserState>,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (marked, { scope }) => {
      // Só o escopo em que a ação começou; nenhum outro workspace ou conta.
      queryClient.setQueryData<NotificationData>(
        notificationKeys.scope(scope),
        (data) => applyNotificationState(data, marked, patch),
      );
    },
    onError: (_error, { scope }) => {
      // Lote parcial ou estado desconhecido: relê o feed do escopo da ação.
      void queryClient.invalidateQueries({ queryKey: notificationKeys.scope(scope), exact: true });
    },
    onSettled: (_marked, _error, { scope }) => {
      // Sucesso ou erro: a contagem exata do escopo da ação é relida.
      void queryClient.invalidateQueries({ queryKey: notificationKeys.unreadCount(scope) });
    },
  });
};

const sameScope = (a: NotificationScope | null, b: NotificationScope | undefined): boolean =>
  Boolean(a && b && a.workspaceId === b.workspaceId && a.uid === b.uid);

/**
 * Resultado de "Excluir para mim": `deleted` só com a marca confirmada pelo
 * servidor; `expired` quando nada foi gravado porque o evento já expirou ou
 * não existe mais; `failed` em erro (mensagem em `deleteError`) ou sem escopo.
 */
export type NotificationDeleteResult = 'deleted' | 'expired' | 'failed';

export interface NotificationActions {
  readonly markAsRead: (ids: readonly string[]) => void;
  readonly dismiss: (id: string) => void;
  readonly deleteForMe: (id: string) => Promise<NotificationDeleteResult>;
  /** Descarta o erro da última exclusão (ao cancelar a confirmação). */
  readonly resetDeleteError: () => void;
  readonly isMarking: boolean;
  readonly isDeleting: boolean;
  readonly actionError: string | null;
  readonly deleteError: string | null;
}

/**
 * Ações do painel, presas ao escopo no momento do clique. O erro de uma ação
 * só aparece enquanto o escopo dela for o atual.
 */
export const useNotificationActions = (scope: NotificationScope | null, api: NotificationApi): NotificationActions => {
  const markRead = useStateMutation(({ scope: target, ids }) => api.markAsRead(target, ids), { read: true });
  const dismissOne = useStateMutation(({ scope: target, ids }) => api.dismiss(target, ids[0]), { dismissed: true });
  const deleteOne = useStateMutation(({ scope: target, ids }) => api.deleteForMe(target, ids[0]), { deleted: true });

  const failed = [markRead, dismissOne].find(
    (mutation) => mutation.isError && sameScope(scope, mutation.variables?.scope),
  );
  const deleteFailed = deleteOne.isError && sameScope(scope, deleteOne.variables?.scope);

  const { mutate: mutateRead } = markRead;
  const { mutate: mutateDismiss } = dismissOne;
  const { mutateAsync: mutateDelete, reset: resetDelete } = deleteOne;

  const markAsRead = useCallback((ids: readonly string[]) => {
    if (scope && ids.length > 0) mutateRead({ scope, ids });
  }, [scope, mutateRead]);

  const dismiss = useCallback((id: string) => {
    if (scope) mutateDismiss({ scope, ids: [id] });
  }, [scope, mutateDismiss]);

  const deleteForMe = useCallback(async (id: string): Promise<NotificationDeleteResult> => {
    if (!scope) return 'failed';
    try {
      const marked = await mutateDelete({ scope, ids: [id] });
      return marked.includes(id) ? 'deleted' : 'expired';
    } catch {
      return 'failed';
    }
  }, [scope, mutateDelete]);

  return {
    markAsRead,
    dismiss,
    deleteForMe,
    resetDeleteError: resetDelete,
    isMarking: markRead.isPending && sameScope(scope, markRead.variables?.scope),
    isDeleting: deleteOne.isPending && sameScope(scope, deleteOne.variables?.scope),
    actionError: failed ? notificationActionErrorMessage(failed.error) : null,
    deleteError: deleteFailed ? notificationActionErrorMessage(deleteOne.error, 'delete') : null,
  };
};
