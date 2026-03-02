export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getAcceptedOrgMembership } from '@/lib/authz';
import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const QuerySchema = z.object({
  org_id: z.string().uuid(),
  biz_id: z.string().uuid().optional(),
  range: z
    .preprocess((value) => {
      if (typeof value !== 'string') return 30;
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : 30;
    }, z.number().int().min(7).max(90))
    .optional()
    .default(30),
  channel: z.enum(['all', 'instagram', 'tiktok', 'facebook']).optional().default('all'),
});

type BusinessRow = {
  id: string;
  org_id: string;
  name: string;
  type: string | null;
  default_language: string | null;
  is_active: boolean;
};

type InsightRow = {
  biz_id: string;
  day: string;
  metrics: unknown;
};

type SignalRow = {
  biz_id: string;
  kind: 'alert' | 'opportunity' | string;
  severity: 'low' | 'med' | 'high' | string;
  severity_score: number | null;
};

type ScheduleRow = {
  biz_id: string;
  status: string;
  platform: 'instagram' | 'tiktok' | 'facebook' | string;
  scheduled_at: string;
  published_at: string | null;
};

type LocalRollup = {
  biz_id: string;
  name: string;
  type: string | null;
  default_language: string | null;
  total_reviews: number;
  neg_reviews: number;
  avg_rating: number | null;
  active_signals: number;
  high_alerts: number;
  opportunities: number;
  published_posts: number;
  pending_posts: number;
  missed_posts: number;
  semaphore: 'green' | 'amber' | 'red' | 'gray';
  health_score: number;
};

function noStore(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('x-request-id', requestId);
  return response;
}

function jsonNoStore(body: Record<string, unknown>, requestId: string, status = 200): NextResponse {
  return noStore(NextResponse.json(body, { status }), requestId);
}

function isSchemaDependencyError(error: unknown): boolean {
  const code = String((error as { code?: string })?.code || '').toUpperCase();
  const message = String((error as { message?: string })?.message || '').toLowerCase();
  return (
    code === '42P01'
    || code === '42703'
    || code === 'PGRST204'
    || code === 'PGRST205'
    || message.includes('schema cache')
    || message.includes('does not exist')
  );
}

function toInt(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.round(parsed);
  }
  return fallback;
}

function toFloat(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function parseMetrics(value: unknown): { new_reviews: number; neg_reviews: number; avg_rating: number | null } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { new_reviews: 0, neg_reviews: 0, avg_rating: null };
  }
  const obj = value as Record<string, unknown>;
  return {
    new_reviews: Math.max(0, toInt(obj.new_reviews, 0)),
    neg_reviews: Math.max(0, toInt(obj.neg_reviews, 0)),
    avg_rating: toFloat(obj.avg_rating),
  };
}

