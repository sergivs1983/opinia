export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { hasAcceptedBusinessMembership } from '@/lib/authz';
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

  if (payload.biz_id) {
    const access = await hasAcceptedBusinessMembership({
      supabase,
      userId: user.id,
      businessId: payload.biz_id,
      allowedRoles: ['owner', 'manager', 'staff'],
    });

    if (!access.allowed || !access.orgId) {
      return withNoStore(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    scope = 'biz';
    orgId = access.orgId;
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

  if (scope === 'biz' && payload.biz_id) {
    countQuery = countQuery.eq('biz_id', payload.biz_id);
  }

  const { count, error } = await countQuery;

  if (error) {
    log.error('social_weekly_stats_query_failed', {
      error_code: error.code || null,
      error: error.message || null,
      org_id: orgId,
      biz_id: payload.biz_id || null,
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
