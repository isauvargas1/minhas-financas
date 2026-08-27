import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

/**
 * Guardas do utilitário de limpeza, com atenção ao override extraordinário.
 *
 * `--allow-development-reset-on-project` destrava o único Project ID real do
 * produto, porque ele ainda é o ambiente de desenvolvimento. Uma porta dessas
 * só é aceitável enquanto cada fechadura for verificada — e a forma de
 * verificar é executar o utilitário como o operador o executa, conferindo a
 * recusa e a mensagem.
 *
 * Tudo aqui roda contra o Emulator. O `projectId` usado nos casos de override é
 * o real de propósito: é exatamente esse valor que aciona o caminho protegido,
 * e sob `FIRESTORE_EMULATOR_HOST` o Admin SDK fala com o emulador local, nunca
 * com o Firestore do projeto.
 */

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('FIRESTORE_EMULATOR_HOST é obrigatório.');
}

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..', '..');
const SCRIPT = path.join(RAIZ, 'tools', 'investments', 'limpar-investimentos.mjs');
const PROJETO_REAL = 'sistema-financeiro-pesso-20698';
const WORKSPACE = 'guard-limpeza-workspace';

const require = createRequire(import.meta.url);
const admin = require(path.join(RAIZ, 'functions', 'node_modules', 'firebase-admin'));

const db = () => {
  if (!admin.apps.length) admin.initializeApp({projectId: PROJETO_REAL});
  return admin.firestore();
};

const executar = (argumentos, ambiente = {}) => {
  const resultado = spawnSync(process.execPath, [SCRIPT, ...argumentos], {
    cwd: RAIZ,
    encoding: 'utf8',
    env: {...process.env, PROJETO: '', ...ambiente},
  });
  return {
    codigo: resultado.status,
    saida: `${resultado.stdout ?? ''}${resultado.stderr ?? ''}`,
  };
};

const semOverride = [`--projeto=${PROJETO_REAL}`, `--workspace=${WORKSPACE}`];
const comOverride = [
  `--projeto=${PROJETO_REAL}`,
  `--allow-development-reset-on-project=${PROJETO_REAL}`,
  `--workspace=${WORKSPACE}`,
];

const raiz = `workspaces/${WORKSPACE}`;

/** Massa que cobre o domínio e tudo o que o utilitário promete não tocar. */
const semear = async () => {
  const agora = admin.firestore.Timestamp.now();
  await db().recursiveDelete(db().doc(raiz));
  await db().doc(raiz).set({ownerId: 'u1', type: 'PF', currency: 'BRL', name: 'Guarda'});
  await db().doc(`${raiz}/members/u1`).set({uid: 'u1', role: 'owner', status: 'active'});
  await Promise.all([
    db().doc(`${raiz}/transactions/tx-receita`).set({type: 'receita', value: 100, workspaceId: WORKSPACE, date: '2026-08-01'}),
    db().doc(`${raiz}/transactions/tx-despesa`).set({type: 'despesa', value: 50, workspaceId: WORKSPACE, date: '2026-08-02'}),
    db().doc(`${raiz}/transactions/tx-parcelado`).set({type: 'parcelado', value: 30, workspaceId: WORKSPACE, date: '2026-08-03'}),
    db().doc(`${raiz}/transactions/investment_mov-1`).set({
      type: 'investimento', value: 200, workspaceId: WORKSPACE, date: '2026-08-04',
      investmentMetadata: {domainVersion: 2, domainMovementId: 'mov-1'},
    }),
    db().doc(`${raiz}/transactions/tx-legado-1`).set({type: 'investimento', value: 300, workspaceId: WORKSPACE, date: '2026-07-04'}),
    db().doc(`${raiz}/investment_positions/pos-1`).set({id: 'pos-1', workspaceId: WORKSPACE, updatedAt: agora}),
    db().doc(`${raiz}/investment_movements/mov-1`).set({id: 'mov-1', workspaceId: WORKSPACE, updatedAt: agora}),
    db().doc(`${raiz}/credit_cards/card-1`).set({id: 'card-1', workspaceId: WORKSPACE}),
    db().doc(`${raiz}/credit_card_invoices/inv-1`).set({id: 'inv-1', workspaceId: WORKSPACE}),
    db().doc(`${raiz}/loans/loan-1`).set({id: 'loan-1', workspaceId: WORKSPACE}),
    db().doc(`${raiz}/loan_movements/lm-1`).set({id: 'lm-1', workspaceId: WORKSPACE}),
    db().doc(`${raiz}/split_groups/sg-1`).set({id: 'sg-1', workspaceId: WORKSPACE}),
    db().doc(`${raiz}/split_shares/ss-1`).set({id: 'ss-1', workspaceId: WORKSPACE}),
    db().doc(`${raiz}/recurring_expenses/re-1`).set({id: 're-1', workspaceId: WORKSPACE}),
    db().doc(`${raiz}/goals/goal-1`).set({
      id: 'goal-1', workspaceId: WORKSPACE, name: 'Meta',
      investmentProgressCents: 5_000,
    }),
  ]);
};

