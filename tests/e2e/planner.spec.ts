import { expect, test } from '@playwright/test';
import { getSeedState, loginAs } from './helpers';

test('Planner persistit: afegir suggestion i marcar-la com publicada', async ({ page, context }) => {
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
    id: '99999999-9999-4999-8999-999999999991',
    insight_id: '99999999-9999-4999-8999-999999999992',
    business_id: core.bizId,
    language: 'en',
    type: 'reel',
    title: 'Speed wins trust',
    hook: 'Fast and warm check-in in under 3 minutes.',
    shot_list: ['Reception', 'Room handoff', 'Guest smile'],
    caption: 'Guests keep calling out how smooth arrivals feel.',
    cta: 'Book your next stay',
    best_time: 'Thu 7:30 PM',
    hashtags: ['#guestexperience'],
    evidence: [{ review_id: core.reviewId, quote: 'Very fast check-in and friendly service.' }],
    status: 'draft',
    created_at: new Date().toISOString(),
  };

  type PlannerItem = {
    id: string;
    scheduled_at: string;
    channel: 'ig_story' | 'ig_feed' | 'ig_reel' | 'x' | 'threads';
    item_type: 'suggestion' | 'asset' | 'text';
    title: string;
    status: 'planned' | 'published';
    suggestion_id: string | null;
    asset_id: string | null;
    text_post_id: string | null;
  };

  const plannerItems: PlannerItem[] = [];

  await page.route('**/api/content-intel/generate', async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req_e2e_planner_generate',
      },
      body: JSON.stringify({
        insightId: suggestion.insight_id,
        language: 'en',
        insight: {
          id: suggestion.insight_id,
          week_start: new Date().toISOString().slice(0, 10),
          source_platforms: ['google'],
          themes: {
            top_themes: [{ theme: 'fast check-in', mentions: 8, sentiment: 'positive' }],
            differentiators: ['fast check-in'],
            complaints: [],
          },
        },
        suggestions: [suggestion],
      }),
    });
  });

  await page.route('**/api/planner?*', async (route) => {
    const request = route.request();
    if (request.method() !== 'GET') {
      await route.continue();
      return;
    }

    const url = new URL(request.url());
    const weekStart = url.searchParams.get('weekStart') || new Date().toISOString().slice(0, 10);

    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req_e2e_planner_get',
      },
      body: JSON.stringify({
        weekStart,
        items: plannerItems,
        request_id: 'req_e2e_planner_get',
      }),
    });
  });

  await page.route('**/api/planner', async (route) => {
    const request = route.request();
    if (request.method() !== 'POST') {
      await route.continue();
      return;
    }

    const body = JSON.parse(request.postData() || '{}') as {
      scheduledAt?: string;
      channel?: PlannerItem['channel'];
      itemType?: PlannerItem['item_type'];
      title?: string;
      suggestionId?: string;
      assetId?: string;
      textPostId?: string;
    };

    const scheduledAt = body.scheduledAt || new Date().toISOString();
    const channel = body.channel || 'ig_reel';
    const title = body.title || 'Planner item';

    const existing = plannerItems.find((item) => (
      item.scheduled_at === scheduledAt &&
      item.channel === channel &&
      item.title === title
    ));

    const item = existing || {
      id: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${plannerItems.length + 1}`,
      scheduled_at: scheduledAt,
      channel,
      item_type: body.itemType || 'suggestion',
      title,
      status: 'planned' as const,
      suggestion_id: body.suggestionId || null,
      asset_id: body.assetId || null,
      text_post_id: body.textPostId || null,
    };

    if (!existing) plannerItems.push(item);

    await route.fulfill({
      status: existing ? 200 : 201,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req_e2e_planner_post',
      },
      body: JSON.stringify({
        item,
        deduped: !!existing,
        request_id: 'req_e2e_planner_post',
      }),
    });
  });

  await page.route('**/api/planner/*', async (route) => {
    const request = route.request();
    if (request.method() !== 'PATCH') {
      await route.continue();
      return;
    }

    const url = request.url();
    const id = url.split('/').pop() || '';
    const body = JSON.parse(request.postData() || '{}') as { status?: 'planned' | 'published' };
    const target = plannerItems.find((item) => item.id === id);

    if (!target) {
      await route.fulfill({
        status: 404,
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req_e2e_planner_patch_missing',
        },
        body: JSON.stringify({
          error: 'not_found',
          message: 'Planner item not found',
          request_id: 'req_e2e_planner_patch_missing',
        }),
      });
      return;
    }

    if (body.status) target.status = body.status;

    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req_e2e_planner_patch',
      },
      body: JSON.stringify({
        item: target,
        request_id: 'req_e2e_planner_patch',
      }),
    });
  });

  await loginAs(page, core);
  await page.goto('/dashboard/growth');

  await page.getByTestId('growth-language-picker').selectOption('en');
  await page.getByTestId('growth-generate-btn').click();
  await expect(page.getByTestId('growth-suggestion-card')).toHaveCount(1);

  await page.getByTestId('planner-add').first().click();
  await expect(page.getByTestId('planner-item')).toHaveCount(1);
  await expect(page.getByTestId('planner-channel-badge')).toContainText(/IG/i);

  await page.getByTestId('planner-mark-published').first().click();
  await expect(page.getByTestId('planner-item').first()).toContainText(/published|publicat|publicado/i);
});
