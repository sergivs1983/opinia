export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getAcceptedOrgMembership } from '@/lib/authz';
import { createLogger } from '@/lib/logger';
import { normalizeMemberRole } from '@/lib/roles';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { validateQuery } from '@/lib/validations';

const QuerySchema = z.object({
  org_id: z.string().uuid(),
});

const WATCHED_EVENTS = [
  'draft_generated',
  'draft_generate_failed',
  'draft_refined',
  'draft_refine_failed',
  'trial_ended_shown',
  'trial_cap_reached',
  'org_quota_exceeded',
  'ai_unavailable',
] as const;

const RECENT_ERROR_EVENTS = new Set<string>([
  'draft_generate_failed',
  'draft_refine_failed',
  'ai_unavailable',
  'org_quota_exceeded',
  'trial_ended_shown',
  'trial_cap_reached',
]);

const GUARDRAIL_EVENTS = [
  'rate_limited_org',
  'rate_limited_user',
  'orchestrator_cap_reached',
] as const;

type TelemetryRow = {
  event_name: string;
  created_at: string;
  props: Record<string, unknown> | null;
};

type Trend = 'up' | 'down' | 'flat';

function pickRecentProps(props: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!props) return null;

  const allowed = ['reason', 'http_status', 'code', 'feature', 'provider', 'status', 'action', 'source'] as const;
  const picked: Record<string, unknown> = {};

  for (const key of allowed) {
    if (typeof props[key] !== 'undefined') {
      picked[key] = props[key];
    }
  }

  return Object.keys(picked).length > 0 ? picked : null;
}

function withStandardHeaders(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('x-request-id', requestId);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function toTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function resolveTrend(current: number, previous: number): Trend {
  if (current > previous) return 'up';
  if (current < previous) return 'down';
  return 'flat';
}

function pickGuardrailProps(props: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!props) return null;
  const allowed = ['key', 'limit', 'count', 'cap_key', 'plan_code', 'retry_after', 'resets_at'] as const;
  const picked: Record<string, unknown> = {};

  for (const key of allowed) {
    if (typeof props[key] !== 'undefined') {
      picked[key] = props[key];
    }
  }

  return Object.keys(picked).length > 0 ? picked : null;
}

