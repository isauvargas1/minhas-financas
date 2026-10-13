import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LOCAL_SESSION_OWNER_KEY,
  USER_SCOPED_STORAGE_PREFIXES,
  clearUserScopedStorage,
  readLocalSessionOwner,
  reconcileLocalSession,
  writeLocalSessionOwner,
} from '../../src/lib/sessionCleanup.ts';

// AUTH-11: depois do logout nada do usuário anterior pode reaparecer para a
// próxima conta no mesmo navegador. `Storage` falso com a mesma semântica de
// índice do `localStorage` (a remoção reindexa as chaves restantes).
class FakeStorage implements Storage {
  #entries = new Map<string, string>();
  removed: string[] = [];

  constructor(initial: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(initial)) this.#entries.set(key, value);
  }

  get length(): number {
    return this.#entries.size;
  }

  key(index: number): string | null {
    return [...this.#entries.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.#entries.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.#entries.set(key, String(value));
  }

  removeItem(key: string): void {
    this.removed.push(key);
    this.#entries.delete(key);
  }

  clear(): void {
    this.#entries.clear();
  }

  keys(): string[] {
    return [...this.#entries.keys()];
  }

  [name: string]: unknown;
}

const USER_KEYS = [
  'lastWorkspaceId_uid-a',
  'lastWorkspaceId_uid-b',
  'finance_ai_chat_history_ws-1',
  'finance_ai_chat_history_v2:uid-a:ws-1',
  'dindin_local_session_owner',
  'app_chat_threads',
  'app_chat_threads_ws-1',
  'app_chat_messages',
  'app_chat_messages_ws-1_thread-9',
];

const KEPT_KEYS = [
  'app-theme',
  'unrelated',
  'lastWorkspaceId',
  'xlastWorkspaceId_uid-a',
  'finance_ai_chat',
  'app_chat',
  'APP_CHAT_THREADS',
];

test('prefixes cobertos são exatamente os de dados do usuário', () => {
  assert.deepEqual(
    [...USER_SCOPED_STORAGE_PREFIXES],
    [
      'lastWorkspaceId_',
      'finance_ai_chat_history_',
      'app_chat_threads',
      'app_chat_messages',
      'dindin_local_session_owner',
    ],
  );
});

test('remove as chaves do usuário, mantém as do dispositivo e devolve as removidas', () => {
  const interleaved: Record<string, string> = {};
  const all = [...USER_KEYS, ...KEPT_KEYS].sort();
  for (const key of all) interleaved[key] = `valor de ${key}`;
  const storage = new FakeStorage(interleaved);

  const removed = clearUserScopedStorage(storage);

  const expectedRemoved = all.filter((key) => USER_KEYS.includes(key));
  assert.deepEqual(removed, expectedRemoved);
  assert.deepEqual([...storage.removed].sort(), [...USER_KEYS].sort());
  assert.deepEqual(storage.keys().sort(), [...KEPT_KEYS].sort());
  assert.equal(storage.getItem('app-theme'), 'valor de app-theme');
  for (const key of USER_KEYS) assert.equal(storage.getItem(key), null, key);
});

test('chaves consecutivas do usuário são todas removidas', () => {
  const storage = new FakeStorage({
    'lastWorkspaceId_1': 'a',
    'lastWorkspaceId_2': 'b',
    'lastWorkspaceId_3': 'c',
    'app-theme': 'dark',
  });
  assert.deepEqual(clearUserScopedStorage(storage), [
    'lastWorkspaceId_1',
    'lastWorkspaceId_2',
    'lastWorkspaceId_3',
  ]);
  assert.deepEqual(storage.keys(), ['app-theme']);
});

test('armazenamento vazio ou só com preferências não remove nada', () => {
  assert.deepEqual(clearUserScopedStorage(new FakeStorage()), []);
  const storage = new FakeStorage({ 'app-theme': 'light', outro: '1' });
  assert.deepEqual(clearUserScopedStorage(storage), []);
  assert.deepEqual(storage.keys(), ['app-theme', 'outro']);
  assert.deepEqual(storage.removed, []);
});

test('sem localStorage acessível devolve lista vazia sem lançar', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError: acesso negado');
      },
    });
    assert.deepEqual(clearUserScopedStorage(), []);

    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: undefined,
    });
    assert.deepEqual(clearUserScopedStorage(), []);

    const fallback = new FakeStorage({ 'lastWorkspaceId_x': 'ws', 'app-theme': 'dark' });
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: fallback,
    });
    assert.deepEqual(clearUserScopedStorage(), ['lastWorkspaceId_x']);
    assert.deepEqual(fallback.keys(), ['app-theme']);
  } finally {
    if (descriptor) {
      Object.defineProperty(globalThis, 'localStorage', descriptor);
    } else {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  }
});

