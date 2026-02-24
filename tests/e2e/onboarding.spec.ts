import { expect, test } from '@playwright/test';
import { getSeedState, loginAs } from './helpers';

type OnboardingState = {
  step: number;
  completed: boolean;
  dismissed: boolean;
  hasReviews: boolean;
  hasSuggestions: boolean;
  hasAssets: boolean;
  hasPlannerItems: boolean;
  language: 'ca' | 'es' | 'en';
};

test('Onboarding (ONB-1): seed + aha chain + planner + export + finish', async ({ page, context }) => {
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

  const onboardingState: OnboardingState = {
    step: 1,
    completed: false,
    dismissed: false,
    hasReviews: false,
    hasSuggestions: false,
    hasAssets: false,
    hasPlannerItems: false,
    language: 'ca',
  };

  let replyGenerated = false;
  let suggestionGenerated = false;
  let assetGenerated = false;
  let plannerAdded = false;
  let exportGenerated = false;

  await page.route('**/api/onboarding', async (route) => {
    const method = route.request().method();

    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req_e2e_onboarding_get',
        },
        body: JSON.stringify({
          ...onboardingState,
          request_id: 'req_e2e_onboarding_get',
        }),
      });
      return;
    }

    if (method === 'PATCH') {
      const body = route.request().postDataJSON() as {
        step?: number;
        completed?: boolean;
        dismissed?: boolean;
      };

      if (typeof body.step === 'number') onboardingState.step = body.step;
      if (typeof body.completed === 'boolean') onboardingState.completed = body.completed;
      if (typeof body.dismissed === 'boolean') onboardingState.dismissed = body.dismissed;

      await route.fulfill({
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req_e2e_onboarding_patch',
        },
        body: JSON.stringify({
          progress: {
            step: onboardingState.step,
            completed: onboardingState.completed,
            dismissed: onboardingState.dismissed,
          },
          request_id: 'req_e2e_onboarding_patch',
        }),
      });
      return;
    }

    await route.fallback();
  });

  await page.route('**/api/onboarding/seed', async (route) => {
    onboardingState.hasReviews = true;
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req_e2e_onboarding_seed',
      },
      body: JSON.stringify({
        seeded: true,
        count: 5,
        request_id: 'req_e2e_onboarding_seed',
      }),
    });
  });

  await page.route('**/api/reviews/*/generate', async (route) => {
    replyGenerated = true;
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req_e2e_onboarding_reply',
      },
      body: JSON.stringify({
        option_a: 'Thanks for your review.',
        option_b: 'Thank you for the feedback, we are glad you had a good experience.',
        option_c: 'We appreciate your visit and hope to see you again soon.',
        request_id: 'req_e2e_onboarding_reply',
      }),
    });
  });

  await page.route('**/api/content-intel/generate', async (route) => {
    suggestionGenerated = true;
    onboardingState.hasSuggestions = true;

    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req_e2e_onboarding_suggestion',
      },
      body: JSON.stringify({
        insightId: '99999999-9999-4999-8999-999999999999',
        language: 'en',
        suggestions: [
          {
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
            insight_id: '99999999-9999-4999-8999-999999999999',
            business_id: core.bizId,
            language: 'en',
            type: 'reel',
            title: 'Fast and friendly check-in',
            hook: 'From door to welcome in under 3 minutes.',
            shot_list: ['Entrance', 'Reception smile', 'Key handoff'],
            caption: 'Guests highlight quick arrivals and warm service.',
            cta: 'Book your next stay',
            best_time: 'Thu 7:30 PM',
            hashtags: ['#guestexperience'],
            evidence: [{ review_id: core.reviewId, quote: 'Bona experiència general.' }],
            status: 'draft',
            created_at: new Date().toISOString(),
          },
        ],
        request_id: 'req_e2e_onboarding_suggestion',
      }),
    });
  });

  await page.route('**/api/content-studio/render', async (route) => {
    assetGenerated = true;
    onboardingState.hasAssets = true;

    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req_e2e_onboarding_asset',
      },
      body: JSON.stringify({
        assetId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        format: 'story',
        templateId: 'quote-clean',
        signedUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl9dB8AAAAASUVORK5CYII=',
        request_id: 'req_e2e_onboarding_asset',
      }),
    });
  });

  await page.route('**/api/planner', async (route) => {
    if (route.request().method() === 'POST') {
      plannerAdded = true;
      onboardingState.hasPlannerItems = true;

      await route.fulfill({
        status: 201,
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req_e2e_onboarding_planner',
        },
        body: JSON.stringify({
          item: {
            id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            status: 'planned',
          },
          deduped: false,
          request_id: 'req_e2e_onboarding_planner',
        }),
      });
      return;
    }

    await route.fallback();
  });

  await page.route('**/api/exports/weekly', async (route) => {
    exportGenerated = true;

    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req_e2e_onboarding_export',
      },
      body: JSON.stringify({
        exportId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        signedUrl: 'https://example.com/e2e-onboarding-pack.zip',
        request_id: 'req_e2e_onboarding_export',
      }),
    });
  });

  await loginAs(page, core);
  await page.goto('/dashboard/onboarding');

  await expect(page.getByTestId('onboarding-step')).toBeVisible();

  await page.getByTestId('onboarding-next').click();

  await expect(page.getByTestId('onboarding-seed-btn')).toBeVisible();
  await page.getByTestId('onboarding-seed-btn').click();
  await expect(page.getByText(/detectades ressenyes|reseñas detectadas|reviews detected/i)).toBeVisible();
  await page.getByTestId('onboarding-next').click();

  await expect(page.getByTestId('onboarding-generate-reply')).toBeVisible();
  await page.getByTestId('onboarding-generate-reply').click();
  await page.getByTestId('onboarding-generate-suggestion').click();
  await page.getByTestId('onboarding-generate-asset').click();
  await expect(page.getByTestId('onboarding-asset-generate')).toBeVisible();
  await page.getByTestId('onboarding-asset-generate').click();

  await expect.poll(() => replyGenerated).toBe(true);
  await expect.poll(() => suggestionGenerated).toBe(true);
  await expect.poll(() => assetGenerated).toBe(true);

  await page.getByTestId('onboarding-next').click();

  await expect(page.getByTestId('onboarding-add-planner')).toBeVisible();
  await page.getByTestId('onboarding-add-planner').click();
  await expect.poll(() => plannerAdded).toBe(true);

  await page.getByTestId('onboarding-export-weekly').click();
  await expect(page.getByTestId('onboarding-export-link')).toBeVisible();
  await expect.poll(() => exportGenerated).toBe(true);

  await page.getByTestId('onboarding-finish').click();
  await expect(page).toHaveURL(/\/dashboard\/growth/);

  await expect(page.getByTestId('onboarding-start')).toHaveCount(0);
});
