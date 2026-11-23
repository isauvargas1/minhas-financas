import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
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
/*
 * P6-A: o cliente não lê mais nenhuma `VITE_*`. A configuração web vem do perfil de build (`__FENIX_CONFIG_WEB__`,
 * de `config/ambientes.json`), e o Emulator e o login E2E entram só por alias nos perfis de Emulator. Sobram as chaves
 * de modo do próprio Vite.
 */
const CLIENT_ENV_ALLOWED = new Set(['MODE', 'DEV', 'PROD', 'BASE_URL', 'SSR']);

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

const PERFIS_DO_VITE = [
  {perfil: 'verificacao', command: 'build' as const, projeto: 'demo-fenixgran-verificacao'},
  {perfil: 'e2e', command: 'build' as const, projeto: 'minhas-financas-local'},
  {perfil: 'local', command: 'serve' as const, projeto: 'minhas-financas-local'},
];

/** Carrega o vite.config com o perfil e as variáveis pedidas, restaurando o ambiente depois. */
const carregarVite = async (env: Record<string, string | undefined>, command: 'build' | 'serve') => {
  const anterior = {...process.env};
  for (const nome of Object.keys(process.env)) if (nome.startsWith('VITE_') || nome.startsWith('FENIX_')) delete process.env[nome];
  Object.assign(process.env, env);
  try {
    return await loadConfigFromFile({command, mode: 'production'}, 'vite.config.ts', process.cwd(), 'silent');
  } finally {
    for (const nome of Object.keys(process.env)) if (!(nome in anterior)) delete process.env[nome];
    Object.assign(process.env, anterior);
  }
};

test('E-00/P6-A: o define efetivo de cada perfil só traz as neutralizações, o perfil, a configuração web pública dele e o App Check (nulo fora do release)', async () => {
  const config = repoFile('vite.config.ts');
  assert.doesNotMatch(config, /envPrefix/, 'envPrefix mudaria quais variáveis vão para o bundle');
  assert.doesNotMatch(withoutComments(config), /\bloadEnv\b/, 'a configuração não carrega o ambiente');
  const contrato = JSON.parse(repoFile('config/ambientes.json'));
  const portas = JSON.parse(repoFile('firebase.json')).emulators;
  // Só os perfis de Emulator conectam: `local` pela mesma origem (proxy do Vite), `e2e` direto nas portas do Emulator.
  const conexaoEsperada: Record<string, unknown> = {
    verificacao: null,
    local: {modo: 'mesma-origem'},
    e2e: {modo: 'direta', host: '127.0.0.1', auth: portas.auth.port, firestore: portas.firestore.port, functions: portas.functions.port},
  };
  for (const {perfil, command, projeto} of PERFIS_DO_VITE) {
    const loaded = await carregarVite({FENIX_PERFIL: perfil}, command);
    assert.ok(loaded, `configuração carregada (${perfil})`);
    const web = perfil === 'verificacao' ? contrato.verificacao.web : contrato.emulador.web;
    assert.deepEqual(loaded.config.define, {
      'process.env.API_KEY': '""',
      'process.env.GEMINI_API_KEY': '""',
      __FENIX_PERFIL__: JSON.stringify(perfil),
      __FENIX_CONFIG_WEB__: JSON.stringify(web),
      __FENIX_APP_CHECK__: 'null',
      __FENIX_CONEXAO_EMULADOR__: JSON.stringify(conexaoEsperada[perfil]),
    }, perfil);
    assert.equal(web.projectId, projeto, perfil);
    assert.equal(loaded.config.envPrefix, undefined, perfil);
    assert.match(String(loaded.config.envDir), /config[\\/]vite-sem-env$/, `${perfil}: envDir sem .env*`);
  }
  // O Vite também substitui `%NOME%` no index.html pelas variáveis do ambiente: nenhum marcador no HTML.
  assert.doesNotMatch(repoFile('index.html'), /%[A-Z_][A-Z0-9_]*%/, 'marcador de variável de ambiente no index.html');
  const define = /define:\s*\{([\s\S]*?)\n\s*\},/.exec(config)?.[1] ?? '';
  const entries = [...withoutComments(define).matchAll(/^\s*'?([A-Za-z_.$]+)'?:\s*(.+?),?\s*$/gm)].map((match) => [match[1], match[2]]);
  assert.deepEqual(entries, [
    ['process.env.API_KEY', "JSON.stringify('')"],
    ['process.env.GEMINI_API_KEY', "JSON.stringify('')"],
    ['__FENIX_PERFIL__', 'JSON.stringify(plano.perfil)'],
    ['__FENIX_CONFIG_WEB__', 'JSON.stringify(plano.web)'],
    ['__FENIX_APP_CHECK__', 'JSON.stringify(plano.appCheck)'],
    ['__FENIX_CONEXAO_EMULADOR__', 'JSON.stringify(conexaoDoEmulador(plano, portasEmulador))'],
  ]);
});

