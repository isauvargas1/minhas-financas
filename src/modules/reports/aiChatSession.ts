import {useCallback, useEffect, useSyncExternalStore} from 'react';

import {readLocalSessionOwner, resolveBrowserStorage} from '../../lib/sessionCleanup.ts';
import {
  readAiChatHistory,
  removeAiChatHistory,
  writeAiChatHistory,
  type AiChatMessage,
  type AiChatScope,
} from './aiChatStorage.ts';

/**
 * Sessões do chat de IA (P5-A, PR-AI-04).
 *
 * Cada par (uid, workspace) tem um registro em memória, hidratado do
 * `localStorage` uma única vez e antes de qualquer gravação. O registro tem
 * uma geração: fechar a sessão (troca de workspace ou de conta, desmontagem
 * do chat) ou limpar o histórico avança a geração, e uma resposta só entra no
 * histórico se a geração, o escopo e a época capturados no envio ainda forem
 * os atuais. A época global avança no logout, na troca de conta e quando
 * outra aba encerra ou troca a sessão (`reset`).
 *
 * Gravar exige que a conta dona dos dados locais (`readLocalSessionOwner`,
 * mantida pelo `AuthContext` a partir do Firebase Auth) seja o uid do escopo:
 * depois do logout — nesta aba ou em outra — nenhuma resposta atrasada volta a
 * gravar histórico. Sem armazenamento (modo privado, cota cheia), o chat segue
 * só em memória, sem misturar contextos.
 *
 * Uma chamada já enviada pode ter consumido crédito no servidor; descartar a
 * resposta não cancela a operação nem devolve o crédito.
 */

/** Falha inesperada fora do wrapper da API (o wrapper devolve a mensagem do backend). */
export const AI_CHAT_UNEXPECTED_ERROR_TEXT =
  'Não foi possível consultar a IA agora. Tente novamente mais tarde.';

/** Chave de renderização quando não há sessão (identidade ou workspace indefinidos). */
export const NO_AI_CHAT_SESSION = 'sem-sessao';

export interface AiChatSnapshot {
  readonly messages: readonly AiChatMessage[];
  readonly isLoading: boolean;
  readonly isError: boolean;
}

export interface AiChatRequestToken {
  readonly key: string;
  readonly generation: number;
  readonly epoch: number;
  readonly requestId: string;
}

export type AiChatOutcome =
  | {readonly kind: 'answer'; readonly text: string}
  | {readonly kind: 'error'; readonly text: string};

export interface AiChatSessionStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: (scope: AiChatScope | null) => AiChatSnapshot;
  beginRequest: (scope: AiChatScope, question: string) => AiChatRequestToken;
  completeRequest: (token: AiChatRequestToken, outcome: AiChatOutcome) => boolean;
  closeSession: (scope: AiChatScope) => void;
  clear: (scope: AiChatScope) => void;
  reset: () => void;
}

export interface AiChatSessionStoreOptions {
  storage?: () => Storage | null;
  sessionOwner?: () => string | null;
  newId?: () => string;
  now?: () => string;
}

interface SessionRecord {
  readonly scope: AiChatScope;
  readonly generation: number;
  readonly messages: readonly AiChatMessage[];
  readonly pending: ReadonlySet<string>;
  readonly failed: boolean;
  readonly snapshot: AiChatSnapshot;
}

const NO_MESSAGES: readonly AiChatMessage[] = Object.freeze([]);
const NO_PENDING: ReadonlySet<string> = new Set();
const EMPTY_SNAPSHOT: AiChatSnapshot = Object.freeze({
  messages: NO_MESSAGES,
  isLoading: false,
  isError: false,
});

let fallbackSequence = 0;
const defaultNewId = (): string => {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  fallbackSequence += 1;
  return `${Date.now().toString(36)}-${fallbackSequence.toString(36)}`;
};

