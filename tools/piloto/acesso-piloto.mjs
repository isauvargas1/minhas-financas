#!/usr/bin/env node
/**
 * Lista de convites do piloto fechado do FênixGran (P6-A, gate G0).
 *
 * Mantém a coleção `pilot_access` (só do backend: as Rules a negam ao cliente). O documento tem id `sha256(e-mail
 * normalizado)`, o mesmo algoritmo de `functions/src/workspaces/pilotAccess.ts`, e campos `{email, status}`.
 *
 *   node tools/piloto/acesso-piloto.mjs <adicionar|revogar|remover|listar> --project <id> [--confirmar <id>]
 *        [--email <e-mail>] [--motivo <codigo>]
 *
 * `--motivo` (revogar) só aceita os códigos de MOTIVOS: nenhum texto livre, que viraria dado pessoal no convite, no
 * perfil suspenso e na auditoria.
 *
 * Alvos:
 *   - Emulator (`--project minhas-financas-local`): exige FIRESTORE_EMULATOR_HOST em loopback; `revogar` exige também
 *     FIREBASE_AUTH_EMULATOR_HOST em loopback.
 *   - Produção (`--project` igual a `producao.projectId` de config/ambientes.json): exige a liberação G0 registrada no
 *     contrato (`producao.liberacao`), `--confirmar` com o mesmo Project ID e nenhuma variável *_EMULATOR_HOST no
 *     ambiente. Usa as credenciais padrão do Google (ADC) do operador;
 *     nada delas é lido ou impresso por esta ferramenta.
 *   - Qualquer outro projeto: recusado.
 *
 * `revogar` (P6-B) age sobre a conta que o convite autorizou, achada pelo `uid` vinculado no bootstrap (uso único),
 * nunca pelo e-mail atual: numa só transação marca o convite como revogado e grava `accessStatus: "revoked"` no perfil
 * dessa conta (a capacidade de operar sai no commit, mesmo com ID token vigente: Rules e callables leem o perfil), e
 * depois suspende a conta com a mesma lógica de `suspendAccount` (status, Auth desativado, sessões revogadas,
 * auditoria). Convite nunca usado não autorizou conta nenhuma: só ele é marcado. `remover` elimina um convite JÁ
 * REVOGADO (o e-mail do convidado sai da lista; retenção do PRIVACY_LGPD.md): não toca conta, workspace nem dado
 * financeiro, e nunca remove convite ativo. Todas as guardas são avaliadas antes de carregar o `firebase-admin`.
 */
import {createHash, randomUUID} from 'node:crypto';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join} from 'node:path';

import {ErroArgumentos, lerArgumentos} from '../ambiente/argumentos.mjs';
import {ErroAmbiente, RAIZ, carregarConfiguracao, validarConfiguracao, validarLiberacao} from '../ambiente/contrato.mjs';
import {avaliarNovoConvite} from './regras.mjs';

const require = createRequire(import.meta.url);

const COLECAO = 'pilot_access';
const ORIGEM = 'tools/piloto/acesso-piloto.mjs';
const SUBCOMANDOS = ['adicionar', 'revogar', 'remover', 'listar'];
/** Códigos de revogação → descrição registrada na suspensão da conta. Sem texto livre (dado pessoal). */
const MOTIVOS = Object.freeze({
  'fim-do-piloto': 'fim do piloto',
  'pedido-do-titular': 'pedido do titular',
  'uso-indevido': 'uso indevido',
  'convite-errado': 'convite enviado por engano',
});
const HOST_LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\]|::1):(\d{1,5})$/;
const FORMATO_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LIMITE_LISTA = 500;

const falhar = (mensagem) => {
  process.stderr.write(`\n[FALHA] ${mensagem}\n`);
  process.exit(1);
};

const normalizarEmail = (email) => email.trim().toLowerCase();
/** Mesmo algoritmo de `pilotAccessDocId` (functions/src/workspaces/pilotAccess.ts); o teste prova a igualdade. */
const idDoConvite = (email) => createHash('sha256').update(normalizarEmail(email)).digest('hex');

