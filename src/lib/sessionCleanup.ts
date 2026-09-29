/**
 * Limpeza do estado local de uma sessão (P1, AUTH-11).
 *
 * Depois do logout, nada do usuário anterior pode reaparecer para a próxima
 * conta no mesmo navegador. O cache do React Query é limpo por quem chama;
 * aqui saem as chaves do `localStorage` ligadas a usuário ou workspace:
 *
 * - `lastWorkspaceId_<uid>`: último workspace aberto;
 * - `finance_ai_chat_history_<workspaceId>`: histórico local do assistente
 *   (a migração para o servidor é PR-AI-04, P5; aqui só se impede o
 *   vazamento entre contas que compartilham um workspace);
 * - `app_chat_threads*` e `app_chat_messages*`: conversas locais do módulo de
 *   mensagens.
 *
 * `app-theme` fica: é preferência do dispositivo (modo claro/escuro), não
 * dado do usuário.
 */
export const USER_SCOPED_STORAGE_PREFIXES = [
  'lastWorkspaceId_',
  'finance_ai_chat_history_',
  'app_chat_threads',
  'app_chat_messages',
] as const;

export const clearUserScopedStorage = (storage?: Storage): string[] => {
  let target: Storage | undefined = storage;
  try {
    target ??= globalThis.localStorage;
  } catch {
    return [];
  }
  if (!target) return [];
  const doomed: string[] = [];
  for (let index = 0; index < target.length; index += 1) {
    const key = target.key(index);
    if (key && USER_SCOPED_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      doomed.push(key);
    }
  }
  for (const key of doomed) target.removeItem(key);
  return doomed;
};
