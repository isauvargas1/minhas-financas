#!/usr/bin/env node
/**
 * Limpeza dos dados de INVESTIMENTOS de um workspace, para desenvolvimento.
 *
 * O domínio patrimonial é único e todo derivado de `investment_movements`. Em
 * desenvolvimento, um workspace acumula massa de teste que atrapalha o próximo
 * cenário — e apagá-la à mão pelo console é onde se apaga o que não devia.
 *
 * O que este utilitário NUNCA toca, por construção e não por convenção:
 *
 *   - usuários do Firebase Auth;
 *   - documentos de workspace e memberships;
 *   - receitas, despesas e parcelamentos;
 *   - cartões, faturas, compras, parcelas e movimentação de limite;
 *   - empréstimos e suas movimentações;
 *   - rateios (grupos, participantes, contas e cotas);
 *   - recorrências, recebíveis, clientes;
 *   - metas, catálogo de cadastros e qualquer coleção fora do domínio.
 *
 * Em `transactions` ele classifica **cada documento** e diz por quê:
 *
 *   espelho do domínio ..... `investmentMetadata.domainMovementId` ou
 *                            `investmentMetadata.domainVersion` — os dois
 *                            campos que as Rules proíbem o cliente de gravar.
 *                            É projeção derivada do ledger; sai por padrão.
 *   investimento legado .... `type == 'investimento'` **sem** marcador do
 *                            domínio. É massa de teste da trilha que não
 *                            existe mais. Fica preservado por padrão e só sai
 *                            com `--include-legacy-investment-transactions`.
 *   fora do domínio ........ qualquer outro `type`. Nunca é sequer lido: a
 *                            consulta filtra por `type == 'investimento'`.
 *
 * Uso:
 *   node tools/investments/limpar-investimentos.mjs \
 *     --projeto=<projeto-de-dev> --workspace=<id> \
 *     [--apply --confirmar=<id>] [--incluir-ledger] [--pagina=300] \
 *     [--include-legacy-investment-transactions --confirmar-legado=<id>]
 *
 * `--projeto` também pode vir da variável de ambiente `PROJETO`.
 *
 * Sem `--apply` é simulação: nada é escrito. Com `--apply` é exigida também a
 * confirmação explícita `--confirmar=<workspaceId>`, repetindo o alvo — e, para
 * remover transações legadas, uma segunda confirmação própria.
 */

import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const admin = require('../../functions/node_modules/firebase-admin');

const PROJETO_PRODUCAO = 'sistema-financeiro-pesso-20698';

/** Coleções derivadas: projeções e trilhas, reconstruíveis do ledger. */
const COLECOES_DERIVADAS = [
  'investment_positions',
  'investment_summaries',
  'investment_report_periods',
  'investment_allocation_summaries',
  'investment_snapshots',
  'investment_event_logs',
  'investment_idempotency_keys',
  'investment_operational_metrics',
  'investment_drift_reports',
  'investment_import_batches',
];

/** Fatos e cadastro do domínio. Só saem com `--incluir-ledger`. */
const COLECOES_LEDGER = [
  'investment_movements',
  'investment_valuations',
  'investment_accounts',
  'investment_assets',
];

const fatal = (mensagem) => {
  process.stderr.write(`\n[FALHA] ${mensagem}\n`);
  process.exit(1);
};

const argumentos = () => {
  const mapa = new Map();
  for (const bruto of process.argv.slice(2)) {
    if (!bruto.startsWith('--')) fatal(`Argumento inesperado: ${bruto}`);
    const [chave, valor] = bruto.slice(2).split('=');
    mapa.set(chave, valor ?? 'true');
  }
  return mapa;
};

const OPCOES_CONHECIDAS = new Set([
  'projeto', 'workspace', 'apply', 'incluir-ledger', 'pagina', 'confirmar',
  'include-legacy-investment-transactions', 'incluir-transacoes-legadas',
  'confirmar-legado',
]);

const args = argumentos();
for (const chave of args.keys()) {
  if (!OPCOES_CONHECIDAS.has(chave)) fatal(`Opção desconhecida: --${chave}`);
}

const projeto = args.get('projeto') ?? process.env.PROJETO ?? '';
const workspaceId = args.get('workspace') ?? '';
const aplicar = args.get('apply') === 'true';
const incluirLedger = args.get('incluir-ledger') === 'true';
/*
 * Remoção das transações de investimento **anteriores** ao domínio único.
 *
 * São documentos `type: 'investimento'` sem nenhum marcador de projeção — a
 * massa que a trilha legada deixou em ambiente de teste. Não são espelho de
 * caixa (esse é reconstruível) e não são receita/despesa (essas nunca entram
 * na consulta). Por não haver como reconstruí-los, a remoção é opcional,
 * explícita e confirmada à parte.
 */
