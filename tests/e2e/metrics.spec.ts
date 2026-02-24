import { expect, test, type Page } from '@playwright/test';
import { getSeedState, loginAs } from './helpers';

async function mockMetricsSummary(page: Page, admin: boolean) {
  await page.route('**/api/metrics/summary*', async (route) => {
    const url = new URL(route.request().url());
    const range = url.searchParams.get('range') || '30';

    const payload = range === '90'
      ? {
          admin,
          rangeDays: 90,
          totals: {
            replies_generated: 40,
            replies_approved: 20,
            assets_created: 12,
            planner_published: 14,
            ...(admin ? { ai_cost_cents: 1890, ai_tokens_in: 20000, ai_tokens_out: 18000 } : {}),
            time_saved_minutes_est: 180,
          },
          value: {
            time_saved_hours: 3,
            time_saved_minutes: 180,
            streak_weeks: 4,
            benchmark: {
              metric: 'posts_published',
              label: 'Per sobre de la mitjana',
              status: 'estimate',
              percentile: null,
            },
          },
          series: [
            { day: '2026-02-17', replies_generated: 2, planner_published: 1, ...(admin ? { ai_cost_cents: 90 } : {}) },
            { day: '2026-02-18', replies_generated: 3, planner_published: 1, ...(admin ? { ai_cost_cents: 120 } : {}) },
            { day: '2026-02-19', replies_generated: 1, planner_published: 2, ...(admin ? { ai_cost_cents: 80 } : {}) },
          ],
          highlights: [
            { label: 'replies_generated', value: 40, delta: 25.5 },
            { label: 'planner_published', value: 14, delta: 12.4 },
          ],
          request_id: 'req_e2e_metrics_90',
        }
      : {
          admin,
          rangeDays: Number(range),
          totals: {
            replies_generated: 12,
            replies_approved: 6,
            assets_created: 4,
            planner_published: 5,
            ...(admin ? { ai_cost_cents: 590, ai_tokens_in: 8000, ai_tokens_out: 7000 } : {}),
            time_saved_minutes_est: 30,
          },
          value: {
            time_saved_hours: 0.5,
            time_saved_minutes: 30,
            streak_weeks: 2,
            benchmark: {
              metric: 'posts_published',
              label: 'A la mitjana',
              status: 'data',
              percentile: 55,
            },
          },
          series: [
            { day: '2026-02-17', replies_generated: 1, planner_published: 0, ...(admin ? { ai_cost_cents: 40 } : {}) },
            { day: '2026-02-18', replies_generated: 2, planner_published: 1, ...(admin ? { ai_cost_cents: 60 } : {}) },
            { day: '2026-02-19', replies_generated: 3, planner_published: 1, ...(admin ? { ai_cost_cents: 70 } : {}) },
          ],
          highlights: [
            { label: 'replies_generated', value: 12, delta: 10.0 },
            { label: 'planner_published', value: 5, delta: 8.0 },
          ],
          request_id: 'req_e2e_metrics_default',
        };

    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-request-id': payload.request_id,
      },
      body: JSON.stringify(payload),
    });
  });
}

test('Metrics: user normal no veu cost IA', async ({ page }) => {
  const { core } = getSeedState();
  if (!core.bizId) throw new Error('[e2e] core.bizId missing from seed state');

  await loginAs(page, core);
  await mockMetricsSummary(page, false);

  await page.goto('/dashboard/metrics');

  await expect(page.getByTestId('metrics-range')).toBeVisible();
  await expect(page.getByTestId('metrics-card')).toHaveCount(4);
  await expect(page.getByTestId('metrics-series')).toBeVisible();
  await expect(page.getByTestId('metrics-admin-cost')).toHaveCount(0);
  await expect(page.getByTestId('metrics-cost')).toHaveCount(0);
  await expect(page.getByTestId('metrics-time-saved-hours')).toContainText('h');
  await expect(page.getByTestId('metrics-streak')).toBeVisible();
  await expect(page.getByTestId('metrics-benchmark')).toBeVisible();

  await page.getByTestId('metrics-range').selectOption('90');
  await expect(page.getByTestId('metrics-time-saved-hours')).toContainText('h');
  await expect(page.getByTestId('metrics-benchmark')).toBeVisible();
});

test('Metrics: admin veu cost IA', async ({ page }) => {
  const { core } = getSeedState();
  if (!core.bizId) throw new Error('[e2e] core.bizId missing from seed state');

  await loginAs(page, core);
  await mockMetricsSummary(page, true);

  await page.goto('/dashboard/metrics');

  await expect(page.getByTestId('metrics-card')).toHaveCount(5);
  await expect(page.getByTestId('metrics-admin-cost')).toBeVisible();
  await expect(page.getByTestId('metrics-cost')).toContainText('€');
  await expect(page.getByTestId('metrics-benchmark')).toBeVisible();
});
