import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement, StrictMode, type ReactElement} from 'react';
import TestRenderer, {type ReactTestRenderer} from 'react-test-renderer';

import {
  LOCAL_SESSION_OWNER_KEY,
  clearUserScopedStorage,
  ownsLastWorkspaceKey,
  reconcileLocalSession,
  resolveBrowserStorage,
  type LocalKeyOwnership,
} from '../../src/lib/sessionCleanup.ts';
import {
  AI_CHAT_HISTORY_KEY_PREFIX,
  isAiChatHistoryKeyOf,
  purgeObsoleteAiChatHistory,
  readAiChatHistory,
  resolveAiChatScope,
  writeAiChatHistory,
  type AiChatScope,
} from '../../src/modules/reports/aiChatStorage.ts';
import {
  AI_CHAT_UNEXPECTED_ERROR_TEXT,
  NO_AI_CHAT_SESSION,
  createAiChatSessionStore,
  useScopedAiChat,
  type AiChatSessionStore,
  type ScopedAiChat,
} from '../../src/modules/reports/aiChatSession.ts';

/*
 * P5-A (PR-AI-04): histórico do chat de IA isolado por (uid, workspace).
 * Os hooks rodam de verdade (React 18 + react-test-renderer, sem DOM); a
 * resposta da IA é uma promessa controlada pelo teste — o provedor nunca é
 * chamado. O `Storage` falso registra cada operação para provar a ordem
 * leitura → gravação e a ausência de gravações fora do contexto.
 */
(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

const TIMESTAMP = '2026-10-08T12:00:00.000Z';

class FakeStorage implements Storage {
  #entries = new Map<string, string>();
  log: string[] = [];
  fail = {get: false, set: false, remove: false, enumerate: false};

  constructor(initial: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(initial)) this.#entries.set(key, value);
  }

  get length(): number {
    if (this.fail.enumerate) throw new DOMException('acesso negado', 'SecurityError');
    return this.#entries.size;
  }

  key(index: number): string | null {
    if (this.fail.enumerate) throw new DOMException('acesso negado', 'SecurityError');
    return [...this.#entries.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    this.log.push(`get ${key}`);
    if (this.fail.get) throw new DOMException('acesso negado', 'SecurityError');
    return this.#entries.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.log.push(`set ${key}`);
    if (this.fail.set) throw new DOMException('cota excedida', 'QuotaExceededError');
    this.#entries.set(key, String(value));
  }

  removeItem(key: string): void {
    this.log.push(`remove ${key}`);
    if (this.fail.remove) throw new DOMException('acesso negado', 'SecurityError');
    this.#entries.delete(key);
  }

  clear(): void {
    this.#entries.clear();
  }

  /** Leitura sem registro, para as asserções. */
  peek(key: string): string | null {
    return this.#entries.get(key) ?? null;
  }

  keys(): string[] {
    return [...this.#entries.keys()];
  }

  [name: string]: unknown;
}

const scopeOf = (uid: string, workspaceId: string): AiChatScope => {
  const scope = resolveAiChatScope(uid, workspaceId);
  assert.ok(scope, `escopo válido para ${uid}/${workspaceId}`);
  return scope;
};

const A_PF = scopeOf('uid-a', 'ws-pf');
const A_PJ = scopeOf('uid-a', 'ws-pj');
const B_PF = scopeOf('uid-b', 'ws-pf');

const envelope = (scope: AiChatScope, texts: string[]): string => JSON.stringify({
  v: 2,
  uid: scope.uid,
  workspaceId: scope.workspaceId,
  messages: texts.map((text, index) => ({
    id: `seed-${index}`,
    type: index % 2 === 0 ? 'user' : 'ai',
    text,
    timestamp: TIMESTAMP,
  })),
});

const storedTexts = (storage: FakeStorage, scope: AiChatScope): string[] | null => {
  const raw = storage.peek(scope.key);
  if (raw === null) return null;
  return (JSON.parse(raw) as {messages: Array<{text: string}>}).messages.map((message) => message.text);
};

const setup = (owner: string | null = 'uid-a', initial: Record<string, string> = {}) => {
  const storage = new FakeStorage({
    ...(owner ? {[LOCAL_SESSION_OWNER_KEY]: owner} : {}),
    ...initial,
  });
  let counter = 0;
  const store = createAiChatSessionStore({
    storage: () => storage,
    newId: () => {
      counter += 1;
      return `id-${counter}`;
    },
    now: () => TIMESTAMP,
  });
  return {storage, store};
};

interface PendingCall {
  question: string;
  workspaceId: string;
  idempotencyKey: string;
  resolve: (value: {answer: string}) => void;
  reject: (reason: unknown) => void;
}

const controlledAsk = () => {
  const calls: PendingCall[] = [];
  const ask = (question: string, _context: unknown, workspaceId: string, idempotencyKey: string) =>
    new Promise<{answer: string}>((resolve, reject) => {
      calls.push({question, workspaceId, idempotencyKey, resolve, reject});
    });
  return {ask, calls};
};

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

interface RenderLog {
  sessionKey: string;
  texts: string[];
  isLoading: boolean;
}

const mountChat = async (options: {
  scope: AiChatScope | null;
  store: AiChatSessionStore;
  ask: (
    question: string,
    context: unknown,
    workspaceId: string,
    idempotencyKey: string,
  ) => Promise<{answer: string}>;
  strict?: boolean;
}) => {
  const renders: RenderLog[] = [];
  let latest: ScopedAiChat<unknown> | null = null;
  const Probe = ({scope}: {scope: AiChatScope | null}) => {
    const chat = useScopedAiChat<unknown>(scope, options.ask, options.store);
    latest = chat;
    renders.push({
      sessionKey: chat.sessionKey,
      texts: chat.history.map((message) => message.text),
      isLoading: chat.isLoading,
    });
    return null;
  };
  const element = (scope: AiChatScope | null): ReactElement => (options.strict
    ? createElement(StrictMode, null, createElement(Probe, {scope}))
    : createElement(Probe, {scope}));
  let renderer: ReactTestRenderer | null = null;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(element(options.scope));
  });
  const current = (): ScopedAiChat<unknown> => {
    assert.ok(latest, 'chat renderizado');
    return latest;
  };
  return {
    renders,
    get chat() {
      return current();
    },
    texts: () => current().history.map((message) => message.text),
    setScope: async (scope: AiChatScope | null) => {
      await TestRenderer.act(async () => {
        renderer!.update(element(scope));
      });
    },
    send: async (question: string, idempotencyKey = `chave-${question}`) => {
      await TestRenderer.act(async () => {
        current().sendQuestion(question, {}, idempotencyKey);
      });
    },
    clear: async () => {
      await TestRenderer.act(async () => {
        current().clearHistory();
      });
    },
    unmount: async () => {
      await TestRenderer.act(async () => {
        renderer!.unmount();
      });
    },
    answer: async (call: PendingCall, text: string) => {
      await TestRenderer.act(async () => {
        call.resolve({answer: text});
        await flush();
      });
    },
    fail: async (call: PendingCall) => {
      await TestRenderer.act(async () => {
        call.reject(new Error('falha de rede simulada'));
        await flush();
      });
    },
  };
};

