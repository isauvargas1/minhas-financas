import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadConfigFromFile} from 'vite';

/**
 * Guarda de regressão: a inferência de IA é exclusiva do backend.
 *
 * O código do cliente já instanciou o SDK do Gemini no navegador, e
 * `vite.config.ts` injetava `GEMINI_API_KEY` no bundle via `define` — a
 * credencial real ficava legível para qualquer visitante. Estes testes falham
 * se qualquer uma das duas coisas voltar.
 */

const repoFile = (path: string) => readFileSync(path, 'utf8');

/**
 * Arquivos que a guarda varre: os do índice (`--cached`) e os novos ainda não
 * versionados que o `.gitignore` não exclui (`--others --exclude-standard`).
 * Sem o `--others`, um arquivo novo ficava fora da varredura até o commit
 * (RR-R3-12, P5-GATE-FINAL). O índice ainda pode trazer um arquivo apagado no
 * disco antes do commit; a guarda varre o **conteúdo em disco**, então ignora
 * o que não existe mais, senão falharia por um `ENOENT` que nada tem a ver com
 * a invariante que protege. Sem shell: argumentos vão direto ao git.
 */
const gitFilesIn = (cwd: string, ...patterns: string[]) =>
  execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', ...patterns],
    {cwd, encoding: 'utf8'},
  )
    .split('\n')
    .filter(Boolean)
    .filter((path) => existsSync(join(cwd, path)));

const gitFiles = (...patterns: string[]) => gitFilesIn(process.cwd(), ...patterns);

/**
 * No pathspec do git, `*` também atravessa `/`: `src/*.ts` pega `src/main.tsx` e todo arquivo dos subdiretórios. O
 * padrão anterior, com `**` depois de `src/`, exigia um subdiretório e deixava de fora `src/App.tsx`, `src/main.tsx`,
 * `src/constants.ts` e `src/types.ts` (RR-R3-12, P5-GATE-FINAL).
 */
const SOURCE_PATTERNS = ['src/*.ts', 'src/*.tsx', 'src/*.js', 'src/*.jsx', 'src/*.mjs', 'src/*.cjs'];

const sourceFiles = gitFiles(...SOURCE_PATTERNS);

test('a varredura alcança o código do cliente, inclusive o primeiro nível de src/', () => {
  for (const file of ['src/main.tsx', 'src/App.tsx', 'src/types.ts', 'src/modules/work-time/consistency.ts']) {
    assert.ok(sourceFiles.includes(file), `${file} na varredura`);
  }
  assert.ok(sourceFiles.length > 100, `arquivos do cliente: ${sourceFiles.length}`);
});

test('RR-R3-12: a lista inclui arquivo novo ainda não versionado, respeita o .gitignore e ignora o apagado no disco', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ai-backend-only-'));
  try {
    execFileSync('git', ['init', '-q'], {cwd: dir});
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, '.gitignore'), 'src/ignorado.ts\n');
    writeFileSync(join(dir, 'src', 'versionado.ts'), 'export {};\n');
    writeFileSync(join(dir, 'src', 'apagado.ts'), 'export {};\n');
    execFileSync('git', ['add', 'src/versionado.ts', 'src/apagado.ts'], {cwd: dir});
    unlinkSync(join(dir, 'src', 'apagado.ts'));
    writeFileSync(join(dir, 'src', 'novo.ts'), "import '@google/genai';\n");
    writeFileSync(join(dir, 'src', 'ignorado.ts'), 'export {};\n');
    mkdirSync(join(dir, 'src', 'modulo', 'interno'), {recursive: true});
    writeFileSync(join(dir, 'src', 'modulo', 'interno', 'tela.tsx'), 'export {};\n');
    // PLAT-10 (2ª revisão): JavaScript no cliente também entra na varredura.
    writeFileSync(join(dir, 'src', 'modulo', 'legado.js'), 'export {};\n');
    writeFileSync(join(dir, 'src', 'modulo', 'tela.jsx'), 'export {};\n');
    writeFileSync(join(dir, 'src', 'modulo', 'util.mjs'), 'export {};\n');
    assert.deepEqual(gitFilesIn(dir, ...SOURCE_PATTERNS).sort(),
      ['src/modulo/interno/tela.tsx', 'src/modulo/legado.js', 'src/modulo/tela.jsx', 'src/modulo/util.mjs', 'src/novo.ts', 'src/versionado.ts']);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('nenhum arquivo do cliente importa SDK de IA', () => {
  const offenders = sourceFiles.filter((file) => {
    const content = repoFile(file);
    return content.includes('@google/genai') ||
      content.includes('@google/generative-ai');
  });
  assert.deepEqual(
    offenders,
    [],
    'A inferência precisa ficar no backend; o SDK não pode entrar no bundle.',
  );
});

