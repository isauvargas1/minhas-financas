#!/usr/bin/env node
/**
 * Comparação das Rules publicadas com as testadas (P6-A, Frente B). Não fala com a produção: o proprietário baixa o
 * ruleset publicado pela API do Firebase Rules (só leitura; roteiro no RUNBOOKS.md, "Conferir as Rules publicadas") e
 * passa o arquivo JSON para esta ferramenta, que o compara com `firestore.rules` ou `storage.rules` do commit atual.
 *
 *   node tools/operacao/comparar-rules.mjs --servico firestore --publicado <ruleset.json>
 *   node tools/operacao/comparar-rules.mjs --servico storage   --publicado <ruleset.json>
 *
 * Saída 0: idênticas (mesmo SHA-256 depois de normalizar só o fim de linha). Saída 1: diferentes, com a primeira linha
 * divergente. Saída 2: argumentos ou arquivo inválidos. Nada é gravado.
 */
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {ErroArgumentos, lerArgumentos} from '../ambiente/argumentos.mjs';
import {RAIZ} from '../ambiente/contrato.mjs';
import {ARQUIVO_POR_SERVICO, compararRules, conteudoPublicado} from './rules.mjs';

// Sempre executa: a CLI não tem guarda de "módulo principal" (que falharia aberto com symlink no caminho, PLT-4).
{
  const sair = (mensagem, codigo) => {
    process.stderr.write(`\n[rules] ${mensagem}\n`);
    process.exit(codigo);
  };
  let args;
  try {
    args = lerArgumentos(process.argv.slice(2), {valores: ['servico', 'publicado']});
  } catch (erro) {
    if (erro instanceof ErroArgumentos) sair(erro.message, 2);
    throw erro;
  }
  const arquivo = ARQUIVO_POR_SERVICO[args.get('servico') ?? ''];
  if (!arquivo) sair('--servico precisa ser firestore ou storage.', 2);
  if (!args.get('publicado')) sair('--publicado <ruleset.json> é obrigatório.', 2);
  let publicado;
  try {
    publicado = conteudoPublicado(JSON.parse(readFileSync(args.get('publicado'), 'utf8')));
  } catch (erro) {
    sair(`ruleset publicado ilegível: ${erro.message}`, 2);
  }
  const resultado = compararRules(readFileSync(join(RAIZ, arquivo), 'utf8'), publicado);
  console.log(JSON.stringify({servico: args.get('servico'), arquivo, ...resultado}, null, 2));
  if (!resultado.iguais) sair(`as Rules publicadas DIFEREM de ${arquivo} a partir da linha ${resultado.primeiraDiferenca}.`, 1);
  console.log(`[rules] as Rules publicadas são idênticas a ${arquivo} deste commit.`);
}
