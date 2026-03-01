'use client';

export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import GlassCard from '@/components/ui/GlassCard';
import Button from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { textMain, textSub } from '@/components/ui/glass';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/contexts/WorkspaceContext';

type SummaryEvent = {
  event_name: string;
  count_24h: number;
  sample_request_id?: string | null;
};

type SummaryRecent = {
  event_name: string;
  created_at: string;
  request_id?: string | null;
  props?: Record<string, unknown> | null;
};

type SummaryPayload = {
  ok?: boolean;
  org_id?: string;
  window_hours?: number;
  events?: SummaryEvent[];
  recent?: SummaryRecent[];
  request_id?: string;
  error?: string;
  message?: string;
};

const KPI_ORDER = [
  'draft_generated',
  'draft_generate_failed',
  'trial_ended_shown',
  'org_quota_exceeded',
  'ai_unavailable',
] as const;

const KPI_LABELS: Record<(typeof KPI_ORDER)[number], string> = {
  draft_generated: 'Drafts generats',
  draft_generate_failed: 'Errors generació',
  trial_ended_shown: 'Trials finalitzats',
  org_quota_exceeded: 'Quota excedida',
  ai_unavailable: 'IA no disponible',
};

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function compactJson(value: Record<string, unknown> | null | undefined): string {
  if (!value) return '—';
  try {
    return JSON.stringify(value);
  } catch {
    return '—';
  }
}

export default function DashboardHealthPage() {
  const { org, membership } = useWorkspace();
  const { toast } = useToast();

  const canManage = useMemo(() => {
    const role = membership?.role;
    return role === 'owner' || role === 'manager';
  }, [membership?.role]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<SummaryPayload | null>(null);

  useEffect(() => {
    if (!org?.id || !canManage) return;

    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const response = await fetch(`/api/telemetry/summary?org_id=${org.id}`, {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-store',
          },
        });
        const payload = (await response.json().catch(() => ({}))) as SummaryPayload;
        if (!response.ok || !payload.ok) {
          throw new Error(payload.message || 'No s\'ha pogut carregar la telemetria.');
        }
        setSummary(payload);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'No s\'ha pogut carregar la telemetria.');
      } finally {
        setLoading(false);
      }
    })();
  }, [canManage, org?.id]);

  const countByEvent = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of summary?.events || []) {
      map.set(item.event_name, item.count_24h || 0);
    }
    return map;
  }, [summary?.events]);

  const recentIssues = summary?.recent || [];

  const handleCopyDebug = async () => {
    if (!summary) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(summary, null, 2));
      toast('Debug copiat', 'success');
    } catch {
      toast('No s\'ha pogut copiar el debug', 'error');
    }
  };

  if (!canManage) {
    return (
      <div className="space-y-6 pb-16" data-testid="dashboard-health-page">
        <header className="space-y-1">
          <h1 className={cn('text-2xl font-semibold md:text-3xl', textMain)}>Health</h1>
          <p className={cn('text-sm md:text-base', textSub)}>Telemetria de plataforma (24h).</p>
        </header>
        <GlassCard variant="glass" className="space-y-2 p-4 md:p-5">
          <p className={cn('text-sm font-medium', textMain)}>Accés restringit</p>
          <p className={cn('text-sm', textSub)}>Només owner/manager pot veure la telemetria.</p>
          <Link href="/dashboard">
            <Button size="sm">Tornar al dashboard</Button>
          </Link>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-16" data-testid="dashboard-health-page">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className={cn('text-2xl font-semibold md:text-3xl', textMain)}>Health</h1>
          <p className={cn('text-sm md:text-base', textSub)}>
            KPI de telemetria de les últimes 24 hores + últims errors.
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={handleCopyDebug} disabled={!summary}>
          Copy debug
        </Button>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {KPI_ORDER.map((eventName) => (
          <GlassCard key={eventName} variant="glass" className="space-y-1 p-4">
            <p className={cn('text-xs uppercase tracking-wide', textSub)}>{KPI_LABELS[eventName]}</p>
            <p className={cn('text-2xl font-semibold', textMain)}>{countByEvent.get(eventName) ?? 0}</p>
            <p className={cn('text-xs', textSub)}>Últimes 24h</p>
          </GlassCard>
        ))}
      </section>

      <GlassCard variant="glass" className="space-y-3 p-4 md:p-5">
        <div className="flex items-center justify-between">
          <h2 className={cn('text-sm font-semibold md:text-base', textMain)}>Recent issues</h2>
          {loading ? <span className={cn('text-xs', textSub)}>Carregant…</span> : null}
        </div>

        {error ? <p className="text-sm text-amber-300">{error}</p> : null}

        {!loading && !error && recentIssues.length === 0 ? (
          <p className={cn('text-sm', textSub)}>No hi ha errors recents a les últimes 24h.</p>
        ) : null}

        {recentIssues.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left">
                  <th className="py-2 pr-3 font-medium text-white/85">Event</th>
                  <th className="py-2 pr-3 font-medium text-white/85">Quan</th>
                  <th className="py-2 pr-3 font-medium text-white/85">Request ID</th>
                  <th className="py-2 font-medium text-white/85">Detall</th>
                </tr>
              </thead>
              <tbody>
                {recentIssues.map((item) => (
                  <tr key={`${item.event_name}-${item.created_at}-${item.request_id || 'none'}`} className="border-b border-white/5">
                    <td className="py-2 pr-3 align-top text-white/90">{item.event_name}</td>
                    <td className="py-2 pr-3 align-top text-white/75">{formatWhen(item.created_at)}</td>
                    <td className="py-2 pr-3 align-top font-mono text-xs text-white/65">
                      {item.request_id || '—'}
                    </td>
                    <td className="py-2 align-top text-xs text-white/70">{compactJson(item.props)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </GlassCard>
    </div>
  );
}
