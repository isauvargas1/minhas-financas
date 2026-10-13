/**
 * Limpeza do estado local de uma sessão (P1, AUTH-11; P5-A, PR-AI-04).
 *
 * Depois do logout, nada do usuário anterior pode reaparecer para a próxima
 * conta no mesmo navegador. O cache do React Query é limpo por quem chama;
 * aqui saem as chaves do `localStorage` ligadas a usuário ou workspace:
 *
 * - `lastWorkspaceId_<uid>`: último workspace aberto;
 * - `finance_ai_chat_history_*`: histórico local do assistente de IA, no
 *   formato atual (por usuário e workspace, `src/modules/reports/aiChatStorage.ts`)
 *   e em qualquer formato obsoleto;
 * - `app_chat_threads*` e `app_chat_messages*`: conversas locais do módulo de
 *   mensagens;
 * - `dindin_local_session_owner`: a conta dona dos dados locais (abaixo).
 *
 * `app-theme` fica: é preferência do dispositivo (modo claro/escuro), não
 * dado do usuário.
 */
export const LOCAL_SESSION_OWNER_KEY = 'dindin_local_session_owner';

const LAST_WORKSPACE_PREFIX = 'lastWorkspaceId_';

export const USER_SCOPED_STORAGE_PREFIXES = [
  LAST_WORKSPACE_PREFIX,
  'finance_ai_chat_history_',
  'app_chat_threads',
  'app_chat_messages',
  LOCAL_SESSION_OWNER_KEY,
] as const;

const isUserScopedKey = (key: string): boolean =>
  USER_SCOPED_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix));

const MAX_OWNER_LENGTH = 256;

/**
 * `localStorage` do navegador, ou `null` quando o acesso é negado (modo
 * privado, política do navegador) ou não existe (testes, SSR).
 */
export const resolveBrowserStorage = (): Storage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

const removeKeys = (target: Storage, doom: (key: string) => boolean): string[] => {
  const doomed: string[] = [];
  try {
    for (let index = 0; index < target.length; index += 1) {
      const key = target.key(index);
      if (key && doom(key)) doomed.push(key);
    }
  } catch {
    // Enumeração negada no meio do caminho: remove o que já foi identificado.
  }
  const removed: string[] = [];
  for (const key of doomed) {
    try {
      target.removeItem(key);
      removed.push(key);
    } catch {
      // Uma chave que não sai não impede a remoção das demais.
    }
  }
  return removed;
};

export const clearUserScopedStorage = (storage?: Storage): string[] => {
  const target = storage ?? resolveBrowserStorage();
  if (!target) return [];
  return removeKeys(target, isUserScopedKey);
};

/**
 * Dono local da sessão: o uid da conta cujos dados locais (histórico do chat
 * de IA, último workspace) estão neste navegador. Serve só para reconhecer,
 * numa carga nova do aplicativo, que os resíduos são de outra conta e
 * apagá-los antes de expor a interface, e para que uma aba antiga não grave
 * histórico depois que outra aba encerrou ou trocou a sessão. Não concede
 * acesso a nada: a autoridade continua sendo a sessão do Firebase Auth e o
 * membership conferido pelo backend.
 */
export const readLocalSessionOwner = (storage?: Storage | null): string | null => {
  const target = storage === undefined ? resolveBrowserStorage() : storage;
  if (!target) return null;
  try {
    const owner = target.getItem(LOCAL_SESSION_OWNER_KEY);
    return owner && owner.length <= MAX_OWNER_LENGTH ? owner : null;
  } catch {
    return null;
  }
};

export const writeLocalSessionOwner = (uid: string, storage?: Storage | null): boolean => {
  const target = storage === undefined ? resolveBrowserStorage() : storage;
  if (!target || !uid || uid.length > MAX_OWNER_LENGTH) return false;
  try {
    target.setItem(LOCAL_SESSION_OWNER_KEY, uid);
    return true;
  } catch {
    return false;
  }
};

/**
 * - `account-switch`: esta aba já tinha outra conta (logout seguido de outro
 *   login, ou troca de conta sem logout);
 * - `residue`: carga nova sem sessão, ou com dados locais de outra conta ou de
 *   dono desconhecido;
 * - `same-account`: a mesma conta continua (recarga, reabertura).
 */
export type LocalSessionTransition = 'account-switch' | 'residue' | 'same-account';

/** A chave local pertence a esta conta? Cada formato por usuário informa o seu. */
export type LocalKeyOwnership = (key: string, uid: string) => boolean;

/** Preferência do último workspace, já identificada pelo uid na chave. */
export const ownsLastWorkspaceKey: LocalKeyOwnership = (key, uid) =>
  key === `${LAST_WORKSPACE_PREFIX}${uid}`;

/**
 * Aplica, a cada emissão do Firebase Auth, a limpeza local que a transição
 * exige e registra o novo dono local. Não depende só da conta anterior desta
 * aba (`previousUid`, que começa vazio numa carga nova): o dono local
 * reconhece os resíduos de outra conta já na primeira emissão.
 *
 * - troca de conta nesta aba (inclusive o logout): sai tudo que é do usuário;
 * - carga nova sem sessão: saem as conversas e o dono local; a preferência
 *   `lastWorkspaceId_<uid>` fica (é um id identificado pelo próprio uid, não
 *   conteúdo, e só a mesma conta a lê);
 * - carga nova com a conta X e dono local diferente ou ausente: sai tudo que
 *   não pertence a X (`ownsKey`).
 *
 * O cache em memória (React Query, sessões do chat) é limpo por quem chama,
 * conforme a transição devolvida.
 */
export const reconcileLocalSession = (
  previousUid: string | null,
  nextUid: string | null,
  storage: Storage | null = resolveBrowserStorage(),
  ownsKey: LocalKeyOwnership = ownsLastWorkspaceKey,
): LocalSessionTransition => {
  let transition: LocalSessionTransition = 'same-account';
  if (previousUid && previousUid !== nextUid) {
    transition = 'account-switch';
  } else if (nextUid === null || readLocalSessionOwner(storage) !== nextUid) {
    transition = 'residue';
  }
  if (storage && transition === 'account-switch') {
    clearUserScopedStorage(storage);
  } else if (storage && transition === 'residue') {
    removeKeys(storage, (key) => isUserScopedKey(key) && (nextUid === null
      ? !key.startsWith(LAST_WORKSPACE_PREFIX)
      : !ownsKey(key, nextUid)));
  }
  if (nextUid) writeLocalSessionOwner(nextUid, storage);
  return transition;
};
