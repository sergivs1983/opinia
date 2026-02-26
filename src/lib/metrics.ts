import type { SupabaseClient } from '@supabase/supabase-js';
import type { MetricsDaily } from '@/types/database';

type LoggerLike = {
  warn: (msg: string, data?: Record<string, unknown>) => void;
  error?: (msg: string, data?: Record<string, unknown>) => void;
};

const METRIC_COLUMNS = [
  'reviews_received',
  'replies_generated',
  'replies_approved',
  'planner_items_added',
  'planner_items_published',
  'assets_created',
  'exports_created',
  'ai_cost_cents',
  'ai_tokens_in',
  'ai_tokens_out',
] as const;

export type MetricColumn = (typeof METRIC_COLUMNS)[number];

export type DailyMetricPatch = Partial<Record<MetricColumn, number>>;

export interface AiUsagePatch {
  tokensIn?: number;
  tokensOut?: number;
  costCents?: number;
}

type MetricsClient = SupabaseClient;

interface BumpMetricOptions {
  admin?: MetricsClient;
  log?: LoggerLike;
  now?: () => Date;
}

interface RebuildMetricsOptions {
  admin?: MetricsClient;
  log?: LoggerLike;
  days?: number;
}

type LlmUsageRow = {
  created_at: string;
  request_id: string;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
};

function resolveDay(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString().slice(0, 10);
  return parsed.toISOString().slice(0, 10);
}

function clampCounter(value: unknown): number {
  const num = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.round(num));
}

function sanitizePatch(patch: DailyMetricPatch): DailyMetricPatch {
  const clean: DailyMetricPatch = {};
  for (const key of METRIC_COLUMNS) {
    const value = patch[key];
    if (typeof value === 'number' && Number.isFinite(value) && value !== 0) {
      clean[key] = Math.round(value);
    }
  }
  return clean;
}

function emptyMetricRow(businessId: string, day: string, nowIso: string): MetricsDaily {
  return {
    business_id: businessId,
    day,
    reviews_received: 0,
    replies_generated: 0,
    replies_approved: 0,
    planner_items_added: 0,
    planner_items_published: 0,
    assets_created: 0,
    exports_created: 0,
    ai_cost_cents: 0,
    ai_tokens_in: 0,
    ai_tokens_out: 0,
    created_at: nowIso,
    updated_at: nowIso,
  };
}

export function mergeMetricPatch(base: MetricsDaily, patch: DailyMetricPatch, nowIso: string): MetricsDaily {
  const next = { ...base };
  for (const key of METRIC_COLUMNS) {
    const delta = patch[key];
    if (typeof delta !== 'number' || !Number.isFinite(delta) || delta === 0) continue;
    next[key] = clampCounter(next[key] + delta);
  }
  next.updated_at = nowIso;
  return next;
}

function toMetricRow(value: Partial<MetricsDaily> | null | undefined): MetricsDaily | null {
  if (!value?.business_id || !value.day) return null;
  const row = value as Partial<MetricsDaily>;
  const businessId = row.business_id as string;
  const day = row.day as string;
  return {
    business_id: businessId,
    day,
    reviews_received: clampCounter(row.reviews_received),
    replies_generated: clampCounter(row.replies_generated),
    replies_approved: clampCounter(row.replies_approved),
    planner_items_added: clampCounter(row.planner_items_added),
    planner_items_published: clampCounter(row.planner_items_published),
    assets_created: clampCounter(row.assets_created),
    exports_created: clampCounter(row.exports_created),
    ai_cost_cents: clampCounter(row.ai_cost_cents),
    ai_tokens_in: clampCounter(row.ai_tokens_in),
    ai_tokens_out: clampCounter(row.ai_tokens_out),
    created_at: typeof row.created_at === 'string' ? row.created_at : new Date().toISOString(),
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : new Date().toISOString(),
  };
}

async function loadDailyRow(
  admin: MetricsClient,
  businessId: string,
  day: string,
): Promise<MetricsDaily | null> {
  const { data, error } = await admin
    .from('metrics_daily')
    .select(
      'business_id, day, reviews_received, replies_generated, replies_approved, planner_items_added, planner_items_published, assets_created, exports_created, ai_cost_cents, ai_tokens_in, ai_tokens_out, created_at, updated_at',
    )
    .eq('business_id', businessId)
    .eq('day', day)
    .maybeSingle();

  if (error) throw error;
  return toMetricRow(data as Partial<MetricsDaily> | null);
}

/**
 * Non-blocking daily metric increment helper.
 * Uses upsert on (business_id, day) and never throws by design.
 */
