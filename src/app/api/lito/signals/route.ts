export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { hasAcceptedBusinessMembership } from '@/lib/authz';
import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { getSignalsForWeek } from '@/lib/signals/d13';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const LITO_ALLOWED_ROLES = ['owner', 'manager', 'staff'] as const;

const QuerySchema = z.object({
  biz_id: z.string().uuid(),
  provider: z.literal('google_business').default('google_business'),
});

function jsonNoStore(body: Record<string, unknown>, requestId: string, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('x-request-id', requestId);
  return response;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'GET /api/lito/signals' });

  // ── Session auth ──────────────────────────────────────────────────────────
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return jsonNoStore({ error: 'Unauthorized', request_id: requestId }, requestId, 401);
  }

  // ── Query params ──────────────────────────────────────────────────────────
  const sp = request.nextUrl.searchParams;
  const parsed = QuerySchema.safeParse({
    biz_id: sp.get('biz_id'),
    provider: sp.get('provider') || 'google_business',
  });

  if (!parsed.success) {
    return jsonNoStore(
      { error: 'bad_request', message: parsed.error.issues[0]?.message ?? 'Invalid request', request_id: requestId },
      requestId,
      400,
    );
  }

  const { biz_id, provider } = parsed.data;

  // ── AuthZ: Pattern B = 404 ────────────────────────────────────────────────
  const { allowed } = await hasAcceptedBusinessMembership({
    supabase,
    userId: user.id,
    businessId: biz_id,
    allowedRoles: [...LITO_ALLOWED_ROLES],
  });

  if (!allowed) {
    return jsonNoStore({ error: 'not_found', request_id: requestId }, requestId, 404);
  }

  // ── Fetch signals ──────────────────────────────────────────────────────────
  try {
    const signals = await getSignalsForWeek({
      supabase,
      biz_id,
      provider,
      days: 10,
    });

    const weekStart = new Date();
    weekStart.setUTCDate(weekStart.getUTCDate() - 7);

    log.info('signals_fetched', { biz_id, count: signals.length });

    return jsonNoStore(
      {
        ok: true,
        provider,
        week_start: weekStart.toISOString().slice(0, 10),
        signals,
        request_id: requestId,
      },
      requestId,
      200,
    );
  } catch (error) {
    log.error('signals_fetch_failed', { biz_id, error: error instanceof Error ? error.message : 'unknown' });
    return jsonNoStore({ error: 'internal', request_id: requestId }, requestId, 500);
  }
}