test('P6-A: o vite.config falha fechado sem perfil, com VITE_* no shell e no release sem configuração da produção', async () => {
  await assert.rejects(carregarVite({}, 'build'), /perfil/);
  await assert.rejects(carregarVite({FENIX_PERFIL: 'producao'}, 'build'), /perfil/);
  await assert.rejects(carregarVite({FENIX_PERFIL: 'verificacao', VITE_FIREBASE_PROJECT_ID: 'x'}, 'build'), /VITE_FIREBASE_PROJECT_ID/);
  await assert.rejects(carregarVite({FENIX_PERFIL: 'verificacao', VITE_E2E_MODE: 'true'}, 'build'), /VITE_E2E_MODE/);
  await assert.rejects(carregarVite({FENIX_PERFIL: 'local'}, 'build'), /não aceita o comando build/);
  // O release depende de producao.web, que o proprietário preenche antes do G0: o teste vale nos dois estados.
  const producao = JSON.parse(repoFile('config/ambientes.json')).producao;
  if (producao.web === null) {
    await assert.rejects(carregarVite({FENIX_PERFIL: 'release'}, 'build'), /producao\.web/);
  } else {
    const release = await carregarVite({FENIX_PERFIL: 'release'}, 'build');
    assert.equal(release?.config.build?.outDir, 'dist');
    assert.equal(release?.config.define?.__FENIX_CONFIG_WEB__, JSON.stringify(producao.web));
  }
});

