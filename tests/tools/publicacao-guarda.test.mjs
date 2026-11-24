import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {carregarConfiguracao} from '../../tools/ambiente/contrato.mjs';
import {
  ALVOS, MARCA_PUBLICACAO_EM_CURSO, avaliarBuild, avaliarGancho, avaliarItensEstaticos, conflitosDeAmbiente,
  executarPublicacao,
} from '../../tools/deploy/publicacao.mjs';
import {criarRaizTemporaria} from './support/raiz-temporaria.mjs';

/**
 * P6-A: guard de publicação na produção única. Só funções puras, um executor falso injetado e a CLI numa cópia
 * descartável da raiz com contrato controlado pelo teste (nunca o contrato real, cujo estado muda quando o
 * proprietário registra a liberação). Nada chama firebase, gcloud nem rede.
 */

const EMULADOR = 'minhas-financas-local';
const cfgReal = carregarConfiguracao();
const PRODUCAO = cfgReal.producao.projectId;
const COMMIT = 'a'.repeat(40);
const LIBERACAO_G0 = {gate: 'G0', autorizadoPor: 'Proprietário', autorizadoEm: '2026-11-17', referencia: 'registro-1'};
const alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

const cfgValida = () => {
  const cfg = structuredClone(cfgReal);
  cfg.producao.segredos = [];
  cfg.producao.web = {
    apiKey: ['AI', 'za', alfabeto.slice(0, 35)].join(''),
    authDomain: `${PRODUCAO}.firebaseapp.com`,
    projectId: PRODUCAO,
    storageBucket: `${PRODUCAO}.appspot.com`,
    messagingSenderId: '123456789012',
    appId: '1:123456789012:web:abcdef123456',
  };
  cfg.producao.liberacao = {...LIBERACAO_G0};
  return cfg;
};

const fatosValidos = (alvo = 'functions') => ({
  cfg: cfgValida(),
  alvo,
  project: PRODUCAO,
  confirmar: PRODUCAO,
  git: {commit: COMMIT, sujo: false, tags: ['v2026.11.17']},
  firebaserc: {projects: {local: EMULADOR}},
  envFunctions: ['.env.example'],
  env: {},
});
const com = (mudancas, alvo) => ({...fatosValidos(alvo), ...mudancas});
const marcadorRelease = (extra = {}) => ({
  perfil: 'release', publicavel: true, ambiente: 'prod', emuladores: false, loginE2E: false, projectId: PRODUCAO,
  origem: {commit: COMMIT, alteracoesLocais: false}, ...extra,
});
const temMotivo = (motivos, padrao) => assert.ok(motivos.some((m) => padrao.test(m)), `nenhum motivo casa ${padrao}: ${motivos.join(' | ')}`);

// 1 e 2. itens estáticos
test('itens estáticos: fatos válidos não geram motivo', () => {
  assert.deepEqual(avaliarItensEstaticos(fatosValidos()), []);
  for (const alvo of Object.keys(ALVOS)) assert.deepEqual(avaliarItensEstaticos(fatosValidos(alvo)), [], alvo);
});

test('itens estáticos: liberação nula ou malformada', () => {
  const nula = structuredClone(fatosValidos());
  nula.cfg.producao.liberacao = null;
  temMotivo(avaliarItensEstaticos(nula), /liberação de publicação não registrada/);
  const ruim = structuredClone(fatosValidos());
  ruim.cfg.producao.liberacao = {...LIBERACAO_G0, gate: 'G2'};
  temMotivo(avaliarItensEstaticos(ruim), /liberacao malformada/);
});

test('itens estáticos: --project ausente, do Emulator ou de outro projeto', () => {
  temMotivo(avaliarItensEstaticos(com({project: undefined, confirmar: undefined})), /--project ausente/);
  temMotivo(avaliarItensEstaticos(com({project: EMULADOR, confirmar: EMULADOR})), /Emulator não recebe deploy/);
  temMotivo(avaliarItensEstaticos(com({project: 'fenixgran-outro', confirmar: 'fenixgran-outro'})), /não é o projeto de produção/);
});

test('itens estáticos: --confirmar diferente e alvo desconhecido ou ausente', () => {
  temMotivo(avaliarItensEstaticos(com({confirmar: 'fenixgran-outro'})), /--confirmar precisa repetir/);
  temMotivo(avaliarItensEstaticos(com({confirmar: undefined})), /--confirmar precisa repetir/);
  temMotivo(avaliarItensEstaticos(com({alvo: 'database'})), /--alvo ausente ou desconhecido/);
  temMotivo(avaliarItensEstaticos(com({alvo: undefined})), /--alvo ausente ou desconhecido/);
  temMotivo(avaliarItensEstaticos(com({alvo: 'constructor'})), /--alvo ausente ou desconhecido/);
});