const ids = async (colecao) => {
  const pagina = await db().collection(`${raiz}/${colecao}`).get();
  return pagina.docs.map((documento) => documento.id).sort();
};

// -------------------------------------------------------------------- guardas

test('o Project ID real continua recusado sem o override', async () => {
  const {codigo, saida} = executar(semOverride);
  assert.equal(codigo, 1);
  assert.match(saida, /recusado por padrão/);
  assert.match(saida, /allow-development-reset-on-project/);
});

test('o Emulator não atenua a recusa do Project ID real', async () => {
  // Sem o override, nem sob Emulator: o caminho protegido é o mesmo nos dois
  // ambientes, e é por isso que este arquivo consegue exercitá-lo.
  const {codigo, saida} = executar(semOverride, {
    FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST,
  });
  assert.equal(codigo, 1);
  assert.match(saida, /recusado por padrão/);
});

test('o override precisa coincidir exatamente com --projeto', async () => {
  const {codigo, saida} = executar([
    `--projeto=${PROJETO_REAL}`,
    '--allow-development-reset-on-project=sistema-financeiro-pesso-00000',
    `--workspace=${WORKSPACE}`,
  ]);
  assert.equal(codigo, 1);
  assert.match(saida, /não coincide com --projeto/);
});

test('o override exige o Project ID por extenso', async () => {
  const {codigo, saida} = executar([
    `--projeto=${PROJETO_REAL}`,
    '--allow-development-reset-on-project',
    `--workspace=${WORKSPACE}`,
  ]);
  assert.equal(codigo, 1);
  assert.match(saida, /exige o Project ID por extenso/);
});

test('nenhum outro Project ID é liberado pelo override', async () => {
  const {codigo, saida} = executar([
    '--projeto=projeto-qualquer',
    '--allow-development-reset-on-project=projeto-qualquer',
    `--workspace=${WORKSPACE}`,
  ]);
  assert.equal(codigo, 1);
  assert.match(saida, /existe apenas para 'sistema-financeiro-pesso-20698'/);
});

test('a variável de ambiente PROJETO não habilita o override', async () => {
  const {codigo, saida} = executar([
    `--allow-development-reset-on-project=${PROJETO_REAL}`,
    `--workspace=${WORKSPACE}`,
  ], {PROJETO: PROJETO_REAL});
  assert.equal(codigo, 1);
  assert.match(saida, /variável de ambiente PROJETO não habilita/);
});

test('o override não dispensa --workspace', async () => {
  const {codigo, saida} = executar([
    `--projeto=${PROJETO_REAL}`,
    `--allow-development-reset-on-project=${PROJETO_REAL}`,
  ]);
  assert.equal(codigo, 1);
  assert.match(saida, /Não existe modo "todos"/);
});

test('escrever sob override exige --confirmar e --confirmar-projeto', async () => {
  const semNada = executar([...comOverride, '--apply']);
  assert.equal(semNada.codigo, 1);
  assert.match(semNada.saida, /repita o alvo em --confirmar/);

  const semProjeto = executar([...comOverride, '--apply', `--confirmar=${WORKSPACE}`]);
  assert.equal(semProjeto.codigo, 1);
  assert.match(semProjeto.saida, /--confirmar-projeto=sistema-financeiro-pesso-20698/);

  const projetoErrado = executar([
    ...comOverride, '--apply', `--confirmar=${WORKSPACE}`,
    '--confirmar-projeto=outro',
  ]);
  assert.equal(projetoErrado.codigo, 1);
  assert.match(projetoErrado.saida, /repita o Project ID/);
});

test('--confirmar-projeto sozinho é recusado', async () => {
  const {codigo, saida} = executar([
    '--projeto=projeto-dev-teste', `--workspace=${WORKSPACE}`,
    `--confirmar-projeto=${PROJETO_REAL}`,
  ]);
  assert.equal(codigo, 1);
  assert.match(saida, /só faz sentido junto com/);
});

test('opção desconhecida é recusada, e não ignorada', async () => {
  const {codigo, saida} = executar([...comOverride, '--force']);
  assert.equal(codigo, 1);
  assert.match(saida, /Opção desconhecida: --force/);
});

