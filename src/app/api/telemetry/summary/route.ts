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

type TelemetryRow = {
  event_name: string;
  created_at: string;
  props: Record<string, unknown> | null;
};

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

    const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const admin = createAdminClient();

    const { data, error } = await admin
      .from('telemetry_events')
      .select('event_name, created_at, props')
      .eq('org_id', orgId)
      .gte('created_at', sinceIso)
      .in('event_name', [...WATCHED_EVENTS])
      .order('created_at', { ascending: false })
      .limit(1000);

    if (error) {
      log.error('telemetry_summary_query_failed', {
        error_code: error.code || null,
        error: error.message || null,
      });
      return withStandardHeaders(
        NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
        requestId,
      );
    }

    const rows = (data || []) as TelemetryRow[];

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

    return withStandardHeaders(
      NextResponse.json({
        ok: true,
        org_id: orgId,
        window_hours: 24,
        events: byEvent,
        recent,
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
