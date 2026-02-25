'use client';

export const dynamic = 'force-dynamic';


import { useState, useEffect } from 'react';
import { useT } from '@/components/i18n/I18nContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import Button from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { glass, glassStrong } from '@/components/ui/glass';
import { TOPIC_LABELS, TOPIC_ICONS } from '@/types/database';
import type { InsightsSummary } from '@/types/database';

const RANGES = [
  { value: 30, label: '30 dies' },
  { value: 90, label: '90 dies' },
];

const SOURCES = [
  { value: 'all', label: 'Totes' },
  { value: 'google', label: 'Google' },
  { value: 'manual', label: 'Manual' },
  { value: 'tripadvisor', label: 'TripAdvisor' },
  { value: 'booking', label: 'Booking' },
];

export default function InsightsPage() {
  const t = useT();
  const { biz } = useWorkspace();
  const [data, setData] = useState<InsightsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState(30);
  const [source, setSource] = useState('all');
  const [ratingFilter, setRatingFilter] = useState<number | null>(null);

  useEffect(() => {
    if (!biz) return;
    loadInsights();
  }, [biz, range, source, ratingFilter]);

  const loadInsights = async () => {
    if (!biz) return;
    setLoading(true);
    const params = new URLSearchParams({
      biz_id: biz.id,
      range: range.toString(),
    });
    if (source !== 'all') params.set('source', source);
    if (ratingFilter) params.set('rating', ratingFilter.toString());

    try {
      const res = await fetch(`/api/insights/summary?${params}`);
      const json = await res.json();
      setData(json);
    } catch (e) {
      console.error('Insights load error:', e);
    }
    setLoading(false);
  };

  const topicLabel = (t: string) => TOPIC_LABELS[t] || t;
  const topicIcon = (t: string) => TOPIC_ICONS[t] || '📝';

  if (!biz) return <div className="p-8 text-center text-white/70">Selecciona un negoci</div>;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display font-bold text-lg text-white/90">{t('dashboard.insights.title')}</h1>
          <p className="text-sm text-white/70">Què agrada i què molesta als teus clients</p>
        </div>
        {data && (
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-2xl font-bold text-white/90">{data.avg_rating.toFixed(1)}★</p>
              <p className="text-xs text-white/70">{data.total_reviews} ressenyes</p>
            </div>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        {/* Range */}
        <div className="flex gap-1">
          {RANGES.map(r => (
            <button key={r.value} onClick={() => setRange(r.value)}
              className={cn('px-3 py-1.5 rounded-lg text-xs font-medium border transition-all',
                range === r.value ? 'border-brand-accent/45 bg-brand-accent/20 text-emerald-300' : 'border-white/14 bg-white/8 text-white/72 hover:border-white/24')}>
              {r.label}
            </button>
          ))}
        </div>

        <div className="w-px h-5 bg-white/14" />

        {/* Source */}
        <div className="flex gap-1">
          {SOURCES.map(s => (
            <button key={s.value} onClick={() => setSource(s.value)}
              className={cn('px-3 py-1.5 rounded-lg text-xs font-medium border transition-all',
                source === s.value ? 'border-brand-accent/45 bg-brand-accent/20 text-emerald-300' : 'border-white/14 bg-white/8 text-white/72 hover:border-white/24')}>
              {s.label}
            </button>
          ))}
        </div>

        <div className="w-px h-5 bg-white/14" />

        {/* Rating */}
        <div className="flex gap-1">
          <button onClick={() => setRatingFilter(null)}
            className={cn('px-3 py-1.5 rounded-lg text-xs font-medium border transition-all',
              !ratingFilter ? 'border-brand-accent/45 bg-brand-accent/20 text-emerald-300' : 'border-white/14 bg-white/8 text-white/72 hover:border-white/24')}>
            Tot
          </button>
          {[5, 4, 3, 2, 1].map(r => (
            <button key={r} onClick={() => setRatingFilter(ratingFilter === r ? null : r)}
              className={cn('px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all',
                ratingFilter === r ? 'border-brand-accent/45 bg-brand-accent/20 text-emerald-300' : 'border-white/14 bg-white/8 text-white/72 hover:border-white/24')}>
              {r}★
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="grid md:grid-cols-2 gap-6">
          {[0,1].map(i => <div key={i} className="h-72 bg-white/10 rounded-2xl animate-pulse" />)}
          <div className="md:col-span-2 h-48 bg-white/10 rounded-2xl animate-pulse" />
        </div>
      ) : !data || data.total_reviews === 0 ? (
        <div className={`${glass} border border-white/10 p-12 text-center shadow-glass`}>
          <p className="text-3xl mb-3">📊</p>
          <p className="font-medium text-white/90 mb-1">Encara no hi ha dades</p>
          <p className="text-sm text-white/70 mb-4">Genera respostes per a les teves ressenyes i els insights apareixeran aquí automàticament.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Praises + Complaints */}
          <div className="grid md:grid-cols-2 gap-6">
            {/* PRAISES */}
            <div className={`${glassStrong} border border-white/10 p-5 shadow-glass`}>
              <div className="flex items-center gap-2 mb-4">
                <span className="w-8 h-8 rounded-full bg-emerald-500/18 flex items-center justify-center text-sm">👍</span>
                <div>
                  <p className="font-semibold text-white/90 text-sm">El que agrada més</p>
                  <p className="text-xs text-white/60">Top coses positives</p>
                </div>
              </div>

              {data.top_praises.length === 0 ? (
                <p className="text-sm text-white/70 py-4 text-center">Encara no s&apos;han detectat elogis</p>
              ) : (
                <div className="space-y-3">
                  {data.top_praises.map((p, i) => (
                    <div key={p.topic} className="flex items-center gap-3">
                      <span className="text-lg w-6 text-center">{topicIcon(p.topic)}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-white/90">{topicLabel(p.topic)}</span>
                          <span className="text-xs text-white/60">{p.count}× ({p.pct}%)</span>
                        </div>
                        <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                          <div className="h-full bg-emerald-400 rounded-full transition-all duration-500"
                            style={{ width: `${Math.min(p.pct * 2, 100)}%` }} />
                        </div>
                      </div>
                      <span className="text-xs font-medium text-emerald-600">{p.avg_rating.toFixed(1)}★</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* COMPLAINTS */}
            <div className={`${glassStrong} border border-white/10 p-5 shadow-glass`}>
              <div className="flex items-center gap-2 mb-4">
                <span className="w-8 h-8 rounded-full bg-red-500/18 flex items-center justify-center text-sm">👎</span>
                <div>
                  <p className="font-semibold text-white/90 text-sm">El que molesta més</p>
                  <p className="text-xs text-white/60">Punts de millora</p>
                </div>
              </div>

              {data.top_complaints.length === 0 ? (
                <p className="text-sm text-white/70 py-4 text-center">Encara no s&apos;han detectat queixes</p>
              ) : (
                <div className="space-y-3">
                  {data.top_complaints.map((c, i) => (
                    <div key={c.topic} className="flex items-center gap-3">
                      <span className="text-lg w-6 text-center">{topicIcon(c.topic)}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-white/90">{topicLabel(c.topic)}</span>
                          <div className="flex items-center gap-1.5">
                            {c.urgency_high_count > 0 && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-bold">
                                {c.urgency_high_count} urgent
                              </span>
                            )}
                            <span className="text-xs text-white/60">{c.count}× ({c.pct}%)</span>
                          </div>
                        </div>
                        <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                          <div className="h-full bg-red-400 rounded-full transition-all duration-500"
                            style={{ width: `${Math.min(c.pct * 2, 100)}%` }} />
                        </div>
                      </div>
                      <span className="text-xs font-medium text-red-600">{c.avg_rating.toFixed(1)}★</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Timeline */}
          <div className={`${glassStrong} border border-white/10 p-5 shadow-glass`}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="font-semibold text-white/90 text-sm">Tendència</p>
                <p className="text-xs text-white/60">Elogis vs queixes per setmana</p>
              </div>
            </div>

            {data.timeline.length === 0 ? (
              <p className="text-sm text-white/70 py-4 text-center">{t('dashboard.insights.noData')}</p>
            ) : (
              <div className="space-y-3">
                {/* Chart header */}
                <div className="flex items-center gap-4 text-xs text-white/60">
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-400" /> Elogis</span>
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-400" /> Queixes</span>
                </div>

                {/* Bar chart */}
                <div className="flex items-end gap-2 h-32">
                  {data.timeline.map((t, i) => {
                    const maxVal = Math.max(...data.timeline.map(x => Math.max(x.praises_count, x.complaints_count)), 1);
                    const praiseH = (t.praises_count / maxVal) * 100;
                    const complaintH = (t.complaints_count / maxVal) * 100;

                    return (
                      <div key={i} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                        <div className="flex gap-0.5 items-end h-24 w-full justify-center">
                          <div className="w-[45%] bg-emerald-400 rounded-t transition-all duration-500 min-h-[2px]"
                            style={{ height: `${Math.max(praiseH, 2)}%` }}
                            title={`${t.praises_count} elogis`} />
                          <div className="w-[45%] bg-red-400 rounded-t transition-all duration-500 min-h-[2px]"
                            style={{ height: `${Math.max(complaintH, 2)}%` }}
                            title={`${t.complaints_count} queixes`} />
                        </div>
                        <span className="text-[9px] text-white/55 truncate w-full text-center">
                          {new Date(t.date_bucket).toLocaleDateString('ca', { day: 'numeric', month: 'short' })}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Export */}
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => exportCSV(data)}>
              📥 Exportar CSV
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function exportCSV(data: InsightsSummary) {
  const lines = ['Tipus,Tema,Mencions,%,Rating Mitjà,Urgents'];

  for (const p of data.top_praises) {
    lines.push(`Elogi,${TOPIC_LABELS[p.topic] || p.topic},${p.count},${p.pct},${p.avg_rating},0`);
  }
  for (const c of data.top_complaints) {
    lines.push(`Queixa,${TOPIC_LABELS[c.topic] || c.topic},${c.count},${c.pct},${c.avg_rating},${c.urgency_high_count}`);
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `opinia-insights-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
