import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

/**
 * Guardas do utilitário de limpeza de investimentos (PR-PLAT-02).
 *
 * Este arquivo NÃO usa o Emulator: cada caso executa o utilitário como o
 * operador o executa, com um ambiente controlado (nada herdado do Google) e com
 * o hook `sem-firebase-admin.cjs`, que grava uma marca e encerra com 97 se o
 * `firebase-admin` for carregado. Em todo caso negativo a prova é tripla:
 * saída 1, motivo em pt-BR no stderr e nenhuma marca, ou seja, a recusa veio
 * antes de o SDK ser carregado.
 */

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..', '..');
const SCRIPT = path.join(RAIZ, 'tools', 'investments', 'limpar-investimentos.mjs');
const HOOK = path.join(AQUI, 'support', 'sem-firebase-admin.cjs');
const PROJETO_EMULADOR = 'minhas-financas-local';
const PROJETO_HISTORICO = 'sistema-financeiro-pesso-20698';
const WORKSPACE = 'guard-ws';
const HOST_OK = '127.0.0.1:8080';

const diretorio = mkdtempSync(path.join(tmpdir(), 'limpar-guard-'));
test.after(() => rmSync(diretorio, {recursive: true, force: true}));

let contador = 0;
/** Executa o utilitário com ambiente mínimo: só PATH mais o que o caso pedir. */
const executar = (argumentos, ambiente = {}) => {
  const marca = path.join(diretorio, `marca-${contador += 1}`);
  const resultado = spawnSync(
    process.execPath,
    ['--require', HOOK, SCRIPT, ...argumentos],
    {
      cwd: RAIZ,
      encoding: 'utf8',
      env: {PATH: process.env.PATH, TESTE_MARCA_FIREBASE_ADMIN: marca, ...ambiente},
    },
  );
  return {
    codigo: resultado.status,
    saida: `${resultado.stdout ?? ''}${resultado.stderr ?? ''}`,
    stderr: resultado.stderr ?? '',
    carregouAdmin: existsSync(marca),
  };
};

const basicos = [`--projeto=${PROJETO_EMULADOR}`, `--workspace=${WORKSPACE}`];
const emulador = {FIRESTORE_EMULATOR_HOST: HOST_OK};

/** Caso negativo: saída 1, motivo esperado e SDK nunca carregado. */
const recusa = (argumentos, ambiente, motivo) => {
  const r = executar(argumentos, ambiente);
  assert.equal(r.codigo, 1, r.saida);
  assert.match(r.stderr, motivo);
  assert.equal(r.carregouAdmin, false, 'o firebase-admin não pode ser carregado');
};

// ------------------------------------------------------------------- projeto

test('o Project ID histórico é recusado, com e sem o Emulator', () => {
  const args = [`--projeto=${PROJETO_HISTORICO}`, `--workspace=${WORKSPACE}`];
  recusa(args, {}, /Projeto recusado/);
  recusa(args, emulador, /Projeto recusado/);
});

test('qualquer projeto diferente do Emulator é recusado', () => {
  for (const id of [
    'meu-app-prod', 'meu-app-staging', 'meu-app-dev', 'meu-app-test',
    'demo-minhas-financas', 'minhas-financas-local-2', 'Minhas-Financas-Local',
  ]) {
    recusa([`--projeto=${id}`, `--workspace=${WORKSPACE}`], emulador, /Projeto recusado/);
  }
});

test('PROJETO no ambiente não substitui --projeto', () => {
  recusa([`--workspace=${WORKSPACE}`], {...emulador, PROJETO: PROJETO_EMULADOR},
    /Informe --projeto=minhas-financas-local/);
});

test('--projeto ausente é recusado', () => {
  recusa([`--workspace=${WORKSPACE}`], emulador, /Informe --projeto/);
});

// ------------------------------------------------------------------ ambiente