const hostLoopbackValido = (valor) => {
  const partes = HOST_LOOPBACK.exec(valor ?? '');
  if (!partes) return false;
  const porta = Number(partes[2]);
  return porta >= 1 && porta <= 65535;
};

// ----------------------------------------------------------------- argumentos
const argv = process.argv.slice(2);
const subcomando = argv[0];
if (!subcomando || subcomando.startsWith('--') || !SUBCOMANDOS.includes(subcomando)) {
  falhar(`Informe o subcomando: ${SUBCOMANDOS.join(', ')}. Recebido: '${subcomando ?? ''}'.`);
}
let args;
try {
  args = lerArgumentos(argv.slice(1), {valores: ['project', 'confirmar', 'email', 'motivo']});
} catch (erro) {
  if (erro instanceof ErroArgumentos) falhar(erro.message);
  throw erro;
}

// ------------------------------------------------------------------- guardas
let cfg;
try {
  cfg = carregarConfiguracao();
} catch (erro) {
  if (erro instanceof ErroAmbiente) falhar(erro.message);
  throw erro;
}
const errosDoContrato = validarConfiguracao(cfg);
if (errosDoContrato.length > 0) falhar(`config/ambientes.json inválido: ${errosDoContrato.join(' ')}`);
const PROJETO_EMULADOR = cfg.emulador.projectId;
const PROJETO_PRODUCAO = cfg.producao.projectId;
const projeto = args.get('project');
if (!projeto) falhar('Informe --project <id>. Não existe projeto padrão.');
const producao = projeto === PROJETO_PRODUCAO;
if (!producao && projeto !== PROJETO_EMULADOR) {
  falhar(`Projeto recusado: só são aceitos o Emulator (${PROJETO_EMULADOR}) e a produção (${PROJETO_PRODUCAO}).`);
}

for (const variavel of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT']) {
  const valor = process.env[variavel];
  if (valor !== undefined && valor !== projeto) {
    falhar(`Conflito de ambiente: ${variavel} está definida com valor diferente de --project.`);
  }
}
if (process.env.FIREBASE_CONFIG !== undefined) {
  let configuracao = null;
  try {
    configuracao = JSON.parse(process.env.FIREBASE_CONFIG);
  } catch {
    configuracao = null;
  }
  if (!configuracao || typeof configuracao !== 'object' || configuracao.projectId !== projeto) {
    falhar('Conflito de ambiente: FIREBASE_CONFIG só é aceita com o projectId igual a --project.');
  }
}

if (producao) {
  const liberacao = cfg.producao.liberacao;
  if (liberacao === null || liberacao === undefined) {
    falhar('A produção só recebe convites depois da liberação G0 registrada em config/ambientes.json (producao.liberacao).');
  }
  const errosDaLiberacao = validarLiberacao(liberacao);
  if (errosDaLiberacao.length > 0) falhar(`producao.liberacao inválida: ${errosDaLiberacao.join(' ')}`);
  const confirmacao = args.get('confirmar');
  if (confirmacao !== projeto) {
    falhar(`Produção exige --confirmar ${PROJETO_PRODUCAO}, repetindo o Project ID. Recebido: '${confirmacao ?? ''}'.`);
  }
  const emuladores = Object.keys(process.env).filter((nome) => nome.endsWith('_EMULATOR_HOST'));
  if (emuladores.length > 0) {
    falhar(
      `Produção não pode ser usada com variáveis de Emulator no ambiente (${emuladores.join(', ')}). ` +
      'Remova-as para nunca misturar Emulator e produção.',
    );
  }
} else {
  if (args.has('confirmar')) falhar('--confirmar só se aplica à produção.');
  if (!hostLoopbackValido(process.env.FIRESTORE_EMULATOR_HOST)) {
    falhar(
      'FIRESTORE_EMULATOR_HOST é obrigatório e precisa ser host:porta com host de loopback ' +
      '(127.0.0.1, localhost, [::1] ou ::1) e porta de 1 a 65535.',
    );
  }
  const hostAuth = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (subcomando === 'revogar' && hostAuth === undefined) {
    falhar('revogar exige FIREBASE_AUTH_EMULATOR_HOST (host:porta de loopback) para suspender a conta no Emulator.');
  }
  if (hostAuth !== undefined && !hostLoopbackValido(hostAuth)) {
    falhar('FIREBASE_AUTH_EMULATOR_HOST precisa ser host:porta com host de loopback e porta de 1 a 65535.');
  }
}

