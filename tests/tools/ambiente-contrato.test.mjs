import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {criarRaizTemporaria} from './support/raiz-temporaria.mjs';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ErroArgumentos, OPCOES_DE_PROJETO_PROIBIDAS, lerArgumentos} from '../../tools/ambiente/argumentos.mjs';
import {
  ErroAmbiente, RAIZ, carregarConfiguracao, conferirPastaEnvVazia, conexaoDoEmulador, lerFirebaserc, lerPortasEmulador, planoProxy,
  resolverPerfil, validarConfiguracao, validarFirebaserc, variaveisViteDoProcesso,
} from '../../tools/ambiente/contrato.mjs';

/**
 * P6-A: contrato de ambientes (`config/ambientes.json`), resolução de perfis, leitura estrita de argumentos e as
 * ferramentas `vite.mjs`, `dev.mjs` e `construir.mjs` (só os caminhos que falham antes de qualquer build ou servidor).
 * Tudo em memória ou em diretório temporário; nenhum projeto remoto. A chave web fictícia é montada em tempo de execução.
 */

const EMULADOR = 'minhas-financas-local';
const cfgReal = () => carregarConfiguracao();
const PRODUCAO = cfgReal().producao.projectId;
const clone = (valor) => structuredClone(valor);

const alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const chaveWeb = () => ['AI', 'za', alfabeto.slice(0, 35)].join('');
const webProducao = (projectId = PRODUCAO) => ({
  apiKey: chaveWeb(),
  authDomain: `${projectId}.firebaseapp.com`,
  projectId,
  storageBucket: `${projectId}.appspot.com`,
  messagingSenderId: '123456789012',
  appId: '1:123456789012:web:abcdef123456',
});
const cfgComWeb = () => {
  const cfg = clone(cfgReal());
  cfg.producao.web = webProducao();
  return cfg;
};
const comLiberacao = (liberacao) => {
  const cfg = clone(cfgReal());
  cfg.producao.liberacao = liberacao;
  return cfg;
};
const LIBERACAO_G0 = {gate: 'G0', autorizadoPor: 'Proprietário', autorizadoEm: '2026-11-17', referencia: 'registro-1'};

const recusa = (fn, padrao) => assert.throws(fn, (erro) => {
  assert.ok(erro instanceof ErroAmbiente, `esperado ErroAmbiente, veio ${erro?.name}`);
  if (padrao) assert.match(erro.message, padrao);
  return true;
});

// 1. contrato real
test('config/ambientes.json real é válido e sem DEV/STAGING (web e liberação: pendentes ou válidas)', () => {
  const cfg = cfgReal();
  assert.deepEqual(validarConfiguracao(cfg), []);
  assert.equal(cfg.formato, 2);
  assert.ok(!('ambientes' in cfg));
  assert.ok(!('projetoExistente' in cfg));
  // Não fixa o estado de producao.web nem de producao.liberacao: o proprietário os preenche antes do G0, e um teste
  // que exigisse null tornaria o predeploy:check (e portanto a publicação) impossível. A validade, nula ou preenchida,
  // é do validarConfiguracao acima.
  assert.equal(cfg.emulador.projectId, EMULADOR);
  assert.match(cfg.verificacao.web.projectId, /^demo-/);
});

// 2. resolverPerfil
test('resolverPerfil: local usa o Emulator, sem login E2E e sem pasta de saída', () => {
  const plano = resolverPerfil({perfil: 'local', comando: 'serve'}, cfgReal());
  assert.equal(plano.projectId, EMULADOR);
  assert.equal(plano.emuladores, true);
  assert.equal(plano.loginE2E, false);
  assert.equal(plano.saida, null);
  assert.equal(plano.publicavel, false);
});

test('resolverPerfil: e2e aceita build, preview e serve e vai para dist-e2e com login E2E', () => {
  for (const comando of ['build', 'preview', 'serve']) {
    const plano = resolverPerfil({perfil: 'e2e', comando}, cfgReal());
    assert.equal(plano.saida, 'dist-e2e');
    assert.equal(plano.loginE2E, true);
    assert.equal(plano.emuladores, true);
    assert.equal(plano.projectId, EMULADOR);
    assert.equal(plano.publicavel, false);
  }
});