test('FIRESTORE_EMULATOR_HOST ausente, vazio ou fora do loopback é recusado', () => {
  for (const host of [
    undefined, '', '10.0.0.5:8080', 'firestore.googleapis.com:443',
    'localhost.evil.com:8080', '127.0.0.1', 'localhost', '127.0.0.1:0',
    '127.0.0.1:65536', '127.0.0.1:abc', '127.0.0.2:8080', 'evil.com:8080',
    'http://127.0.0.1:8080', '127.0.0.1:8080/x', ' 127.0.0.1:8080',
  ]) {
    const ambiente = host === undefined ? {} : {FIRESTORE_EMULATOR_HOST: host};
    recusa(basicos, ambiente, /FIRESTORE_EMULATOR_HOST/);
  }
});

test('conflito de variável de projeto no ambiente é recusado', () => {
  for (const variavel of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'PROJETO']) {
    recusa(basicos, {...emulador, [variavel]: PROJETO_HISTORICO}, /Conflito de ambiente/);
    recusa(basicos, {...emulador, [variavel]: ''}, /Conflito de ambiente/);
  }
});

test('credenciais no ambiente são recusadas', () => {
  recusa(basicos, {...emulador, GOOGLE_APPLICATION_CREDENTIALS: '/tmp/inexistente.json'},
    /GOOGLE_APPLICATION_CREDENTIALS/);
  // FIREBASE_CONFIG só passa nomeando o projeto do Emulator (é o que `firebase emulators:exec` define).
  recusa(basicos, {...emulador, FIREBASE_CONFIG: '{"projectId":"x"}'}, /FIREBASE_CONFIG/);
  recusa(basicos, {...emulador, FIREBASE_CONFIG: JSON.stringify({projectId: PROJETO_HISTORICO})}, /FIREBASE_CONFIG/);
  recusa(basicos, {...emulador, FIREBASE_CONFIG: 'nao-e-json'}, /FIREBASE_CONFIG/);
  recusa(basicos, {...emulador, FIREBASE_CONFIG: '""'}, /FIREBASE_CONFIG/);
  const doEmulador = executar(basicos, {...emulador, FIREBASE_CONFIG: JSON.stringify({projectId: PROJETO_EMULADOR})});
  assert.equal(doEmulador.codigo, 97, doEmulador.saida);
});

// ---------------------------------------------------------- opções removidas

test('as opções de override removidas são recusadas com mensagem própria', () => {
  const removida = /foi removida \(PR-PLAT-02\)/;
  for (const flag of [
    '--allow-development-reset-on-project',
    `--allow-development-reset-on-project=${PROJETO_HISTORICO}`,
    `--allow-development-reset-on-project=${PROJETO_EMULADOR}`,
    '--confirmar-projeto',
    `--confirmar-projeto=${PROJETO_HISTORICO}`,
    `--confirmar-projeto=${PROJETO_EMULADOR}`,
  ]) {
    recusa([...basicos, flag], emulador, removida);
  }
});

// -------------------------------------------------------- argumentos malformados

test('argumentos malformados são recusados', () => {
  recusa([...basicos, '--workspace=outro'], emulador, /Opção repetida: --workspace/);
  recusa([...basicos, '--apply', '--apply'], emulador, /Opção repetida: --apply/);
  recusa([...basicos, 'posicional'], emulador, /posicional inesperado/);
  recusa([`--projeto=${PROJETO_EMULADOR}`, '--projeto', `--workspace=${WORKSPACE}`], emulador,
    /Opção repetida: --projeto/);
  recusa([`--projeto=`, `--workspace=${WORKSPACE}`], emulador, /--projeto exige um valor/);
  recusa([`--projeto`, `--workspace=${WORKSPACE}`], emulador, /--projeto exige um valor/);
  recusa([`--projeto=${PROJETO_EMULADOR}`, '--workspace='], emulador, /--workspace exige um valor/);
  recusa([`--projeto=${PROJETO_EMULADOR}`, '--workspace'], emulador, /--workspace exige um valor/);
  recusa([...basicos, '--apply=true'], emulador, /--apply não aceita valor/);
  recusa([...basicos, '--='], emulador, /Opção malformada/);
  recusa([...basicos, '--force'], emulador, /Opção desconhecida: --force/);
});