const incluirLegado =
  args.get('include-legacy-investment-transactions') === 'true' ||
  args.get('incluir-transacoes-legadas') === 'true';
const pagina = Number(args.get('pagina') ?? 300);
const confirmacao = args.get('confirmar') ?? '';
const confirmacaoLegado = args.get('confirmar-legado') ?? '';

// ------------------------------------------------------------------ guardas
if (!projeto) {
  fatal('Informe --projeto=<id> (ou a variável PROJETO) com o projeto de ' +
    'desenvolvimento. Não existe projeto padrão.');
}
if (projeto === PROJETO_PRODUCAO) {
  fatal(`PROJETO aponta para produção (${PROJETO_PRODUCAO}). Abortado.`);
}
if (!process.env.FIRESTORE_EMULATOR_HOST && !/stag|homolog|dev|test|local/.test(projeto)) {
  fatal(
    `O nome de '${projeto}' não identifica um ambiente de desenvolvimento. ` +
    'Abortado por segurança.',
  );
}
if (!workspaceId) fatal('Informe --workspace=<id>. Não existe modo "todos".');
if (!Number.isInteger(pagina) || pagina < 1 || pagina > 500) {
  fatal('--pagina precisa ser um inteiro entre 1 e 500.');
}
if (aplicar && confirmacao !== workspaceId) {
  fatal(
    'Para excluir, repita o alvo em --confirmar=<workspaceId>. ' +
    `Recebido: '${confirmacao}'.`,
  );
}
if (aplicar && incluirLegado && confirmacaoLegado !== workspaceId) {
  fatal(
    'Transações legadas de investimento não são reconstruíveis. Para ' +
    'removê-las, repita o alvo em --confirmar-legado=<workspaceId>. ' +
    `Recebido: '${confirmacaoLegado}'.`,
  );
}

if (!admin.apps.length) admin.initializeApp({projectId: projeto});
const db = admin.firestore();
const raiz = `workspaces/${workspaceId}`;

/** É espelho de caixa do domínio? Só o backend grava estes campos. */
const ehEspelhoDoDominio = (dados) => {
  const metadados = dados?.investmentMetadata;
  if (!metadados || typeof metadados !== 'object') return false;
  return typeof metadados.domainMovementId === 'string' ||
    Number.isInteger(metadados.domainVersion);
};

const apagarColecao = async (nome, relatorio) => {
  let ultimo;
  let removidos = 0;
  for (;;) {
    let consulta = db.collection(`${raiz}/${nome}`)
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(pagina);
    if (ultimo) consulta = consulta.startAfter(ultimo);
    const página = await consulta.get();
    if (página.empty) break;
    for (const documento of página.docs) {
      process.stdout.write(`  ${aplicar ? 'excluir' : 'excluiria'}  ${nome}/${documento.id}\n`);
    }
    if (aplicar) {
      const lote = db.batch();
      página.docs.forEach((documento) => lote.delete(documento.ref));
      await lote.commit();
    }
    removidos += página.size;
    ultimo = página.docs[página.size - 1].id;
    if (página.size < pagina) break;
  }
  relatorio.set(nome, removidos);
};

/**
 * Classifica e remove transações de investimento.
 *
 * Um único percurso sobre `type == 'investimento'`, com o motivo impresso por
 * documento. Nenhum outro tipo entra na consulta: receita, despesa e parcelado
 * não são lidos, muito menos apagados.
 */
const tratarTransacoesDeInvestimento = async (relatorio) => {
  let ultimo;
  const contagem = {espelho: 0, legado: 0, preservado: 0};
  for (;;) {
    let consulta = db.collection(`${raiz}/transactions`)
      .where('type', '==', 'investimento')
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(pagina);
    if (ultimo) consulta = consulta.startAfter(ultimo);
    const página = await consulta.get();
    if (página.empty) break;
    const alvos = [];
    for (const documento of página.docs) {
      const espelho = ehEspelhoDoDominio(documento.data());
      if (espelho) {
        alvos.push(documento);
        contagem.espelho += 1;
        process.stdout.write(
          `  ${aplicar ? 'excluir' : 'excluiria'}  transactions/${documento.id}` +
          '  (espelho de caixa: tem investmentMetadata do domínio; ' +
          'reconstruível a partir do ledger)\n',
        );
      } else if (incluirLegado) {
        alvos.push(documento);
        contagem.legado += 1;
        process.stdout.write(
          `  ${aplicar ? 'excluir' : 'excluiria'}  transactions/${documento.id}` +
          '  (investimento legado: type=investimento sem marcador do domínio)\n',
        );
      } else {
        contagem.preservado += 1;
        process.stdout.write(
          `  preservar  transactions/${documento.id}` +
          '  (investimento legado: sem marcador do domínio; use ' +
          '--include-legacy-investment-transactions para remover)\n',
        );
      }
    }
    if (aplicar && alvos.length > 0) {
      const lote = db.batch();
      alvos.forEach((documento) => lote.delete(documento.ref));
      await lote.commit();
    }
    ultimo = página.docs[página.size - 1].id;
    if (página.size < pagina) break;
  }
  relatorio.set('transactions (espelhos do domínio)', contagem.espelho);
  relatorio.set('transactions (investimento legado)', contagem.legado);
  relatorio.set('transactions (preservadas)', contagem.preservado);
};

