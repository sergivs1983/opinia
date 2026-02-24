import { expect, test } from '@playwright/test';
import { getSeedState, loginAs } from './helpers';

test('Dashboard shell renders sidebar/topbar and business logo in switcher', async ({ page }) => {
  const { core } = getSeedState();
  const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl9dB8AAAAASUVORK5CYII=';
  const brandPngDataUrl = `data:image/png;base64,${tinyPngBase64}`;

  await page.route('**/api/businesses/*/brand-image/signed-url', async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req_e2e_shell_logo',
      },
      body: JSON.stringify({
        signedUrl: brandPngDataUrl,
        request_id: 'req_e2e_shell_logo',
      }),
    });
  });

  await loginAs(page, core);
  await page.goto('/dashboard/inbox');

  await expect(page.getByTestId('dashboard-topbar')).toBeVisible();
  await expect(page.getByTestId('dashboard-sidebar')).toBeVisible();
  await expect(page.getByTestId('business-switcher')).toBeVisible();
  await expect(page.getByTestId('business-logo')).toBeVisible();
  await expect(page.locator('img[data-testid="business-avatar"]')).toBeVisible();
});
