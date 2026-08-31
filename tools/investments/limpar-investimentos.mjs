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
 * `--projeto` também pode vir da variável de ambiente `PROJETO`, **exceto**
 * sob o override extraordinário abaixo, onde a origem precisa ser a linha de
 * comando.
 *
 * Sem `--apply` é simulação: nada é escrito. Com `--apply` é exigida também a
 * confirmação explícita `--confirmar=<workspaceId>`, repetindo o alvo — e, para
 * remover transações legadas, uma segunda confirmação própria.
 */

import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const admin = require('../../functions/node_modules/firebase-admin');

/**
 * O único Project ID real do produto. `.firebaserc` tem este e mais nenhum.
 *
 * Ele é recusado por padrão — e continua sendo. O que existe é um **override
 * extraordinário**, descrito abaixo.
 */
const PROJETO_PRODUCAO = 'sistema-financeiro-pesso-20698';

/**
 * Override extraordinário de reset de desenvolvimento.
 *
 * Situação que o motiva: este projeto ainda é o ambiente de desenvolvimento —
 * não há alias de staging, não há usuário externo e o conteúdo é massa de
 * teste. A proteção pelo ID literal, escrita quando o projeto era tratado como
 * produção, tornou impossível resetá-lo.
 *
 * A proteção **não** foi removida. O que existe é uma porta com quatro
 * fechaduras independentes, todas na linha de comando, nenhuma com valor
 * padrão e nenhuma alcançável por variável de ambiente:
 *
 *   1. `--projeto=<id>` explícito (a variável `PROJETO` **não** serve aqui);
 *   2. `--allow-development-reset-on-project=<id>`, idêntico a `--projeto`;
 *   3. `--workspace=<id>`, porque não existe modo "todos";
 *   4. para escrever: `--apply` + `--confirmar=<workspaceId>` +
 *      `--confirmar-projeto=<projectId>`.
 *
 * O override vale **só** para este ID. Passá-lo com qualquer outro projeto é
 * recusado: a porta não é um interruptor de permissividade, é uma exceção
 * nomeada para um projeto nomeado.
 *
 * Sob override, a presença de `FIRESTORE_EMULATOR_HOST` deixa de ser
 * atenuante: o ID real exige as fechaduras mesmo contra o Emulator. O
 * resultado é que o caminho é o mesmo nos dois ambientes, e o teste do guard
 * exercita exatamente o que o operador vai digitar.
 */
const OVERRIDE_FLAG = 'allow-development-reset-on-project';

/**
 * Coleções que este utilitário **nunca** pode tocar, verificadas em execução.
 *
 * A lista existe para que "nunca apaga cartão" seja uma invariante conferida
 * antes de cada exclusão, e não uma promessa do comentário no topo do arquivo.
 * Se alguém acrescentar uma dessas a `COLECOES_DERIVADAS` por engano, o
 * utilitário aborta antes de escrever qualquer coisa.
 */
const COLECOES_PROIBIDAS = Object.freeze([
  'members',
  'transactions',
  'goals',
  'credit_cards',
  'credit_card_purchases',
  'credit_card_invoices',
  'credit_card_invoice_payments',
  'credit_card_installments',
  'credit_card_audit_logs',
  'card_limit_ledger',
  'card_limit_snapshots',
  'loans',
  'loan_movements',
  'split_groups',
  'split_participants',
  'split_bills',
  'split_shares',
  'recurring_expenses',
  'recurring_occurrences',
  'receivables',
  'clients',
  'settings_catalog',
  'settings_catalog_uniques',
  'cash_report_periods',
  'cash_period_events',
  'financial_events',
  'activity_logs',
  'goal_audit_logs',
]);

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
  'confirmar-legado', OVERRIDE_FLAG, 'confirmar-projeto',
]);

const args = argumentos();
for (const chave of args.keys()) {
  if (!OPCOES_CONHECIDAS.has(chave)) fatal(`Opção desconhecida: --${chave}`);
}

const projetoArgumento = args.get('projeto') ?? '';
const projeto = projetoArgumento || process.env.PROJETO || '';
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
// Lido de `args`, nunca de `process.env`: nenhuma variável pode abrir a porta.
const overridePedido = args.get(OVERRIDE_FLAG) ?? '';
const confirmacaoProjeto = args.get('confirmar-projeto') ?? '';

// ------------------------------------------------------------------ guardas
if (!projeto) {
  fatal('Informe --projeto=<id> (ou a variável PROJETO) com o projeto de ' +
    'desenvolvimento. Não existe projeto padrão.');
}
/*
 * Fechadura 2: o override, quando presente, precisa nomear o mesmo projeto que
 * `--projeto`. Conferido antes de qualquer outra coisa para que um engano de
 * digitação apareça como erro de parâmetro, e não como reset do alvo errado.
 */