test('resolverPerfil: verificacao é um build demo-*, nunca publicável e sem emuladores', () => {
  const plano = resolverPerfil({perfil: 'verificacao', comando: 'build'}, cfgReal());
  assert.equal(plano.saida, 'dist-verificacao');
  assert.match(plano.projectId, /^demo-/);
  assert.equal(plano.publicavel, false);
  assert.equal(plano.emuladores, false);
  assert.equal(plano.loginE2E, false);
});

test('resolverPerfil: perfil ausente, vazio ou desconhecido é recusado', () => {
  for (const perfil of [undefined, '', 'prod', 'staging', 'dev', 'PRODUCAO']) {
    recusa(() => resolverPerfil({perfil, comando: 'build'}, cfgReal()), /perfil ausente ou desconhecido/);
  }
});

test('resolverPerfil: comandos que o perfil não aceita são recusados', () => {
  recusa(() => resolverPerfil({perfil: 'local', comando: 'build'}, cfgReal()), /não aceita o comando build/);
  recusa(() => resolverPerfil({perfil: 'local', comando: 'preview'}, cfgReal()), /não aceita o comando preview/);
  for (const perfil of ['verificacao', 'release']) {
    for (const comando of ['serve', 'preview']) {
      recusa(() => resolverPerfil({perfil, comando}, cfgComWeb()), new RegExp(`não aceita o comando ${comando}`));
    }
  }
});

test('resolverPerfil: --ambiente não existe mais, qualquer valor é recusado', () => {
  for (const ambiente of ['prod', 'staging']) {
    recusa(() => resolverPerfil({perfil: 'verificacao', ambiente, comando: 'build'}, cfgReal()), /--ambiente não existe mais/);
  }
});

test('resolverPerfil: release com producao.web nula é recusado e cita producao.web', () => {
  const cfg = clone(cfgReal());
  cfg.producao.web = null;
  recusa(() => resolverPerfil({perfil: 'release', comando: 'build'}, cfg), /producao\.web/);
});

test('resolverPerfil: release com producao.web válido vai para dist, publicável, ambiente prod', () => {
  const plano = resolverPerfil({perfil: 'release', comando: 'build'}, cfgComWeb());
  assert.equal(plano.saida, 'dist');
  assert.equal(plano.publicavel, true);
  assert.equal(plano.ambiente, 'prod');
  assert.equal(plano.projectId, PRODUCAO);
  assert.equal(plano.emuladores, false);
  assert.equal(plano.loginE2E, false);
});

test('App Check: só o release leva a chave de site registrada; os demais perfis levam null', () => {
  const siteKey = 'A'.repeat(20) + 'b-_9'.repeat(5);
  const cfg = cfgComWeb();
  cfg.producao.appCheck = {provedor: 'recaptcha-enterprise', siteKey};
  assert.deepEqual(validarConfiguracao(cfg), []);
  assert.deepEqual(resolverPerfil({perfil: 'release', comando: 'build'}, cfg).appCheck, {provedor: 'recaptcha-enterprise', siteKey});
  for (const [perfil, comando] of [['verificacao', 'build'], ['e2e', 'build'], ['local', 'serve']]) {
    assert.equal(resolverPerfil({perfil, comando}, cfg).appCheck, null, perfil);
  }
  cfg.producao.appCheck = null;
  assert.equal(resolverPerfil({perfil: 'release', comando: 'build'}, cfg).appCheck, null);
});

test('App Check e segredos registrados malformados reprovam o contrato', () => {
  const comAppCheck = (appCheck) => { const cfg = clone(cfgReal()); cfg.producao.appCheck = appCheck; return validarConfiguracao(cfg); };
  for (const ruim of [
    {provedor: 'recaptcha-v3', siteKey: 'A'.repeat(40)},
    {provedor: 'recaptcha-enterprise', siteKey: 'curta'},
    {provedor: 'recaptcha-enterprise', siteKey: 'A'.repeat(40), segredo: 'x'},
    'chave',
  ]) {
    assert.ok(comAppCheck(ruim).some((erro) => /producao\.appCheck malformado/.test(erro)), JSON.stringify(ruim));
  }
  const comSegredos = (segredos) => { const cfg = clone(cfgReal()); cfg.producao.segredos = segredos; return validarConfiguracao(cfg); };
  assert.deepEqual(comSegredos([]), []);
  assert.deepEqual(comSegredos(['GOOGLE_AI_API_KEY', 'STRIPE_SECRET_KEY']), []);
  assert.ok(comSegredos(undefined).some((erro) => /producao\.segredos precisa ser uma lista/.test(erro)));
  assert.ok(comSegredos(['sk_live_valor']).some((erro) => /só nomes de segredo/.test(erro)));
  assert.ok(comSegredos(['STRIPE_SECRET_KEY', 'STRIPE_SECRET_KEY']).some((erro) => /repetido/.test(erro)));
});

