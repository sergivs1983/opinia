import { expect, test } from '@playwright/test';
import { getSeedState, loginAs } from './helpers';

test('Growth Hub: generar pla setmanal, veure MIX + 3 idees i aprovar-ne una', async ({ page, context }) => {
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

  const seedSuggestions = [
    {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
      insight_id: '77777777-7777-4777-8777-777777777777',
      business_id: core.bizId,
      language: 'en',
      type: 'reel',
      title: 'Speed in every welcome',
      hook: 'From door to check-in in under 3 minutes.',
      shot_list: ['Reception entrance', 'Welcome smile', 'Fast key handoff'],
      caption: 'Guests keep highlighting how smooth arrivals feel.',
      cta: 'Book your next visit',
      best_time: 'Thu 7:30 PM',
      hashtags: ['#guestexperience'],
      evidence: [{ review_id: core.reviewId, quote: 'Very fast check-in and friendly service.' }],
      status: 'draft',
      created_at: new Date().toISOString(),
    },
    {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
      insight_id: '77777777-7777-4777-8777-777777777777',
      business_id: core.bizId,
      language: 'en',
      type: 'story',
      title: 'Behind the room prep',
      hook: 'How we keep rooms spotless before every stay.',
      shot_list: ['Housekeeping prep', 'Final checklist', 'Room reveal'],
      caption: 'A quick look at the details behind clean and comfy rooms.',
      cta: 'Send us your questions',
      best_time: 'Thu 7:30 PM',
      hashtags: ['#cleanrooms'],
      evidence: [{ review_id: core.reviewId, quote: 'Room was super clean and comfortable.' }],
      status: 'draft',
      created_at: new Date().toISOString(),
    },
    {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',
      insight_id: '77777777-7777-4777-8777-777777777777',
      business_id: core.bizId,
      language: 'en',
      type: 'post',
      title: 'Evening guest moments',
      hook: 'Why evenings are our favorite service window.',
      shot_list: ['Dinner setup', 'Team coordination', 'Guest reactions'],
      caption: 'Guests mention the evening experience again and again.',
      cta: 'Reserve your table',
      best_time: 'Thu 7:30 PM',
      hashtags: ['#evening'],
      evidence: [{ review_id: core.reviewId, quote: 'Great vibe in the evening and attentive team.' }],
      status: 'draft',
      created_at: new Date().toISOString(),
    },
  ];

  await page.route('**/api/content-intel/generate', async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req_e2e_growth_generate',
      },
      body: JSON.stringify({
        insightId: '77777777-7777-4777-8777-777777777777',
        language: 'en',
        insight: {
          id: '77777777-7777-4777-8777-777777777777',
          week_start: new Date().toISOString().slice(0, 10),
          source_platforms: ['google'],
          themes: {
            top_themes: [
              { theme: 'fast check-in', mentions: 7, sentiment: 'positive' },
              { theme: 'slow breakfast', mentions: 3, sentiment: 'negative' },
            ],
            differentiators: ['fast check-in'],
            complaints: ['slow breakfast service'],
          },
        },
        suggestions: seedSuggestions,
      }),
    });
  });

  let approvePatched = false;

  await page.route('**/api/content-intel/suggestions/*', async (route) => {
    approvePatched = true;
    const url = route.request().url();
    const id = url.split('/').pop() || seedSuggestions[0].id;
    const target = seedSuggestions.find((suggestion) => suggestion.id === id) || seedSuggestions[0];

    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req_e2e_growth_patch',
      },
      body: JSON.stringify({
        suggestion: {
          ...target,
          status: 'approved',
        },
      }),
    });
  });

  await page.route('**/api/content-studio/render', async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req_e2e_growth_studio_render',
      },
      body: JSON.stringify({
        assetId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        format: 'story',
        templateId: 'feature-split',
        signedUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl9dB8AAAAASUVORK5CYII=',
        request_id: 'req_e2e_growth_studio_render',
      }),
    });
  });

  await page.route('**/api/content-studio/x-generate', async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req_e2e_growth_studio_x',
      },
      body: JSON.stringify({
        variants: [
          'Direct: Fast check-in and warm welcome. Book this week. #guestexperience',
          'Story: \"Very fast check-in and friendly service.\" A quick look at the flow.',
          'Take: Speed and hospitality can coexist. Reserve your next stay.',
        ],
        request_id: 'req_e2e_growth_studio_x',
      }),
    });
  });

  await loginAs(page, core);
  await page.goto('/dashboard/growth');

  await expect(page.getByTestId('growth-week-picker')).toBeVisible();
  await expect(page.getByTestId('growth-language-picker')).toBeVisible();
  await page.getByTestId('growth-language-picker').selectOption('en');

  await page.getByTestId('growth-generate-btn').click();

  await expect(page.getByTestId('growth-strong-point-card')).toBeVisible();
  await expect(page.getByTestId('growth-opportunity-card')).toBeVisible();
  await expect(page.getByTestId('growth-suggestion-card')).toHaveCount(3);

  await page.getByRole('button', { name: /crear story|create story/i }).first().click();
  await expect(page.getByTestId('studio-template-picker')).toBeVisible();
  await page.getByTestId('studio-template-picker').selectOption('feature-split');
  await page.getByTestId('studio-render-btn').click();
  await expect(page.getByTestId('studio-preview')).toBeVisible();
  await expect(page.getByTestId('studio-download-btn')).toBeVisible();
  await page.getByTestId('studio-x-generate-btn').click();
  await expect(page.getByTestId('studio-x-variant')).toHaveCount(3);
  await page.getByTestId('studio-x-copy').first().click();
  await page.getByTestId('studio-close-btn').click();

  await expect(async () => {
    await page.getByTestId('growth-copy-caption').first().click({ force: true });
  }).toPass({ timeout: 20_000 });
  await expect(page.getByTestId('growth-copy-caption').first()).toBeVisible();

  await expect(async () => {
    await page.getByTestId('growth-approve').first().click({ force: true });
  }).toPass({ timeout: 20_000 });

  await expect.poll(() => approvePatched).toBe(true);
  await expect(page.getByTestId('growth-approve').first()).toBeDisabled();
  await expect(page.getByTestId('growth-approve').first()).toHaveText(/approved|aprovada|aprobada/i);
});
