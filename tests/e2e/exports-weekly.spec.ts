import { expect, test } from '@playwright/test';
import { getSeedState, loginAs } from './helpers';

test('Weekly export: generar pack setmanal des de Growth i validar enllaç', async ({ page, context }) => {
  const { core } = getSeedState();
  if (!core.bizId) throw new Error('[e2e] core.bizId missing from seed state');
  if (!core.reviewId) throw new Error('[e2e] core.reviewId missing from seed state');

  const suggestion = {
    id: 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    insight_id: 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    business_id: core.bizId,
    language: 'en',
    type: 'post',
    title: 'Weekly highlight',
    hook: 'Guests mention smooth check-in',
    shot_list: ['check-in', 'welcome', 'lobby'],
    caption: 'Weekly summary caption',
    cta: 'Book this week',
    best_time: 'Thu 7:30 PM',
    hashtags: ['#weekly'],
    evidence: [{ review_id: core.reviewId, quote: 'Very fast check-in and friendly staff.' }],
    status: 'draft',
    created_at: new Date().toISOString(),
  };

  await context.route('**/api/content-intel/generate', async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req_e2e_exports_generate',
      },
      body: JSON.stringify({
        insightId: suggestion.insight_id,
        language: 'en',
        insight: {
          id: suggestion.insight_id,
          week_start: new Date().toISOString().slice(0, 10),
          source_platforms: ['google'],
          themes: {
            top_themes: [{ theme: 'fast check-in', mentions: 6, sentiment: 'positive' }],
            differentiators: ['fast check-in'],
            complaints: [],
          },
        },
        suggestions: [suggestion],
      }),
    });
  });

  await context.route('**/api/planner?*', async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req_e2e_exports_planner',
      },
      body: JSON.stringify({
        weekStart: new Date().toISOString().slice(0, 10),
        items: [],
        request_id: 'req_e2e_exports_planner',
      }),
    });
  });

  await context.route('**/api/exports/weekly', async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req_e2e_exports_weekly',
      },
      body: JSON.stringify({
        exportId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        weekStart: '2026-02-16',
        language: 'en',
        signedUrl: 'http://127.0.0.1:3100/api/mock-export-download',
        bytes: 1234,
        itemsCount: 1,
        request_id: 'req_e2e_exports_weekly',
      }),
    });
  });

  await context.route('**/api/mock-export-download', async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/zip',
      },
      body: 'ZIP-DATA',
    });
  });

  await loginAs(page, core);
  await page.goto('/dashboard/growth');

  await page.getByTestId('growth-language-picker').selectOption('en');
  await page.getByTestId('growth-generate-btn').click();
  await expect(page.getByTestId('growth-suggestion-card')).toHaveCount(1);

  await page.getByTestId('export-weekly-btn').click();
  await expect(page.getByTestId('export-weekly-link')).toBeVisible();
  await page.getByTestId('export-weekly-copy').click();

  const downloadLink = await page.getByTestId('export-weekly-link').getAttribute('href');
  if (!downloadLink) throw new Error('[e2e] missing export download link href');

  const status = await page.evaluate(async (url) => {
    const response = await fetch(url);
    return response.status;
  }, downloadLink);

  expect(status).toBe(200);
});