test('resolverPerfil: contrato inválido interrompe qualquer perfil', () => {
  const cfg = clone(cfgReal());
  cfg.formato = 1;
  recusa(() => resolverPerfil({perfil: 'local', comando: 'serve'}, cfg), /formato desconhecido/);
});

// 3. validarConfiguracao
const reprovaCom = (muda, padrao) => {
  const cfg = clone(cfgReal());
  muda(cfg);
  const erros = validarConfiguracao(cfg);
  assert.ok(erros.length > 0, 'esperado ao menos um erro');
  if (padrao) assert.ok(erros.some((erro) => padrao.test(erro)), `nenhum erro casa ${padrao}: ${erros.join(' | ')}`);
};

test('validarConfiguracao reprova formato 1 e as chaves legadas ambientes e projetoExistente', () => {
  reprovaCom((cfg) => { cfg.formato = 1; }, /formato desconhecido/);
  reprovaCom((cfg) => { cfg.ambientes = {}; }, /produção única/);
  reprovaCom((cfg) => { cfg.projetoExistente = {}; }, /produção única/);
});

test('validarConfiguracao reprova emulador, verificação e produção com projeto trocado', () => {
  reprovaCom((cfg) => { cfg.emulador.projectId = 'outro-projeto-x'; }, /emulador\.projectId/);
  reprovaCom((cfg) => { cfg.verificacao.web.projectId = 'projeto-real-x'; }, /demo-\*/);
  reprovaCom((cfg) => { cfg.producao.projectId = EMULADOR; }, /Emulator nem um projeto demo/);
  reprovaCom((cfg) => { cfg.producao.projectId = 'demo-fenixgran'; }, /Emulator nem um projeto demo/);
});

test('validarConfiguracao reprova região diferente', () => {
  reprovaCom((cfg) => { cfg.producao.regiaoFunctions = 'us-central1'; }, /producao\.regiaoFunctions/);
  reprovaCom((cfg) => { cfg.emulador.regiaoFunctions = 'us-central1'; }, /emulador\.regiaoFunctions/);
});

test('validarConfiguracao reprova origens inválidas', () => {
  const invalidas = [
    'http://sistema-financeiro-pesso-20698.web.app',
    'https://sistema-financeiro-pesso-20698.web.app/caminho',
    'https://*.web.app',
    'https://meu-codespace-3000.app.github.dev',
    'https://localhost',
  ];
  for (const origem of invalidas) {
    reprovaCom((cfg) => { cfg.producao.origens = [origem]; }, /origem inválida|Codespace ou local/);
  }
  reprovaCom((cfg) => { cfg.producao.origens = []; }, /origens/);
});

test('validarConfiguracao reprova producao.web malformada e aceita a válida', () => {
  const comWeb = (muda) => {
    const cfg = cfgComWeb();
    muda(cfg.producao.web);
    return validarConfiguracao(cfg);
  };
  assert.deepEqual(validarConfiguracao(cfgComWeb()), []);
  assert.ok(comWeb((web) => { web.apiKey = 'chave-invalida'; }).some((e) => /apiKey/.test(e)));
  assert.ok(comWeb((web) => { web.appId = '1:1:web:zz'; }).some((e) => /appId/.test(e)));
  assert.ok(comWeb((web) => { web.projectId = 'outro-projeto-x'; }).some((e) => /projectId diferente/.test(e)));
  assert.ok(comWeb((web) => { web.extra = 'x'; }).some((e) => /campos não previstos/.test(e)));
});

test('validarConfiguracao reprova liberacao malformada e aceita uma válida', () => {
  const erros = (liberacao) => validarConfiguracao(comLiberacao(liberacao));
  assert.deepEqual(erros(LIBERACAO_G0), []);
  assert.deepEqual(erros({...LIBERACAO_G0, gate: 'G1'}), []);
  for (const ruim of [
    {...LIBERACAO_G0, gate: 'G2'},
    {...LIBERACAO_G0, autorizadoEm: '17/11/2026'},
    {...LIBERACAO_G0, extra: 'x'},
    {...LIBERACAO_G0, autorizadoPor: ' '},
    {gate: 'G0'},
  ]) {
    assert.ok(erros(ruim).some((e) => /liberacao malformada/.test(e)), JSON.stringify(ruim));
  }
});