let email = '';
let motivo = '';
if (subcomando !== 'listar') {
  email = normalizarEmail(args.get('email') ?? '');
  if (!email) falhar(`${subcomando} exige --email <e-mail>.`);
  if (email.length > 254 || !FORMATO_EMAIL.test(email)) falhar('E-mail inválido.');
} else if (args.has('email')) {
  falhar('listar não aceita --email.');
}
if (subcomando === 'revogar') {
  motivo = args.get('motivo') ?? '';
  if (!Object.hasOwn(MOTIVOS, motivo)) falhar(`revogar exige --motivo com um destes códigos: ${Object.keys(MOTIVOS).join(', ')}.`);
} else if (args.has('motivo')) {
  falhar(`${subcomando} não aceita --motivo.`);
}

// Carregamento tardio: nenhuma guarda acima toca o SDK.
const admin = require('../../functions/node_modules/firebase-admin');
if (!admin.apps.length) admin.initializeApp({projectId: projeto});
const db = admin.firestore();
const {FieldValue} = admin.firestore;

if (producao) {
  const faixa = '!'.repeat(72);
  process.stdout.write(
    `\n${faixa}\n  ATENÇÃO: este comando ${subcomando === 'listar' ? 'LÊ' : 'vai GRAVAR'} na PRODUÇÃO ` +
    `(${projeto}).\n${faixa}\n\n`,
  );
}

/**
 * Trilha de auditoria (append-only, só backend; `platform_audit_events` não tem regra de cliente) de cada mudança na
 * lista do piloto, na mesma transação da mudança. O alvo é o id do convite (hash do e-mail), nunca o e-mail.
 */
const ID_DA_EXECUCAO = randomUUID();
const auditar = (transacao, {operacao, idConvite, antes, depois, motivo = null}) => {
  const id = `pilot_access_${operacao}_${createHash('sha256').update(`${ID_DA_EXECUCAO}:${idConvite}`).digest('hex').slice(0, 32)}`;
  const evento = db.collection('platform_audit_events').doc(id);
  transacao.create(evento, {
    id,
    operation: `pilot_access.${operacao}`,
    actorId: ORIGEM,
    targetId: idConvite,
    before: {status: antes},
    after: {status: depois},
    reason: motivo,
    requestId: `piloto-${ID_DA_EXECUCAO}`,
    createdAt: FieldValue.serverTimestamp(),
  });
};

/** P6-B: revogação da autorização no perfil da conta vinculada, na mesma transação da revogação do convite. */
const auditarRevogacaoDoPerfil = (transacao, {uid, antes, motivo}) => {
  const id = `account_access_revoked_${createHash('sha256').update(`${ID_DA_EXECUCAO}:${uid}`).digest('hex').slice(0, 32)}`;
  transacao.create(db.collection('platform_audit_events').doc(id), {
    id,
    operation: 'account.access_revoked',
    actorId: ORIGEM,
    targetId: uid,
    before: {accessStatus: typeof antes === 'string' ? antes : null},
    after: {accessStatus: 'revoked'},
    reason: motivo,
    requestId: `piloto-${ID_DA_EXECUCAO}`,
    createdAt: FieldValue.serverTimestamp(),
  });
};

const quando = (valor) => (valor && typeof valor.toDate === 'function' ? valor.toDate().toISOString() : '-');

