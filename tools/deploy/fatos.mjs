/**
 * Coleta dos fatos locais para o guard de publicação (P6-A): commit, alterações não commitadas, tags do HEAD,
 * `.firebaserc` e o marcador do build em `dist/`. Só leitura; nada de rede nem de credencial.
 */
import {execFileSync} from 'node:child_process';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {MARCADOR_BUILD, RAIZ, SAIDA_POR_PERFIL, lerFirebaserc} from '../ambiente/contrato.mjs';

const git = (raiz, ...argumentos) => execFileSync('git', argumentos, {cwd: raiz, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim();

export const fatosDoGit = (raiz = RAIZ) => {
  try {
    const commit = git(raiz, 'rev-parse', 'HEAD');
    const sujo = git(raiz, 'status', '--porcelain', '--untracked-files=normal') !== '';
    const tags = git(raiz, 'tag', '--points-at', 'HEAD').split('\n').filter(Boolean);
    return {commit, sujo, tags};
  } catch {
    return {commit: null, sujo: true, tags: []};
  }
};

export const lerMarcadorDoRelease = (raiz = RAIZ) => {
  try {
    return JSON.parse(readFileSync(join(raiz, SAIDA_POR_PERFIL.release, MARCADOR_BUILD), 'utf8'));
  } catch {
    return null;
  }
};

/**
 * Nomes (nunca o conteúdo) dos arquivos `.env*` de `functions/`. O firebase-tools os carrega como variáveis de ambiente
 * das Functions publicadas, e o Git os ignora, então o "worktree limpo" não os vê. `null` se a pasta não puder ser lida.
 */
export const arquivosEnvDasFunctions = (raiz = RAIZ) => {
  try {
    return readdirSync(join(raiz, 'functions')).filter((nome) => nome.startsWith('.env')).sort();
  } catch {
    return null;
  }
};

export const fatosLocais = (raiz = RAIZ) => ({
  git: fatosDoGit(raiz),
  firebaserc: lerFirebaserc(raiz),
  envFunctions: arquivosEnvDasFunctions(raiz),
});
