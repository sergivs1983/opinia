import { expect, test } from '@playwright/test';
import { getSeedState, loginAs } from './helpers';

test('Content Intelligence: generar en anglès, veure 3 cards i aprovar-ne una', async ({ page }) => {
  const { core } = getSeedState();
  if (!core.bizId) throw new Error('[e2e] core.bizId missing from seed state');

  await loginAs(page, core);

  const seedSuggestions = [
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      insight_id: '99999999-9999-4999-8999-999999999999',
      business_id: core.bizId,
      language: 'en',
      type: 'reel',
      title: 'Show your speed',
      hook: 'How we keep service fast and warm.',
      shot_list: ['Front desk', 'Guest welcome', 'Room handoff'],
      caption: 'A quick look at our check-in flow.',
      cta: 'Book this week',
      best_time: 'Thu 7:30 PM',
      hashtags: ['#reviews', '#hospitality'],
      evidence: [
        {
          review_id: core.reviewId,
          quote: 'Bona experiència general',
        },
      ],
      status: 'draft',
      created_at: new Date().toISOString(),
    },
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
      insight_id: '99999999-9999-4999-8999-999999999999',
      business_id: core.bizId,
      language: 'en',
      type: 'story',
      title: 'Behind the team',
      hook: 'The people behind the experience.',
      shot_list: ['Kitchen prep', 'Table setup', 'Service moment'],
      caption: 'Meet the team shaping every stay.',
      cta: 'Reply for recommendations',
      best_time: 'Thu 7:30 PM',
      hashtags: ['#team', '#localbusiness'],
      evidence: [
        {
          review_id: core.reviewId,
          quote: 'personal amable',
        },
      ],
      status: 'draft',
      created_at: new Date().toISOString(),
    },
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
      insight_id: '99999999-9999-4999-8999-999999999999',
      business_id: core.bizId,
      language: 'en',
      type: 'post',
      title: 'Clean room details',
      hook: 'Why guests mention cleanliness.',
      shot_list: ['Room prep', 'Amenities', 'Final touch'],
      caption: 'What guests notice in the room experience.',
      cta: 'Save for your next visit',
      best_time: 'Thu 7:30 PM',
      hashtags: ['#cleanrooms', '#guestexperience'],
      evidence: [
        {
          review_id: core.reviewId,
          quote: 'Habitació neta',
        },
      ],
      status: 'draft',
      created_at: new Date().toISOString(),
    },
  ];

  await page.route('**/api/content-intel/generate', async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req_e2e_content_generate',
      },
      body: JSON.stringify({
        insightId: '99999999-9999-4999-8999-999999999999',
        language: 'en',
        suggestions: seedSuggestions,
      }),
    });
  });

  await page.route('**/api/content-intel/suggestions/*', async (route) => {
    const url = route.request().url();
    const id = url.split('/').pop() || seedSuggestions[0].id;
    const target = seedSuggestions.find((suggestion) => suggestion.id === id) || seedSuggestions[0];

    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req_e2e_content_patch',
      },
      body: JSON.stringify({
        suggestion: {
          ...target,
          status: 'approved',
        },
      }),
    });
  });

  const fakeAssets = [
    {
      id: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
      suggestion_id: seedSuggestions[0].id,
      created_at: new Date().toISOString(),
      format: 'story',
      template_id: 'quote-clean',
      language: 'en',
      status: 'created',
    },
    {
      id: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2',
      suggestion_id: seedSuggestions[1].id,
      created_at: new Date().toISOString(),
      format: 'feed',
      template_id: 'feature-split',
      language: 'en',
      status: 'created',
    },
  ];

  const tinyPngDataUrl =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl9dB8AAAAASUVORK5CYII=';
  let plannerSendCalled = false;

  await page.route('**/api/content-studio/assets?*', async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req_e2e_content_assets_list',
      },
      body: JSON.stringify({
        items: fakeAssets,
        request_id: 'req_e2e_content_assets_list',
      }),
    });
  });

  await page.route('**/api/content-studio/assets/*/signed-url', async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req_e2e_content_assets_signed',
      },
      body: JSON.stringify({
        signedUrl: tinyPngDataUrl,
        request_id: 'req_e2e_content_assets_signed',
      }),
    });
  });

  await page.route('**/api/planner', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req_e2e_content_planner_create',
      },
      body: JSON.stringify({
        item: { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1' },
        request_id: 'req_e2e_content_planner_create',
      }),
    });
  });

  await page.route('**/api/planner/*/send', async (route) => {
    plannerSendCalled = true;
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req_e2e_content_planner_send',
      },
      body: JSON.stringify({
        status: 'sent',
        request_id: 'req_e2e_content_planner_send',
      }),
    });
  });

  await page.goto('/dashboard/content');

  await expect(page.getByTestId('content-week-picker')).toBeVisible();
  await expect(page.getByTestId('content-language-picker')).toBeVisible();
  await page.getByTestId('content-language-picker').selectOption('en');

  await expect(page.getByTestId('content-card')).toHaveCount(2);
  await expect(page.getByTestId('content-copy-hook').first()).toBeVisible();
  await expect(page.getByTestId('content-copy-caption').first()).toBeVisible();

  expect(plannerSendCalled).toBe(false);
  await page.getByTestId('content-approve').first().click();
  await expect.poll(() => plannerSendCalled).toBe(true);
});
