/**
 * Comparação das Rules publicadas com as do commit (P6-A): funções puras, sem rede. A linha de comando é
 * `comparar-rules.mjs` (RUNBOOKS RB-15).
 */
import {createHash} from 'node:crypto';

export const ARQUIVO_POR_SERVICO = Object.freeze({firestore: 'firestore.rules', storage: 'storage.rules'});

const normalizar = (texto) => texto.replace(/\r\n?/g, '\n').replace(/\n+$/, '\n');
const sha = (texto) => createHash('sha256').update(normalizar(texto)).digest('hex');

/** Extrai o conteúdo do ruleset (`source.files[].content`) da resposta da API. Exige exatamente um arquivo. */
export const conteudoPublicado = (ruleset) => {
  const arquivos = ruleset?.source?.files;
  if (!Array.isArray(arquivos) || arquivos.length !== 1 || typeof arquivos[0]?.content !== 'string') {
    throw new Error('o JSON não é um ruleset com exatamente um arquivo (source.files[0].content).');
  }
  return arquivos[0].content;
};

export const compararRules = (local, publicado) => {
  const [a, b] = [normalizar(local), normalizar(publicado)];
  if (a === b) return {iguais: true, sha256Local: sha(local), sha256Publicado: sha(publicado), primeiraDiferenca: null};
  const [linhasA, linhasB] = [a.split('\n'), b.split('\n')];
  let indice = 0;
  while (indice < Math.max(linhasA.length, linhasB.length) && linhasA[indice] === linhasB[indice]) indice += 1;
  return {iguais: false, sha256Local: sha(local), sha256Publicado: sha(publicado), primeiraDiferenca: indice + 1};
};