test('itens estáticos: .firebaserc com default de produção ou nulo', () => {
  temMotivo(avaliarItensEstaticos(com({firebaserc: {projects: {default: PRODUCAO, local: EMULADOR}}})), /default/);
  temMotivo(avaliarItensEstaticos(com({firebaserc: {projects: {local: EMULADOR, prod: PRODUCAO}}})), /só o alias local/);
  temMotivo(avaliarItensEstaticos(com({firebaserc: null})), /\.firebaserc ausente ou ilegível/);
});

test('itens estáticos: variáveis de projeto do ambiente com outro projeto', () => {
  for (const nome of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'CLOUDSDK_CORE_PROJECT', 'FIREBASE_PROJECT']) {
    const motivos = avaliarItensEstaticos(com({env: {[nome]: 'fenixgran-outro'}}));
    temMotivo(motivos, new RegExp(`${nome} no ambiente aponta para outro projeto`));
    assert.ok(!motivos.join('\n').includes('fenixgran-outro'), `${nome}: o valor apareceu no motivo`);
    assert.deepEqual(avaliarItensEstaticos(com({env: {[nome]: PRODUCAO}})), [], `${nome} igual ao projeto não é conflito`);
  }
});

test('itens estáticos: FIREBASE_TOKEN presente é recusado sem expor o valor', () => {
  const segredo = 'token-secreto-de-teste-123';
  const motivos = avaliarItensEstaticos(com({env: {FIREBASE_TOKEN: segredo}}));
  temMotivo(motivos, /FIREBASE_TOKEN definido/);
  assert.ok(!motivos.join('\n').includes(segredo));
});

test('itens estáticos: worktree sujo, sem commit e tags opcionais', () => {
  temMotivo(avaliarItensEstaticos(com({git: {commit: COMMIT, sujo: true, tags: ['v2026.11.17']}})), /alterações não commitadas/);
  temMotivo(avaliarItensEstaticos(com({git: {commit: null, sujo: true, tags: []}})), /identificar o commit/);
  assert.deepEqual(avaliarItensEstaticos(com({git: {commit: COMMIT, sujo: false, tags: []}})), []);
  assert.deepEqual(avaliarItensEstaticos(com({git: {commit: COMMIT, sujo: false, tags: ['latest']}})), []);
  for (const tag of ['v1.2.3', 'v2026.11.17', 'v2026.11.17.2']) {
    assert.deepEqual(avaliarItensEstaticos(com({git: {commit: COMMIT, sujo: false, tags: [tag]}})), [], tag);
  }
});

test('itens estáticos: contrato inválido gera motivos com prefixo contrato:', () => {
  const fatos = structuredClone(fatosValidos());
  fatos.cfg.formato = 1;
  temMotivo(avaliarItensEstaticos(fatos), /^contrato: /);
});

test('itens estáticos: functions/.env* que o firebase-tools publicaria recusam, nos dois modos (PLT-2)', () => {
  for (const arquivos of [['.env'], ['.env.example', `.env.${PRODUCAO}`], ['.env.prod'], ['.env.local', '.env']]) {
    temMotivo(avaliarItensEstaticos(com({envFunctions: arquivos})), /o firebase-tools publicaria essas variáveis/);
    temMotivo(avaliarGancho({fatos: fatosGancho({envFunctions: arquivos}), alvoFirebase: 'functions',
      publicacao: publicacaoDoGuard(), marcador: null}), /o firebase-tools publicaria/);
  }
  assert.deepEqual(avaliarItensEstaticos(com({envFunctions: []})), []);
  assert.deepEqual(avaliarItensEstaticos(com({envFunctions: ['.env.example', '.env.local']})), []);
  temMotivo(avaliarItensEstaticos(com({envFunctions: null})), /não foi possível listar functions\/\.env/);
  temMotivo(avaliarItensEstaticos(com({envFunctions: undefined})), /não foi possível listar/);
});

test('itens estáticos: GOOGLE_APPLICATION_CREDENTIALS é recusado, também no gancho (E-04)', () => {
  temMotivo(avaliarItensEstaticos(com({env: {GOOGLE_APPLICATION_CREDENTIALS: '/tmp/chave.json'}})), /GOOGLE_APPLICATION_CREDENTIALS definido/);
  assert.ok(conflitosDeAmbiente({GOOGLE_APPLICATION_CREDENTIALS: 'x'}, PRODUCAO, {gancho: true}).length > 0);
  assert.ok(!avaliarItensEstaticos(com({env: {GOOGLE_APPLICATION_CREDENTIALS: '/tmp/chave.json'}})).join(' ').includes('/tmp/chave.json'),
    'o valor nunca aparece no motivo');
});

test('conflitosDeAmbiente no gancho ignora GCLOUD_PROJECT mas não as demais variáveis', () => {
  assert.deepEqual(conflitosDeAmbiente({GCLOUD_PROJECT: 'fenixgran-outro'}, PRODUCAO, {gancho: true}), []);
  assert.equal(conflitosDeAmbiente({GCLOUD_PROJECT: 'fenixgran-outro'}, PRODUCAO).length, 1);
  assert.equal(conflitosDeAmbiente({GOOGLE_CLOUD_PROJECT: 'fenixgran-outro'}, PRODUCAO, {gancho: true}).length, 1);
  assert.deepEqual(conflitosDeAmbiente({GCLOUD_PROJECT: PRODUCAO}, PRODUCAO, {gancho: true}), []);
});