// 4. .firebaserc
test('validarFirebaserc: reprova default, aliases fora do local, o projeto de produção e targets', () => {
  const cfg = cfgReal();
  assert.deepEqual(validarFirebaserc({projects: {local: EMULADOR}}, cfg), []);
  assert.ok(validarFirebaserc({projects: {default: EMULADOR, local: EMULADOR}}, cfg).some((e) => /default/.test(e)));
  assert.ok(validarFirebaserc({projects: {default: PRODUCAO}}, cfg).length > 0);
  assert.ok(validarFirebaserc({projects: {local: PRODUCAO}}, cfg).length > 0);
  for (const alias of ['prod', 'producao', 'staging', 'default2']) {
    assert.ok(validarFirebaserc({projects: {local: EMULADOR, [alias]: PRODUCAO}}, cfg).length > 0, alias);
    assert.ok(validarFirebaserc({projects: {local: EMULADOR, [alias]: EMULADOR}}, cfg).length > 0, alias);
  }
  assert.ok(validarFirebaserc({projects: {local: EMULADOR}, targets: {}}, cfg).some((e) => /targets/.test(e)));
  assert.ok(validarFirebaserc({}, cfg).length > 0);
  assert.ok(validarFirebaserc(null, cfg).length > 0);
});

test('validarFirebaserc aceita o .firebaserc real do repositório', () => {
  const firebaserc = lerFirebaserc();
  assert.notEqual(firebaserc, null);
  assert.deepEqual(validarFirebaserc(firebaserc, cfgReal()), []);
});

// 5. VITE_* e pasta de env
test('variaveisViteDoProcesso devolve só os nomes VITE_*, ordenados e sem valores', () => {
  const nomes = variaveisViteDoProcesso({VITE_B: 'segredo-b', PATH: '/bin', VITE_A: 'segredo-a', NODE_ENV: 'x', OUTRA_VITE_: '1'});
  assert.deepEqual(nomes, ['VITE_A', 'VITE_B']);
  assert.ok(!JSON.stringify(nomes).includes('segredo'));
  assert.deepEqual(variaveisViteDoProcesso({PATH: '/bin'}), []);
});

test('conferirPastaEnvVazia reprova pasta com .env.local, aceita pasta vazia e recusa pasta ausente', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'p6a-env-'));
  try {
    assert.equal(conferirPastaEnvVazia(raiz).length, 1);
    const pasta = join(raiz, 'config', 'vite-sem-env');
    mkdirSync(pasta, {recursive: true});
    writeFileSync(join(pasta, 'LEIAME.md'), 'x');
    assert.deepEqual(conferirPastaEnvVazia(raiz), []);
    writeFileSync(join(pasta, '.env.local'), 'VITE_X=1');
    const erros = conferirPastaEnvVazia(raiz);
    assert.equal(erros.length, 1);
    assert.match(erros[0], /\.env/);
    assert.ok(!erros[0].includes('VITE_X'));
  } finally {
    rmSync(raiz, {recursive: true, force: true});
  }
  assert.deepEqual(conferirPastaEnvVazia(RAIZ), []);
});

// 6. proxy
test('planoProxy: no local, prefixos de Auth, Firestore e Functions vão para as portas do firebase.json; null no e2e e sem emuladores', () => {
  const portas = lerPortasEmulador();
  const firebase = JSON.parse(readFileSync(join(RAIZ, 'firebase.json'), 'utf8'));
  assert.equal(portas.auth, firebase.emulators.auth.port);
  assert.equal(portas.firestore, firebase.emulators.firestore.port);
  assert.equal(portas.functions, firebase.emulators.functions.port);

  const plano = resolverPerfil({perfil: 'local', comando: 'serve'}, cfgReal());
  const proxy = planoProxy(plano, portas);
  const alvo = (porta) => `http://127.0.0.1:${porta}`;
  assert.equal(proxy['/identitytoolkit.googleapis.com/'].target, alvo(portas.auth));
  assert.equal(proxy['/securetoken.googleapis.com/'].target, alvo(portas.auth));
  assert.equal(proxy['/emulator/'].target, alvo(portas.auth));
  assert.equal(proxy['/google.firestore.v1.Firestore/'].target, alvo(portas.firestore));
  assert.equal(proxy[`/v1/projects/${EMULADOR}/databases/`].target, alvo(portas.firestore));
  assert.equal(proxy[`/${EMULADOR}/southamerica-east1/`].target, alvo(portas.functions));

  // O e2e conecta direto às portas do Emulator (topologia validada do E2E): sem proxy.
  assert.equal(planoProxy(resolverPerfil({perfil: 'e2e', comando: 'serve'}, cfgReal()), portas), null);
  for (const perfil of ['verificacao']) {
    assert.equal(planoProxy(resolverPerfil({perfil, comando: 'build'}, cfgReal()), portas), null);
  }
  assert.equal(planoProxy(resolverPerfil({perfil: 'release', comando: 'build'}, cfgComWeb()), portas), null);
});

