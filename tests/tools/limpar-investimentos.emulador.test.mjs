import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

/**
 * Cenários de dados do utilitário de limpeza de investimentos (PR-PLAT-02),
 * executados contra o Emulator do Firestore (`minhas-financas-local`).
 *
 * O utilitário roda como o operador o executa (processo filho), com ambiente
 * controlado. As guardas em si são cobertas por
 * `limpar-investimentos.guard.test.mjs`, que não precisa do Emulator.
 */

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('FIRESTORE_EMULATOR_HOST é obrigatório.');
}

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..', '..');
const SCRIPT = path.join(RAIZ, 'tools', 'investments', 'limpar-investimentos.mjs');
const PROJETO_EMULADOR = 'minhas-financas-local';
const WORKSPACE = 'guard-limpeza-workspace';

const require = createRequire(import.meta.url);
const admin = require(path.join(RAIZ, 'functions', 'node_modules', 'firebase-admin'));

const db = () => {
  if (!admin.apps.length) admin.initializeApp({projectId: PROJETO_EMULADOR});
  return admin.firestore();
};

const executar = (argumentos, ambiente = {}) => {
  const resultado = spawnSync(process.execPath, [SCRIPT, ...argumentos], {
    cwd: RAIZ,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST,
      ...ambiente,
    },
  });
  return {
    codigo: resultado.status,
    saida: `${resultado.stdout ?? ''}${resultado.stderr ?? ''}`,
  };
};

const base = [`--projeto=${PROJETO_EMULADOR}`, `--workspace=${WORKSPACE}`];
const aplicar = [...base, '--apply', `--confirmar=${WORKSPACE}`];
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

test.after(async () => {
  await db().recursiveDelete(db().doc(raiz));
});

test('a simulação não escreve nada', async () => {
  await semear();
  const antes = {
    transactions: await ids('transactions'),
    investment_positions: await ids('investment_positions'),
    investment_movements: await ids('investment_movements'),
    goals: await ids('goals'),
  };
  const meta = (await db().doc(`${raiz}/goals/goal-1`).get()).data();

  const {codigo, saida} = executar(base);
  assert.equal(codigo, 0, saida);
  assert.match(saida, /SIMULAÇÃO \(nada é escrito\)/);
  assert.match(saida, /Nada foi escrito/);
  assert.match(saida, /excluiria {2}transactions\/investment_mov-1/);
  assert.match(saida, /preservar {2}transactions\/tx-legado-1/);
  // O comando sugerido não carrega nenhum override.
  assert.match(saida, new RegExp(`--projeto=${PROJETO_EMULADOR}`));
  assert.doesNotMatch(saida, /override|confirmar-projeto/i);

  assert.deepEqual(await ids('transactions'), antes.transactions);
  assert.deepEqual(await ids('investment_positions'), antes.investment_positions);
  assert.deepEqual(await ids('investment_movements'), antes.investment_movements);
  assert.deepEqual(await ids('goals'), antes.goals);
  assert.deepEqual((await db().doc(`${raiz}/goals/goal-1`).get()).data(), meta);
});

test('a aplicação remove só o domínio e preserva o resto', async () => {
  await semear();
  const {codigo, saida} = executar(aplicar);
  assert.equal(codigo, 0, saida);
  assert.match(saida, /APLICAR \(exclui\)/);

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

test('--incluir-ledger remove também o ledger do domínio', async () => {
  await semear();
  const {codigo, saida} = executar([...aplicar, '--incluir-ledger']);
  assert.equal(codigo, 0, saida);
  assert.deepEqual(await ids('investment_movements'), []);
  assert.deepEqual(await ids('credit_cards'), ['card-1']);
  assert.deepEqual(await ids('members'), ['u1']);
});

test('o legado exige confirmação própria', async () => {
  await semear();
  const recusa = executar([...aplicar, '--include-legacy-investment-transactions']);
  assert.equal(recusa.codigo, 1);
  assert.match(recusa.saida, /--confirmar-legado/);
  // A recusa é anterior a qualquer escrita.
  assert.ok((await ids('transactions')).includes('tx-legado-1'));
  assert.ok((await ids('transactions')).includes('investment_mov-1'));
  assert.deepEqual(await ids('investment_positions'), ['pos-1']);

  const aceita = executar([
    ...aplicar, '--include-legacy-investment-transactions',
    `--confirmar-legado=${WORKSPACE}`,
  ]);
  assert.equal(aceita.codigo, 0, aceita.saida);
  assert.deepEqual(await ids('transactions'), [
    'tx-despesa', 'tx-parcelado', 'tx-receita',
  ]);
  assert.equal((await db().doc(raiz).get()).exists, true);
});

test('repetir a aplicação não muda nada', async () => {
  await semear();
  const primeira = executar(aplicar);
  assert.equal(primeira.codigo, 0, primeira.saida);
  const depois = {
    transactions: await ids('transactions'),
    goals: await ids('goals'),
    movements: await ids('investment_movements'),
    meta: (await db().doc(`${raiz}/goals/goal-1`).get()).data(),
  };
  const segunda = executar(aplicar);
  assert.equal(segunda.codigo, 0, segunda.saida);
  assert.match(segunda.saida, /total afetado: 0/);
  assert.deepEqual(await ids('transactions'), depois.transactions);
  assert.deepEqual(await ids('goals'), depois.goals);
  assert.deepEqual(await ids('investment_movements'), depois.movements);
  assert.deepEqual((await db().doc(`${raiz}/goals/goal-1`).get()).data(), depois.meta);
});

test('workspace inexistente falha sem escrever', async () => {
  const {codigo, saida} = executar([
    `--projeto=${PROJETO_EMULADOR}`, '--workspace=nao-existe-ws',
    '--apply', '--confirmar=nao-existe-ws',
  ]);
  assert.equal(codigo, 1);
  assert.match(saida, /não existe no Emulator/);
});

test('o utilitário não fala com o Auth', async () => {
  // Estático: o código só instancia o Firestore.
  const fonte = readFileSync(SCRIPT, 'utf8');
  assert.equal(/admin\.auth\(|getAuth|deleteUser/.test(fonte), false);

  // Comportamental: com o Auth apontado para uma porta fechada, qualquer
  // chamada falharia. A execução conclui e o usuário do Auth não é referido.
  await semear();
  const {codigo, saida} = executar(aplicar, {
    FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:1',
  });
  assert.equal(codigo, 0, saida);
  assert.doesNotMatch(saida, /auth/i);
});
