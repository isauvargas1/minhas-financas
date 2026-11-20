/**
 * Pré-voo SOMENTE LEITURA da produção (P6-A/P6-B). Funções puras: guardas, interpretação da lista de Functions
 * implantadas, classificação contra o código e o plano de publicação, avaliação das contas e texto de orientação.
 * A linha de comando é `preflight-producao.mjs`.
 *
 * O que a ferramenta responde, antes de publicar a P6-B:
 * - Functions: o que está implantado hoje e o que a publicação NÃO vai atualizar. Excluir uma função da lista de
 *   deploy (segredo ainda não registrado) não remove a versão antiga já implantada: ela continua no ar com o código
 *   anterior, sem as regras novas de autorização;
 * - Contas: quantos perfis ativos existem e quantos ficariam bloqueados quando `accessStatus != 'granted'` passar a ser
 *   exigido pelo backend.
 *
 * Nada aqui altera a produção. Nenhum comando de saneamento é executado: eles só aparecem como TEXTO de orientação.
 * Nada aqui lê dados pessoais: as contas são lidas só pelos campos `accessStatus` e `createdAt`, e o resultado leva
 * contagens e referências mascaradas (hash curto), nunca identificadores em claro.
 */
import {hash} from 'node:crypto';

export const PARTES = Object.freeze(['contas', 'funcoes', 'tudo']);
export const TIMEOUT_GCLOUD_MS = 60_000;
export const TIMEOUT_LEITURA_MS = 30_000;
export const TAMANHO_DA_PAGINA = 200;
export const TETO_DE_PERFIS = 5_000;
export const MAX_REFERENCIAS = 20;

export const TITULO_DO_SANEAMENTO =
  'Saneamento (NÃO executado; só com autorização do proprietário, um comando por vez — RUNBOOKS.md, pré-voo)';

const NOME_SEGURO = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const REGIAO_SEGURA = /^[a-z][a-z0-9-]{2,40}$/;
const SEGREDO_SEGURO = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const VARIAVEIS_DE_PROJETO = Object.freeze(['CLOUDSDK_CORE_PROJECT', 'GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT']);
const CREDENCIAIS_CONFLITANTES = Object.freeze([
  'GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_TOKEN', 'CLOUDSDK_AUTH_ACCESS_TOKEN_FILE', 'CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE',
]);

/** Falha prevista (inconclusivo): a mensagem é fixa em pt-BR e nunca carrega texto vindo da API. */
export class ErroPreflight extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = 'ErroPreflight';
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Guardas
// ---------------------------------------------------------------------------------------------------------------

/** Motivos de recusa (vazio = liberado). Avaliada ANTES de qualquer processo filho ou carregamento de SDK. */
export const avaliarGuardas = ({cfg, project, confirmar, parte = 'tudo', env = {}}) => {
  const motivos = [];
  const producao = cfg?.producao?.projectId;
  const emuladores = [cfg?.emulador?.projectId, cfg?.verificacao?.projectId].filter(Boolean);
  if (!PARTES.includes(parte)) motivos.push(`--parte inválida: use ${PARTES.join(', ')}.`);
  if (!project) motivos.push('--project ausente: informe o Project ID por extenso.');
  else if (emuladores.includes(project) || project.startsWith('demo-')) {
    motivos.push('o projeto informado é o do Emulator ou de verificação: este pré-voo consulta somente a produção online.');
  } else if (project !== producao) motivos.push('o projeto informado não é o projeto de produção do contrato.');
  if (!confirmar) motivos.push('--confirmar ausente: mesmo sendo leitura, repita o Project ID para confirmar.');
  else if (confirmar !== project) motivos.push('--confirmar precisa repetir exatamente o Project ID de --project.');
  const hosts = Object.keys(env).filter((nome) => nome.endsWith('_EMULATOR_HOST'));
  if (hosts.length > 0) motivos.push(`variáveis de Emulator no ambiente (${hosts.join(', ')}): nunca misturar Emulator e produção.`);
  for (const nome of CREDENCIAIS_CONFLITANTES) {
    if (env[nome] !== undefined) {
      motivos.push(`${nome} definido: credencial conflitante; use somente o login de pessoa do gcloud e as credenciais padrão (ADC).`);
    }
  }
  for (const nome of VARIAVEIS_DE_PROJETO) {
    if (env[nome] !== undefined && env[nome] !== project) motivos.push(`${nome} no ambiente aponta para outro projeto (conflito de ambiente).`);
  }
  if (env.FIREBASE_CONFIG !== undefined) {
    let projetoDaConfig = null;
    try {
      projetoDaConfig = JSON.parse(env.FIREBASE_CONFIG)?.projectId ?? null;
    } catch {
      projetoDaConfig = null;
    }
    if (projetoDaConfig !== project) motivos.push('FIREBASE_CONFIG no ambiente aponta para outro projeto ou é ilegível (conflito de ambiente).');
  }
  return motivos;
};