test('--workspace com espaço ou "/" é recusado', () => {
  for (const id of ['a/b', 'a b', 'workspaces/x', '../x', '..', '.', 'a\tb']) {
    recusa([`--projeto=${PROJETO_EMULADOR}`, `--workspace=${id}`], emulador,
      /não pode conter espaço nem "\/"/);
  }
});

test('--workspace é obrigatório e --pagina precisa estar entre 1 e 500', () => {
  recusa([`--projeto=${PROJETO_EMULADOR}`], emulador, /Informe --workspace/);
  for (const valor of ['0', '501', '-1', '1.5', 'abc', '3e2', '1 0']) {
    recusa([...basicos, `--pagina=${valor}`], emulador, /--pagina precisa ser/);
  }
});

// ------------------------------------------------------------- confirmações

test('--apply exige --confirmar com o próprio workspace', () => {
  recusa([...basicos, '--apply'], emulador, /--confirmar=<workspaceId>/);
  recusa([...basicos, '--apply', '--confirmar=outro'], emulador, /--confirmar=<workspaceId>/);
});

test('o legado exige --confirmar-legado próprio', () => {
  for (const flag of [
    '--include-legacy-investment-transactions', '--incluir-transacoes-legadas',
  ]) {
    recusa([...basicos, flag, '--apply', `--confirmar=${WORKSPACE}`], emulador,
      /--confirmar-legado=<workspaceId>/);
    recusa([...basicos, flag, '--apply', `--confirmar=${WORKSPACE}`, '--confirmar-legado=x'],
      emulador, /--confirmar-legado=<workspaceId>/);
  }
});

// -------------------------------------------------------------- caso positivo

test('com o Emulator em loopback, as guardas passam e o SDK é carregado', () => {
  for (const host of ['127.0.0.1:8080', 'localhost:9000', '[::1]:8080', '::1:8080', '127.0.0.1:65535']) {
    const r = executar(basicos, {FIRESTORE_EMULATOR_HOST: host});
    // O hook encerra com 97 no primeiro carregamento do SDK: as guardas passaram.
    assert.equal(r.codigo, 97, `${host}: ${r.saida}`);
    assert.equal(r.carregouAdmin, true, host);
  }
  const completo = executar([
    ...basicos, '--apply', `--confirmar=${WORKSPACE}`, '--incluir-ledger', '--pagina=500',
    '--include-legacy-investment-transactions', `--confirmar-legado=${WORKSPACE}`,
  ], {...emulador, GCLOUD_PROJECT: PROJETO_EMULADOR, GOOGLE_CLOUD_PROJECT: PROJETO_EMULADOR});
  assert.equal(completo.codigo, 97, completo.saida);
  assert.equal(completo.carregouAdmin, true);
});

// ----------------------------------------------------------- análise estática

test('não resta caminho de hard delete remoto no código', () => {
  const fonte = readFileSync(SCRIPT, 'utf8');
  assert.equal(/sistema-financeiro/.test(fonte), false);
  assert.equal(/process\.env\.PROJETO/.test(fonte), false);
  assert.equal(/OVERRIDE|PRODUCAO/.test(fonte), false);
  assert.equal(/\/stag\|/.test(fonte), false);
});

test('o utilitário não fala com o Firebase Auth', () => {
  const fonte = readFileSync(SCRIPT, 'utf8');
  assert.equal(/admin\.auth\(|getAuth|deleteUser/.test(fonte), false);
});

test('o firebase-admin é carregado só depois das guardas', () => {
  const fonte = readFileSync(SCRIPT, 'utf8');
  const carga = fonte.indexOf("require('../../functions/node_modules/firebase-admin')");
  assert.ok(carga > 0);
  assert.equal(fonte.indexOf("require('../../functions/node_modules/firebase-admin')", carga + 1), -1);
  for (const marcador of [
    'Opção desconhecida', 'Projeto recusado', 'FIRESTORE_EMULATOR_HOST é obrigatório',
    'Conflito de ambiente', '--confirmar-legado=<workspaceId>',
  ]) {
    assert.ok(fonte.indexOf(marcador) < carga, marcador);
  }
});
