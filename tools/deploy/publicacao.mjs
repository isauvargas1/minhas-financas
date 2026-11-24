/**
 * Regras de publicação na produção única (P6-A, PR-PLAT-01 e parte local do PR-REL-01).
 *
 * Funções puras sobre "fatos" coletados pela linha de comando (`publicar.mjs`) ou pelo gancho de predeploy
 * (`guarda-predeploy.mjs`), para que cada recusa seja testável sem rede, sem credencial e sem `firebase deploy`.
 *
 * Uma publicação só passa com TODOS os itens:
 * - o contrato válido (`config/ambientes.json`) e a liberação expressa registrada nele (`producao.liberacao`, gate G0);
 * - `--project` por extenso, igual ao projeto de produção do contrato, uma vez só (o Emulator nunca recebe deploy);
 * - `--confirmar` repetindo o mesmo Project ID (a confirmação humana, sem prompt interativo);
 * - um alvo conhecido (`--alvo`);
 * - nenhum conflito no ambiente do processo (`GCLOUD_PROJECT` e afins apontando para outro projeto, `FIREBASE_TOKEN`);
 * - o `.firebaserc` sem `default` e sem alias de produção;
 * - o worktree limpo e o HEAD marcado com uma versão (`vAAAA.MM.DD` ou semver `vX.Y.Z`);
 * - homologação independente, executada manualmente; o publicador não executa suítes de testes;
 * - para o Hosting: o build de release da produção, do mesmo commit, sem alterações locais, nunca um build E2E ou de
 *   verificação, e a varredura de publicação do bundle;
 * - para as Functions: só as funções cujos segredos declarados constam de `producao.segredos` (funcoes.mjs); as demais
 *   ficam de fora e são listadas. Nenhum segredo é criado, lido ou impresso.
 *
 * Limite, declarado: este guard protege os caminhos oficiais do repositório (`npm run deploy:*` e o predeploy do
 * `firebase.json`). Quem tem permissão no projeto pode publicar por outro meio (outro `firebase.json`, a API REST, o
 * console). Esse controle é do IAM do Google Cloud (E-04), que o guard não substitui.
 */
import {AMBIENTE_PRODUCAO, MARCADOR_BUILD, validarConfiguracao, validarFirebaserc, validarLiberacao} from '../ambiente/contrato.mjs';
import {onlyComFuncoes, planoDasFuncoes} from './funcoes.mjs';

/**
 * Alvo → `--only` do firebase-tools e verificações exigidas antes. `funcoes`: o alvo publica Functions, e o `--only`
 * efetivo sai do inventário do build contra `producao.segredos` (`'todas'` as publicáveis, ou a lista exata exigida).
 */
export const ALVOS = Object.freeze({
  firestore: {only: 'firestore:rules,firestore:indexes'},
  'firestore-indices': {only: 'firestore:indexes'},
  functions: {only: 'functions', funcoes: 'todas'},
  webhook: {only: 'functions:stripeWebhook', funcoes: ['stripeWebhook']},
  hosting: {only: 'hosting', exigeBuild: true},
  safe: {only: 'firestore:rules,firestore:indexes,functions', funcoes: 'todas'},
  storage: {only: 'storage'},
  release: {
    only: 'firestore:rules,firestore:indexes,storage,functions,hosting',
    funcoes: 'todas',
    exigeBuild: true,
    sequencial: true,
  },
});

/** Alvos do firebase-tools (no gancho de predeploy) → alvo do guard que precisa de build. */
export const ALVOS_DO_FIREBASE = Object.freeze(['firestore', 'functions', 'hosting', 'storage']);

export const VERSAO_DE_RELEASE = /^v(?:\d+\.\d+\.\d+|\d{4}\.\d{2}\.\d{2}(?:\.\d+)?)$/;

