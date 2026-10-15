import { expect, test } from '@playwright/test';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type Plugin, type Rollup } from 'vite';

/*
 * P5-E1.1 — regressão determinística da segunda causa da falha do celular
 * (`docs/production/evidence/p5e11/diagnostico-notificacoes.md`, §4.1).
 *
 * No framer-motion 10.16, o AnimatePresence tira do DOM os itens que terminaram
 * de sair com um re-render agendado por um contador capturado num render
 * anterior. Um aviso que começa a sair logo depois de outro terminar (antes
 * desse re-render) ficava preso no DOM, invisível e clicável, até o painel
 * re-renderizar por outro motivo. O painel corrige isso re-renderizando a cada
 * `onExitComplete`.
 *
 * Aqui o NotificationsPanel real é empacotado (Vite, sem o app) com duas
 * trocas, só neste bundle: os ícones viram vazios e o AnimatePresence avisa o
 * teste logo depois do `onExitComplete` do painel. O teste tira o aviso "a" e,
 * exatamente nesse instante, tira o "b"; o "b" precisa sair do DOM. Sem a
 * correção do painel, o "b" fica preso em todas as rodadas.
 */

const here = dirname(fileURLToPath(import.meta.url));
const SUPPORT = join(here, 'support');
const PROBE = join(SUPPORT, 'framerMotionExitProbe.ts');
const ICONS_STUB = join(SUPPORT, 'iconsStub.tsx');

const probePlugin: Plugin = {
  name: 'p5e11-exit-probe',
  enforce: 'pre',
  resolveId(source, importer) {
    if (source === 'framer-motion' && importer !== PROBE) return PROBE;
    if (/(^|\/)Icons\.tsx$/.test(source) && importer?.endsWith('NotificationsPanel.tsx')) return ICONS_STUB;
    return null;
  },
};

const bundleHarness = async (): Promise<string> => {
  const result = await build({
    configFile: false,
    root: resolve(here, '..'),
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    esbuild: { jsx: 'automatic' },
    plugins: [probePlugin],
    build: {
      write: false,
      minify: false,
      lib: { entry: join(SUPPORT, 'notificationsPanelExitHarness.tsx'), formats: ['iife'], name: 'P5E11ExitHarness' },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]) as Rollup.RollupOutput[];
  const chunk = outputs[0].output.find((item): item is Rollup.OutputChunk => item.type === 'chunk');
  if (!chunk) throw new Error('O bundle do teste não gerou código.');
  return chunk.code;
};

type RaceWindow = Window & {
  __removeNotice?: (id: string) => void;
  __afterExitComplete?: (() => void) | null;
};

test.describe('P5-E1.1 — aviso que começa a sair logo depois de outro terminar', () => {
  let bundle = '';

  test.beforeAll(async () => {
    bundle = await bundleHarness();
  });

  test('sai do DOM: o NotificationsPanel re-renderiza a cada onExitComplete (framer-motion 10.16)', async ({ page }) => {
    for (let round = 1; round <= 10; round += 1) {
      await page.setContent('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>');
      await page.addScriptTag({ content: bundle });
      const titles = page.getByRole('heading', { level: 4 });
      await expect(titles).toHaveText(['Aviso a', 'Aviso b', 'Aviso c']);
      // Tira "a"; no instante em que a saída dele termina, antes do re-render
      // adiado do AnimatePresence, tira "b".
      await page.evaluate(() => new Promise<void>((done) => {
        const race = window as RaceWindow;
        race.__afterExitComplete = () => {
          race.__removeNotice?.('b');
          done();
        };
        race.__removeNotice?.('a');
      }));
      await expect(titles, `rodada ${round}: "b" saiu do DOM`).toHaveText(['Aviso c']);
    }
  });
});
