/**
 * rebuild_insights job
 * Aggregates review_topics → insights_daily for a given biz_id.
 * Run via cron or manually after bulk imports.
 */

import type { createLogger } from '@/lib/logger';

export async function rebuildInsights(
  admin: any,
  log: ReturnType<typeof createLogger>,
  bizId: string,
  orgId: string,
  days: number = 90
): Promise<{ rows_written: number }> {
  type TopicRow = {
    topic: string;
    polarity: 'praise' | 'complaint' | 'neutral';
    urgency: 'low' | 'medium' | 'high' | null;
    created_at: string;
    review_id: string;
  };

  type ReviewRatingRow = {
    id: string;
    rating: number;
  };

  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceISO = since.toISOString();

  log.info('Rebuilding insights', { biz_id: bizId, days });

  // Load review_topics with review data
  const { data: topics } = await admin
    .from('review_topics')
    .select('topic, polarity, urgency, created_at, review_id')
    .eq('biz_id', bizId)
    .gte('created_at', sinceISO);

  const topicRows = (topics || []) as TopicRow[];

  if (topicRows.length === 0) {
    log.info('No topics found, skipping');
    return { rows_written: 0 };
  }

  // Load review ratings
  const reviewIds = [...new Set(topicRows.map((t) => t.review_id))];
  const { data: reviews } = await admin
    .from('reviews')
    .select('id, rating')
    .in('id', reviewIds);

  const reviewRows = (reviews || []) as ReviewRatingRow[];
  const ratingMap = new Map<string, number>(reviewRows.map((r) => [r.id, r.rating]));

  // Aggregate by (date, topic)
  const agg = new Map<string, {
    praise: number; complaint: number; neutral: number;
    total: number; ratings: number[]; urgency_high: number;
  }>();

  for (const t of topicRows) {
    const date = new Date(t.created_at).toISOString().slice(0, 10);
    const key = `${date}::${t.topic}`;
    const entry = agg.get(key) || {
      praise: 0, complaint: 0, neutral: 0,
      total: 0, ratings: [], urgency_high: 0,
    };

    if (t.polarity === 'praise') entry.praise++;
    else if (t.polarity === 'complaint') entry.complaint++;
    else entry.neutral++;
    entry.total++;

    const rating = ratingMap.get(t.review_id) || 3;
    entry.ratings.push(rating);
    if (t.urgency === 'high') entry.urgency_high++;

    agg.set(key, entry);
  }

  // Delete existing aggregates for this biz in range
  await admin
    .from('insights_daily')
    .delete()
    .eq('biz_id', bizId)
    .gte('date', since.toISOString().slice(0, 10));

  // Insert new aggregates
  const rows = [...agg.entries()].map(([key, d]) => {
    const [date, topic] = key.split('::');
    const avgRating = d.ratings.length > 0
      ? d.ratings.reduce((a, b) => a + b, 0) / d.ratings.length
      : 0;
    return {
      biz_id: bizId,
      org_id: orgId,
      date,
      topic,
      praise_count: d.praise,
      complaint_count: d.complaint,
      neutral_count: d.neutral,
      total_count: d.total,
      avg_rating: parseFloat(avgRating.toFixed(2)),
      urgency_high_count: d.urgency_high,
    };
  });

  if (rows.length > 0) {
    // Batch insert in chunks of 100
    for (let i = 0; i < rows.length; i += 100) {
      await admin.from('insights_daily').insert(rows.slice(i, i + 100));
    }
  }

  log.info('Insights rebuilt', { rows_written: rows.length });
  return { rows_written: rows.length };
}
