import path from 'path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import {
  ErroAmbiente,
  MARCADOR_BUILD,
  PASTA_ENV_VAZIA,
  carregarConfiguracao,
  conferirPastaEnvVazia,
  lerPortasEmulador,
  conexaoDoEmulador,
  planoProxy,
  resolverPerfil,
  variaveisViteDoProcesso,
} from './tools/ambiente/contrato.mjs';

/*
 * P6-A (PR-PLAT-01, PR-AUTH-04): o perfil decide tudo o que o bundle conhece do ambiente.
 *
 * - `FENIX_PERFIL` (local, e2e, verificacao, release) é obrigatório; sem ele, ou com um perfil desconhecido, o Vite
 *   não roda. Os scripts do `package.json` passam por `tools/ambiente/*.mjs`, que o definem.
 * - A configuração web do Firebase vem de `config/ambientes.json` pelo `define` (`__FENIX_CONFIG_WEB__`), nunca do
 *   ambiente da estação: o `envDir` aponta para uma pasta sem `.env*`, e qualquer `VITE_*` no shell é recusada.
 * - Os módulos de Emulator e de login E2E só entram nos perfis `local` e `e2e`, por alias. Nos outros, o alias aponta
 *   para um módulo vazio, e o código, as credenciais e os marcadores de teste não chegam ao bundle (a varredura
 *   `tools/seguranca/varrer-bundle.mjs` confere).
 *
 * P5-GATE-FINAL (PLAT-10), mantido: a configuração não carrega o ambiente nem muda o prefixo das variáveis públicas; o
 * cliente não lê nenhuma `VITE_*`, e a guarda
 * `tests/unit/ai-backend-only.test.ts` confere o `define` efetivo de cada perfil.
 */
const marcadorDoBuild = (plano: ReturnType<typeof resolverPerfil>): Plugin => ({
  name: 'fenixgran-marcador-do-build',
  apply: 'build',
  generateBundle() {
    const commit = process.env.FENIX_BUILD_COMMIT ?? null;
    const arvore = process.env.FENIX_BUILD_ARVORE ?? null;
    if (plano.perfil === 'release' && (!commit || !arvore)) {
      throw new ErroAmbiente(['build de release só por `npm run build:release` (commit e árvore da origem são obrigatórios).']);
    }
    this.emitFile({
      type: 'asset',
      fileName: MARCADOR_BUILD,
      source: `${JSON.stringify({
        formato: 1,
        perfil: plano.perfil,
        ambiente: plano.ambiente,
        projectId: plano.projectId,
        publicavel: plano.publicavel,
        emuladores: plano.emuladores,
        loginE2E: plano.loginE2E,
        appCheck: plano.appCheck !== null,
        origem: { commit, arvore, alteracoesLocais: process.env.FENIX_BUILD_SUJO !== 'nao' },
      }, null, 2)}\n`,
    });
  },
});

export default defineConfig(({ command, isPreview }) => {
  const comando = isPreview ? 'preview' : command;
  const proibidas = variaveisViteDoProcesso(process.env);
  if (proibidas.length > 0) {
    throw new ErroAmbiente([
      `variáveis VITE_* no ambiente do processo não são aceitas (${proibidas.join(', ')}): o perfil define a configuração.`,
    ]);
  }
  const pastaEnv = conferirPastaEnvVazia();
  if (pastaEnv.length > 0) throw new ErroAmbiente(pastaEnv);
  const plano = resolverPerfil(
    { perfil: process.env.FENIX_PERFIL, comando },
    carregarConfiguracao(),
  );
  const portasEmulador = lerPortasEmulador();
  const proxy = planoProxy(plano, portasEmulador) ?? undefined;
  const modulo = (real: string, vazio: string) => path.resolve(__dirname, plano.emuladores ? real : vazio);
  return {
      envDir: path.resolve(__dirname, PASTA_ENV_VAZIA),
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy,
      },
      preview: {
        proxy,
      },
      plugins: [react(), marcadorDoBuild(plano)],
      define: {
        // A chave do Gemini NÃO é mais injetada no bundle. `define` substitui
        // o identificador no código servido ao navegador, o que tornava a
        // credencial legível para qualquer visitante. A inferência passou a
        // ser callable de backend, onde a chave vive em variável de ambiente.
        'process.env.API_KEY': JSON.stringify(''),
        'process.env.GEMINI_API_KEY': JSON.stringify(''),
        // P6-A: o perfil e a configuração web pública dele (config/ambientes.json), nunca o ambiente da estação.
        __FENIX_PERFIL__: JSON.stringify(plano.perfil),
        __FENIX_CONFIG_WEB__: JSON.stringify(plano.web),
        __FENIX_APP_CHECK__: JSON.stringify(plano.appCheck),
        __FENIX_CONEXAO_EMULADOR__: JSON.stringify(conexaoDoEmulador(plano, portasEmulador)),
      },
      build: {
        outDir: plano.saida ?? 'dist-sem-perfil',
        emptyOutDir: true,
        /*
         * Divisão explícita de vendors.
         *
         * O bundle saía num único chunk acima de 500 kB, e o passo
         * `rendering chunks` do Rollup segurava a árvore inteira em memória:
         * o build era morto por falta de memória em máquinas de 8 GB e o
         * renderer do Playwright estourava ao carregar a página, que é a
         * causa real do flake de E2E registrado como INV-P2-044.
         *
         * O agrupamento segue as bibliotecas que dominam o peso e mudam em
         * ritmos diferentes do produto — o que também melhora o cache do
         * navegador entre releases.
         */
        chunkSizeWarningLimit: 900,
        rollupOptions: {
          output: {
            manualChunks: {
              'vendor-react': ['react', 'react-dom'],
              'vendor-firebase': [
                'firebase/app',
                'firebase/auth',
                'firebase/firestore',
                'firebase/functions',
              ],
              'vendor-charts': ['recharts'],
              'vendor-motion': ['framer-motion'],
              /*
               * Os pacotes de ícones **não** entram em `manualChunks`.
               *
               * Agrupá-los força a inclusão integral e anula o tree-shaking;
               * eles são importados dinamicamente por `Icons.tsx` e o Rollup
               * já os separa em chunks próprios, fora do carregamento inicial.
               */
              'vendor-query': ['@tanstack/react-query'],
            },
          },
        },
      },
      resolve: {
  alias: {
    '@fenix/emuladores': modulo('src/lib/ambiente/emuladores.ts', 'src/lib/ambiente/emuladores.vazio.ts'),
    '@fenix/app-check': path.resolve(
      __dirname,
      plano.appCheck ? 'src/lib/ambiente/appCheck.ts' : 'src/lib/ambiente/appCheck.vazio.ts',
    ),
    '@fenix/login-e2e': path.resolve(
      __dirname,
      plano.loginE2E ? 'src/lib/ambiente/loginE2E.tsx' : 'src/lib/ambiente/loginE2E.vazio.ts',
    ),
    '@': path.resolve(__dirname, 'src'),
  }
}
    };
});
