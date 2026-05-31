import { expect, test } from '@playwright/test';

test('usuário E2E deve autenticar e carregar a aplicação logada', async ({ page }) => {
  await page.goto('/');

  await page.getByTestId('e2e-login-button').click();

  await expect(page.getByText(/Cartões de Crédito|Relatórios|Despesas/i).first()).toBeVisible({
    timeout: 30_000,
  });

  await expect(page.getByText('Entrar com Google')).toHaveCount(0);
});