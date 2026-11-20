import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

/**
 * Cenários de dados de tools/piloto/acesso-piloto.mjs (P6-A) contra o Emulator do Firestore e do Auth
 * (`minhas-financas-local`). A ferramenta roda como o operador a executa (processo filho, ambiente controlado). As
 * guardas são cobertas por acesso-piloto.guard.test.mjs, que não usa o Emulator. Requer `npm run functions:build`.
 */

for (const nome of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
  if (!process.env[nome]) throw new Error(`${nome} é obrigatório.`);
}

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..', '..');
const SCRIPT = path.join(RAIZ, 'tools', 'piloto', 'acesso-piloto.mjs');
const PROJETO = 'minhas-financas-local';

const require = createRequire(import.meta.url);
const admin = require(path.join(RAIZ, 'functions', 'node_modules', 'firebase-admin'));
if (!admin.apps.length) admin.initializeApp({projectId: PROJETO});
const db = admin.firestore();

const executar = (comando, extras = []) => {
  const r = spawnSync(process.execPath, [SCRIPT, comando, '--project', PROJETO, ...extras], {
    cwd: RAIZ,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST,
      FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST,
    },
  });
  return {codigo: r.status, saida: `${r.stdout ?? ''}${r.stderr ?? ''}`};
};

const sufixo = randomUUID().slice(0, 8);
const idEsperado = (email) => createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
const convite = (email) => db.collection('pilot_access').doc(idEsperado(email));
const contarConvites = async () => (await db.collection('pilot_access').count().get()).data().count;

test('o id do convite é idêntico ao da função compilada', () => {
  const {pilotAccessDocId} = require(path.join(RAIZ, 'functions', 'lib', 'workspaces', 'pilotAccess.js'));
  for (const email of ['a@example.com', '  Maria.Silva+x@Example.COM ', 'ÚNICO@exemplo.com.br']) {
    assert.equal(pilotAccessDocId(email), idEsperado(email));
  }
});

test('adicionar cria o convite com o id esperado e o e-mail normalizado, sem duplicar', async () => {
  const bruto = `Novo.${sufixo}@Example.COM`;
  const email = bruto.toLowerCase();
  const antes = await contarConvites();

  const r1 = executar('adicionar', ['--email', bruto]);
  assert.equal(r1.codigo, 0, r1.saida);
  const doc = await convite(email).get();
  assert.equal(doc.exists, true);
  assert.equal(doc.get('email'), email);
  assert.equal(doc.get('status'), 'active');
  assert.equal(doc.get('origem'), 'tools/piloto/acesso-piloto.mjs');
  assert.ok(doc.get('adicionadoEm'));
  const criadoEm = doc.get('adicionadoEm').toMillis();

  const r2 = executar('adicionar', ['--email', email]);
  assert.equal(r2.codigo, 0, r2.saida);
  assert.match(r2.saida, /já estava ativo/);
  assert.equal(await contarConvites(), antes + 1);
  assert.equal((await convite(email).get()).get('adicionadoEm').toMillis(), criadoEm);
});

test('listar mostra o e-mail e o status', async () => {
  const email = `lista.${sufixo}@example.com`;
  assert.equal(executar('adicionar', ['--email', email]).codigo, 0);
  const r = executar('listar');
  assert.equal(r.codigo, 0, r.saida);
  assert.ok(r.saida.includes(email), r.saida);
  assert.match(r.saida, new RegExp(`${email.replace(/[.+]/g, '\\$&')}\\s+status=active`));
});

/** Conta autorizada pelo convite, como o bootstrap a deixa (P6-B): perfil com `accessStatus` e convite vinculado. */
const contaAutorizada = async (email, senha) => {
  const usuario = await admin.auth().createUser({email, emailVerified: true, password: senha});
  await db.collection('users').doc(usuario.uid).set({
    uid: usuario.uid, email, status: 'active', accessStatus: 'granted', accessSource: 'pilot_invite', accessInviteId: idEsperado(email),
  });
  await convite(email).update({uid: usuario.uid});
  return usuario;
};
const operacoesDaConta = async (uid) =>
  (await db.collection('platform_audit_events').where('targetId', '==', uid).get()).docs.map((d) => d.get('operation')).sort();

