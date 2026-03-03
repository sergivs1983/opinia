export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { requireBizAccessPatternB } from '@/lib/api-handler';
import { createLogger, createRequestId } from '@/lib/logger';
import { isAdminViewer } from '@/lib/authz';
import {
  computeBenchmarks,
  computeStreakWeeks,
  computeTimeSavedHours,
} from '@/lib/metrics-value';
import {
  filterMetricsSummaryForViewer,
  type MetricsSummaryResponse,
  type MetricsSummarySeriesPoint,
  type MetricsSummaryTotals,
} from '@/lib/metrics-summary';
import {
  validateQuery,
  MetricsSummaryQuerySchema,
} from '@/lib/validations';
import type { Sentiment } from '@/types/database';
import { rateLimitStandard } from '@/lib/security/ratelimit';

type MetricsSummaryQuery = {
  range: '7' | '30' | '90';
};

type MetricsDailyRow = {
  day: string;
  replies_generated: number;
  replies_approved: number;
  planner_items_published: number;
  assets_created: number;
  ai_cost_cents: number;
};

type ReviewRatingRow = {
  created_at: string;
  rating: number;
  sentiment: Sentiment;
};

type BusinessAccessRow = {
  id: string;
  org_id: string | null;
};

type SupabaseErrorLike = {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
};

const missingDependencyCodes = new Set(['PGRST204', 'PGRST205', '42P01', '42703', '42883']);

function hasMissingDependencyPattern(value: string): boolean {
  return (
    /schema cache/i.test(value) ||
    /relation .* does not exist/i.test(value) ||
    /table .* does not exist/i.test(value) ||
    /column .* does not exist/i.test(value) ||
    /function .* does not exist/i.test(value)
  );
}

function isMissingDependencyError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as SupabaseErrorLike;
  if (err.code && missingDependencyCodes.has(err.code)) return true;
  const message = `${err.message || ''} ${err.details || ''} ${err.hint || ''}`.trim();
  return message.length > 0 && hasMissingDependencyPattern(message);
}

function toIsoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function dayWindow(rangeDays: number): string[] {
  const days: string[] = [];
  const now = new Date();
  for (let i = rangeDays - 1; i >= 0; i -= 1) {
    const day = new Date(now);
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - i);
    days.push(toIsoDay(day));
  }
  return days;
}

