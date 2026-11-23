import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path, {delimiter, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {carregarConfiguracao} from '../../tools/ambiente/contrato.mjs';
import {planoDasFuncoes} from '../../tools/deploy/funcoes.mjs';
import {criarRaizTemporaria} from './support/raiz-temporaria.mjs';
import {
  TITULO_DO_SANEAMENTO, ambienteDoGcloud, avaliarContas, avaliarGuardas, classificarFuncoes, codigoDeSaida, comandoDeListagem,
  comandosDeSaneamento, consultarFuncoes, interpretarFuncoesRemotas, mesDe, montarResumo, referenciaMascarada, textoDeOrientacao,
} from '../../tools/operacao/preflight.mjs';

/**
 * Pré-voo somente leitura da produção (P6-A/P6-B). Nada aqui fala com o Google Cloud ou o Firebase: as funções puras
 * recebem leitores e executores falsos; a CLI roda numa cópia da raiz com projeto FICTÍCIO, um `gcloud` falso no PATH
 * e o hook que prova que o `firebase-admin` não foi carregado.
 */
const cfg = carregarConfiguracao();
const PRODUCAO = cfg.producao.projectId;
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..', '..');
const HOOK = path.join(AQUI, 'support', 'sem-firebase-admin.cjs');
const UID_A = 'uid-usuario-0001';
const UID_B = 'uid-usuario-0002';
const PROIBIDOS_NA_SAIDA = ['@', 'ya29.', 'AIza', '-----BEGIN', 'uid-usuario', 'ana.souza', 'Ana Souza'];
const semVazamento = (texto) => {
  for (const proibido of PROIBIDOS_NA_SAIDA) assert.ok(!texto.includes(proibido), `a saída não pode conter ${proibido}`);
};

// ---------------------------------------------------------------------------------------------------------------
// Guardas
// ---------------------------------------------------------------------------------------------------------------

test('guardas: liberam só produção confirmada, ambiente limpo e parte válida', () => {
  const base = {cfg, project: PRODUCAO, confirmar: PRODUCAO, env: {}};
  assert.deepEqual(avaliarGuardas(base), []);
  for (const parte of ['contas', 'funcoes', 'tudo']) assert.deepEqual(avaliarGuardas({...base, parte}), []);
  assert.deepEqual(avaliarGuardas({...base, env: {GCLOUD_PROJECT: PRODUCAO, FIREBASE_CONFIG: JSON.stringify({projectId: PRODUCAO})}}), []);
});

test('guardas: cada recusa tem motivo em pt-BR', () => {
  const base = {cfg, project: PRODUCAO, confirmar: PRODUCAO, env: {}};
  const recusa = (alteracao, motivo) => {
    const motivos = avaliarGuardas({...base, ...alteracao});
    assert.ok(motivos.some((m) => motivo.test(m)), `${motivo}: ${motivos.join(' | ')}`);
  };
  recusa({project: undefined}, /--project ausente/);
  recusa({project: 'outro-projeto-123', confirmar: 'outro-projeto-123'}, /não é o projeto de produção/);
  recusa({project: cfg.emulador.projectId, confirmar: cfg.emulador.projectId}, /Emulator ou de verificação/);
  recusa({project: 'demo-qualquer', confirmar: 'demo-qualquer'}, /Emulator ou de verificação/);
  recusa({confirmar: undefined}, /--confirmar ausente/);
  recusa({confirmar: 'outro'}, /--confirmar precisa repetir/);
  recusa({parte: 'tudo-e-mais'}, /--parte inválida/);
  recusa({env: {FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080'}}, /Emulator/);
  recusa({env: {FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099'}}, /FIREBASE_AUTH_EMULATOR_HOST/);
  for (const nome of ['GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_TOKEN', 'CLOUDSDK_AUTH_ACCESS_TOKEN_FILE', 'CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE']) {
    recusa({env: {[nome]: 'x'}}, new RegExp(`${nome} definido: credencial conflitante`));
  }
  for (const nome of ['CLOUDSDK_CORE_PROJECT', 'GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT']) {
    recusa({env: {[nome]: 'outro-projeto-123'}}, new RegExp(`${nome} no ambiente aponta para outro projeto`));
  }
  recusa({env: {FIREBASE_CONFIG: JSON.stringify({projectId: 'outro-projeto-123'})}}, /FIREBASE_CONFIG/);
  recusa({env: {FIREBASE_CONFIG: 'não é json'}}, /FIREBASE_CONFIG/);
});

// ---------------------------------------------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------------------------------------------

const nomeCompleto = (regiao, nome) => `projects/${PRODUCAO}/locations/${regiao}/functions/${nome}`;
const REMOTAS_GEN = [
  // gen2 na composição, segredos vazios
  {name: nomeCompleto('southamerica-east1', 'listarAlgo'), environment: 'GEN_2', state: 'ACTIVE', serviceConfig: {secretEnvironmentVariables: []}},
  // gen2 excluída da publicação: declara segredo não registrado
  {
    name: nomeCompleto('southamerica-east1', 'analisarComIa'), environment: 'GEN_2', state: 'ACTIVE',
    serviceConfig: {
      secretEnvironmentVariables: [{key: 'GOOGLE_AI_API_KEY', projectId: PRODUCAO, secret: 'GOOGLE_AI_API_KEY', version: 'latest'}],
      environmentVariables: {SEGREDO_FICTICIO: 'ya29.valor-que-nunca-sai'},
    },
  },
  // gen1 excluída da publicação (nome em minúsculas e segredos no topo)
  {
    name: nomeCompleto('us-central1', 'stripewebhook'), status: 'ACTIVE',
    secretEnvironmentVariables: [{key: 'STRIPE_WEBHOOK_SECRET', projectId: PRODUCAO, secret: 'STRIPE_WEBHOOK_SECRET', version: '3'}],
  },
  // gen1 fora do código
  {name: nomeCompleto('southamerica-east1', 'funcaoAntiga'), status: 'ACTIVE'},
  // gen2 na composição, nome em minúsculas
  {name: nomeCompleto('southamerica-east1', 'outrafuncao'), environment: 'GEN_2', state: 'ACTIVE', serviceConfig: {}},
];
const INVENTARIO = [
  {nome: 'listarAlgo', segredos: []},
  {nome: 'analisarComIa', segredos: ['GOOGLE_AI_API_KEY']},
  {nome: 'stripeWebhook', segredos: ['STRIPE_WEBHOOK_SECRET']},
  {nome: 'outraFuncao', segredos: []},
  {nome: 'aindaNaoImplantada', segredos: []},
];

test('funções: interpreta gen1 e gen2 (nome, região, estado e só NOMES de segredos)', () => {
  const remotas = interpretarFuncoesRemotas(REMOTAS_GEN, PRODUCAO);
  assert.equal(remotas.length, 5);
  const porNome = Object.fromEntries(remotas.map((r) => [r.nome, r]));
  assert.deepEqual(porNome.analisarComIa, {nome: 'analisarComIa', regiao: 'southamerica-east1', estado: 'ACTIVE', geracao: 2, segredos: ['GOOGLE_AI_API_KEY']});
  assert.deepEqual(porNome.stripewebhook, {nome: 'stripewebhook', regiao: 'us-central1', estado: 'ACTIVE', geracao: 1, segredos: ['STRIPE_WEBHOOK_SECRET']});
  assert.equal(porNome.funcaoAntiga.geracao, 1);
  assert.deepEqual(porNome.funcaoAntiga.segredos, []);
  assert.ok(!JSON.stringify(remotas).includes('ya29.'), 'variáveis de ambiente e valores nunca são lidos');
  assert.throws(() => interpretarFuncoesRemotas({}, PRODUCAO), /lista JSON/);
  assert.throws(() => interpretarFuncoesRemotas([{name: 'x'}], PRODUCAO), /formato esperado/);
  assert.throws(() => interpretarFuncoesRemotas([{name: 'projects/outro-123/locations/a-b-c/functions/f'}], PRODUCAO), /projeto diferente/);
});

test('funções: classifica excluída da publicação, fora do código e na composição', () => {
  const plano = planoDasFuncoes(INVENTARIO, []);
  const r = classificarFuncoes({remotas: interpretarFuncoesRemotas(REMOTAS_GEN, PRODUCAO), plano});
  assert.deepEqual(r.naComposicao.map((f) => f.nome).sort(), ['listarAlgo', 'outrafuncao']);
  assert.deepEqual(r.excluidaDaPublicacao.map((f) => f.nome).sort(), ['analisarComIa', 'stripewebhook']);
  assert.deepEqual(r.excluidaDaPublicacao.find((f) => f.nome === 'analisarComIa').segredosFaltantes, ['GOOGLE_AI_API_KEY']);
  assert.deepEqual(r.foraDoCodigo.map((f) => f.nome), ['funcaoAntiga']);
  assert.deepEqual(r.aImplantar, ['aindaNaoImplantada']);
  assert.deepEqual(r.segredosLigados, ['GOOGLE_AI_API_KEY', 'STRIPE_WEBHOOK_SECRET']);
  assert.equal(r.status, 'achados');
  assert.equal(r.achados, 3);
});

test('funções: com o segredo registrado a função volta à composição; sem nada fora, não há achado', () => {
  const plano = planoDasFuncoes(INVENTARIO, ['GOOGLE_AI_API_KEY', 'STRIPE_WEBHOOK_SECRET']);
  const limpas = REMOTAS_GEN.filter((r) => !r.name.endsWith('funcaoAntiga'));
  const r = classificarFuncoes({remotas: interpretarFuncoesRemotas(limpas, PRODUCAO), plano});
  assert.equal(r.status, 'ok');
  assert.equal(r.achados, 0);
  assert.equal(r.naComposicao.length, 4);
});

test('funções: a consulta é UMA chamada de leitura, com timeout, sem prompt e sem credencial por variável', () => {
  const chamadas = [];
  const executar = (comando, argumentos, opcoes) => {
    chamadas.push({comando, argumentos, opcoes});
    return {status: 0, stdout: JSON.stringify(REMOTAS_GEN), stderr: ''};
  };
  const ambiente = {PATH: '/bin', HOME: '/h', GOOGLE_APPLICATION_CREDENTIALS: '/x.json', FIREBASE_TOKEN: 't', OUTRA: 'v'};
  const r = consultarFuncoes({projectId: PRODUCAO, executar, env: ambiente});
  assert.equal(r.status, 'ok');
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].comando, 'gcloud');
  assert.deepEqual(chamadas[0].argumentos, ['functions', 'list', `--project=${PRODUCAO}`, '--format=json', '--quiet']);
  assert.deepEqual(comandoDeListagem(PRODUCAO), ['gcloud', chamadas[0].argumentos]);
  assert.equal(chamadas[0].opcoes.timeout, 60_000);
  assert.equal(chamadas[0].opcoes.env.CLOUDSDK_CORE_DISABLE_PROMPTS, '1');
  assert.deepEqual(Object.keys(ambienteDoGcloud(ambiente)).sort(), ['CLOUDSDK_CORE_DISABLE_PROMPTS', 'HOME', 'PATH']);
});

test('funções: falha, tempo esgotado, ausência do gcloud e JSON inválido são inconclusivos', () => {
  const inconclusivo = (executar, motivo) => {
    const r = consultarFuncoes({projectId: PRODUCAO, executar});
    assert.equal(r.status, 'inconclusivo');
    assert.ok(r.motivos.some((m) => motivo.test(m)), `${motivo}: ${r.motivos.join(' | ')}`);
  };
  inconclusivo(() => ({status: 99, stdout: '', stderr: 'PERMISSION_DENIED: conta ana.souza@example.com'}), /permissão negada/);
  inconclusivo(() => ({status: 1, stdout: '', stderr: 'API has not been used'}), /API de Functions/);
  inconclusivo(() => ({status: 1, stdout: '', stderr: 'You do not currently have an active account'}), /credencial do gcloud/);
  inconclusivo(() => ({status: 2, stdout: '', stderr: ''}), /terminou com erro/);
  inconclusivo(() => ({status: null, error: {code: 'ETIMEDOUT'}, stdout: ''}), /tempo esgotado/);
  inconclusivo(() => ({status: null, error: {code: 'ENOENT'}, stdout: ''}), /não foi encontrado no PATH/);
  inconclusivo(() => ({status: null, signal: 'SIGTERM', stdout: ''}), /interrompido/);
  inconclusivo(() => ({status: 0, stdout: 'isto não é json', stderr: ''}), /JSON válido/);
  inconclusivo(() => ({status: 0, stdout: '{"a":1}', stderr: ''}), /lista JSON/);
  const r = consultarFuncoes({projectId: PRODUCAO, executar: () => ({status: 1, stdout: '', stderr: 'ana.souza@example.com'})});
  semVazamento(JSON.stringify(r));
});

test('funções: timeout real do processo filho (opção interna) vira inconclusivo', () => {
  const executar = (_comando, _argumentos, opcoes) => spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], opcoes);
  const inicio = Date.now();
  const r = consultarFuncoes({projectId: PRODUCAO, executar, timeoutMs: 300});
  assert.ok(Date.now() - inicio < 5000);
  assert.equal(r.status, 'inconclusivo');
  assert.match(r.motivos.join(' '), /tempo esgotado|interrompido/);
});

test('funções: o saneamento é só texto, um comando por função em achado, e só com nomes seguros', () => {
  const plano = planoDasFuncoes(INVENTARIO, []);
  const r = classificarFuncoes({remotas: interpretarFuncoesRemotas(REMOTAS_GEN, PRODUCAO), plano});
  const comandos = comandosDeSaneamento({projectId: PRODUCAO, funcoes: r});
  assert.equal(comandos.length, 3);
  assert.ok(comandos.includes(`firebase functions:delete funcaoAntiga --region southamerica-east1 --project ${PRODUCAO}`));
  assert.ok(comandos.includes(`firebase functions:delete stripewebhook --region us-central1 --project ${PRODUCAO}`));
  const injetada = {...r, foraDoCodigo: [{nome: 'x; rm -rf /', regiao: 'us-central1', segredos: []}], excluidaDaPublicacao: []};
  assert.deepEqual(comandosDeSaneamento({projectId: PRODUCAO, funcoes: injetada}), []);
  const resumo = montarResumo({projectId: PRODUCAO, agora: new Date('2026-11-18T10:00:00Z'), partes: ['funcoes'], funcoes: r});
  const texto = textoDeOrientacao({resumo, saneamento: comandos});
  assert.ok(texto.includes(TITULO_DO_SANEAMENTO));
  assert.match(texto, /CRÍTICO/);
  assert.match(texto, /órfãs/);
  assert.equal(codigoDeSaida(resumo), 1);
  assert.ok(!textoDeOrientacao({resumo: montarResumo({projectId: PRODUCAO, agora: new Date(), partes: ['funcoes'], funcoes: {...r, achados: 0, status: 'ok', excluidaDaPublicacao: [], foraDoCodigo: []}}), saneamento: []}).includes('Saneamento'));
});

// ---------------------------------------------------------------------------------------------------------------
// Contas
// ---------------------------------------------------------------------------------------------------------------

/** Leitor falso sobre uma lista ordenada: honra `depoisDe` e `limite` e devolve também campos pessoais (que não podem sair). */
const leitorDe = (perfis, chamadas = []) => async ({depoisDe, limite}) => {
  chamadas.push({depoisDe, limite});
  const apos = depoisDe === null ? perfis : perfis.filter((p) => p.id > depoisDe);
  return apos.slice(0, limite).map((p) => ({...p, email: 'ana.souza@example.com', displayName: 'Ana Souza', photoURL: 'https://x/ya29.foto'}));
};
const perfil = (n, accessStatus, createdAt) => ({id: `uid-usuario-${String(n).padStart(4, '0')}`, accessStatus, createdAt});
const CINCO = [
  perfil(1, 'granted', new Date('2026-01-10T12:00:00Z')),
  perfil(2, undefined, new Date('2026-03-15T23:59:00Z')),
  perfil(3, 'revoked', new Date('2026-04-01T00:00:00Z')),
  perfil(4, 'pendente', {toDate: () => new Date('2026-05-20T08:00:00Z')}),
  perfil(5, 'granted', null),
];

test('contas: pagina por cursor, conta cada categoria e mascara as referências', async () => {
  const chamadas = [];
  const r = await avaliarContas({lerPagina: leitorDe(CINCO, chamadas), tamanhoDaPagina: 2, teto: 10});
  assert.equal(r.status, 'ok');
  assert.deepEqual(chamadas, [
    {depoisDe: null, limite: 2},
    {depoisDe: 'uid-usuario-0002', limite: 2},
    {depoisDe: 'uid-usuario-0004', limite: 2},
  ]);
  assert.equal(r.resumo.perfisAtivos, 5);
  assert.equal(r.resumo.autorizados, 2);
  assert.equal(r.resumo.semAutorizacao, 2);
  assert.equal(r.resumo.revogadosAindaAtivos, 1);
  assert.equal(r.resumo.achados, 3);
  assert.equal(r.resumo.status, 'achados');
  assert.deepEqual(r.resumo.referenciasSemAutorizacao, [
    {ref: referenciaMascarada('uid-usuario-0002'), criadoEm: '2026-03'},
    {ref: referenciaMascarada('uid-usuario-0004'), criadoEm: '2026-05'},
  ]);
  assert.match(r.resumo.referenciasSemAutorizacao[0].ref, /^[0-9a-f]{12}$/);
  semVazamento(JSON.stringify(r));
});

test('contas: tudo autorizado não é achado; no máximo 20 referências e o excedente é sinalizado', async () => {
  const limpos = await avaliarContas({lerPagina: leitorDe([perfil(1, 'granted'), perfil(2, 'granted')])});
  assert.equal(limpos.resumo.status, 'ok');
  assert.equal(limpos.resumo.achados, 0);
  const muitos = Array.from({length: 450}, (_, i) => perfil(i + 1, undefined, '2026-02-01T00:00:00Z'));
  const r = await avaliarContas({lerPagina: leitorDe(muitos)});
  assert.equal(r.resumo.semAutorizacao, 450);
  assert.equal(r.resumo.referenciasSemAutorizacao.length, 20);
  assert.equal(r.resumo.referenciasTruncadas, true);
  semVazamento(JSON.stringify(r));
});

test('contas: o teto de perfis é inconclusivo; exatamente o teto ainda é lido por inteiro', async () => {
  const acima = await avaliarContas({lerPagina: leitorDe(CINCO), tamanhoDaPagina: 2, teto: 4});
  assert.equal(acima.status, 'inconclusivo');
  assert.match(acima.motivos[0], /mais de 4 perfis ativos/);
  const exato = await avaliarContas({lerPagina: leitorDe(CINCO), tamanhoDaPagina: 2, teto: 5});
  assert.equal(exato.status, 'ok');
  assert.equal(exato.resumo.perfisAtivos, 5);
  const cheia = await avaliarContas({lerPagina: leitorDe(CINCO.slice(0, 4)), tamanhoDaPagina: 2, teto: 4});
  assert.equal(cheia.status, 'ok');
  assert.equal(cheia.resumo.perfisAtivos, 4);
  // Leitor que repete sempre a mesma página cheia nunca entra em laço: bate no teto.
  const repetido = await avaliarContas({lerPagina: async () => [perfil(1, 'granted'), perfil(2, 'granted')], tamanhoDaPagina: 2, teto: 6});
  assert.equal(repetido.status, 'inconclusivo');
});

test('contas: leitor que lança, que demora ou que devolve formato inesperado é inconclusivo sem vazar o erro', async () => {
  const lanca = await avaliarContas({lerPagina: async () => { throw Object.assign(new Error('falha com ana.souza@example.com'), {code: 7}); }});
  assert.equal(lanca.status, 'inconclusivo');
  assert.match(lanca.motivos[0], /permissão negada/);
  semVazamento(JSON.stringify(lanca));
  const semCredencial = await avaliarContas({lerPagina: async () => { throw new Error('Could not load the default credentials. ana.souza@example.com'); }});
  assert.match(semCredencial.motivos[0], /credencial ausente/);
  semVazamento(JSON.stringify(semCredencial));
  const sincrono = await avaliarContas({lerPagina: () => { throw new Error('boom'); }});
  assert.equal(sincrono.status, 'inconclusivo');
  const inicio = Date.now();
  const demora = await avaliarContas({lerPagina: () => new Promise(() => {}), timeoutMs: 30});
  assert.ok(Date.now() - inicio < 3000);
  assert.equal(demora.status, 'inconclusivo');
  assert.match(demora.motivos[0], /tempo esgotado/);
  for (const ruim of [null, {}, [{accessStatus: 'granted'}], [{id: ''}]]) {
    const r = await avaliarContas({lerPagina: async () => ruim});
    assert.equal(r.status, 'inconclusivo', JSON.stringify(ruim));
  }
});

test('contas: mês e referência não expõem dia, hora nem uid', () => {
  assert.equal(mesDe(new Date('2026-07-31T23:59:59Z')), '2026-07');
  assert.equal(mesDe({seconds: 1_772_323_200}), '2026-03');
  assert.equal(mesDe('lixo'), null);
  assert.equal(mesDe(undefined), null);
  assert.equal(mesDe({toDate: () => { throw new Error('x'); }}), null);
  const ref = referenciaMascarada(UID_A);
  assert.equal(ref.length, 12);
  assert.notEqual(ref, referenciaMascarada(UID_B));
  assert.equal(ref, referenciaMascarada(UID_A));
});

test('resumo: inconclusivo tem precedência sobre achados; sem nada, saída 0', async () => {
  const contas = await avaliarContas({lerPagina: leitorDe(CINCO)});
  const inconclusivoDeFuncoes = {status: 'inconclusivo', motivos: ['o gcloud não respondeu em 60 s (tempo esgotado)']};
  const misto = montarResumo({projectId: PRODUCAO, agora: new Date('2026-11-18T10:00:00Z'), partes: ['funcoes', 'contas'], funcoes: inconclusivoDeFuncoes, contas});
  assert.equal(codigoDeSaida(misto), 4);
  assert.equal(misto.somenteLeitura, true);
  const texto = textoDeOrientacao({resumo: misto, saneamento: []});
  assert.match(texto, /Firebase console → Functions/);
  assert.match(texto, /Cloud Run functions/);
  assert.match(texto, /acesso-piloto\.mjs adicionar/);
  assert.match(texto, /bloqueadas por padrão/);
  semVazamento(JSON.stringify(misto) + texto);
  const limpo = montarResumo({projectId: PRODUCAO, agora: new Date(), partes: ['contas'], contas: await avaliarContas({lerPagina: leitorDe([perfil(1, 'granted')])})});
  assert.equal(codigoDeSaida(limpo), 0);
});

// ---------------------------------------------------------------------------------------------------------------
// Prova estática
// ---------------------------------------------------------------------------------------------------------------

test('estática: nenhuma escrita no Firestore e functions:delete só no gerador de texto', () => {
  const puro = readFileSync(join(RAIZ, 'tools', 'operacao', 'preflight.mjs'), 'utf8');
  const cli = readFileSync(join(RAIZ, 'tools', 'operacao', 'preflight-producao.mjs'), 'utf8');
  for (const [nome, fonte] of [['preflight.mjs', puro], ['preflight-producao.mjs', cli]]) {
    for (const escrita of ['.set(', '.update(', '.delete(', '.create(', 'runTransaction', 'batch(']) {
      assert.ok(!fonte.includes(escrita), `${nome} não pode conter ${escrita}`);
    }
  }
  assert.ok(!cli.includes('functions:delete'), 'a CLI nunca monta o comando de exclusão');
  const linhas = puro.split('\n').map((linha, i) => ({linha, i})).filter(({linha}) => linha.includes('functions:delete'));
  const permitidas = linhas.filter(({linha}) => /^\s*\.map\(\(\{nome, regiao\}\) => `firebase functions:delete /.test(linha));
  assert.equal(permitidas.length, 1, 'uma única ocorrência, dentro do gerador de texto comandosDeSaneamento');
  const comentarios = linhas.filter(({linha}) => /^\s*(\*|\/\/)/.test(linha));
  assert.equal(linhas.length - permitidas.length - comentarios.length, 0, 'nenhuma outra ocorrência fora de comentário');
  // O único spawn da CLI é o do `gcloud functions list`, montado por comandoDeListagem; nada de exclusão nos argumentos.
  assert.deepEqual(comandoDeListagem('p-abcde').flat(2).filter((a) => /delete|deploy|update|create/.test(a)), []);
  assert.equal([...cli.matchAll(/spawnSync/g)].length, 2, 'importação e uso como executor injetado');
});

// ---------------------------------------------------------------------------------------------------------------
// CLI (cópia da raiz com projeto fictício, gcloud falso e hook sem firebase-admin)
// ---------------------------------------------------------------------------------------------------------------

const FICTICIO = 'fenix-ficticio-nao-existe';
const copia = criarRaizTemporaria({
  ajustarContrato: (contrato) => {
    contrato.producao.projectId = FICTICIO;
    contrato.producao.web = null;
    contrato.producao.liberacao = null;
    contrato.producao.segredos = [];
  },
});
const pasta = mkdtempSync(join(tmpdir(), 'preflight-cli-'));
test.after(() => {
  copia.remover();
  rmSync(pasta, {recursive: true, force: true});
});

// functions/lib/index.js falso na cópia (o inventário lê o `__endpoint` de cada export).
mkdirSync(join(copia.raiz, 'functions', 'lib'), {recursive: true});
writeFileSync(join(copia.raiz, 'functions', 'lib', 'index.js'), `
const funcao = (segredos = []) => ({__endpoint: {secretEnvironmentVariables: segredos.map((key) => ({key}))}});
exports.listarAlgo = funcao();
exports.analisarComIa = funcao(['GOOGLE_AI_API_KEY']);
exports.stripeWebhook = funcao(['STRIPE_WEBHOOK_SECRET']);
exports.outraFuncao = funcao();
exports.naoEhFuncao = 42;
`);

const remotasDaCopia = REMOTAS_GEN.map((r) => ({...r, name: r.name.replace(PRODUCAO, FICTICIO)}));
const fixture = join(pasta, 'funcoes.json');
writeFileSync(fixture, JSON.stringify(remotasDaCopia));
const fixtureLimpa = join(pasta, 'funcoes-limpas.json');
writeFileSync(fixtureLimpa, JSON.stringify([remotasDaCopia[0], remotasDaCopia[4]]));

let contador = 0;
/** Cria um diretório com um `gcloud` falso que registra cada chamada (uma linha por chamada) e executa `corpo`. */
const gcloudFalso = (corpo) => {
  const dir = join(pasta, `gcloud-${contador += 1}`);
  mkdirSync(dir);
  const marca = join(dir, 'chamadas');
  writeFileSync(join(dir, 'gcloud'), `#!/bin/sh\necho "$@" >> "${marca}"\n${corpo}\n`);
  chmodSync(join(dir, 'gcloud'), 0o755);
  return {dir, chamadas: () => (existsSync(marca) ? readFileSync(marca, 'utf8').split('\n').filter(Boolean) : [])};
};
const CLI = join(copia.raiz, 'tools', 'operacao', 'preflight-producao.mjs');
const rodar = (argumentos, {gcloud = null, extra = {}, hook = true} = {}) => {
  const marcaAdmin = join(pasta, `admin-${contador += 1}`);
  const r = spawnSync(process.execPath, [...(hook ? ['--require', HOOK] : []), CLI, ...argumentos], {
    encoding: 'utf8',
    env: {
      PATH: `${gcloud?.dir ?? pasta}${delimiter}${process.env.PATH}`, HOME: process.env.HOME ?? '', TESTE_MARCA_FIREBASE_ADMIN: marcaAdmin, ...copia.envGit, ...extra,
    },
  });
  return {codigo: r.status, out: r.stdout, err: r.stderr, tudo: `${r.stdout}${r.stderr}`, carregouAdmin: existsSync(marcaAdmin)};
};
const completo = ['--project', FICTICIO, '--confirmar', FICTICIO];

test('CLI: argumentos inválidos saem 2 e recusas das guardas saem 3, sem gcloud e sem firebase-admin', () => {
  const gcloud = gcloudFalso('exit 99');
  const casos = [
    [[], 3],
    [[...completo, '--parte', 'xyz'], 2],
    [[...completo, '--force'], 2],
    [[...completo, '--token', 'abc'], 2],
    [[...completo, '--only', 'functions'], 2],
    [[...completo, '--desconhecida', 'x'], 2],
    [['posicional'], 2],
    [['--project', FICTICIO], 3],
    [['--project', FICTICIO, '--confirmar', 'outro'], 3],
    [['--confirmar', FICTICIO], 3],
    [['--project', 'minhas-financas-local', '--confirmar', 'minhas-financas-local'], 3],
    [['--project', 'sistema-financeiro-pesso-20698', '--confirmar', 'sistema-financeiro-pesso-20698'], 3],
  ];
  for (const [argumentos, codigo] of casos) {
    const r = rodar(argumentos, {gcloud});
    assert.equal(r.codigo, codigo, `${argumentos.join(' ')}: ${r.tudo}`);
    assert.match(r.err, /^\[pre-voo\] /);
    assert.equal(r.carregouAdmin, false);
    semVazamento(r.tudo);
  }
  const ambientes = [
    {FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080'},
    {GOOGLE_APPLICATION_CREDENTIALS: '/tmp/inexistente.json'},
    {FIREBASE_TOKEN: 'x'},
    {CLOUDSDK_AUTH_ACCESS_TOKEN_FILE: '/tmp/x'},
    {CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE: '/tmp/x'},
    {GCLOUD_PROJECT: 'outro-projeto-123'},
    {CLOUDSDK_CORE_PROJECT: 'outro-projeto-123'},
    {GOOGLE_CLOUD_PROJECT: 'outro-projeto-123'},
    {FIREBASE_CONFIG: JSON.stringify({projectId: 'outro-projeto-123'})},
  ];
  for (const extra of ambientes) {
    const r = rodar(completo, {gcloud, extra});
    assert.equal(r.codigo, 3, `${Object.keys(extra)}: ${r.tudo}`);
    assert.match(r.err, /recusado; nada foi consultado/);
    assert.equal(r.carregouAdmin, false);
  }
  assert.deepEqual(gcloud.chamadas(), [], 'nenhuma recusa chega ao gcloud');
});

test('CLI: --parte funcoes com achados sai 1, chama o gcloud uma vez e imprime o saneamento só como texto', () => {
  const gcloud = gcloudFalso(`cat "${fixture}"`);
  const r = rodar([...completo, '--parte', 'funcoes'], {gcloud});
  assert.equal(r.codigo, 1, r.tudo);
  assert.equal(r.carregouAdmin, false, 'a parte funcoes nunca carrega o firebase-admin');
  const chamadas = gcloud.chamadas();
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0], `functions list --project=${FICTICIO} --format=json --quiet`);
  assert.match(r.out, /SOMENTE LEITURA — nada é alterado/);
  const json = JSON.parse(r.out.slice(r.out.indexOf('{'), r.out.lastIndexOf('}') + 1));
  assert.equal(json.projeto, FICTICIO);
  assert.deepEqual(json.partes, ['funcoes']);
  assert.deepEqual(json.funcoes.contagens, {naComposicao: 2, excluidaDaPublicacao: 2, foraDoCodigo: 1, aImplantar: 0});
  assert.deepEqual(json.funcoes.segredosLigadosAFuncoesImplantadas, ['GOOGLE_AI_API_KEY', 'STRIPE_WEBHOOK_SECRET']);
  assert.equal(json.contas, undefined);
  assert.ok(r.out.includes(TITULO_DO_SANEAMENTO));
  assert.ok(r.out.includes(`firebase functions:delete funcaoAntiga --region southamerica-east1 --project ${FICTICIO}`));
  assert.ok(r.out.includes(`firebase functions:delete analisarComIa --region southamerica-east1 --project ${FICTICIO}`));
  assert.ok(r.out.includes(`firebase functions:delete stripewebhook --region us-central1 --project ${FICTICIO}`));
  semVazamento(r.tudo);
});

test('CLI: --parte funcoes sem achados sai 0 e não imprime saneamento', () => {
  const gcloud = gcloudFalso(`cat "${fixtureLimpa}"`);
  const r = rodar([...completo, '--parte', 'funcoes'], {gcloud});
  assert.equal(r.codigo, 0, r.tudo);
  assert.ok(!r.out.includes('Saneamento'));
  assert.ok(!r.out.includes('functions:delete'));
  assert.equal(gcloud.chamadas().length, 1);
  semVazamento(r.tudo);
});

test('CLI: gcloud que falha, JSON inválido e API sem resposta saem 4 com orientação de console', () => {
  const casos = [
    [gcloudFalso('echo "PERMISSION_DENIED conta ana.souza@example.com" >&2\nexit 99'), /permissão negada/],
    [gcloudFalso('echo "isto não é json"'), /JSON válido/],
    [gcloudFalso('echo "{}"'), /lista JSON/],
  ];
  for (const [gcloud, motivo] of casos) {
    const r = rodar([...completo, '--parte', 'funcoes'], {gcloud});
    assert.equal(r.codigo, 4, r.tudo);
    assert.match(r.out, motivo);
    assert.match(r.out, /Firebase console → Functions/);
    assert.match(r.out, /Cloud Run functions/);
    assert.ok(!r.out.includes('functions:delete'));
    assert.equal(gcloud.chamadas().length, 1);
    semVazamento(r.tudo);
  }
});

test('CLI: --parte contas sem o firebase-admin instalado é inconclusivo (4), sem gcloud e sem rede', () => {
  const gcloud = gcloudFalso('exit 99');
  // Sem o hook: ele encerraria com 97 no pedido do firebase-admin; aqui a cópia da raiz simplesmente não tem o SDK.
  const r = rodar([...completo, '--parte', 'contas'], {gcloud, hook: false});
  assert.equal(r.codigo, 4, r.tudo);
  assert.match(r.out, /firebase-admin não está instalado/);
  assert.match(r.out, /coleção users/);
  assert.deepEqual(gcloud.chamadas(), []);
  semVazamento(r.tudo);
});

test('CLI: --parte tudo consulta o gcloud uma vez e o resultado inconclusivo de uma parte prevalece (4)', () => {
  const gcloud = gcloudFalso(`cat "${fixture}"`);
  const r = rodar(completo, {gcloud, hook: false});
  assert.equal(r.codigo, 4, r.tudo);
  assert.equal(gcloud.chamadas().length, 1);
  assert.match(r.out, /"funcoes"/);
  assert.match(r.out, /Saneamento/);
  semVazamento(r.tudo);
});