const adicionar = async () => {
  const ref = db.collection(COLECAO).doc(idDoConvite(email));
  // No G0, no máximo um convite ativo (o do proprietário): conferido na mesma transação.
  const gate = producao ? cfg.producao.liberacao.gate : null;
  const resultado = await db.runTransaction(async (transacao) => {
    const atual = await transacao.get(ref);
    if (!(atual.exists && atual.get('status') === 'active')) {
      const ativos = await transacao.get(db.collection(COLECAO).where('status', '==', 'active').limit(2));
      const outrosAtivos = ativos.docs.filter((doc) => doc.id !== ref.id).length;
      const recusa = avaliarNovoConvite({gate, outrosAtivos});
      if (recusa.length > 0) return {recusa};
    }
    if (!atual.exists) {
      transacao.create(ref, {email, status: 'active', adicionadoEm: FieldValue.serverTimestamp(), origem: ORIGEM});
      auditar(transacao, {operacao: 'granted', idConvite: ref.id, antes: null, depois: 'active'});
      return 'criado';
    }
    if (atual.get('status') === 'active') return 'ja-ativo';
    transacao.update(ref, {email, status: 'active', reativadoEm: FieldValue.serverTimestamp(), origem: ORIGEM});
    auditar(transacao, {operacao: 'reactivated', idConvite: ref.id, antes: atual.get('status') ?? null, depois: 'active'});
    return 'reativado';
  });
  if (resultado?.recusa) falhar(resultado.recusa.join(' '));
  const texto = {
    criado: 'Convite criado',
    'ja-ativo': 'Convite já estava ativo (nada alterado)',
    reativado: 'Convite reativado (histórico de revogação preservado)',
  }[resultado];
  process.stdout.write(`${texto}: ${email} (${ref.id})\n`);
  if (resultado === 'reativado') {
    process.stdout.write(
      'A conta já vinculada a este convite só volta a operar se não estiver suspensa, depois de um novo login ' +
      '(a revogação suspende a conta; reativar conta suspensa não tem ferramenta nesta fase).\n',
    );
  }
};

