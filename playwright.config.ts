import { defineConfig, devices } from '@playwright/test';

const e2eHost = '127.0.0.1';
const e2ePort = process.env.E2E_PORT || '5173';
const baseURL = process.env.E2E_BASE_URL || `http://${e2eHost}:${e2ePort}`;
const shouldStartFirebaseEmulators = process.env.E2E_START_EMULATORS !== 'false';

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
          url: 'http://127.0.0.1:4000',
          reuseExistingServer: true,
          timeout: 180_000,
          stdout: 'pipe' as const,
          stderr: 'pipe' as const,
        },
      ]
      : []),
    {

      command: `npm run dev -- --host ${e2eHost} --port ${e2ePort} --strictPort`,
      env: webServerEnv,
      url: baseURL,
      reuseExistingServer: false,
      timeout: 120_000,
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