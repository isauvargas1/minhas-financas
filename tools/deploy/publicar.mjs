#!/usr/bin/env node
/**
 * Publicação na produção única pelos scripts oficiais (P6-A). Exemplo, só com a liberação G0 registrada:
 *
 *   npm run deploy:hosting -- --project <projectId> --confirmar <projectId>
 *
 * Regras e limites em `tools/deploy/publicacao.mjs`. Toda recusa sai com código 3 e lista os motivos, sem valores
 * secretos. Esta ferramenta não aceita `--only`, `--force`, `-P`, `--config` nem `--project` repetido.
 */
import {spawnSync} from 'node:child_process';
import {ErroArgumentos, OPCOES_DE_PROJETO_PROIBIDAS, lerArgumentos} from '../ambiente/argumentos.mjs';
import {RAIZ, carregarConfiguracao} from '../ambiente/contrato.mjs';
import {fatosLocais, lerMarcadorDoRelease} from './fatos.mjs';
import {inventarioDasFuncoes} from './funcoes.mjs';
import {executarPublicacao} from './publicacao.mjs';

const recusar = (motivos, codigo = 3) => {
  process.stderr.write(`\n[publicação] interrompida; confira as etapas ja concluidas:\n${motivos.map((motivo) => `  - ${motivo}`).join('\n')}\n`);
  process.exit(codigo);
};

const {project: _project, projeto: _projeto, ...proibidas} = OPCOES_DE_PROJETO_PROIBIDAS;
let args;
try {
  args = lerArgumentos(process.argv.slice(2), {valores: ['alvo', 'project', 'confirmar'], proibidas: {...proibidas, projeto: 'use --project'}});
} catch (erro) {
  if (erro instanceof ErroArgumentos) recusar([erro.message], 2);
  throw erro;
}
let cfg;
try {
  cfg = carregarConfiguracao();
} catch (erro) {
  recusar(erro.motivos ?? [String(erro.message)]);
}
const resultado = executarPublicacao({
  fatos: {cfg, alvo: args.get('alvo'), project: args.get('project'), confirmar: args.get('confirmar'), env: process.env, ...fatosLocais()},
  executar: (comando, argumentos, opcoes) =>
    spawnSync(comando, argumentos, {cwd: RAIZ, stdio: 'inherit', env: {...process.env, ...(opcoes.env ?? {})}}).status ?? 1,
  lerMarcador: () => lerMarcadorDoRelease(),
  inventariarFuncoes: () => inventarioDasFuncoes(),
  interativo: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  registrar: (mensagem) => console.log(`[publicação] ${mensagem}`),
});
if (!resultado.publicado) recusar(resultado.motivos);
console.log('[publicação] concluída.');