test('o utilitário não fala com o Firebase Auth', async () => {
  // "Nunca apaga usuário do Auth" é verificável no código: o utilitário só
  // instancia o Firestore.
  const fonte = readFileSync(SCRIPT, 'utf8');
  assert.equal(/admin\.auth\(|getAuth|deleteUser/.test(fonte), false);
});

// ------------------------------------------------------- override em execução

test('a simulação sob override avisa em destaque e não escreve nada', async () => {
  await semear();
  const antes = {
    transactions: await ids('transactions'),
    investment_positions: await ids('investment_positions'),
    goals: await ids('goals'),
  };

  const {codigo, saida} = executar(comOverride);
  assert.equal(codigo, 0);
  assert.match(saida, /SAFETY OVERRIDE ATIVO/);
  assert.match(saida, /Este é o Project ID REAL do produto/);
  assert.match(saida, /SIMULAÇÃO — nada será escrito/);
  assert.match(saida, /Nada foi escrito/);
  // O comando sugerido carrega as fechaduras do override.
  assert.match(saida, /--allow-development-reset-on-project=sistema-financeiro-pesso-20698/);

  assert.deepEqual(await ids('transactions'), antes.transactions);
  assert.deepEqual(await ids('investment_positions'), antes.investment_positions);
  assert.deepEqual(await ids('goals'), antes.goals);
});

test('a aplicação sob override remove só o domínio e preserva o resto', async () => {
  await semear();
  const {codigo, saida} = executar([
    ...comOverride, '--apply', `--confirmar=${WORKSPACE}`,
    `--confirmar-projeto=${PROJETO_REAL}`,
  ]);
  assert.equal(codigo, 0);
  assert.match(saida, /SAFETY OVERRIDE ATIVO/);
  assert.match(saida, /APLICAR — ESTA EXECUÇÃO EXCLUI DADOS/);

  // O workspace continua existindo.
  assert.equal((await db().doc(raiz).get()).exists, true);
  assert.deepEqual(await ids('members'), ['u1']);

  // Receita, despesa e parcelado intocadas; o espelho de caixa saiu; a
  // transação de investimento legada continua, porque não foi pedida.
  assert.deepEqual(await ids('transactions'), [
    'tx-despesa', 'tx-legado-1', 'tx-parcelado', 'tx-receita',
  ]);

  // Nada dos módulos adjacentes é tocado.
  assert.deepEqual(await ids('credit_cards'), ['card-1']);
  assert.deepEqual(await ids('credit_card_invoices'), ['inv-1']);
  assert.deepEqual(await ids('loans'), ['loan-1']);
  assert.deepEqual(await ids('loan_movements'), ['lm-1']);
  assert.deepEqual(await ids('split_groups'), ['sg-1']);
  assert.deepEqual(await ids('split_shares'), ['ss-1']);
  assert.deepEqual(await ids('recurring_expenses'), ['re-1']);

  // A meta permanece; só o progresso derivado sai.
  assert.deepEqual(await ids('goals'), ['goal-1']);
  const meta = (await db().doc(`${raiz}/goals/goal-1`).get()).data();
  assert.equal(meta?.name, 'Meta');
  assert.equal(meta?.investmentProgressCents, undefined);

  // Projeções derivadas saíram; o ledger ficou, porque --incluir-ledger não
  // foi pedido.
  assert.deepEqual(await ids('investment_positions'), []);
  assert.deepEqual(await ids('investment_movements'), ['mov-1']);
});

test('sob override, o legado continua exigindo confirmação própria', async () => {
  await semear();
  const recusa = executar([
    ...comOverride, '--include-legacy-investment-transactions',
    '--apply', `--confirmar=${WORKSPACE}`,
    `--confirmar-projeto=${PROJETO_REAL}`,
  ]);
  assert.equal(recusa.codigo, 1);
  assert.match(recusa.saida, /--confirmar-legado/);
  // A recusa é anterior a qualquer escrita.
  assert.ok((await ids('transactions')).includes('tx-legado-1'));

  const aceita = executar([
    ...comOverride, '--include-legacy-investment-transactions',
    '--apply', `--confirmar=${WORKSPACE}`,
    `--confirmar-projeto=${PROJETO_REAL}`,
    `--confirmar-legado=${WORKSPACE}`,
  ]);
  assert.equal(aceita.codigo, 0);
  assert.deepEqual(await ids('transactions'), [
    'tx-despesa', 'tx-parcelado', 'tx-receita',
  ]);
  assert.equal((await db().doc(raiz).get()).exists, true);
});

test('repetir a aplicação sob override não muda nada', async () => {
  const primeira = executar([
    ...comOverride, '--apply', `--confirmar=${WORKSPACE}`,
    `--confirmar-projeto=${PROJETO_REAL}`,
  ]);
  assert.equal(primeira.codigo, 0);
  const depois = await ids('transactions');
  const segunda = executar([
    ...comOverride, '--apply', `--confirmar=${WORKSPACE}`,
    `--confirmar-projeto=${PROJETO_REAL}`,
  ]);
  assert.equal(segunda.codigo, 0);
  assert.match(segunda.saida, /total afetado: 0/);
  assert.deepEqual(await ids('transactions'), depois);
});