// 3. build
test('avaliarBuild: marcador de release correto devolve []', () => {
  assert.deepEqual(avaliarBuild({marcador: marcadorRelease(), project: PRODUCAO, git: {commit: COMMIT}}), []);
});

test('avaliarBuild: cada desvio do marcador gera motivo', () => {
  const git = {commit: COMMIT};
  const casos = [
    ['marcador nulo', null],
    ['perfil e2e', marcadorRelease({perfil: 'e2e'})],
    ['loginE2E', marcadorRelease({loginE2E: true})],
    ['emuladores', marcadorRelease({emuladores: true})],
    ['perfil verificacao', marcadorRelease({perfil: 'verificacao'})],
    ['publicavel false', marcadorRelease({publicavel: false})],
    ['outro projectId', marcadorRelease({projectId: 'fenixgran-outro'})],
    ['outro commit', marcadorRelease({origem: {commit: 'b'.repeat(40), alteracoesLocais: false}})],
    ['alteracoesLocais', marcadorRelease({origem: {commit: COMMIT, alteracoesLocais: true}})],
    ['sem origem', marcadorRelease({origem: undefined})],
    ['ambiente diferente de prod', marcadorRelease({ambiente: null})],
  ];
  for (const [rotulo, marcador] of casos) {
    assert.ok(avaliarBuild({marcador, project: PRODUCAO, git}).length > 0, rotulo);
  }
  assert.ok(avaliarBuild({marcador: marcadorRelease(), project: PRODUCAO, git: {commit: null}}).length > 0, 'git sem commit');
});

// 4. pipeline com executor falso
const executorFalso = (saidas = {}) => {
  const chamadas = [];
  const executar = (comando, argumentos, opcoes) => {
    chamadas.push({comando, argumentos, opcoes});
    const chave = `${comando} ${argumentos.join(' ')}`;
    for (const [prefixo, codigo] of Object.entries(saidas)) if (chave.startsWith(prefixo)) return codigo;
    return 0;
  };
  return {chamadas, executar};
};
const textoDe = (chamada) => `${chamada.comando} ${chamada.argumentos.join(' ')}`;