test('E-00/P6-A: todo build do frontend passa pelo perfil e termina com a varredura; o Hosting só publica release', () => {
  const pkg = JSON.parse(repoFile('package.json')) as {scripts: Record<string, string>};
  assert.equal(pkg.scripts.build, 'node tools/ambiente/construir.mjs --perfil verificacao');
  assert.equal(pkg.scripts['build:e2e'], 'node tools/ambiente/construir.mjs --perfil e2e');
  assert.equal(pkg.scripts['build:release'], 'node tools/ambiente/construir.mjs --perfil release');
  const vite = Object.entries(pkg.scripts).filter(([, command]) => /\bvite\b(?!\.mjs)/.test(command.replace(/tools\/ambiente\/vite\.mjs/g, ''))).map(([name]) => name);
  assert.deepEqual(vite, [], 'nenhum script chama o Vite sem o perfil');
  const construir = withoutComments(repoFile('tools/ambiente/construir.mjs'));
  assert.ok(construir.indexOf("'vite.js'") > 0 && construir.indexOf("'varrer-bundle.mjs'") > construir.indexOf("'vite.js'"),
    'construir.mjs roda a varredura depois do Vite');
  assert.match(construir, /'--perfil', plano\.perfil/);
  for (const [nome, comando] of Object.entries(pkg.scripts).filter(([name]) => name.startsWith('deploy:'))) {
    assert.match(comando, /^node tools\/deploy\/publicar\.mjs --alvo [a-z-]+$/, `${nome} passa pelo guard`);
  }
  // PLAT-11 e P6-A: também o `firebase deploy` direto, pelo predeploy.
  const firebase = JSON.parse(repoFile('firebase.json')) as {
    hosting: {public: string; predeploy?: string[]};
    firestore: {predeploy?: string[]};
    functions: Array<{predeploy?: string[]}>;
  };
  assert.equal(firebase.hosting.public, 'dist');
  assert.deepEqual(firebase.hosting.predeploy, [
    'node "$PROJECT_DIR/tools/deploy/guarda-predeploy.mjs" hosting',
    'node "$PROJECT_DIR/tools/seguranca/varrer-bundle.mjs" "$PROJECT_DIR/dist" --perfil release --publicacao',
  ]);
  assert.deepEqual(firebase.firestore.predeploy, ['node "$PROJECT_DIR/tools/deploy/guarda-predeploy.mjs" firestore']);
  assert.equal(firebase.functions[0].predeploy?.[0], 'node "$PROJECT_DIR/tools/deploy/guarda-predeploy.mjs" functions');
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

// Excecao restrita a chave web publica verificada no GCP.
// Uma rotacao da chave exige revisar esta impressao digital.
const PUBLIC_FIREBASE_KEY_SHA256 = '76275025227ef9e71075851639a8628382c7e1efc199a65e2a522980ae31156d';
const GOOGLE_KEY_PATTERN = /AIza[0-9A-Za-z_-]{35}/;

const hasUnexpectedGoogleKey = (
  file: string,
  content: string,
  fingerprint = PUBLIC_FIREBASE_KEY_SHA256,
): boolean => {
  if (file !== 'config/ambientes.json') {
    return GOOGLE_KEY_PATTERN.test(content);
  }

  const cfg = JSON.parse(content);
  const key = cfg?.producao?.web?.apiKey;

  if (key === undefined || key === null) {
    return GOOGLE_KEY_PATTERN.test(content);
  }

  if (
    typeof key !== 'string' ||
    !/^AIza[0-9A-Za-z_-]{35}$/.test(key) ||
    createHash('sha256').update(key).digest('hex') !== fingerprint
  ) {
    return true;
  }

  const literal = JSON.stringify(key);

  if (!content.includes(literal)) {
    return true;
  }

  // Remove somente uma ocorrencia da chave autorizada.
  // Qualquer segunda chave ou copia continua sendo detectada.
  return GOOGLE_KEY_PATTERN.test(
    content.replace(literal, '""'),
  );
};

test('chave web publica: excecao estrita e sem esconder outros segredos', () => {
  const publicKey = 'AIza' + 'A'.repeat(35);
  const otherKey = 'AIza' + 'B'.repeat(35);

  const fingerprint = createHash('sha256')
    .update(publicKey)
    .digest('hex');

  const config = JSON.stringify({
    producao: {web: {apiKey: publicKey}},
  });

  assert.equal(
    hasUnexpectedGoogleKey('config/ambientes.json', config, fingerprint),
    false,
  );

  assert.equal(
    hasUnexpectedGoogleKey('tests/fixture.json', config, fingerprint),
    true,
  );

  const extraKey = JSON.stringify({
    producao: {web: {apiKey: publicKey}},
    segredo: otherKey,
  });

  assert.equal(
    hasUnexpectedGoogleKey('config/ambientes.json', extraKey, fingerprint),
    true,
  );

  const replacedKey = JSON.stringify({
    producao: {web: {apiKey: otherKey}},
  });

  assert.equal(
    hasUnexpectedGoogleKey('config/ambientes.json', replacedKey, fingerprint),
    true,
  );

  const duplicateKey = JSON.stringify({
    producao: {web: {apiKey: publicKey}},
    copia: publicKey,
  });

  assert.equal(
    hasUnexpectedGoogleKey('config/ambientes.json', duplicateKey, fingerprint),
    true,
  );
});

test('nenhum segredo real aparece em teste, fixture ou ambiente versionado', () => {
  const tracked = gitFiles(
    'tests/**', 'e2e/**', 'functions/src/**', '*.json', '*.ts',
  );

  const offenders = tracked.filter((file) =>
    hasUnexpectedGoogleKey(file, repoFile(file)),
  );

  assert.deepEqual(
    offenders,
    [],
    'Segredo real encontrado em arquivo versionado.',
  );
});