test('revogar a conta autorizada revoga o acesso no perfil e suspende a conta, sem apagar nada (P6-B)', async () => {
  const email = `conta.${sufixo}@example.com`;
  assert.equal(executar('adicionar', ['--email', email]).codigo, 0);
  const usuario = await contaAutorizada(email, `Senha-${sufixo}-x1`);
  await db.doc(`workspaces/ws-${sufixo}`).set({ownerId: usuario.uid, name: 'Intacto'});
  const antes = await contarConvites();

  const r = executar('revogar', ['--email', email, '--motivo', 'fim-do-piloto']);
  assert.equal(r.codigo, 0, r.saida);
  assert.match(r.saida, /Autorização de acesso revogada no perfil/);
  assert.match(r.saida, /Conta suspensa/);

  const doc = await convite(email).get();
  assert.equal(doc.get('status'), 'revoked');
  assert.equal(doc.get('motivoRevogacao'), 'fim-do-piloto');
  assert.ok(doc.get('revogadoEm'));
  assert.equal((await admin.auth().getUser(usuario.uid)).disabled, true);
  const perfil = await db.collection('users').doc(usuario.uid).get();
  assert.equal(perfil.get('status'), 'suspended');
  assert.equal(perfil.get('accessStatus'), 'revoked');
  assert.ok(perfil.get('accessRevokedAt'));
  assert.match(perfil.get('suspensionReason'), /fim do piloto/);
  assert.deepEqual(await operacoesDaConta(usuario.uid), ['account.access_revoked', 'account.suspended']);
  assert.equal((await db.doc(`workspaces/ws-${sufixo}`).get()).get('name'), 'Intacto');
  assert.equal(await contarConvites(), antes);

  // Repetir é idempotente: o motivo e a data originais ficam e não há segunda auditoria.
  const revogadoEm = doc.get('revogadoEm').toMillis();
  const r2 = executar('revogar', ['--email', email, '--motivo', 'uso-indevido']);
  assert.equal(r2.codigo, 0, r2.saida);
  const depois = await convite(email).get();
  assert.equal(depois.get('motivoRevogacao'), 'fim-do-piloto');
  assert.equal(depois.get('revogadoEm').toMillis(), revogadoEm);
  assert.deepEqual(await operacoesDaConta(usuario.uid), ['account.access_revoked', 'account.suspended']);
});

test('revogar de quem não tem conta só marca o convite', async () => {
  const email = `semconta.${sufixo}@example.com`;
  assert.equal(executar('adicionar', ['--email', email]).codigo, 0);
  const r = executar('revogar', ['--email', email, '--motivo', 'pedido-do-titular']);
  assert.equal(r.codigo, 0, r.saida);
  assert.match(r.saida, /Convite nunca usado/);
  assert.equal((await convite(email).get()).get('status'), 'revoked');
});

test('revogar convite nunca usado não toca conta alheia com o mesmo e-mail, que já não opera sem autorização (P6-B)', async () => {
  const email = `alheia.${sufixo}@example.com`;
  assert.equal(executar('adicionar', ['--email', email]).codigo, 0);
  // Conta anterior à P6-B que hoje usa esse e-mail: perfil ativo, sem autorização e sem vínculo com o convite.
  const usuario = await admin.auth().createUser({email, emailVerified: true, password: `Senha-${sufixo}-x4`});
  await db.collection('users').doc(usuario.uid).set({uid: usuario.uid, email, status: 'active'});
  const r = executar('revogar', ['--email', email, '--motivo', 'convite-errado']);
  assert.equal(r.codigo, 0, r.saida);
  assert.match(r.saida, /Convite nunca usado/);
  const perfil = await db.collection('users').doc(usuario.uid).get();
  assert.equal(perfil.get('status'), 'active');
  assert.equal(perfil.get('accessStatus'), undefined, 'sem autorização: Rules e callables já a recusam');
  assert.equal((await admin.auth().getUser(usuario.uid)).disabled, false);
  assert.deepEqual(await operacoesDaConta(usuario.uid), []);
});

test('revogar convite inexistente é recusado', async () => {
  const email = `inexistente.${sufixo}@example.com`;
  const r = executar('revogar', ['--email', email, '--motivo', 'convite-errado']);
  assert.equal(r.codigo, 1, r.saida);
  assert.match(r.saida, /Não há convite/);
  assert.equal((await convite(email).get()).exists, false);
});

test('adicionar de novo reativa o convite e preserva o histórico', async () => {
  const email = `semconta.${sufixo}@example.com`;
  const antes = await convite(email).get();
  const total = await contarConvites();
  const r = executar('adicionar', ['--email', email]);
  assert.equal(r.codigo, 0, r.saida);
  assert.match(r.saida, /reativado/);
  const doc = await convite(email).get();
  assert.equal(doc.get('status'), 'active');
  assert.ok(doc.get('reativadoEm'));
  assert.equal(doc.get('motivoRevogacao'), 'pedido-do-titular');
  assert.equal(doc.get('revogadoEm').toMillis(), antes.get('revogadoEm').toMillis());
  assert.equal(doc.get('adicionadoEm').toMillis(), antes.get('adicionadoEm').toMillis());
  assert.equal(await contarConvites(), total);
  const listagem = executar('listar');
  assert.match(listagem.saida, /reativadoEm=/);
});

