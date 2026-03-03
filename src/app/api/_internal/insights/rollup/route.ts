export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireInternalGuard } from '@/lib/internal-guard';
import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { createAdminClient } from '@/lib/supabase/admin';

type BusinessRow = {
  id: string;
  org_id: string;
};

type ReviewRow = {
  id: string;
  rating: number | null;
  source: string | null;
  created_at: string;
  language_detected: string | null;
};

type ReviewTopicRow = {
  review_id: string;
  topic: string | null;
  polarity: string | null;
};

/** Accepted review sources that map to provider='google_business' */
const GOOGLE_SOURCES = ['google', 'google_business'] as const;

const BodySchema = z.object({
  biz_id: z.string().uuid(),
  provider: z.literal('google_business').default('google_business'),
  /** Anchor date YYYY-MM-DD. Defaults to UTC yesterday. */
  day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'day must be YYYY-MM-DD')
    .optional(),
  /** How many days back to process, anchored at `day`. Default 1. */
  range_days: z.number().int().min(1).max(60).optional(),
});

function jsonNoStore(body: Record<string, unknown>, requestId: string, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('x-request-id', requestId);
  return response;
}

function toDayIso(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

/** UTC yesterday as YYYY-MM-DD */
function utcYesterdayIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1))
    .toISOString()
    .slice(0, 10);
}

