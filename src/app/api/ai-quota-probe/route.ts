export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * POST /api/ai-quota-probe
 *
 * Probe endpoint for the AI rate limit + daily quota smoke test (Bloc 8).
 * No auth required — uses x-biz-id + x-user-id headers as the rate limit key.
 *
 * Headers:
 *   x-biz-id      — Business UUID for quota key (required; 400 if missing)
 *   x-user-id     — User UUID for rate limit key (optional; defaults to 'probe-user')
 *   x-plan        — Quota plan: 'free' | 'pro' | 'enterprise' (optional; defaults 'free')
 *   x-test-limit  — (NON-PRODUCTION only) Override the daily quota limit for testing.
 *                   Allows the test script to force a low limit without restarting the server.
 *
 * Returns 200 { ok: true } when allowed.
 *         429 { error: "Rate limit exceeded" } when AI rate limit hit.
 *         429 { error: "Daily quota exceeded" } when daily quota hit.
 *         400 { error: "Missing x-biz-id header" } when bizId is absent.
 */

import { NextResponse } from 'next/server';
import { rateLimitAI, checkDailyAIQuota, resolvePlan } from '@/lib/security/ratelimit';

export async function POST(request: Request): Promise<NextResponse> {
  const bizId = request.headers.get('x-biz-id')?.trim();
  if (!bizId) {
    return NextResponse.json({ error: 'Missing x-biz-id header' }, { status: 400 });
  }

  const userId = request.headers.get('x-user-id')?.trim() || 'probe-user';
  const planRaw = request.headers.get('x-plan')?.trim() || 'free';
  const plan = resolvePlan(planRaw);

  // Dev-only test limit override (ignored in production)
  let testLimitOverride: number | undefined;
  if (process.env.NODE_ENV !== 'production') {
    const raw = request.headers.get('x-test-limit')?.trim();
    if (raw) {
      const parsed = parseInt(raw, 10);
      if (!isNaN(parsed) && parsed > 0) testLimitOverride = parsed;
    }
  }

  const rlKey = `${bizId}:${userId}`;

  const rl = await rateLimitAI(rlKey);
  if (!rl.ok) return rl.res;

  const quota = await checkDailyAIQuota(bizId, plan, testLimitOverride);
  if (!quota.ok) return quota.res;

  return NextResponse.json({ ok: true }, { status: 200 });
}