/** Nenhuma renderização de um escopo pode conter texto de outro escopo. */
const assertRendersIsolated = (renders: RenderLog[], forbidden: Record<string, string[]>) => {
  for (const render of renders) {
    for (const text of forbidden[render.sessionKey] ?? []) {
      assert.ok(!render.texts.includes(text), `"${text}" apareceu na renderização de ${render.sessionKey}`);
    }
  }
};

// --- 1–3: identificação inequívoca ----------------------------------------

test('1. uid diferente no mesmo workspace gera chaves distintas, no formato v2', () => {
  assert.notEqual(A_PF.key, B_PF.key);
  assert.ok(A_PF.key.startsWith(AI_CHAT_HISTORY_KEY_PREFIX));
  assert.equal(A_PF.key, `${AI_CHAT_HISTORY_KEY_PREFIX}uid-a:ws-pf`);
});

test('2. mesmo uid em workspaces diferentes gera chaves distintas', () => {
  assert.notEqual(A_PF.key, A_PJ.key);
});

test('3. separadores nos identificadores não causam colisão; contexto indefinido é recusado', () => {
  const pairs: Array<[string, string]> = [
    ['a:b', 'c'], ['a', 'b:c'],
    ['a%3Ab', 'c'], ['a', '%3Ab:c'],
    ['a_b', 'c'], ['a', 'b_c'],
    ['a/b', 'c'], ['a', 'b/c'],
    ['a', 'b'], ['a:', 'b'], ['a', ':b'],
  ];
  const keys = pairs.map(([uid, workspaceId]) => scopeOf(uid, workspaceId).key);
  assert.equal(new Set(keys).size, pairs.length, 'todas as chaves distintas');

  for (const [uid, workspaceId] of [
    ['', 'ws'], ['uid', ''], ['loading', 'ws'], ['uid', 'loading'],
    ['undefined', 'ws'], ['uid', 'null'], [' uid', 'ws'], ['uid', 'ws '],
    ['ui\u0000d', 'ws'], ['uid', '\uD800'], ['x'.repeat(257), 'ws'],
  ]) {
    assert.equal(resolveAiChatScope(uid, workspaceId), null, `${JSON.stringify(uid)}/${JSON.stringify(workspaceId)}`);
  }
  for (const value of [null, undefined, 42, {}, ['uid']]) {
    assert.equal(resolveAiChatScope(value, 'ws'), null);
    assert.equal(resolveAiChatScope('uid', value), null);
  }
});