/** Generate all YYYY-MM-DD strings in [since, anchor] inclusive */
function buildDayRange(sinceIso: string, anchorIso: string): string[] {
  const days: string[] = [];
  const cursor = new Date(sinceIso + 'T00:00:00Z');
  const anchor = new Date(anchorIso + 'T00:00:00Z');
  while (cursor <= anchor) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function normalizeLanguage(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string') return null;
  const code = value.trim().toLowerCase();
  if (!code) return null;
  return code.slice(0, 10);
}

function normalizeTopic(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string') return null;
  const topic = value.trim().toLowerCase();
  return topic || null;
}

function normalizePolarity(value: string | null | undefined): 'pos' | 'neg' | 'neutral' {
  const v = (value || '').trim().toLowerCase();
  if (v === 'praise' || v === 'positive' || v === 'pos') return 'pos';
  if (v === 'complaint' || v === 'negative' || v === 'neg') return 'neg';
  return 'neutral';
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'POST /api/_internal/insights/rollup' });
  const rawBody = await request.text();

  const blocked = requireInternalGuard(request, {
    requestId,
    mode: 'hmac',
    rawBody,
    pathname: '/api/_internal/insights/rollup',
  });
  if (blocked) {
    blocked.headers.set('Cache-Control', 'no-store');
    blocked.headers.set('x-request-id', requestId);
    return blocked;
  }

  let payloadRaw: unknown = {};
  if (rawBody.trim().length > 0) {
    try {
      payloadRaw = JSON.parse(rawBody);
    } catch {
      return jsonNoStore({ error: 'bad_request', message: 'Invalid JSON body', request_id: requestId }, requestId, 400);
    }
  }

  const parsed = BodySchema.safeParse(payloadRaw);
  if (!parsed.success) {
    return jsonNoStore(
      { error: 'bad_request', message: parsed.error.issues[0]?.message || 'Invalid request', request_id: requestId },
      requestId,
      400,
    );
  }

  // ── Date range ──────────────────────────────────────────────────────────────
  const anchorDay = parsed.data.day ?? utcYesterdayIso();
  const rangeDays = parsed.data.range_days ?? 1;

  const anchorDate = new Date(anchorDay + 'T00:00:00Z');
  const sinceDate = new Date(anchorDate);
  sinceDate.setUTCDate(sinceDate.getUTCDate() - (rangeDays - 1));

  const sinceIso = sinceDate.toISOString();
  // Exclusive upper bound: day after anchor
  const untilDate = new Date(anchorDate);
  untilDate.setUTCDate(untilDate.getUTCDate() + 1);
  const untilIso = untilDate.toISOString();

  // All calendar days to upsert (even zero-review days)
  const allDays = buildDayRange(sinceDate.toISOString().slice(0, 10), anchorDay);

  // ── Load business ────────────────────────────────────────────────────────────
  const admin = createAdminClient();

  const { data: businessData, error: businessError } = await admin
    .from('businesses')
    .select('id, org_id')
    .eq('id', parsed.data.biz_id)
    .eq('is_active', true)
    .maybeSingle();

  if (businessError || !businessData) {
    return jsonNoStore({ error: 'not_found', request_id: requestId }, requestId, 404);
  }

  const business = businessData as BusinessRow;

  // ── Load reviews (source mapped to google_business) ──────────────────────────
  const { data: reviewsData, error: reviewsError } = await admin
    .from('reviews')
    .select('id, rating, source, created_at, language_detected')
    .eq('biz_id', parsed.data.biz_id)
    .in('source', GOOGLE_SOURCES)
    .gte('created_at', sinceIso)
    .lt('created_at', untilIso)
    .order('created_at', { ascending: true })
    .limit(5000);

  if (reviewsError) {
    log.error('insights_rollup_reviews_failed', { error: reviewsError.message, code: reviewsError.code || null });
    return jsonNoStore({ error: 'internal', request_id: requestId }, requestId, 500);
  }

  const reviews = (reviewsData || []) as ReviewRow[];
  const reviewIds = reviews.map((review) => review.id);

  // ── Load topics (optional, tolerates missing table) ───────────────────────────
  let topicRows: ReviewTopicRow[] = [];
  if (reviewIds.length > 0) {
    const { data: topicsData, error: topicsError } = await admin
      .from('review_topics')
      .select('review_id, topic, polarity')
      .in('review_id', reviewIds);

    if (!topicsError && topicsData) {
      topicRows = topicsData as ReviewTopicRow[];
    } else if (topicsError) {
      const message = (topicsError.message || '').toLowerCase();
      if (!message.includes('review_topics') && topicsError.code !== '42P01') {
        log.warn('insights_rollup_topics_failed', { error: topicsError.message, code: topicsError.code || null });
      }
    }
  }

  const topicsByReview = new Map<string, ReviewTopicRow[]>();
  for (const row of topicRows) {
    if (!topicsByReview.has(row.review_id)) topicsByReview.set(row.review_id, []);
    topicsByReview.get(row.review_id)!.push(row);
  }

  // ── Aggregate per day ────────────────────────────────────────────────────────
  type DayEntry = {
    ratingsSum: number;
    ratingsCount: number;
    newReviews: number;
    negReviews: number;
    posReviews: number;
    langDist: Record<string, number>;
    categories: Record<string, { pos: number; neg: number; neutral: number; total: number }>;
  };

  const perDay = new Map<string, DayEntry>();

  for (const review of reviews) {
    const day = toDayIso(review.created_at);
    if (!day) continue;
    if (!perDay.has(day)) {
      perDay.set(day, {
        ratingsSum: 0,
        ratingsCount: 0,
        newReviews: 0,
        negReviews: 0,
        posReviews: 0,
        langDist: {},
        categories: {},
      });
    }
    const dayEntry = perDay.get(day)!;

    dayEntry.newReviews += 1;

    const rating = typeof review.rating === 'number' && Number.isFinite(review.rating) ? review.rating : null;
    if (rating !== null) {
      dayEntry.ratingsSum += rating;
      dayEntry.ratingsCount += 1;
      if (rating <= 2) dayEntry.negReviews += 1;
      if (rating >= 4) dayEntry.posReviews += 1;
    }

    const lang = normalizeLanguage(review.language_detected);
    if (lang) {
      dayEntry.langDist[lang] = (dayEntry.langDist[lang] || 0) + 1;
    }

    const topics = topicsByReview.get(review.id) || [];
    for (const topicRow of topics) {
      const topic = normalizeTopic(topicRow.topic);
      if (!topic) continue;
      if (!dayEntry.categories[topic]) {
        dayEntry.categories[topic] = { pos: 0, neg: 0, neutral: 0, total: 0 };
      }
      const polarity = normalizePolarity(topicRow.polarity);
      dayEntry.categories[topic][polarity] += 1;
      dayEntry.categories[topic].total += 1;
    }
  }

  // ── Build upsert rows for ALL days in range (zero-fill missing days) ─────────
  const rowsToUpsert: Array<Record<string, unknown>> = [];
  const now = new Date().toISOString();

  for (const day of allDays) {
    const entry = perDay.get(day);

    if (!entry) {
      // Zero-fill: needed for inactivity signal detection
      rowsToUpsert.push({
        org_id: business.org_id,
        biz_id: business.id,
        provider: parsed.data.provider,
        day,
        metrics: { new_reviews: 0, avg_rating: null, neg_reviews: 0, pos_reviews: 0 },
        categories_summary: {},
        keywords_top: null,
        lang_dist: {},
        dominant_lang: null,
        updated_at: now,
      });
      continue;
    }

    const avgRating = entry.ratingsCount > 0 ? Number((entry.ratingsSum / entry.ratingsCount).toFixed(3)) : null;
    const metrics = {
      new_reviews: entry.newReviews,
      avg_rating: avgRating,
      neg_reviews: entry.negReviews,
      pos_reviews: entry.posReviews,
    };

    const sortedTopics = Object.entries(entry.categories)
      .sort((a, b) => (b[1].total - a[1].total) || a[0].localeCompare(b[0]))
      .map(([topic]) => topic);
    const keywordsTop = sortedTopics.slice(0, 6);

    let dominantLang: string | null = null;
    let dominantCount = -1;
    for (const [lang, count] of Object.entries(entry.langDist)) {
      if (count > dominantCount) {
        dominantCount = count;
        dominantLang = lang;
      }
    }

    rowsToUpsert.push({
      org_id: business.org_id,
      biz_id: business.id,
      provider: parsed.data.provider,
      day,
      metrics,
      categories_summary: entry.categories,
      keywords_top: keywordsTop.length > 0 ? keywordsTop : null,
      lang_dist: entry.langDist,
      dominant_lang: dominantLang,
      updated_at: now,
    });
  }

  if (rowsToUpsert.length > 0) {
    const { error: upsertError } = await admin
      .from('biz_insights_daily')
      .upsert(rowsToUpsert, { onConflict: 'biz_id,provider,day' });

    if (upsertError) {
      log.error('insights_rollup_upsert_failed', { error: upsertError.message, code: upsertError.code || null });
      return jsonNoStore({ error: 'internal', request_id: requestId }, requestId, 500);
    }
  }

  return jsonNoStore(
    {
      ok: true,
      biz_id: business.id,
      provider: parsed.data.provider,
      processed: rowsToUpsert.length,
      request_id: requestId,
    },
    requestId,
    200,
  );
}
