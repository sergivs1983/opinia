import { expect, test } from '@playwright/test';
import { getSeedState, loginAs } from './helpers';

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

test('Webhook connector: activar a Settings i enviar item del planner', async ({ page }) => {
  const { core } = getSeedState();
  if (!core.bizId) throw new Error('[e2e] core.bizId missing from seed state');

  await loginAs(page, core);

  let config = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    type: 'webhook' as const,
    enabled: false,
    url: '',
    allowed_channels: [] as Array<'ig_story' | 'ig_feed' | 'ig_reel'>,
    secret_present: false,
  };
  let sendCalled = false;

  const plannerItems: PlannerItem[] = [
    {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
      scheduled_at: '2026-02-20T19:30:00.000Z',
      channel: 'ig_feed',
      item_type: 'suggestion',
      title: 'Idea connector test',
      status: 'planned',
      suggestion_id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
      asset_id: null,
      text_post_id: null,
    },
  ];

  await page.route('**/api/integrations/connectors', async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req_e2e_webhook_config_get',
        },
        body: JSON.stringify({
          connectors: [config],
          request_id: 'req_e2e_webhook_config_get',
        }),
      });
      return;
    }

    if (method === 'POST') {
      const body = JSON.parse(route.request().postData() || '{}') as {
        enabled?: boolean;
        url?: string | null;
        allowed_channels?: Array<'ig_story' | 'ig_feed' | 'ig_reel'>;
      };
      config = {
        ...config,
        enabled: !!body.enabled,
        url: body.url || '',
        allowed_channels: body.allowed_channels || [],
        secret_present: true,
      };
      await route.fulfill({
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req_e2e_webhook_config_patch',
        },
        body: JSON.stringify({
          connector: config,
          request_id: 'req_e2e_webhook_config_patch',
        }),
      });
      return;
    }

    await route.continue();
  });

  await page.route('**/api/integrations/test', async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req_e2e_webhook_test',
      },
      body: JSON.stringify({
        ok: true,
        status: 'sent',
        response_code: 200,
        request_id: 'req_e2e_webhook_test',
      }),
    });
  });

  await page.route('**/api/planner?*', async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req_e2e_webhook_planner_get',
      },
      body: JSON.stringify({
        weekStart: '2026-02-16',
        items: plannerItems,
        request_id: 'req_e2e_webhook_planner_get',
      }),
    });
  });

  await page.route('**/api/planner/*/send', async (route) => {
    sendCalled = true;
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req_e2e_webhook_send',
      },
      body: JSON.stringify({
        ok: true,
        status: 'sent',
        response_code: 200,
        request_id: 'req_e2e_webhook_send',
      }),
    });
  });

  await page.goto('/dashboard/settings');
  await page.getByTestId('settings-tab-integrations').click();

  await expect(page.getByTestId('webhook-enabled')).toBeVisible();
  await page.getByTestId('webhook-enabled').click();
  await page.getByTestId('webhook-url').fill('https://hooks.example.test/webhook');
  await page.getByTestId('webhook-channel-ig_feed').locator('input[type="checkbox"]').check();
  await page.getByTestId('webhook-save').click();

  await expect.poll(() => config.enabled).toBe(true);
  await expect.poll(() => config.url).toBe('https://hooks.example.test/webhook');
  await expect.poll(() => config.allowed_channels.includes('ig_feed')).toBe(true);

  await page.getByTestId('webhook-test').click();
  await expect(page.getByTestId('webhook-test-status')).toContainText('req_e2e_webhook_test');

  await page.goto('/dashboard/growth');

  await expect(page.getByTestId('planner-item')).toHaveCount(1);
  await expect(page.getByTestId('planner-send-webhook')).toHaveCount(1);
  expect(sendCalled).toBe(false);
  await page.getByTestId('planner-send-webhook').click();

  await expect.poll(() => sendCalled).toBe(true);
  await expect(page.getByTestId('planner-webhook-status')).toContainText('req_e2e_webhook_send');
});