test('conexaoDoEmulador: local pela mesma origem, e2e direto nas portas do firebase.json, null sem Emulator', () => {
  const portas = lerPortasEmulador();
  assert.deepEqual(conexaoDoEmulador(resolverPerfil({perfil: 'local', comando: 'serve'}, cfgReal()), portas), {modo: 'mesma-origem'});
  for (const comando of ['serve', 'preview', 'build']) {
    assert.deepEqual(conexaoDoEmulador(resolverPerfil({perfil: 'e2e', comando}, cfgReal()), portas),
      {modo: 'direta', host: '127.0.0.1', auth: portas.auth, firestore: portas.firestore, functions: portas.functions});
  }
  assert.equal(conexaoDoEmulador(resolverPerfil({perfil: 'verificacao', comando: 'build'}, cfgReal()), portas), null);
  assert.equal(conexaoDoEmulador(resolverPerfil({perfil: 'release', comando: 'build'}, cfgComWeb()), portas), null);
});

// 7. argumentos
test('lerArgumentos aceita --nome valor e --nome=valor e as booleanas', () => {
  const especificacao = {valores: ['perfil', 'port'], booleanas: ['plano']};
  const a = lerArgumentos(['--perfil', 'local', '--plano'], especificacao);
  assert.equal(a.get('perfil'), 'local');
  assert.equal(a.get('plano'), true);
  const b = lerArgumentos(['--perfil=e2e', '--port=3000'], especificacao);
  assert.equal(b.get('perfil'), 'e2e');
  assert.equal(b.get('port'), '3000');
  assert.equal(lerArgumentos([], especificacao).size, 0);
});

test('lerArgumentos recusa repetida, desconhecida, posicional, curta, sem valor, com espaço e booleana com valor', () => {
  const especificacao = {valores: ['perfil'], booleanas: ['plano'], proibidas: OPCOES_DE_PROJETO_PROIBIDAS};
  const recusados = [
    ['--perfil', 'a', '--perfil', 'b'],
    ['--perfil=a', '--perfil=b'],
    ['--plano', '--plano'],
    ['--desconhecida', 'x'],
    ['posicional'],
    ['--'],
    ['-P', 'x'],
    ['-x'],
    ['--perfil'],
    ['--perfil', '--plano'],
    ['--perfil='],
    ['--perfil', 'dois valores'],
    ['--perfil=dois valores'],
    ['--plano=sim'],
  ];
  for (const argv of recusados) {
    assert.throws(() => lerArgumentos(argv, especificacao), ErroArgumentos, JSON.stringify(argv));
  }
});

test('lerArgumentos recusa as opções proibidas de escolher projeto, alvo, modo ou credencial', () => {
  const especificacao = {valores: ['perfil', 'project', 'only', 'mode'], booleanas: ['force'], proibidas: OPCOES_DE_PROJETO_PROIBIDAS};
  for (const nome of ['project', 'only', 'force', 'config', 'token', 'mode']) {
    assert.ok(Object.hasOwn(OPCOES_DE_PROJETO_PROIBIDAS, nome), nome);
    assert.throws(() => lerArgumentos([`--${nome}`, 'x'], especificacao), /não é aceito/, nome);
    assert.throws(() => lerArgumentos([`--${nome}=x`], especificacao), /não é aceito/, nome);
  }
});