// --- 4–7: carga e troca de workspace ---------------------------------------

test('4. carrega o histórico do próprio escopo', async () => {
  const {store} = setup('uid-a', {
    [A_PF.key]: envelope(A_PF, ['pergunta PF', 'resposta PF']),
    [A_PJ.key]: envelope(A_PJ, ['pergunta PJ']),
  });
  const chat = await mountChat({scope: A_PF, store, ask: controlledAsk().ask});
  assert.deepEqual(chat.texts(), ['pergunta PF', 'resposta PF']);
  assert.equal(chat.chat.sessionKey, A_PF.key);
});

test('5. contexto sem registro começa vazio e nada é gravado', async () => {
  const {storage, store} = setup();
  const chat = await mountChat({scope: A_PJ, store, ask: controlledAsk().ask});
  assert.deepEqual(chat.texts(), []);
  assert.ok(!storage.log.some((entry) => entry.startsWith('set ') || entry.startsWith('remove ')));
});

test('6. PF → PJ sem histórico: PJ vazio desde a primeira renderização e nada gravado no PJ', async () => {
  const {storage, store} = setup('uid-a', {[A_PF.key]: envelope(A_PF, ['segredo PF', 'resposta PF'])});
  const chat = await mountChat({scope: A_PF, store, ask: controlledAsk().ask});
  await chat.setScope(A_PJ);
  assert.deepEqual(chat.texts(), []);
  assertRendersIsolated(chat.renders, {[A_PJ.key]: ['segredo PF', 'resposta PF']});
  assert.ok(chat.renders.some((render) => render.sessionKey === A_PJ.key));
  assert.ok(!storage.log.includes(`set ${A_PJ.key}`), 'PJ nunca gravado');
  assert.deepEqual(storedTexts(storage, A_PF), ['segredo PF', 'resposta PF'], 'PF preservado');
});

test('7. PJ → PF restaura o histórico certo, também com os dois já preenchidos', async () => {
  const {storage, store} = setup('uid-a', {
    [A_PF.key]: envelope(A_PF, ['só PF']),
    [A_PJ.key]: envelope(A_PJ, ['só PJ']),
  });
  const chat = await mountChat({scope: A_PF, store, ask: controlledAsk().ask});
  await chat.setScope(A_PJ);
  assert.deepEqual(chat.texts(), ['só PJ']);
  await chat.setScope(A_PF);
  assert.deepEqual(chat.texts(), ['só PF']);
  assertRendersIsolated(chat.renders, {[A_PF.key]: ['só PJ'], [A_PJ.key]: ['só PF']});
  assert.deepEqual(storedTexts(storage, A_PF), ['só PF']);
  assert.deepEqual(storedTexts(storage, A_PJ), ['só PJ']);
});

// --- 8–12: contas, logout e resíduos ----------------------------------------

test('8. troca A → B no mesmo workspace: B não vê nem herda nada de A', async () => {
  const {storage, store} = setup('uid-a', {[A_PF.key]: envelope(A_PF, ['privado de A'])});
  const chat = await mountChat({scope: A_PF, store, ask: controlledAsk().ask});
  assert.equal(reconcileLocalSession('uid-a', 'uid-b', storage), 'account-switch');
  store.reset();
  await chat.setScope(B_PF);
  assert.deepEqual(chat.texts(), []);
  assertRendersIsolated(chat.renders, {[B_PF.key]: ['privado de A']});
  assert.equal(storage.peek(A_PF.key), null, 'histórico de A apagado na troca');
  assert.equal(storage.peek(LOCAL_SESSION_OWNER_KEY), 'uid-b');
});

test('9. A → B → A: nenhum histórico atravessa as trocas', async () => {
  const {storage, store} = setup('uid-a', {[A_PF.key]: envelope(A_PF, ['privado de A'])});
  const {ask, calls} = controlledAsk();
  const chat = await mountChat({scope: A_PF, store, ask});
  reconcileLocalSession('uid-a', 'uid-b', storage);
  store.reset();
  await chat.setScope(B_PF);
  await chat.send('privado de B');
  await chat.answer(calls[0], 'resposta para B');
  assert.deepEqual(chat.texts(), ['privado de B', 'resposta para B']);

  assert.equal(reconcileLocalSession('uid-b', 'uid-a', storage), 'account-switch');
  store.reset();
  await chat.setScope(A_PF);
  assert.deepEqual(chat.texts(), []);
  assertRendersIsolated(chat.renders, {
    [A_PF.key]: ['privado de B', 'resposta para B'],
    [B_PF.key]: ['privado de A'],
  });
  assert.equal(storage.peek(B_PF.key), null);
  assert.equal(storage.peek(A_PF.key), null);
});

