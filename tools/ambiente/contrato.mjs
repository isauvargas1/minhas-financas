/**
 * Contrato único de ambientes do FênixGran (P6-A, produção-piloto; PR-PLAT-01 e PR-AUTH-04).
 *
 * Decisão D-19 (2026-11-17): **uma produção online**, o projeto existente `sistema-financeiro-pesso-20698`, que não é
 * descartável, e testes locais no Emulator (`minhas-financas-local`) com dados sintéticos. Não há DEV nem STAGING online.
 *
 * Toda escolha de projeto passa por aqui: o `vite.config.ts`, o build (`construir.mjs`), o servidor de desenvolvimento
 * (`dev.mjs`, `vite.mjs`), a publicação (`tools/deploy/publicar.mjs`) e o gancho de predeploy do `firebase.json`
 * (`tools/deploy/guarda-predeploy.mjs`). A fonte é `config/ambientes.json`, versionado e só com valores públicos.
 *
 * Perfis:
 * - `local`: servidor de desenvolvimento contra o Emulator (`npm run dev`), também no GitHub Codespaces. Nunca gera build.
 * - `e2e`: build e servidor do E2E contra o Emulator, em `dist-e2e/`, com o login automatizado. Nunca publicável.
 * - `verificacao`: build de produção sem destino (projeto `demo-*`), em `dist-verificacao/`, para o `verify:fast` e o
 *   CI. Nunca publicável.
 * - `release`: build da produção, em `dist/`, a única pasta que o Hosting publica. Exige a configuração web pública da
 *   produção preenchida no contrato.
 *
 * Tudo aqui falha fechado: perfil desconhecido, dado faltando, valor fora do formato, conflito ou variável `VITE_*` no
 * shell interrompem a operação, com o motivo e sem valores secretos.
 */
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PERFIS = Object.freeze(['local', 'e2e', 'verificacao', 'release']);
/** A produção é o único ambiente online (D-19). */
export const AMBIENTE_PRODUCAO = 'prod';
/** Mesma região de `functions/src/shared/runtimeOptions.ts` e de `src/lib/firebase.ts`. */
export const REGIAO_FUNCTIONS = 'southamerica-east1';
/** Pasta sem nenhum `.env*`: o Vite não carrega o ambiente da estação (`.env.local` com o projeto real, por exemplo). */
export const PASTA_ENV_VAZIA = 'config/vite-sem-env';
/** Marcador gravado na raiz de todo build: perfil, ambiente, projeto e origem. O guard e a varredura o exigem. */
export const MARCADOR_BUILD = 'fenix-build.json';
export const SAIDA_POR_PERFIL = Object.freeze({e2e: 'dist-e2e', verificacao: 'dist-verificacao', release: 'dist'});
/** Perfis cujo bundle conecta ao Emulator e pode ter o login automatizado. */
export const PERFIS_EMULADOR = Object.freeze(['local', 'e2e']);

/** Comandos do Vite aceitos por perfil: `serve` (dev), `preview` e `build`. */
const COMANDOS_POR_PERFIL = Object.freeze({
  local: ['serve'],
  e2e: ['serve', 'preview', 'build'],
  verificacao: ['build'],
  release: ['build'],
});

const ID_PROJETO = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const CHAVE_WEB = /^AIza[0-9A-Za-z_-]{35}$/;
const APP_ID = /^1:\d{6,}:web:[0-9a-f]{6,}$/;
const SENDER_ID = /^\d{6,}$/;
const CAMPOS_WEB = Object.freeze(['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId']);

export class ErroAmbiente extends Error {
  constructor(motivos) {
    const lista = Array.isArray(motivos) ? motivos : [String(motivos)];
    super(`Ambiente recusado:\n${lista.map((motivo) => `  - ${motivo}`).join('\n')}`);
    this.name = 'ErroAmbiente';
    this.motivos = lista;
  }
}

const ehObjeto = (valor) => typeof valor === 'object' && valor !== null && !Array.isArray(valor);

