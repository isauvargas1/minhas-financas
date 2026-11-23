#!/usr/bin/env node
/**
 * Limpeza dos dados de INVESTIMENTOS de um workspace — SOMENTE Emulator.
 *
 * O domínio patrimonial é único e todo derivado de `investment_movements`. Em
 * desenvolvimento, um workspace acumula massa de teste que atrapalha o próximo
 * cenário. Este utilitário a remove, mas só fala com o Emulator do Firestore
 * (`minhas-financas-local`, PR-PLAT-02): não existe caminho de exclusão em
 * projeto remoto, nem por override, nem por heurística de nome, nem por
 * variável de ambiente. Ele não usa credencial e não fala com o Firebase Auth.
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
 * Uso (com o Emulator do Firestore no ar):
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *   node tools/investments/limpar-investimentos.mjs \
 *     --projeto=minhas-financas-local --workspace=<id> \
 *     [--apply --confirmar=<id>] [--incluir-ledger] [--pagina=300] \
 *     [--include-legacy-investment-transactions --confirmar-legado=<id>]
 *
 * Guardas, todas avaliadas antes de carregar o `firebase-admin`:
 *   - `--projeto` obrigatório na linha de comando e igual a
 *     `minhas-financas-local`;
 *   - `FIRESTORE_EMULATOR_HOST` obrigatório, `host:porta` com host de loopback;
 *   - nenhuma variável de projeto conflitante e nenhuma credencial no ambiente.
 *
 * Sem `--apply` é simulação: nada é escrito. Com `--apply` é exigida também a
 * confirmação explícita `--confirmar=<workspaceId>`, repetindo o alvo — e, para
 * remover transações legadas, uma segunda confirmação própria.
 */

import {createRequire} from 'node:module';


/** O único projeto em que este utilitário opera. */
const PROJETO_EMULADOR = 'minhas-financas-local';

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
  // P3-I — dados pessoais, movimentos e auditoria de clientes e recebíveis.
  'client_private',
  'client_events',
  'receivable_movements',
  'receivable_events',
  // P3-J (D-30) — contas, livro-razão das contas, transferências e auditoria.
  'cash_accounts',
  'cash_account_movements',
  'cash_transfers',
  'cash_account_events',
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

// ------------------------------------------------------- invariantes estáticas
/*
 * Antes de qualquer leitura de argumento ou escrita: as listas que serão
 * apagadas não podem ter interseção com as que nunca podem ser tocadas.
 */
for (const nome of [...COLECOES_DERIVADAS, ...COLECOES_LEDGER]) {
  if (COLECOES_PROIBIDAS.includes(nome)) {
    fatal(
      `Recusa de segurança: '${nome}' está nas listas de exclusão e também ` +
      'na lista de coleções proibidas. Nada foi escrito.',
    );
  }
}

// ----------------------------------------------------------------- argumentos
const OPCOES_BOOLEANAS = new Set([
  'apply', 'incluir-ledger', 'include-legacy-investment-transactions',
  'incluir-transacoes-legadas',
]);
const OPCOES_COM_VALOR = new Set([
  'projeto', 'workspace', 'pagina', 'confirmar', 'confirmar-legado',
]);
/** Opções removidas em PR-PLAT-02: recusadas com mensagem própria. */
const OPCOES_REMOVIDAS = new Set([
  'allow-development-reset-on-project', 'confirmar-projeto',
]);

const argumentos = () => {
  const mapa = new Map();
  for (const bruto of process.argv.slice(2)) {
    if (!bruto.startsWith('--')) fatal(`Argumento posicional inesperado: ${bruto}`);
    const corpo = bruto.slice(2);
    const igual = corpo.indexOf('=');
    const chave = igual === -1 ? corpo : corpo.slice(0, igual);
    const valor = igual === -1 ? undefined : corpo.slice(igual + 1);
    if (!chave) fatal(`Opção malformada: ${bruto}`);
    if (OPCOES_REMOVIDAS.has(chave)) {
      fatal(
        `A opção --${chave} foi removida (PR-PLAT-02). Este utilitário só ` +
        `opera no Emulator (${PROJETO_EMULADOR}) e não existe override.`,
      );
    }
    if (!OPCOES_BOOLEANAS.has(chave) && !OPCOES_COM_VALOR.has(chave)) {
      fatal(`Opção desconhecida: --${chave}`);
    }
    if (mapa.has(chave)) fatal(`Opção repetida: --${chave}`);
    if (OPCOES_BOOLEANAS.has(chave) && valor !== undefined) {
      fatal(`A opção --${chave} não aceita valor.`);
    }
    if (OPCOES_COM_VALOR.has(chave) && !valor) {
      fatal(`A opção --${chave} exige um valor não vazio: --${chave}=<valor>.`);
    }
    mapa.set(chave, valor ?? 'true');
  }
  return mapa;
};

