#!/usr/bin/env node
/**
 * Ensaio de restauração com amostra sintética, só no Emulator (P6-A, Frente D). Nunca toca a produção nem dado real.
 *
 *   node tools/operacao/ensaio-restauracao-emulador.mjs           # orquestra o ensaio inteiro (npm run test:operacao:restauracao)
 *
 * 1. Sessão A do Emulator (Firestore, projeto minhas-financas-local): semeia dois workspaces sintéticos com os tipos
 *    usados pelo domínio (centavos inteiros, Timestamp, mapas, listas, nulos, booleanos, subcoleções, trilha
 *    append-only) e grava o resumo (contagem por coleção e SHA-256 canônico de todos os documentos). Ao sair, o
 *    Emulator exporta para um diretório temporário.
 * 2. Sessão B: sobe o Emulator importando esse diretório e resume de novo. O ensaio só passa se o resumo for idêntico.
 * 3. Controle: na mesma sessão B, altera um centavo de um lançamento e resume outra vez; o resumo PRECISA mudar
 *    (prova que a comparação detecta uma diferença de um único campo).
 *
 * Os subcomandos `semear`, `resumir` e `adulterar` são usados pelas sessões e exigem o Emulator em loopback.
 */
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '..', '..');
const PROJETO = 'minhas-financas-local';
const ESTE = fileURLToPath(import.meta.url);

const falhar = (mensagem) => {
  process.stderr.write(`\n[ensaio-restauracao] ${mensagem}\n`);
  process.exit(1);
};

// ------------------------------------------------------------- dentro do Emulator
const sdk = () => {
  if (!/^(127\.0\.0\.1|localhost|\[::1\]):\d{2,5}$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '')) {
    falhar('FIRESTORE_EMULATOR_HOST em loopback é obrigatório: este passo só roda dentro do firebase emulators:exec.');
  }
  if ((process.env.GCLOUD_PROJECT ?? PROJETO) !== PROJETO) falhar(`só o projeto ${PROJETO} é aceito.`);
  const admin = createRequire(import.meta.url)(join(RAIZ, 'functions', 'node_modules', 'firebase-admin'));
  if (!admin.apps.length) admin.initializeApp({projectId: PROJETO});
  return admin;
};

const canonico = (valor, admin) => {
  if (valor === null || typeof valor !== 'object') return valor;
  if (valor instanceof admin.firestore.Timestamp) return {__ts: `${valor.seconds}.${String(valor.nanoseconds).padStart(9, '0')}`};
  if (valor instanceof admin.firestore.DocumentReference) return {__ref: valor.path};
  if (valor instanceof admin.firestore.GeoPoint) return {__geo: [valor.latitude, valor.longitude]};
  if (Array.isArray(valor)) return valor.map((item) => canonico(item, admin));
  return Object.fromEntries(Object.keys(valor).sort().map((chave) => [chave, canonico(valor[chave], admin)]));
};

const percorrer = async (colecoes, linhas, contagem, admin) => {
  for (const colecao of colecoes) {
    const docs = await colecao.listDocuments();
    for (const ref of docs) {
      const doc = await ref.get();
      if (doc.exists) {
        linhas.push(`${ref.path}\t${JSON.stringify(canonico(doc.data(), admin))}`);
        const nome = colecao.id;
        contagem[nome] = (contagem[nome] ?? 0) + 1;
      }
      await percorrer(await ref.listCollections(), linhas, contagem, admin);
    }
  }
};

const resumir = async (destino) => {
  const admin = sdk();
  const linhas = [];
  const contagem = {};
  await percorrer(await admin.firestore().listCollections(), linhas, contagem, admin);
  linhas.sort();
  const resumo = {
    documentos: linhas.length,
    porColecao: Object.fromEntries(Object.keys(contagem).sort().map((nome) => [nome, contagem[nome]])),
    sha256: createHash('sha256').update(linhas.join('\n')).digest('hex'),
  };
  writeFileSync(destino, `${JSON.stringify(resumo, null, 2)}\n`);
  console.log(`[ensaio-restauracao] resumo: ${resumo.documentos} documento(s), sha256 ${resumo.sha256.slice(0, 16)}…`);
};