function dayIsoUtc(offsetDays = 0): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function dayStartIso(day: string): string {
  return `${day}T00:00:00.000Z`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function computeHealthScore(input: {
  total_reviews: number;
  neg_reviews: number;
  avg_rating: number | null;
  high_alerts: number;
  active_signals: number;
  published_posts: number;
  missed_posts: number;
}): number {
  let score = 100;

  if (input.avg_rating !== null) {
    if (input.avg_rating >= 4.5) score += 8;
    else if (input.avg_rating >= 4.2) score += 3;
    else if (input.avg_rating >= 3.8) score += 0;
    else if (input.avg_rating >= 3.4) score -= 12;
    else score -= 24;
  } else {
    score -= 6;
  }

  const negRate = input.total_reviews > 0 ? input.neg_reviews / input.total_reviews : 0;
  if (negRate >= 0.35) score -= 24;
  else if (negRate >= 0.2) score -= 14;
  else if (negRate >= 0.1) score -= 7;

  score -= Math.min(32, input.high_alerts * 14 + input.active_signals * 2);
  score -= Math.min(20, input.missed_posts * 8);
  score += Math.min(10, input.published_posts * 2);

  return clamp(Math.round(score), 0, 100);
}

function computeSemaphore(input: {
  health_score: number;
  total_reviews: number;
  active_signals: number;
}): 'green' | 'amber' | 'red' | 'gray' {
  if (input.total_reviews === 0 && input.active_signals === 0) return 'gray';
  if (input.health_score >= 75) return 'green';
  if (input.health_score >= 50) return 'amber';
  return 'red';
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'GET /api/enterprise/overview' });

  const parsed = QuerySchema.safeParse({
    org_id: request.nextUrl.searchParams.get('org_id'),
    biz_id: request.nextUrl.searchParams.get('biz_id') || undefined,
    range: request.nextUrl.searchParams.get('range') || undefined,
    channel: request.nextUrl.searchParams.get('channel') || undefined,
  });

  if (!parsed.success) {
    return jsonNoStore(
      {
        error: 'bad_request',
        message: parsed.error.issues[0]?.message || 'Invalid query',
        request_id: requestId,
      },
      requestId,
      400,
    );
  }

  const payload = parsed.data;
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return jsonNoStore(
      { error: 'unauthorized', message: 'Auth required', request_id: requestId },
      requestId,
      401,
    );
  }

  const membership = await getAcceptedOrgMembership({
    supabase,
    userId: user.id,
    orgId: payload.org_id,
  });

  const role = String(membership?.role || '').toLowerCase();
  const roleAllowed = role === 'owner' || role === 'manager' || role === 'staff';
  if (!membership || !roleAllowed) {
    return jsonNoStore(
      { error: 'not_found', message: 'No disponible', request_id: requestId },
      requestId,
      404,
    );
  }

  const admin = createAdminClient();
  const isManagerScope = role === 'owner' || role === 'manager';

  let accessibleBusinesses: BusinessRow[] = [];

  try {
    if (isManagerScope) {
      const { data, error } = await admin
        .from('businesses')
        .select('id, org_id, name, type, default_language, is_active')
        .eq('org_id', payload.org_id)
        .eq('is_active', true)
        .order('name', { ascending: true });

      if (error) throw error;
      accessibleBusinesses = (data || []) as BusinessRow[];
    } else {
      const { data: assignments, error: assignmentError } = await admin
        .from('business_memberships')
        .select('business_id')
        .eq('org_id', payload.org_id)
        .eq('user_id', user.id)
        .eq('is_active', true);

      if (assignmentError) throw assignmentError;

      const businessIds = Array.from(new Set((assignments || [])
        .map((row) => (row as { business_id?: string }).business_id)
        .filter((id): id is string => Boolean(id))));

      if (businessIds.length > 0) {
        const { data, error } = await admin
          .from('businesses')
          .select('id, org_id, name, type, default_language, is_active')
          .in('id', businessIds)
          .eq('org_id', payload.org_id)
          .eq('is_active', true)
          .order('name', { ascending: true });

        if (error) throw error;
        accessibleBusinesses = (data || []) as BusinessRow[];
      }
    }
  } catch (error) {
    log.error('enterprise_business_access_failed', {
      org_id: payload.org_id,
      user_id: user.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonNoStore(
      { error: 'internal', message: 'Error intern del servidor', request_id: requestId },
      requestId,
      500,
    );
  }

  if (payload.biz_id) {
    const exists = accessibleBusinesses.some((biz) => biz.id === payload.biz_id);
    if (!exists) {
      return jsonNoStore(
        { error: 'not_found', message: 'No disponible', request_id: requestId },
        requestId,
        404,
      );
    }
    accessibleBusinesses = accessibleBusinesses.filter((biz) => biz.id === payload.biz_id);
  }

  if (accessibleBusinesses.length === 0) {
    return jsonNoStore(
      {
        ok: true,
        org_id: payload.org_id,
        biz_id: payload.biz_id || null,
        range_days: payload.range,
        channel: payload.channel,
        org_rollup: {
          locals_count: 0,
          total_reviews: 0,
          neg_reviews: 0,
          neg_rate: 0,
          avg_rating: null,
          active_signals: 0,
          high_alerts: 0,
          published_posts: 0,
          pending_posts: 0,
          missed_posts: 0,
          semaphore_counts: { green: 0, amber: 0, red: 0, gray: 0 },
        },
        locals: [],
        rankings: { top: [], bottom: [] },
        request_id: requestId,
      },
      requestId,
    );
  }

  const bizIds = accessibleBusinesses.map((biz) => biz.id);
  const toDay = dayIsoUtc(0);
  const fromDay = dayIsoUtc(-(payload.range - 1));
  const fromIso = dayStartIso(fromDay);
  const nowIso = new Date().toISOString();

  let insights: InsightRow[] = [];
  let signals: SignalRow[] = [];
  let schedules: ScheduleRow[] = [];

  try {
    const [insightsResult, signalsResult, schedulesResult] = await Promise.all([
      admin
        .from('biz_insights_daily')
        .select('biz_id, day, metrics')
        .eq('org_id', payload.org_id)
        .eq('provider', 'google_business')
        .in('biz_id', bizIds)
        .gte('day', fromDay)
        .lte('day', toDay),
      admin
        .from('biz_signals')
        .select('biz_id, kind, severity, severity_score')
        .eq('org_id', payload.org_id)
        .eq('provider', 'google_business')
        .eq('is_active', true)
        .in('biz_id', bizIds)
        .gte('signal_day', fromDay)
        .lte('signal_day', toDay),
      (() => {
        let query = admin
          .from('social_schedules')
          .select('biz_id, status, platform, scheduled_at, published_at')
          .eq('org_id', payload.org_id)
          .in('biz_id', bizIds)
          .gte('scheduled_at', fromIso)
          .lte('scheduled_at', nowIso);

        if (payload.channel !== 'all') {
          query = query.eq('platform', payload.channel);
        }
        return query;
      })(),
    ]);

    if (insightsResult.error && !isSchemaDependencyError(insightsResult.error)) {
      throw insightsResult.error;
    }
    if (signalsResult.error && !isSchemaDependencyError(signalsResult.error)) {
      throw signalsResult.error;
    }
    if (schedulesResult.error && !isSchemaDependencyError(schedulesResult.error)) {
      throw schedulesResult.error;
    }

    insights = ((insightsResult.error ? [] : insightsResult.data) || []) as InsightRow[];
    signals = ((signalsResult.error ? [] : signalsResult.data) || []) as SignalRow[];
    schedules = ((schedulesResult.error ? [] : schedulesResult.data) || []) as ScheduleRow[];
  } catch (error) {
    log.error('enterprise_overview_query_failed', {
      org_id: payload.org_id,
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonNoStore(
      { error: 'internal', message: 'Error intern del servidor', request_id: requestId },
      requestId,
      500,
    );
  }

  const localAcc = new Map<string, Omit<LocalRollup, 'name' | 'type' | 'default_language' | 'semaphore' | 'health_score'>>();
  for (const bizId of bizIds) {
    localAcc.set(bizId, {
      biz_id: bizId,
      total_reviews: 0,
      neg_reviews: 0,
      avg_rating: null,
      active_signals: 0,
      high_alerts: 0,
      opportunities: 0,
      published_posts: 0,
      pending_posts: 0,
      missed_posts: 0,
    });
  }

  const ratingWeights = new Map<string, { weightedSum: number; weight: number }>();
  for (const row of insights) {
    const acc = localAcc.get(row.biz_id);
    if (!acc) continue;
    const metrics = parseMetrics(row.metrics);
    acc.total_reviews += metrics.new_reviews;
    acc.neg_reviews += metrics.neg_reviews;

    const ratingWeight = metrics.new_reviews > 0 ? metrics.new_reviews : (metrics.avg_rating !== null ? 1 : 0);
    if (metrics.avg_rating !== null && ratingWeight > 0) {
      const prev = ratingWeights.get(row.biz_id) || { weightedSum: 0, weight: 0 };
      prev.weightedSum += metrics.avg_rating * ratingWeight;
      prev.weight += ratingWeight;
      ratingWeights.set(row.biz_id, prev);
    }
  }

  for (const row of signals) {
    const acc = localAcc.get(row.biz_id);
    if (!acc) continue;
    acc.active_signals += 1;
    if (row.kind === 'opportunity') {
      acc.opportunities += 1;
    }
    if (row.kind === 'alert' && row.severity === 'high') {
      acc.high_alerts += 1;
    }
  }

  for (const row of schedules) {
    const acc = localAcc.get(row.biz_id);
    if (!acc) continue;
    if (row.status === 'published') {
      acc.published_posts += 1;
      continue;
    }
    if (row.status === 'missed') {
      acc.missed_posts += 1;
      continue;
    }
    if (row.status === 'scheduled' || row.status === 'notified' || row.status === 'snoozed') {
      acc.pending_posts += 1;
    }
  }

  const locals: LocalRollup[] = accessibleBusinesses.map((biz) => {
    const acc = localAcc.get(biz.id)!;
    const ratingState = ratingWeights.get(biz.id);
    const avgRating = ratingState && ratingState.weight > 0
      ? Number((ratingState.weightedSum / ratingState.weight).toFixed(2))
      : null;

    const health = computeHealthScore({
      total_reviews: acc.total_reviews,
      neg_reviews: acc.neg_reviews,
      avg_rating: avgRating,
      high_alerts: acc.high_alerts,
      active_signals: acc.active_signals,
      published_posts: acc.published_posts,
      missed_posts: acc.missed_posts,
    });

    const semaphore = computeSemaphore({
      health_score: health,
      total_reviews: acc.total_reviews,
      active_signals: acc.active_signals,
    });

    return {
      ...acc,
      name: biz.name,
      type: biz.type,
      default_language: biz.default_language,
      avg_rating: avgRating,
      health_score: health,
      semaphore,
    };
  }).sort((a, b) => b.health_score - a.health_score || a.name.localeCompare(b.name));

  const orgTotals = locals.reduce((acc, row) => {
    acc.total_reviews += row.total_reviews;
    acc.neg_reviews += row.neg_reviews;
    acc.active_signals += row.active_signals;
    acc.high_alerts += row.high_alerts;
    acc.published_posts += row.published_posts;
    acc.pending_posts += row.pending_posts;
    acc.missed_posts += row.missed_posts;
    acc.avg_rating_weight += row.avg_rating !== null ? row.avg_rating * Math.max(row.total_reviews, 1) : 0;
    acc.avg_rating_count += row.avg_rating !== null ? Math.max(row.total_reviews, 1) : 0;
    acc.semaphore_counts[row.semaphore] += 1;
    return acc;
  }, {
    total_reviews: 0,
    neg_reviews: 0,
    active_signals: 0,
    high_alerts: 0,
    published_posts: 0,
    pending_posts: 0,
    missed_posts: 0,
    avg_rating_weight: 0,
    avg_rating_count: 0,
    semaphore_counts: { green: 0, amber: 0, red: 0, gray: 0 },
  });

  const avgRating = orgTotals.avg_rating_count > 0
    ? Number((orgTotals.avg_rating_weight / orgTotals.avg_rating_count).toFixed(2))
    : null;
  const negRate = orgTotals.total_reviews > 0
    ? Number((orgTotals.neg_reviews / orgTotals.total_reviews).toFixed(3))
    : 0;

  return jsonNoStore(
    {
      ok: true,
      org_id: payload.org_id,
      biz_id: payload.biz_id || null,
      range_days: payload.range,
      channel: payload.channel,
      from_day: fromDay,
      to_day: toDay,
      org_rollup: {
        locals_count: locals.length,
        total_reviews: orgTotals.total_reviews,
        neg_reviews: orgTotals.neg_reviews,
        neg_rate: negRate,
        avg_rating: avgRating,
        active_signals: orgTotals.active_signals,
        high_alerts: orgTotals.high_alerts,
        published_posts: orgTotals.published_posts,
        pending_posts: orgTotals.pending_posts,
        missed_posts: orgTotals.missed_posts,
        semaphore_counts: orgTotals.semaphore_counts,
      },
      locals,
      rankings: {
        top: locals.slice(0, 3),
        bottom: [...locals].sort((a, b) => a.health_score - b.health_score || a.name.localeCompare(b.name)).slice(0, 3),
      },
      request_id: requestId,
    },
    requestId,
    200,
  );
}