if (overridePedido && overridePedido !== 'true' && projetoArgumento &&
    overridePedido !== projetoArgumento) {
  fatal(
    `--${OVERRIDE_FLAG}='${overridePedido}' não coincide com ` +
    `--projeto='${projetoArgumento}'. Os dois precisam nomear exatamente o ` +
    'mesmo Project ID.',
  );
}
if (overridePedido === 'true') {
  fatal(
    `--${OVERRIDE_FLAG} exige o Project ID por extenso: ` +
    `--${OVERRIDE_FLAG}=<projectId>.`,
  );
}
if (overridePedido && overridePedido !== PROJETO_PRODUCAO) {
  fatal(
    `--${OVERRIDE_FLAG} existe apenas para '${PROJETO_PRODUCAO}', o único ` +
    `projeto do produto. Recebido: '${overridePedido}'. Nenhum outro Project ` +
    'ID é liberado por esta opção.',
  );
}

/*
 * Fechadura 1: com o override, o projeto tem de vir da linha de comando. A
 * variável `PROJETO` continua valendo para os projetos de desenvolvimento
 * comuns, e deixa de valer justamente onde o engano é caro.
 */
const overrideAtivo = overridePedido === PROJETO_PRODUCAO;
if (overrideAtivo && projetoArgumento !== PROJETO_PRODUCAO) {
  fatal(
    `Sob --${OVERRIDE_FLAG}, informe --projeto=${PROJETO_PRODUCAO} na linha ` +
    'de comando. A variável de ambiente PROJETO não habilita o override.',
  );
}

if (projeto === PROJETO_PRODUCAO && !overrideAtivo) {
  fatal(
    `'${PROJETO_PRODUCAO}' é o Project ID real do produto e é recusado por ` +
    'padrão. Se este ainda for o ambiente de desenvolvimento e o reset for ' +
    'intencional, repita o ID em ' +
    `--${OVERRIDE_FLAG}=${PROJETO_PRODUCAO}.`,
  );
}
/*
 * A heurística de nome continua governando **todo** projeto que não seja o
 * real. Sob override ela não se aplica: o ID já foi nomeado três vezes.
 */
if (!overrideAtivo &&
    !process.env.FIRESTORE_EMULATOR_HOST &&
    !/stag|homolog|dev|test|local/.test(projeto)) {
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
/*
 * Fechadura 4: escrever sob override exige repetir o Project ID **outra vez**,
 * agora ao lado do `--apply`. É a confirmação que o operador dá depois de ler
 * o relatório da simulação, e não junto com a decisão de destravar.
 */
if (aplicar && overrideAtivo && confirmacaoProjeto !== PROJETO_PRODUCAO) {
  fatal(
    `Para excluir em '${PROJETO_PRODUCAO}', repita o Project ID em ` +
    `--confirmar-projeto=${PROJETO_PRODUCAO}. Recebido: ` +
    `'${confirmacaoProjeto}'.`,
  );
}
if (confirmacaoProjeto && !overrideAtivo) {
  fatal(
    '--confirmar-projeto só faz sentido junto com ' +
    `--${OVERRIDE_FLAG}.`,
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

/**
 * Invariante conferida antes de cada exclusão em massa.
 *
 * `apagarColecao` apaga a coleção **inteira**. A conferência garante que o
 * nome recebido está na lista de coleções derivadas ou de ledger do domínio, e
 * que não é nenhuma das coleções que o utilitário promete nunca tocar.
 */
const assegurarColecaoPermitida = (nome) => {
  if (COLECOES_PROIBIDAS.includes(nome)) {
    fatal(
      `Recusa de segurança: '${nome}' está na lista de coleções que este ` +
      'utilitário nunca apaga. Nada foi escrito.',
    );
  }
  if (!COLECOES_DERIVADAS.includes(nome) && !COLECOES_LEDGER.includes(nome)) {
    fatal(
      `Recusa de segurança: '${nome}' não pertence ao domínio de ` +
      'investimentos. Nada foi escrito.',
    );
  }
};

const apagarColecao = async (nome, relatorio) => {
  assegurarColecaoPermitida(nome);
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
  if (overrideAtivo) {
    /*
     * Em destaque, e antes de qualquer leitura: quem rodar isto precisa ver,
     * sem procurar, que está no Project ID real e que a proteção padrão foi
     * destravada de propósito.
     */
    process.stdout.write(
      '\n' +
      '################################################################\n' +
      '##                                                            ##\n' +
      '##   SAFETY OVERRIDE ATIVO                                    ##\n' +
      '##                                                            ##\n' +
      `##   Projeto: ${PROJETO_PRODUCAO.padEnd(47)}##\n` +
      '##   Este é o Project ID REAL do produto.                     ##\n' +
      `##   A recusa padrão foi destravada por --${OVERRIDE_FLAG}\n` +
      `##   Modo: ${(aplicar ?
        'APLICAR — ESTA EXECUÇÃO EXCLUI DADOS' :
        'SIMULAÇÃO — nada será escrito').padEnd(51)}##\n` +
      '##                                                            ##\n' +
      '################################################################\n',
    );
  }

  const workspace = await db.doc(raiz).get();
  if (!workspace.exists) fatal(`Workspace '${workspaceId}' não existe em '${projeto}'.`);

  process.stdout.write(
    `\nProjeto ......... ${projeto}` +
    `${overrideAtivo ? '  [SAFETY OVERRIDE ATIVO]' : ''}\n` +
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
      (overrideAtivo ?
        `\\\n    --${OVERRIDE_FLAG}=${PROJETO_PRODUCAO} ` +
        `--confirmar-projeto=${PROJETO_PRODUCAO} ` :
        '') +
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
