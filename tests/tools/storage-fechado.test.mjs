import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

/**
 * P6-A (gate G0): o app não usa o Cloud Storage. As regras do bucket negam tudo, o firebase.json as publica pelo guard
 * e o cliente não inicializa o SDK. Esta é a parte estática; a negação em execução, no emulador de Storage, está em
 * tests/storage/storage-fechado-p6a.rules.integration.test.mjs (npm run test:rules:storage, dentro do
 * test:integration:emulator e do predeploy:rules).
 */
const ler = (caminho) => readFileSync(new URL(`../../${caminho}`, import.meta.url), 'utf8');
const semComentarios = (texto) => texto.replace(/\/\/.*$/gm, '').replace(/\s+/g, ' ').trim();

test('storage.rules nega leitura e escrita em todo caminho, sem outra regra', () => {
  const regras = semComentarios(ler('storage.rules'));
  assert.equal(regras,
    "rules_version = '2'; service firebase.storage { match /b/{bucket}/o { match /{allPaths=**} { allow read, write: if false; } } }");
});

test('o firebase.json publica o Storage só pelo guard, e o cliente não usa o SDK', () => {
  const firebase = JSON.parse(ler('firebase.json'));
  assert.deepEqual(firebase.storage, {
    rules: 'storage.rules',
    predeploy: ['node "$PROJECT_DIR/tools/deploy/guarda-predeploy.mjs" storage'],
  });
  assert.doesNotMatch(ler('src/lib/firebase.ts'), /firebase\/storage|getStorage/);
  assert.doesNotMatch(ler('vite.config.ts'), /'firebase\/storage'/);
});

test('o marcador do build (commit e árvore) não é enviado ao Hosting (PLT-8)', () => {
  const firebase = JSON.parse(ler('firebase.json'));
  assert.ok(firebase.hosting.ignore.includes('fenix-build.json'));
});
