import { defineConfig, devices } from '@playwright/test';

const e2eHost = '127.0.0.1';
const e2ePort = process.env.E2E_PORT || '5173';
const baseURL = process.env.E2E_BASE_URL || `http://${e2eHost}:${e2ePort}`;
const shouldStartFirebaseEmulators = process.env.E2E_START_EMULATORS !== 'false';

/**
 * Servidor do frontend no E2E (INV-P2-044).
 *
 * O padrão é o **build de produção** servido por `vite preview`, e não o
 * servidor de desenvolvimento. Em modo dev o Vite entrega o grafo inteiro de
 * módulos sem empacotar — mais de 12.000 arquivos, dominados pelas três
 * bibliotecas de ícones que o produto resolve por nome em tempo de execução.
 * O renderer do Chromium estourava a memória carregando isso e a página
 * morria com "Page crashed" **antes de qualquer asserção**, de forma
 * dependente da ordem e da carga da máquina — exatamente o flake que a
 * auditoria registrou.
 *
 * Servir o build também aumenta a fidelidade: o E2E passa a exercitar os
 * mesmos chunks que vão para produção. `E2E_SERVER=dev` mantém o servidor de
 * desenvolvimento para depuração local com HMR.
 */
const usePreviewServer = process.env.E2E_SERVER !== 'dev';

const webServerEnv = {
  ...process.env,
  VITE_E2E_MODE: 'true',
  VITE_USE_FIREBASE_EMULATORS: 'true',
  VITE_FIREBASE_API_KEY: 'e2e-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'localhost',
  VITE_FIREBASE_PROJECT_ID: 'minhas-financas-local',
  VITE_FIREBASE_STORAGE_BUCKET: 'minhas-financas-local.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '000000000000',
  VITE_FIREBASE_APP_ID: '1:000000000000:web:e2e',
};

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: {
    timeout: 12_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['list'], ['html']] : [['list']],
  use: {
    baseURL,
    // Artefatos de depuração ficam no CI. Localmente, gravar vídeo de todas as
    // execuções para descartar no sucesso é justamente o que esgota a memória
    // do container e derruba o renderer, seguindo o mesmo critério já usado
    // acima para `retries` e `reporter`.
    trace: process.env.CI ? 'on-first-retry' : 'off',
    screenshot: process.env.CI ? 'only-on-failure' : 'off',
    video: process.env.CI ? 'retain-on-failure' : 'off',
    launchOptions: {
      // `/dev/shm` tem 64 MB no container padrão, e o renderer do Chromium
      // estoura esse limite ao carregar o bundle, derrubando a página com
      // "Target crashed" antes de qualquer asserção. Este é o contorno
      // documentado: usar arquivos temporários em disco no lugar de memória
      // compartilhada.
      args: ['--disable-dev-shm-usage'],
    },
  },
  webServer: [
    ...(shouldStartFirebaseEmulators
      ? [
        {
          command:
            'npm --prefix functions run build && firebase emulators:start --only auth,firestore,functions --project minhas-financas-local',
          /*
           * Teto de heap do emulador do Firestore.
           *
           * O emulador é uma JVM que guarda tudo em memória e cresce com o que
           * a suíte semeia. Sem teto, ele reservava heap suficiente para deixar
           * o contêiner com menos de 900 MB livres, e o renderer do Chromium
           * morria com "Target crashed" em pontos diferentes a cada execução —
           * uma falha de recurso que se disfarçava de flakiness do produto.
           */
          env: {...process.env, JAVA_TOOL_OPTIONS: '-Xmx1024m'},
          url: 'http://127.0.0.1:4000',
          reuseExistingServer: true,
          timeout: 180_000,
          stdout: 'pipe' as const,
          stderr: 'pipe' as const,
        },
      ]
      : []),
    {
      /*
       * O build **não** roda aqui: os emuladores já estão de pé neste ponto e
       * o Rollup era morto por falta de memória ao competir com a JVM do
       * Firestore. `npm run test:e2e` constrói antes de invocar o Playwright.
       */
      command: usePreviewServer
        ? `npx vite preview --host ${e2eHost} --port ${e2ePort} --strictPort`
        : `npm run dev -- --host ${e2eHost} --port ${e2ePort} --strictPort`,
      env: webServerEnv,
      url: baseURL,
      reuseExistingServer: false,
      timeout: 300_000,
      stdout: 'pipe' as const,
      stderr: 'pipe' as const,
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
});