const limparProgressoDeMetas = async (relatorio) => {
  const campos = [
    'investmentNetContributionCents',
    'investmentCurrentValueCents',
    'investmentProgressCents',
    'investmentProjectionVersion',
    'investmentCalculationVersion',
    'investmentProjectionDirty',
    'investmentUpdatedBy',
    'investmentUpdatedAt',
  ];
  let ultimo;
  let tocadas = 0;
  // Paginado: um workspace de teste com muitas metas não pode sair pela metade
  // sem que o relatório diga.
  for (;;) {
    let consulta = db.collection(`${raiz}/goals`)
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(pagina);
    if (ultimo) consulta = consulta.startAfter(ultimo);
    const página = await consulta.get();
    if (página.empty) break;
    for (const meta of página.docs) {
      const dados = meta.data();
      if (!campos.some((campo) => dados[campo] !== undefined)) continue;
      tocadas += 1;
      process.stdout.write(
        `  ${aplicar ? 'limpar' : 'limparia'}   goals/${meta.id}` +
        '  (progresso patrimonial derivado das posições; a meta permanece)\n',
      );
      if (aplicar) {
        // A meta não é apagada: só o progresso derivado das posições sai.
        await meta.ref.update(
          Object.fromEntries(campos.map((campo) => [campo, admin.firestore.FieldValue.delete()])),
        );
      }
    }
    ultimo = página.docs[página.size - 1].id;
    if (página.size < pagina) break;
  }
  relatorio.set('goals (progresso limpo)', tocadas);
};

const principal = async () => {
  const workspace = await db.doc(raiz).get();
  if (!workspace.exists) fatal(`Workspace '${workspaceId}' não existe em '${projeto}'.`);

  process.stdout.write(
    `\nProjeto ......... ${projeto}\n` +
    `Workspace ....... ${workspaceId} (${workspace.data()?.name ?? 'sem nome'})\n` +
    `Modo ............ ${aplicar ? 'APLICAR (exclui)' : 'SIMULAÇÃO (nada é escrito)'}\n` +
    `Ledger .......... ${incluirLedger ? 'incluído' : 'preservado'}\n` +
    `Legado .......... ${incluirLegado ?
      'INCLUÍDO (transações de investimento sem marcador do domínio)' :
      'preservado'}\n\n`,
  );

  const relatorio = new Map();
  const colecoes = incluirLedger ?
    [...COLECOES_DERIVADAS, ...COLECOES_LEDGER] :
    COLECOES_DERIVADAS;

  for (const nome of colecoes) await apagarColecao(nome, relatorio);
  await tratarTransacoesDeInvestimento(relatorio);
  await limparProgressoDeMetas(relatorio);

  process.stdout.write(`\n=== Relatório final (${aplicar ? 'aplicado' : 'simulação'}) ===\n`);
  let total = 0;
  for (const [nome, quantidade] of relatorio) {
    if (quantidade === 0) continue;
    process.stdout.write(`  ${String(quantidade).padStart(6)}  ${nome}\n`);
    if (!nome.includes('preservadas')) total += quantidade;
  }
  if (total === 0) process.stdout.write('  nada a fazer\n');
  process.stdout.write(`\n  total afetado: ${total}\n`);
  if (!aplicar) {
    process.stdout.write(
      '\nNada foi escrito. Para excluir de fato:\n' +
      '  node tools/investments/limpar-investimentos.mjs ' +
      `--projeto=${projeto} --workspace=${workspaceId} ` +
      `--apply --confirmar=${workspaceId}` +
      (incluirLegado ?
        ' \\\n    --include-legacy-investment-transactions ' +
        `--confirmar-legado=${workspaceId}` :
        '') +
      '\n',
    );
  }
  process.stdout.write('\n');
};

principal().catch((erro) => fatal(erro?.message ?? String(erro)));