test('10. logout apaga todo histórico local (atual e obsoleto) e invalida o que está pendente', async () => {
  const {storage, store} = setup('uid-a', {
    [A_PF.key]: envelope(A_PF, ['pergunta PF']),
    [A_PJ.key]: envelope(A_PJ, ['pergunta PJ']),
    'finance_ai_chat_history_ws-pf': '[]',
    'lastWorkspaceId_uid-a': 'ws-pf',
    'app-theme': 'dark',
  });
  const {ask, calls} = controlledAsk();
  const chat = await mountChat({scope: A_PF, store, ask});
  await chat.send('pendente no logout');

  clearUserScopedStorage(storage);
  store.reset();
  const writesBefore = storage.log.length;
  await chat.answer(calls[0], 'resposta depois do logout');

  assert.deepEqual(storage.keys(), ['app-theme']);
  assert.ok(!storage.log.slice(writesBefore).some((entry) => entry.startsWith('set ')));
  assert.ok(!chat.texts().includes('resposta depois do logout'));
});

test('11. primeira carga como B com resíduos de A apaga tudo antes de abrir', async () => {
  const {storage} = setup('uid-a', {
    [A_PF.key]: envelope(A_PF, ['privado de A']),
    'finance_ai_chat_history_ws-pf': '[{"text":"formato antigo"}]',
    'lastWorkspaceId_uid-a': 'ws-pf',
    'app-theme': 'light',
  });
  assert.equal(reconcileLocalSession(null, 'uid-b', storage), 'residue');
  assert.deepEqual(storage.keys().sort(), ['app-theme', LOCAL_SESSION_OWNER_KEY].sort());
  assert.equal(storage.peek(LOCAL_SESSION_OWNER_KEY), 'uid-b');

  let counter = 0;
  const store = createAiChatSessionStore({storage: () => storage, newId: () => `n${++counter}`});
  const chat = await mountChat({scope: B_PF, store, ask: controlledAsk().ask});
  assert.deepEqual(chat.texts(), []);

  // Dono desconhecido (marcador ausente) também é resíduo; sem sessão, idem.
  const unknownOwner = new FakeStorage({[A_PF.key]: envelope(A_PF, ['x']), 'app-theme': 'dark'});
  assert.equal(reconcileLocalSession(null, 'uid-a', unknownOwner), 'residue');
  assert.equal(unknownOwner.peek(A_PF.key), null);
  const signedOut = new FakeStorage({
    [LOCAL_SESSION_OWNER_KEY]: 'uid-a', [A_PF.key]: envelope(A_PF, ['x']), 'app-theme': 'dark',
  });
  assert.equal(reconcileLocalSession(null, null, signedOut), 'residue');
  assert.deepEqual(signedOut.keys(), ['app-theme']);

  // A mesma conta numa recarga mantém o histórico.
  const sameAccount = new FakeStorage({[LOCAL_SESSION_OWNER_KEY]: 'uid-a', [A_PF.key]: envelope(A_PF, ['meu'])});
  assert.equal(reconcileLocalSession(null, 'uid-a', sameAccount), 'same-account');
  assert.notEqual(sameAccount.peek(A_PF.key), null);
});

test('11b. carga nova da conta A sem dono local: preserva só o que é de A', () => {
  // O mesmo predicado de posse que o AuthContext usa.
  const ownsLocalKey: LocalKeyOwnership = (key, uid) =>
    ownsLastWorkspaceKey(key, uid) || isAiChatHistoryKeyOf(key, uid);
  const colliding = scopeOf('uid-a:x', 'ws');
  const storage = new FakeStorage({
    [A_PF.key]: envelope(A_PF, ['meu']),
    [B_PF.key]: envelope(B_PF, ['de B']),
    [colliding.key]: envelope(colliding, ['de outra conta com prefixo parecido']),
    'finance_ai_chat_history_ws-pf': '[]',
    'lastWorkspaceId_uid-a': 'ws-pf',
    'lastWorkspaceId_uid-b': 'ws-pf',
    'app_chat_messages_ws-pf': '[]',
    'app-theme': 'dark',
  });
  assert.equal(reconcileLocalSession(null, 'uid-a', storage, ownsLocalKey), 'residue');
  assert.deepEqual(
    storage.keys().sort(),
    [A_PF.key, 'lastWorkspaceId_uid-a', 'app-theme', LOCAL_SESSION_OWNER_KEY].sort(),
  );
  assert.equal(isAiChatHistoryKeyOf(colliding.key, 'uid-a'), false);
  assert.equal(isAiChatHistoryKeyOf(A_PF.key, 'uid-a'), true);
});