// ---------------------------------------------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------------------------------------------

/** Única consulta de Functions: lista as implantadas. Nunca prompt (CLOUDSDK_CORE_DISABLE_PROMPTS), nunca escrita. */
export const comandoDeListagem = (projectId) => ['gcloud', ['functions', 'list', `--project=${projectId}`, '--format=json', '--quiet']];

/** Ambiente mínimo do gcloud: sem credenciais por variável e sem prompts (não aceita habilitar API sozinho). */
export const ambienteDoGcloud = (env = {}) => {
  const resultado = {CLOUDSDK_CORE_DISABLE_PROMPTS: '1'};
  for (const nome of ['PATH', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'CLOUDSDK_CONFIG', 'CLOUDSDK_PYTHON']) {
    if (env[nome] !== undefined) resultado[nome] = env[nome];
  }
  return resultado;
};

/** Descreve a falha do gcloud só por categoria: o texto do erro nunca é repetido. */
export const descreverFalhaDoGcloud = (stderr = '') => {
  const texto = String(stderr);
  if (/PERMISSION_DENIED|permission|403/i.test(texto)) return 'permissão negada para listar as Functions (a conta do gcloud precisa de leitura no projeto)';
  if (/has not been used|not enabled|SERVICE_DISABLED|API .* enable/i.test(texto)) return 'a API de Functions não está habilitada ou acessível para consulta';
  if (/credential|login|auth|account|reauth/i.test(texto)) return 'credencial do gcloud ausente ou expirada (gcloud auth login)';
  return 'o gcloud terminou com erro';
};

const nomesDeSegredos = (...listas) => {
  const nomes = new Set();
  for (const lista of listas) {
    if (!Array.isArray(lista)) continue;
    for (const item of lista) {
      const nome = item?.key ?? item?.secret;
      if (typeof nome === 'string' && SEGREDO_SEGURO.test(nome)) nomes.add(nome);
    }
  }
  return [...nomes].sort();
};

/**
 * Interpreta a saída JSON de `gcloud functions list` (gen1 e gen2). Formato inesperado é inconclusivo (lança), nunca
 * "sem funções". Devolve só nome, região, estado, geração e NOMES de segredos.
 */
export const interpretarFuncoesRemotas = (json, projectId) => {
  if (!Array.isArray(json)) throw new ErroPreflight('a lista de Functions não veio como lista JSON.');
  return json.map((item) => {
    const partes = /^projects\/([^/]+)\/locations\/([^/]+)\/functions\/([^/]+)$/.exec(String(item?.name ?? ''));
    if (!partes) throw new ErroPreflight('uma Function da lista veio sem o nome no formato esperado.');
    const [, projeto, regiao, nome] = partes;
    if (projeto !== projectId) throw new ErroPreflight('a lista de Functions trouxe um projeto diferente do consultado.');
    if (!NOME_SEGURO.test(nome) || !REGIAO_SEGURA.test(regiao)) throw new ErroPreflight('uma Function da lista veio com nome ou região em formato inesperado.');
    const gen2 = item?.environment === 'GEN_2' || (item?.environment === undefined && item?.serviceConfig !== undefined);
    const estado = typeof (item.state ?? item.status) === 'string' ? String(item.state ?? item.status).slice(0, 40).replace(/[^A-Za-z0-9_ -]/g, '') : 'DESCONHECIDO';
    const segredos = gen2
      ? nomesDeSegredos(item.serviceConfig?.secretEnvironmentVariables, item.serviceConfig?.secretVolumes)
      : nomesDeSegredos(item.secretEnvironmentVariables, item.secretVolumes);
    return {nome, regiao, estado, geracao: gen2 ? 2 : 1, segredos};
  });
};