function percentDelta(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

async function loadBusinessAccess(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  businessId: string,
): Promise<BusinessAccessRow | null> {
  const { data, error } = await supabase
    .from('businesses')
    .select('id, org_id')
    .eq('id', businessId)
    .single();
  if (error || !data) return null;
  return data as BusinessAccessRow;
}

function sumTotals(rows: MetricsDailyRow[]): MetricsSummaryTotals {
  return rows.reduce<MetricsSummaryTotals>(
    (acc, row) => ({
      replies_generated: acc.replies_generated + (row.replies_generated || 0),
      replies_approved: acc.replies_approved + (row.replies_approved || 0),
      assets_created: acc.assets_created + (row.assets_created || 0),
      planner_published: acc.planner_published + (row.planner_items_published || 0),
      ai_cost_cents: (acc.ai_cost_cents || 0) + (row.ai_cost_cents || 0),
      time_saved_minutes_est: 0,
    }),
    {
      replies_generated: 0,
      replies_approved: 0,
      assets_created: 0,
      planner_published: 0,
      ai_cost_cents: 0,
      time_saved_minutes_est: 0,
    },
  );
}

function buildStubSummary(rangeDays: number, days: string[], requestId: string): MetricsSummaryResponse & {
  ok: true;
  stub: true;
  range: number;
} {
  return {
    ok: true,
    stub: true,
    range: rangeDays,
    rangeDays,
    totals: {
      replies_generated: 0,
      replies_approved: 0,
      assets_created: 0,
      planner_published: 0,
      ai_cost_cents: 0,
      time_saved_minutes_est: 0,
    },
    series: days.map((day) => ({
      day,
      replies_generated: 0,
      planner_published: 0,
      ai_cost_cents: 0,
      avg_rating: null,
      sentiment_negative_pct: null,
    })),
    highlights: [
      { label: 'replies_generated', value: 0, delta: null },
      { label: 'planner_published', value: 0, delta: null },
      { label: 'assets_created', value: 0, delta: null },
      { label: 'avg_rating_or_sentiment_proxy', value: null, delta: null },
    ],
    value: {
      time_saved_hours: 0,
      time_saved_minutes: 0,
      streak_weeks: 0,
      benchmark: {
        metric: 'posts_published',
        label: 'Estimació: continua publicant per tenir comparació',
        status: 'estimate',
        percentile: null,
      },
    },
    request_id: requestId,
  };
}

export async function GET(request: Request) {
  const requestId = request.headers.get('x-request-id')?.trim() || createRequestId();
  const log = createLogger({ request_id: requestId, route: '/api/metrics/summary' });

  const withResponseRequestId = (response: NextResponse) => {
    response.headers.set('x-request-id', requestId);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  };

  try {
    const supabase = createServerSupabaseClient();

    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return withResponseRequestId(NextResponse.json({ error: 'unauthorized', message: 'Auth required', request_id: requestId }, { status: 401 }));
    }

    const [query, queryErr] = validateQuery(request, MetricsSummaryQuerySchema);
    if (queryErr) return withResponseRequestId(queryErr);

    const payload = query as MetricsSummaryQuery;
    const rangeDays = Number(payload.range || '30');

    const businessId = request.headers.get('x-biz-id')?.trim();
    const access = await requireBizAccessPatternB(request, businessId, {
      supabase,
      user,
      headerBizId: businessId || null,
    });
    if (access instanceof NextResponse) return withResponseRequestId(access);

    // ── Bloc 8: Standard rate limit ──
    const rlKey = `${access.bizId}:${user.id}`;
    const rl = await rateLimitStandard(rlKey);
    if (!rl.ok) return withResponseRequestId(rl.res);

    const business = await loadBusinessAccess(supabase, access.bizId);
    if (!business) {
      return withResponseRequestId(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
      );
    }
    const admin = isAdminViewer({ user, orgId: business.org_id, businessId: access.bizId });

    const days = dayWindow(rangeDays);
    const startDay = days[0];
    const endDay = days[days.length - 1];

    const { data: summaryRowsData, error: summaryRowsError } = await supabase
      .from('metrics_daily')
      .select('day, replies_generated, replies_approved, planner_items_published, assets_created, ai_cost_cents')
      .eq('business_id', access.bizId)
      .gte('day', startDay)
      .lte('day', endDay)
      .order('day', { ascending: true });

    if (summaryRowsError) {
      if (isMissingDependencyError(summaryRowsError)) {
        log.warn('missing_dependency metrics summary source', {
          error_code: summaryRowsError.code || null,
          error: summaryRowsError.message || null,
          business_id: access.bizId,
          request_id: requestId,
        });
        const stubSummary = filterMetricsSummaryForViewer(
          buildStubSummary(rangeDays, days, requestId),
          admin,
        );
        return withResponseRequestId(NextResponse.json(stubSummary));
      }
      log.error('Failed to load metrics summary rows', { error: summaryRowsError.message, business_id: access.bizId });
      return withResponseRequestId(
        NextResponse.json({ error: 'db_error', message: 'Failed to load metrics summary', request_id: requestId }, { status: 500 }),
      );
    }

    const rows = (summaryRowsData || []) as MetricsDailyRow[];
    const rowsByDay = new Map(rows.map((row) => [row.day, row]));

    const startIso = `${startDay}T00:00:00.000Z`;
    const { data: reviewsData, error: reviewsError } = await supabase
      .from('reviews')
      .select('created_at, rating, sentiment')
      .eq('biz_id', access.bizId)
      .gte('created_at', startIso);

    if (reviewsError) {
      log.warn('Failed to load reviews for rating proxy (non-blocking)', { error: reviewsError.message, business_id: access.bizId });
    }

    const ratingsMap = new Map<string, { count: number; sum: number; negative: number }>();
    for (const day of days) {
      ratingsMap.set(day, { count: 0, sum: 0, negative: 0 });
    }

    for (const row of (reviewsData || []) as ReviewRatingRow[]) {
      const day = row.created_at?.slice(0, 10);
      const slot = day ? ratingsMap.get(day) : null;
      if (!slot) continue;
      slot.count += 1;
      slot.sum += Number(row.rating || 0);
      if (row.sentiment === 'negative') slot.negative += 1;
      ratingsMap.set(day, slot);
    }

    const paddedRows: MetricsDailyRow[] = days.map((day) => {
      const row = rowsByDay.get(day);
      return {
        day,
        replies_generated: row?.replies_generated || 0,
        replies_approved: row?.replies_approved || 0,
        planner_items_published: row?.planner_items_published || 0,
        assets_created: row?.assets_created || 0,
        ai_cost_cents: row?.ai_cost_cents || 0,
      };
    });

    const totals = sumTotals(paddedRows);
    const timeSaved = computeTimeSavedHours({
      replies_generated: totals.replies_generated,
      replies_approved: totals.replies_approved,
    });
    totals.time_saved_minutes_est = timeSaved.rawMinutes;

    const series: MetricsSummarySeriesPoint[] = paddedRows.map((row) => {
      const ratingSlot = ratingsMap.get(row.day);
      const avgRating = ratingSlot && ratingSlot.count > 0
        ? Number((ratingSlot.sum / ratingSlot.count).toFixed(2))
        : null;
      const sentimentNegativePct = ratingSlot && ratingSlot.count > 0
        ? Number(((ratingSlot.negative / ratingSlot.count) * 100).toFixed(1))
        : null;

      return {
        day: row.day,
        replies_generated: row.replies_generated,
        planner_published: row.planner_items_published,
        ai_cost_cents: row.ai_cost_cents,
        avg_rating: avgRating,
        sentiment_negative_pct: sentimentNegativePct,
      };
    });

    const now = new Date();
    const previousEnd = new Date(now);
    previousEnd.setHours(0, 0, 0, 0);
    previousEnd.setDate(previousEnd.getDate() - rangeDays);

    const previousStart = new Date(previousEnd);
    previousStart.setDate(previousStart.getDate() - (rangeDays - 1));

    const { data: previousRowsData } = await supabase
      .from('metrics_daily')
      .select('replies_generated, planner_items_published, assets_created')
      .eq('business_id', access.bizId)
      .gte('day', toIsoDay(previousStart))
      .lte('day', toIsoDay(previousEnd));

    const previousRows = (previousRowsData || []) as Array<{
      replies_generated: number;
      planner_items_published: number;
      assets_created: number;
    }>;

    const previousRepliesGenerated = previousRows.reduce((acc, row) => acc + (row.replies_generated || 0), 0);
    const previousPlannerPublished = previousRows.reduce((acc, row) => acc + (row.planner_items_published || 0), 0);
    const previousAssetsCreated = previousRows.reduce((acc, row) => acc + (row.assets_created || 0), 0);

    const highlights = [
      {
        label: 'replies_generated',
        value: totals.replies_generated,
        delta: percentDelta(totals.replies_generated, previousRepliesGenerated),
      },
      {
        label: 'planner_published',
        value: totals.planner_published,
        delta: percentDelta(totals.planner_published, previousPlannerPublished),
      },
      {
        label: 'assets_created',
        value: totals.assets_created,
        delta: percentDelta(totals.assets_created, previousAssetsCreated),
      },
      {
        label: 'avg_rating_or_sentiment_proxy',
        value: (() => {
          const ratedDays = series.filter((point) => typeof point.avg_rating === 'number');
          if (ratedDays.length > 0) {
            const avg = ratedDays.reduce((acc, point) => acc + (point.avg_rating || 0), 0) / ratedDays.length;
            return Number(avg.toFixed(2));
          }
          const sentimentDays = series.filter((point) => typeof point.sentiment_negative_pct === 'number');
          if (sentimentDays.length === 0) return null;
          const negativeAvg = sentimentDays.reduce((acc, point) => acc + (point.sentiment_negative_pct || 0), 0) / sentimentDays.length;
          return Number(negativeAvg.toFixed(1));
        })(),
      },
    ];

    const streakWeeks = computeStreakWeeks(
      series.map((point) => ({
        day: point.day,
        planner_published: point.planner_published,
      })),
    );

    const benchmark = await computeBenchmarks({
      businessId: access.bizId,
      rangeDays,
      metricKey: 'planner_items_published',
      admin: supabase,
      log,
    });

    const filteredSummary = filterMetricsSummaryForViewer(
      {
        rangeDays,
        totals,
        series,
        highlights,
        value: {
          time_saved_hours: timeSaved.hours,
          time_saved_minutes: timeSaved.rawMinutes,
          streak_weeks: streakWeeks,
          benchmark,
        },
        request_id: requestId,
      } satisfies MetricsSummaryResponse,
      admin,
    );

    return withResponseRequestId(
      NextResponse.json(filteredSummary),
    );
  } catch (error: unknown) {
    if (isMissingDependencyError(error)) {
      const [query] = validateQuery(request, MetricsSummaryQuerySchema);
      const rangeDays = Number((query as MetricsSummaryQuery | null)?.range || '30');
      const days = dayWindow(rangeDays);
      log.warn('missing_dependency metrics summary fallback from exception', {
        error: error instanceof Error ? error.message : String(error),
        request_id: requestId,
      });
      return withResponseRequestId(NextResponse.json(buildStubSummary(rangeDays, days, requestId)));
    }
    const message = error instanceof Error ? error.message : 'Unknown';
    log.error('Unhandled metrics summary error', { error: message });
    return withResponseRequestId(
      NextResponse.json(
        { error: 'internal_error', message: 'Error intern del servidor', request_id: requestId },
        { status: 500 },
      ),
    );
  }
}
