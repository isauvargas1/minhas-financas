import type { AppNotification } from '../../types.ts';
import type {
  NotificationCursor,
  NotificationPage,
  NotificationScope,
  NotificationUserState,
  ParsedNotification,
  UserNotification,
} from './types.ts';

/**
 * Notificações (P5-D1, PR-NOTIF-01) — regras puras do painel: escopo, chave
 * de cache, forma do evento e do estado, página, textos da contagem e
 * mensagens. Sem React nem SDK do Firebase.
 *
 * Modelo: o evento `workspaces/{ws}/notifications/{id}` é compartilhado e só
 * o backend grava; o que é de cada pessoa (lida, arquivada ou excluída para si) fica em
 * `workspaces/{ws}/notification_user_states/{uid}/notification_entries/{id}`. Ler, marcar ou
 * arquivar nunca muda o que os outros membros veem.
 */

/** Itens por página do painel. A consulta lê um a mais para saber se há mais. */
export const NOTIFICATIONS_PAGE_SIZE = 25;

/**
 * Marcações por lote. Nas Rules, um lote custa 5 acessos fixos (`exists` e
 * `get` do perfil e do membership, `get` do workspace) e 1 por estado criado
 * (`get` do evento, de onde vem o `expiresAt`); o teto é 20 por lote. Medido no Emulator: 15
 * criações passam e 16 são negadas. Com 10, sobram 5 acessos de margem.
 */
export const NOTIFICATION_MARK_BATCH_SIZE = 10;

const MAX_IDENTIFIER_LENGTH = 256;
const PLACEHOLDER_IDENTIFIERS = new Set(['undefined', 'null', 'loading']);

const isIdentifier = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= MAX_IDENTIFIER_LENGTH &&
  value.trim() === value &&
  !value.includes('/') &&
  !PLACEHOLDER_IDENTIFIERS.has(value);

/**
 * Escopo das notificações: uid da sessão e workspace ativo, só quando o
 * workspace foi carregado para esse mesmo uid. Fora disso, `null`: nada é
 * lido, guardado em cache nem gravado.
 */
export const resolveNotificationScope = (
  uid: unknown,
  workspaceId: unknown,
  activeWorkspaceUid: unknown,
): NotificationScope | null => {
  if (!isIdentifier(uid) || !isIdentifier(workspaceId) || activeWorkspaceUid !== uid) return null;
  return Object.freeze({ workspaceId, uid });
};

/** O cache é por workspace e por usuário: nunca reaproveitado entre contas. */
export const notificationKeys = {
  all: ['notifications'] as const,
  scope: (scope: NotificationScope) => ['notifications', scope.workspaceId, scope.uid] as const,
  /** Total exato de não lidas do escopo (callable do backend). */
  unreadCount: (scope: NotificationScope) =>
    ['notifications', scope.workspaceId, scope.uid, 'unread-count'] as const,
};

const NOTIFICATION_TYPES: ReadonlySet<AppNotification['type']> = new Set([
  'info', 'success', 'warning', 'error', 'invite', 'credit_card',
]);

const optionalText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

/** `expiresAt` do evento (Timestamp do SDK web) em milissegundos, ou `null`. */
export const expiresAtMillis = (value: unknown): number | null => {
  const toMillis = (value as { toMillis?: unknown } | null | undefined)?.toMillis;
  if (typeof toMillis !== 'function') return null;
  const millis: unknown = toMillis.call(value);
  return typeof millis === 'number' && Number.isFinite(millis) ? millis : null;
};

/**
 * Evento lido do Firestore. Sem título, mensagem, data em texto ou
 * `expiresAt` (Timestamp), o documento está fora do contrato e não vira
 * notificação (o backend é o único produtor). Campos de estado que
 * porventura existam no evento são ignorados: o estado vem só do documento
 * privado do usuário.
 */
export const toAppNotification = (id: string, data: Record<string, unknown>): ParsedNotification | null => {
  const { title, message, createdAt, type } = data;
  if (typeof title !== 'string' || typeof message !== 'string' || typeof createdAt !== 'string') return null;
  const expiresAtMs = expiresAtMillis(data.expiresAt);
  if (expiresAtMs === null) return null;
  return {
    id,
    title,
    message,
    createdAt,
    expiresAtMs,
    type: NOTIFICATION_TYPES.has(type as AppNotification['type']) ? (type as AppNotification['type']) : 'info',
    link: optionalText(data.link),
    actionLabel: optionalText(data.actionLabel),
    workspaceId: optionalText(data.workspaceId),
    source: optionalText(data.source),
    domain: optionalText(data.domain),
    domainEventType: optionalText(data.domainEventType),
    cardId: optionalText(data.cardId),
    invoiceId: optionalText(data.invoiceId),
  };
};

