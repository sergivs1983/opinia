'use client';

export const dynamic = 'force-dynamic';


import { useState, useEffect, useCallback } from 'react';
import { useT } from '@/components/i18n/I18nContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import Button from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { AUDIT_LABELS, AUDIT_ICONS } from '@/lib/audit';
import type { AuditAction } from '@/lib/audit';
import { useBusiness } from '@/hooks/useBusiness';
import { glass, glassStrong } from '@/components/ui/glass';

export default function StatusPage() {
  const t = useT();
  const { biz, org } = useWorkspace();
  const { business, loading: businessLoading, error: businessError } = useBusiness(biz?.id);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [copied, setCopied] = useState(false);
  const activeBiz = business || biz;

  const load = useCallback(async () => {
    if (!org) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/status?org_id=${org.id}${biz ? `&biz_id=${biz.id}` : ''}`);
      setData(await res.json());
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [org, biz]);

  useEffect(() => { load(); }, [load]);

  const handleCopyDiagnostics = () => {
    const bundle = {
      ts: new Date().toISOString(),
      org_id: org?.id,
      org_name: org?.name,
      biz_id: activeBiz?.id,
      biz_name: activeBiz?.name,
      plan: data?.plan,
      usage: data?.usage,
      environment: data?.environment,
      demo_mode: data?.demo_mode,
      recent_jobs: data?.recent_jobs?.map((j: any) => ({
        type: j.job_type, status: j.status, at: j.finished_at, error: j.error,
      })),
      version: '2.0.0-phase-g',
    };
    navigator.clipboard.writeText(JSON.stringify(bundle, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!org) return <div className="p-8 text-center text-white/70">Selecciona un negoci</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display font-bold text-lg text-white/90">{t('dashboard.status.title')}</h1>
          <p className="text-sm text-white/70">
            Informació operativa i diagnòstic
            {activeBiz?.name ? ` · ${activeBiz.name}` : ''}
            {businessLoading ? ` · ${t('common.loading')}` : ''}
          </p>
          {businessError && <p className="text-xs text-amber-600 mt-1">{businessError}</p>}
        </div>
        <Button size="sm" variant="secondary" onClick={handleCopyDiagnostics}>
          {copied ? '✅ Copiat' : '📋 Copy diagnostics'}
        </Button>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[0, 1, 2].map(i => <div key={i} className="h-24 bg-white/10 rounded-2xl animate-pulse" />)}
        </div>
      ) : !data ? (
        <div className={`${glass} border border-white/10 p-8 text-center shadow-glass`}>
          <p className="text-white/70">No s&apos;ha pogut carregar l&apos;estat</p>
        </div>
      ) : (
        <>
          {/* Health */}
          <div className="grid md:grid-cols-3 gap-4">
            <StatusCard icon="💚" label="Servei" value={data.health?.ok ? 'Operatiu' : 'Error'}
              color={data.health?.ok ? 'emerald' : 'red'} sub={`Última comprovació: ${new Date(data.health?.ts).toLocaleTimeString('ca')}`} />
            <StatusCard icon="💳" label="Pla" value={data.plan?.toUpperCase() || 'FREE'} color="brand"
              sub={data.org_name} />
            <StatusCard icon="⚡" label="Generacions avui" value={data.usage?.ai_generations?.toString() || '0'} color="amber"
              sub={`Ressenyes sync: ${data.usage?.reviews_synced || 0}`} />
          </div>

          {/* Last jobs */}
          <div className={`${glassStrong} border border-white/10 p-5 shadow-glass`}>
            <p className="font-semibold text-white/90 text-sm mb-3">Últims treballs</p>
            {!data.recent_jobs?.length ? (
              <p className="text-sm text-white/70 py-3 text-center">Cap treball executat encara</p>
            ) : (
              <div className="space-y-2">
                {data.recent_jobs.map((job: any) => (
                  <div key={job.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/8">
                    <span className={cn('w-2 h-2 rounded-full shrink-0',
                      job.status === 'success' ? 'bg-emerald-500' : job.status === 'failed' ? 'bg-red-500' : 'bg-amber-500')} />
                    <span className="text-sm font-medium text-white/82 flex-1">{job.job_type}</span>
                    <span className="text-xs text-white/60">{job.duration_ms ? `${job.duration_ms}ms` : '—'}</span>
                    <span className="text-xs text-white/60">{job.finished_at ? new Date(job.finished_at).toLocaleString('ca') : 'En curs'}</span>
                    {job.error && <span className="text-[10px] px-1.5 py-0.5 bg-red-100 text-red-700 rounded-full">error</span>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Audit trail */}
          <div className={`${glassStrong} border border-white/10 p-5 shadow-glass`}>
            <p className="font-semibold text-white/90 text-sm mb-3">Activitat recent</p>
            {!data.recent_activity?.length ? (
              <p className="text-sm text-white/70 py-3 text-center">Cap activitat registrada</p>
            ) : (
              <div className="space-y-2">
                {data.recent_activity.map((entry: any, i: number) => (
                  <div key={i} className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/8">
                    <span className="text-sm">{AUDIT_ICONS[entry.action as AuditAction] || '📝'}</span>
                    <span className="text-sm text-white/82 flex-1">
                      {AUDIT_LABELS[entry.action as AuditAction] || entry.action}
                    </span>
                    <span className="text-xs text-white/60">{new Date(entry.created_at).toLocaleString('ca')}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Environment */}
          <div className={`${glass} border border-white/10 rounded-2xl p-4`}>
            <div className="flex items-center gap-4 text-xs text-white/70">
              <span>Env: <span className="font-mono font-medium">{data.environment}</span></span>
              <span>Demo: <span className="font-mono font-medium">{data.demo_mode ? 'ON' : 'OFF'}</span></span>
              <span>Versió: <span className="font-mono font-medium">2.0.0-g</span></span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function StatusCard({ icon, label, value, color, sub }: {
  icon: string; label: string; value: string; color: string; sub: string;
}) {
  const colorMap: Record<string, string> = {
    emerald: 'bg-emerald-500/14 border-emerald-400/30',
    red: 'bg-red-500/14 border-red-400/30',
    amber: 'bg-amber-500/14 border-amber-400/30',
    brand: 'bg-brand-accent/14 border-brand-accent/30',
  };
  return (
    <div className={cn('rounded-2xl border p-4', colorMap[color] || 'bg-white/8 border-white/14')}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm">{icon}</span>
        <span className="text-[10px] font-bold uppercase text-white/60 tracking-wider">{label}</span>
      </div>
      <p className="text-xl font-bold text-white/90">{value}</p>
      <p className="text-xs text-white/70 mt-0.5">{sub}</p>
    </div>
  );
}
