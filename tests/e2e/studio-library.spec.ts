import { expect, test } from '@playwright/test';
import { getSeedState, loginAs } from './helpers';

test('Studio Library: generar asset, obrir preview i reutilitzar', async ({ page, context }) => {
  const { core } = getSeedState();
  if (!core.bizId) throw new Error('[e2e] core.bizId missing from seed state');
  if (!core.reviewId) throw new Error('[e2e] core.reviewId missing from seed state');

  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => {
    const clipboard = { writeText: async () => undefined };
    Object.defineProperty(navigator, 'clipboard', {
      value: clipboard,
      configurable: true,
    });
  });

  const suggestion = {
    id: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
    insight_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    business_id: core.bizId,
    language: 'en',
    type: 'story',
    title: 'Fast welcome moments',
    hook: 'How we keep arrivals smooth and warm.',
    shot_list: ['Door open', 'Front desk', 'Room handoff'],
    caption: 'A short look at our welcome flow.',
    cta: 'Book this week',
    best_time: 'Thu 7:30 PM',
    hashtags: ['#welcome', '#hospitality'],
    evidence: [{ review_id: core.reviewId, quote: 'Fast check-in and friendly staff.' }],
    status: 'draft',
    created_at: new Date().toISOString(),
  };

  const pngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl9dB8AAAAASUVORK5CYII=';

  const assetOne = {
    id: 'ffffffff-ffff-4fff-8fff-fffffffffff1',
    suggestion_id: suggestion.id,
    created_at: new Date().toISOString(),
    format: 'story',
    template_id: 'quote-clean',
    language: 'en',
    status: 'created',
  } as const;

  const assetTwo = {
    id: 'ffffffff-ffff-4fff-8fff-fffffffffff2',
    suggestion_id: suggestion.id,
    created_at: new Date(Date.now() + 1_000).toISOString(),
    format: 'feed',
    template_id: 'feature-split',
    language: 'en',
    status: 'created',
  } as const;

  let storedAssets: Array<typeof assetOne> = [assetOne];
  let renderCalls = 0;
  let lastRenderEngine: string | null = null;
  let sawSimpleTemplate = false;

  page.on('response', (response) => {
    if (!response.url().includes('/api/content-studio/render')) return;
    lastRenderEngine = response.headers()['x-render-engine'] || null;
  });

  await page.route('**/api/content-intel/generate', async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req_e2e_studio_growth_generate',
      },
      body: JSON.stringify({
        insightId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        language: 'en',
        insight: {
          id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          week_start: new Date().toISOString().slice(0, 10),
          source_platforms: ['google'],
          themes: {
            top_themes: [{ theme: 'fast check-in', mentions: 7, sentiment: 'positive' }],
            differentiators: ['fast check-in'],
            complaints: [],
          },
        },
        suggestions: [suggestion],
      }),
    });
  });

  await page.route('**/api/content-studio/render', async (route) => {
    renderCalls += 1;
    const body = JSON.parse(route.request().postData() || '{}') as { templateId?: string };
    if (body.templateId === 'quote-clean' || body.templateId === 'feature-split') {
      sawSimpleTemplate = true;
    }

    if (renderCalls > 1) {
      storedAssets = [assetTwo, ...storedAssets];
    }

    const createdAsset = renderCalls > 1 ? assetTwo : assetOne;

    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-request-id': `req_e2e_studio_render_${renderCalls}`,
        'x-render-engine': 'satori',
      },
      body: JSON.stringify({
        assetId: createdAsset.id,
        format: createdAsset.format,
        templateId: createdAsset.template_id,
        signedUrl: pngDataUrl,
        request_id: `req_e2e_studio_render_${renderCalls}`,
      }),
    });
  });

  await page.route('**/api/content-studio/assets*', async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req_e2e_studio_assets_list',
      },
      body: JSON.stringify({
        items: storedAssets,
        nextCursor: null,
        request_id: 'req_e2e_studio_assets_list',
      }),
    });
  });

  await page.route('**/api/content-studio/assets/*/signed-url', async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req_e2e_studio_signed_url',
      },
      body: JSON.stringify({
        signedUrl: pngDataUrl,
        request_id: 'req_e2e_studio_signed_url',
      }),
    });
  });

  await loginAs(page, core);

  await page.goto('/dashboard/growth');
  await page.getByTestId('growth-language-picker').selectOption('en');
  await page.getByTestId('growth-generate-btn').click();

  await expect(page.getByTestId('growth-suggestion-card')).toHaveCount(1);

  await page.getByRole('button', { name: /crear story|create story/i }).first().click();
  await expect(page.getByTestId('studio-template-picker')).toBeVisible();
  await page.getByTestId('studio-template-picker').selectOption('quote-clean');
  await page.getByTestId('studio-render-btn').click();
  await expect(page.getByTestId('studio-preview')).toBeVisible();
  expect(sawSimpleTemplate).toBe(true);
  await expect.poll(() => lastRenderEngine).toBe('satori');
  await page.getByTestId('studio-close-btn').click();

  await page.goto('/dashboard/studio');

  await expect(page.getByTestId('studio-filter-week')).toBeVisible();
  await expect(page.getByTestId('studio-filter-format')).toBeVisible();
  await expect(page.getByTestId('studio-filter-language')).toBeVisible();

  await expect(page.getByTestId('studio-asset-card')).toHaveCount(1);

  await page.getByTestId('studio-asset-open').first().click();
  await expect(page.getByTestId('studio-asset-preview')).toBeVisible();

  await page.getByTestId('studio-asset-reuse').first().click();
  await page.getByTestId('studio-reuse-format').selectOption('feed');
  await page.getByTestId('studio-reuse-generate').click();

  await expect(page.getByTestId('studio-asset-card')).toHaveCount(2);
});