/**
 * Consulta única do gcloud. `executar(comando, argumentos, opcoes)` tem a assinatura de `spawnSync` (injetável).
 * `timeoutMs` é opção interna da função pura. Devolve `{status:'ok', remotas}` ou `{status:'inconclusivo', motivos}`.
 */
export const consultarFuncoes = ({projectId, executar, timeoutMs = TIMEOUT_GCLOUD_MS, env = {}}) => {
  const [comando, argumentos] = comandoDeListagem(projectId);
  const r = executar(comando, argumentos, {
    encoding: 'utf8', timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], env: ambienteDoGcloud(env),
  });
  if (r?.error) {
    const motivo = r.error.code === 'ETIMEDOUT' ? `o gcloud não respondeu em ${Math.round(timeoutMs / 1000)} s (tempo esgotado)`
      : r.error.code === 'ENOENT' ? 'o gcloud não foi encontrado no PATH' : 'não foi possível executar o gcloud';
    return {status: 'inconclusivo', motivos: [motivo]};
  }
  if (r?.signal) return {status: 'inconclusivo', motivos: [`o gcloud foi interrompido (${r.signal}); possível tempo esgotado`]};
  if (r?.status !== 0) return {status: 'inconclusivo', motivos: [descreverFalhaDoGcloud(r?.stderr)]};
  try {
    return {status: 'ok', remotas: interpretarFuncoesRemotas(JSON.parse(r.stdout || 'null'), projectId)};
  } catch (erro) {
    if (erro instanceof ErroPreflight) return {status: 'inconclusivo', motivos: [erro.message]};
    return {status: 'inconclusivo', motivos: ['a saída do gcloud não é um JSON válido']};
  }
};

const chave = (nome) => nome.toLowerCase().replaceAll('.', '-');

/**
 * Classifica cada Function remota contra o código e o plano de publicação:
 * - `naComposicao`: será atualizada pela publicação;
 * - `excluidaDaPublicacao`: existe no código, mas fica fora do plano (segredo não registrado): continua implantada com
 *   o código ANTIGO. Achado CRÍTICO;
 * - `foraDoCodigo`: não existe mais no código: órfã. Achado.
 * `aImplantar`: no plano, ainda não implantada (informativo).
 */
export const classificarFuncoes = ({remotas, plano}) => {
  const incluidas = new Set(plano.incluidas.map(chave));
  const excluidas = new Map(plano.excluidas.map(({nome, faltam}) => [chave(nome), faltam]));
  const naComposicao = [];
  const excluidaDaPublicacao = [];
  const foraDoCodigo = [];
  for (const remota of remotas) {
    const k = chave(remota.nome);
    if (incluidas.has(k)) naComposicao.push(remota);
    else if (excluidas.has(k)) excluidaDaPublicacao.push({...remota, segredosFaltantes: [...excluidas.get(k)]});
    else foraDoCodigo.push(remota);
  }
  const remotasChaves = new Set(remotas.map((r) => chave(r.nome)));
  const aImplantar = plano.incluidas.filter((nome) => !remotasChaves.has(chave(nome))).sort();
  const segredosLigados = [...new Set(remotas.flatMap((r) => r.segredos))].sort();
  const achados = excluidaDaPublicacao.length + foraDoCodigo.length;
  return {
    status: achados > 0 ? 'achados' : 'ok',
    naComposicao, excluidaDaPublicacao, foraDoCodigo, aImplantar, segredosLigados,
    totalRemotas: remotas.length,
    achados,
  };
};

