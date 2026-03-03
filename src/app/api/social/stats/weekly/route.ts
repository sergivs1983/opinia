export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireBizAccessPatternB } from '@/lib/api-handler';
import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getServerActiveOrgCookieValue, resolveServerActiveMembership } from '@/lib/workspace/server-active-org';

const QuerySchema = z.object({
  biz_id: z.string().uuid().optional(),
});

function withNoStore(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('x-request-id', requestId);
  return response;
}

function startOfUtcWeek(date: Date): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const weekday = date.getUTCDay();
  const mondayOffset = (weekday + 6) % 7;
  return new Date(Date.UTC(year, month, day - mondayOffset, 0, 0, 0, 0));
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'GET /api/social/stats/weekly' });

  const parsed = QuerySchema.safeParse({
    biz_id: request.nextUrl.searchParams.get('biz_id') || undefined,
  });

  if (!parsed.success) {
    return withNoStore(
      NextResponse.json({ error: 'bad_request', message: 'Query invàlida', request_id: requestId }, { status: 400 }),
      requestId,
    );
  }

  const payload = parsed.data;
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return withNoStore(
      NextResponse.json({ error: 'unauthorized', message: 'Auth required', request_id: requestId }, { status: 401 }),
      requestId,
    );
  }

  let scope: 'org' | 'biz' = 'org';
  let orgId: string | null = null;
  let scopedBizId: string | null = null;

  if (payload.biz_id) {
    const gate = await requireBizAccessPatternB(request, payload.biz_id, {
      supabase,
      user,
      queryBizId: payload.biz_id,
    });
    if (gate instanceof NextResponse) {
      return withNoStore(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    if (!gate.membership.orgId || (gate.role !== 'owner' && gate.role !== 'manager' && gate.role !== 'staff')) {
      return withNoStore(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    scope = 'biz';
    orgId = gate.membership.orgId;
    scopedBizId = gate.bizId;
  } else {
    const membership = await resolveServerActiveMembership({
      supabase,
      userId: user.id,
      cookieOrgId: getServerActiveOrgCookieValue(),
    });

    if (!membership?.org_id) {
      return withNoStore(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    orgId = membership.org_id;
  }

  const weekStart = startOfUtcWeek(new Date());
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
  const weekStartIso = weekStart.toISOString();
  const weekEndIso = weekEnd.toISOString();

  const admin = createAdminClient();
  let countQuery = admin
    .from('social_schedules')
    .select('id', { head: true, count: 'exact' })
    .eq('org_id', orgId)
    .eq('status', 'published')
    .gte('published_at', weekStartIso)
    .lt('published_at', weekEndIso);

  if (scope === 'biz' && scopedBizId) {
    countQuery = countQuery.eq('biz_id', scopedBizId);
  }

  const { count, error } = await countQuery;

  if (error) {
    log.error('social_weekly_stats_query_failed', {
      error_code: error.code || null,
      error: error.message || null,
      org_id: orgId,
      biz_id: scopedBizId,
      scope,
    });
    return withNoStore(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }

  const publishedCount = typeof count === 'number' ? count : 0;
  const goal = 3;
  const remaining = Math.max(goal - publishedCount, 0);
  const isCompleted = publishedCount >= goal;

  return withNoStore(
    NextResponse.json({
      ok: true,
      scope,
      week_start_utc: weekStartIso,
      week_end_utc: weekEndIso,
      published_count: publishedCount,
      goal,
      remaining,
      is_completed: isCompleted,
      request_id: requestId,
    }),
    requestId,
  );
}
