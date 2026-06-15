import { expect, test } from '@playwright/test';

test('usuário E2E deve autenticar e carregar a aplicação logada usando emuladores', async ({ page }) => {
  await page.goto('/?e2eEmail=e2e-smoke@minhas-financas.local');

  await page.getByTestId('e2e-login-button').click();

  await expect(page.getByText(/Transações Recentes|Dashboard|Saldo Atual/i).first()).toBeVisible({
    timeout: 30_000,
  });

  await expect(page.getByText('Entrar com Google')).toHaveCount(0);
});