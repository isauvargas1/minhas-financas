/**
 * Composição da publicação das Functions (P6-A): quais funções vão para a produção, dado o que existe no Secret
 * Manager.
 *
 * Cada função v2 compilada carrega o `__endpoint` que o firebase-tools lê no deploy, e nele os segredos declarados
 * (`secretEnvironmentVariables`). O `firebase deploy` não interativo falha se um segredo declarado não existe no
 * projeto, e criá-lo é ação humana (E-05 para a IA, E-06 para o Stripe). Então:
 * - o inventário lê o `__endpoint` de `functions/lib/index.js` num processo separado, sem rede e sem credencial;
 * - a função que declara segredo fora de `producao.segredos` (só nomes, no contrato) fica de fora da publicação, e o
 *   guard lista o que ficou de fora e por quê;
 * - com tudo registrado, o alvo volta a ser `--only functions` inteiro (o firebase-tools então também aponta funções
 *   órfãs na produção).
 *
 * No primeiro deploy, `producao.segredos` é vazio: a IA (análise e extração) e o checkout, o portal e o webhook do
 * Stripe não vão nesta publicação. Isso NÃO remove uma versão antiga dessas funções que já esteja implantada (o
 * `--only functions:a,b` nunca apaga): ela continua no ar com o código anterior até o saneamento manual e autorizado
 * (RUNBOOKS.md, RB-17, conferido pelo pré-voo `tools/operacao/preflight-producao.mjs`). Só sem versão antiga o
 * cliente mostra o erro genérico em pt-BR ao tentar usá-las e nada chega ao provedor.
 */
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {RAIZ} from '../ambiente/contrato.mjs';

const INVENTARIO = `
const indice = require(process.argv[1]);
const funcoes = [];
for (const [nome, valor] of Object.entries(indice)) {
  if (!valor || (typeof valor !== 'object' && typeof valor !== 'function') || !('__endpoint' in valor)) continue;
  const segredos = (valor.__endpoint.secretEnvironmentVariables ?? []).map((segredo) => segredo.key).sort();
  funcoes.push({nome, segredos});
}
process.stdout.write(JSON.stringify(funcoes.sort((a, b) => a.nome.localeCompare(b.nome))));
`;

export class ErroInventario extends Error {}

/** Lê as funções exportadas pelo build e os segredos de cada uma. Exige `npm run functions:build` antes. */
export const inventarioDasFuncoes = (raiz = RAIZ) => {
  const indice = join(raiz, 'functions', 'lib', 'index.js');
  if (!existsSync(indice)) throw new ErroInventario('functions/lib/index.js ausente: compile as Functions (npm run functions:build).');
  const resultado = spawnSync(process.execPath, ['-e', INVENTARIO, indice], {
    cwd: join(raiz, 'functions'),
    encoding: 'utf8',
    env: {PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? ''},
    timeout: 60_000,
  });
  if (resultado.status !== 0) throw new ErroInventario('não foi possível ler as funções compiladas (functions/lib/index.js).');
  const funcoes = JSON.parse(resultado.stdout);
  if (!Array.isArray(funcoes) || funcoes.length === 0) throw new ErroInventario('o build das Functions não exporta nenhuma função.');
  return funcoes;
};

/** Separa as funções publicáveis das que dependem de segredo não registrado. */
export const planoDasFuncoes = (inventario, segredosRegistrados) => {
  const registrados = new Set(segredosRegistrados);
  const incluidas = [];
  const excluidas = [];
  for (const {nome, segredos} of inventario) {
    const faltam = segredos.filter((segredo) => !registrados.has(segredo));
    if (faltam.length === 0) incluidas.push(nome);
    else excluidas.push({nome, faltam});
  }
  return {incluidas, excluidas};
};

/**
 * `--only` efetivo de um alvo que publica Functions. `funcoes`: `'todas'` (todas as publicáveis) ou a lista exata
 * exigida pelo alvo (ex.: `['stripeWebhook']`). Devolve `{only, excluidas, motivos}`; com motivos, nada é publicado.
 */
export const onlyComFuncoes = ({onlyBase, funcoes, plano}) => {
  if (funcoes === 'todas') {
    if (plano.incluidas.length === 0) return {only: null, excluidas: plano.excluidas, motivos: ['nenhuma função publicável.']};
    if (plano.excluidas.length === 0) return {only: onlyBase, excluidas: [], motivos: []};
    const lista = plano.incluidas.map((nome) => `functions:${nome}`).join(',');
    const only = onlyBase.split(',').map((parte) => (parte === 'functions' ? lista : parte)).join(',');
    return {only, excluidas: plano.excluidas, motivos: []};
  }
  const bloqueadas = plano.excluidas.filter(({nome}) => funcoes.includes(nome));
  const ausentes = funcoes.filter((nome) => !plano.incluidas.includes(nome) && !bloqueadas.some((b) => b.nome === nome));
  const motivos = [
    ...bloqueadas.map(({nome, faltam}) => `${nome} exige segredo não registrado em producao.segredos (${faltam.join(', ')}).`),
    ...ausentes.map((nome) => `${nome} não está exportada pelo build das Functions.`),
  ];
  return {only: motivos.length > 0 ? null : onlyBase, excluidas: [], motivos};
};