// P5-A (PR-AI-04): dono local da sessão e reconciliação por emissão do Auth.
test('dono local: grava, lê e recusa valores inválidos sem lançar', () => {
  const storage = new FakeStorage();
  assert.equal(readLocalSessionOwner(storage), null);
  assert.equal(writeLocalSessionOwner('uid-a', storage), true);
  assert.equal(storage.getItem(LOCAL_SESSION_OWNER_KEY), 'uid-a');
  assert.equal(readLocalSessionOwner(storage), 'uid-a');
  assert.equal(writeLocalSessionOwner('', storage), false);
  assert.equal(writeLocalSessionOwner('x'.repeat(257), storage), false);
  assert.equal(readLocalSessionOwner(null), null);
  assert.equal(writeLocalSessionOwner('uid-a', null), false);
});

test('reconciliação: troca na aba, resíduo em carga nova e mesma conta', () => {
  const seed = () => new FakeStorage({
    [LOCAL_SESSION_OWNER_KEY]: 'uid-a',
    'finance_ai_chat_history_v2:uid-a:ws-1': '{}',
    'lastWorkspaceId_uid-a': 'ws-1',
    'app-theme': 'dark',
  });

  const sameAccount = seed();
  assert.equal(reconcileLocalSession(null, 'uid-a', sameAccount), 'same-account');
  assert.equal(sameAccount.keys().length, 4);

  const switched = seed();
  assert.equal(reconcileLocalSession('uid-a', 'uid-b', switched), 'account-switch');
  assert.deepEqual(switched.keys().sort(), ['app-theme', LOCAL_SESSION_OWNER_KEY].sort());
  assert.equal(switched.getItem(LOCAL_SESSION_OWNER_KEY), 'uid-b');

  const firstLoadOther = seed();
  assert.equal(reconcileLocalSession(null, 'uid-b', firstLoadOther), 'residue');
  assert.equal(firstLoadOther.getItem('finance_ai_chat_history_v2:uid-a:ws-1'), null);
  assert.equal(firstLoadOther.getItem(LOCAL_SESSION_OWNER_KEY), 'uid-b');

  const signedOut = seed();
  assert.equal(reconcileLocalSession('uid-a', null, signedOut), 'account-switch');
  assert.deepEqual(signedOut.keys(), ['app-theme']);

  // Carga sem sessão: saem as conversas e o dono local; a preferência do
  // último workspace (identificada pelo uid) fica para a mesma conta.
  const noSession = seed();
  assert.equal(reconcileLocalSession(null, null, noSession), 'residue');
  assert.deepEqual(noSession.keys().sort(), ['app-theme', 'lastWorkspaceId_uid-a']);
});

test('resíduo na carga da conta X preserva só o que é de X', () => {
  const storage = new FakeStorage({
    [LOCAL_SESSION_OWNER_KEY]: 'uid-y',
    'lastWorkspaceId_uid-x': 'ws-x',
    'lastWorkspaceId_uid-y': 'ws-y',
    'finance_ai_chat_history_v2:uid-y:ws-y': '{}',
    'app_chat_threads_ws-y': '[]',
    'app-theme': 'dark',
  });
  assert.equal(reconcileLocalSession(null, 'uid-x', storage), 'residue');
  assert.deepEqual(storage.keys().sort(), ['app-theme', LOCAL_SESSION_OWNER_KEY, 'lastWorkspaceId_uid-x'].sort());
  assert.equal(storage.getItem(LOCAL_SESSION_OWNER_KEY), 'uid-x');
});