export const carregarConfiguracao = (raiz = RAIZ) => {
  const caminho = join(raiz, 'config', 'ambientes.json');
  try {
    return JSON.parse(readFileSync(caminho, 'utf8'));
  } catch (erro) {
    throw new ErroAmbiente([`config/ambientes.json ilegível ou ausente (${erro.code ?? erro.name}).`]);
  }
};

/** Portas do Emulator, lidas do `firebase.json` (fonte única também para o Playwright e o proxy do Vite). */
export const lerPortasEmulador = (raiz = RAIZ) => {
  const firebase = JSON.parse(readFileSync(join(raiz, 'firebase.json'), 'utf8'));
  const portas = {};
  for (const servico of ['auth', 'firestore', 'functions']) {
    const porta = firebase?.emulators?.[servico]?.port;
    if (!Number.isInteger(porta) || porta < 1 || porta > 65535) {
      throw new ErroAmbiente([`firebase.json: porta do emulador de ${servico} ausente ou inválida.`]);
    }
    portas[servico] = porta;
  }
  return portas;
};

const validarWeb = (web, projectId, rotulo, {publico}) => {
  const erros = [];
  if (!ehObjeto(web)) return [`${rotulo}: configuração web ausente.`];
  const extras = Object.keys(web).filter((campo) => !CAMPOS_WEB.includes(campo));
  if (extras.length > 0) erros.push(`${rotulo}: campos não previstos na configuração web (${extras.join(', ')}).`);
  for (const campo of CAMPOS_WEB) {
    if (typeof web[campo] !== 'string' || web[campo].trim() === '') erros.push(`${rotulo}: web.${campo} ausente.`);
  }
  if (web.projectId !== projectId) erros.push(`${rotulo}: web.projectId diferente do projectId do ambiente.`);
  if (publico) {
    if (!CHAVE_WEB.test(web.apiKey ?? '')) erros.push(`${rotulo}: web.apiKey fora do formato de chave web do Firebase.`);
    if (!APP_ID.test(web.appId ?? '')) erros.push(`${rotulo}: web.appId fora do formato 1:<número>:web:<hex>.`);
    if (!SENDER_ID.test(web.messagingSenderId ?? '')) erros.push(`${rotulo}: web.messagingSenderId fora do formato.`);
  }
  return erros;
};

const validarOrigens = (origens, ambiente) => {
  const erros = [];
  if (!Array.isArray(origens) || origens.length === 0) return [`${ambiente}: origens (domínios do Hosting) ausentes.`];
  for (const origem of origens) {
    let url = null;
    try {
      url = new URL(origem);
    } catch {
      url = null;
    }
    if (!url || url.protocol !== 'https:' || url.origin !== origem || origem.includes('*')) {
      erros.push(`${ambiente}: origem inválida (só https://domínio, sem caminho nem curinga).`);
      continue;
    }
    if (/\.app\.github\.dev$/.test(url.hostname) || /^(localhost|127\.)/.test(url.hostname)) {
      erros.push(`${ambiente}: domínio de Codespace ou local não entra na produção.`);
    }
  }
  return erros;
};

/** Registro da autorização expressa de publicação (gate G0 ou G1 do LAUNCH_CHECKLIST.md). */
export const validarLiberacao = (liberacao) => {
  if (liberacao === null || liberacao === undefined) return [];
  const valida = ehObjeto(liberacao) && ['G0', 'G1'].includes(liberacao.gate) &&
    /^\d{4}-\d{2}-\d{2}$/.test(liberacao.autorizadoEm ?? '') && typeof liberacao.autorizadoPor === 'string' &&
    liberacao.autorizadoPor.trim() !== '' && typeof liberacao.referencia === 'string' && liberacao.referencia.trim() !== '' &&
    Object.keys(liberacao).every((campo) => ['gate', 'autorizadoPor', 'autorizadoEm', 'referencia'].includes(campo));
  return valida ? [] : ['producao.liberacao malformada (gate G0/G1, autorizadoPor, autorizadoEm AAAA-MM-DD, referencia).'];
};

