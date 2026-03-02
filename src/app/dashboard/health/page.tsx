'use client';

export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import GlassCard from '@/components/ui/GlassCard';
import Button from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { tokens, cx } from '@/lib/design/tokens';

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

type Trend = 'up' | 'down' | 'flat';

type GuardrailsSummary = {
  rate_limits_last_60m?: {
    count?: number;
    previous_60m?: number;
    trend?: Trend;
  };
  orchestrator_cap_today?: {
    count?: number;
    previous_day?: number;
    trend?: Trend;
    day_start_utc?: string;
  };
  recent?: Array<{
    event_name: string;
    created_at: string;
    org_id?: string | null;
    biz_id?: string | null;
    props?: Record<string, unknown> | null;
  }>;
};

type SummaryPayload = {
  ok?: boolean;
  org_id?: string;
  window_hours?: number;
  events?: SummaryEvent[];
  recent?: SummaryRecent[];
  guardrails?: GuardrailsSummary;
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

function trendLabel(trend: Trend | undefined, baseline: number | undefined): string {
  const previous = typeof baseline === 'number' && Number.isFinite(baseline) ? baseline : 0;
  if (trend === 'up') return `↑ vs baseline (${previous})`;
  if (trend === 'down') return `↓ vs baseline (${previous})`;
  return `→ vs baseline (${previous})`;
}

export default function DashboardHealthPage() {
  const { org, biz, membership } = useWorkspace();
  const { toast } = useToast();

  const canManage = useMemo(() => {
    const role = membership?.role;
    return role === 'owner' || role === 'manager';
  }, [membership?.role]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<SummaryPayload | null>(null);
  const [devAction, setDevAction] = useState<'rate_limit' | 'orchestrator_cap' | null>(null);

  const loadSummary = useCallback(async () => {
    if (!org?.id || !canManage) return;
    setLoading(true);
    setError(null);

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
  }, [canManage, org?.id]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const countByEvent = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of summary?.events || []) {
      map.set(item.event_name, item.count_24h || 0);
    }
    return map;
  }, [summary?.events]);

  const recentIssues = summary?.recent || [];
  const guardrails = summary?.guardrails;
  const guardrailRecent = guardrails?.recent || [];
  const rateLimitedLast60m = Number(guardrails?.rate_limits_last_60m?.count || 0);
  const rateLimitedPrev60m = Number(guardrails?.rate_limits_last_60m?.previous_60m || 0);
  const orchestratorCapToday = Number(guardrails?.orchestrator_cap_today?.count || 0);
  const orchestratorCapPrevDay = Number(guardrails?.orchestrator_cap_today?.previous_day || 0);

  const handleCopyDebug = async () => {
    if (!summary) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(summary, null, 2));
      toast('Debug copiat', 'success');
    } catch {
      toast('No s\'ha pogut copiar el debug', 'error');
    }
  };

  const runDevGuardrailSimulation = useCallback(async (kind: 'rate_limit' | 'orchestrator_cap') => {
    if (!biz?.id) {
      toast('Selecciona un negoci', 'warning');
      return;
    }

    setDevAction(kind);
    const isRateLimit = kind === 'rate_limit';

    try {
      const query = isRateLimit ? '__force_rate_limit=1' : '__force_orchestrator_cap=1';
      const payload = isRateLimit
        ? {
          biz_id: biz.id,
          message: 'dev-hook-rate-limit',
          mode: 'chat',
        }
        : {
          biz_id: biz.id,
          message: 'dev-hook-orchestrator-cap',
          mode: 'orchestrator_safe',
        };

      const response = await fetch(`/api/lito/chat?${query}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify(payload),
      });

      if (isRateLimit) {
        if (response.status === 429) {
          toast('OK (429)', 'success');
        } else {
          toast(`Error: ${response.status}`, 'error');
        }
      } else if (response.status >= 400) {
        toast(`OK (${response.status})`, 'success');
      } else {
        toast(`Error: ${response.status}`, 'error');
      }
    } catch {
      toast('Error: network', 'error');
    } finally {
      await loadSummary();
      setDevAction(null);
    }
  }, [biz?.id, loadSummary, toast]);

  const renderDevTools = () => {
    if (process.env.NODE_ENV === 'production') return null;

    return (
      <GlassCard variant="glass" className="space-y-3 p-4 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className={cx('text-sm font-semibold md:text-base', tokens.text.primary)}>DEV Tools (Guardrails)</h2>
          <span className={cx('text-xs', tokens.text.secondary)}>Només DEV</span>
        </div>
        <p className={cx('text-sm', tokens.text.secondary)}>
          {biz?.id ? 'Simula bloquejos de guardrails i refresca KPI al moment.' : 'Selecciona un negoci'}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => { void runDevGuardrailSimulation('rate_limit'); }}
            disabled={!biz?.id || devAction !== null}
          >
            {devAction === 'rate_limit' ? 'Simulant…' : 'Simular rate limit (429)'}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => { void runDevGuardrailSimulation('orchestrator_cap'); }}
            disabled={!biz?.id || devAction !== null}
          >
            {devAction === 'orchestrator_cap' ? 'Simulant…' : 'Simular orchestrator cap (429)'}
          </Button>
        </div>
      </GlassCard>
    );
  };

  if (!canManage) {
    return (
      <div className={cx('space-y-6 pb-16', tokens.bg.global, tokens.text.primary)} data-testid="dashboard-health-page">
        <header className="space-y-1">
          <h1 className={cx('text-2xl font-semibold md:text-3xl', tokens.text.primary)}>Health</h1>
          <p className={cx('text-sm md:text-base', tokens.text.secondary)}>Telemetria de plataforma (24h).</p>
        </header>
        <GlassCard variant="glass" className="space-y-2 p-4 md:p-5">
          <p className={cx('text-sm font-medium', tokens.text.primary)}>Accés restringit</p>
          <p className={cx('text-sm', tokens.text.secondary)}>Només owner/manager pot veure la telemetria.</p>
          <Link href="/dashboard">
            <Button size="sm">Tornar al dashboard</Button>
          </Link>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className={cx('space-y-6 pb-16', tokens.bg.global, tokens.text.primary)} data-testid="dashboard-health-page">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className={cx('text-2xl font-semibold md:text-3xl', tokens.text.primary)}>Health</h1>
          <p className={cx('text-sm md:text-base', tokens.text.secondary)}>
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
            <p className={cx('text-xs uppercase tracking-wide', tokens.text.secondary)}>{KPI_LABELS[eventName]}</p>
            <p className={cx('text-2xl font-semibold', tokens.text.primary)}>{countByEvent.get(eventName) ?? 0}</p>
            <p className={cx('text-xs', tokens.text.secondary)}>Últimes 24h</p>
          </GlassCard>
        ))}
      </section>

      {renderDevTools()}

      <section className="grid gap-3 sm:grid-cols-2">
        <GlassCard variant="glass" className="space-y-1 p-4">
          <p className={cx('text-xs uppercase tracking-wide', tokens.text.secondary)}>Rate limits (última hora)</p>
          <p className={cx('text-2xl font-semibold', tokens.text.primary)}>{rateLimitedLast60m}</p>
          <p className={cx('text-xs', tokens.text.secondary)}>
            {trendLabel(guardrails?.rate_limits_last_60m?.trend, rateLimitedPrev60m)}
          </p>
        </GlassCard>
        <GlassCard variant="glass" className="space-y-1 p-4">
          <p className={cx('text-xs uppercase tracking-wide', tokens.text.secondary)}>Orchestrator cap (avui)</p>
          <p className={cx('text-2xl font-semibold', tokens.text.primary)}>{orchestratorCapToday}</p>
          <p className={cx('text-xs', tokens.text.secondary)}>
            {trendLabel(guardrails?.orchestrator_cap_today?.trend, orchestratorCapPrevDay)}
          </p>
        </GlassCard>
      </section>

      <GlassCard variant="glass" className="space-y-3 p-4 md:p-5">
        <div className="flex items-center justify-between">
          <h2 className={cx('text-sm font-semibold md:text-base', tokens.text.primary)}>Recent issues</h2>
          {loading ? <span className={cx('text-xs', tokens.text.secondary)}>Carregant…</span> : null}
        </div>

        {error ? <p className="text-sm text-amber-700">{error}</p> : null}

        {!loading && !error && recentIssues.length === 0 ? (
          <p className={cx('text-sm', tokens.text.secondary)}>No hi ha errors recents a les últimes 24h.</p>
        ) : null}

        {recentIssues.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left">
                  <th className="py-2 pr-3 font-medium text-zinc-800">Event</th>
                  <th className="py-2 pr-3 font-medium text-zinc-800">Quan</th>
                  <th className="py-2 pr-3 font-medium text-zinc-800">Request ID</th>
                  <th className="py-2 font-medium text-zinc-800">Detall</th>
                </tr>
              </thead>
              <tbody>
                {recentIssues.map((item) => (
                  <tr key={`${item.event_name}-${item.created_at}-${item.request_id || 'none'}`} className="border-b border-zinc-100">
                    <td className="py-2 pr-3 align-top text-zinc-900">{item.event_name}</td>
                    <td className="py-2 pr-3 align-top text-zinc-700">{formatWhen(item.created_at)}</td>
                    <td className="py-2 pr-3 align-top font-mono text-xs text-zinc-600">
                      {item.request_id || '—'}
                    </td>
                    <td className="py-2 align-top text-xs text-zinc-700">{compactJson(item.props)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </GlassCard>

      <GlassCard variant="glass" className="space-y-3 p-4 md:p-5">
        <div className="flex items-center justify-between">
          <h2 className={cx('text-sm font-semibold md:text-base', tokens.text.primary)}>Guardrails recents</h2>
          {loading ? <span className={cx('text-xs', tokens.text.secondary)}>Carregant…</span> : null}
        </div>

        {!loading && !error && guardrailRecent.length === 0 ? (
          <p className={cx('text-sm', tokens.text.secondary)}>No hi ha bloquejos recents en les últimes 24h.</p>
        ) : null}

        {guardrailRecent.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left">
                  <th className="py-2 pr-3 font-medium text-zinc-800">Event</th>
                  <th className="py-2 pr-3 font-medium text-zinc-800">Quan</th>
                  <th className="py-2 pr-3 font-medium text-zinc-800">Org</th>
                  <th className="py-2 pr-3 font-medium text-zinc-800">Biz</th>
                  <th className="py-2 font-medium text-zinc-800">Detall</th>
                </tr>
              </thead>
              <tbody>
                {guardrailRecent.map((item) => (
                  <tr key={`${item.event_name}-${item.created_at}-${item.biz_id || 'none'}`} className="border-b border-zinc-100">
                    <td className="py-2 pr-3 align-top text-zinc-900">{item.event_name}</td>
                    <td className="py-2 pr-3 align-top text-zinc-700">{formatWhen(item.created_at)}</td>
                    <td className="py-2 pr-3 align-top font-mono text-xs text-zinc-600">{item.org_id || '—'}</td>
                    <td className="py-2 pr-3 align-top font-mono text-xs text-zinc-600">{item.biz_id || '—'}</td>
                    <td className="py-2 align-top text-xs text-zinc-700">{compactJson(item.props)}</td>
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