export const UNREAD_STATE: NotificationUserState = Object.freeze({ read: false, dismissed: false, deleted: false });

export const toNotificationUserState = (data: Record<string, unknown> | undefined): NotificationUserState =>
  data
    ? { read: data.read === true, dismissed: data.dismissed === true, deleted: data.deleted === true }
    : UNREAD_STATE;

export interface RawNotificationDoc {
  readonly id: string;
  readonly data: Record<string, unknown>;
}

/**
 * Monta a página a partir da consulta (até `pageSize + 1` documentos: o
 * excedente só indica que há mais) e dos estados privados dos itens dela.
 * O cursor é o último documento BRUTO lido da página, mesmo que inválido,
 * expirado ou excluído, para não repetir nem pular nenhum: a filtragem de
 * expirados e excluídos é só da lista visível. Uma página com menos de
 * `pageSize` visíveis não é fim de histórico enquanto houver cursor.
 */
export const buildNotificationPage = (
  docs: readonly RawNotificationDoc[],
  states: ReadonlyMap<string, NotificationUserState>,
  pageSize: number = NOTIFICATIONS_PAGE_SIZE,
): NotificationPage => {
  const pageDocs = docs.slice(0, pageSize);
  const items: UserNotification[] = [];
  for (const entry of pageDocs) {
    const notification = toAppNotification(entry.id, entry.data);
    if (notification) items.push({ ...notification, ...(states.get(entry.id) ?? UNREAD_STATE) });
  }
  const last = pageDocs[pageDocs.length - 1];
  const nextCursor: NotificationCursor | null = docs.length > pageSize && last
    ? { createdAt: String(last.data.createdAt ?? ''), id: last.id }
    : null;
  return { items, nextCursor };
};

export interface NotificationPagesData {
  readonly pages: readonly NotificationPage[];
  readonly pageParams: readonly unknown[];
}

/**
 * Itens visíveis das páginas carregadas: sem repetição e sem os excluídos,
 * arquivados ou expirados (`expiresAtMs <= nowMs`) para o usuário.
 */
export const visibleNotifications = (
  data: NotificationPagesData | undefined,
  nowMs: number,
): UserNotification[] => {
  if (!data) return [];
  const seen = new Set<string>();
  const visible: UserNotification[] = [];
  for (const page of data.pages) {
    for (const item of page.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      if (!item.deleted && !item.dismissed && item.expiresAtMs > nowMs) visible.push(item);
    }
  }
  return visible;
};

/**
 * Milissegundos até a próxima expiração entre as notificações carregadas
 * (as já expiradas não contam), ou `null` sem nenhuma a expirar. Alimenta o
 * relógio local do painel: sem polling do Firestore.
 */
export const nextExpiryDelayMs = (
  items: readonly { readonly expiresAtMs: number }[],
  nowMs: number,
): number | null => {
  let next: number | null = null;
  for (const item of items) {
    const delay = item.expiresAtMs - nowMs;
    if (delay > 0 && (next === null || delay < next)) next = delay;
  }
  return next;
};

/** Estado da contagem exata de não lidas (callable do backend). */
export type UnreadCountState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly count: number }
  | { readonly status: 'unavailable' };

export interface UnreadCountSummary {
  /** Texto do indicador do sino (vazio quando não há o que indicar). */
  readonly badge: string;
  /** Nome acessível do sino. */
  readonly bellLabel: string;
  /** Texto do contador do painel. */
  readonly chip: string;
  /** Descrição do contador do painel. */
  readonly chipLabel: string;
}

/**
 * Textos da contagem. O número é o total exato devolvido pelo backend, nunca
 * o que foi carregado na lista. Contagem indisponível (erro ou resposta fora
 * do contrato) aparece como "?", jamais como zero.
 */
export const summarizeUnreadCount = (state: UnreadCountState): UnreadCountSummary => {
  if (state.status === 'loading') {
    return {
      badge: '',
      bellLabel: 'Notificações',
      chip: '…',
      chipLabel: 'Carregando o total de não lidas',
    };
  }
  if (state.status === 'unavailable') {
    return {
      badge: '?',
      bellLabel: 'Notificações, total de não lidas indisponível',
      chip: '?',
      chipLabel: 'Total de não lidas indisponível',
    };
  }
  const n = state.count;
  const phrase = `${n} não ${n === 1 ? 'lida' : 'lidas'}`;
  return {
    badge: n === 0 ? '' : n > 9 ? '9+' : String(n),
    bellLabel: n === 0 ? 'Notificações, nenhuma não lida' : `Notificações, ${phrase}`,
    chip: String(n),
    chipLabel: n === 0 ? 'Nenhuma não lida' : phrase,
  };
};