test('nenhum arquivo do cliente lê chave de IA do ambiente', () => {
  // Detecta o **uso** da variável, e não a menção dela: um comentário que
  // explique por que a chave saiu do cliente não pode reprovar o teste.
  const envAccess =
    /(?:import\.meta\.env|process\.env)\s*(?:\?\.)?\s*(?:\.\s*|\[\s*['"`])(VITE_GOOGLE_AI_KEY|VITE_GEMINI_API_KEY|GEMINI_API_KEY|API_KEY)/;
  const offenders = sourceFiles.filter((file) => envAccess.test(repoFile(file)));
  assert.deepEqual(offenders, [], 'Chave de IA não pode ser lida no cliente.');
});

test('vite não injeta a chave do Gemini no bundle', () => {
  const config = repoFile('vite.config.ts');
  // `define` substitui o identificador literalmente no código servido.
  assert.ok(
    !/'process\.env\.(API_KEY|GEMINI_API_KEY)':\s*JSON\.stringify\(env\./.test(config),
    'vite.config.ts não pode injetar a chave real no bundle.',
  );
});

/*
 * P5-GATE-FINAL (E-00, causa da exposição de chave). O Vite põe no bundle público o valor de toda variável
 * `VITE_*` que o cliente lê, e, se o cliente lê `import.meta.env` como objeto, o objeto inteiro com TODAS as
 * variáveis `VITE_*` do ambiente de build. Lista fechada: só a configuração web do Firebase (pública por
 * desenho) e as chaves de modo; nenhum acesso ao objeto. Uma variável nova no cliente exige mudar esta lista,
 * com a justificativa de que o valor pode ser público.
 */
const CLIENT_ENV_ALLOWED = new Set([
  'VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID', 'VITE_FIREBASE_APP_ID', 'VITE_USE_FIREBASE_EMULATORS', 'VITE_E2E_MODE',
  'MODE', 'DEV', 'PROD', 'BASE_URL', 'SSR',
]);

/** Código sem comentários de bloco e de linha inteira (um comentário que explica a regra não a viola). */
const withoutComments = (content: string) =>
  content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Leituras de `import.meta.env` de um texto: o nome lido, ou `null` quando é o objeto (sem `.NOME`). */
const clientEnvReads = (content: string): Array<string | null> =>
  [...withoutComments(content).matchAll(/import\.meta\.env\b(\s*\.\s*([A-Za-z_$][\w$]*))?/g)].map((match) => match[2] ?? null);

test('E-00: o cliente só lê variáveis de ambiente da lista fechada, por nome, nunca o objeto inteiro', () => {
  const offenders: string[] = [];
  for (const file of sourceFiles) {
    for (const name of clientEnvReads(repoFile(file))) {
      if (name === null) offenders.push(`${file}: import.meta.env como objeto (embute todas as VITE_* no bundle)`);
      else if (!CLIENT_ENV_ALLOWED.has(name)) offenders.push(`${file}: ${name} fora da lista`);
    }
  }
  assert.deepEqual(offenders, []);
  // A própria guarda reconhece os dois casos, e o comentário não conta.
  assert.deepEqual(clientEnvReads('a = import.meta.env.VITE_X; b = (import.meta.env as R)[k]; c = import.meta.env .MODE\n/* import.meta.env */\n// import.meta.env'),
    ['VITE_X', null, 'MODE']);
});

test('E-00: o vite.config não injeta valor de ambiente pelo define nem muda o prefixo das variáveis públicas', async () => {
  const config = repoFile('vite.config.ts');
  assert.doesNotMatch(config, /envPrefix/, 'envPrefix mudaria quais variáveis vão para o bundle');
  assert.doesNotMatch(withoutComments(config), /\bloadEnv\b/, 'a configuração não carrega o ambiente');
  // PLAT-10 (2ª revisão): a configuração efetiva, carregada pelo próprio Vite, nos modos de build: só as duas
  // neutralizações, com texto vazio, e nenhum prefixo de variável pública além do padrão (VITE_).
  for (const mode of ['production', 'development']) {
    const loaded = await loadConfigFromFile({command: 'build', mode}, 'vite.config.ts', process.cwd(), 'silent');
    assert.ok(loaded, `configuração carregada (${mode})`);
    assert.deepEqual(loaded.config.define, {'process.env.API_KEY': '""', 'process.env.GEMINI_API_KEY': '""'}, mode);
    assert.equal(loaded.config.envPrefix, undefined, mode);
  }
  // O Vite também substitui `%NOME%` no index.html pelas variáveis do ambiente: nenhum marcador no HTML.
  assert.doesNotMatch(repoFile('index.html'), /%[A-Z_][A-Z0-9_]*%/, 'marcador de variável de ambiente no index.html');
  const define = /define:\s*\{([\s\S]*?)\n\s*\},/.exec(config)?.[1] ?? '';
  assert.ok(define.length > 0, 'bloco define encontrado');
  const entries = [...withoutComments(define).matchAll(/^\s*'([^']+)':\s*(.+?),?\s*$/gm)].map((match) => [match[1], match[2]]);
  // Só as duas neutralizações da chave antiga, com texto vazio: nenhum valor vindo do ambiente.
  assert.deepEqual(entries, [['process.env.API_KEY', "JSON.stringify('')"], ['process.env.GEMINI_API_KEY', "JSON.stringify('')"]]);
});

test('E-00: todo build do frontend termina com a varredura de segredos do bundle público', () => {
  const pkg = JSON.parse(repoFile('package.json')) as {scripts: Record<string, string>};
  assert.match(pkg.scripts.build, /vite build && node tools\/seguranca\/varrer-bundle\.mjs dist$/);
  assert.match(pkg.scripts['build:e2e'], / npm run build$/);
  assert.match(pkg.scripts['deploy:hosting'], /^npm run build && /, 'o deploy do Hosting passa pela varredura');
  // PLAT-11 (2ª revisão): também o `firebase deploy --only hosting` direto, pelo predeploy do Hosting.
  const firebase = JSON.parse(repoFile('firebase.json')) as {hosting: {public: string; predeploy?: string[]}};
  assert.equal(firebase.hosting.public, 'dist');
  assert.deepEqual(firebase.hosting.predeploy, ['node tools/seguranca/varrer-bundle.mjs dist']);
  const vite = Object.entries(pkg.scripts).filter(([, command]) => /\bvite build\b/.test(command)).map(([name]) => name);
  assert.deepEqual(vite, ['build'], 'nenhum outro script gera o bundle sem a varredura');
});

test('o backend recusa operar sem chave, em vez de cair num default', () => {
  const backend = repoFile('functions/src/ai/callables.ts');
  assert.ok(
    backend.includes('process.env.GOOGLE_AI_API_KEY'),
    'A chave precisa vir do ambiente do backend.',
  );
  assert.ok(
    !/GOOGLE_AI_API_KEY\s*\|\|\s*['"]/.test(backend),
    'Não pode existir chave padrão embutida no código.',
  );
});

test('nenhum segredo real aparece em teste, fixture ou ambiente versionado', () => {
  const tracked = gitFiles(
    'tests/**', 'e2e/**', 'functions/src/**', '*.json', '*.ts',
  );
  // Formato de chave do Google: AIza seguido de 35 caracteres.
  const googleKey = /AIza[0-9A-Za-z_-]{35}/;
  const offenders = tracked.filter((file) => {
    try {
      return googleKey.test(repoFile(file));
    } catch {
      return false;
    }
  });
  assert.deepEqual(offenders, [], 'Segredo real encontrado em arquivo versionado.');
});