/**
 * Nomes (nunca valores) dos segredos que o proprietário confirmou existir no Secret Manager da produção. A publicação
 * das Functions deixa de fora toda função que declara um segredo ausente desta lista (tools/deploy/funcoes.mjs): sem
 * isso, o `firebase deploy` não interativo falharia, ou pediria para criar o segredo, que é ação humana (E-05, E-06).
 */
/**
 * App Check da produção (PR-APPCHK-01, preparação P6-A): `null` até o proprietário registrar o app web no App Check com
 * a chave de site do reCAPTCHA Enterprise (E-02). A chave de site é pública por desenho (vai no bundle). Com ela, o
 * build de release inicializa o App Check e passa a enviar tokens; o enforcement continua desligado no servidor até a
 * decisão D-33 (período de monitoramento).
 */
export const validarAppCheck = (appCheck) => {
  if (appCheck === null || appCheck === undefined) return [];
  const valido = ehObjeto(appCheck) && appCheck.provedor === 'recaptcha-enterprise' &&
    /^[A-Za-z0-9_-]{40}$/.test(appCheck.siteKey ?? '') &&
    Object.keys(appCheck).every((campo) => ['provedor', 'siteKey'].includes(campo));
  return valido ? [] : ["producao.appCheck malformado (provedor 'recaptcha-enterprise' e siteKey de 40 caracteres)."];
};

export const NOME_DE_SEGREDO = /^[A-Z][A-Z0-9_]{2,99}$/;
export const validarSegredosRegistrados = (segredos) => {
  if (!Array.isArray(segredos)) return ['producao.segredos precisa ser uma lista de nomes (vazia enquanto nenhum segredo existir).'];
  const erros = [];
  if (segredos.some((nome) => typeof nome !== 'string' || !NOME_DE_SEGREDO.test(nome))) {
    erros.push('producao.segredos aceita só nomes de segredo (MAIÚSCULAS, dígitos e _), nunca valores.');
  }
  if (new Set(segredos).size !== segredos.length) erros.push('producao.segredos tem nome repetido.');
  return erros;
};

/**
 * Valida o contrato inteiro. Qualquer erro interrompe qualquer perfil: um contrato inconsistente não é usado nem
 * parcialmente. `producao.web` e `producao.liberacao` podem estar pendentes (null); o release e a publicação os exigem.
 */
export const validarConfiguracao = (cfg) => {
  const erros = [];
  if (!ehObjeto(cfg) || cfg.formato !== 2) return ['config/ambientes.json: formato desconhecido (esperado 2).'];
  if ('ambientes' in cfg || 'projetoExistente' in cfg) {
    erros.push('config/ambientes.json: DEV/STAGING online foram substituídos pela produção única (D-19); use só emulador, verificacao e producao.');
  }
  const emulador = cfg.emulador;
  if (!ehObjeto(emulador) || emulador.projectId !== 'minhas-financas-local') {
    erros.push("emulador.projectId precisa ser 'minhas-financas-local'.");
  } else {
    erros.push(...validarWeb(emulador.web, emulador.projectId, 'emulador', {publico: false}));
    if (emulador.regiaoFunctions !== REGIAO_FUNCTIONS) erros.push(`emulador.regiaoFunctions precisa ser ${REGIAO_FUNCTIONS}.`);
  }
  const verificacao = cfg.verificacao?.web;
  if (!ehObjeto(verificacao) || !/^demo-[a-z0-9-]+$/.test(verificacao.projectId ?? '')) {
    erros.push('verificacao.web.projectId precisa ser um projeto demo-* (nunca um projeto real).');
  } else {
    erros.push(...validarWeb(verificacao, verificacao.projectId, 'verificacao', {publico: false}));
  }
  const producao = cfg.producao;
  if (!ehObjeto(producao)) return [...erros, 'producao ausente.'];
  const id = producao.projectId;
  if (typeof id !== 'string' || !ID_PROJETO.test(id)) {
    erros.push('producao.projectId fora do formato de Project ID.');
  } else if (id === emulador?.projectId || id.startsWith('demo-')) {
    erros.push('producao.projectId não pode ser o do Emulator nem um projeto demo-*.');
  }
  if (producao.regiaoFunctions !== REGIAO_FUNCTIONS) erros.push(`producao.regiaoFunctions precisa ser ${REGIAO_FUNCTIONS}.`);
  erros.push(...validarOrigens(producao.origens, AMBIENTE_PRODUCAO));
  if (producao.web !== null) erros.push(...validarWeb(producao.web, id, 'producao', {publico: true}));
  erros.push(...validarLiberacao(producao.liberacao));
  erros.push(...validarSegredosRegistrados(producao.segredos));
  erros.push(...validarAppCheck(producao.appCheck));
  return erros;
};