export const createAiChatSessionStore = (
  options: AiChatSessionStoreOptions = {},
): AiChatSessionStore => {
  const storage = options.storage ?? resolveBrowserStorage;
  const sessionOwner = options.sessionOwner ?? (() => readLocalSessionOwner(storage()));
  const newId = options.newId ?? defaultNewId;
  const now = options.now ?? (() => new Date().toISOString());

  let epoch = 0;
  const records = new Map<string, SessionRecord>();
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of [...listeners]) listener();
  };

  const save = (
    scope: AiChatScope,
    generation: number,
    messages: readonly AiChatMessage[],
    pending: ReadonlySet<string>,
    failed: boolean,
  ): SessionRecord => {
    const record: SessionRecord = Object.freeze({
      scope,
      generation,
      messages,
      pending,
      failed,
      snapshot: Object.freeze({messages, isLoading: pending.size > 0, isError: failed}),
    });
    records.set(scope.key, record);
    return record;
  };

  const ownsLocalData = (scope: AiChatScope) => sessionOwner() === scope.uid;

  /*
   * Hidratação: o registro do escopo nasce lendo o armazenamento, antes de
   * qualquer gravação — não existe salvar "antes de carregar". Escopo sem
   * histórico (ou de outra conta local) nasce vazio.
   */
  const hydrate = (scope: AiChatScope): SessionRecord => {
    const existing = records.get(scope.key);
    if (existing) return existing;
    const messages = ownsLocalData(scope)
      ? readAiChatHistory(storage(), scope).messages
      : NO_MESSAGES;
    return save(scope, 0, messages, NO_PENDING, false);
  };

  const persist = (record: SessionRecord) => {
    if (!ownsLocalData(record.scope)) return;
    writeAiChatHistory(storage(), record.scope, record.messages);
  };

  const message = (type: AiChatMessage['type'], text: string): AiChatMessage =>
    Object.freeze({id: newId(), type, text, timestamp: now()});

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getSnapshot: (scope) => (scope ? hydrate(scope).snapshot : EMPTY_SNAPSHOT),

    beginRequest: (scope, question) => {
      const record = hydrate(scope);
      const requestId = newId();
      const next = save(
        scope,
        record.generation,
        Object.freeze([...record.messages, message('user', question)]),
        new Set([...record.pending, requestId]),
        false,
      );
      persist(next);
      notify();
      return Object.freeze({key: scope.key, generation: next.generation, epoch, requestId});
    },

    completeRequest: (token, outcome) => {
      const record = records.get(token.key);
      if (
        !record ||
        token.epoch !== epoch ||
        token.generation !== record.generation ||
        !record.pending.has(token.requestId)
      ) {
        return false;
      }
      const pending = new Set(record.pending);
      pending.delete(token.requestId);
      const next = save(
        record.scope,
        record.generation,
        Object.freeze([...record.messages, message('ai', outcome.text)]),
        pending,
        outcome.kind === 'error',
      );
      persist(next);
      notify();
      return true;
    },

    closeSession: (scope) => {
      const record = records.get(scope.key);
      if (!record) return;
      save(scope, record.generation + 1, record.messages, NO_PENDING, false);
      notify();
    },

    clear: (scope) => {
      const record = hydrate(scope);
      save(scope, record.generation + 1, NO_MESSAGES, NO_PENDING, false);
      removeAiChatHistory(storage(), scope);
      notify();
    },

    reset: () => {
      epoch += 1;
      records.clear();
      notify();
    },
  };
};

/** Sessões do chat neste navegador. */
export const aiChatSessionStore = createAiChatSessionStore();

/**
 * Logout, troca de conta ou sessão encerrada em outra aba: invalida toda
 * resposta pendente e descarta o histórico em memória.
 */
export const resetAiChatSessions = (): void => aiChatSessionStore.reset();

export type AskFinanceAI<TContext> = (
  question: string,
  context: TContext,
  workspaceId: string,
  idempotencyKey: string,
) => Promise<{answer: string}>;

export interface ScopedAiChat<TContext> {
  history: readonly AiChatMessage[];
  isLoading: boolean;
  isError: boolean;
  /** `false` enquanto a conta ou o workspace estão indefinidos: nada é enviado. */
  isReady: boolean;
  /** Muda com o escopo; usada como `key` para não reaproveitar nós de outro contexto. */
  sessionKey: string;
  /**
   * `idempotencyKey` é da intenção: o chamador a gera no momento em que a
   * pessoa confirma o envio ao provedor de IA.
   */
  sendQuestion: (question: string, context: TContext, idempotencyKey: string) => void;
  clearHistory: () => void;
}

/**
 * Chat de IA de um escopo. O histórico exibido sai sempre do registro do
 * escopo da renderização atual (`useSyncExternalStore`), então a troca de
 * workspace não mostra nem por um quadro o histórico anterior; cada envio
 * captura escopo, geração e época, e só a resposta ainda válida entra.
 */
export const useScopedAiChat = <TContext>(
  scope: AiChatScope | null,
  ask: AskFinanceAI<TContext>,
  store: AiChatSessionStore = aiChatSessionStore,
): ScopedAiChat<TContext> => {
  const getSnapshot = useCallback(() => store.getSnapshot(scope), [store, scope]);
  const snapshot = useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
  const sessionKey = scope?.key ?? NO_AI_CHAT_SESSION;

  useEffect(() => {
    if (!scope) return undefined;
    const opened = scope;
    // Ao sair deste escopo (outro workspace, outra conta, desmontagem), as
    // respostas ainda pendentes dele deixam de valer.
    return () => store.closeSession(opened);
    // O ciclo é do escopo (a chave), não da identidade do objeto `scope`.
  }, [store, sessionKey]);

  const sendQuestion = useCallback((question: string, context: TContext, idempotencyKey: string) => {
    if (!scope || !question.trim() || !idempotencyKey) return;
    const token = store.beginRequest(scope, question);
    let answer: Promise<{answer: string}>;
    try {
      answer = Promise.resolve(ask(question, context, scope.workspaceId, idempotencyKey));
    } catch (error) {
      answer = Promise.reject(error);
    }
    answer.then(
      (result) => {
        store.completeRequest(token, typeof result?.answer === 'string'
          ? {kind: 'answer', text: result.answer}
          : {kind: 'error', text: AI_CHAT_UNEXPECTED_ERROR_TEXT});
      },
      () => {
        store.completeRequest(token, {kind: 'error', text: AI_CHAT_UNEXPECTED_ERROR_TEXT});
      },
    );
  }, [store, scope, ask]);

  const clearHistory = useCallback(() => {
    if (scope) store.clear(scope);
  }, [store, scope]);

  return {
    history: snapshot.messages,
    isLoading: snapshot.isLoading,
    isError: snapshot.isError,
    isReady: scope !== null,
    sessionKey,
    sendQuestion,
    clearHistory,
  };
};