/** Comandos de saneamento como TEXTO. Nunca são executados pela ferramenta. Nomes fora do formato seguro são omitidos. */
export const comandosDeSaneamento = ({projectId, funcoes}) => [...funcoes.excluidaDaPublicacao, ...funcoes.foraDoCodigo]
  .filter(({nome, regiao}) => NOME_SEGURO.test(nome) && REGIAO_SEGURA.test(regiao))
  .map(({nome, regiao}) => `firebase functions:delete ${nome} --region ${regiao} --project ${projectId}`);

// ---------------------------------------------------------------------------------------------------------------
// Contas
// ---------------------------------------------------------------------------------------------------------------

const comTimeout = (acao, ms) => new Promise((resolve, reject) => {
  const relogio = setTimeout(() => reject(new ErroPreflight(`a leitura não respondeu em ${Math.round(ms / 1000)} s (tempo esgotado)`)), ms);
  Promise.resolve().then(acao).then(
    (valor) => { clearTimeout(relogio); resolve(valor); },
    (erro) => { clearTimeout(relogio); reject(erro); },
  );
});

/** Descreve a falha de leitura só por categoria; a mensagem original (que pode ter detalhe do projeto) não é repetida. */
export const descreverFalhaDeLeitura = (erro) => {
  if (erro instanceof ErroPreflight) return erro.message;
  const codigo = erro?.code;
  const texto = String(erro?.message ?? '');
  if (/default credentials|Could not load the default credentials/i.test(texto)) {
    return 'credencial ausente: rode `gcloud auth application-default login` com a conta do proprietário';
  }
  if (codigo === 7 || codigo === 'permission-denied' || /PERMISSION_DENIED/.test(texto)) return 'permissão negada para ler o Firestore (a conta precisa de leitura no projeto)';
  if (codigo === 14 || codigo === 'unavailable' || codigo === 4 || codigo === 'deadline-exceeded') return 'o Firestore não respondeu (indisponível ou tempo esgotado)';
  if (codigo === 9 || codigo === 'failed-precondition') return 'a consulta exige um índice ou não pôde ser executada (pré-condição falhou)';
  return 'a leitura do Firestore falhou';
};

/** `AAAA-MM` de um Timestamp do Firestore, Date, ISO, `{seconds}` ou milissegundos; o dia e a hora nunca saem. */
export const mesDe = (valor) => {
  let data = null;
  try {
    if (valor instanceof Date) data = valor;
    else if (typeof valor?.toDate === 'function') data = valor.toDate();
    else if (typeof valor === 'string' || typeof valor === 'number') data = new Date(valor);
    else if (Number.isFinite(valor?.seconds ?? valor?._seconds)) data = new Date((valor.seconds ?? valor._seconds) * 1000);
  } catch {
    data = null;
  }
  return data && !Number.isNaN(data.getTime()) ? data.toISOString().slice(0, 7) : null;
};

/** Referência estável e não reversível de uma conta: 12 primeiros hex do SHA-256 do uid. */
export const referenciaMascarada = (uid) => hash('sha256', uid, 'hex').slice(0, 12);

/**
 * Lê e resume os perfis ativos por um LEITOR injetado: `lerPagina({depoisDe, limite}) → [{id, accessStatus, createdAt}]`
 * (ordem por id; `depoisDe` é o último id da página anterior, `null` na primeira). Só `id`, `accessStatus` e `createdAt`
 * são usados; qualquer outro campo devolvido pelo leitor é ignorado e nunca chega ao resultado.
 *
 * Devolve `{status:'ok', resumo}` ou `{status:'inconclusivo', motivos}` (leitor falhou ou demorou, formato inesperado,
 * ou mais de `teto` perfis).
 */
