import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { requireBizAccess, withRequestContext } from '@/lib/api-handler';

/**
 * GET /api/insights/summary?biz_id=xxx&range=30&source=google&rating=4
 *
 * Strategy: Read from insights_daily (pre-aggregated) first.
 * If empty, fall back to live calculation from review_topics.
 * This means insights work immediately (live) and get faster as cron runs.
 */
export const GET = withRequestContext(async function(request: Request) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const bizId = searchParams.get('biz_id');
  const range = parseInt(searchParams.get('range') || '30');
  const source = searchParams.get('source');
  const ratingFilter = searchParams.get('rating');

  if (!bizId) return NextResponse.json({ error: 'bad_request', code: 'BIZ_ID_REQUIRED', message: 'biz_id és requerit' }, { status: 400 });

  // ── Biz-level guard ──────────────────────────────────────────────────────
  const bizGuard = await requireBizAccess({ supabase, userId: user.id, bizId });
  if (bizGuard) return bizGuard;

  const since = new Date();
  since.setDate(since.getDate() - range);
  const sinceDate = since.toISOString().slice(0, 10);

  // Try aggregated table first
  const { data: aggregated } = await supabase
    .from('insights_daily')
    .select('*')
    .eq('biz_id', bizId)
    .gte('date', sinceDate);

  if (aggregated && aggregated.length > 0) {
    return NextResponse.json(buildFromAggregated(aggregated, bizId, range));
  }

  // Fallback: live calculation from review_topics
  return NextResponse.json(await buildLive(supabase, bizId, range, source, ratingFilter));
});

function buildFromAggregated(rows: any[], bizId: string, range: number) {
  // Aggregate praises
  const praiseMap = new Map<string, { count: number; totalRating: number; ratingCount: number }>();
  const complaintMap = new Map<string, { count: number; totalRating: number; ratingCount: number; urgency_high: number }>();
  const timelineMap = new Map<string, { praises: number; complaints: number; totalRating: number; count: number }>();

  let totalReviews = 0;
  let totalRatingSum = 0;
  let totalRatingCount = 0;

  for (const row of rows) {
    // Praises
    if (row.praise_count > 0) {
      const e = praiseMap.get(row.topic) || { count: 0, totalRating: 0, ratingCount: 0 };
      e.count += row.praise_count;
      e.totalRating += row.avg_rating * row.praise_count;
      e.ratingCount += row.praise_count;
      praiseMap.set(row.topic, e);
    }

    // Complaints
    if (row.complaint_count > 0) {
      const e = complaintMap.get(row.topic) || { count: 0, totalRating: 0, ratingCount: 0, urgency_high: 0 };
      e.count += row.complaint_count;
      e.totalRating += row.avg_rating * row.complaint_count;
      e.ratingCount += row.complaint_count;
      e.urgency_high += row.urgency_high_count;
      complaintMap.set(row.topic, e);
    }

    // Timeline (group by week)
    const d = new Date(row.date);
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - d.getDay());
    const bucket = weekStart.toISOString().slice(0, 10);

    const t = timelineMap.get(bucket) || { praises: 0, complaints: 0, totalRating: 0, count: 0 };
    t.praises += row.praise_count;
    t.complaints += row.complaint_count;
    t.totalRating += row.avg_rating * row.total_count;
    t.count += row.total_count;
    timelineMap.set(bucket, t);

    totalReviews += row.total_count;
    totalRatingSum += row.avg_rating * row.total_count;
    totalRatingCount += row.total_count;
  }

  const totalTopics = totalReviews || 1;

  const top_praises = [...praiseMap.entries()]
    .map(([topic, d]) => ({
      topic, count: d.count,
      pct: Math.round((d.count / totalTopics) * 100),
      avg_rating: parseFloat((d.totalRating / d.ratingCount).toFixed(1)),
    }))
    .sort((a, b) => b.count - a.count).slice(0, 6);

  const top_complaints = [...complaintMap.entries()]
    .map(([topic, d]) => ({
      topic, count: d.count,
      pct: Math.round((d.count / totalTopics) * 100),
      avg_rating: parseFloat((d.totalRating / d.ratingCount).toFixed(1)),
      urgency_high_count: d.urgency_high,
    }))
    .sort((a, b) => b.count - a.count).slice(0, 6);

  const timeline = [...timelineMap.entries()]
    .map(([date_bucket, d]) => ({
      date_bucket,
      praises_count: d.praises,
      complaints_count: d.complaints,
      avg_rating: d.count > 0 ? parseFloat((d.totalRating / d.count).toFixed(1)) : 0,
    }))
    .sort((a, b) => a.date_bucket.localeCompare(b.date_bucket));

  return {
    top_praises, top_complaints, timeline,
    total_reviews: totalReviews,
    avg_rating: totalRatingCount > 0 ? parseFloat((totalRatingSum / totalRatingCount).toFixed(2)) : 0,
    period_days: range,
    source: 'aggregated',
  };
}