const args = argumentos();

// ------------------------------------------------------------------- guardas
if (!args.has('projeto')) {
  fatal(
    `Informe --projeto=${PROJETO_EMULADOR} na linha de comando. Não existe ` +
    'projeto padrão nem leitura de variável de ambiente.',
  );
}
if (args.get('projeto') !== PROJETO_EMULADOR) {
  fatal(
    `Projeto recusado: este utilitário só opera no Emulator ` +
    `(--projeto=${PROJETO_EMULADOR}).`,
  );
}

const HOST_EMULADOR = /^(127\.0\.0\.1|localhost|\[::1\]|::1):(\d{1,5})$/;
const hostEmulador = process.env.FIRESTORE_EMULATOR_HOST ?? '';
const partesHost = HOST_EMULADOR.exec(hostEmulador);
const portaHost = partesHost ? Number(partesHost[2]) : 0;
if (!partesHost || portaHost < 1 || portaHost > 65535) {
  fatal(
    'FIRESTORE_EMULATOR_HOST é obrigatório e precisa ser host:porta com ' +
    'host de loopback (127.0.0.1, localhost, [::1] ou ::1) e porta de 1 a ' +
    '65535. A limpeza só fala com o Emulator.',
  );
}

for (const variavel of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'PROJETO']) {
  const valor = process.env[variavel];
  if (valor !== undefined && valor !== PROJETO_EMULADOR) {
    fatal(
      `Conflito de ambiente: a variável ${variavel} está definida com valor ` +
      `diferente de '${PROJETO_EMULADOR}'.`,
    );
  }
}
if (process.env.GOOGLE_APPLICATION_CREDENTIALS !== undefined) {
  fatal(
    'A variável GOOGLE_APPLICATION_CREDENTIALS não pode estar definida: a ' +
    'limpeza só fala com o Emulator e não usa credencial.',
  );
}
/*
 * `firebase emulators:exec` define FIREBASE_CONFIG com o projeto do Emulator. Ela só é aceita quando é JSON e nomeia
 * exatamente `minhas-financas-local`; qualquer outro projeto, ou um valor ilegível, é conflito de ambiente.
 */
if (process.env.FIREBASE_CONFIG !== undefined) {
  let configuracao = null;
  try {
    configuracao = JSON.parse(process.env.FIREBASE_CONFIG);
  } catch {
    configuracao = null;
  }
  if (!configuracao || typeof configuracao !== 'object' || configuracao.projectId !== PROJETO_EMULADOR) {
    fatal(
      `Conflito de ambiente: FIREBASE_CONFIG só é aceita com projectId '${PROJETO_EMULADOR}'.`,
    );
  }
}

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
const confirmacao = args.get('confirmar') ?? '';
const confirmacaoLegado = args.get('confirmar-legado') ?? '';

if (!workspaceId) fatal('Informe --workspace=<id>. Não existe modo "todos".');
if (/\s/.test(workspaceId) || workspaceId.includes('/') ||
    workspaceId === '.' || workspaceId === '..') {
  fatal('--workspace não pode conter espaço nem "/".');
}
const paginaTexto = args.get('pagina') ?? '300';
const pagina = /^\d+$/.test(paginaTexto) ? Number(paginaTexto) : NaN;
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

// Carregamento tardio: nenhuma guarda acima toca o SDK.
const requireAdmin = createRequire(new URL('../../functions/package.json', import.meta.url));
const {getApps, initializeApp} = requireAdmin('firebase-admin/app');
const {getFirestore, FieldPath, FieldValue} = requireAdmin('firebase-admin/firestore');
if (!getApps().length) initializeApp({projectId: PROJETO_EMULADOR});
const db = getFirestore();
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
      .orderBy(FieldPath.documentId())
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
      .orderBy(FieldPath.documentId())
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
      .orderBy(FieldPath.documentId())
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
          Object.fromEntries(campos.map((campo) => [campo, FieldValue.delete()])),
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
  if (!workspace.exists) fatal(`Workspace '${workspaceId}' não existe no Emulator.`);

  process.stdout.write(
    `\nProjeto ......... ${PROJETO_EMULADOR} (Emulator ${hostEmulador})\n` +
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
      '\nNada foi escrito. Para excluir de fato (no Emulator):\n' +
      '  node tools/investments/limpar-investimentos.mjs ' +
      `--projeto=${PROJETO_EMULADOR} --workspace=${workspaceId} ` +
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