test('12. histórico antigo sem uid não é lido; o expurgo apaga só o formato obsoleto', async () => {
  const legacyKey = 'finance_ai_chat_history_ws-pf';
  const {storage, store} = setup('uid-a', {
    [legacyKey]: JSON.stringify([{id: '1', type: 'user', text: 'antigo de alguém', timestamp: TIMESTAMP}]),
    [A_PJ.key]: envelope(A_PJ, ['atual PJ']),
    'finance_ai_chat': 'outra coisa',
    'app-theme': 'dark',
  });
  const chat = await mountChat({scope: A_PF, store, ask: controlledAsk().ask});
  assert.deepEqual(chat.texts(), []);
  assert.ok(!storage.log.includes(`get ${legacyKey}`), 'chave antiga nunca consultada');

  assert.deepEqual(purgeObsoleteAiChatHistory(storage), [legacyKey]);
  assert.deepEqual(purgeObsoleteAiChatHistory(storage), [], 'idempotente');
  assert.deepEqual(storage.keys().sort(), [LOCAL_SESSION_OWNER_KEY, A_PJ.key, 'finance_ai_chat', 'app-theme'].sort());
});

// --- 13: limpar --------------------------------------------------------------

test('13. clearHistory remove só o escopo atual e permite recomeçar', async () => {
  const {storage, store} = setup('uid-a', {
    [A_PF.key]: envelope(A_PF, ['PF fica']),
    [A_PJ.key]: envelope(A_PJ, ['PJ sai']),
    [B_PF.key]: envelope(B_PF, ['de B fica']),
  });
  const {ask, calls} = controlledAsk();
  const chat = await mountChat({scope: A_PJ, store, ask});
  await chat.clear();
  assert.deepEqual(chat.texts(), []);
  assert.equal(storage.peek(A_PJ.key), null);
  assert.deepEqual(storedTexts(storage, A_PF), ['PF fica']);
  assert.deepEqual(storedTexts(storage, B_PF), ['de B fica']);

  await chat.send('conversa nova');
  await chat.answer(calls[0], 'resposta nova');
  assert.deepEqual(chat.texts(), ['conversa nova', 'resposta nova']);
  assert.deepEqual(storedTexts(storage, A_PJ), ['conversa nova', 'resposta nova']);
});

// --- 14–19: respostas atrasadas ----------------------------------------------

test('14. resposta do PF que chega depois da troca para PJ não aparece nem é gravada no PJ', async () => {
  const {storage, store} = setup();
  const {ask, calls} = controlledAsk();
  const chat = await mountChat({scope: A_PF, store, ask});
  await chat.send('pergunta PF');
  assert.equal(calls[0].workspaceId, 'ws-pf');
  await chat.setScope(A_PJ);
  await chat.answer(calls[0], 'resposta PF');
  assert.deepEqual(chat.texts(), []);
  assert.equal(chat.chat.isLoading, false);
  assert.ok(!storage.log.includes(`set ${A_PJ.key}`));
  assert.deepEqual(storedTexts(storage, A_PF), ['pergunta PF'], 'a sessão interrompida não recebe a resposta');
  assertRendersIsolated(chat.renders, {[A_PJ.key]: ['pergunta PF', 'resposta PF']});
});

test('15. resposta de A que chega depois da troca para B não aparece nem é gravada', async () => {
  const {storage, store} = setup();
  const {ask, calls} = controlledAsk();
  const chat = await mountChat({scope: A_PF, store, ask});
  await chat.send('pergunta de A');
  reconcileLocalSession('uid-a', 'uid-b', storage);
  store.reset();
  await chat.setScope(B_PF);
  const mark = storage.log.length;
  await chat.answer(calls[0], 'resposta de A');
  assert.deepEqual(chat.texts(), []);
  assert.ok(!storage.log.slice(mark).some((entry) => entry.startsWith('set ')));
  assert.equal(storage.peek(A_PF.key), null);
  assert.equal(storage.peek(B_PF.key), null);
});

test('16. resposta que chega depois de "Limpar Histórico" não recria mensagens', async () => {
  const {storage, store} = setup();
  const {ask, calls} = controlledAsk();
  const chat = await mountChat({scope: A_PF, store, ask});
  await chat.send('pergunta apagada');
  assert.equal(chat.chat.isLoading, true);
  await chat.clear();
  assert.equal(chat.chat.isLoading, false, 'carregamento da sessão apagada some');
  const mark = storage.log.length;
  await chat.answer(calls[0], 'resposta tardia');
  assert.deepEqual(chat.texts(), []);
  assert.equal(storage.peek(A_PF.key), null);
  assert.ok(!storage.log.slice(mark).some((entry) => entry.startsWith('set ')));
});