async function buildLive(supabase: any, bizId: string, range: number, source: string | null, ratingFilter: string | null) {
  type LiveReviewRow = {
    id: string;
    rating: number;
    source: string;
    created_at: string;
  };

  type LiveTopicRow = {
    review_id: string;
    topic: string;
    polarity: 'praise' | 'complaint' | 'neutral';
    urgency: 'low' | 'medium' | 'high' | null;
  };

  const since = new Date();
  since.setDate(since.getDate() - range);

  let reviewQuery = supabase
    .from('reviews')
    .select('id, rating, source, created_at')
    .eq('biz_id', bizId)
    .gte('created_at', since.toISOString());

  if (source && source !== 'all') reviewQuery = reviewQuery.eq('source', source);
  if (ratingFilter) reviewQuery = reviewQuery.eq('rating', parseInt(ratingFilter));

  const { data: reviews } = await reviewQuery;
  const reviewList = (reviews || []) as LiveReviewRow[];
  if (reviewList.length === 0) {
    return { top_praises: [], top_complaints: [], timeline: [], total_reviews: 0, avg_rating: 0, period_days: range, source: 'live' };
  }

  const reviewIds = reviewList.map((r) => r.id);
  const ratingMap = new Map<string, LiveReviewRow>(reviewList.map((r) => [r.id, r]));

  const { data: topics } = await supabase
    .from('review_topics')
    .select('*')
    .in('review_id', reviewIds);

  const topicList = (topics || []) as LiveTopicRow[];
  const totalTopics = topicList.length || 1;

  const praiseMap = new Map<string, { count: number; ratings: number[] }>();
  const complaintMap = new Map<string, { count: number; ratings: number[]; urgency_high: number }>();
  const timelineMap = new Map<string, { praises: number; complaints: number; ratings: number[] }>();

  for (const t of topicList) {
    const rev = ratingMap.get(t.review_id);
    const rating = rev?.rating || 3;

    if (t.polarity === 'praise') {
      const e = praiseMap.get(t.topic) || { count: 0, ratings: [] };
      e.count++; e.ratings.push(rating);
      praiseMap.set(t.topic, e);
    } else if (t.polarity === 'complaint') {
      const e = complaintMap.get(t.topic) || { count: 0, ratings: [], urgency_high: 0 };
      e.count++; e.ratings.push(rating);
      if (t.urgency === 'high') e.urgency_high++;
      complaintMap.set(t.topic, e);
    }

    if (rev) {
      const d = new Date(rev.created_at);
      const weekStart = new Date(d); weekStart.setDate(d.getDate() - d.getDay());
      const bucket = weekStart.toISOString().slice(0, 10);
      const tl = timelineMap.get(bucket) || { praises: 0, complaints: 0, ratings: [] };
      if (t.polarity === 'praise') tl.praises++;
      else if (t.polarity === 'complaint') tl.complaints++;
      tl.ratings.push(rating);
      timelineMap.set(bucket, tl);
    }
  }

  const avgArr = (a: number[]) => a.length > 0 ? parseFloat((a.reduce((x, y) => x + y, 0) / a.length).toFixed(1)) : 0;

  return {
    top_praises: [...praiseMap.entries()]
      .map(([topic, d]) => ({ topic, count: d.count, pct: Math.round((d.count / totalTopics) * 100), avg_rating: avgArr(d.ratings) }))
      .sort((a, b) => b.count - a.count).slice(0, 6),
    top_complaints: [...complaintMap.entries()]
      .map(([topic, d]) => ({ topic, count: d.count, pct: Math.round((d.count / totalTopics) * 100), avg_rating: avgArr(d.ratings), urgency_high_count: d.urgency_high }))
      .sort((a, b) => b.count - a.count).slice(0, 6),
    timeline: [...timelineMap.entries()]
      .map(([date_bucket, d]) => ({ date_bucket, praises_count: d.praises, complaints_count: d.complaints, avg_rating: avgArr(d.ratings) }))
      .sort((a, b) => a.date_bucket.localeCompare(b.date_bucket)),
    total_reviews: reviewList.length,
    avg_rating: avgArr(reviewList.map((r) => r.rating)),
    period_days: range,
    source: 'live',
  };
}
