import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * P5-GATE-FINAL (E-00) — varredura de segredos do bundle público (`tools/seguranca/varrer-bundle.mjs`), que roda no
 * fim de todo `npm run build`. Os segredos dos casos são falsos e montados aqui, em tempo de execução (nenhum valor
 * com forma de chave fica no repositório). O script sai com 1 e não imprime o valor encontrado.
 */

const SCRIPT = fileURLToPath(new URL('../../tools/seguranca/varrer-bundle.mjs', import.meta.url));

const chars = (count, seed = 1) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let state = seed;
  return Array.from({ length: count }, () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return alphabet[state % alphabet.length];
  }).join('');
};
const googleKey = (seed) => ['AI', 'za', chars(35, seed)].join('');

const run = (files, script = SCRIPT) => {
  const dir = mkdtempSync(join(tmpdir(), 'p5g-bundle-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(join(dir, name, '..'), { recursive: true });
      writeFileSync(join(dir, name), content);
    }
    const result = spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });
    return { code: result.status, output: `${result.stdout}${result.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const firebaseConfig = (key) => `const e={apiKey:"${key}",authDomain:"x.firebaseapp.com",projectId:"x"};`;

test('bundle limpo com a configuração web do Firebase passa', () => {
  const result = run({
    'index.html': '<!doctype html><script type="module" src="/assets/index.js"></script>',
    'assets/index.js': `${firebaseConfig(googleKey(1))}const t="Google (Gemini API)";`,
    'assets/index.css': 'body{color:red}',
  });
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /3 arquivo\(s\) de .* sem segredo/);
});

const cases = [
  ['objeto de ambiente do Vite embutido (o caso do import.meta.env lido como objeto)',
    `const env={BASE_URL:"/",MODE:"production",VITE_GEMINI_API_KEY:"${chars(20, 2)}",VITE_FIREBASE_APP_ID:"1:2:web:3"};`, /objeto de ambiente do Vite/],
  ['chave do Google fora da configuração do Firebase', `fetch("https://generativelanguage.googleapis.com/v1beta/models?key=${googleKey(3)}")`, /chave de API do Google fora/],
  ['duas chaves do Google distintas', `${firebaseConfig(googleKey(4))}${firebaseConfig(googleKey(5))}`, /2 chaves de API do Google distintas/],
  ['chave secreta do Stripe', `const s="${['sk', 'live', chars(24, 6)].join('_')}";`, /chave secreta do Stripe/],
  ['chave restrita do Stripe', `const s="${['rk', 'test', chars(24, 7)].join('_')}";`, /chave restrita do Stripe/],
  ['segredo de webhook do Stripe', `const s="${['whsec', chars(24, 8)].join('_')}";`, /segredo de webhook do Stripe/],
  ['chave privada PEM', `const k="-----BEGIN ${'PRIVATE'} KEY-----\\nabc";`, /chave privada PEM/],
  ['conta de serviço do Google', `const c={"private_key":"x","client_email":"app@proj-1.iam.gserviceaccount.com"};`, /conta de serviço do Google/],
  ['segredo de cliente OAuth do Google', `const c="${['GOCSPX', chars(24, 9)].join('-')}";`, /segredo de cliente OAuth/],
  ['nome da variável da chave de IA do backend', 'const n="GEMINI_API_KEY";', /nome de variável da chave de IA/],
];

for (const [label, content, expected] of cases) {
  test(`reprova: ${label}, sem imprimir o valor`, () => {
    const result = run({ 'assets/index.js': content });
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, expected);
    assert.match(result.output, /o build falha/);
    for (const secret of content.match(/AIza[0-9A-Za-z]{35}|(?:sk|rk)_(?:live|test)_[0-9A-Za-z]+|whsec_[0-9A-Za-z]+|GOCSPX-[0-9A-Za-z]+/g) ?? []) {
      assert.ok(!result.output.includes(secret), `${label}: o valor apareceu na saída`);
    }
  });
}

test('pasta ausente ou vazia não aprova (sai com 2)', () => {
  const missing = spawnSync(process.execPath, [SCRIPT, join(tmpdir(), 'p5g-bundle-inexistente-0')], { encoding: 'utf8' });
  assert.equal(missing.status, 2);
  const empty = mkdtempSync(join(tmpdir(), 'p5g-bundle-vazio-'));
  try {
    assert.equal(spawnSync(process.execPath, [SCRIPT, empty], { encoding: 'utf8' }).status, 2);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
  assert.equal(spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' }).status, 2);
});

// PLAT-11 (2ª revisão): o Hosting publica tudo que está em dist/, de qualquer extensão; a varredura lê todos.
test('varre todo arquivo publicado, de qualquer extensão ou sem extensão', () => {
  assert.equal(run({ 'assets/logo.png': 'x' }).code, 0);
  for (const name of ['.well-known/config.yml', 'segredo', 'chaves/servidor.pem', 'assets/dados.bin']) {
    const result = run({ 'index.html': '<!doctype html>', [name]: `k="${['sk', 'live', chars(24, 11)].join('_')}"` });
    assert.equal(result.code, 1, `${name}: ${result.output}`);
    assert.match(result.output, /chave secreta do Stripe/);
  }
});

// PLAT-09 (2ª revisão): a varredura rodava só se `import.meta.url` fosse igual a `file://` + o caminho do script, o
// que é falso com espaço ou acento no caminho (a URL vem codificada) e por link simbólico: aí saía com 0 sem varrer.
test('roda de qualquer caminho: com espaço e acento e por link simbólico (nunca sai com 0 sem varrer)', () => {
  const base = mkdtempSync(join(tmpdir(), 'p5g-caminho-'));
  try {
    const dir = join(base, 'com espaço', 'finanças');
    mkdirSync(dir, { recursive: true });
    const copied = join(dir, 'varrer-bundle.mjs');
    copyFileSync(SCRIPT, copied);
    const linked = join(base, 'atalho.mjs');
    symlinkSync(copied, linked);
    const dirty = { 'assets/index.js': `const s="${['sk', 'live', chars(24, 12)].join('_')}";` };
    for (const script of [copied, linked]) {
      const result = run(dirty, script);
      assert.equal(result.code, 1, `${script}: ${result.output}`);
      assert.match(result.output, /o build falha/);
      const clean = run({ 'assets/index.js': 'const a=1;' }, script);
      assert.equal(clean.code, 0, clean.output);
      assert.match(clean.output, /1 arquivo\(s\) de .* sem segredo/);
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
