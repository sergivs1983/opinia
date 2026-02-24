import { expect, test } from '@playwright/test';
import { getSeedState, loginAs } from './helpers';

test('Inbox: veure llistat, entrar review i generar resposta', async ({ page }) => {
  const { core } = getSeedState();
  if (!core.reviewId) throw new Error('[e2e] core.reviewId missing from seed state');

  await loginAs(page, core);
  await page.goto('/dashboard/inbox');

  await expect(page.getByTestId('inbox-page')).toBeVisible();

  const reviewRow = page.getByTestId(`inbox-review-item-${core.reviewId}`);
  await expect(reviewRow).toBeVisible({ timeout: 20_000 });
  await reviewRow.click();

  await expect(page.getByTestId('review-detail-page')).toBeVisible();
  await page.getByTestId('review-generate').first().click();

  const editor = page.getByTestId('review-response-editor');
  await expect(editor).toBeVisible({ timeout: 45_000 });
  await expect(editor).not.toHaveValue('');
});

test('Inbox: error controlat mostra request id', async ({ page }) => {
  const { core } = getSeedState();
  if (!core.reviewId) throw new Error('[e2e] core.reviewId missing from seed state');

  await loginAs(page, core);
  await page.goto('/dashboard/inbox');
  await expect(page.getByTestId('inbox-page')).toBeVisible();

  await page.getByTestId(`inbox-review-item-${core.reviewId}`).click();
  await expect(page.getByTestId('review-detail-page')).toBeVisible();

  const forcedRequestId = 'req_e2e_forced_generate_error';

  await page.route(`**/api/reviews/${core.reviewId}/generate`, async route => {
    await route.fulfill({
      status: 500,
      headers: {
        'content-type': 'application/json',
        'x-request-id': forcedRequestId,
      },
      body: JSON.stringify({
        error: 'internal_error',
        message: 'Error forcat per E2E',
      }),
    });
  });

  await page.getByTestId('review-generate').first().click();

  const errorBox = page.getByTestId('generate-error-box');
  await expect(errorBox).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('generate-error-request-id')).toContainText(`ID: ${forcedRequestId}`);
  await expect(page.getByTestId('generate-error-copy-id')).toBeVisible();
});