/** Inventário falso das Functions: sem segredo declarado, todas publicáveis (o padrão destes testes). */
const INVENTARIO_SEM_SEGREDO = [
  {nome: 'bootstrapAccount', segredos: []},
  {nome: 'getFinancialReport', segredos: []},
  {nome: 'stripeWebhook', segredos: []},
];
/** Inventário falso com o desenho real: IA e Stripe declaram segredo. */
const INVENTARIO_COM_SEGREDOS = [
  {nome: 'analyzeFinancialQuestion', segredos: ['GOOGLE_AI_API_KEY']},
  {nome: 'bootstrapAccount', segredos: []},
  {nome: 'getFinancialReport', segredos: []},
  {nome: 'stripeWebhook', segredos: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET']},
];
const publicar = (opcoes) => executarPublicacao({inventariarFuncoes: () => INVENTARIO_SEM_SEGREDO, ...opcoes});

test('executarPublicacao: fatos inválidos não executam nada', () => {
  const {chamadas, executar} = executorFalso();
  const resultado = publicar({fatos: com({git: {commit: COMMIT, sujo: true, tags: ['v2026.11.17']}}), executar, lerMarcador: () => marcadorRelease()});
  assert.equal(resultado.publicado, false);
  assert.equal(resultado.etapa, 'itens');
  assert.equal(chamadas.length, 0);
});

test('executarPublicacao: compilação das Functions falhando impede deploy', () => {
  const {chamadas, executar} = executorFalso({'npm run functions:build': 1});
  const resultado = publicar({fatos: fatosValidos('functions'), executar, lerMarcador: () => marcadorRelease()});
  assert.equal(resultado.publicado, false);
  assert.equal(resultado.etapa, 'build-functions');
  assert.deepEqual(chamadas.map(textoDe), ['npm run functions:build']);
});

test('executarPublicacao: hosting com build:release falhando não chama o firebase', () => {
  const {chamadas, executar} = executorFalso({'npm run build:release': 1});
  const resultado = publicar({fatos: fatosValidos('hosting'), executar, lerMarcador: () => marcadorRelease()});
  assert.equal(resultado.publicado, false);
  assert.equal(resultado.etapa, 'build');
  assert.deepEqual(chamadas.map(textoDe), ['npm run build:release']);
  assert.ok(!chamadas.some((c) => c.comando === 'firebase'));
});

test('executarPublicacao: hosting com marcador de build E2E não chama o firebase', () => {
  const {chamadas, executar} = executorFalso();
  const resultado = publicar({
    fatos: fatosValidos('hosting'),
    executar,
    lerMarcador: () => ({perfil: 'e2e', publicavel: false, ambiente: null, emuladores: true, loginE2E: true, projectId: EMULADOR, origem: {commit: COMMIT, alteracoesLocais: false}}),
  });
  assert.equal(resultado.publicado, false);
  assert.equal(resultado.etapa, 'build');
  assert.ok(!chamadas.some((c) => c.comando === 'firebase'));
});

test('executarPublicacao: hosting sem marcador não chama o firebase', () => {
  const {chamadas, executar} = executorFalso();
  const resultado = publicar({fatos: fatosValidos('hosting'), executar, lerMarcador: () => null});
  assert.equal(resultado.publicado, false);
  assert.ok(!chamadas.some((c) => c.comando === 'firebase'));
});

test('executarPublicacao: caminho feliz de functions', () => {
  const {chamadas, executar} = executorFalso();
  const resultado = publicar({fatos: fatosValidos('functions'), executar, lerMarcador: () => null});
  assert.equal(resultado.publicado, true);
  assert.deepEqual(chamadas.map(textoDe), [
    'npm run functions:build',
    `firebase deploy --only functions --project ${PRODUCAO} --non-interactive`,
  ]);
  const publicacao = JSON.parse(chamadas[1].opcoes.env.FENIX_PUBLICACAO);
  assert.equal(publicacao.project, PRODUCAO);
  assert.equal(publicacao.commit, COMMIT);
});

test('executarPublicacao: todo processo filho recebe a marca de publicação em curso', () => {
  const {chamadas, executar} = executorFalso();
  publicar({fatos: fatosValidos('hosting'), executar, lerMarcador: () => marcadorRelease()});
  assert.equal(chamadas.length, 2);
  for (const chamada of chamadas) assert.equal(chamada.opcoes?.env?.[MARCA_PUBLICACAO_EM_CURSO], '1', textoDe(chamada));
});

test('publicação aninhada (marca em curso no ambiente) é recusada antes de executar algo; o gancho a aceita', () => {
  const {chamadas, executar} = executorFalso();
  const fatos = {...fatosValidos(), env: {[MARCA_PUBLICACAO_EM_CURSO]: '1'}};
  const resultado = publicar({fatos, executar, lerMarcador: () => null});
  assert.equal(resultado.etapa, 'itens');
  assert.ok(resultado.motivos.some((m) => /publicação aninhada/.test(m)), resultado.motivos.join('\n'));
  assert.equal(chamadas.length, 0);
  assert.deepEqual(conflitosDeAmbiente({[MARCA_PUBLICACAO_EM_CURSO]: '1'}, PRODUCAO, {gancho: true}), []);
});

test('executarPublicacao: caminho feliz de hosting inclui build:release antes do firebase', () => {
  const {chamadas, executar} = executorFalso();
  const resultado = publicar({fatos: fatosValidos('hosting'), executar, lerMarcador: () => marcadorRelease()});
  assert.equal(resultado.publicado, true);
  assert.deepEqual(chamadas.map(textoDe), [
    'npm run build:release',
    `firebase deploy --only hosting --project ${PRODUCAO} --non-interactive`,
  ]);
});

test('executarPublicacao: cada alvo de ALVOS usa o --only esperado e só hosting constrói', () => {
  const esperado = {
    firestore: 'firestore:rules,firestore:indexes',
    'firestore-indices': 'firestore:indexes',
    functions: 'functions',
    webhook: 'functions:stripeWebhook',
    hosting: 'hosting',
    safe: 'firestore:rules,firestore:indexes,functions',
    storage: 'storage',
    release: 'firestore:rules,firestore:indexes,storage,functions,hosting',
  };
  assert.deepEqual(Object.keys(ALVOS).sort(), Object.keys(esperado).sort());
  for (const [alvo, only] of Object.entries(esperado)) {
    const {chamadas, executar} = executorFalso();
    const resultado = publicar({fatos: fatosValidos(alvo), executar, lerMarcador: () => marcadorRelease()});
    assert.equal(resultado.publicado, true, alvo);

    if (alvo === 'release') {
      assert.deepEqual(
        chamadas.filter(c => c.comando === 'firebase')
          .map(c => c.argumentos[2]),
        ['firestore:rules,firestore:indexes', 'storage', 'functions', 'hosting']
      );
      assert.equal(
        chamadas.filter(c => textoDe(c) === 'npm run functions:build').length,
        1
      );
      assert.equal(
        chamadas.filter(c => textoDe(c) === 'npm run build:release').length,
        1
      );
      continue;
    }
    const firebase = chamadas.find((c) => c.comando === 'firebase');
    assert.deepEqual(firebase.argumentos, ['deploy', '--only', only, '--project', PRODUCAO, '--non-interactive'], alvo);
    assert.equal(chamadas.some((c) => textoDe(c) === 'npm run build:release'), alvo === 'hosting', alvo);
    assert.equal(chamadas.at(-1), firebase, `${alvo}: o firebase é a última chamada`);
  }
});

test('executarPublicacao: Functions com segredo não registrado ficam de fora, listadas, e o resto é publicado', () => {
  const {chamadas, executar} = executorFalso();
  const registros = [];
  const resultado = publicar({fatos: fatosValidos('functions'), executar, lerMarcador: () => null,
    inventariarFuncoes: () => INVENTARIO_COM_SEGREDOS, registrar: (m) => registros.push(m)});
  assert.equal(resultado.publicado, true);
  const firebase = chamadas.find((c) => c.comando === 'firebase');
  assert.equal(firebase.argumentos[2], 'functions:bootstrapAccount,functions:getFinancialReport');
  assert.ok(registros.some((m) => /fora desta publicação: analyzeFinancialQuestion \(segredo não registrado: GOOGLE_AI_API_KEY\)/.test(m)));
  assert.ok(registros.some((m) => /fora desta publicação: stripeWebhook/.test(m)));
  // P6-B: o guard não deixa entender exclusão como desligamento de versão já implantada.
  assert.ok(registros.some((m) => /NÃO remove uma versão antiga já implantada.*RB-17/.test(m)));
});

test('executarPublicacao: safe troca só o pedaço functions do --only pela lista publicável', () => {
  const {chamadas, executar} = executorFalso();
  publicar({fatos: fatosValidos('safe'), executar, lerMarcador: () => null, inventariarFuncoes: () => INVENTARIO_COM_SEGREDOS});
  const firebase = chamadas.find((c) => c.comando === 'firebase');
  assert.equal(firebase.argumentos[2], 'firestore:rules,firestore:indexes,functions:bootstrapAccount,functions:getFinancialReport');
});

test('executarPublicacao: com todos os segredos registrados, o alvo functions volta a ser --only functions', () => {
  const {chamadas, executar} = executorFalso();
  const fatos = fatosValidos('functions');
  fatos.cfg.producao.segredos = ['GOOGLE_AI_API_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'];
  publicar({fatos, executar, lerMarcador: () => null, inventariarFuncoes: () => INVENTARIO_COM_SEGREDOS});
  assert.equal(chamadas.find((c) => c.comando === 'firebase').argumentos[2], 'functions');
});

test('executarPublicacao: webhook sem os segredos do Stripe é recusado antes do firebase', () => {
  const {chamadas, executar} = executorFalso();
  const resultado = publicar({fatos: fatosValidos('webhook'), executar, lerMarcador: () => null, inventariarFuncoes: () => INVENTARIO_COM_SEGREDOS});
  assert.equal(resultado.publicado, false);
  assert.equal(resultado.etapa, 'funcoes');
  temMotivo(resultado.motivos, /stripeWebhook exige segredo não registrado em producao\.segredos \(STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET\)/);
  assert.ok(!chamadas.some((c) => c.comando === 'firebase'));
});

test('executarPublicacao: inventário indisponível, sem a função exigida ou sem nada publicável recusa antes do firebase', () => {
  for (const inventariarFuncoes of [() => { throw new Error('functions/lib/index.js ausente'); }, () => [{nome: 'bootstrapAccount', segredos: []}]]) {
    const {chamadas, executar} = executorFalso();
    const resultado = publicar({fatos: fatosValidos('webhook'), executar, lerMarcador: () => null, inventariarFuncoes});
    assert.equal(resultado.publicado, false);
    assert.equal(resultado.etapa, 'funcoes');
    assert.ok(!chamadas.some((c) => c.comando === 'firebase'));
  }
  const {chamadas, executar} = executorFalso();
  const todas = publicar({fatos: fatosValidos('functions'), executar, lerMarcador: () => null,
    inventariarFuncoes: () => [{nome: 'analyzeFinancialQuestion', segredos: ['GOOGLE_AI_API_KEY']}]});
  assert.equal(todas.etapa, 'funcoes');
  temMotivo(todas.motivos, /nenhuma função publicável/);
  assert.ok(!chamadas.some((c) => c.comando === 'firebase'));
});

test('executarPublicacao: alvos sem Functions não leem o inventário', () => {
  for (const alvo of ['firestore', 'firestore-indices', 'hosting', 'storage']) {
    const {executar} = executorFalso();
    const resultado = publicar({fatos: fatosValidos(alvo), executar, lerMarcador: () => marcadorRelease(),
      inventariarFuncoes: () => { throw new Error('não devia ser chamado'); }});
    assert.equal(resultado.publicado, true, alvo);
  }
});

test('executarPublicacao: firebase falhando devolve etapa firebase', () => {
  const {executar} = executorFalso({'firebase deploy': 1});
  const resultado = publicar({fatos: fatosValidos(), executar, lerMarcador: () => null});
  assert.equal(resultado.publicado, false);
  assert.equal(resultado.etapa, 'firebase');
});

// 5. gancho
const fatosGancho = (extra = {}) => {
  const {alvo: _alvo, confirmar: _confirmar, ...resto} = fatosValidos();
  return {...resto, env: {GCLOUD_PROJECT: PRODUCAO}, ...extra};
};
const publicacaoDoGuard = (extra = {}) => JSON.stringify({project: PRODUCAO, commit: COMMIT, alvo: 'functions', ...extra});

test('avaliarGancho: tudo válido devolve [] (GCLOUD_PROJECT igual ao projeto não é conflito)', () => {
  for (const alvoFirebase of ['firestore', 'functions']) {
    assert.deepEqual(avaliarGancho({fatos: fatosGancho(), alvoFirebase, publicacao: publicacaoDoGuard(), marcador: null}), [], alvoFirebase);
  }
  assert.deepEqual(avaliarGancho({fatos: fatosGancho(), alvoFirebase: 'hosting', publicacao: publicacaoDoGuard({alvo: 'hosting'}), marcador: marcadorRelease()}), []);
});

test('avaliarGancho: deploy direto, sem FENIX_PUBLICACAO ou com ele ilegível, é recusado', () => {
  temMotivo(avaliarGancho({fatos: fatosGancho(), alvoFirebase: 'functions', publicacao: undefined, marcador: null}), /publicação fora do guard/);
  temMotivo(avaliarGancho({fatos: fatosGancho(), alvoFirebase: 'functions', publicacao: 'não é json', marcador: null}), /publicação fora do guard/);
});

test('avaliarGancho: FENIX_PUBLICACAO de outro projeto ou de outro commit é recusado', () => {
  temMotivo(avaliarGancho({fatos: fatosGancho(), alvoFirebase: 'functions', publicacao: publicacaoDoGuard({project: 'fenixgran-outro'}), marcador: null}), /projeto do deploy não é o autorizado/);
  temMotivo(avaliarGancho({fatos: fatosGancho(), alvoFirebase: 'functions', publicacao: publicacaoDoGuard({commit: 'b'.repeat(40)}), marcador: null}), /commit mudou/);
});

test('avaliarGancho: alvo do firebase desconhecido, ausente ou o Emulator como projeto é recusado', () => {
  temMotivo(avaliarGancho({fatos: fatosGancho(), alvoFirebase: 'database', publicacao: publicacaoDoGuard(), marcador: null}), /alvo do firebase-tools desconhecido/);
  temMotivo(avaliarGancho({fatos: fatosGancho(), alvoFirebase: undefined, publicacao: publicacaoDoGuard(), marcador: null}), /alvo do firebase-tools desconhecido/);
  temMotivo(avaliarGancho({fatos: fatosGancho({project: EMULADOR}), alvoFirebase: 'functions', publicacao: publicacaoDoGuard({project: EMULADOR}), marcador: null}), /Emulator não recebe deploy/);
});

test('avaliarGancho: hosting sem marcador ou com build E2E é recusado', () => {
  const publicacao = publicacaoDoGuard({alvo: 'hosting'});
  temMotivo(avaliarGancho({fatos: fatosGancho(), alvoFirebase: 'hosting', publicacao, marcador: null}), /fenix-build\.json ausente/);
  temMotivo(avaliarGancho({fatos: fatosGancho(), alvoFirebase: 'hosting', publicacao, marcador: marcadorRelease({perfil: 'e2e', loginE2E: true, emuladores: true})}), /E2E ou de Emulator/);
});

test('avaliarGancho: sem liberação registrada, recusa mesmo com FENIX_PUBLICACAO válido', () => {
  const fatos = fatosGancho();
  fatos.cfg.producao.liberacao = null;
  temMotivo(avaliarGancho({fatos, alvoFirebase: 'functions', publicacao: publicacaoDoGuard(), marcador: null}), /liberação de publicação não registrada/);
});

// 6. CLI numa cópia descartável da raiz (contrato controlado; recusa antes de qualquer execução)
const envLimpo = (extra = {}) => ({PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...extra});
const rodarNaCopia = (copia, script, args, extra = {}) => {
  const resultado = spawnSync(process.execPath, [join(copia.raiz, 'tools', 'deploy', script), ...args], {
    cwd: copia.raiz, encoding: 'utf8', env: envLimpo({...copia.envGit, ...extra}), timeout: 30000,
  });
  return {code: resultado.status, out: resultado.stdout ?? '', err: resultado.stderr ?? ''};
};
const semLiberacao = criarRaizTemporaria({ajustarContrato: (cfg) => { cfg.producao.liberacao = null; }});
const comLiberacao = criarRaizTemporaria({ajustarContrato: (cfg) => {
  cfg.producao.web = cfgValida().producao.web;
  cfg.producao.liberacao = {...LIBERACAO_G0};
}});
test.after(() => { semLiberacao.remover(); comLiberacao.remover(); });

test('publicar.mjs sem liberação sai 3 e cita a liberação; nada é executado', () => {
  const resultado = rodarNaCopia(semLiberacao, 'publicar.mjs', ['--alvo', 'functions', '--project', PRODUCAO, '--confirmar', PRODUCAO]);
  assert.equal(resultado.code, 3, resultado.err);
  assert.match(resultado.err, /liberação/);
  assert.match(resultado.err, /nada foi publicado/);
  assert.ok(!resultado.out.includes('verificações antes da publicação'), 'nenhuma verificação foi iniciada');
  assert.ok(!resultado.out.includes('firebase deploy'));
});

test('publicar.mjs com liberação, mas sem commit identificável, sai 3 sem executar nada', () => {
  const resultado = rodarNaCopia(comLiberacao, 'publicar.mjs', ['--alvo', 'functions', '--project', PRODUCAO, '--confirmar', PRODUCAO]);
  assert.equal(resultado.code, 3, resultado.err);
  assert.doesNotMatch(resultado.err, /liberação de publicação não registrada/);
  assert.match(resultado.err, /commit/);
  assert.ok(!resultado.out.includes('verificações antes da publicação'), 'nenhuma verificação foi iniciada');
});

test('publicar.mjs recusa a publicação aninhada mesmo com liberação', () => {
  const resultado = rodarNaCopia(comLiberacao, 'publicar.mjs', ['--alvo', 'functions', '--project', PRODUCAO, '--confirmar', PRODUCAO],
    {[MARCA_PUBLICACAO_EM_CURSO]: '1'});
  assert.equal(resultado.code, 3, resultado.err);
  assert.match(resultado.err, /publicação aninhada/);
  assert.ok(!resultado.out.includes('verificações antes da publicação'));
});

test('publicar.mjs recusa argumentos proibidos ou malformados sem executar nada', () => {
  const casos = [
    ['--alvo', 'functions', '--project', PRODUCAO, '--project', PRODUCAO, '--confirmar', PRODUCAO],
    ['--alvo', 'functions', '-P', 'x', '--confirmar', PRODUCAO],
    ['--alvo', 'functions', '--project', PRODUCAO, '--confirmar', PRODUCAO, '--only', 'hosting'],
    ['--alvo', 'functions', '--project', PRODUCAO, '--confirmar', PRODUCAO, '--force'],
    ['--alvo', 'functions', '--confirmar', PRODUCAO],
    ['--alvo', 'functions', '--alvo', 'hosting', '--project', PRODUCAO, '--confirmar', PRODUCAO],
  ];
  for (const argv of casos) {
    const resultado = rodarNaCopia(comLiberacao, 'publicar.mjs', argv);
    assert.notEqual(resultado.code, 0, argv.join(' '));
    assert.ok(!resultado.out.includes('verificações antes da publicação'), argv.join(' '));
    assert.ok(!resultado.out.includes('concluída'), argv.join(' '));
  }
});

test('guarda-predeploy.mjs: hosting e storage com GCLOUD_PROJECT de produção saem 3 (sem liberação nem guard)', () => {
  const hosting = rodarNaCopia(semLiberacao, 'guarda-predeploy.mjs', ['hosting'], {GCLOUD_PROJECT: PRODUCAO});
  assert.equal(hosting.code, 3, hosting.err);
  assert.match(hosting.err, /deploy recusado/);
  assert.equal(rodarNaCopia(semLiberacao, 'guarda-predeploy.mjs', ['storage'], {GCLOUD_PROJECT: PRODUCAO}).code, 3);
  assert.equal(rodarNaCopia(semLiberacao, 'guarda-predeploy.mjs', ['functions']).code, 3);
});

test('guarda-predeploy.mjs com liberação, mas sem FENIX_PUBLICACAO (deploy direto), sai 3', () => {
  const resultado = rodarNaCopia(comLiberacao, 'guarda-predeploy.mjs', ['functions'], {GCLOUD_PROJECT: PRODUCAO});
  assert.equal(resultado.code, 3, resultado.err);
  assert.match(resultado.err, /fora do guard/);
});


test('release: falha de compilacao impede qualquer publicacao', () => {
  const {chamadas, executar} = executorFalso({'npm run functions:build': 1});
  const resultado = publicar({
    fatos: fatosValidos('release'),
    executar,
    lerMarcador: () => marcadorRelease(),
  });
  assert.equal(resultado.publicado, false);
  assert.equal(resultado.etapa, 'build-functions');
  assert.ok(!chamadas.some(c => c.comando === 'firebase'));
});

test('release: preserva exclusao de Functions sem segredos registrados', () => {
  const {chamadas, executar} = executorFalso();
  const fatos = fatosValidos('release');
  fatos.cfg.producao.segredos = ['GOOGLE_AI_API_KEY'];
  const resultado = publicar({
    fatos,
    executar,
    lerMarcador: () => marcadorRelease(),
    inventariarFuncoes: () => INVENTARIO_COM_SEGREDOS,
  });
  assert.equal(resultado.publicado, true);
  const calls = chamadas.filter(c => c.comando === 'firebase');
  assert.equal(calls.length, 4);
  assert.equal(
    calls[2].argumentos[2],
    'functions:analyzeFinancialQuestion,functions:bootstrapAccount,functions:getFinancialReport'
  );
  assert.ok(calls.every(c => !c.argumentos[2].includes('stripeWebhook')));
});

test('release: primeira falha remota interrompe demais alvos', () => {
  const {chamadas} = executorFalso();
  const executar = (comando, argumentos, opcoes) => {
    chamadas.push({comando, argumentos, opcoes});
    return comando === 'firebase' && argumentos[2] === 'storage' ? 1 : 0;
  };
  const resultado = publicar({
    fatos: fatosValidos('release'),
    executar,
    lerMarcador: () => marcadorRelease(),
  });
  assert.equal(resultado.publicado, false);
  assert.deepEqual(
    chamadas.filter(c => c.comando === 'firebase').map(c => c.argumentos[2]),
    ['firestore:rules,firestore:indexes', 'storage']
  );
});


test('nenhum alvo de deploy executa suites de homologacao', () => {
  for (const alvo of Object.keys(ALVOS)) {
    const {chamadas, executar} = executorFalso();
    const resultado = publicar({
      fatos: fatosValidos(alvo),
      executar,
      lerMarcador: () => marcadorRelease(),
    });

    assert.equal(resultado.publicado, true, alvo);

    for (const chamada of chamadas) {
      if (chamada.comando === 'npm') {
        assert.ok(
          ['functions:build', 'build:release'].includes(chamada.argumentos[1]),
          `Comando indevido em ${alvo}: ${textoDe(chamada)}`
        );
      }
    }
  }
});


test('functions: publica lotes de ate cinco com intervalo', () => {
  const inventario = Array.from({length: 12}, (_, i) => ({
    nome: 'funcao' + String(i + 1).padStart(2, '0'),
    segredos: [],
  }));

  const {chamadas, executar} = executorFalso();
  const pausas = [];

  const resultado = publicar({
    fatos: fatosValidos('functions'),
    executar,
    lerMarcador: () => marcadorRelease(),
    inventariarFuncoes: () => inventario,
    pausar: ms => pausas.push(ms),
  });

  assert.equal(resultado.publicado, true);
  const lotes = chamadas.filter(c => c.comando === 'firebase');
  assert.deepEqual(
    lotes.map(c => c.argumentos[2].split(',').length),
    [5, 5, 2]
  );
  assert.deepEqual(pausas, [65000, 65000]);
});

test('functions: retomada aceita apenas funcoes autorizadas', () => {
  const {chamadas, executar} = executorFalso();
  const resultado = publicar({
    fatos: {
      ...fatosValidos('functions'),
      selecao: 'bootstrapAccount',
    },
    executar,
    lerMarcador: () => marcadorRelease(),
  });

  assert.equal(resultado.publicado, true);
  assert.equal(
    chamadas.find(c => c.comando === 'firebase').argumentos[2],
    'functions:bootstrapAccount'
  );
});

test('functions: selecao nao autorizada impede deploy', () => {
  const {chamadas, executar} = executorFalso();
  const resultado = publicar({
    fatos: {
      ...fatosValidos('functions'),
      selecao: 'stripeWebhook',
    },
    executar,
    lerMarcador: () => marcadorRelease(),
    inventariarFuncoes: () => INVENTARIO_COM_SEGREDOS,
  });

  assert.equal(resultado.publicado, false);
  assert.ok(!chamadas.some(c => c.comando === 'firebase'));
});


test('deploy nativo: firestore e storage autorizados sem tag', () => {
  for (const alvoFirebase of ['firestore', 'storage']) {
    const fatos = fatosGancho({
      git: {commit: COMMIT, sujo: false, tags: []},
    });

    assert.deepEqual(avaliarGancho({
      fatos,
      alvoFirebase,
      publicacao: undefined,
      marcador: null,
    }), []);
  }
});

test('hosting nativo: valida antes e depois do build', () => {
  const fatos = fatosGancho({
    git: {commit: COMMIT, sujo: false, tags: []},
  });

  const entrada = {
    fatos,
    alvoFirebase: 'hosting',
    publicacao: undefined,
  };

  assert.deepEqual(avaliarGancho({
    ...entrada,
    marcador: null,
    conferirBuild: false,
  }), []);

  assert.ok(avaliarGancho({
    ...entrada,
    marcador: null,
  }).length > 0);

  assert.deepEqual(avaliarGancho({
    ...entrada,
    marcador: marcadorRelease(),
  }), []);
});

test('functions: publicacao operacional em duplas', () => {
  const inventario = Array.from({length: 7}, (_, i) => ({
    nome: 'funcao' + i,
    segredos: [],
  }));

  const {chamadas, executar} = executorFalso();

  const resultado = publicar({
    fatos: fatosValidos('functions'),
    executar,
    lerMarcador: () => marcadorRelease(),
    inventariarFuncoes: () => inventario,
    tamanhoLote: 2,
  });

  assert.equal(resultado.publicado, true);

  assert.deepEqual(
    chamadas.filter(c => c.comando === 'firebase')
      .map(c => c.argumentos[2].split(',').length),
    [2, 2, 2, 1]
  );
});
