/**
 * Histórico local do chat de IA (P5-A, PR-AI-04).
 *
 * Decisão de produto: o histórico fica no navegador (`localStorage`), isolado
 * por usuário autenticado e workspace, e é apagado no logout. Este módulo é a
 * única porta para esse armazenamento: escopo, chave, envelope, validação,
 * leitura, gravação, remoção e expurgo do formato obsoleto. Quem decide
 * *quando* gravar (sessão autenticada, contexto ativo) é
 * `src/modules/reports/aiChatSession.ts`.
 *
 * `localStorage` não é cofre: o isolamento é lógico, por sessão, não
 * criptográfico. Qualquer script da mesma origem, extensão do navegador ou
 * pessoa com acesso ao perfil do navegador lê o conteúdo.
 *
 * Módulo puro: não importa React nem o SDK do Firebase.
 */

export const AI_CHAT_HISTORY_VERSION = 2 as const;

/** Prefixo do formato atual: `finance_ai_chat_history_v2:<uid>:<workspaceId>`. */
export const AI_CHAT_HISTORY_KEY_PREFIX = 'finance_ai_chat_history_v2:';

/**
 * Raiz comum a todos os formatos, atual e obsoletos. A limpeza da sessão
 * (`src/lib/sessionCleanup.ts`) remove tudo que começa assim.
 */
export const AI_CHAT_HISTORY_ROOT = 'finance_ai_chat_history_';

export type AiChatMessageType = 'user' | 'ai';

export interface AiChatMessage {
  readonly id: string;
  readonly type: AiChatMessageType;
  readonly text: string;
  readonly timestamp: string;
}

/** Contexto dono de um histórico. Só nasce por `resolveAiChatScope`. */
export interface AiChatScope {
  readonly uid: string;
  readonly workspaceId: string;
  readonly key: string;
}

export type AiChatReadStatus = 'empty' | 'restored' | 'invalid' | 'unavailable';

export interface AiChatReadResult {
  readonly status: AiChatReadStatus;
  readonly messages: readonly AiChatMessage[];
}

const MAX_IDENTIFIER_LENGTH = 256;
const MAX_MESSAGE_ID_LENGTH = 128;
/*
 * O texto não tem teto de validação: a interface aceita qualquer pergunta
 * digitada e a guarda como enviou. Um teto aqui faria um histórico legítimo
 * ser descartado inteiro na próxima leitura. O limite real é a cota do
 * navegador; quando ela recusa, o histórico segue só em memória.
 */
const MAX_TIMESTAMP_LENGTH = 64;
/** Valores que denunciam contexto ainda não resolvido (carregando, ausente). */
const PLACEHOLDER_IDENTIFIERS = new Set(['undefined', 'null', 'loading']);
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

const isIdentifier = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= MAX_IDENTIFIER_LENGTH &&
  value.trim() === value &&
  !PLACEHOLDER_IDENTIFIERS.has(value) &&
  !CONTROL_CHARACTERS.test(value);

/*
 * `encodeURIComponent` escapa `:` e `%`, então o separador nunca aparece
 * dentro de uma parte e a chave é injetiva: pares (uid, workspace) diferentes
 * nunca colidem, mesmo com `:`, `_` ou `%` nos identificadores. Um texto mal
 * formado (surrogate isolado) faz a função lançar: o contexto é recusado.
 */
const encodePart = (value: string): string | null => {
  try {
    return encodeURIComponent(value);
  } catch {
    return null;
  }
};

/**
 * Escopo do histórico a partir do uid da sessão do Firebase Auth e do
 * workspace ativo. Devolve `null` enquanto qualquer um deles estiver
 * indefinido, carregando ou inválido: sem escopo, nada é lido nem gravado.
 */
export const resolveAiChatScope = (uid: unknown, workspaceId: unknown): AiChatScope | null => {
  if (!isIdentifier(uid) || !isIdentifier(workspaceId)) return null;
  const encodedUid = encodePart(uid);
  const encodedWorkspace = encodePart(workspaceId);
  if (encodedUid === null || encodedWorkspace === null) return null;
  return Object.freeze({
    uid,
    workspaceId,
    key: `${AI_CHAT_HISTORY_KEY_PREFIX}${encodedUid}:${encodedWorkspace}`,
  });
};

/**
 * A chave é histórico (formato atual) desta conta? Usado pela limpeza de
 * resíduos para preservar só o que é da conta que abriu o aplicativo. Como
 * as partes são escapadas, o prefixo `v2:<uid>:` não casa com outro uid.
 */
