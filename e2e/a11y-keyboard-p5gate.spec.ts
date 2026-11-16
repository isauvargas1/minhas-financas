import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Locator, type Page } from '@playwright/test';
import { build, type Plugin, type Rollup } from 'vite';

import { axeViolations } from './support/axe';
import { clearEmulatorData, adminSdk, seedOwnedWorkspace } from './support/workspaceSeed';

/**
 * P5-GATE-FINAL — acessibilidade do painel de notificações e do seletor de período dos Relatórios.
 *
 * - PTBR-02: contraste de "Carregar mais" e "Tentar novamente" (e "Carregando…") no tema escuro, medido no
 *   painel real com o CSS real do app, nos estados normal, hover, foco e pressionado, para as cores do espaço
 *   PF e PJ e a do tema escuro padrão; também no claro (sem mudança). O anel de foco é medido contra o fundo.
 *   Os demais textos na cor do espaço do mesmo painel (chip, "Marcar exibidas como lidas", rótulo de ação),
 *   com o mesmo débito (PTBR-06), entram na mesma medição.
 * - PTBR-03: cada aviso tem um botão nativo (o título), alcançável por Tab, com foco visível, e Enter ou Espaço
 *   fazem o mesmo que o clique; ordem de Tab lógica; um acionamento por tecla.
 * - PTBR-04 (app inteiro): Escape fecha o painel e o foco volta ao sino; o X também; com o diálogo de exclusão
 *   aberto, o Escape fecha só o diálogo.
 * - PTBR-05 (app inteiro): Enter e Espaço abrem o seletor de período uma vez; Tab percorre os períodos; Enter
 *   escolhe (um pedido do relatório); Escape fecha e devolve o foco; sair pelo Tab fecha.
 * - 2ª revisão (PTBR2-01 a PTBR2-03): o anel de foco de "Arquivar para mim" e "Excluir para mim" no painel; no
 *   seletor de período real (página própria, CSS real), o texto do botão e das opções e o anel de foco do botão e das
 *   opções, inclusive a opção selecionada (o foco dela era igual à seleção), em normal, hover, foco e pressionado,
 *   nos dois temas e nas três cores. Cada valor é conferido sem parar no primeiro (`expect.soft`), para que a
 *   medição da árvore anterior registre todos os valores "antes".
 *
 * As medições saem no log (`CONTRASTE-PTBR-02`, `CONTRASTE-PTBR2`) e nas anotações do relatório.
 */

test.use({ timezoneId: 'America/Sao_Paulo', locale: 'pt-BR' });

const here = dirname(fileURLToPath(import.meta.url));
const SUPPORT = join(here, 'support');
const ICONS_STUB = join(SUPPORT, 'iconsStub.tsx');
const PASSWORD = 'e2e-password-123456';

// ------------------------------------------------------------------ painel real empacotado

const iconsPlugin: Plugin = {
  name: 'p5gate-a11y-icons',
  enforce: 'pre',
  resolveId(source, importer) {
    if (/(^|\/)Icons\.tsx$/.test(source) && /(NotificationsPanel|ReportPeriodSelect)\.tsx$/.test(importer ?? '')) return ICONS_STUB;
    return null;
  },
};