const semear = async () => {
  const admin = sdk();
  const db = admin.firestore();
  const {Timestamp, FieldValue} = admin.firestore;
  const lote = db.batch();
  for (const [ws, dono] of [['ws-ensaio-a', 'usuario-ensaio-a'], ['ws-ensaio-b', 'usuario-ensaio-b']]) {
    lote.set(db.doc(`users/${dono}`), {uid: dono, status: 'active', criadoEm: Timestamp.fromMillis(1_763_000_000_000)});
    lote.set(db.doc(`workspaces/${ws}`), {ownerId: dono, status: 'active', nome: `Espaço sintético ${ws.slice(-1).toUpperCase()}`, perfil: 'PF'});
    lote.set(db.doc(`workspaces/${ws}/members/${dono}`), {uid: dono, role: 'owner', status: 'active'});
    for (let i = 1; i <= 12; i += 1) {
      lote.set(db.doc(`workspaces/${ws}/transactions/lanc-${String(i).padStart(3, '0')}`), {
        amountCents: 1_000 * i + 7,
        kind: i % 3 === 0 ? 'income' : 'expense',
        date: Timestamp.fromMillis(1_763_000_000_000 + i * 86_400_000),
        tags: ['sintetico', `mes-${(i % 12) + 1}`],
        meta: {origem: 'ensaio', revisado: i % 2 === 0, nota: null},
        conta: db.doc(`workspaces/${ws}/cash_accounts/conta-1`),
      });
    }
    lote.set(db.doc(`workspaces/${ws}/cash_accounts/conta-1`), {nome: 'Conta sintética', saldoCents: 123_456, ativa: true});
    lote.set(db.doc(`workspaces/${ws}/audit_logs/evento-1`), {acao: 'workspace.created', em: Timestamp.fromMillis(1_763_000_000_000)});
  }
  await lote.commit();
  // Documento com valor de servidor: o resumo usa o valor gravado, não o marcador.
  await db.doc('workspaces/ws-ensaio-a/settings/geral').set({atualizadoEm: FieldValue.serverTimestamp(), moeda: 'BRL'});
};

const adulterar = async () => {
  const admin = sdk();
  await admin.firestore().doc('workspaces/ws-ensaio-a/transactions/lanc-001').update({amountCents: 1_008});
};

// ------------------------------------------------------------------ orquestração
const emulador = (argumentos, comando) => {
  const r = spawnSync('firebase', ['emulators:exec', '--only', 'firestore', '--project', PROJETO, ...argumentos, comando], {
    cwd: RAIZ, stdio: 'inherit', env: {...process.env, GCLOUD_PROJECT: PROJETO},
  });
  return r.status ?? 1;
};

const orquestrar = () => {
  const pasta = mkdtempSync(join(tmpdir(), 'fenix-ensaio-restauracao-'));
  const exportacao = join(pasta, 'exportacao');
  const antes = join(pasta, 'antes.json');
  const depois = join(pasta, 'depois.json');
  const adulterado = join(pasta, 'adulterado.json');
  try {
    const passoA = `node "${ESTE}" semear && node "${ESTE}" resumir "${antes}"`;
    if (emulador(['--export-on-exit', exportacao], passoA) !== 0) falhar('a sessão A (semear e exportar) falhou.');
    const passoB = `node "${ESTE}" resumir "${depois}" && node "${ESTE}" adulterar && node "${ESTE}" resumir "${adulterado}"`;
    if (emulador(['--import', exportacao], passoB) !== 0) falhar('a sessão B (importar e conferir) falhou.');
    const [a, b, c] = [antes, depois, adulterado].map((arquivo) => JSON.parse(readFileSync(arquivo, 'utf8')));
    if (a.documentos < 30) falhar(`a amostra sintética ficou pequena demais (${a.documentos} documentos).`);
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      falhar(`a restauração divergiu: antes ${a.documentos} doc(s) ${a.sha256}, depois ${b.documentos} doc(s) ${b.sha256}.`);
    }
    if (c.sha256 === b.sha256) falhar('controle reprovado: a alteração de um centavo não mudou o resumo.');
    console.log(`[ensaio-restauracao] APROVADO: ${a.documentos} documentos restaurados idênticos (sha256 ${a.sha256}); `
      + 'o controle com um centavo alterado foi detectado.');
  } finally {
    rmSync(pasta, {recursive: true, force: true});
  }
};

const [passo, alvo] = process.argv.slice(2);
if (passo === undefined) orquestrar();
else if (passo === 'semear') await semear();
else if (passo === 'resumir' && alvo) await resumir(alvo);
else if (passo === 'adulterar') await adulterar();
else falhar('uso: node tools/operacao/ensaio-restauracao-emulador.mjs [semear | resumir <arquivo> | adulterar]');