const VARIAVEIS_DE_PROJETO = Object.freeze(['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'CLOUDSDK_CORE_PROJECT', 'FIREBASE_PROJECT']);

/**
 * Marca posta em todo processo filho da publicação (verificações, build e firebase-tools). Uma publicação iniciada
 * dentro de outra, por exemplo por um teste que rodasse `publicar.mjs` durante o `predeploy:check`, é recusada.
 */
export const MARCA_PUBLICACAO_EM_CURSO = 'FENIX_PUBLICACAO_EM_CURSO';

/** Conflitos no ambiente do processo. Devolve só nomes de variáveis, nunca valores. */
export const conflitosDeAmbiente = (env, projectId, {gancho = false} = {}) => {
  const motivos = [];
  for (const nome of VARIAVEIS_DE_PROJETO) {
    // No gancho, o próprio firebase-tools define GCLOUD_PROJECT com o projeto do deploy: ele é o fato a conferir.
    if (gancho && nome === 'GCLOUD_PROJECT') continue;
    if (env[nome] !== undefined && env[nome] !== projectId) {
      motivos.push(`${nome} no ambiente aponta para outro projeto (conflito de ambiente).`);
    }
  }
  if (!gancho && env[MARCA_PUBLICACAO_EM_CURSO] !== undefined) {
    motivos.push('publicação aninhada: já existe uma publicação em curso neste processo (nada é publicado de dentro de outra).');
  }
  if (env.GOOGLE_APPLICATION_CREDENTIALS !== undefined) {
    motivos.push('GOOGLE_APPLICATION_CREDENTIALS definido: chave de conta de serviço baixada não é aceita (use login de pessoa, E-04).');
  }
  if (env.FIREBASE_TOKEN !== undefined) {
    motivos.push('FIREBASE_TOKEN definido: token de longa duração não é aceito (use login de pessoa ou identidade federada, E-04).');
  }
  return motivos;
};

/** Arquivos `.env*` de `functions/` aceitos: o exemplo (não é carregado) e o `.env.local` (só o Emulator o carrega). */
export const ENV_DAS_FUNCTIONS_ACEITOS = Object.freeze(['.env.example', '.env.local']);

/**
 * O firebase-tools publica `functions/.env`, `.env.<projectId>` e `.env.<alias>` como variáveis das Functions, em texto
 * puro, por fora de `producao.segredos` e do Secret Manager. Qualquer um desses arquivos recusa a publicação.
 */
export const avaliarEnvDasFunctions = (envFunctions) => {
  if (!Array.isArray(envFunctions)) return ['não foi possível listar functions/.env*: a publicação não confere o que iria às Functions.'];
  const recusados = envFunctions.filter((nome) => !ENV_DAS_FUNCTIONS_ACEITOS.includes(nome));
  return recusados.length === 0 ? [] : [
    `functions/ tem ${recusados.join(', ')}: o firebase-tools publicaria essas variáveis nas Functions, por fora do Secret Manager. Remova antes de publicar.`,
  ];
};

/**
 * Itens que não dependem do build nem das verificações.
 * @param {{cfg: object, alvo: string|undefined, project: string|undefined, confirmar: string|undefined,
 *   git: {commit: string|null, sujo: boolean, tags: string[]}, firebaserc: object|null, env: object,
 *   gancho?: boolean}} fatos
 */
export const avaliarItensEstaticos = (fatos) => {
  const {cfg, alvo, project, confirmar, git, firebaserc, env, gancho = false} = fatos;
  const motivos = [];
  const erros = validarConfiguracao(cfg);
  if (erros.length > 0) motivos.push(...erros.map((erro) => `contrato: ${erro}`));
  const producao = cfg?.producao?.projectId;
  if (!gancho && !Object.hasOwn(ALVOS, alvo ?? '')) motivos.push(`--alvo ausente ou desconhecido (${Object.keys(ALVOS).join(', ')}).`);
  if (!project) {
    motivos.push('--project ausente: a publicação exige o Project ID por extenso.');
  } else if (project === cfg?.emulador?.projectId) {
    motivos.push('o projeto do Emulator não recebe deploy.');
  } else if (project !== producao) {
    motivos.push('o projeto informado não é o projeto de produção do contrato (config/ambientes.json).');
  }
  if (!gancho && confirmar !== project) motivos.push('--confirmar precisa repetir exatamente o Project ID informado em --project.');
  const liberacao = cfg?.producao?.liberacao;
  if (liberacao === null || liberacao === undefined) {
    motivos.push('liberação de publicação não registrada (producao.liberacao, gate G0 do LAUNCH_CHECKLIST.md): exige a autorização expressa do proprietário.');
  } else {
    motivos.push(...validarLiberacao(liberacao));
  }
  if (firebaserc === null) motivos.push('.firebaserc ausente ou ilegível.');
  else motivos.push(...validarFirebaserc(firebaserc, cfg));
  motivos.push(...avaliarEnvDasFunctions(fatos.envFunctions));
  motivos.push(...conflitosDeAmbiente(env ?? {}, project, {gancho}));
  if (!git?.commit) motivos.push('não foi possível identificar o commit (HEAD).');
  if (git?.sujo) motivos.push('o worktree tem alterações não commitadas: só um commit exato é publicado.');
  if (!(git?.tags ?? []).some((tag) => VERSAO_DE_RELEASE.test(tag))) {
    motivos.push('o HEAD não tem tag de versão (vX.Y.Z ou vAAAA.MM.DD): toda publicação corresponde a uma versão recuperável.');
  }
  return motivos;
};

/** Itens do build publicado no Hosting (`dist/fenix-build.json`). */
export const avaliarBuild = ({marcador, project, git}) => {
  if (!marcador) return [`dist/${MARCADOR_BUILD} ausente: o Hosting só publica um build de release (npm run build:release).`];
  const motivos = [];
  if (marcador.perfil === 'e2e' || marcador.loginE2E || marcador.emuladores) {
    motivos.push('dist/ contém um build de E2E ou de Emulator: nunca é publicado.');
  }
  if (marcador.perfil !== 'release' || marcador.publicavel !== true || marcador.ambiente !== AMBIENTE_PRODUCAO) {
    motivos.push(`o build em dist/ é do perfil ${marcador.perfil ?? 'desconhecido'}, não de release da produção.`);
  }
  if (marcador.projectId !== project) motivos.push('o build em dist/ é de outro projeto.');
  if (!git?.commit || marcador.origem?.commit !== git.commit) motivos.push('o build em dist/ não é do commit atual (HEAD).');
  if (marcador.origem?.alteracoesLocais !== false) motivos.push('o build em dist/ foi feito com alterações locais não commitadas.');
  return motivos;
};

/**
 * Pipeline completo. `executar(comando, argumentos, opcoes)` devolve o código de saída; os testes injetam um falso.
 * `inventariarFuncoes()` devolve as funções do build com os segredos de cada uma (funcoes.mjs).
 * Ordem: itens estáticos → compilação das Functions quando necessária → composição pelo inventário →
 * (Hosting) build de release e itens do build → firebase deploy. Uma recusa em qualquer etapa interrompe antes da
 * seguinte; o firebase-tools só é chamado com tudo aprovado.
 */
export const executarPublicacao = ({fatos, executar, lerMarcador, inventariarFuncoes, interativo = false, registrar = () => {}}) => {
  const motivos = avaliarItensEstaticos(fatos);
  if (motivos.length > 0) return {publicado: false, etapa: 'itens', motivos};
  const {alvo, project, git} = fatos;
  const emCurso = {[MARCA_PUBLICACAO_EM_CURSO]: '1'};
  registrar(`publicação (${alvo}): homologação independente; nenhuma suíte de testes será executada.`);
  if (ALVOS[alvo].funcoes) {
    registrar('Compilando Functions para publicação...');
    if (executar('npm', ['run', 'functions:build'], {env: emCurso}) !== 0) {
      return {publicado: false, etapa: 'build-functions', motivos: ['a compilação das Functions falhou: nada foi publicado.']};
    }
  }
  let only = ALVOS[alvo].only;
  if (ALVOS[alvo].funcoes) {
    let inventario;
    try {
      inventario = inventariarFuncoes();
    } catch (erro) {
      return {publicado: false, etapa: 'funcoes', motivos: [`inventário das Functions indisponível: ${erro.message}`]};
    }
    const plano = planoDasFuncoes(inventario, fatos.cfg.producao.segredos);
    const composicao = onlyComFuncoes({onlyBase: only, funcoes: ALVOS[alvo].funcoes, plano});
    if (composicao.motivos.length > 0) return {publicado: false, etapa: 'funcoes', motivos: composicao.motivos};
    for (const {nome, faltam} of composicao.excluidas) {
      registrar(`fora desta publicação: ${nome} (segredo não registrado: ${faltam.join(', ')}).`);
    }
    if (composicao.excluidas.length > 0) {
      // P6-B: o `--only functions:a,b` nunca apaga; uma versão antiga já implantada continua no ar.
      registrar(
        'atenção: ficar fora desta publicação NÃO remove uma versão antiga já implantada dessas funções; ' +
        'confira com o pré-voo somente leitura (RUNBOOKS.md, RB-17) antes de qualquer dado real.',
      );
    }
    only = composicao.only;
  }
  if (ALVOS[alvo].exigeBuild) {
    registrar('Compilando frontend de produção...');
    if (executar('npm', ['run', 'build:release'], {env: emCurso}) !== 0) {
      return {publicado: false, etapa: 'build', motivos: ['o build de release falhou: nada foi publicado.']};
    }
    const doBuild = avaliarBuild({marcador: lerMarcador(), project, git});
    if (doBuild.length > 0) return {publicado: false, etapa: 'build', motivos: doBuild};
  }
  const argumentos = ['deploy', '--only', only, '--project', project];

  if (!interativo || !ALVOS[alvo].funcoes) {
    argumentos.push('--non-interactive');
  }
  const ambiente = {...emCurso, FENIX_PUBLICACAO: JSON.stringify({project, commit: git.commit, alvo})};

  if (ALVOS[alvo].sequencial) {
    const partes = only.split(',');
    const etapas = [
      ['Firestore', partes.filter(p => p.startsWith('firestore:'))],
      ['Storage', partes.filter(p => p === 'storage')],
      ['Functions', partes.filter(p => p === 'functions' || p.startsWith('functions:'))],
      ['Hosting', partes.filter(p => p === 'hosting')],
    ];

    let concluidas = 0;

    const progresso = () => {
      const percentual = concluidas * 25;
      registrar(
        '[' + '#'.repeat(concluidas * 5) +
        '-'.repeat(20 - concluidas * 5) +
        '] ' + percentual + '% (' + concluidas + '/4)'
      );
    };

    progresso();

    for (const [nome, seletores] of etapas) {
      if (seletores.length === 0) {
        return {
          publicado: false,
          etapa: 'firebase',
          motivos: ['Composicao vazia: ' + nome],
        };
      }

      const args = [
        'deploy', '--only', seletores.join(','),
        '--project', project,
      ];

      if (!interativo || nome !== 'Functions') {
        args.push('--non-interactive');
      }

      registrar('Iniciando: ' + nome);

      if (executar('firebase', args, {env: ambiente}) !== 0) {
        return {
          publicado: false,
          etapa: 'firebase',
          motivos: [
            'Falha em ' + nome +
            '; etapas concluidas: ' + concluidas + '/4',
          ],
        };
      }

      concluidas += 1;
      registrar('Concluido: ' + nome);
      progresso();
    }

    return {publicado: true, etapa: 'concluida', motivos: []};
  }

  registrar(`firebase ${argumentos.join(' ')}`);
  if (executar('firebase', argumentos, {env: ambiente}) !== 0) {
    return {publicado: false, etapa: 'firebase', motivos: ['o firebase-tools recusou ou falhou: confira a saída acima.']};
  }
  return {publicado: true, etapa: 'concluida', motivos: []};
};

/**
 * Gancho de predeploy (`firebase.json`): roda dentro de QUALQUER `firebase deploy` deste repositório, inclusive o
 * direto, fora dos scripts. Exige que a publicação tenha vindo do guard (`FENIX_PUBLICACAO`, com o mesmo projeto e o
 * mesmo commit) e reavalia os itens estáticos e, no Hosting, o build.
 */
export const avaliarGancho = ({fatos, alvoFirebase, publicacao, marcador}) => {
  const motivos = [];
  if (!ALVOS_DO_FIREBASE.includes(alvoFirebase)) motivos.push(`alvo do firebase-tools desconhecido no gancho (${alvoFirebase ?? 'nenhum'}).`);
  motivos.push(...avaliarItensEstaticos({...fatos, gancho: true}));
  let origem = null;
  try {
    origem = publicacao ? JSON.parse(publicacao) : null;
  } catch {
    origem = null;
  }
  if (!origem) {
    motivos.push('publicação fora do guard: use npm run deploy:* (tools/deploy/publicar.mjs), que valida os requisitos operacionais.');
  } else {
    if (origem.project !== fatos.project) motivos.push('o projeto do deploy não é o autorizado pelo guard.');
    if (origem.commit !== fatos.git?.commit) motivos.push('o commit mudou depois da autorização do guard.');
  }
  if (alvoFirebase === 'hosting') motivos.push(...avaliarBuild({marcador, project: fatos.project, git: fatos.git}));
  return motivos;
};
