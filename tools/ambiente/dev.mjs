#!/usr/bin/env node
/**
 * `npm run dev` (P6-A): o app inteiro contra o Emulator, com dados sintéticos, sem tocar a produção.
 *
 * 1. Valida o perfil `local` no contrato (`config/ambientes.json`).
 * 2. Compila as Functions.
 * 3. Sobe Auth, Firestore e Functions do Emulator (projeto `minhas-financas-local`) com a interface do Emulator, e o
 *    Vite no perfil `local` dentro do `firebase emulators:exec`. Ao parar (Ctrl+C), tudo desliga junto.
 * 4. Guarda os dados sintéticos em `.fenix-emulador/` (fora do Git) e os recarrega na próxima vez.
 *
 * O navegador fala só com a porta do Vite (3000): o proxy de mesma origem repassa ao Emulator. No GitHub Codespaces,
 * basta encaminhar a porta 3000, que fica privada por padrão (só a sua conta do GitHub abre). A interface do Emulator
 * fica na porta 4000, se você quiser encaminhá-la também.
 *
 * Opções: `--host` e `--port` do Vite (padrão `0.0.0.0` e `3000`), `--sem-dados-salvos` (começa vazio e não grava) e
 * `--plano` (só imprime os comandos).
 */
import {spawn, spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {ErroArgumentos, OPCOES_DE_PROJETO_PROIBIDAS, lerArgumentos} from './argumentos.mjs';
import {ErroAmbiente, RAIZ, carregarConfiguracao, resolverPerfil, variaveisViteDoProcesso} from './contrato.mjs';

const falhar = (mensagem, codigo) => {
  process.stderr.write(`\n[dev] ${mensagem}\n`);
  process.exit(codigo);
};

let args;
try {
  args = lerArgumentos(process.argv.slice(2), {
    valores: ['host', 'port'],
    booleanas: ['plano', 'sem-dados-salvos'],
    proibidas: OPCOES_DE_PROJETO_PROIBIDAS,
  });
} catch (erro) {
  if (erro instanceof ErroArgumentos) falhar(erro.message, 2);
  throw erro;
}
let plano;
try {
  plano = resolverPerfil({perfil: 'local', comando: 'serve'}, carregarConfiguracao());
} catch (erro) {
  if (erro instanceof ErroAmbiente) falhar(erro.message, 3);
  throw erro;
}
const proibidas = variaveisViteDoProcesso(process.env);
if (proibidas.length > 0) falhar(`variáveis VITE_* no ambiente não são aceitas (${proibidas.join(', ')}).`, 3);

const host = args.get('host') ?? '0.0.0.0';
const port = args.get('port') ?? '3000';
if (!/^[A-Za-z0-9.:-]+$/.test(host) || !/^\d{2,5}$/.test(port)) falhar('--host ou --port inválido.', 2);

const PASTA_DADOS = '.fenix-emulador';
const salvar = !args.has('sem-dados-salvos');
const temDados = existsSync(join(RAIZ, PASTA_DADOS, 'firebase-export-metadata.json'));
const servidor = `node tools/ambiente/vite.mjs dev --perfil local --host ${host} --port ${port}`;
const emulador = [
  'emulators:exec', '--only', 'auth,firestore,functions', '--project', plano.projectId, '--ui',
  ...(salvar && temDados ? ['--import', PASTA_DADOS] : []),
  ...(salvar ? ['--export-on-exit', PASTA_DADOS] : []),
  servidor,
];

if (args.has('plano')) {
  console.log(JSON.stringify({perfil: plano.perfil, projeto: plano.projectId, functions: 'npm --prefix functions run build', firebase: emulador}));
  process.exit(0);
}

const firebase = spawnSync('firebase', ['--version'], {encoding: 'utf8'});
if (firebase.status !== 0) {
  falhar('o firebase-tools não está instalado. Instale com: npm install -g firebase-tools@15.32.1 (Java 11+ também é necessário).', 4);
}
console.log('[dev] compilando as Functions…');
const functions = spawnSync('npm', ['--prefix', 'functions', 'run', 'build'], {cwd: RAIZ, stdio: 'inherit'});
if (functions.status !== 0) falhar('o build das Functions falhou.', 1);
console.log(`[dev] Emulator (${plano.projectId}) + app em http://localhost:${port} (no Codespaces, encaminhe a porta ${port}).`);
const filho = spawn('firebase', emulador, {cwd: RAIZ, stdio: 'inherit'});
for (const sinal of ['SIGINT', 'SIGTERM']) process.on(sinal, () => filho.kill(sinal));
filho.on('exit', (codigo, sinal) => process.exit(codigo ?? (sinal ? 1 : 0)));
