import { expect, test } from '@playwright/test';
import { getSeedState, loginAs } from './helpers';

test('Settings: compat tabs legacy + guardar canvis sense dependències de backend', async ({ page }) => {
  const { core } = getSeedState();

  await loginAs(page, core);
  await page.goto('/dashboard/settings');

  await expect(page.getByTestId('settings-page')).toBeVisible();

  await page.getByTestId('settings-tab-voice').click();
  await expect(page.getByTestId('settings-voice-panel')).toBeVisible();

  await page.getByTestId('settings-signature').fill(`Signatura E2E ${Date.now()}`);
  await page.getByTestId('settings-save').click();
  await expect(page.getByTestId('settings-saved-indicator')).toBeVisible({ timeout: 15_000 });

  await page.getByTestId('settings-tab-integrations').click();
  await expect(page.getByTestId('webhook-enabled')).toBeVisible();
});