/**
 * Resolve o perfil pedido. Devolve o plano do build ou do servidor; lança `ErroAmbiente` com todos os motivos.
 * `comando`: `serve`, `preview` ou `build` (o do Vite).
 */
export const resolverPerfil = ({perfil, ambiente = null, comando = 'build'}, cfg) => {
  const motivos = [];
  if (!PERFIS.includes(perfil)) {
    throw new ErroAmbiente([`perfil ausente ou desconhecido (${perfil === undefined || perfil === '' ? 'nenhum' : 'não listado'}); use ${PERFIS.join(', ')}.`]);
  }
  if (!COMANDOS_POR_PERFIL[perfil].includes(comando)) {
    motivos.push(`o perfil ${perfil} não aceita o comando ${comando} do Vite (aceita: ${COMANDOS_POR_PERFIL[perfil].join(', ')}).`);
  }
  if (ambiente !== null && ambiente !== undefined && ambiente !== '') {
    motivos.push('--ambiente não existe mais: a produção é o único ambiente online (D-19).');
  }
  motivos.push(...validarConfiguracao(cfg));
  if (motivos.length > 0) throw new ErroAmbiente(motivos);

  if (perfil === 'release') {
    const producao = cfg.producao;
    if (producao.web === null) {
      throw new ErroAmbiente(['a configuração web pública da produção não foi preenchida em config/ambientes.json (producao.web; ação do proprietário).']);
    }
    return Object.freeze({
      perfil, ambiente: AMBIENTE_PRODUCAO, comando, projectId: producao.projectId, web: Object.freeze({...producao.web}),
      regiao: producao.regiaoFunctions, emuladores: false, loginE2E: false, publicavel: true,
      saida: SAIDA_POR_PERFIL.release, origens: Object.freeze([...producao.origens]),
      appCheck: producao.appCheck ? Object.freeze({...producao.appCheck}) : null,
      conexaoEmulador: null,
    });
  }
  if (perfil === 'verificacao') {
    const web = cfg.verificacao.web;
    return Object.freeze({
      perfil, ambiente: null, comando, projectId: web.projectId, web: Object.freeze({...web}), regiao: REGIAO_FUNCTIONS,
      emuladores: false, loginE2E: false, publicavel: false, saida: SAIDA_POR_PERFIL.verificacao, origens: Object.freeze([]),
      appCheck: null, conexaoEmulador: null,
    });
  }
  const emulador = cfg.emulador;
  return Object.freeze({
    perfil, ambiente: null, comando, projectId: emulador.projectId, web: Object.freeze({...emulador.web}),
    regiao: emulador.regiaoFunctions, emuladores: true, loginE2E: perfil === 'e2e', publicavel: false,
    saida: SAIDA_POR_PERFIL[perfil] ?? null, origens: Object.freeze([]), appCheck: null,
    // `local` (npm run dev, Codespaces com a porta 3000 privada) fala com o Emulator pela mesma origem, pelo proxy do
    // Vite; `e2e` conecta direto às portas do Emulator, a topologia validada do E2E (os testes contam leituras por porta).
    conexaoEmulador: perfil === 'local' ? 'mesma-origem' : 'direta',
  });
};

/**
 * Variáveis do processo que o build do frontend recusa. O perfil define a configuração web; uma `VITE_*` no shell (ou
 * as antigas `VITE_E2E_MODE` e `VITE_USE_FIREBASE_EMULATORS`) é conflito de ambiente, nunca uma sobreposição.
 * Devolve só os nomes, nunca os valores.
 */
