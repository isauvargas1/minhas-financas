import { expect, test } from '@playwright/test';

test('aplicação deve carregar sem erro crítico', async ({ page }) => {
  const consoleErrors: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  await page.goto('/');

  await expect(page).toHaveTitle(/Minhas Finanças|Finanças|Financeiro/i);

  const body = page.locator('body');

  await expect(body).toBeVisible();

  const criticalErrors = consoleErrors.filter((message) =>
    !message.includes('favicon') &&
    !message.includes('Failed to load resource'),
  );

  expect(criticalErrors).toEqual([]);
});