/**
 * Aplica, só no cache do escopo da mutação, o estado já confirmado pelo
 * servidor. Não toca em páginas, cursores nem em outros itens.
 */
export const applyNotificationState = <T extends NotificationPagesData>(
  data: T | undefined,
  ids: readonly string[],
  patch: Partial<NotificationUserState>,
): T | undefined => {
  if (!data || ids.length === 0) return data;
  const targets = new Set(ids);
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.map((item) => (targets.has(item.id) ? { ...item, ...patch } : item)),
    })),
  };
};

/**
 * Ao fechar o painel, o cache volta à primeira página: a próxima atualização
 * (abertura, foco) relê uma página só, não todas as que foram carregadas.
 */
export const keepFirstNotificationPage = <T extends NotificationPagesData>(data: T | undefined): T | undefined =>
  data && data.pages.length > 1
    ? { ...data, pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1) }
    : data;

/**
 * P5-E1.1 — marca confirmada não volta atrás. Lida, arquivada e excluída só
 * ligam (as Rules recusam desligar). Uma leitura do feed que leu o estado antes
 * de uma marca confirmada e chega depois dela (atualização ao abrir, foco,
 * releitura após erro, "Carregar mais", que reaproveita as páginas do início da
 * leitura) traria o item de volta: aqui ele conserva as marcas que o cache já
 * tinha. A marca só vale para o mesmo evento (mesmo ID e mesma expiração): um
 * evento recriado com o mesmo ID não herda marca. Nunca liga uma marca que nem o
 * cache nem a leitura têm e nunca acrescenta item que a leitura não trouxe.
 */
export const keepConfirmedNotificationMarks = <T extends NotificationPagesData>(previous: T | undefined, next: T): T => {
  if (!previous) return next;
  const marked = new Map<string, NotificationUserState & { readonly expiresAtMs: number }>();
  for (const page of previous.pages) {
    for (const item of page.items) {
      if (item.read || item.dismissed || item.deleted) {
        marked.set(item.id, {
          read: item.read, dismissed: item.dismissed, deleted: item.deleted, expiresAtMs: item.expiresAtMs,
        });
      }
    }
  }
  if (marked.size === 0) return next;
  let changed = false;
  const pages = next.pages.map((page) => {
    let pageChanged = false;
    const items = page.items.map((item) => {
      const kept = marked.get(item.id);
      if (!kept || kept.expiresAtMs !== item.expiresAtMs) return item;
      const read = item.read || kept.read;
      const dismissed = item.dismissed || kept.dismissed;
      const deleted = item.deleted || kept.deleted;
      if (read === item.read && dismissed === item.dismissed && deleted === item.deleted) return item;
      pageChanged = true;
      return { ...item, read, dismissed, deleted };
    });
    if (!pageChanged) return page;
    changed = true;
    return { ...page, items };
  });
  return changed ? { ...next, pages } : next;
};

export const chunkIds = (ids: readonly string[], size: number = NOTIFICATION_MARK_BATCH_SIZE): string[][] => {
  const unique = [...new Set(ids)];
  const chunks: string[][] = [];
  for (let index = 0; index < unique.length; index += size) chunks.push(unique.slice(index, index + size));
  return chunks;
};

export type NotificationMark = 'read' | 'dismissed' | 'deleted';

export const NOTIFICATION_STAMP: Readonly<Record<NotificationMark, 'readAt' | 'dismissedAt' | 'deletedAt'>> = Object.freeze({
  read: 'readAt',
  dismissed: 'dismissedAt',
  deleted: 'deletedAt',
});

/** Parte mínima do snapshot do SDK usada na marcação (substituível em teste). */
export interface MarkSnapshot {
  exists(): boolean;
  data(): Record<string, unknown> | undefined;
}

/** Parte mínima da transação do SDK usada na marcação (substituível em teste). */
export interface MarkTransaction<Ref> {
  get(ref: Ref): Promise<MarkSnapshot>;
  set(ref: Ref, data: Record<string, unknown>, options: { merge: true }): unknown;
}

export interface MarkTarget<Ref> {
  readonly id: string;
  readonly stateRef: Ref;
  readonly eventRef: Ref;
}

