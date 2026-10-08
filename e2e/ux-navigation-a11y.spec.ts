import { expect, test, type Locator, type Page } from '@playwright/test';

import { adminSdk } from './support/workspaceSeed';

/**
 * UX-H1 — ícones, navegação mobile e controles acessíveis do Header.
 *
 * - V-01: os ícones do pacote do tema pintam de fato (traço ou preenchimento
 *   com cor e área visível), nos três pacotes: Lucide (padrão), Tabler e
 *   Phosphor (escolhidos no tema salvo em `app-theme`).
 * - V-02/V-03: no mobile o menu aberto fica acima do Header, recebe o clique
 *   real em "Dashboard" e fecha ao navegar, ao tocar fora e com Esc; fechado,
 *   não bloqueia o conteúdo. No desktop o menu compacto expande no hover e não
 *   é fechado ao navegar.
 * - V-05: botões só de ícone com nome acessível em pt-BR.
 */
const PASSWORD = 'e2e-ux-h1-password';
const MOBILE = { width: 390, height: 844 };

interface Persona {
  uid: string;
  email: string;
}

const persona = (suffix: string): Persona => ({
  uid: `e2e-ux-h1-${suffix}`,
  email: `e2e-ux-h1-${suffix}@minhas-financas.local`,
});

const resetPersona = async ({ uid, email }: Persona) => {
  const sdk = adminSdk();
  try {
    await sdk.auth().deleteUser(uid);
  } catch (error) {
    if ((error as { code?: string }).code !== 'auth/user-not-found') throw error;
  }
  const db = sdk.firestore();
  await Promise.all([
    db.recursiveDelete(db.doc(`users/${uid}`)),
    db.recursiveDelete(db.doc(`billing_accounts/${uid}`)),
  ]);
  await sdk.auth().createUser({ uid, email, password: PASSWORD, emailVerified: true });
};

const login = async (page: Page, { email }: Persona) => {
  await page.goto(`/?e2eEmail=${encodeURIComponent(email)}&e2ePassword=${PASSWORD}`);
  await page.getByTestId('e2e-login-button').click();
  await expect(page.getByText(/Transações Recentes|Saldo Atual/i).first())
    .toBeVisible({ timeout: 45_000 });
};

/** Tema salvo antes do carregamento, como o seletor de Personalização faz. */
const useIconPack = async (page: Page, pack: 'tabler' | 'phosphor') => {
  await page.addInitScript((iconPack) => {
    try {
      window.localStorage.setItem('app-theme', JSON.stringify({ icons: { pack: iconPack } }));
    } catch {
      // Sem armazenamento: o teste falha adiante pela ausência do pacote.
    }
  }, pack);
};

/**
 * Pintura real do SVG: área visível e traço ou preenchimento com cor efetiva
 * (não `none` nem transparente) nos elementos desenhados.
 */
const svgPaint = (svg: Locator) => svg.evaluate((element) => {
  const box = element.getBoundingClientRect();
  const shapes = Array.from(element.querySelectorAll('path, line, rect, circle, polyline, polygon'));
  const painted = shapes.some((shape) => {
    const style = getComputedStyle(shape);
    const visible = (paint: string) => paint !== 'none' && !/rgba\([^)]*,\s*0\)$/.test(paint);
    const strokeWidth = parseFloat(style.strokeWidth || '0');
    return (visible(style.stroke) && strokeWidth > 0) || visible(style.fill);
  });
  return {
    width: box.width,
    height: box.height,
    visibility: getComputedStyle(element).visibility,
    shapes: shapes.length,
    painted,
    className: element.getAttribute('class') ?? '',
  };
});

