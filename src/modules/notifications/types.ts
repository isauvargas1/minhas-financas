import type { AppNotification } from '../../types.ts';

export type NotificationType =
  | 'alertaFinanceiro'
  | 'meta'
  | 'cartaoCredito'
  | 'gastoRecorrente'
  | 'divisaoDespesas'
  | 'sistema'
  | 'outro';

export type NotificationStatus = 'unread' | 'read';

export interface NotificationItem {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  createdAt: string;
  status: NotificationStatus;
  // Route or action where the user should be taken
  actionRoute?: string;
  actionLabel?: string;
}

/**
 * P5-D1 (PR-NOTIF-01) — dono do estado: o uid da sessão do Firebase Auth e o
 * workspace ativo carregado para esse uid. Toda leitura, cache e escrita de
 * notificações é por este par.
 */
export interface NotificationScope {
  readonly workspaceId: string;
  readonly uid: string;
}

/**
 * Estado privado do usuário
 * (`notification_user_states/{uid}/notification_entries/{id}`). `deleted`
 * tem precedência sobre `dismissed`, que tem sobre `read`.
 */
export interface NotificationUserState {
  readonly read: boolean;
  readonly dismissed: boolean;
  readonly deleted: boolean;
}

/** Evento compartilhado válido: `expiresAtMs` é o `expiresAt` (TTL) do evento. */
export interface ParsedNotification extends AppNotification {
  readonly expiresAtMs: number;
}

/** Evento compartilhado do workspace com o estado do usuário da sessão. */
export interface UserNotification extends ParsedNotification, NotificationUserState {}

/** Posição estável na listagem: mais recente primeiro, desempate pelo ID. */
export interface NotificationCursor {
  readonly createdAt: string;
  readonly id: string;
}

export interface NotificationPage {
  readonly items: readonly UserNotification[];
  readonly nextCursor: NotificationCursor | null;
}