export const avaliarContas = async ({
  lerPagina, tamanhoDaPagina = TAMANHO_DA_PAGINA, teto = TETO_DE_PERFIS, timeoutMs = TIMEOUT_LEITURA_MS, maxReferencias = MAX_REFERENCIAS,
}) => {
  const contagem = {perfisAtivos: 0, autorizados: 0, semAutorizacao: 0, revogadosAindaAtivos: 0};
  const referencias = [];
  let depoisDe = null;
  for (;;) {
    const restante = teto - contagem.perfisAtivos;
    // Pede um perfil além do que ainda cabe: se ele vier, o teto foi ultrapassado.
    const limite = Math.min(tamanhoDaPagina, restante + 1);
    let pagina;
    try {
      pagina = await comTimeout(() => lerPagina({depoisDe, limite}), timeoutMs);
    } catch (erro) {
      return {status: 'inconclusivo', motivos: [descreverFalhaDeLeitura(erro)]};
    }
    if (!Array.isArray(pagina) || pagina.some((item) => typeof item?.id !== 'string' || item.id === '')) {
      return {status: 'inconclusivo', motivos: ['o leitor devolveu uma página em formato inesperado']};
    }
    if (pagina.length > restante) {
      return {status: 'inconclusivo', motivos: [`há mais de ${teto} perfis ativos: limite de leitura atingido; confira no console do Firebase`]};
    }
    for (const {id, accessStatus, createdAt} of pagina) {
      contagem.perfisAtivos += 1;
      if (accessStatus === 'granted') contagem.autorizados += 1;
      else if (accessStatus === 'revoked') contagem.revogadosAindaAtivos += 1;
      else {
        contagem.semAutorizacao += 1;
        if (referencias.length < maxReferencias) referencias.push({ref: referenciaMascarada(id), criadoEm: mesDe(createdAt)});
      }
    }
    if (pagina.length < limite || pagina.length === 0) break;
    depoisDe = pagina[pagina.length - 1].id;
  }
  const achados = contagem.semAutorizacao + contagem.revogadosAindaAtivos;
  return {
    status: 'ok',
    resumo: {
      ...contagem,
      referenciasSemAutorizacao: referencias,
      referenciasTruncadas: contagem.semAutorizacao > referencias.length,
      achados,
      status: achados > 0 ? 'achados' : 'ok',
    },
  };
};

// ---------------------------------------------------------------------------------------------------------------
// Saída
// ---------------------------------------------------------------------------------------------------------------

const resumirFuncao = ({nome, regiao, estado, geracao, segredos}) => ({nome, regiao, estado, geracao, segredos});

/**
 * Resumo final (JSON). `funcoes`: `{status:'inconclusivo', motivos}` ou a saída de `classificarFuncoes`. `contas`:
 * saída de `avaliarContas`. Cada parte não executada fica fora do resumo.
 */
export const montarResumo = ({projectId, agora, partes, funcoes = null, contas = null}) => {
  const resumo = {
    somenteLeitura: true,
    projeto: projectId,
    consultadoEmUtc: agora.toISOString(),
    partes,
  };
  let achados = 0;
  let inconclusivo = false;
  if (funcoes) {
    if (funcoes.status === 'inconclusivo') {
      inconclusivo = true;
      resumo.funcoes = {status: 'inconclusivo', motivos: funcoes.motivos};
    } else {
      achados += funcoes.achados;
      resumo.funcoes = {
        status: funcoes.status,
        totalImplantadas: funcoes.totalRemotas,
        contagens: {
          naComposicao: funcoes.naComposicao.length,
          excluidaDaPublicacao: funcoes.excluidaDaPublicacao.length,
          foraDoCodigo: funcoes.foraDoCodigo.length,
          aImplantar: funcoes.aImplantar.length,
        },
        naComposicao: funcoes.naComposicao.map(resumirFuncao),
        excluidaDaPublicacao: funcoes.excluidaDaPublicacao.map((f) => ({...resumirFuncao(f), segredosFaltantes: f.segredosFaltantes})),
        foraDoCodigo: funcoes.foraDoCodigo.map(resumirFuncao),
        aImplantar: funcoes.aImplantar,
        segredosLigadosAFuncoesImplantadas: funcoes.segredosLigados,
      };
    }
  }
  if (contas) {
    if (contas.status === 'inconclusivo') {
      inconclusivo = true;
      resumo.contas = {status: 'inconclusivo', motivos: contas.motivos};
    } else {
      achados += contas.resumo.achados;
      resumo.contas = contas.resumo;
    }
  }
  resumo.achados = achados;
  resumo.inconclusivo = inconclusivo;
  return resumo;
};