export const isAiChatHistoryKeyOf = (key: string, uid: string): boolean => {
  const encodedUid = encodePart(uid);
  return encodedUid !== null && key.startsWith(`${AI_CHAT_HISTORY_KEY_PREFIX}${encodedUid}:`);
};

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const MESSAGE_KEYS = ['id', 'type', 'text', 'timestamp'] as const;
const ENVELOPE_KEYS = ['v', 'uid', 'workspaceId', 'messages'] as const;

export const isAiChatMessage = (value: unknown): value is AiChatMessage => {
  if (!isPlainObject(value) || !hasExactKeys(value, MESSAGE_KEYS)) return false;
  const {id, type, text, timestamp} = value;
  return (
    typeof id === 'string' && id.length > 0 && id.length <= MAX_MESSAGE_ID_LENGTH &&
    (type === 'user' || type === 'ai') &&
    typeof text === 'string' &&
    typeof timestamp === 'string' && timestamp.length <= MAX_TIMESTAMP_LENGTH &&
    !Number.isNaN(Date.parse(timestamp))
  );
};

/**
 * Envelope persistido. Carrega o próprio escopo: um conteúdo copiado de
 * outra chave (outro usuário, outro workspace) é recusado na leitura.
 */
const parseEnvelope = (raw: string, scope: AiChatScope): readonly AiChatMessage[] | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed) || !hasExactKeys(parsed, ENVELOPE_KEYS)) return null;
  if (parsed.v !== AI_CHAT_HISTORY_VERSION) return null;
  if (parsed.uid !== scope.uid || parsed.workspaceId !== scope.workspaceId) return null;
  const {messages} = parsed;
  if (!Array.isArray(messages) || !messages.every(isAiChatMessage)) return null;
  return Object.freeze(messages.map((message) => Object.freeze({...message})));
};

const EMPTY: readonly AiChatMessage[] = Object.freeze([]);

/**
 * Lê o histórico do escopo. Conteúdo inválido (JSON quebrado, estrutura
 * estranha, escopo de outro usuário ou workspace) nunca vira histórico: é
 * descartado e a chave do próprio escopo é apagada. Armazenamento
 * indisponível devolve histórico vazio, sem lançar.
 */
export const readAiChatHistory = (storage: Storage | null, scope: AiChatScope): AiChatReadResult => {
  if (!storage) return {status: 'unavailable', messages: EMPTY};
  let raw: string | null;
  try {
    raw = storage.getItem(scope.key);
  } catch {
    return {status: 'unavailable', messages: EMPTY};
  }
  if (raw === null) return {status: 'empty', messages: EMPTY};
  const messages = parseEnvelope(raw, scope);
  if (messages === null) {
    removeAiChatHistory(storage, scope);
    return {status: 'invalid', messages: EMPTY};
  }
  return {status: messages.length > 0 ? 'restored' : 'empty', messages};
};

/**
 * Grava o histórico do escopo; lista vazia apaga a chave. Devolve `false`
 * quando o navegador recusa (cota cheia, `SecurityError`): o chamador mantém
 * o histórico só em memória, sem apagar nada.
 */
export const writeAiChatHistory = (
  storage: Storage | null,
  scope: AiChatScope,
  messages: readonly AiChatMessage[],
): boolean => {
  if (!storage) return false;
  if (messages.length === 0) return removeAiChatHistory(storage, scope);
  try {
    storage.setItem(scope.key, JSON.stringify({
      v: AI_CHAT_HISTORY_VERSION,
      uid: scope.uid,
      workspaceId: scope.workspaceId,
      messages,
    }));
    return true;
  } catch {
    return false;
  }
};

export const removeAiChatHistory = (storage: Storage | null, scope: AiChatScope): boolean => {
  if (!storage) return false;
  try {
    storage.removeItem(scope.key);
    return true;
  } catch {
    return false;
  }
};

/**
 * Expurgo do formato obsoleto (`finance_ai_chat_history_<workspaceId>`, sem
 * usuário). Não é migração: o conteúdo nunca é lido, convertido nem
 * importado — a chave só é apagada. Idempotente; não toca o formato atual nem
 * qualquer outra chave do navegador.
 */
export const purgeObsoleteAiChatHistory = (storage: Storage | null): string[] => {
  if (!storage) return [];
  const doomed: string[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key && key.startsWith(AI_CHAT_HISTORY_ROOT) && !key.startsWith(AI_CHAT_HISTORY_KEY_PREFIX)) {
        doomed.push(key);
      }
    }
  } catch {
    // Enumeração negada: remove o que já foi identificado.
  }
  const removed: string[] = [];
  for (const key of doomed) {
    try {
      storage.removeItem(key);
      removed.push(key);
    } catch {
      // Segue para as demais.
    }
  }
  return removed;
};