test('17. PF → PJ → PF: a resposta antiga continua inválida para a sessão interrompida', async () => {
  const {storage, store} = setup();
  const {ask, calls} = controlledAsk();
  const chat = await mountChat({scope: A_PF, store, ask});
  await chat.send('pergunta PF');
  await chat.setScope(A_PJ);
  await chat.setScope(A_PF);
  await chat.answer(calls[0], 'resposta velha');
  assert.deepEqual(chat.texts(), ['pergunta PF']);
  assert.equal(chat.chat.isLoading, false);
  assert.deepEqual(storedTexts(storage, A_PF), ['pergunta PF']);

  // A sessão nova funciona normalmente.
  await chat.send('pergunta nova');
  await chat.answer(calls[1], 'resposta nova');
  assert.deepEqual(chat.texts(), ['pergunta PF', 'pergunta nova', 'resposta nova']);
});

test('18. erro tardio de outro contexto não é anexado; erro do contexto atual é', async () => {
  const {storage, store} = setup();
  const {ask, calls} = controlledAsk();
  const chat = await mountChat({scope: A_PF, store, ask});
  await chat.send('pergunta PF');
  await chat.setScope(A_PJ);
  await chat.fail(calls[0]);
  assert.deepEqual(chat.texts(), []);
  assert.equal(chat.chat.isError, false);
  assert.ok(!storedTexts(storage, A_PF)?.includes(AI_CHAT_UNEXPECTED_ERROR_TEXT));

  await chat.send('pergunta PJ');
  await chat.fail(calls[1]);
  assert.deepEqual(chat.texts(), ['pergunta PJ', AI_CHAT_UNEXPECTED_ERROR_TEXT]);
  assert.equal(chat.chat.isError, true);
});

test('19. desmontar durante a requisição: o callback antigo não escreve nada', async () => {
  const {storage, store} = setup();
  const {ask, calls} = controlledAsk();
  const chat = await mountChat({scope: A_PF, store, ask});
  await chat.send('pergunta');
  await chat.unmount();
  const mark = storage.log.length;
  await TestRenderer.act(async () => {
    calls[0].resolve({answer: 'resposta órfã'});
    await flush();
  });
  assert.ok(!storage.log.slice(mark).some((entry) => entry.startsWith('set ')));
  assert.deepEqual(store.getSnapshot(A_PF).messages.map((message) => message.text), ['pergunta']);
  assert.equal(store.getSnapshot(A_PF).isLoading, false);
});

// --- 20–23: armazenamento ------------------------------------------------------

test('20. JSON inválido e envelopes de outro uid, workspace ou formato viram histórico vazio', async () => {
  const otherUser = envelope(B_PF, ['de B']);
  const otherWorkspace = envelope(A_PJ, ['do PJ']);
  const invalids: Array<[string, string]> = [
    ['JSON quebrado', '{"v":2,'],
    ['outro uid', otherUser],
    ['outro workspace', otherWorkspace],
    ['versão errada', JSON.stringify({...JSON.parse(envelope(A_PF, ['x'])), v: 1})],
    ['tipo desconhecido', JSON.stringify({v: 2, uid: 'uid-a', workspaceId: 'ws-pf', messages: [
      {id: '1', type: 'system', text: 'x', timestamp: TIMESTAMP}]})],
    ['campo extra', JSON.stringify({v: 2, uid: 'uid-a', workspaceId: 'ws-pf', messages: [], extra: 1})],
    ['mensagem com campo extra', JSON.stringify({v: 2, uid: 'uid-a', workspaceId: 'ws-pf', messages: [
      {id: '1', type: 'user', text: 'x', timestamp: TIMESTAMP, html: '<b>'}]})],
    ['timestamp inválido', JSON.stringify({v: 2, uid: 'uid-a', workspaceId: 'ws-pf', messages: [
      {id: '1', type: 'user', text: 'x', timestamp: 'ontem'}]})],
    ['array do formato antigo', JSON.stringify([{id: '1', type: 'user', text: 'x', timestamp: TIMESTAMP}])],
    ['valor primitivo', '42'],
  ];
  for (const [label, raw] of invalids) {
    const storage = new FakeStorage({[A_PF.key]: raw});
    const result = readAiChatHistory(storage, A_PF);
    assert.equal(result.status, 'invalid', label);
    assert.deepEqual(result.messages, [], label);
    assert.equal(storage.peek(A_PF.key), null, `${label}: chave inválida apagada`);
  }

  const {store} = setup('uid-a', {[A_PF.key]: otherUser});
  const chat = await mountChat({scope: A_PF, store, ask: controlledAsk().ask});
  assert.deepEqual(chat.texts(), []);
});