/** 0 sem achados, 1 achados, 4 inconclusivo (tem precedência: o que não foi consultado não pode ser dado como limpo). */
export const codigoDeSaida = (resumo) => (resumo.inconclusivo ? 4 : resumo.achados > 0 ? 1 : 0);

export const CABECALHO = 'FênixGran — pré-voo da produção\nSOMENTE LEITURA — nada é alterado.';

/** Texto de orientação em pt-BR depois do JSON. `saneamento` vem de `comandosDeSaneamento`. */
export const textoDeOrientacao = ({resumo, saneamento = []}) => {
  const linhas = [];
  const f = resumo.funcoes;
  if (f?.status === 'inconclusivo') {
    linhas.push(
      'Functions: INCONCLUSIVO. Consulta somente de leitura no console: Firebase console → Functions, ou Cloud Run functions no',
      `console do Google Cloud (projeto ${resumo.projeto}). Anote nome, região e segredos de cada função; não altere nada.`,
      '  Depois de resolver (login do gcloud, permissão de leitura ou a API de Functions habilitada pelo proprietário), repita o pré-voo.',
    );
  } else if (f) {
    if (f.contagens.excluidaDaPublicacao > 0) {
      linhas.push(
        `Functions: CRÍTICO. ${f.contagens.excluidaDaPublicacao} função(ões) ficam fora da publicação (segredo ainda não registrado em producao.segredos)`,
        '  e continuam implantadas com o código ANTIGO, sem as regras novas de autorização. Excluir da lista de deploy não remove a versão antiga.',
      );
    }
    if (f.contagens.foraDoCodigo > 0) {
      linhas.push(`Functions: ${f.contagens.foraDoCodigo} função(ões) implantadas já não existem no código (órfãs); a publicação não as atualiza.`);
    }
    if (f.status === 'ok') linhas.push('Functions: nenhuma implantada fora da composição da publicação.');
  }
  const c = resumo.contas;
  if (c?.status === 'inconclusivo') {
    linhas.push(
      'Contas: INCONCLUSIVO. Consulta somente de leitura no console: Firebase console → Firestore → coleção users, filtro status == active;',
      '  confira apenas o campo accessStatus (não copie e-mail, nome nem identificadores). Depois repita o pré-voo.',
    );
  } else if (c) {
    if (c.status === 'achados') {
      linhas.push(
        `Contas: ${c.semAutorizacao} perfil(is) ativo(s) sem accessStatus 'granted' e ${c.revogadosAindaAtivos} revogado(s) ainda ativo(s) (revogação parcial).`,
        '  Depois do deploy da P6-B essas contas ficam bloqueadas por padrão; antes dele, o código antigo publicado pode deixá-las operar.',
        '  Reconhecer a conta do proprietário exige convite (node tools/piloto/acesso-piloto.mjs adicionar) e novo login.',
      );
    } else linhas.push('Contas: todos os perfis ativos já estão com accessStatus granted.');
  }
  if (saneamento.length > 0) {
    linhas.push('', TITULO_DO_SANEAMENTO, ...saneamento.map((comando) => `  ${comando}`));
  }
  if (linhas.length === 0) linhas.push('Nada a orientar.');
  return linhas.join('\n');
};
