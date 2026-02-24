import { expect, test } from '@playwright/test';
import { getSeedState, loginAs } from './helpers';

test('UI Premium pages: pricing renders key blocks', async ({ page }) => {
  await page.goto('/pricing');

  await expect(page.getByTestId('pricing-plan-card')).toHaveCount(3);
  await expect(page.getByTestId('pricing-feature-table')).toBeVisible();
  await expect(page.getByTestId('pricing-faq')).toBeVisible();
});

test('UI Premium pages: dashboard onboarding renders wizard shell', async ({ page }) => {
  const { core } = getSeedState();
  await loginAs(page, core);
  await page.goto('/dashboard/onboarding');

  await expect(page.getByTestId('onboarding-step')).toBeVisible();
  await expect(page.getByTestId('onboarding-next')).toBeVisible();
});
