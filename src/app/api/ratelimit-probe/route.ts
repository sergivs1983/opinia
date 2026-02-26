export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/ratelimit-probe
 *
 * Probe endpoint for the standard rate limit smoke test (Bloc 8).
 * No auth required — uses x-biz-id + x-user-id headers as the key.
 * Falls back to 'probe-biz:probe-user' if headers are absent.
 *
 * Returns 200 { ok: true } when allowed, 429 { error: "Rate limit exceeded" } when blocked.
 */

import { NextResponse } from 'next/server';
import { rateLimitStandard } from '@/lib/security/ratelimit';

export async function GET(request: Request): Promise<NextResponse> {
  const bizId = request.headers.get('x-biz-id')?.trim() || 'probe-biz';
  const userId = request.headers.get('x-user-id')?.trim() || 'probe-user';
  const key = `${bizId}:${userId}`;

  const rl = await rateLimitStandard(key);
  if (!rl.ok) return rl.res;

  return NextResponse.json({ ok: true }, { status: 200 });
}
