'use client';

import { useEffect, useMemo, useState } from 'react';
import { useT } from '@/components/i18n/I18nContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { glass, glassStrong } from '@/components/ui/glass';

type MetricsRange = '7' | '30' | '90';

type MetricsSeriesPoint = {
  day: string;
  replies_generated: number;
  planner_published: number;
  ai_cost_cents?: number;
  avg_rating?: number | null;
  sentiment_negative_pct?: number | null;
};

type MetricsSummaryPayload = {
  admin?: boolean;
  rangeDays: number;
  totals: {
    replies_generated: number;
    replies_approved: number;
    assets_created: number;
    planner_published: number;
    ai_cost_cents?: number;
    time_saved_minutes_est: number;
  };
  series: MetricsSeriesPoint[];
  highlights: Array<{ label: string; value: number | null; delta?: number | null }>;
  value: {
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
  request_id?: string;
  error?: string;
  message?: string;
};

function formatCurrency(cents: number): string {
  const amount = Number.isFinite(cents) ? cents / 100 : 0;
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(amount);
}

function formatMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0 min';
  if (minutes < 60) return `${minutes.toFixed(minutes % 1 === 0 ? 0 : 1)} min`;
  const hours = minutes / 60;
  return `${hours.toFixed(hours >= 10 ? 0 : 1)} h`;
}

function formatHours(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return '0.0 h';
  return `${hours.toFixed(1)} h`;
}

function shortDay(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return day.slice(5);
  return date.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit' });
}

function deltaText(delta: number | null | undefined): string {
  if (typeof delta !== 'number' || Number.isNaN(delta)) return '—';
  const sign = delta > 0 ? '+' : '';
  return `${sign}${delta.toFixed(1)}%`;
}

function benchmarkLabel(
  benchmark: MetricsSummaryPayload['value']['benchmark'],
  t: ReturnType<typeof useT>,
): string {
  if (benchmark.status !== 'data') return t('dashboard.metrics.benchmarkEstimate');
  const percentile = benchmark.percentile;
  if (typeof percentile !== 'number') return benchmark.label || t('dashboard.metrics.benchmarkAverage');
  if (percentile >= 70) return t('dashboard.metrics.benchmarkAbove');
  if (percentile >= 40) return t('dashboard.metrics.benchmarkAverage');
  return t('dashboard.metrics.benchmarkBelow');
}

const EMPTY_SUMMARY: MetricsSummaryPayload = {
  admin: false,
  rangeDays: 30,
  totals: {
    replies_generated: 0,
    replies_approved: 0,
    assets_created: 0,
    planner_published: 0,
    ai_cost_cents: 0,
    time_saved_minutes_est: 0,
  },
  series: [],
  highlights: [],
  value: {
    time_saved_hours: 0,
    time_saved_minutes: 0,
    streak_weeks: 0,
    benchmark: {
      metric: 'posts_published',
      label: '',
      status: 'estimate',
      percentile: null,
    },
  },
};