const revogar = async () => {
  const caminhoLib = join(RAIZ, 'functions', 'lib', 'workspaces', 'suspension.js');
  if (!existsSync(caminhoLib)) {
    falhar('functions/lib não existe. Compile as Functions antes: npm run functions:build.');
  }
  const ref = db.collection(COLECAO).doc(idDoConvite(email));
  let uidVinculado = null;
  let perfilMarcado = false;
  const resultado = await db.runTransaction(async (transacao) => {
    const atual = await transacao.get(ref);
    if (!atual.exists) return 'inexistente';
    const uid = atual.get('uid');
    uidVinculado = typeof uid === 'string' && uid !== '' ? uid : null;
    // Lidos antes de qualquer escrita (regra de transação do Firestore).
    const perfilRef = uidVinculado ? db.collection('users').doc(uidVinculado) : null;
    const perfil = perfilRef ? await transacao.get(perfilRef) : null;
    perfilMarcado = Boolean(perfil?.exists) && perfil.get('accessStatus') !== 'revoked';
    if (perfilMarcado) {
      transacao.update(perfilRef, {
        accessStatus: 'revoked',
        accessRevokedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      auditarRevogacaoDoPerfil(transacao, {uid: uidVinculado, antes: perfil.get('accessStatus'), motivo});
    }
    if (atual.get('status') === 'revoked') return 'ja-revogado';
    transacao.update(ref, {
      status: 'revoked',
      revogadoEm: FieldValue.serverTimestamp(),
      motivoRevogacao: motivo,
    });
    auditar(transacao, {operacao: 'revoked', idConvite: ref.id, antes: atual.get('status') ?? null, depois: 'revoked', motivo});
    return 'revogado';
  });
  if (resultado === 'inexistente') {
    falhar(
      `Não há convite para ${email}. Nada foi alterado. A revogação usa o e-mail do convite (veja listar), não o e-mail ` +
      'atual da conta: se a pessoa trocou de e-mail, revogue pelo e-mail com que foi convidada.',
    );
  }
  process.stdout.write(
    `${resultado === 'revogado' ? 'Convite revogado' : 'Convite já estava revogado (motivo original mantido)'}: ` +
    `${email} (${ref.id})\n`,
  );
  if (perfilMarcado) process.stdout.write('Autorização de acesso revogada no perfil da conta vinculada (vale na próxima requisição).\n');

  // A conta é a do uid gravado no convite no bootstrap (uso único), não a do e-mail atual: quem trocou o e-mail da conta
  // continua alcançado, e uma conta alheia que hoje use esse e-mail não é tocada (ela não foi autorizada por este
  // convite e, sem autorização própria, já não opera).
  if (!uidVinculado) {
    process.stdout.write('Convite nunca usado: nenhuma conta foi autorizada por ele; só o convite foi marcado.\n');
    return;
  }
  let usuario = null;
  try {
    usuario = await admin.auth().getUser(uidVinculado);
  } catch (erro) {
    if (erro?.code !== 'auth/user-not-found') throw erro;
  }
  if (!usuario) {
    process.stdout.write('Sem conta no Auth para a conta vinculada: nada a suspender no Auth.\n');
    return;
  }
  const perfil = await db.collection('users').doc(usuario.uid).get();
  const status = perfil.exists ? perfil.get('status') : null;
  if (status !== 'active' && status !== 'suspended') {
    process.stdout.write(perfilMarcado
      ? 'Perfil sem status ativo nem suspenso: a autorização foi revogada no perfil; nada a suspender.\n'
      : 'Conta sem perfil ativo: só o convite foi marcado.\n');
    return;
  }
  // `suspended` entra para refazer os passos do Auth (disabled e sessões) se uma tentativa anterior parou no meio.
  const {suspendAccount} = require(caminhoLib);
  const {changed} = await suspendAccount({
    uid: usuario.uid,
    actorId: ORIGEM,
    reason: `Revogação do convite do piloto: ${MOTIVOS[motivo]}.`,
    requestId: `piloto-revogacao-${ref.id.slice(0, 16)}-${Date.now()}`,
  });
  process.stdout.write(
    changed ? 'Conta suspensa (Auth desativado, sessões revogadas, auditoria gravada).\n' :
      'Conta já estava suspensa (Auth e sessões conferidos).\n',
  );
};

const remover = async () => {
  const ref = db.collection(COLECAO).doc(idDoConvite(email));
  const resultado = await db.runTransaction(async (transacao) => {
    const atual = await transacao.get(ref);
    if (!atual.exists) return 'inexistente';
    if (atual.get('status') !== 'revoked') return 'ativo';
    transacao.delete(ref);
    auditar(transacao, {operacao: 'removed', idConvite: ref.id, antes: 'revoked', depois: null});
    return 'removido';
  });
  if (resultado === 'inexistente') falhar('Não há convite para esse e-mail. Nada foi alterado.');
  if (resultado === 'ativo') falhar('Só um convite já revogado pode ser removido: revogue antes (revogar). Nada foi alterado.');
  process.stdout.write(`Convite removido (${ref.id}). Conta, workspaces e dados financeiros não foram tocados.\n`);
};

const listar = async () => {
  const consulta = await db.collection(COLECAO).orderBy('email').limit(LIMITE_LISTA).get();
  if (consulta.empty) {
    process.stdout.write('Nenhum convite cadastrado.\n');
    return;
  }
  for (const doc of consulta.docs) {
    const d = doc.data();
    const vinculado = typeof d.uid === 'string' && d.uid !== '' ? 'sim' : 'não';
    const partes = [`${d.email}`, `status=${d.status}`, `vinculado=${vinculado}`, `adicionadoEm=${quando(d.adicionadoEm)}`];
    if (d.revogadoEm) partes.push(`revogadoEm=${quando(d.revogadoEm)}`, `motivo=${d.motivoRevogacao ?? '-'}`);
    if (d.reativadoEm) partes.push(`reativadoEm=${quando(d.reativadoEm)}`);
    process.stdout.write(`${partes.join('  ')}\n`);
  }
  process.stdout.write(`${consulta.size} convite(s)${consulta.size === LIMITE_LISTA ? ' (limite da listagem atingido)' : ''}.\n`);
};

try {
  await {adicionar, revogar, remover, listar}[subcomando]();
} catch (erro) {
  falhar(`${subcomando} falhou: ${erro?.message ?? String(erro)}`);
}
