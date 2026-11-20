import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {deleteApp, initializeApp} from 'firebase/app';
import {connectAuthEmulator, getAuth, signInWithEmailAndPassword} from 'firebase/auth';
import {
  connectStorageEmulator, deleteObject, getBytes, getDownloadURL, getMetadata, getStorage, listAll, ref, uploadString,
} from 'firebase/storage';

/**
 * P6-A (gate G0): o app não usa o Cloud Storage e as regras do bucket (`storage.rules`) negam tudo. Este teste roda as
 * regras no emulador de Storage: nenhum cliente, anônimo, com conta ativa ou dono de workspace, envia, lê, baixa,
 * lista, consulta metadados ou apaga, nem um objeto que existe (gravado pelo Admin SDK, que ignora as regras).
 */
const require = createRequire(import.meta.url);
const admin = require('../../functions/node_modules/firebase-admin');
for (const variavel of ['FIREBASE_STORAGE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
  if (!process.env[variavel]) throw new Error(`${variavel} é obrigatório: rode dentro do firebase emulators:exec.`);
}
const projectId = process.env.GCLOUD_PROJECT || 'minhas-financas-local';
if (projectId !== 'minhas-financas-local') throw new Error('Este teste só roda no projeto do Emulator.');
const bucket = `${projectId}.appspot.com`;
const senha = 'storage-password-123456';
const pessoas = {
  ativa: {uid: 'p6a-storage-ativa', email: 'p6a-storage-ativa@example.test'},
  dona: {uid: 'p6a-storage-dona', email: 'p6a-storage-dona@example.test'},
};
const WORKSPACE = 'p6a-storage-ws';
const OBJETO = `workspaces/${WORKSPACE}/anexos/comprovante.txt`;

const adminApp = () => {
  if (!admin.apps.length) admin.initializeApp({projectId, storageBucket: bucket});
  return admin;
};

const clientes = [];
const conectar = async (pessoa) => {
  const app = initializeApp({apiKey: 'demo-api-key', authDomain: `${projectId}.firebaseapp.com`, projectId, storageBucket: bucket},
    `p6a-storage-${pessoa?.uid ?? 'anonimo'}-${clientes.length}`);
  clientes.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, {disableWarnings: true});
  const storage = getStorage(app);
  const [host, porta] = process.env.FIREBASE_STORAGE_EMULATOR_HOST.replace(/^https?:\/\//, '').split(':');
  connectStorageEmulator(storage, host, Number(porta));
  if (pessoa) await signInWithEmailAndPassword(auth, pessoa.email, senha);
  return storage;
};

const negado = async (promessa, rotulo) => {
  await assert.rejects(promessa, (erro) => {
    assert.equal(erro?.code, 'storage/unauthorized', `${rotulo}: ${erro?.code ?? erro}`);
    return true;
  }, rotulo);
};

let storages;
test.before(async () => {
  const sdk = adminApp();
  const firestore = sdk.firestore();
  for (const pessoa of Object.values(pessoas)) {
    try {
      await sdk.auth().deleteUser(pessoa.uid);
    } catch (erro) {
      if (erro?.code !== 'auth/user-not-found') throw erro;
    }
    await sdk.auth().createUser({...pessoa, password: senha, emailVerified: true});
    await firestore.doc(`users/${pessoa.uid}`).set({uid: pessoa.uid, accessStatus: 'granted', status: 'active'});
  }
  await firestore.doc(`workspaces/${WORKSPACE}`).set({ownerId: pessoas.dona.uid, status: 'active'});
  await firestore.doc(`workspaces/${WORKSPACE}/members/${pessoas.dona.uid}`).set({uid: pessoas.dona.uid, role: 'owner', status: 'active'});
  await sdk.storage().bucket(bucket).file(OBJETO).save('conteudo-sintetico', {contentType: 'text/plain'});
  storages = {anonimo: await conectar(null), ativa: await conectar(pessoas.ativa), dona: await conectar(pessoas.dona)};
});

test.after(async () => {
  await Promise.all(clientes.map((app) => deleteApp(app)));
});

test('nenhum cliente envia arquivo, em nenhum caminho', async () => {
  for (const [nome, storage] of Object.entries(storages)) {
    for (const caminho of [OBJETO, `workspaces/${WORKSPACE}/novo.txt`, `users/${pessoas.ativa.uid}/foto.png`, 'publico/qualquer.txt']) {
      await negado(uploadString(ref(storage, caminho), 'x'), `${nome}: envio em ${caminho}`);
    }
  }
});

test('nenhum cliente lê, baixa, consulta metadados nem apaga um objeto existente', async () => {
  for (const [nome, storage] of Object.entries(storages)) {
    const alvo = ref(storage, OBJETO);
    await negado(getBytes(alvo), `${nome}: leitura`);
    await negado(getDownloadURL(alvo), `${nome}: URL de download`);
    await negado(getMetadata(alvo), `${nome}: metadados`);
    await negado(deleteObject(alvo), `${nome}: exclusão`);
  }
});

test('nenhum cliente lista o bucket nem a pasta do workspace', async () => {
  for (const [nome, storage] of Object.entries(storages)) {
    await negado(listAll(ref(storage)), `${nome}: lista da raiz`);
    await negado(listAll(ref(storage, `workspaces/${WORKSPACE}`)), `${nome}: lista do workspace`);
  }
});

test('controle: o objeto continua no bucket (só o Admin SDK o alcança)', async () => {
  const [existe] = await adminApp().storage().bucket(bucket).file(OBJETO).exists();
  assert.equal(existe, true);
});