export default function MetricsPage() {
  const t = useT();
  const { biz } = useWorkspace();

  const [range, setRange] = useState<MetricsRange>('30');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<MetricsSummaryPayload>(EMPTY_SUMMARY);

  useEffect(() => {
    if (!biz?.id) return;
    void loadSummary();
  }, [biz?.id, range]);

  async function loadSummary() {
    if (!biz?.id) return;
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/metrics/summary?range=${range}`, {
        headers: { 'x-biz-id': biz.id },
      });

      const payload = (await response.json().catch(() => ({}))) as MetricsSummaryPayload;
      const requestId = payload.request_id || response.headers.get('x-request-id');

      if (!response.ok || payload.error) {
        const message = payload.message || t('dashboard.metrics.errorLoad');
        setSummary(EMPTY_SUMMARY);
        setError(requestId ? `${message} (ID: ${requestId})` : message);
        setLoading(false);
        return;
      }

      setSummary({
        ...EMPTY_SUMMARY,
        ...payload,
        totals: {
          ...EMPTY_SUMMARY.totals,
          ...(payload.totals || {}),
        },
        series: Array.isArray(payload.series) ? payload.series : [],
        highlights: Array.isArray(payload.highlights) ? payload.highlights : [],
        value: {
          ...EMPTY_SUMMARY.value,
          ...(payload.value || {}),
          benchmark: {
            ...EMPTY_SUMMARY.value.benchmark,
            ...(payload.value?.benchmark || {}),
          },
        },
      });
      setLoading(false);
    } catch (loadError: unknown) {
      setSummary(EMPTY_SUMMARY);
      setError(loadError instanceof Error ? loadError.message : t('dashboard.metrics.errorLoad'));
      setLoading(false);
    }
  }

  const maxSeriesValue = useMemo(() => {
    const max = summary.series.reduce((acc, point) => (
      Math.max(acc, point.replies_generated || 0, point.planner_published || 0)
    ), 0);
    return Math.max(1, max);
  }, [summary.series]);

  if (!biz) {
    return (
      <div className="flex items-center justify-center h-[60vh] text-white/55">
        <div className="text-center">
          <p className="text-3xl mb-3">📈</p>
          <p className="font-medium">{t('dashboard.metrics.selectBusiness')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <section className={`${glassStrong} p-5 space-y-4`}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-xl font-bold text-white/92">{t('dashboard.metrics.title')}</h1>
            <p className="text-sm text-white/68 mt-1">{t('dashboard.metrics.subtitle')}</p>
          </div>

          <label className="text-sm text-white/72">
            {t('dashboard.metrics.range')}
            <select
              value={range}
              onChange={(event) => setRange(event.target.value as MetricsRange)}
              className="mt-1 block w-28 rounded-xl border border-white/14 bg-white/8 px-3 py-2 text-sm"
              data-testid="metrics-range"
            >
              <option value="7">7d</option>
              <option value="30">30d</option>
              <option value="90">90d</option>
            </select>
          </label>
        </div>
      </section>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <article className={`${glass} p-4`} data-testid="metrics-card" data-testid-metric="time-saved">
          <p className="text-xs uppercase tracking-wide text-white/55 font-semibold">{t('dashboard.metrics.timeSavedHours')}</p>
          <p className="text-2xl font-bold text-white/92 mt-2" data-testid="metrics-time-saved-hours">
            {formatHours(summary.value.time_saved_hours)}
          </p>
          <p className="text-xs text-white/68 mt-1" data-testid="metrics-time-saved">
            {formatMinutes(summary.value.time_saved_minutes || summary.totals.time_saved_minutes_est)}
          </p>
        </article>

        <article className={`${glass} p-4`} data-testid="metrics-card">
          <p className="text-xs uppercase tracking-wide text-white/55 font-semibold">{t('dashboard.metrics.repliesHandled')}</p>
          <p className="text-2xl font-bold text-white/92 mt-2">{summary.totals.replies_generated}</p>
          <p className="text-xs text-white/68 mt-1">
            {t('dashboard.metrics.approved')}: {summary.totals.replies_approved}
          </p>
        </article>

        <article className={`${glass} p-4`} data-testid="metrics-card">
          <p className="text-xs uppercase tracking-wide text-white/55 font-semibold">{t('dashboard.metrics.contentPublished')}</p>
          <p className="text-2xl font-bold text-white/92 mt-2">{summary.totals.planner_published}</p>
          <p className="text-xs text-white/68 mt-1">
            {t('dashboard.metrics.assetsCreated')}: {summary.totals.assets_created}
          </p>
        </article>

        <article className={`${glass} p-4`} data-testid="metrics-card">
          <p className="text-xs uppercase tracking-wide text-white/55 font-semibold">{t('dashboard.metrics.streak')}</p>
          <p className="text-2xl font-bold text-white/92 mt-2" data-testid="metrics-streak">
            {summary.value.streak_weeks}
          </p>
          <p className="text-xs text-white/68 mt-1">{t('dashboard.metrics.streakHint')}</p>
        </article>

        {summary.admin && (
          <article className={`${glass} p-4`} data-testid="metrics-card" data-testid-metric="ai-cost">
            <p className="text-xs uppercase tracking-wide text-white/55 font-semibold">{t('dashboard.metrics.aiCost')}</p>
            <p className="text-2xl font-bold text-white/92 mt-2" data-testid="metrics-cost">
              {formatCurrency(summary.totals.ai_cost_cents || 0)}
            </p>
            <p className="text-xs text-white/68 mt-1" data-testid="metrics-admin-cost">
              {t('dashboard.metrics.aiCostHint')}
            </p>
          </article>
        )}
      </section>

      <section className={`${glassStrong} p-5`} data-testid="metrics-benchmark">
        <h2 className="font-semibold text-white/92">{t('dashboard.metrics.benchmarkTitle')}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p className="text-sm text-white/82">
            {summary.value.benchmark.status === 'data'
              ? (
                summary.value.benchmark.percentile != null
                  ? `${benchmarkLabel(summary.value.benchmark, t)} · P${summary.value.benchmark.percentile}`
                  : benchmarkLabel(summary.value.benchmark, t)
              )
              : benchmarkLabel(summary.value.benchmark, t)}
          </p>
          {summary.value.benchmark.status === 'estimate' && (
            <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
              {t('dashboard.metrics.estimateBadge')}
            </span>
          )}
        </div>
      </section>

      <section className={`${glassStrong} p-5`}>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-white/92">{t('dashboard.metrics.seriesTitle')}</h2>
          {loading && <span className="text-xs text-white/68">{t('common.loading')}</span>}
        </div>

        {summary.series.length === 0 ? (
          <p className="text-sm text-white/68 mt-4">{t('dashboard.metrics.emptySeries')}</p>
        ) : (
          <div className="mt-4" data-testid="metrics-series">
            <svg viewBox={`0 0 ${summary.series.length * 28 + 24} 140`} className="w-full h-52" role="img" aria-label="metrics-series-chart">
              <line x1="10" y1="116" x2={summary.series.length * 28 + 10} y2="116" stroke="#e2e8f0" strokeWidth="1" />
              {summary.series.map((point, index) => {
                const x = 16 + index * 28;
                const repliesHeight = Math.round((point.replies_generated / maxSeriesValue) * 78);
                const plannerHeight = Math.round((point.planner_published / maxSeriesValue) * 78);
                return (
                  <g key={point.day}>
                    <rect x={x} y={116 - repliesHeight} width="10" height={Math.max(2, repliesHeight)} fill="#2563eb" rx="2" />
                    <rect x={x + 12} y={116 - plannerHeight} width="10" height={Math.max(2, plannerHeight)} fill="#10b981" rx="2" />
                    <text x={x + 11} y="132" fontSize="8" textAnchor="middle" fill="#64748b">
                      {shortDay(point.day)}
                    </text>
                  </g>
                );
              })}
            </svg>
            <div className="flex gap-4 text-xs text-white/68 mt-2">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-blue-600" />
                {t('dashboard.metrics.legendReplies')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />
                {t('dashboard.metrics.legendPublished')}
              </span>
            </div>
          </div>
        )}
      </section>

      <section className={`${glassStrong} p-5`}>
        <h2 className="font-semibold text-white/92">{t('dashboard.metrics.highlightsTitle')}</h2>
        <div className="mt-3 grid gap-2">
          {summary.highlights.length === 0 ? (
            <p className="text-sm text-white/68">{t('dashboard.metrics.emptyHighlights')}</p>
          ) : (
            summary.highlights.map((highlight) => (
              <p key={highlight.label} className="text-sm text-white/82">
                <span className="font-medium">{highlight.label}</span>: {highlight.value ?? '—'}
                {' · '}
                <span className="text-white/68">{deltaText(highlight.delta)}</span>
              </p>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