/**
 * Marca um lote no estado privado, dentro de uma transação. TODAS as leituras
 * vêm antes da primeira escrita: o estado de cada item e, só para os estados
 * que serão CRIADOS, o evento compartilhado (de onde vem o `expiresAt`).
 *
 * - Marca já presente: nada é regravado (idempotente; o carimbo fica).
 * - Criação: grava a marca, o carimbo e o `expiresAt` do evento. Evento
 *   ausente, sem `expiresAt` ou já expirado: pula sem gravar (o item some por
 *   expiração; não é erro de servidor).
 * - Atualização: grava só a marca nova, sem `expiresAt` (o merge preserva o
 *   já copiado). `expiresAt` do estado já vencido: pula.
 *
 * Devolve os IDs efetivamente marcados ou que já estavam marcados.
 */
export const markNotificationBatch = async <Ref>(
  transaction: MarkTransaction<Ref>,
  targets: readonly MarkTarget<Ref>[],
  mark: NotificationMark,
  nowMs: number,
  stamp: unknown,
): Promise<string[]> => {
  const states = await Promise.all(targets.map((target) => transaction.get(target.stateRef)));
  const created = targets.filter((_, index) => !states[index].exists());
  const events = new Map<string, MarkSnapshot>();
  const eventSnapshots = await Promise.all(created.map((target) => transaction.get(target.eventRef)));
  created.forEach((target, index) => events.set(target.id, eventSnapshots[index]));

  const done: string[] = [];
  targets.forEach((target, index) => {
    const state = states[index];
    if (state.exists()) {
      const data = state.data() ?? {};
      if (data[mark] === true) {
        done.push(target.id);
        return;
      }
      const expiresAtMs = expiresAtMillis(data.expiresAt);
      if (expiresAtMs === null || expiresAtMs <= nowMs) return;
      transaction.set(target.stateRef, { [mark]: true, [NOTIFICATION_STAMP[mark]]: stamp }, { merge: true });
      done.push(target.id);
      return;
    }
    const event = events.get(target.id);
    const eventData = event?.exists() ? event.data() : undefined;
    const expiresAtMs = expiresAtMillis(eventData?.expiresAt);
    if (!eventData || expiresAtMs === null || expiresAtMs <= nowMs) return;
    transaction.set(
      target.stateRef,
      { [mark]: true, [NOTIFICATION_STAMP[mark]]: stamp, expiresAt: eventData.expiresAt },
      { merge: true },
    );
    done.push(target.id);
  });
  return done;
};

const errorCode = (error: unknown): string => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code.replace(/^firestore\//, '') : '';
};

/** Falha ao carregar as notificações, em pt-BR e sem detalhe interno. */
export const notificationLoadErrorMessage = (error: unknown): string => {
  switch (errorCode(error)) {
    case 'permission-denied':
      return 'Você não tem acesso às notificações deste espaço.';
    case 'unauthenticated':
      return 'Sua sessão expirou. Entre novamente para continuar.';
    case 'unavailable':
    case 'deadline-exceeded':
      return 'Sem conexão com o servidor. Verifique sua internet e tente novamente.';
    default:
      return 'Não foi possível carregar as notificações. Tente novamente.';
  }
};

/**
 * Quem pode excluir notificações para si: papel owner, admin ou member do
 * workspace ativo carregado para o mesmo uid do escopo. Sem escopo, com papel
 * ainda desconhecido ou viewer, não pode (arquivar continua permitido).
 */
export const canDeleteNotifications = (
  scope: NotificationScope | null,
  activeWorkspaceUid: unknown,
  role: unknown,
): boolean =>
  scope !== null &&
  activeWorkspaceUid === scope.uid &&
  (role === 'owner' || role === 'admin' || role === 'member');

export type NotificationActionKind = 'update' | 'delete';

/** Falha ao marcar, arquivar ou excluir, em pt-BR e sem detalhe interno. */
export const notificationActionErrorMessage = (
  error: unknown,
  action: NotificationActionKind = 'update',
): string => {
  switch (errorCode(error)) {
    case 'permission-denied':
      return action === 'delete'
        ? 'Você não tem permissão para excluir esta notificação.'
        : 'Você não tem permissão para atualizar notificações neste espaço.';
    case 'unauthenticated':
      return 'Sua sessão expirou. Entre novamente para continuar.';
    case 'unavailable':
    case 'deadline-exceeded':
      return 'Sem conexão com o servidor. Verifique sua internet e tente novamente.';
    default:
      return action === 'delete'
        ? 'Não foi possível excluir a notificação. Tente novamente.'
        : 'Não foi possível atualizar a notificação. Tente novamente.';
  }
};