const expectPaintedIcons = async (svgs: Locator, minimum: number) => {
  await expect.poll(() => svgs.count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(minimum);
  const count = await svgs.count();
  for (let index = 0; index < count; index += 1) {
    const paint = await svgPaint(svgs.nth(index));
    expect(paint.width, `ícone ${index}`).toBeGreaterThan(0);
    expect(paint.height, `ícone ${index}`).toBeGreaterThan(0);
    expect(paint.visibility, `ícone ${index}`).toBe('visible');
    expect(paint.shapes, `ícone ${index}`).toBeGreaterThan(0);
    expect(paint.painted, `ícone ${index} (${paint.className}) sem traço nem preenchimento`).toBe(true);
  }
  return count;
};

test.describe('V-01 — ícones pintados nos três pacotes', () => {
  test('Lucide (padrão): menu, Header e controles principais', async ({ page }) => {
    test.setTimeout(120_000);
    const user = persona('lucide');
    await resetPersona(user);
    await login(page, user);
    // Ícones do pacote Lucide: nem Tabler (recurso) nem o desenho tracejado de
    // nome desconhecido, que leva `style` de opacidade.
    const lucide = 'svg[viewBox="0 0 24 24"]:not(.tabler-icon):not([style])';
    await expect.poll(() => page.locator(`aside nav a ${lucide}`).count(), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(5);
    await expectPaintedIcons(page.locator(`aside nav a ${lucide}`), 5);
    await expectPaintedIcons(page.locator(`header button:visible ${lucide}`), 5);
    // Controles principais do painel: cards de resumo clicáveis.
    await expectPaintedIcons(page.locator(`main [role="button"] ${lucide}`), 3);
  });

  test('Tabler escolhido no tema: ícones com traço visível', async ({ page }) => {
    test.setTimeout(120_000);
    const user = persona('tabler');
    await resetPersona(user);
    await useIconPack(page, 'tabler');
    await login(page, user);
    await expect.poll(() => page.locator('aside nav a svg.tabler-icon').count(), { timeout: 20_000 })
      .toBeGreaterThanOrEqual(5);
    await expectPaintedIcons(page.locator('aside nav a svg.tabler-icon'), 5);
    await expectPaintedIcons(page.locator('header button:visible svg.tabler-icon'), 5);
  });

  test('Phosphor escolhido no tema: ícones preenchidos visíveis', async ({ page }) => {
    test.setTimeout(120_000);
    const user = persona('phosphor');
    await resetPersona(user);
    await useIconPack(page, 'phosphor');
    await login(page, user);
    // Phosphor desenha em viewBox 0 0 256 256, por preenchimento.
    const phosphorSidebar = page.locator('aside nav a svg[viewBox="0 0 256 256"]');
    await expect.poll(() => phosphorSidebar.count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(5);
    await expectPaintedIcons(phosphorSidebar, 5);
    await expectPaintedIcons(page.locator('header button:visible svg[viewBox="0 0 256 256"]'), 5);
  });
});

test.describe('V-02/V-03 — navegação no mobile', () => {
  test.use({ viewport: MOBILE });

  test('menu abre acima do Header, Dashboard recebe o clique real e o menu fecha ao navegar', async ({ page }) => {
    test.setTimeout(120_000);
    const user = persona('mobile');
    await resetPersona(user);
    await login(page, user);
    const openMenu = page.getByRole('button', { name: 'Abrir menu', exact: true });
    const menu = page.getByRole('complementary', { name: 'Menu principal' });
    const menuWidth = async () => (await menu.boundingBox())?.width ?? 0;

    // Fechado: invisível e fora da ordem de foco; o conteúdo recebe cliques.
    await expect(openMenu).toHaveAttribute('aria-expanded', 'false');
    await expect(menu).toBeHidden();

    // Abre e navega para outra seção: o menu fecha sozinho.
    await openMenu.click();
    await expect(menu).toBeVisible();
    await expect(page.getByRole('button', { name: 'Fechar menu', exact: true })).toHaveAttribute('aria-expanded', 'true');
    await menu.getByText('Meu Plano', { exact: true }).click();
    await expect(page.getByText('Planos e Assinaturas')).toBeVisible();
    await expect(menu).toBeHidden();
    await expect(openMenu).toHaveAttribute('aria-expanded', 'false');

    // Dashboard, o primeiro item (antes coberto pelo Header): clique real,
    // depois da transição de abertura (300 ms) terminar.
    await openMenu.click();
    await expect(menu).toBeVisible();
    await expect.poll(menuWidth).toBeGreaterThan(200);
    const dashboard = menu.getByText('Dashboard', { exact: true });
    // O ponto central do item pertence ao próprio menu (nada por cima dele).
    const topElementIsMenu = await dashboard.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return !!top && !!top.closest('aside');
    });
    expect(topElementIsMenu).toBe(true);
    await dashboard.click();
    await expect(page.getByText('Saldo Atual').first()).toBeVisible();
    await expect(menu).toBeHidden();

    // Menu fechado não bloqueia o conteúdo: o card "Despesas" abre a lista.
    await page.getByText('Despesas', { exact: true }).first().click();
    await expect(page.getByRole('heading', { name: /Despesas e Parcelamentos/ })).toBeVisible();
  });

  test('tocar fora e Esc fecham o menu sem trocar a tela atual', async ({ page }) => {
    test.setTimeout(120_000);
    const user = persona('mobile-close');
    await resetPersona(user);
    await login(page, user);
    const openMenu = page.getByRole('button', { name: 'Abrir menu', exact: true });
    const menu = page.getByRole('complementary', { name: 'Menu principal' });

    await openMenu.click();
    await expect(menu).toBeVisible();
    // Fora do menu (lado direito da tela): fecha e o painel continua.
    await page.mouse.click(MOBILE.width - 20, MOBILE.height / 2);
    await expect(menu).toBeHidden();
    await expect(page.getByText('Saldo Atual').first()).toBeVisible();

    // Pelo teclado: o foco entra no menu ao abrir e volta ao botão com Esc.
    await openMenu.focus();
    await page.keyboard.press('Enter');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('link', { name: 'Dashboard', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(menu.getByRole('link', { name: 'Empréstimos', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(openMenu).toBeFocused();
    await expect(page.getByText('Saldo Atual').first()).toBeVisible();
  });
});

test.describe('menu no desktop', () => {
  test('compacto por padrão, expande no hover e não fecha ao navegar', async ({ page }) => {
    test.setTimeout(120_000);
    const user = persona('desktop');
    await resetPersona(user);
    await login(page, user);
    const menu = page.getByRole('complementary', { name: 'Menu principal' });
    await page.mouse.move(900, 600);
    await expect(menu).toBeVisible();
    // Sem botão de menu no desktop.
    await expect(page.getByRole('button', { name: 'Abrir menu', exact: true })).toBeHidden();
    await expect.poll(async () => (await menu.boundingBox())?.width ?? 0).toBeLessThan(80);

    await menu.hover();
    await expect.poll(async () => (await menu.boundingBox())?.width ?? 0).toBeGreaterThan(200);
    await menu.getByText('Meu Plano', { exact: true }).click();
    await expect(page.getByText('Planos e Assinaturas')).toBeVisible();
    // Navegar não recolhe o menu sob o cursor (comportamento de hover mantido).
    await expect.poll(async () => (await menu.boundingBox())?.width ?? 0).toBeGreaterThan(200);
    await page.mouse.move(900, 600);
    await expect.poll(async () => (await menu.boundingBox())?.width ?? 0).toBeLessThan(80);
  });
});

test.describe('V-05 — controles do Header com nome acessível', () => {
  test('notificações, mensagens, tema e menu da conta, com estado', async ({ page }) => {
    test.setTimeout(120_000);
    const user = persona('header');
    await resetPersona(user);
    await page.emulateMedia({ colorScheme: 'light' });
    await login(page, user);

    const notifications = page.getByRole('button', { name: /^Notificações/ });
    const messages = page.getByRole('button', { name: /^Mensagens/ });
    await expect(notifications).toBeVisible();
    await expect(messages).toBeVisible();
    await expect(notifications).toHaveAttribute('aria-expanded', 'false');
    await notifications.click();
    await expect(notifications).toHaveAttribute('aria-expanded', 'true');
    // O painel fecha pelo clique fora (camada transparente já existente).
    await page.mouse.click(640, 700);
    await expect(notifications).toHaveAttribute('aria-expanded', 'false');

    // Alternância de tema: o nome descreve a próxima ação e acompanha o estado.
    const html = page.locator('html');
    await expect(html).not.toHaveClass(/(^|\s)dark(\s|$)/);
    await page.getByRole('button', { name: 'Ativar modo escuro' }).click();
    await expect(html).toHaveClass(/(^|\s)dark(\s|$)/);
    await page.getByRole('button', { name: 'Ativar modo claro' }).click();
    await expect(html).not.toHaveClass(/(^|\s)dark(\s|$)/);
    await expect(page.getByRole('button', { name: 'Ativar modo escuro' })).toBeVisible();

    // Menu da conta pelo teclado.
    const account = page.getByRole('button', { name: 'Abrir menu da conta' });
    await account.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Fechar menu da conta' })).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('Minha Conta')).toBeVisible();

    // Nenhum botão do Header sem nome acessível.
    const unnamed = await page.locator('header button, header [role="button"]').evaluateAll((elements) =>
      elements
        .filter((element) => (element as HTMLElement).offsetParent !== null)
        .filter((element) => {
          const label = element.getAttribute('aria-label')?.trim();
          const text = (element.textContent ?? '').trim();
          return !label && !text;
        })
        .map((element) => element.outerHTML.slice(0, 120)));
    expect(unnamed).toEqual([]);
  });
});