export async function bumpDailyMetric(
  businessId: string,
  day: string | Date,
  patch: DailyMetricPatch,
  options: BumpMetricOptions = {},
): Promise<boolean> {
  const cleanPatch = sanitizePatch(patch);
  if (Object.keys(cleanPatch).length === 0) return true;

  const admin = options.admin;
  if (!admin) throw new Error("[metrics] admin client required — pass via options.admin");
  const log = options.log;
  const nowIso = (options.now ? options.now() : new Date()).toISOString();
  const metricDay = resolveDay(day);

  try {
    const existing = await loadDailyRow(admin, businessId, metricDay);
    const base = existing || emptyMetricRow(businessId, metricDay, nowIso);
    const next = mergeMetricPatch(base, cleanPatch, nowIso);

    const { error: upsertError } = await admin
      .from('metrics_daily')
      .upsert(next, { onConflict: 'business_id,day' });

    if (upsertError) throw upsertError;
    return true;
  } catch (error: unknown) {
    if (log) {
      log.warn('metrics bump failed (non-blocking)', {
        business_id: businessId,
        day: metricDay,
        patch: cleanPatch,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return false;
  }
}

/**
 * Adds token/cost usage to metrics_daily.
 * Non-blocking wrapper around bumpDailyMetric.
 */
export async function addAiUsage(
  businessId: string,
  day: string | Date,
  usage: AiUsagePatch,
  options: BumpMetricOptions = {},
): Promise<boolean> {
  const patch: DailyMetricPatch = {
    ai_tokens_in: usage.tokensIn || 0,
    ai_tokens_out: usage.tokensOut || 0,
    ai_cost_cents: usage.costCents || 0,
  };
  return bumpDailyMetric(businessId, day, patch, options);
}

/**
 * Reads llm_usage_events for one request_id and returns aggregate AI usage.
 */
export async function collectAiUsageByRequestId(
  businessId: string,
  requestId: string,
  options: { admin?: MetricsClient } = {},
): Promise<Required<AiUsagePatch>> {
  if (!requestId.trim()) return { tokensIn: 0, tokensOut: 0, costCents: 0 };

  const admin = options.admin;
  if (!admin) throw new Error("[metrics] admin client required — pass via options.admin");
  const { data, error } = await admin
    .from('llm_usage_events')
    .select('prompt_tokens, completion_tokens, cost_usd')
    .eq('biz_id', businessId)
    .eq('request_id', requestId)
    .eq('status', 'success');

  if (error || !data) return { tokensIn: 0, tokensOut: 0, costCents: 0 };

  const rows = data as Array<{ prompt_tokens?: number; completion_tokens?: number; cost_usd?: number }>;
  let tokensIn = 0;
  let tokensOut = 0;
  let costCents = 0;

  for (const row of rows) {
    tokensIn += clampCounter(row.prompt_tokens);
    tokensOut += clampCounter(row.completion_tokens);
    const usd = typeof row.cost_usd === 'number' ? row.cost_usd : 0;
    costCents += clampCounter(Math.round(usd * 100));
  }

  return { tokensIn, tokensOut, costCents };
}

function dayList(days: number): string[] {
  const n = Math.max(1, Math.min(90, Math.round(days)));
  const out: string[] = [];
  const now = new Date();

  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }

  return out;
}

function asDayFromTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function incrementField(
  map: Map<string, DailyMetricPatch>,
  day: string | null,
  field: MetricColumn,
  amount: number,
) {
  if (!day || !map.has(day)) return;
  const row = map.get(day) || {};
  row[field] = clampCounter((row[field] || 0) + amount);
  map.set(day, row);
}

/**
 * Rebuilds metrics snapshots for the last N days from source tables.
 * This helper is intended for manual/on-demand recovery.
 */
export async function rebuildMetricsLastDays(
  businessId: string,
  options: RebuildMetricsOptions = {},
): Promise<{ days: number; startDay: string; endDay: string; upsertedRows: number }> {
  const admin = options.admin;
  if (!admin) throw new Error("[metrics] admin client required — pass via options.admin");
  const days = Math.max(1, Math.min(90, Math.round(options.days || 30)));
  const daysList = dayList(days);
  const startDay = daysList[0];
  const endDay = daysList[daysList.length - 1];
  const startIso = `${startDay}T00:00:00.000Z`;
  const nowIso = new Date().toISOString();

  const metricsByDay = new Map<string, DailyMetricPatch>();
  for (const day of daysList) {
    metricsByDay.set(day, {});
  }

  const { data: reviewsData } = await admin
    .from('reviews')
    .select('created_at')
    .eq('biz_id', businessId)
    .gte('created_at', startIso);

  for (const row of (reviewsData || []) as Array<{ created_at?: string }>) {
    incrementField(metricsByDay, asDayFromTimestamp(row.created_at), 'reviews_received', 1);
  }

  const { data: usageData } = await admin
    .from('llm_usage_events')
    .select('created_at, request_id, prompt_tokens, completion_tokens, cost_usd')
    .eq('biz_id', businessId)
    .eq('status', 'success')
    .gte('created_at', startIso);

  const generationUniq = new Map<string, Set<string>>();
  for (const row of (usageData || []) as LlmUsageRow[]) {
    const day = asDayFromTimestamp(row.created_at);
    if (!day || !metricsByDay.has(day)) continue;

    const dayRequests = generationUniq.get(day) || new Set<string>();
    dayRequests.add(row.request_id);
    generationUniq.set(day, dayRequests);

    incrementField(metricsByDay, day, 'ai_tokens_in', clampCounter(row.prompt_tokens));
    incrementField(metricsByDay, day, 'ai_tokens_out', clampCounter(row.completion_tokens));
    incrementField(metricsByDay, day, 'ai_cost_cents', clampCounter(Math.round((row.cost_usd || 0) * 100)));
  }

  for (const [day, requestIds] of generationUniq.entries()) {
    incrementField(metricsByDay, day, 'replies_generated', requestIds.size);
  }

  const { data: approvalsData } = await admin
    .from('replies')
    .select('published_at, status')
    .eq('biz_id', businessId)
    .eq('status', 'published')
    .gte('published_at', startIso);

  for (const row of (approvalsData || []) as Array<{ published_at?: string | null }>) {
    incrementField(metricsByDay, asDayFromTimestamp(row.published_at || null), 'replies_approved', 1);
  }

  const { data: plannerData } = await admin
    .from('content_planner_items')
    .select('created_at, scheduled_at, status')
    .eq('business_id', businessId)
    .gte('created_at', startIso);

  for (const row of (plannerData || []) as Array<{ created_at?: string; scheduled_at?: string; status?: string }>) {
    incrementField(metricsByDay, asDayFromTimestamp(row.created_at), 'planner_items_added', 1);
    if (row.status === 'published') {
      incrementField(metricsByDay, asDayFromTimestamp(row.scheduled_at), 'planner_items_published', 1);
    }
  }

  const { data: assetsData } = await admin
    .from('content_assets')
    .select('created_at, status')
    .eq('business_id', businessId)
    .eq('status', 'created')
    .gte('created_at', startIso);

  for (const row of (assetsData || []) as Array<{ created_at?: string }>) {
    incrementField(metricsByDay, asDayFromTimestamp(row.created_at), 'assets_created', 1);
  }

  const { data: exportsData } = await admin
    .from('exports')
    .select('created_at')
    .eq('business_id', businessId)
    .eq('kind', 'weekly_pack')
    .gte('created_at', startIso);

  for (const row of (exportsData || []) as Array<{ created_at?: string }>) {
    incrementField(metricsByDay, asDayFromTimestamp(row.created_at), 'exports_created', 1);
  }

  const rows: MetricsDaily[] = daysList.map((day) => {
    const row = metricsByDay.get(day) || {};
    return {
      business_id: businessId,
      day,
      reviews_received: clampCounter(row.reviews_received),
      replies_generated: clampCounter(row.replies_generated),
      replies_approved: clampCounter(row.replies_approved),
      planner_items_added: clampCounter(row.planner_items_added),
      planner_items_published: clampCounter(row.planner_items_published),
      assets_created: clampCounter(row.assets_created),
      exports_created: clampCounter(row.exports_created),
      ai_cost_cents: clampCounter(row.ai_cost_cents),
      ai_tokens_in: clampCounter(row.ai_tokens_in),
      ai_tokens_out: clampCounter(row.ai_tokens_out),
      created_at: nowIso,
      updated_at: nowIso,
    };
  });

  const { error: upsertError } = await admin
    .from('metrics_daily')
    .upsert(rows, { onConflict: 'business_id,day' });

  if (upsertError) {
    if (options.log?.error) {
      options.log.error('metrics rebuild failed', {
        business_id: businessId,
        days,
        error: upsertError.message,
      });
    }
    throw upsertError;
  }

  return {
    days,
    startDay,
    endDay,
    upsertedRows: rows.length,
  };
}
