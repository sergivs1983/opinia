export type MetricsSummaryTotals = {
  replies_generated: number;
  replies_approved: number;
  assets_created: number;
  planner_published: number;
  ai_cost_cents?: number;
  ai_tokens_in?: number;
  ai_tokens_out?: number;
  time_saved_minutes_est: number;
};

export type MetricsSummarySeriesPoint = {
  day: string;
  replies_generated: number;
  planner_published: number;
  ai_cost_cents?: number;
  ai_tokens_in?: number;
  ai_tokens_out?: number;
  avg_rating?: number | null;
  sentiment_negative_pct?: number | null;
};

export type MetricsSummaryHighlight = {
  label: string;
  value: number | null;
  delta?: number | null;
};

export type MetricsSummaryValue = {
  time_saved_hours: number;
  time_saved_minutes: number;
  streak_weeks: number;
  benchmark: {
    metric: 'posts_published' | 'replies_generated';
    label: string;
    status: 'estimate' | 'data';
    percentile?: number | null;
  };
};

export type MetricsSummaryResponse = {
  rangeDays: number;
  totals: MetricsSummaryTotals;
  series: MetricsSummarySeriesPoint[];
  highlights: MetricsSummaryHighlight[];
  value: MetricsSummaryValue;
  request_id: string;
};

export function filterMetricsSummaryForViewer(
  summary: MetricsSummaryResponse,
  admin: boolean,
): MetricsSummaryResponse & { admin: boolean } {
  if (admin) return { ...summary, admin: true };

  const { ai_cost_cents: _cost, ai_tokens_in: _in, ai_tokens_out: _out, ...totals } = summary.totals;
  const series = summary.series.map(({ ai_cost_cents: _seriesCost, ai_tokens_in: _seriesIn, ai_tokens_out: _seriesOut, ...rest }) => rest);

  return {
    ...summary,
    admin: false,
    totals,
    series,
  };
}