export const variaveisViteDoProcesso = (env) => Object.keys(env).filter((nome) => nome.startsWith('VITE_')).sort();

/** A pasta de ambiente do Vite precisa existir e não ter nenhum `.env*`. */
export const conferirPastaEnvVazia = (raiz = RAIZ) => {
  const pasta = join(raiz, PASTA_ENV_VAZIA);
  if (!existsSync(pasta)) return [`${PASTA_ENV_VAZIA} não existe.`];
  const arquivos = readdirSync(pasta).filter((nome) => nome.startsWith('.env'));
  return arquivos.length > 0 ? [`${PASTA_ENV_VAZIA} não pode ter arquivos .env* (${arquivos.length} encontrado[s]).`] : [];
};

/**
 * Proxy de mesma origem dos perfis de Emulator. O navegador só fala com o servidor do Vite (no Codespaces, uma única
 * porta privada); o Vite repassa ao Emulator na própria máquina. Os prefixos são os caminhos que os SDKs usam com o
 * Emulator: Auth (`identitytoolkit`, `securetoken`, `emulator/`), Firestore (WebChannel e RPC) e callables
 * (`/<projeto>/<região>/`).
 */
/**
 * Como o cliente fala com o Emulator (`define` `__FENIX_CONEXAO_EMULADOR__`): `null` sem Emulator; mesma origem (pelo
 * proxy do Vite) no `local`; direto em `127.0.0.1` e nas portas do `firebase.json` no `e2e`.
 */
export const conexaoDoEmulador = (plano, portas) => {
  if (!plano.emuladores) return null;
  if (plano.conexaoEmulador === 'mesma-origem') return Object.freeze({modo: 'mesma-origem'});
  return Object.freeze({modo: 'direta', host: '127.0.0.1', auth: portas.auth, firestore: portas.firestore, functions: portas.functions});
};

export const planoProxy = (plano, portas) => {
  if (!plano.emuladores || plano.conexaoEmulador !== 'mesma-origem') return null;
  const alvo = (porta) => ({target: `http://127.0.0.1:${porta}`, changeOrigin: false, ws: false});
  return Object.freeze({
    '/identitytoolkit.googleapis.com/': alvo(portas.auth),
    '/securetoken.googleapis.com/': alvo(portas.auth),
    '/emulator/': alvo(portas.auth),
    '/google.firestore.v1.Firestore/': alvo(portas.firestore),
    [`/v1/projects/${plano.projectId}/databases/`]: alvo(portas.firestore),
    [`/${plano.projectId}/${plano.regiao}/`]: alvo(portas.functions),
  });
};

/**
 * `.firebaserc` seguro: sem `default` (nenhum comando cai num projeto por omissão) e só com o alias `local` do Emulator.
 * A produção nunca tem alias: toda publicação passa o Project ID por extenso (`--project`), conferido pelo guard.
 */
export const validarFirebaserc = (firebaserc, cfg) => {
  const erros = [];
  const projetos = firebaserc?.projects;
  if (!ehObjeto(projetos)) return ['.firebaserc sem o mapa projects.'];
  if ('default' in projetos) erros.push('.firebaserc não pode ter alias default (nenhum projeto por omissão).');
  for (const [alias, id] of Object.entries(projetos)) {
    if (alias === 'default') continue;
    if (alias !== 'local' || id !== cfg?.emulador?.projectId) {
      erros.push(`.firebaserc: só o alias local, apontando para o Emulator, é aceito (encontrado: ${alias}).`);
    }
  }
  if ('targets' in (firebaserc ?? {})) erros.push('.firebaserc: targets de deploy não são aceitos (o guard fixa os alvos).');
  return erros;
};

export const lerFirebaserc = (raiz = RAIZ) => {
  try {
    return JSON.parse(readFileSync(join(raiz, '.firebaserc'), 'utf8'));
  } catch {
    return null;
  }
};

/** O Project ID é o da produção do contrato? (Para o gancho de predeploy, que só recebe o projeto.) */
export const ehProjetoDeProducao = (projectId, cfg) => typeof projectId === 'string' && projectId === cfg?.producao?.projectId;
