import { GoogleAuthProvider, reauthenticateWithPopup } from 'firebase/auth';

import { auth } from '../../lib/firebase';

/**
 * Mensagens em pt-BR para as operações de conta, workspace e membros.
 *
 * As callables do kernel respondem com mensagens em pt-BR escritas no ponto
 * do erro (papel insuficiente, convite indisponível, CNPJ inválido...). Elas
 * são exibidas como vieram apenas para os códigos de regra de negócio; erro
 * interno, indisponibilidade ou falha de rede viram uma mensagem genérica —
 * nunca o texto técnico do SDK.
 */
const BUSINESS_CODES = new Set([
  'functions/permission-denied',
  'functions/failed-precondition',
  'functions/not-found',
  'functions/unauthenticated',
  'functions/invalid-argument',
  'functions/already-exists',
  // Limite do plano (P2B): mensagem pt-BR do backend com a próxima ação.
  'functions/resource-exhausted',
  // Contenção de transação (P2B.2): nada foi gravado; a mensagem pt-BR do
  // backend pede para atualizar e tentar de novo, sem detalhe técnico.
  'functions/aborted',
]);

interface CallableErrorShape {
  code?: unknown;
  message?: unknown;
  details?: unknown;
}

export const callableErrorReason = (error: unknown): string | null => {
  const details = (error as CallableErrorShape | null)?.details;
  if (details && typeof details === 'object' && 'reason' in details) {
    const reason = (details as { reason?: unknown }).reason;
    return typeof reason === 'string' ? reason : null;
  }
  return null;
};

export const workspaceErrorMessage = (error: unknown, fallback: string): string => {
  const { code, message } = (error ?? {}) as CallableErrorShape;
  if (typeof code !== 'string' || !BUSINESS_CODES.has(code)) return fallback;
  if (typeof message !== 'string' || message.trim() === '') return fallback;
  return message;
};

/**
 * Operações irreversíveis (transferência de titularidade, arquivamento)
 * exigem login recente (D-06). Quando o backend pede, reautentica com o
 * Google e repete a chamada uma única vez.
 */
export const withRecentLogin = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    if (callableErrorReason(error) !== 'recent_login_required' || !auth.currentUser) {
      throw error;
    }
    await reauthenticateWithPopup(auth.currentUser, new GoogleAuthProvider());
    return operation();
  }
};