const bundleHarness = async (entry = 'notificationsPanelA11yHarness.tsx'): Promise<{ code: string; css: string }> => {
  const result = await build({
    configFile: false,
    root: resolve(here, '..'),
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    esbuild: { jsx: 'automatic' },
    plugins: [iconsPlugin],
    build: {
      write: false,
      minify: false,
      cssCodeSplit: false,
      lib: { entry: join(SUPPORT, entry), formats: ['iife'], name: 'P5GateA11yHarness' },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]) as Rollup.RollupOutput[];
  const chunk = outputs[0].output.find((item): item is Rollup.OutputChunk => item.type === 'chunk');
  const css = outputs[0].output.find((item): item is Rollup.OutputAsset => item.type === 'asset' && item.fileName.endsWith('.css'));
  if (!chunk || !css) throw new Error(`O bundle do teste (${entry}) não gerou o código e o CSS.`);
  return { code: chunk.code, css: String(css.source) };
};

const THEMES = {
  dark: { bg: '#0B1120', surface: '#1E293B', text: '#f3f4f6', textSecondary: '#9ca3af', border: '#374151' },
  light: { bg: '#f9fafb', surface: '#ffffff', text: '#1f2937', textSecondary: '#6b7280', border: '#e5e7eb' },
} as const;
type Scheme = keyof typeof THEMES;
/**
 * Cores do espaço: a padrão do PF e do PJ (WorkspaceContext) nos dois temas e, só no escuro, a do tema escuro
 * padrão antes de o espaço carregar (`defaultDarkTheme`; no claro o tema padrão usa a do PF).
 */
const PRIMARIES = { 'espaço PF': '#4f46e5', 'espaço PJ': '#0f766e', 'tema escuro padrão': '#6366f1' } as const;
const primariesFor = (scheme: 'dark' | 'light') =>
  Object.entries(PRIMARIES).filter(([name]) => scheme === 'dark' || name !== 'tema escuro padrão');

const items = [
  { id: 'n1', type: 'cartaoCredito', title: 'Fatura fechada', message: 'A fatura do cartão fechou.', createdAt: new Date(Date.now() - 120_000).toISOString(), status: 'unread', actionRoute: 'cards', actionLabel: 'Ver cartões' },
  { id: 'n2', type: 'sistema', title: 'Aviso sem destino', message: 'Um aviso que só se marca como lido.', createdAt: new Date(Date.now() - 600_000).toISOString(), status: 'unread' },
];

type HarnessWindow = Window & { __setPanel?: (state: Record<string, unknown>) => void; __calls?: string[] };

const openHarness = async (page: Page, harness: { code: string; css: string; waitFor?: 'panel' | 'period' }, scheme: Scheme, primary: string) => {
  const theme = THEMES[scheme];
  await page.setContent(`<!doctype html><html lang="pt-BR" class="${scheme === 'dark' ? 'dark' : ''}"><head><meta charset="utf-8"><style>:root{--color-primary:${primary};--color-bg:${theme.bg};--color-surface:${theme.surface};--color-text:${theme.text};--color-text-secondary:${theme.textSecondary};--color-border:${theme.border};--radius:12px}</style></head><body><div id="root"></div></body></html>`);
  await page.addStyleTag({ content: harness.css });
  await page.addScriptTag({ content: harness.code });
  if (harness.waitFor === 'panel') await page.waitForFunction(() => typeof (window as HarnessWindow).__setPanel === 'function');
  else await page.getByRole('button', { name: /^Período do relatório: / }).waitFor();
};

const setPanel = (page: Page, state: Record<string, unknown>) =>
  page.evaluate((next) => (window as HarnessWindow).__setPanel?.(next), state);

const calls = (page: Page) => page.evaluate(() => [...((window as HarnessWindow).__calls ?? [])]);
const resetCalls = (page: Page) => page.evaluate(() => { (window as HarnessWindow).__calls = []; });

/** Espera as animações de entrada (opacidade e deslocamento do painel e dos avisos) terminarem acima do elemento. */
const settle = async (locator: Locator) => {
  await expect.poll(() => locator.evaluate((element) => {
    let opacity = 1;
    for (let node = element.parentElement; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
    return opacity;
  }), { timeout: 10_000 }).toBe(1);
  await locator.page().evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
};

/**
 * Contraste WCAG do texto do elemento contra o fundo efetivo (camadas compostas até a página) e, com foco, do
 * anel (`box-shadow` de 2 px) contra o mesmo fundo. Aceita `rgb()`, `rgba()` e `color(srgb …)`.
 */
const measure = (locator: Locator) => locator.evaluate((element) => {
  const parse = (value: string): [number, number, number, number] | null => {
    const srgb = /color\(srgb\s+([\d.e-]+)\s+([\d.e-]+)\s+([\d.e-]+)(?:\s*\/\s*([\d.e-]+%?))?\)/.exec(value);
    if (srgb) {
      const alpha = srgb[4] === undefined ? 1 : srgb[4].endsWith('%') ? Number(srgb[4].slice(0, -1)) / 100 : Number(srgb[4]);
      return [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255, alpha];
    }
    const rgb = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/.exec(value);
    if (rgb) {
      const alpha = rgb[4] === undefined ? 1 : rgb[4].endsWith('%') ? Number(rgb[4].slice(0, -1)) / 100 : Number(rgb[4]);
      return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), alpha];
    }
    return null;
  };
  const over = (top: number[], bottom: number[]) => {
    const alpha = top[3] + bottom[3] * (1 - top[3]);
    return [0, 1, 2].map((index) => (top[index] * top[3] + bottom[index] * bottom[3] * (1 - top[3])) / (alpha || 1)).concat([alpha]);
  };
  const layers: number[][] = [];
  for (let node: Element | null = element; node; node = node.parentElement) {
    const color = parse(getComputedStyle(node).backgroundColor);
    if (color && color[3] > 0) layers.push(color);
  }
  let background = [255, 255, 255, 1];
  for (const layer of layers.reverse()) background = over(layer, background);
  const luminance = (rgb: number[]) => {
    const [r, g, b] = rgb.slice(0, 3).map((channel) => {
      const c = channel / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: number[], b: number[]) => {
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (high + 0.05) / (low + 0.05);
  };
  const style = getComputedStyle(element);
  let opacity = 1;
  for (let node: Element | null = element; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
  const text = parse(style.color) ?? [0, 0, 0, 1];
  const shown = over([text[0], text[1], text[2], text[3] * opacity], background);
  // O anel é a sombra sólida (0 0 0 N px) mais espessa; com `ring-offset`, a de 2 px por baixo dele é o afastamento,
  // e o anel é medido contra ele (é a cor que fica ao lado do anel). Sem afastamento, contra o fundo.
  const rings = [...style.boxShadow.matchAll(/(color\(srgb[^)]*\)|rgba?\([^)]*\))\s+0px\s+0px\s+0px\s+([\d.]+)px/g)]
    .map((match) => ({ color: parse(match[1]), spread: Number(match[2]) }))
    .filter((shadow): shadow is { color: [number, number, number, number]; spread: number } => !!shadow.color && shadow.color[3] > 0 && shadow.spread >= 2)
    .sort((a, b) => b.spread - a.spread);
  const ringColor = rings[0]?.color ?? null;
  const behindRing = rings[1] ? over(rings[1].color, background) : background;
  return {
    text: Math.round(ratio(shown, background) * 100) / 100,
    ring: ringColor ? Math.round(ratio(over(ringColor, behindRing), behindRing) * 100) / 100 : null,
    color: style.color,
    background: `rgb(${background.slice(0, 3).map(Math.round).join(', ')})`,
  };
});

/**
 * Tab até o elemento (o foco do teclado é o que liga `:focus-visible`). Na página do painel, começa do início do
 * documento; no app, do foco atual (o sino, logo antes do painel na ordem do documento).
 */
const tabTo = async (page: Page, locator: Locator, options: { fromStart?: boolean; max?: number } = {}) => {
  if (options.fromStart ?? true) await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let step = 0; step < (options.max ?? 40); step += 1) {
    await page.keyboard.press('Tab');
    if (await locator.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error('o elemento não recebeu foco pelo Tab');
};

const focusedName = (page: Page) => page.evaluate(() => {
  const element = document.activeElement as HTMLElement | null;
  return element?.getAttribute('aria-label') ?? element?.textContent?.trim() ?? '';
});

test.describe('P5-GATE-FINAL — painel de notificações real (CSS do app)', () => {
  let harness: { code: string; css: string; waitFor?: 'panel' | 'period' } = { code: '', css: '' };
  test.beforeAll(async () => {
    harness = { ...(await bundleHarness()), waitFor: 'panel' as const };
  });

  test('PTBR-02: "Carregar mais", "Carregando…" e "Tentar novamente" com contraste AA no escuro e no claro, em normal, hover, foco e pressionado', async ({ page }) => {
    test.setTimeout(240_000);
    const rows: Array<Record<string, unknown>> = [];
    for (const scheme of ['dark', 'light'] as const) {
      for (const [primaryName, primary] of primariesFor(scheme)) {
        await openHarness(page, harness, scheme, primary);
        const control = async (state: Record<string, unknown>, name: string, interactive: boolean) => {
          await setPanel(page, state);
          const target = page.getByRole('button', { name, exact: true });
          await expect(target).toBeVisible();
          const record = async (stateName: string) => {
            await settle(target);
            const measured = await measure(target);
            rows.push({ tema: scheme, cor: primaryName, controle: name, estado: stateName, ...measured });
            return measured;
          };
          const normal = await record('normal');
          if (!interactive) {
            // Botão desativado (carregando): fora do critério 1.4.3 (componente inativo); medido e registrado.
            await expect(target).toBeDisabled();
            return;
          }
          expect(normal.text, `${scheme}/${primaryName}/${name}: normal ${JSON.stringify(normal)}`).toBeGreaterThanOrEqual(4.5);
          await target.hover();
          expect((await record('hover')).text, `${scheme}/${primaryName}/${name}: hover`).toBeGreaterThanOrEqual(4.5);
          await page.mouse.move(0, 0);
          await tabTo(page, target);
          const focused = await record('foco (teclado)');
          expect(focused.text, `${scheme}/${primaryName}/${name}: foco`).toBeGreaterThanOrEqual(4.5);
          expect(focused.ring, `${scheme}/${primaryName}/${name}: anel de foco visível`).not.toBeNull();
          expect(focused.ring ?? 0, `${scheme}/${primaryName}/${name}: anel de foco (1.4.11)`).toBeGreaterThanOrEqual(3);
          const box = await target.boundingBox();
          if (!box) throw new Error('sem caixa');
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.down();
          expect((await record('pressionado')).text, `${scheme}/${primaryName}/${name}: pressionado`).toBeGreaterThanOrEqual(4.5);
          // Solta fora do botão: o clique não vai para ele.
          await page.mouse.move(2, 2);
          await page.mouse.up();
        };
        await control({ status: 'ready', notifications: items, hasMore: true, isLoadingMore: false }, 'Carregar mais', true);
        await control({ status: 'ready', notifications: items, hasMore: true, isLoadingMore: true }, 'Carregando…', false);
        await control({ status: 'error', notifications: [], hasMore: false, isLoadingMore: false }, 'Tentar novamente', true);
        // O mesmo débito no mesmo painel (PTBR-06): "Marcar exibidas como lidas", chip e rótulo de ação.
        await setPanel(page, { status: 'ready', notifications: items, hasMore: false, isLoadingMore: false });
        for (const [name, locator] of [
          ['Marcar exibidas como lidas', page.getByRole('button', { name: 'Marcar exibidas como lidas' })],
          ['chip de não lidas', page.locator('h3 + span')],
          ['rótulo de ação', page.getByText('Ver cartões →')],
        ] as const) {
          await settle(locator);
          const measured = await measure(locator);
          rows.push({ tema: scheme, cor: primaryName, controle: name, estado: 'normal', ...measured });
          expect(measured.text, `${scheme}/${primaryName}/${name}`).toBeGreaterThanOrEqual(4.5);
        }
        // axe (WCAG 2.0/2.1 A e AA) no painel pronto e no de erro, sem exceção nenhuma.
        await page.mouse.move(0, 0);
        expect(await axeViolations(page, '#root'), `axe: ${scheme}/${primaryName}, pronto`).toEqual([]);
        await setPanel(page, { status: 'error', notifications: [] });
        expect(await axeViolations(page, '#root'), `axe: ${scheme}/${primaryName}, erro`).toEqual([]);
      }
    }
    console.log(`CONTRASTE-PTBR-02 ${JSON.stringify(rows)}`);
    test.info().annotations.push({ type: 'contraste-medido', description: JSON.stringify(rows) });
  });

  test('PTBR-03: cada aviso é um botão nativo alcançável por Tab, com foco visível, e Enter ou Espaço agem uma vez', async ({ page }) => {
    for (const scheme of ['light', 'dark'] as const) {
      await openHarness(page, harness, scheme, PRIMARIES['espaço PF']);
      await setPanel(page, { status: 'ready', notifications: items, hasMore: true, isLoadingMore: false });
      // Ordem lógica: cabeçalho, cada aviso (título e as ações dele) e, no fim, "Carregar mais".
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      const order: string[] = [];
      for (let step = 0; step < 9; step += 1) {
        await page.keyboard.press('Tab');
        order.push(await focusedName(page));
      }
      expect(order).toEqual([
        'Marcar exibidas como lidas', 'Fechar notificações',
        'Fatura fechada', 'Excluir para mim: Fatura fechada', 'Arquivar para mim: Fatura fechada',
        'Aviso sem destino', 'Excluir para mim: Aviso sem destino', 'Arquivar para mim: Aviso sem destino',
        'Carregar mais',
      ]);
      const first = page.getByRole('button', { name: 'Fatura fechada', exact: true });
      await expect(first).toHaveAccessibleDescription('A fatura do cartão fechou.');
      await tabTo(page, first);
      await settle(first);
      const focused = await measure(first);
      expect(focused.ring, 'anel de foco no título').not.toBeNull();
      expect(focused.ring ?? 0).toBeGreaterThanOrEqual(3);
      // Com o foco no aviso, as ações dele aparecem (telas com mouse).
      await expect.poll(() => page.getByRole('button', { name: 'Arquivar para mim: Fatura fechada' })
        .evaluate((element) => Number(getComputedStyle(element.parentElement as Element).opacity))).toBe(1);

      await resetCalls(page);
      await page.keyboard.press('Enter');
      expect(await calls(page)).toEqual(['markAsRead:n1', 'navigate:cards', 'close']);
      await resetCalls(page);
      await tabTo(page, page.getByRole('button', { name: 'Aviso sem destino', exact: true }));
      await page.keyboard.press('Space');
      expect(await calls(page)).toEqual(['markAsRead:n2']);
      // As ações do aviso não acionam o aviso.
      await resetCalls(page);
      await tabTo(page, page.getByRole('button', { name: 'Arquivar para mim: Aviso sem destino' }));
      await page.keyboard.press('Enter');
      expect(await calls(page)).toEqual(['archive:n2']);
      // O clique no corpo do aviso continua valendo, como antes.
      await resetCalls(page);
      await page.getByText('Um aviso que só se marca como lido.').click();
      expect(await calls(page)).toEqual(['markAsRead:n2']);
    }
  });

  test('PTBR2-01: o anel de foco de "Arquivar para mim" e "Excluir para mim" tem contraste de 3:1 nos dois temas', async ({ page }) => {
    test.setTimeout(240_000);
    const rows: Array<Record<string, unknown>> = [];
    for (const scheme of ['dark', 'light'] as const) {
      for (const [primaryName, primary] of primariesFor(scheme)) {
        await openHarness(page, harness, scheme, primary);
        await setPanel(page, { status: 'ready', notifications: items, hasMore: false, isLoadingMore: false });
        for (const name of ['Arquivar para mim: Fatura fechada', 'Excluir para mim: Fatura fechada']) {
          const target = page.getByRole('button', { name, exact: true });
          await page.mouse.move(0, 0);
          await tabTo(page, target);
          await settle(target);
          const measured = await measure(target);
          rows.push({ tema: scheme, cor: primaryName, controle: name.split(':')[0], estado: 'foco (teclado)', ...measured });
          expect.soft(measured.ring, `${scheme}/${primaryName}/${name}: anel visível`).not.toBeNull();
          expect.soft(measured.ring ?? 0, `${scheme}/${primaryName}/${name}: anel (1.4.11)`).toBeGreaterThanOrEqual(3);
        }
      }
    }
    console.log(`CONTRASTE-PTBR2 ${JSON.stringify(rows)}`);
    test.info().annotations.push({ type: 'contraste-medido', description: JSON.stringify(rows) });
  });
});

test.describe('P5-GATE-FINAL — seletor de período real (CSS do app)', () => {
  let harness: { code: string; css: string; waitFor?: 'panel' | 'period' } = { code: '', css: '' };
  test.beforeAll(async () => {
    harness = { ...(await bundleHarness('reportPeriodSelectA11yHarness.tsx')), waitFor: 'period' as const };
  });

  test('PTBR2-02 e PTBR2-03: foco visível em toda opção (inclusive a selecionada) e contraste AA no escuro e no claro, em normal, hover, foco e pressionado', async ({ page }) => {
    test.setTimeout(300_000);
    const rows: Array<Record<string, unknown>> = [];
    const trigger = page.getByRole('button', { name: /^Período do relatório: / });
    const group = page.getByRole('group', { name: 'Períodos do relatório' });
    for (const scheme of ['dark', 'light'] as const) {
      for (const [primaryName, primary] of primariesFor(scheme)) {
        await openHarness(page, harness, scheme, primary);
        const label = (control: string, state: string) => `${scheme}/${primaryName}/${control}: ${state}`;
        const record = async (locator: Locator, control: string, state: string) => {
          await settle(locator);
          const measured = await measure(locator);
          rows.push({ tema: scheme, cor: primaryName, controle: control, estado: state, ...measured });
          return measured;
        };
        const press = async (locator: Locator, control: string) => {
          const box = await locator.boundingBox();
          if (!box) throw new Error('sem caixa');
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.down();
          expect.soft((await record(locator, control, 'pressionado')).text, label(control, 'pressionado')).toBeGreaterThanOrEqual(4.5);
          await page.mouse.move(2, 2);
          await page.mouse.up();
        };
        // O botão do seletor, fechado: normal, hover, foco pelo teclado e pressionado; aberto: o texto em destaque.
        expect.soft((await record(trigger, 'botão do seletor', 'normal')).text, label('botão', 'normal')).toBeGreaterThanOrEqual(4.5);
        await trigger.hover();
        expect.soft((await record(trigger, 'botão do seletor', 'hover')).text, label('botão', 'hover')).toBeGreaterThanOrEqual(4.5);
        await page.mouse.move(0, 0);
        await tabTo(page, trigger);
        const triggerFocus = await record(trigger, 'botão do seletor', 'foco (teclado)');
        expect.soft(triggerFocus.text, label('botão', 'foco')).toBeGreaterThanOrEqual(4.5);
        expect.soft(triggerFocus.ring, label('botão', 'anel visível')).not.toBeNull();
        expect.soft(triggerFocus.ring ?? 0, label('botão', 'anel (1.4.11)')).toBeGreaterThanOrEqual(3);
        await press(trigger, 'botão do seletor');
        await page.keyboard.press('Escape');
        await trigger.focus();
        await page.keyboard.press('Enter');
        await expect(group).toBeVisible();
        expect.soft((await record(trigger, 'botão do seletor', 'aberto')).text, label('botão', 'aberto')).toBeGreaterThanOrEqual(4.5);
        // As opções: a selecionada ("Últimos 30 dias", a padrão) e uma comum.
        for (const [control, name] of [['opção selecionada', 'Últimos 30 dias'], ['opção comum', 'Últimos 7 dias']] as const) {
          const option = group.getByRole('button', { name, exact: true });
          await page.mouse.move(0, 0);
          expect.soft((await record(option, control, 'normal')).text, label(control, 'normal')).toBeGreaterThanOrEqual(4.5);
          await tabTo(page, option, { fromStart: false, max: 10 });
          const focused = await record(option, control, 'foco (teclado)');
          expect.soft(focused.text, label(control, 'foco')).toBeGreaterThanOrEqual(4.5);
          expect.soft(focused.ring, label(control, 'foco visível (2.4.7)')).not.toBeNull();
          expect.soft(focused.ring ?? 0, label(control, 'anel (1.4.11)')).toBeGreaterThanOrEqual(3);
          await option.hover();
          expect.soft((await record(option, control, 'hover')).text, label(control, 'hover')).toBeGreaterThanOrEqual(4.5);
          await press(option, control);
          // Volta ao começo da lista para a próxima opção: fecha e reabre pelo teclado.
          await page.keyboard.press('Escape');
          await expect(group).toHaveCount(0);
          await page.keyboard.press('Enter');
          await expect(group).toBeVisible();
        }
        // axe (WCAG 2.0/2.1 A e AA) no seletor aberto, sem exceção.
        await page.mouse.move(0, 0);
        expect.soft(await axeViolations(page, '#root'), `axe: ${scheme}/${primaryName}`).toEqual([]);
        await page.keyboard.press('Escape');
      }
    }
    console.log(`CONTRASTE-PTBR2 ${JSON.stringify(rows)}`);
    test.info().annotations.push({ type: 'contraste-medido', description: JSON.stringify(rows) });
  });

  test('PTBR2-07: um clique de mouse numa opção escolhe o período mesmo depois de a lista ser aberta pelo teclado', async ({ page }) => {
    await openHarness(page, harness, 'light', PRIMARIES['espaço PF']);
    const trigger = page.getByRole('button', { name: /^Período do relatório: / });
    const group = page.getByRole('group', { name: 'Períodos do relatório' });
    await tabTo(page, trigger);
    await page.keyboard.press('Enter');
    await tabTo(page, group.getByRole('button', { name: 'Últimos 3 meses', exact: true }), { fromStart: false, max: 10 });
    // O mousedown numa opção não move o foco (nos navegadores em que o clique não foca o botão, a saída do foco
    // fecharia a lista antes do clique).
    const sevenDays = group.getByRole('button', { name: 'Últimos 7 dias', exact: true });
    const prevented = await sevenDays.evaluate((element) => {
      const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(prevented).toBe(true);
    await sevenDays.click();
    await expect(group).toHaveCount(0);
    await expect(trigger).toContainText('Últimos 7 dias');
  });
});

// ------------------------------------------------------------------ app inteiro (Emulator)

const nodeRequire = createRequire(import.meta.url);
const { buildNotificationDocument } = nodeRequire('../functions/lib/notifications/builder.js') as {
  buildNotificationDocument: (input: Record<string, unknown>) => Record<string, unknown>;
};

const OWNER = { uid: 'e2e-p5g-a11y-owner', email: 'e2e-p5g-a11y-owner@minhas-financas.local' };

const seedApp = async () => {
  await clearEmulatorData();
  const workspaceId = `e2e-p5g-a11y-${Date.now().toString(36)}`;
  await adminSdk().auth().createUser({ ...OWNER, password: PASSWORD, emailVerified: true });
  await seedOwnedWorkspace({ ...OWNER, workspaceId, name: 'Acessibilidade P5G', type: 'PF' });
  const batch = adminSdk().firestore().batch();
  [
    { id: 'p5g_goal', eventType: 'goal_achieved', type: 'success', link: 'goals', title: 'Meta concluída P5G', entity: { goalId: 'goal-p5g' }, age: 2 },
    { id: 'p5g_loan', eventType: 'loan_overdue', type: 'warning', link: 'loans', title: 'Empréstimo vencido P5G', entity: { loanId: 'loan-p5g' }, age: 5 },
  ].forEach((event) => {
    batch.create(adminSdk().firestore().doc(`workspaces/${workspaceId}/notifications/${event.id}`), buildNotificationDocument({
      id: event.id, workspaceId, eventType: event.eventType, title: event.title,
      message: `Evento ${event.id} registrado no workspace.`, type: event.type, link: event.link,
      createdAtMs: Date.now() - event.age * 60_000, entity: event.entity,
    }));
  });
  await batch.commit();
  return workspaceId;
};

const loginApp = async (page: Page) => {
  await page.goto(`/?e2eEmail=${encodeURIComponent(OWNER.email)}&e2ePassword=${PASSWORD}`);
  await page.getByTestId('e2e-login-button').click();
  await expect(page.getByText(/Transações Recentes|Saldo Atual/i).first()).toBeVisible({ timeout: 45_000 });
};

const bell = (page: Page) => page.getByRole('button', { name: /^Notificações/ });
const panelHeading = (page: Page) => page.getByRole('heading', { name: 'Notificações', level: 3 });
const isFocused = (locator: Locator) => locator.evaluate((element) => element === document.activeElement);

test('PTBR-04: Escape fecha o painel e o foco volta ao sino; o X também; com o diálogo de exclusão aberto, o Escape é só dele', async ({ page }) => {
  test.setTimeout(240_000);
  const workspaceId = await seedApp();
  await loginApp(page);

  await bell(page).focus();
  await page.keyboard.press('Enter');
  await expect(panelHeading(page)).toBeVisible();
  await expect(bell(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: 'Meta concluída P5G', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panelHeading(page)).toHaveCount(0);
  await expect(bell(page)).toHaveAttribute('aria-expanded', 'false');
  expect(await isFocused(bell(page)), 'foco no sino depois do Escape').toBe(true);

  // Escape com o painel aberto e o foco dentro dele.
  await page.keyboard.press('Enter');
  await tabTo(page, page.getByRole('button', { name: 'Meta concluída P5G', exact: true }), { fromStart: false });
  await page.keyboard.press('Escape');
  await expect(panelHeading(page)).toHaveCount(0);
  expect(await isFocused(bell(page))).toBe(true);

  // O X pelo teclado.
  await page.keyboard.press('Enter');
  await tabTo(page, page.getByRole('button', { name: 'Fechar notificações' }), { fromStart: false });
  await page.keyboard.press('Enter');
  await expect(panelHeading(page)).toHaveCount(0);
  expect(await isFocused(bell(page))).toBe(true);

  // Diálogo de exclusão aberto: o primeiro Escape fecha só o diálogo; o segundo, o painel.
  await page.keyboard.press('Enter');
  await tabTo(page, page.getByRole('button', { name: 'Excluir para mim: Empréstimo vencido P5G' }), { fromStart: false });
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Excluir notificação' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(panelHeading(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panelHeading(page)).toHaveCount(0);
  expect(await isFocused(bell(page))).toBe(true);

  // Um aviso com destino aberto pelo teclado: marca como lido, abre a tela, fecha o painel e o foco volta ao sino.
  await page.keyboard.press('Enter');
  await tabTo(page, page.getByRole('button', { name: 'Meta concluída P5G', exact: true }), { fromStart: false });
  await page.keyboard.press('Enter');
  await expect(panelHeading(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /Metas/ }).first()).toBeVisible({ timeout: 30_000 });
  expect(await isFocused(bell(page))).toBe(true);
  await expect.poll(async () => (await adminSdk().firestore()
    .doc(`workspaces/${workspaceId}/notification_user_states/${OWNER.uid}/notification_entries/p5g_goal`).get()).get('read'),
  { timeout: 30_000 }).toBe(true);
});

test('PTBR-05: o seletor de período abre uma vez com Enter ou Espaço, percorre por Tab, escolhe com Enter e fecha com Escape', async ({ page }) => {
  test.setTimeout(240_000);
  await seedApp();
  await loginApp(page);
  await page.getByText(/^Relatórios( Empresariais)?$/).first().click();
  await expect(page.getByRole('tab', { name: 'Visão Geral' })).toBeVisible({ timeout: 30_000 });
  // O nome acessível contém o texto visível (WCAG 2.5.3): "Período do relatório: <período>".
  const trigger = page.getByRole('button', { name: /^Período do relatório: / });
  await expect(trigger).toHaveAccessibleName(/^Período do relatório: \S/);
  const group = page.getByRole('group', { name: 'Períodos do relatório' });

  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(group).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(group).toHaveCount(0);
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(await isFocused(trigger)).toBe(true);

  await page.keyboard.press('Space');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(trigger).toHaveAttribute('aria-controls', /.+/);
  expect(await group.getAttribute('id')).toBe(await trigger.getAttribute('aria-controls'));
  // O período atual é indicado também sem cor (aria-current).
  await expect(group.locator('[aria-current="true"]')).toHaveCount(1);
  // axe (WCAG 2.0/2.1 A e AA) no botão e na lista aberta, sem exceção.
  await trigger.evaluate((element) => element.setAttribute('data-p5g-axe', 'periodo'));
  expect(await axeViolations(page, '[data-p5g-axe="periodo"]')).toEqual([]);
  expect(await axeViolations(page, '[aria-label="Períodos do relatório"]')).toEqual([]);

  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/getFinancialReport')) requests.push(request.postData() ?? '');
  });
  const sevenDays = group.getByRole('button', { name: 'Últimos 7 dias', exact: true });
  await tabTo(page, sevenDays, { fromStart: false });
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Enter');
  await expect(group).toHaveCount(0);
  await expect(trigger).toContainText('Últimos 7 dias');
  expect(await isFocused(trigger)).toBe(true);
  await expect.poll(() => requests.filter((body) => body.includes('"preset":"7d"')).length, { timeout: 30_000 }).toBeGreaterThan(0);
  // Um Enter, uma escolha: a lista não reabre e o período não volta.
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');

  // Sair da lista pelo Tab a fecha.
  await page.keyboard.press('Enter');
  await expect(group).toBeVisible();
  const buttons = await group.getByRole('button').count();
  for (let step = 0; step < buttons + 1; step += 1) await page.keyboard.press('Tab');
  await expect(group).toHaveCount(0);
});
