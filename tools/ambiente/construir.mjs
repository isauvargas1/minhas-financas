#!/usr/bin/env node
/**
 * Build do frontend por perfil (P6-A, PR-PLAT-01 e PR-AUTH-04). É o único caminho de `vite build` nos scripts.
 *
 *   npm run build                                → perfil verificacao, em dist-verificacao/ (verify:fast e CI)
 *   npm run build:e2e                            → perfil e2e, em dist-e2e/ (Emulator e login automatizado)
 *   npm run build:release                        → perfil release da produção única, em dist/ (a única pasta que o
 *                                                  Hosting publica)
 *
 * Passos: valida o perfil no contrato (`config/ambientes.json`), recusa `VITE_*` no shell, roda o Vite com o perfil
 * fixado, confere o marcador `fenix-build.json` gravado no build e termina com a varredura de segredos e de marcadores
 * (`tools/seguranca/varrer-bundle.mjs --perfil <perfil>`). O release exige worktree limpo e grava commit e árvore.
 * Qualquer falha sai com código diferente de zero, sem valores secretos.
 */
import {execFileSync, spawnSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {ErroArgumentos, OPCOES_DE_PROJETO_PROIBIDAS, lerArgumentos} from './argumentos.mjs';
import {
  ErroAmbiente, MARCADOR_BUILD, RAIZ, carregarConfiguracao, resolverPerfil, variaveisViteDoProcesso,
} from './contrato.mjs';

const falhar = (mensagem, codigo = 1) => {
  process.stderr.write(`\n[build] ${mensagem}\n`);
  process.exit(codigo);
};

const git = (...argumentos) => execFileSync('git', argumentos, {cwd: RAIZ, encoding: 'utf8'}).trim();

/** Árvore do worktree (índice temporário, sem tocar o índice real) e se há alterações não commitadas. */
const origemDoBuild = () => {
  try {
    const commit = git('rev-parse', 'HEAD');
    const sujo = git('status', '--porcelain', '--untracked-files=normal') !== '';
    return {commit, sujo};
  } catch {
    return {commit: null, sujo: true};
  }
};

const principal = () => {
  let args;
  try {
    args = lerArgumentos(process.argv.slice(2), {valores: ['perfil'], proibidas: OPCOES_DE_PROJETO_PROIBIDAS});
  } catch (erro) {
    if (erro instanceof ErroArgumentos) falhar(erro.message, 2);
    throw erro;
  }
  const perfil = args.get('perfil');
  let plano;
  try {
    plano = resolverPerfil({perfil, comando: 'build'}, carregarConfiguracao());
  } catch (erro) {
    if (erro instanceof ErroAmbiente) falhar(erro.message, 3);
    throw erro;
  }
  const proibidas = variaveisViteDoProcesso(process.env);
  if (proibidas.length > 0) {
    falhar(`variáveis VITE_* no ambiente não são aceitas (${proibidas.join(', ')}): o perfil define a configuração.`, 3);
  }
  const origem = origemDoBuild();
  if (plano.perfil === 'release') {
    if (!origem.commit) falhar('release exige um repositório Git com HEAD.', 3);
    if (origem.sujo) falhar('release exige o worktree limpo: o build publicado corresponde exatamente a um commit.', 3);
  }
  const ambienteDoVite = {
    ...process.env,
    FENIX_PERFIL: plano.perfil,
    FENIX_BUILD_COMMIT: origem.commit ?? '',
    FENIX_BUILD_ARVORE: plano.perfil === 'release' ? git('rev-parse', 'HEAD^{tree}') : '',
    FENIX_BUILD_SUJO: origem.sujo ? 'sim' : 'nao',
    NODE_OPTIONS: [process.env.NODE_OPTIONS, '--max-old-space-size=4096'].filter(Boolean).join(' '),
  };
  if (!ambienteDoVite.FENIX_BUILD_COMMIT) delete ambienteDoVite.FENIX_BUILD_COMMIT;
  if (!ambienteDoVite.FENIX_BUILD_ARVORE) delete ambienteDoVite.FENIX_BUILD_ARVORE;
  console.log(`[build] perfil ${plano.perfil}${plano.ambiente ? ` (${plano.ambiente})` : ''} → ${plano.saida}/`);
  const vite = spawnSync(process.execPath, [join(RAIZ, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], {
    cwd: RAIZ, stdio: 'inherit', env: ambienteDoVite,
  });
  if (vite.status !== 0) falhar(`o Vite falhou (saída ${vite.status ?? vite.signal}).`);

  const caminhoMarcador = join(RAIZ, plano.saida, MARCADOR_BUILD);
  if (!existsSync(caminhoMarcador)) falhar(`o build não gravou ${MARCADOR_BUILD}.`);
  const marcador = JSON.parse(readFileSync(caminhoMarcador, 'utf8'));
  if (marcador.perfil !== plano.perfil || marcador.ambiente !== plano.ambiente || marcador.projectId !== plano.projectId) {
    falhar(`${MARCADOR_BUILD} não corresponde ao perfil pedido.`);
  }
  const varredura = spawnSync(
    process.execPath,
    [join(RAIZ, 'tools', 'seguranca', 'varrer-bundle.mjs'), plano.saida, '--perfil', plano.perfil],
    {cwd: RAIZ, stdio: 'inherit'},
  );
  if (varredura.status !== 0) falhar('a varredura do bundle reprovou o build.', varredura.status ?? 1);
};

principal();