test('remover recusa convite ativo ou inexistente e elimina só o convite revogado, sem tocar conta nem workspace', async () => {
  const email = `remover.${sufixo}@example.com`;
  assert.equal(executar('adicionar', ['--email', email]).codigo, 0);
  const ativo = executar('remover', ['--email', email]);
  assert.equal(ativo.codigo, 1, ativo.saida);
  assert.match(ativo.saida, /Só um convite já revogado/);
  assert.equal((await convite(email).get()).exists, true);

  const usuario = await contaAutorizada(email, `Senha-${sufixo}-x2`);
  await db.doc(`workspaces/ws-remover-${sufixo}`).set({ownerId: usuario.uid, name: 'Intacto'});
  assert.equal(executar('revogar', ['--email', email, '--motivo', 'pedido-do-titular']).codigo, 0);
  const removido = executar('remover', ['--email', email]);
  assert.equal(removido.codigo, 0, removido.saida);
  assert.match(removido.saida, /Convite removido/);
  assert.equal((await convite(email).get()).exists, false);
  assert.equal((await db.collection('users').doc(usuario.uid).get()).get('status'), 'suspended');
  assert.equal((await db.collection('users').doc(usuario.uid).get()).get('accessStatus'), 'revoked');
  assert.equal((await admin.auth().getUser(usuario.uid)).disabled, true);
  assert.equal((await db.doc(`workspaces/ws-remover-${sufixo}`).get()).get('name'), 'Intacto');

  const inexistente = executar('remover', ['--email', email]);
  assert.equal(inexistente.codigo, 1, inexistente.saida);
  assert.match(inexistente.saida, /Não há convite/);
});

test('revogar alcança a conta pelo uid vinculado no bootstrap, mesmo depois de trocar o e-mail (MT-1)', async () => {
  const email = `troca.${sufixo}@example.com`;
  assert.equal(executar('adicionar', ['--email', email]).codigo, 0);
  // O bootstrap grava o vínculo no convite (functions/src/workspaces/pilotAccess.ts, recordPilotAccessUse).
  const usuario = await contaAutorizada(email, `Senha-${sufixo}-x3`);
  await admin.auth().updateUser(usuario.uid, {email: `novo.${sufixo}@example.com`});

  const r = executar('revogar', ['--email', email, '--motivo', 'uso-indevido']);
  assert.equal(r.codigo, 0, r.saida);
  assert.match(r.saida, /Conta suspensa/);
  assert.equal((await admin.auth().getUser(usuario.uid)).disabled, true);
  assert.equal((await db.collection('users').doc(usuario.uid).get()).get('status'), 'suspended');
  assert.equal((await db.collection('users').doc(usuario.uid).get()).get('accessStatus'), 'revoked');
});

test('cada mudança na lista do piloto gera auditoria append-only pelo id do convite, sem o e-mail (observabilidade)', async () => {
  const email = `auditoria.${sufixo}@example.com`;
  const id = idEsperado(email);
  const eventos = async () => (await db.collection('platform_audit_events').where('targetId', '==', id).get()).docs.map((d) => d.data());
  assert.equal(executar('adicionar', ['--email', email]).codigo, 0);
  assert.equal(executar('adicionar', ['--email', email]).codigo, 0, 'repetir não gera evento novo');
  assert.equal(executar('revogar', ['--email', email, '--motivo', 'fim-do-piloto']).codigo, 0);
  assert.equal(executar('adicionar', ['--email', email]).codigo, 0);
  assert.equal(executar('revogar', ['--email', email, '--motivo', 'pedido-do-titular']).codigo, 0);
  assert.equal(executar('remover', ['--email', email]).codigo, 0);
  const lista = await eventos();
  assert.deepEqual(lista.map((e) => e.operation).sort(), [
    'pilot_access.granted', 'pilot_access.reactivated', 'pilot_access.removed', 'pilot_access.revoked', 'pilot_access.revoked',
  ].sort());
  for (const evento of lista) {
    assert.equal(evento.actorId, 'tools/piloto/acesso-piloto.mjs');
    assert.ok(evento.createdAt && evento.requestId);
    assert.ok(!JSON.stringify(evento).includes(email), 'o e-mail não entra na auditoria');
  }
  assert.deepEqual(lista.filter((e) => e.operation === 'pilot_access.revoked').map((e) => e.reason).sort(), ['fim-do-piloto', 'pedido-do-titular']);
});
