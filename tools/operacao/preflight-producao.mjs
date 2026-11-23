#!/usr/bin/env node
/**
 * Pré-voo SOMENTE LEITURA da produção (P6-A/P6-B). Executado só pelo proprietário, com login de pessoa do gcloud e
 * credenciais padrão (ADC); agentes não executam. Regras e textos em `preflight.mjs`; roteiro no RUNBOOKS.md.
 *
 *   node tools/operacao/preflight-producao.mjs --project <id> --confirmar <id> [--parte contas|funcoes|tudo]
 *
 * - `funcoes`: UMA consulta `gcloud functions list` e comparação com o código e o plano de publicação;
 * - `contas`: leitura limitada de `users` (status ativo; só `accessStatus` e `createdAt`), com o `firebase-admin`
 *   carregado só depois de todas as guardas.
 * Nada é alterado; os comandos de saneamento só aparecem como texto.
 *
 * Saídas: 0 sem achados, 1 achados, 2 argumentos inválidos, 3 recusa das guardas (nada foi consultado),
 * 4 inconclusivo (API sem resposta, tempo esgotado, permissão, credencial ausente ou limite de leitura).
 */
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {ErroArgumentos, lerArgumentos} from '../ambiente/argumentos.mjs';
import {RAIZ, carregarConfiguracao} from '../ambiente/contrato.mjs';
import {ErroInventario, inventarioDasFuncoes, planoDasFuncoes} from '../deploy/funcoes.mjs';
import {
  CABECALHO, PARTES, TIMEOUT_LEITURA_MS, avaliarContas, avaliarGuardas, classificarFuncoes, codigoDeSaida,
  comandosDeSaneamento, consultarFuncoes, montarResumo, textoDeOrientacao,
} from './preflight.mjs';

const sair = (mensagem, codigo) => {
  process.stderr.write(`[pre-voo] ${mensagem}\n`);
  process.exit(codigo);
};

let args;
try {
  args = lerArgumentos(process.argv.slice(2), {
    valores: ['project', 'confirmar', 'parte'],
    proibidas: {
      force: 'o pré-voo só lê; não existe execução forçada',
      token: 'credencial por linha de comando não é aceita (use o login de pessoa do gcloud)',
      only: 'não se aplica',
    },
  });
} catch (erro) {
  if (erro instanceof ErroArgumentos) sair(erro.message, 2);
  throw erro;
}
const parte = args.get('parte') ?? 'tudo';
if (!PARTES.includes(parte)) sair(`--parte inválida: use ${PARTES.join(', ')}.`, 2);
const projectId = args.get('project');

// Todas as guardas antes de qualquer processo filho ou SDK.
const cfg = carregarConfiguracao();
const motivos = avaliarGuardas({cfg, project: projectId, confirmar: args.get('confirmar'), parte, env: process.env});
if (motivos.length > 0) sair(`recusado; nada foi consultado:\n${motivos.map((m) => `  - ${m}`).join('\n')}`, 3);

const consultarFuncoesRemotas = () => {
  let inventario;
  try {
    inventario = inventarioDasFuncoes(RAIZ);
  } catch (erro) {
    if (erro instanceof ErroInventario) return {status: 'inconclusivo', motivos: [`${erro.message} O inventário do código é necessário para classificar.`]};
    throw erro;
  }
  const plano = planoDasFuncoes(inventario, cfg.producao.segredos ?? []);
  const consulta = consultarFuncoes({projectId, executar: spawnSync, env: process.env});
  if (consulta.status !== 'ok') return consulta;
  return classificarFuncoes({remotas: consulta.remotas, plano});
};

/** Leitor real: só leitura, só os campos `accessStatus` e `createdAt` de perfis ativos, paginado por cursor. */
const consultarContas = async () => {
  let appModule;
  let firestoreModule;
  try {
    const requireAdmin = createRequire(new URL('../../functions/package.json', import.meta.url));
    appModule = requireAdmin('firebase-admin/app');
    firestoreModule = requireAdmin('firebase-admin/firestore');
  } catch {
    return {status: 'inconclusivo', motivos: ['o firebase-admin não está instalado em functions/node_modules (npm --prefix functions ci)']};
  }
  if (!appModule.getApps().length) appModule.initializeApp({projectId});
  const db = firestoreModule.getFirestore();
  const lerPagina = async ({depoisDe, limite}) => {
    let consulta = db.collection('users')
      .where('status', '==', 'active')
      .select('accessStatus', 'createdAt')
      .orderBy(firestoreModule.FieldPath.documentId())
      .limit(limite);
    if (depoisDe) consulta = consulta.startAfter(depoisDe);
    const resposta = await consulta.get();
    return resposta.docs.map((documento) => {
      const dados = documento.data();
      return {id: documento.id, accessStatus: dados.accessStatus, createdAt: dados.createdAt};
    });
  };
  try {
    return await avaliarContas({lerPagina, timeoutMs: TIMEOUT_LEITURA_MS});
  } finally {
    // Encerra o cliente sem esperar: uma leitura pendente não pode segurar o processo.
    db.terminate().catch(() => {});
  }
};

const partes = parte === 'tudo' ? ['funcoes', 'contas'] : [parte];
const funcoes = partes.includes('funcoes') ? consultarFuncoesRemotas() : null;
const contas = partes.includes('contas') ? await consultarContas() : null;

const resumo = montarResumo({projectId, agora: new Date(), partes, funcoes, contas});
const saneamento = funcoes && funcoes.status !== 'inconclusivo' ? comandosDeSaneamento({projectId, funcoes}) : [];
process.stdout.write(`${CABECALHO}\n\n${JSON.stringify(resumo, null, 2)}\n\n${textoDeOrientacao({resumo, saneamento})}\n`);

const codigo = codigoDeSaida(resumo);
if (codigo === 4) process.stderr.write('[pre-voo] resultado inconclusivo: o que não foi consultado não pode ser dado como limpo.\n');
else if (codigo === 1) process.stderr.write('[pre-voo] há achados: leia o resumo e a orientação acima.\n');
process.exitCode = codigo;
// Rede de segurança: o SDK pode manter conexões abertas depois de uma leitura que não respondeu.
setTimeout(() => process.exit(codigo), 2000).unref();