export async function GET(request: Request) {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'GET /api/telemetry/summary' });

  try {
    const supabase = createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return withStandardHeaders(
        NextResponse.json({ error: 'unauthorized', message: 'Auth required', request_id: requestId }, { status: 401 }),
        requestId,
      );
    }

    const [query, queryErr] = validateQuery(request, QuerySchema);
    if (queryErr) return withStandardHeaders(queryErr, requestId);
    const orgId = query.org_id;

    const membership = await getAcceptedOrgMembership({
      supabase,
      userId: user.id,
      orgId,
    });

    const role = membership ? normalizeMemberRole(membership.role) : null;
    if (!membership || (role !== 'owner' && role !== 'manager')) {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    const now = new Date();
    const since24hIso = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const since2hIso = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const oneHourAgoMs = now.getTime() - 60 * 60 * 1000;
    const todayUtcStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0);
    const todayUtcStartIso = new Date(todayUtcStartMs).toISOString();
    const yesterdayUtcStartIso = new Date(todayUtcStartMs - 24 * 60 * 60 * 1000).toISOString();
    const admin = createAdminClient();

    const [eventsQuery, rateQuery, capQuery, guardrailRecentQuery] = await Promise.all([
      admin
        .from('telemetry_events')
        .select('event_name, created_at, props')
        .eq('org_id', orgId)
        .gte('created_at', since24hIso)
        .in('event_name', [...WATCHED_EVENTS])
        .order('created_at', { ascending: false })
        .limit(1000),
      admin
        .from('telemetry_events')
        .select('event_name, created_at, props')
        .eq('org_id', orgId)
        .gte('created_at', since2hIso)
        .in('event_name', ['rate_limited_org', 'rate_limited_user'])
        .order('created_at', { ascending: false })
        .limit(2000),
      admin
        .from('telemetry_events')
        .select('event_name, created_at, props')
        .eq('org_id', orgId)
        .gte('created_at', yesterdayUtcStartIso)
        .eq('event_name', 'orchestrator_cap_reached')
        .order('created_at', { ascending: false })
        .limit(2000),
      admin
        .from('telemetry_events')
        .select('event_name, created_at, props')
        .eq('org_id', orgId)
        .gte('created_at', since24hIso)
        .in('event_name', [...GUARDRAIL_EVENTS])
        .order('created_at', { ascending: false })
        .limit(10),
    ]);

    if (eventsQuery.error || rateQuery.error || capQuery.error || guardrailRecentQuery.error) {
      log.error('telemetry_summary_query_failed', {
        error_code: eventsQuery.error?.code
          || rateQuery.error?.code
          || capQuery.error?.code
          || guardrailRecentQuery.error?.code
          || null,
        error: eventsQuery.error?.message
          || rateQuery.error?.message
          || capQuery.error?.message
          || guardrailRecentQuery.error?.message
          || null,
      });
      return withStandardHeaders(
        NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
        requestId,
      );
    }

    const rows = (eventsQuery.data || []) as TelemetryRow[];
    const rateRows = (rateQuery.data || []) as TelemetryRow[];
    const capRows = (capQuery.data || []) as TelemetryRow[];
    const guardrailRows = (guardrailRecentQuery.data || []) as TelemetryRow[];

    const byEvent = WATCHED_EVENTS.map((eventName) => {
      const eventRows = rows.filter((row) => row.event_name === eventName);
      const sampleRequestId = eventRows
        .map((row) => (row.props && typeof row.props.request_id === 'string' ? row.props.request_id : null))
        .find(Boolean);
      return {
        event_name: eventName,
        count_24h: eventRows.length,
        sample_request_id: sampleRequestId || null,
      };
    });

    const recent = rows
      .filter((row) => RECENT_ERROR_EVENTS.has(row.event_name) || row.event_name.endsWith('_failed'))
      .slice(0, 10)
      .map((row) => ({
        event_name: row.event_name,
        created_at: row.created_at,
        request_id: row.props && typeof row.props.request_id === 'string' ? row.props.request_id : null,
        props: pickRecentProps(row.props),
      }));

    const rateLast60mCount = rateRows
      .filter((row) => toTimestamp(row.created_at) >= oneHourAgoMs)
      .length;
    const ratePrev60mCount = rateRows
      .filter((row) => toTimestamp(row.created_at) < oneHourAgoMs)
      .length;
    const capTodayCount = capRows
      .filter((row) => toTimestamp(row.created_at) >= todayUtcStartMs)
      .length;
    const capYesterdayCount = capRows
      .filter((row) => toTimestamp(row.created_at) < todayUtcStartMs)
      .length;

    const guardrailsRecent = guardrailRows
      .slice(0, 10)
      .map((row) => ({
        event_name: row.event_name,
        created_at: row.created_at,
        org_id: orgId,
        biz_id: row.props && typeof row.props.biz_id === 'string' ? row.props.biz_id : null,
        props: pickGuardrailProps(row.props),
      }));

    return withStandardHeaders(
      NextResponse.json({
        ok: true,
        org_id: orgId,
        window_hours: 24,
        events: byEvent,
        recent,
        guardrails: {
          rate_limits_last_60m: {
            count: rateLast60mCount,
            previous_60m: ratePrev60mCount,
            trend: resolveTrend(rateLast60mCount, ratePrev60mCount),
          },
          orchestrator_cap_today: {
            count: capTodayCount,
            previous_day: capYesterdayCount,
            trend: resolveTrend(capTodayCount, capYesterdayCount),
            day_start_utc: todayUtcStartIso,
          },
          recent: guardrailsRecent,
        },
        request_id: requestId,
      }),
      requestId,
    );
  } catch (error) {
    log.error('telemetry_summary_unhandled', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withStandardHeaders(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}
