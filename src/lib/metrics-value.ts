import { createAdminClient } from '@/lib/supabase/admin';
import { getWeekStartMondayFromDate } from '@/lib/planner';

export const MIN_PER_GENERATED = 2.0;
export const MIN_PER_APPROVED = 0.5;
export const WEEK_PUBLISH_THRESHOLD = 2;
export const MIN_BIZ_FOR_BENCH = 20;

export type BenchmarkMetricKey = 'planner_items_published' | 'replies_generated';
export type BenchmarkMetric = 'posts_published' | 'replies_generated';
export type BenchmarkStatus = 'estimate' | 'data';

export interface MetricsValueBenchmark {
  metric: BenchmarkMetric;
  label: string;
  status: BenchmarkStatus;
  percentile?: number | null;
}

export interface MetricsValueData {
  time_saved_hours: number;
  time_saved_minutes: number;
  streak_weeks: number;
  benchmark: MetricsValueBenchmark;
}

export interface TimeSavedInput {
  replies_generated: number;
  replies_approved: number;
}

export interface TimeSavedOutput {
  hours: number;
  rawMinutes: number;
}

export interface StreakDayPoint {
  day: string;
  planner_items_published?: number;
  planner_published?: number;
}

type BenchmarkAggregateRow = {
  business_id: string;
  replies_generated: number;
  planner_items_published: number;
};

interface BenchmarkLogger {
  warn: (message: string, data?: Record<string, unknown>) => void;
}

interface ComputeBenchmarksArgs {
  businessId: string;
  rangeDays: number;
  metricKey: BenchmarkMetricKey;
  admin?: ReturnType<typeof createAdminClient>;
  now?: () => Date;
  log?: BenchmarkLogger;
  loadAggregates?: (args: {
    admin: ReturnType<typeof createAdminClient>;
    metricKey: BenchmarkMetricKey;
    startDay: string;
    endDay: string;
  }) => Promise<Array<{ business_id: string; value: number }>>;
}

function toIsoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function clampCounter(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

function clampRangeDays(value: number): number {
  if (!Number.isFinite(value)) return 30;
  return Math.max(1, Math.min(90, Math.round(value)));
}

function normalizeMetricName(metricKey: BenchmarkMetricKey): BenchmarkMetric {
  return metricKey === 'planner_items_published' ? 'posts_published' : 'replies_generated';
}

function benchmarkEstimate(metricKey: BenchmarkMetricKey): MetricsValueBenchmark {
  return {
    metric: normalizeMetricName(metricKey),
    label: 'Estimació: continua publicant per tenir comparació',
    status: 'estimate',
    percentile: null,
  };
}

function benchmarkDataLabel(percentile: number): string {
  if (percentile >= 70) return 'Per sobre de la mitjana';
  if (percentile >= 40) return 'A la mitjana';
  return 'Per sota de la mitjana';
}

function resolveRange(rangeDays: number, now: Date): { startDay: string; endDay: string } {
  const normalized = clampRangeDays(rangeDays);
  const end = new Date(now);
  end.setHours(0, 0, 0, 0);

  const start = new Date(end);
  start.setDate(start.getDate() - (normalized - 1));

  return { startDay: toIsoDay(start), endDay: toIsoDay(end) };
}

async function defaultLoadAggregates(args: {
  admin: ReturnType<typeof createAdminClient>;
  metricKey: BenchmarkMetricKey;
  startDay: string;
  endDay: string;
}): Promise<Array<{ business_id: string; value: number }>> {
  const { data, error } = await args.admin
    .from('metrics_daily')
    .select('business_id, replies_generated, planner_items_published')
    .gte('day', args.startDay)
    .lte('day', args.endDay);

  if (error) throw error;

  const rows = (data || []) as BenchmarkAggregateRow[];
  const totals = new Map<string, number>();

  for (const row of rows) {
    const key = row.business_id;
    const value = args.metricKey === 'planner_items_published'
      ? clampCounter(row.planner_items_published)
      : clampCounter(row.replies_generated);
    totals.set(key, (totals.get(key) || 0) + value);
  }

  return Array.from(totals.entries()).map(([business_id, value]) => ({ business_id, value }));
}

export function computeTimeSavedHours(totals: TimeSavedInput): TimeSavedOutput {
  const generated = clampCounter(totals.replies_generated);
  const approved = clampCounter(totals.replies_approved);
  const rawMinutes = Number((generated * MIN_PER_GENERATED + approved * MIN_PER_APPROVED).toFixed(1));
  const hours = Number((rawMinutes / 60).toFixed(1));
  return { hours, rawMinutes };
}

export function computeStreakWeeks(
  seriesDaily: StreakDayPoint[],
  options: { now?: () => Date } = {},
): number {
  const weekTotals = new Map<string, number>();

  for (const point of seriesDaily) {
    if (!point?.day) continue;
    const parsed = new Date(`${point.day}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) continue;

    const weekStart = getWeekStartMondayFromDate(parsed);
    const published = clampCounter(point.planner_items_published ?? point.planner_published ?? 0);
    weekTotals.set(weekStart, (weekTotals.get(weekStart) || 0) + published);
  }

  const now = options.now ? options.now() : new Date();
  const cursor = new Date(`${getWeekStartMondayFromDate(now)}T00:00:00.000Z`);
  if (Number.isNaN(cursor.getTime())) return 0;

  let streak = 0;
  while (true) {
    const weekStart = toIsoDay(cursor);
    const published = weekTotals.get(weekStart) || 0;
    if (published < WEEK_PUBLISH_THRESHOLD) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 7);
  }

  return streak;
}

export async function computeBenchmarks(args: ComputeBenchmarksArgs): Promise<MetricsValueBenchmark> {
  const admin = args.admin || createAdminClient();
  const now = args.now ? args.now() : new Date();
  const { startDay, endDay } = resolveRange(args.rangeDays, now);
  const loadAggregates = args.loadAggregates || defaultLoadAggregates;

  try {
    const totalsByBusiness = await loadAggregates({
      admin,
      metricKey: args.metricKey,
      startDay,
      endDay,
    });

    const activeBusinesses = totalsByBusiness
      .map((row) => ({ business_id: row.business_id, value: clampCounter(row.value) }))
      .filter((row) => row.value > 0);

    if (activeBusinesses.length < MIN_BIZ_FOR_BENCH) {
      return benchmarkEstimate(args.metricKey);
    }

    const metric = normalizeMetricName(args.metricKey);
    const selfValue = activeBusinesses.find((row) => row.business_id === args.businessId)?.value || 0;
    const values = activeBusinesses.map((row) => row.value);
    const below = values.filter((value) => value < selfValue).length;
    const equal = values.filter((value) => value === selfValue).length;
    const percentile = Math.round(((below + Math.max(0, equal - 1) / 2) / values.length) * 100);

    return {
      metric,
      label: benchmarkDataLabel(percentile),
      status: 'data',
      percentile,
    };
  } catch (error: unknown) {
    args.log?.warn('Failed to compute benchmark (fallback estimate)', {
      business_id: args.businessId,
      metric_key: args.metricKey,
      start_day: startDay,
      end_day: endDay,
      error: error instanceof Error ? error.message : String(error),
    });
    return benchmarkEstimate(args.metricKey);
  }
}