// 8 e 9. ferramentas por spawnSync (nenhum servidor, nenhum build)
const FERRAMENTA = (nome) => fileURLToPath(new URL(`../../tools/ambiente/${nome}`, import.meta.url));
const envLimpo = (extra = {}) => ({PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...extra});
const rodar = (script, args, env = envLimpo()) => {
  const resultado = spawnSync(process.execPath, [FERRAMENTA(script), ...args], {cwd: RAIZ, encoding: 'utf8', env, timeout: 30000});
  return {code: resultado.status, out: resultado.stdout ?? '', err: resultado.stderr ?? ''};
};

test('vite.mjs --plano: local imprime o projeto do Emulator; verificacao e preview de local são recusados', () => {
  const ok = rodar('vite.mjs', ['dev', '--perfil', 'local', '--plano']);
  assert.equal(ok.code, 0, ok.err);
  assert.equal(JSON.parse(ok.out).projeto, EMULADOR);
  assert.match(ok.out, new RegExp(EMULADOR));
  assert.notEqual(rodar('vite.mjs', ['dev', '--perfil', 'verificacao', '--plano']).code, 0);
  assert.notEqual(rodar('vite.mjs', ['preview', '--perfil', 'local', '--plano']).code, 0);
  assert.notEqual(rodar('vite.mjs', ['dev', '--perfil', 'release', '--plano']).code, 0);
  assert.notEqual(rodar('vite.mjs', ['dev', '--plano']).code, 0);
});

test('vite.mjs recusa VITE_* no ambiente e --project', () => {
  const vite = rodar('vite.mjs', ['dev', '--perfil', 'local', '--plano'], envLimpo({VITE_FIREBASE_PROJECT_ID: 'x'}));
  assert.notEqual(vite.code, 0);
  assert.match(vite.err, /VITE_FIREBASE_PROJECT_ID/);
  const projeto = rodar('vite.mjs', ['dev', '--perfil', 'local', '--plano', '--project', 'x']);
  assert.notEqual(projeto.code, 0);
  assert.match(projeto.err, /--project/);
});

test('dev.mjs --plano: sai 0 e o comando do firebase fixa o projeto do Emulator', () => {
  const resultado = rodar('dev.mjs', ['--plano']);
  assert.equal(resultado.code, 0, resultado.err);
  const plano = JSON.parse(resultado.out);
  assert.equal(plano.projeto, EMULADOR);
  const indice = plano.firebase.indexOf('--project');
  assert.notEqual(indice, -1);
  assert.equal(plano.firebase[indice + 1], EMULADOR);
  assert.ok(!plano.firebase.includes(PRODUCAO));
});

test('dev.mjs recusa VITE_* no ambiente e --project', () => {
  const vite = rodar('dev.mjs', ['--plano'], envLimpo({VITE_FIREBASE_PROJECT_ID: 'x'}));
  assert.notEqual(vite.code, 0);
  assert.match(vite.err, /VITE_FIREBASE_PROJECT_ID/);
  const projeto = rodar('dev.mjs', ['--plano', '--project', 'x']);
  assert.notEqual(projeto.code, 0);
  assert.match(projeto.err, /--project/);
});

test('construir.mjs recusa antes de chamar o Vite: release sem web, local, perfil desconhecido, --ambiente e VITE_*', () => {
  // O release roda numa cópia com producao.web nula: na raiz real, depois que o proprietário preencher a configuração
  // web, este caso dispararia um build de verdade (PLT-1 da revisão de plataforma).
  const copia = criarRaizTemporaria({ajustarContrato: (cfg) => { cfg.producao.web = null; }});
  try {
    const r = spawnSync(process.execPath, [join(copia.raiz, 'tools', 'ambiente', 'construir.mjs'), '--perfil', 'release'], {
      cwd: copia.raiz, encoding: 'utf8', env: envLimpo(copia.envGit), timeout: 30000,
    });
    assert.equal(r.status, 3, r.stderr);
    assert.match(r.stderr, /producao\.web/);
  } finally {
    copia.remover();
  }
  assert.equal(rodar('construir.mjs', ['--perfil', 'local']).code, 3);
  assert.equal(rodar('construir.mjs', ['--perfil', 'staging']).code, 3);
  assert.equal(rodar('construir.mjs', ['--perfil', 'verificacao', '--ambiente', 'prod']).code, 2);
  const vite = rodar('construir.mjs', ['--perfil', 'verificacao'], envLimpo({VITE_X: '1'}));
  assert.equal(vite.code, 3);
  assert.match(vite.err, /VITE_X/);
});
