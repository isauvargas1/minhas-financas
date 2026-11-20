import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {criarRaizTemporaria} from './support/raiz-temporaria.mjs';

/**
 * Guardas de tools/piloto/acesso-piloto.mjs (P6-A). Sem Emulator: cada caso executa a ferramenta com ambiente mínimo e
 * com o hook `sem-firebase-admin.cjs` (marca e saída 97 se o `firebase-admin` for carregado). Em todo caso negativo a
 * prova é tripla: saída 1, motivo em pt-BR e nenhuma marca, ou seja, a recusa veio antes de o SDK ser carregado.
 * O caminho de produção nunca é executado. Os casos de produção rodam numa cópia descartável da raiz com contrato
 * controlado (`support/raiz-temporaria.mjs`): com a liberação G0 preenchida (para chegar às demais guardas) e sem ela
 * (para provar a recusa), nunca contra o contrato real, cujo estado muda quando o proprietário registra a liberação.
 */

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..', '..');
const HOOK = path.join(AQUI, 'support', 'sem-firebase-admin.cjs');
const EMULADOR = 'minhas-financas-local';
const PRODUCAO = 'sistema-financeiro-pesso-20698';
const EMAIL = 'convidado@example.com';
const FS_OK = {FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080'};
const AUTH_OK = {FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099'};

const alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const webFicticia = {
  apiKey: ['AI', 'za', alfabeto.slice(0, 35)].join(''),
  authDomain: `${PRODUCAO}.firebaseapp.com`,
  projectId: PRODUCAO,
  storageBucket: `${PRODUCAO}.appspot.com`,
  messagingSenderId: '123456789012',
  appId: '1:123456789012:web:abcdef123456',
};
const liberada = criarRaizTemporaria({ajustarContrato: (cfg) => {
  cfg.producao.web = webFicticia;
  cfg.producao.liberacao = {gate: 'G0', autorizadoPor: 'Proprietário', autorizadoEm: '2026-11-17', referencia: 'registro-1'};
}});
const naoLiberada = criarRaizTemporaria({ajustarContrato: (cfg) => { cfg.producao.liberacao = null; }});

const diretorio = mkdtempSync(path.join(tmpdir(), 'piloto-guard-'));
test.after(() => {
  rmSync(diretorio, {recursive: true, force: true});
  liberada.remover();
  naoLiberada.remover();
});

let contador = 0;
const executar = (argumentos, ambiente = {}, copia = null) => {
  const marca = path.join(diretorio, `marca-${contador += 1}`);
  const raiz = copia?.raiz ?? RAIZ;
  const r = spawnSync(process.execPath, ['--require', HOOK, path.join(raiz, 'tools', 'piloto', 'acesso-piloto.mjs'), ...argumentos], {
    cwd: raiz,
    encoding: 'utf8',
    env: {PATH: process.env.PATH, TESTE_MARCA_FIREBASE_ADMIN: marca, ...(copia?.envGit ?? {}), ...ambiente},
  });
  return {codigo: r.status, stderr: r.stderr ?? '', saida: `${r.stdout ?? ''}${r.stderr ?? ''}`, carregouAdmin: existsSync(marca)};
};

const recusa = (argumentos, ambiente, motivo, copia = null) => {
  const r = executar(argumentos, ambiente, copia);
  assert.equal(r.codigo, 1, r.saida);
  assert.match(r.stderr, motivo);
  assert.equal(r.carregouAdmin, false, 'o firebase-admin não pode ser carregado');
};

const aceita = (argumentos, ambiente, copia = null) => {
  const r = executar(argumentos, ambiente, copia);
  assert.equal(r.codigo, 97, `as guardas deviam passar até o carregamento do SDK: ${r.saida}`);
  assert.equal(r.carregouAdmin, true);
};

const adicionar = ['adicionar', '--project', EMULADOR, '--email', EMAIL];

test('subcomando ausente ou desconhecido é recusado', () => {
  recusa([], FS_OK, /Informe o subcomando/);
  recusa(['--project', EMULADOR], FS_OK, /Informe o subcomando/);
  recusa(['apagar', '--project', EMULADOR, '--email', EMAIL], FS_OK, /Informe o subcomando/);
});

test('--project ausente ou repetido é recusado', () => {
  recusa(['adicionar', '--email', EMAIL], FS_OK, /Informe --project/);
  recusa([...adicionar, '--project', EMULADOR], FS_OK, /--project repetido/);
});

test('projeto desconhecido é recusado, com e sem Emulator', () => {
  for (const id of ['meu-app-prod', 'demo-minhas-financas', 'minhas-financas-local-2', 'Minhas-Financas-Local']) {
    recusa(['adicionar', '--project', id, '--email', EMAIL], FS_OK, /Projeto recusado/);
    recusa(['adicionar', '--project', id, '--email', EMAIL, '--confirmar', id], {}, /Projeto recusado/);
  }
});

test('produção sem a liberação G0 registrada é recusada, mesmo com --confirmar', () => {
  for (const argumentos of [
    ['adicionar', '--project', PRODUCAO, '--email', EMAIL, '--confirmar', PRODUCAO],
    ['revogar', '--project', PRODUCAO, '--email', EMAIL, '--motivo', 'fim-do-piloto', '--confirmar', PRODUCAO],
    ['listar', '--project', PRODUCAO, '--confirmar', PRODUCAO],
  ]) {
    recusa(argumentos, {}, /liberação G0/, naoLiberada);
  }
});

test('produção com liberação malformada é recusada', () => {
  const malformada = criarRaizTemporaria({ajustarContrato: (cfg) => {
    cfg.producao.web = webFicticia;
    cfg.producao.liberacao = {gate: 'G2', autorizadoPor: 'x', autorizadoEm: 'ontem', referencia: ''};
  }});
  try {
    recusa(['listar', '--project', PRODUCAO, '--confirmar', PRODUCAO], {}, /inválid/, malformada);
  } finally {
    malformada.remover();
  }
});

test('produção sem --confirmar ou com confirmação diferente é recusada', () => {
  const base = ['adicionar', '--project', PRODUCAO, '--email', EMAIL];
  recusa(base, {}, /Produção exige --confirmar/, liberada);
  recusa([...base, '--confirmar', EMULADOR], {}, /Produção exige --confirmar/, liberada);
  recusa([...base, '--confirmar', `${PRODUCAO}x`], {}, /Produção exige --confirmar/, liberada);
});

test('produção com variável de Emulator presente é recusada', () => {
  const base = ['adicionar', '--project', PRODUCAO, '--email', EMAIL, '--confirmar', PRODUCAO];
  recusa(base, FS_OK, /variáveis de Emulator/, liberada);
  recusa(base, AUTH_OK, /variáveis de Emulator/, liberada);
  recusa(['listar', '--project', PRODUCAO, '--confirmar', PRODUCAO], FS_OK, /variáveis de Emulator/, liberada);
});

test('Emulator sem host ou com host fora do loopback é recusado', () => {
  recusa(adicionar, {}, /FIRESTORE_EMULATOR_HOST é obrigatório/);
  for (const host of ['10.0.0.5:8080', 'firestore.googleapis.com:443', '127.0.0.1', '127.0.0.1:0', '127.0.0.1:70000', 'localhost.evil.com:8080']) {
    recusa(adicionar, {FIRESTORE_EMULATOR_HOST: host}, /FIRESTORE_EMULATOR_HOST/);
  }
});

test('revogar no Emulator exige o host do Auth Emulator em loopback', () => {
  const revogar = ['revogar', '--project', EMULADOR, '--email', EMAIL, '--motivo', 'fim-do-piloto'];
  recusa(revogar, FS_OK, /FIREBASE_AUTH_EMULATOR_HOST/);
  recusa(revogar, {...FS_OK, FIREBASE_AUTH_EMULATOR_HOST: 'auth.exemplo.com:9099'}, /FIREBASE_AUTH_EMULATOR_HOST/);
});

test('e-mail ausente ou inválido é recusado', () => {
  recusa(['adicionar', '--project', EMULADOR], FS_OK, /exige --email/);
  for (const invalido of ['sem-arroba', 'a@b', '@example.com', 'a@@example.com', 'a b@example.com']) {
    recusa(['adicionar', '--project', EMULADOR, '--email', invalido], FS_OK, /(E-mail inválido|não aceita espaço)/);
  }
});

test('revogar sem motivo ou com motivo fora dos códigos é recusado (nada de texto livre)', () => {
  const base = ['revogar', '--project', EMULADOR, '--email', EMAIL];
  const ambiente = {...FS_OK, ...AUTH_OK};
  recusa(base, ambiente, /exige --motivo com um destes códigos/);
  for (const livre of ['saiu-do-piloto', 'a'.repeat(30), 'Pedido-Do-Titular', 'toString', '__proto__']) {
    recusa([...base, '--motivo', livre], ambiente, /exige --motivo com um destes códigos/);
  }
  recusa([...base, '--motivo', 'com espaco'], ambiente, /não aceita espaço/);
  for (const codigo of ['fim-do-piloto', 'pedido-do-titular', 'uso-indevido', 'convite-errado']) aceita([...base, '--motivo', codigo], ambiente);
});

test('remover exige e-mail, não aceita motivo e, na produção, a liberação e a confirmação', () => {
  recusa(['remover', '--project', EMULADOR], FS_OK, /remover exige --email/);
  recusa(['remover', '--project', EMULADOR, '--email', EMAIL, '--motivo', 'fim-do-piloto'], FS_OK, /não aceita --motivo/);
  aceita(['remover', '--project', EMULADOR, '--email', EMAIL], FS_OK);
  recusa(['remover', '--project', PRODUCAO, '--email', EMAIL, '--confirmar', PRODUCAO], {}, /liberação G0/, naoLiberada);
  recusa(['remover', '--project', PRODUCAO, '--email', EMAIL], {}, /Produção exige --confirmar/, liberada);
  aceita(['remover', '--project', PRODUCAO, '--email', EMAIL, '--confirmar', PRODUCAO], {}, liberada);
});

test('GCLOUD_PROJECT, GOOGLE_CLOUD_PROJECT e FIREBASE_CONFIG conflitantes são recusados', () => {
  recusa(adicionar, {...FS_OK, GCLOUD_PROJECT: PRODUCAO}, /Conflito de ambiente: GCLOUD_PROJECT/);
  recusa(adicionar, {...FS_OK, GOOGLE_CLOUD_PROJECT: PRODUCAO}, /Conflito de ambiente: GOOGLE_CLOUD_PROJECT/);
  recusa(adicionar, {...FS_OK, FIREBASE_CONFIG: JSON.stringify({projectId: PRODUCAO})}, /FIREBASE_CONFIG/);
  recusa(adicionar, {...FS_OK, FIREBASE_CONFIG: 'não-é-json'}, /FIREBASE_CONFIG/);
});

test('opções desconhecidas, repetidas ou posicionais são recusadas', () => {
  recusa([...adicionar, '--only', 'firestore'], FS_OK, /opção desconhecida: --only/);
  recusa([...adicionar, '--force'], FS_OK, /opção desconhecida: --force/);
  recusa([...adicionar, 'extra'], FS_OK, /posicional/);
  recusa([...adicionar, '--email', EMAIL], FS_OK, /--email repetido/);
  recusa(['listar', '--project', EMULADOR, '--email', EMAIL], FS_OK, /listar não aceita --email/);
  recusa(['adicionar', '--project', EMULADOR, '--email', EMAIL, '--motivo', 'x'], FS_OK, /não aceita --motivo/);
  recusa([...adicionar, '--confirmar', EMULADOR], FS_OK, /só se aplica à produção/);
});

test('casos positivos do Emulator passam as guardas (o hook interrompe no SDK)', () => {
  aceita(adicionar, FS_OK);
  aceita(['adicionar', '--project', EMULADOR, '--email', 'Maiusculo@Example.COM'], {FIRESTORE_EMULATOR_HOST: 'localhost:8080'});
  aceita(['listar', '--project', EMULADOR], {FIRESTORE_EMULATOR_HOST: '[::1]:8080'});
  aceita(['revogar', '--project', EMULADOR, '--email', EMAIL, '--motivo', 'fim-do-piloto'], {...FS_OK, ...AUTH_OK});
  aceita(adicionar, {...FS_OK, GCLOUD_PROJECT: EMULADOR, FIREBASE_CONFIG: JSON.stringify({projectId: EMULADOR})});
});

test('produção liberada, com confirmação e sem variáveis de Emulator passa as guardas (na cópia)', () => {
  // Interrompido pelo hook antes de qualquer SDK: nada é gravado e nenhuma credencial é lida.
  aceita(['adicionar', '--project', PRODUCAO, '--email', EMAIL, '--confirmar', PRODUCAO], {}, liberada);
  aceita(['listar', '--project', PRODUCAO, '--confirmar', PRODUCAO], {}, liberada);
});
