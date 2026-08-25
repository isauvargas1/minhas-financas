import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync, readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

/**
 * Guarda de regressão: a inferência de IA é exclusiva do backend.
 *
 * O código do cliente já instanciou o SDK do Gemini no navegador, e
 * `vite.config.ts` injetava `GEMINI_API_KEY` no bundle via `define` — a
 * credencial real ficava legível para qualquer visitante. Estes testes falham
 * se qualquer uma das duas coisas voltar.
 */

const repoFile = (path: string) => readFileSync(path, 'utf8');

/**
 * `git ls-files` lista o índice, que ainda inclui arquivos apagados no working
 * tree antes do commit. A guarda varre o **conteúdo em disco**, então precisa
 * ignorar o que não existe mais — senão ela falha por um `ENOENT` que nada tem
 * a ver com a invariante que protege.
 */
const existsOnDisk = (path: string) => existsSync(path);

/** Sem shell: argumentos vão direto ao git, sem interpolação. */
const gitFiles = (...patterns: string[]) =>
  execFileSync('git', ['ls-files', ...patterns], {encoding: 'utf8'})
    .split('\n')
    .filter(Boolean);

const sourceFiles = gitFiles('src/**/*.ts', 'src/**/*.tsx').filter(existsOnDisk);

test('nenhum arquivo do cliente importa SDK de IA', () => {
  const offenders = sourceFiles.filter((file) => {
    const content = repoFile(file);
    return content.includes('@google/genai') ||
      content.includes('@google/generative-ai');
  });
  assert.deepEqual(
    offenders,
    [],
    'A inferência precisa ficar no backend; o SDK não pode entrar no bundle.',
  );
});

test('nenhum arquivo do cliente lê chave de IA do ambiente', () => {
  // Detecta o **uso** da variável, e não a menção dela: um comentário que
  // explique por que a chave saiu do cliente não pode reprovar o teste.
  const envAccess =
    /(?:import\.meta\.env|process\.env)\s*(?:\?\.)?\s*(?:\.\s*|\[\s*['"`])(VITE_GOOGLE_AI_KEY|VITE_GEMINI_API_KEY|GEMINI_API_KEY|API_KEY)/;
  const offenders = sourceFiles.filter((file) => envAccess.test(repoFile(file)));
  assert.deepEqual(offenders, [], 'Chave de IA não pode ser lida no cliente.');
});

test('vite não injeta a chave do Gemini no bundle', () => {
  const config = repoFile('vite.config.ts');
  // `define` substitui o identificador literalmente no código servido.
  assert.ok(
    !/'process\.env\.(API_KEY|GEMINI_API_KEY)':\s*JSON\.stringify\(env\./.test(config),
    'vite.config.ts não pode injetar a chave real no bundle.',
  );
});

test('o backend recusa operar sem chave, em vez de cair num default', () => {
  const backend = repoFile('functions/src/ai/callables.ts');
  assert.ok(
    backend.includes('process.env.GOOGLE_AI_API_KEY'),
    'A chave precisa vir do ambiente do backend.',
  );
  assert.ok(
    !/GOOGLE_AI_API_KEY\s*\|\|\s*['"]/.test(backend),
    'Não pode existir chave padrão embutida no código.',
  );
});

test('nenhum segredo real aparece em teste, fixture ou ambiente versionado', () => {
  const tracked = gitFiles(
    'tests/**', 'e2e/**', 'functions/src/**', '*.json', '*.ts',
  );
  // Formato de chave do Google: AIza seguido de 35 caracteres.
  const googleKey = /AIza[0-9A-Za-z_-]{35}/;
  const offenders = tracked.filter((file) => {
    try {
      return googleKey.test(repoFile(file));
    } catch {
      return false;
    }
  });
  assert.deepEqual(offenders, [], 'Segredo real encontrado em arquivo versionado.');
});
