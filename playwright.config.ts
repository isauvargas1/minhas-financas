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

/*
 * Relatório JSON de um grupo do E2E oficial (`tools/e2e/executar-em-grupos.mjs`, P5-F.1-R3.2): o executor confere, por ele, que
 * cada teste da lista rodou exatamente uma vez e passou. Fora do executor, nada muda.
 */
const shardReport = process.env.E2E_SHARD_REPORT;

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: {
    timeout: 12_000,
  },
  fullyParallel: false,
  workers: 1,
  /*
   * Sem nova tentativa automática, também no CI (P5-F.1-R3.2, RR-R31-07): uma falha intermitente é falha e fica no
   * histórico; repetir o teste até passar esconderia a causa. `.only` esquecido também é falha: nenhum teste some da
   * execução oficial.
   */
  retries: 0,
  forbidOnly: true,
  reporter: [
    ...(process.env.CI ? [['list'], ['html']] as const : [['list']] as const),
    ...(shardReport ? [['json', { outputFile: shardReport }]] as const : []),
  ],
  use: {
    baseURL,
    // Artefatos de depuração ficam no CI. Localmente, gravar vídeo de todas as
    // execuções para descartar no sucesso é justamente o que esgota a memória
    // do container e derruba o renderer, seguindo o mesmo critério já usado
    // acima para o `reporter`. Sem nova tentativa, o rastro é guardado na falha.
    trace: process.env.CI ? 'retain-on-failure' : 'off',
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
          /*
           * Pronto só quando o Emulator anuncia que todos os emuladores estão
           * de pé, o que acontece depois de registrar todas as Functions.
           * A UI (:4000) responde antes: medido em 2026-10-11, cerca de 7 s
           * antes de os callables existirem (404 do emulador de Functions),
           * e a primeira spec da suíte falhava nessa janela. Sem `url`: o
           * Playwright resolve `url` e `wait` em corrida, e a UI venceria.
           * Emuladores já de pé: `E2E_START_EMULATORS=false` (RUNBOOKS.md).
           */
          wait: { stdout: /All emulators ready!/ },
          timeout: 180_000,
          /*
           * Desligamento limpo (P5-F.1-R3.2, RR-R31-07). Sem isto, o Playwright encerra o grupo de processos com
           * SIGKILL, e o firebase-tools, que sobe o emulador do Firestore como processo destacado (`detached`), não
           * chega a desligá-lo: a JVM ficava órfã na porta 8080 depois de cada execução e o próximo Emulator não
           * subia. Com SIGTERM, o firebase-tools faz o desligamento limpo de todos os emuladores; o prazo só vale
           * para o encerramento e, vencido, o Playwright volta ao SIGKILL.
           */
          gracefulShutdown: { signal: 'SIGTERM' as const, timeout: 60_000 },
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