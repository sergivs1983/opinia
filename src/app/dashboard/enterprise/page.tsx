'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useMemo, useState } from 'react';

import GlassCard from '@/components/ui/GlassCard';
import { useLocale } from '@/components/i18n/I18nContext';
import { textMain, textSub } from '@/components/ui/glass';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { cn } from '@/lib/utils';

type ChannelFilter = 'all' | 'instagram' | 'tiktok' | 'facebook';

type LocalRow = {
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

type OverviewPayload = {
  ok?: boolean;
  org_rollup?: {
    locals_count: number;
    total_reviews: number;
    neg_reviews: number;
    neg_rate: number;
    avg_rating: number | null;
    active_signals: number;
    high_alerts: number;
    published_posts: number;
    pending_posts: number;
    missed_posts: number;
    semaphore_counts: {
      green: number;
      amber: number;
      red: number;
      gray: number;
    };
  };
  locals?: LocalRow[];
  rankings?: {
    top: LocalRow[];
    bottom: LocalRow[];
  };
  message?: string;
};

const COPY = {
  ca: {
    title: 'Enterprise Lite',
    subtitle: 'Visió multi-local amb rollups org, semàfor i rànquings.',
    noAccessTitle: 'Accés restringit',
    noAccessBody: 'Només membres owner/manager/staff poden veure aquest resum.',
    errorLoad: 'No s’ha pogut carregar el resum enterprise.',
    filters: {
      business: 'Negoci',
      allBusinesses: 'Tots els negocis',
      range: 'Rang',
      days: 'dies',
      channel: 'Canal',
      org: 'Organització',
    },
    channel: {
      all: 'Tots',
      instagram: 'Instagram',
      tiktok: 'TikTok',
      facebook: 'Facebook',
    },
    kpi: {
      locals: 'Locals',
      reviews: 'Ressenyes',
      avgRating: 'Mitjana ★',
      negRate: 'Ratio negatiu',
      signals: 'Signals actius',
      published: 'Posts publicats',
    },
    rankings: {
      top: 'Top locals',
      bottom: 'Locals a reforçar',
    },
    localsTitle: 'Heatmap per local',
    empty: 'No hi ha dades pel filtre actual.',
    table: {
      local: 'Local',
      traffic: 'Trànsit',
      rating: 'Rating',
      signals: 'Signals',
      posts: 'Posts',
      semaphore: 'Semàfor',
      heat: 'Heat',
      neg: 'neg',
    },
    semaphore: {
      green: 'Verd',
      amber: 'Ambre',
      red: 'Vermell',
      gray: 'Sense dades',
    },
    loading: 'Carregant...',
  },
  es: {
    title: 'Enterprise Lite',
    subtitle: 'Vista multi-local con rollups org, semáforo y rankings.',
    noAccessTitle: 'Acceso restringido',
    noAccessBody: 'Solo owner/manager/staff pueden ver este resumen.',
    errorLoad: 'No se pudo cargar el resumen enterprise.',
    filters: {
      business: 'Negocio',
      allBusinesses: 'Todos los negocios',
      range: 'Rango',
      days: 'días',
      channel: 'Canal',
      org: 'Organización',
    },
    channel: {
      all: 'Todos',
      instagram: 'Instagram',
      tiktok: 'TikTok',
      facebook: 'Facebook',
    },
    kpi: {
      locals: 'Locales',
      reviews: 'Reseñas',
      avgRating: 'Media ★',
      negRate: 'Ratio negativo',
      signals: 'Signals activos',
      published: 'Posts publicados',
    },
    rankings: {
      top: 'Top locales',
      bottom: 'Locales a reforzar',
    },
    localsTitle: 'Heatmap por local',
    empty: 'No hay datos para el filtro actual.',
    table: {
      local: 'Local',
      traffic: 'Tráfico',
      rating: 'Rating',
      signals: 'Signals',
      posts: 'Posts',
      semaphore: 'Semáforo',
      heat: 'Heat',
      neg: 'neg',
    },
    semaphore: {
      green: 'Verde',
      amber: 'Ámbar',
      red: 'Rojo',
      gray: 'Sin datos',
    },
    loading: 'Cargando...',
  },
  en: {
    title: 'Enterprise Lite',
    subtitle: 'Multi-location overview with org rollups, traffic-light status, and rankings.',
    noAccessTitle: 'Restricted access',
    noAccessBody: 'Only owner/manager/staff members can view this summary.',
    errorLoad: 'Could not load enterprise overview.',
    filters: {
      business: 'Business',
      allBusinesses: 'All businesses',
      range: 'Range',
      days: 'days',
      channel: 'Channel',
      org: 'Organization',
    },
    channel: {
      all: 'All',
      instagram: 'Instagram',
      tiktok: 'TikTok',
      facebook: 'Facebook',
    },
    kpi: {
      locals: 'Locations',
      reviews: 'Reviews',
      avgRating: 'Avg rating ★',
      negRate: 'Negative ratio',
      signals: 'Active signals',
      published: 'Published posts',
    },
    rankings: {
      top: 'Top locations',
      bottom: 'Locations to improve',
    },
    localsTitle: 'Location heatmap',
    empty: 'No data for the selected filter.',
    table: {
      local: 'Location',
      traffic: 'Traffic',
      rating: 'Rating',
      signals: 'Signals',
      posts: 'Posts',
      semaphore: 'Traffic light',
      heat: 'Heat',
      neg: 'neg',
    },
    semaphore: {
      green: 'Green',
      amber: 'Amber',
      red: 'Red',
      gray: 'No data',
    },
    loading: 'Loading...',
  },
} as const;

function formatRating(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${value.toFixed(2)}★`;
}

function formatPct(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${Math.round(value * 100)}%`;
}

function semaphoreClasses(semaphore: LocalRow['semaphore']): { dot: string; chip: string } {
  if (semaphore === 'green') {
    return {
      dot: 'bg-emerald-400 shadow-[0_0_0_4px_rgba(16,185,129,0.16)]',
      chip: 'border-emerald-300/45 bg-emerald-500/18 text-emerald-100',
    };
  }
  if (semaphore === 'amber') {
    return {
      dot: 'bg-amber-300 shadow-[0_0_0_4px_rgba(245,158,11,0.16)]',
      chip: 'border-amber-300/45 bg-amber-500/18 text-amber-100',
    };
  }
  if (semaphore === 'red') {
    return {
      dot: 'bg-rose-400 shadow-[0_0_0_4px_rgba(244,63,94,0.16)]',
      chip: 'border-rose-300/45 bg-rose-500/18 text-rose-100',
    };
  }
  return {
    dot: 'bg-slate-300 shadow-[0_0_0_4px_rgba(148,163,184,0.18)]',
    chip: 'border-slate-300/45 bg-slate-500/18 text-slate-100',
  };
}

export default function DashboardEnterprisePage() {
  const locale = useLocale();
  const copy = COPY[locale] || COPY.ca;
  const { org, membership, businesses } = useWorkspace();
  const [rangeDays, setRangeDays] = useState<number>(30);
  const [channel, setChannel] = useState<ChannelFilter>('all');
  const [bizFilter, setBizFilter] = useState<string>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<OverviewPayload | null>(null);

  const role = String(membership?.role || '').toLowerCase();
  const hasAccess = role === 'owner' || role === 'manager' || role === 'staff';

  useEffect(() => {
    setBizFilter('all');
  }, [org?.id]);

  useEffect(() => {
    if (!org?.id || !hasAccess) return;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const params = new URLSearchParams({
          org_id: org.id,
          range: String(rangeDays),
          channel,
        });
        if (bizFilter !== 'all') {
          params.set('biz_id', bizFilter);
        }

        const response = await fetch(`/api/enterprise/overview?${params.toString()}`, {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-store',
          },
        });
        const nextPayload = (await response.json().catch(() => ({}))) as OverviewPayload;
        if (!response.ok || !nextPayload.ok) {
          throw new Error(nextPayload.message || copy.errorLoad);
        }
        setPayload(nextPayload);
      } catch (loadError) {
        setPayload(null);
        setError(loadError instanceof Error ? loadError.message : copy.errorLoad);
      } finally {
        setLoading(false);
      }
    })();
  }, [bizFilter, channel, copy.errorLoad, hasAccess, org?.id, rangeDays]);

  const orgRollup = payload?.org_rollup;
  const locals = payload?.locals || [];
  const topRankings = payload?.rankings?.top || [];
  const bottomRankings = payload?.rankings?.bottom || [];

  const kpis = useMemo(
    () => [
      { label: copy.kpi.locals, value: String(orgRollup?.locals_count ?? 0) },
      { label: copy.kpi.reviews, value: String(orgRollup?.total_reviews ?? 0) },
      { label: copy.kpi.avgRating, value: formatRating(orgRollup?.avg_rating) },
      { label: copy.kpi.negRate, value: formatPct(orgRollup?.neg_rate) },
      { label: copy.kpi.signals, value: String(orgRollup?.active_signals ?? 0) },
      { label: copy.kpi.published, value: String(orgRollup?.published_posts ?? 0) },
    ],
    [copy.kpi.avgRating, copy.kpi.locals, copy.kpi.negRate, copy.kpi.published, copy.kpi.reviews, copy.kpi.signals, orgRollup?.active_signals, orgRollup?.avg_rating, orgRollup?.locals_count, orgRollup?.neg_rate, orgRollup?.published_posts, orgRollup?.total_reviews],
  );

  if (!hasAccess) {
    return (
      <div className="space-y-6 pb-16" data-testid="dashboard-enterprise-page">
        <header className="space-y-1">
          <h1 className={cn('text-2xl font-semibold md:text-3xl', textMain)}>{copy.title}</h1>
          <p className={cn('text-sm md:text-base', textSub)}>{copy.subtitle}</p>
        </header>
        <GlassCard variant="glass" className="space-y-2 p-4 md:p-5">
          <p className={cn('text-sm font-medium', textMain)}>{copy.noAccessTitle}</p>
          <p className={cn('text-sm', textSub)}>{copy.noAccessBody}</p>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-16" data-testid="dashboard-enterprise-page">
      <header className="space-y-2">
        <h1 className={cn('text-2xl font-semibold md:text-3xl', textMain)}>{copy.title}</h1>
        <p className={cn('text-sm md:text-base', textSub)}>{copy.subtitle}</p>
      </header>

      <GlassCard variant="glass" className="space-y-4 p-4 md:p-5">
        <div className="grid gap-3 md:grid-cols-4">
          <label className="space-y-1">
            <span className={cn('text-xs uppercase tracking-wide', textSub)}>{copy.filters.business}</span>
            <select
              className="w-full rounded-lg border border-white/20 bg-black/30 px-3 py-2 text-sm text-white"
              value={bizFilter}
              onChange={(event) => setBizFilter(event.target.value)}
            >
              <option value="all">{copy.filters.allBusinesses}</option>
              {businesses.map((biz) => (
                <option key={biz.id} value={biz.id}>{biz.name}</option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className={cn('text-xs uppercase tracking-wide', textSub)}>{copy.filters.range}</span>
            <select
              className="w-full rounded-lg border border-white/20 bg-black/30 px-3 py-2 text-sm text-white"
              value={String(rangeDays)}
              onChange={(event) => setRangeDays(Number(event.target.value))}
            >
              <option value="14">14 {copy.filters.days}</option>
              <option value="30">30 {copy.filters.days}</option>
              <option value="60">60 {copy.filters.days}</option>
              <option value="90">90 {copy.filters.days}</option>
            </select>
          </label>

          <label className="space-y-1">
            <span className={cn('text-xs uppercase tracking-wide', textSub)}>{copy.filters.channel}</span>
            <select
              className="w-full rounded-lg border border-white/20 bg-black/30 px-3 py-2 text-sm text-white"
              value={channel}
              onChange={(event) => setChannel(event.target.value as ChannelFilter)}
            >
              <option value="all">{copy.channel.all}</option>
              <option value="instagram">{copy.channel.instagram}</option>
              <option value="tiktok">{copy.channel.tiktok}</option>
              <option value="facebook">{copy.channel.facebook}</option>
            </select>
          </label>

          <div className="space-y-1">
            <span className={cn('text-xs uppercase tracking-wide', textSub)}>{copy.filters.org}</span>
            <div className="flex h-[42px] items-center rounded-lg border border-white/15 bg-white/5 px-3 text-sm text-white/85">
              {org?.name || '—'}
            </div>
          </div>
        </div>

        {loading ? <p className={cn('text-xs', textSub)}>{copy.loading}</p> : null}
        {error ? <p className="text-sm text-amber-300">{error}</p> : null}
      </GlassCard>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {kpis.map((item) => (
          <GlassCard key={item.label} variant="glass" className="space-y-1 p-4">
            <p className={cn('text-xs uppercase tracking-wide', textSub)}>{item.label}</p>
            <p className={cn('text-xl font-semibold', textMain)}>{item.value}</p>
          </GlassCard>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <GlassCard variant="glass" className="space-y-3 p-4 md:p-5">
          <h2 className={cn('text-sm font-semibold md:text-base', textMain)}>{copy.rankings.top}</h2>
          {topRankings.length === 0 ? (
            <p className={cn('text-sm', textSub)}>{copy.empty}</p>
          ) : (
            <div className="space-y-2">
              {topRankings.map((row) => (
                <div key={`top-${row.biz_id}`} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className={cn('h-2.5 w-2.5 rounded-full', semaphoreClasses(row.semaphore).dot)} />
                    <span className="text-sm text-white/90">{row.name}</span>
                  </div>
                  <span className="text-sm font-semibold text-emerald-200">{row.health_score}</span>
                </div>
              ))}
            </div>
          )}
        </GlassCard>

        <GlassCard variant="glass" className="space-y-3 p-4 md:p-5">
          <h2 className={cn('text-sm font-semibold md:text-base', textMain)}>{copy.rankings.bottom}</h2>
          {bottomRankings.length === 0 ? (
            <p className={cn('text-sm', textSub)}>{copy.empty}</p>
          ) : (
            <div className="space-y-2">
              {bottomRankings.map((row) => (
                <div key={`bottom-${row.biz_id}`} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className={cn('h-2.5 w-2.5 rounded-full', semaphoreClasses(row.semaphore).dot)} />
                    <span className="text-sm text-white/90">{row.name}</span>
                  </div>
                  <span className="text-sm font-semibold text-amber-200">{row.health_score}</span>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      </section>

      <GlassCard variant="glass" className="space-y-3 p-4 md:p-5">
        <h2 className={cn('text-sm font-semibold md:text-base', textMain)}>{copy.localsTitle}</h2>

        {locals.length === 0 ? (
          <p className={cn('text-sm', textSub)}>{copy.empty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left">
                  <th className="py-2 pr-3 font-medium text-white/85">{copy.table.local}</th>
                  <th className="py-2 pr-3 font-medium text-white/85">{copy.table.traffic}</th>
                  <th className="py-2 pr-3 font-medium text-white/85">{copy.table.rating}</th>
                  <th className="py-2 pr-3 font-medium text-white/85">{copy.table.signals}</th>
                  <th className="py-2 pr-3 font-medium text-white/85">{copy.table.posts}</th>
                  <th className="py-2 pr-3 font-medium text-white/85">{copy.table.semaphore}</th>
                  <th className="py-2 font-medium text-white/85">{copy.table.heat}</th>
                </tr>
              </thead>
              <tbody>
                {locals.map((row) => {
                  const sem = semaphoreClasses(row.semaphore);
                  const heatWidth = `${Math.max(4, row.health_score)}%`;
                  const semaphoreText = row.semaphore === 'green'
                    ? copy.semaphore.green
                    : row.semaphore === 'amber'
                      ? copy.semaphore.amber
                      : row.semaphore === 'red'
                        ? copy.semaphore.red
                        : copy.semaphore.gray;

                  return (
                    <tr key={row.biz_id} className="border-b border-white/5">
                      <td className="py-2 pr-3 align-top">
                        <p className="font-medium text-white/92">{row.name}</p>
                        <p className="text-xs text-white/60">{row.type || 'local'}</p>
                      </td>
                      <td className="py-2 pr-3 align-top text-white/80">{row.total_reviews}</td>
                      <td className="py-2 pr-3 align-top text-white/80">
                        {formatRating(row.avg_rating)}
                        <span className="ml-1 text-xs text-rose-200/90">
                          ({row.neg_reviews} {copy.table.neg})
                        </span>
                      </td>
                      <td className="py-2 pr-3 align-top text-white/80">
                        {row.active_signals}
                        <span className="ml-1 text-xs text-amber-200/90">({row.high_alerts} high)</span>
                      </td>
                      <td className="py-2 pr-3 align-top text-white/80">
                        {row.published_posts}
                        <span className="ml-1 text-xs text-white/55">/ {row.pending_posts} pending</span>
                      </td>
                      <td className="py-2 pr-3 align-top">
                        <span className={cn('inline-flex items-center gap-2 rounded-full border px-2 py-0.5 text-xs font-medium', sem.chip)}>
                          <span className={cn('h-2 w-2 rounded-full', sem.dot)} />
                          {semaphoreText}
                        </span>
                      </td>
                      <td className="py-2 align-top">
                        <div className="w-36 rounded-full bg-white/10">
                          <div className="h-2 rounded-full bg-emerald-300/85" style={{ width: heatWidth }} />
                        </div>
                        <p className="mt-1 text-xs text-white/70">{row.health_score}/100</p>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>
    </div>
  );
}