test('21. armazenamento indisponível ou recusando: o chat segue em memória sem lançar', async () => {
  // Sem `localStorage`.
  {
    const store = createAiChatSessionStore({storage: () => null});
    const {ask, calls} = controlledAsk();
    const chat = await mountChat({scope: A_PF, store, ask});
    await chat.send('em memória');
    await chat.answer(calls[0], 'resposta em memória');
    assert.deepEqual(chat.texts(), ['em memória', 'resposta em memória']);
  }
  // Leitura negada (SecurityError) e gravação recusada (QuotaExceededError).
  {
    const {storage, store} = setup('uid-a', {[A_PF.key]: envelope(A_PF, ['inacessível'])});
    storage.fail.get = true;
    storage.fail.set = true;
    const {ask, calls} = controlledAsk();
    const chat = await mountChat({scope: A_PF, store, ask});
    assert.deepEqual(chat.texts(), []);
    await chat.send('pergunta');
    await chat.answer(calls[0], 'resposta');
    assert.deepEqual(chat.texts(), ['pergunta', 'resposta']);
    storage.fail.get = false;
    assert.deepEqual(storedTexts(storage, A_PF), ['inacessível'], 'nada válido foi apagado');
    await chat.setScope(A_PJ);
    assert.deepEqual(chat.texts(), [], 'memória também separada por escopo');
  }
  // Escrita e remoção diretas não lançam.
  {
    const storage = new FakeStorage();
    storage.fail.set = true;
    storage.fail.remove = true;
    assert.equal(writeAiChatHistory(storage, A_PF, [{id: '1', type: 'user', text: 'x', timestamp: TIMESTAMP}]), false);
    assert.equal(writeAiChatHistory(storage, A_PF, []), false);
    storage.fail.enumerate = true;
    assert.deepEqual(purgeObsoleteAiChatHistory(storage), []);
    assert.deepEqual(clearUserScopedStorage(storage), []);
  }
  // `localStorage` cujo acesso lança.
  {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    try {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        get() {
          throw new DOMException('acesso negado', 'SecurityError');
        },
      });
      assert.equal(resolveBrowserStorage(), null);
      assert.equal(reconcileLocalSession(null, 'uid-a'), 'residue');
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
      else delete (globalThis as {localStorage?: unknown}).localStorage;
    }
  }
});

test('22. o histórico persiste depois de recarregar (mesma conta, mesmo workspace)', async () => {
  const {storage, store} = setup();
  const {ask, calls} = controlledAsk();
  const chat = await mountChat({scope: A_PF, store, ask});
  await chat.send('pergunta salva');
  await chat.answer(calls[0], 'resposta salva');
  await chat.unmount();

  assert.equal(reconcileLocalSession(null, 'uid-a', storage), 'same-account');
  const reloaded = createAiChatSessionStore({storage: () => storage});
  const again = await mountChat({scope: A_PF, store: reloaded, ask: controlledAsk().ask});
  assert.deepEqual(again.texts(), ['pergunta salva', 'resposta salva']);
});

test('23. nenhuma gravação antes da hidratação do escopo', async () => {
  const {storage, store} = setup('uid-a', {[A_PF.key]: envelope(A_PF, ['PF'])});
  const {ask, calls} = controlledAsk();
  const chat = await mountChat({scope: A_PF, store, ask});
  await chat.setScope(A_PJ);
  await chat.send('primeira PJ');
  await chat.answer(calls[0], 'resposta PJ');

  for (const scope of [A_PF, A_PJ]) {
    const operations = storage.log.filter((entry) => entry.endsWith(` ${scope.key}`));
    assert.equal(operations[0], `get ${scope.key}`, `primeira operação em ${scope.key} é leitura`);
  }
  assert.ok(!storage.log.includes(`set ${A_PF.key}`), 'PF não regravado pela troca');
  assert.deepEqual(storedTexts(storage, A_PJ), ['primeira PJ', 'resposta PJ']);
});

// --- 24–25: StrictMode e quadros transitórios ---------------------------------

test('24. StrictMode não duplica nem perde mensagens', async () => {
  const {storage, store} = setup('uid-a', {[A_PF.key]: envelope(A_PF, ['anterior'])});
  const {ask, calls} = controlledAsk();
  const chat = await mountChat({scope: A_PF, store, ask, strict: true});
  assert.deepEqual(chat.texts(), ['anterior']);
  await chat.send('pergunta estrita');
  assert.equal(calls.length, 1, 'uma chamada por envio');
  await chat.answer(calls[0], 'resposta estrita');
  assert.deepEqual(chat.texts(), ['anterior', 'pergunta estrita', 'resposta estrita']);
  assert.deepEqual(storedTexts(storage, A_PF), ['anterior', 'pergunta estrita', 'resposta estrita']);

  await chat.setScope(A_PJ);
  assert.deepEqual(chat.texts(), []);
  assertRendersIsolated(chat.renders, {[A_PJ.key]: ['anterior', 'pergunta estrita', 'resposta estrita']});
});

