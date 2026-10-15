import type { NotificationScope } from './types.ts';

/**
 * Contrato cliente da callable de contagem de notificações não lidas
 * (P5-D2). Módulo puro: não importa o SDK. `api.ts` o liga ao
 * `httpsCallable`; os testes, a um `invoke` falso.
 *
 * - Nome `getNotificationUnreadCount`; payload só `{ workspaceId }`: o uid
 *   vem do token, o cliente nunca o envia.
 * - Resposta `{ unreadCount, asOf }`: `unreadCount` é inteiro seguro >= 0 e
 *   `asOf` é um instante ISO. Qualquer outra forma está fora do contrato e
 *   vira erro: a contagem fica indisponível, nunca zero.
 */

export const NOTIFICATION_CALLABLES = ['getNotificationUnreadCount'] as const;

export type NotificationCallableName = (typeof NOTIFICATION_CALLABLES)[number];

export type NotificationInvoke = <TResult>(
  name: NotificationCallableName,
  payload: Record<string, unknown>,
) => Promise<TResult>;

export interface NotificationUnreadCountResponse {
  readonly unreadCount: number;
  readonly asOf: string;
}

/** Código do erro lançado para resposta fora do contrato (não é código do SDK). */
export const UNREAD_COUNT_INVALID_RESPONSE = 'invalid-response';

/**
 * Valida a resposta da callable. Devolve `null` quando está fora do contrato
 * (negativa, fracionária, NaN, infinita, texto, ausente, acima do inteiro
 * seguro ou sem `asOf` ISO).
 */
export const parseUnreadCountResponse = (data: unknown): NotificationUnreadCountResponse | null => {
  if (typeof data !== 'object' || data === null) return null;
  const { unreadCount, asOf } = data as { unreadCount?: unknown; asOf?: unknown };
  if (typeof unreadCount !== 'number' || !Number.isSafeInteger(unreadCount) || unreadCount < 0) return null;
  if (typeof asOf !== 'string' || asOf.length === 0 || !Number.isFinite(Date.parse(asOf))) return null;
  return { unreadCount, asOf };
};

export const bindNotificationCallables = (invoke: NotificationInvoke) => ({
  /**
   * Total exato de não lidas do usuário da sessão no workspace do escopo.
   * Falha da callable ou resposta fora do contrato sobem como erro: quem
   * chama trata como contagem indisponível.
   */
  getUnreadCount: async (scope: NotificationScope): Promise<number> => {
    const response = parseUnreadCountResponse(
      await invoke<unknown>('getNotificationUnreadCount', { workspaceId: scope.workspaceId }),
    );
    if (!response) {
      throw Object.assign(new Error('Resposta da contagem de notificações fora do contrato.'), {
        code: UNREAD_COUNT_INVALID_RESPONSE,
      });
    }
    return response.unreadCount;
  },
});
