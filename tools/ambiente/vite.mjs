#!/usr/bin/env node
/**
 * Servidor do Vite por perfil (P6-A). Só os perfis de Emulator servem o app:
 *
 *   node tools/ambiente/vite.mjs dev --perfil local      → desenvolvimento contra o Emulator (usado por `npm run dev`)
 *   node tools/ambiente/vite.mjs dev --perfil e2e        → E2E com HMR (`E2E_SERVER=dev` no Playwright)
 *   node tools/ambiente/vite.mjs preview --perfil e2e    → E2E contra o build `dist-e2e/` (padrão do Playwright)
 *
 * Opções do Vite aceitas: `--host`, `--port` e `--strictPort`. Qualquer outra é recusada (`--mode`, `--config`,
 * `--project` …), e nenhum perfil serve o app contra a produção. `--plano` só imprime o que seria executado.
 */
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {ErroArgumentos, OPCOES_DE_PROJETO_PROIBIDAS, lerArgumentos} from './argumentos.mjs';
import {ErroAmbiente, RAIZ, carregarConfiguracao, resolverPerfil, variaveisViteDoProcesso} from './contrato.mjs';

const falhar = (mensagem, codigo) => {
  process.stderr.write(`\n[vite] ${mensagem}\n`);
  process.exit(codigo);
};

const [subcomando, ...resto] = process.argv.slice(2);
if (!['dev', 'preview'].includes(subcomando)) falhar('uso: node tools/ambiente/vite.mjs <dev|preview> --perfil <local|e2e>', 2);

let args;
try {
  args = lerArgumentos(resto, {
    valores: ['perfil', 'host', 'port'],
    booleanas: ['strictPort', 'plano'],
    proibidas: OPCOES_DE_PROJETO_PROIBIDAS,
  });
} catch (erro) {
  if (erro instanceof ErroArgumentos) falhar(erro.message, 2);
  throw erro;
}
const comando = subcomando === 'dev' ? 'serve' : 'preview';
let plano;
try {
  plano = resolverPerfil({perfil: args.get('perfil'), comando}, carregarConfiguracao());
} catch (erro) {
  if (erro instanceof ErroAmbiente) falhar(erro.message, 3);
  throw erro;
}
if (!plano.emuladores) falhar(`o perfil ${plano.perfil} não serve o app: só local e e2e, contra o Emulator.`, 3);
const proibidas = variaveisViteDoProcesso(process.env);
if (proibidas.length > 0) falhar(`variáveis VITE_* no ambiente não são aceitas (${proibidas.join(', ')}).`, 3);

const port = args.get('port');
if (port !== undefined && !/^\d{2,5}$/.test(port)) falhar('--port precisa ser um número de porta.', 2);
const host = args.get('host');
if (host !== undefined && !/^[A-Za-z0-9.:-]+$/.test(host)) falhar('--host inválido.', 2);
const argumentosVite = [
  ...(subcomando === 'preview' ? ['preview'] : []),
  ...(host ? ['--host', host] : []),
  ...(port ? ['--port', port] : []),
  ...(args.has('strictPort') ? ['--strictPort'] : []),
];

if (args.has('plano')) {
  console.log(JSON.stringify({perfil: plano.perfil, projeto: plano.projectId, comando: subcomando, vite: argumentosVite}));
  process.exit(0);
}

const filho = spawn(process.execPath, [join(RAIZ, 'node_modules', 'vite', 'bin', 'vite.js'), ...argumentosVite], {
  cwd: RAIZ,
  stdio: 'inherit',
  env: {...process.env, FENIX_PERFIL: plano.perfil},
});
for (const sinal of ['SIGINT', 'SIGTERM']) process.on(sinal, () => filho.kill(sinal));
filho.on('exit', (codigo, sinal) => process.exit(codigo ?? (sinal ? 1 : 0)));