test('25. nenhuma renderização mostra mensagem privada de outro contexto, nem transitoriamente', async () => {
  const {store} = setup('uid-a', {
    [A_PF.key]: envelope(A_PF, ['PF-1', 'PF-2']),
    [A_PJ.key]: envelope(A_PJ, ['PJ-1']),
  });
  const {ask, calls} = controlledAsk();
  const chat = await mountChat({scope: A_PF, store, ask});
  await chat.send('PF-3');
  await chat.setScope(A_PJ);
  await chat.answer(calls[0], 'PF-4');
  await chat.send('PJ-2');
  await chat.setScope(A_PF);
  await chat.answer(calls[1], 'PJ-3');
  await chat.setScope(A_PJ);

  const pfTexts = ['PF-1', 'PF-2', 'PF-3', 'PF-4'];
  const pjTexts = ['PJ-1', 'PJ-2', 'PJ-3'];
  assertRendersIsolated(chat.renders, {[A_PF.key]: pjTexts, [A_PJ.key]: pfTexts});
  assert.ok(chat.renders.length >= 6);
  assert.deepEqual(chat.texts(), ['PJ-1', 'PJ-2']);
});

// --- Complementares -------------------------------------------------------------

test('sem escopo (identidade ou workspace indefinidos) nada é lido, gravado nem enviado', async () => {
  const {storage, store} = setup();
  const {ask, calls} = controlledAsk();
  const chat = await mountChat({scope: null, store, ask});
  assert.equal(chat.chat.isReady, false);
  assert.equal(chat.chat.sessionKey, NO_AI_CHAT_SESSION);
  await chat.send('não sai');
  await chat.clear();
  assert.equal(calls.length, 0);
  assert.deepEqual(chat.texts(), []);
  assert.deepEqual(storage.log, []);
});

test('dono local de outra conta: o histórico desta conta não é lido nem gravado', async () => {
  // Janela da troca de conta: o Firebase Auth já é B (dono local B), mas a
  // interface ainda renderiza o escopo de A, e a chave de A não pôde sair.
  const {storage, store} = setup('uid-b', {[A_PF.key]: envelope(A_PF, ['privado de A'])});
  const {ask, calls} = controlledAsk();
  const chat = await mountChat({scope: A_PF, store, ask});
  assert.deepEqual(chat.texts(), []);
  assert.ok(!storage.log.includes(`get ${A_PF.key}`), 'nem chega a ler');
  await chat.send('nova de A');
  await chat.answer(calls[0], 'resposta');
  assert.deepEqual(storedTexts(storage, A_PF), ['privado de A'], 'nada gravado por cima');
});

test('outra aba encerrou a sessão (dono local removido): esta aba não grava mais', async () => {
  const {storage, store} = setup();
  const {ask, calls} = controlledAsk();
  const chat = await mountChat({scope: A_PF, store, ask});
  await chat.send('antes');
  await chat.answer(calls[0], 'resposta antes');
  assert.deepEqual(storedTexts(storage, A_PF), ['antes', 'resposta antes']);

  // Logout em outra aba: as chaves do usuário e o dono local somem.
  clearUserScopedStorage(storage);
  const mark = storage.log.length;
  await chat.send('depois');
  await chat.answer(calls[1], 'resposta depois');
  assert.ok(!storage.log.slice(mark).some((entry) => entry.startsWith('set ')));
  assert.equal(storage.peek(A_PF.key), null);

  // E o evento de outra aba invalida o que ainda estava pendente.
  await chat.send('pendente');
  await TestRenderer.act(async () => {
    store.reset();
  });
  await chat.answer(calls[2], 'resposta descartada');
  assert.ok(!chat.texts().includes('resposta descartada'));
});

test('P5-E1. a chave de idempotência da confirmação chega ao envio, uma por intenção', async () => {
  const {store} = setup();
  const {ask, calls} = controlledAsk();
  const chat = await mountChat({scope: A_PF, store, ask});
  await chat.send('primeira', 'chave-confirmada-1');
  await chat.send('segunda', 'chave-confirmada-2');
  assert.deepEqual(calls.map((call) => call.idempotencyKey), ['chave-confirmada-1', 'chave-confirmada-2']);
  // Sem chave, nada é enviado: o chamador gera a chave ao confirmar.
  await chat.send('terceira', '');
  assert.equal(calls.length, 2);
});

test('P5-E1. o texto de falha inesperada não menciona chave de API', () => {
  assert.equal(
    AI_CHAT_UNEXPECTED_ERROR_TEXT,
    'Não foi possível consultar a IA agora. Tente novamente mais tarde.',
  );
  assert.doesNotMatch(AI_CHAT_UNEXPECTED_ERROR_TEXT, /chave|API/i);
});
