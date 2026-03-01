'use client';

export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import Button from '@/components/ui/Button';
import GlassCard from '@/components/ui/GlassCard';
import { useT } from '@/components/i18n/I18nContext';
import { textMain, textSub } from '@/components/ui/glass';
import { getOrgPlanConfig } from '@/lib/ai/quota';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/contexts/WorkspaceContext';

type PlanCode = 'starter' | 'business' | 'scale';

type EntitlementsResponse = {
  ok?: boolean;
  plan_code?: PlanCode;
  entitlements?: {
    locations_limit?: number;
    seats_limit?: number;
    lito_drafts_limit?: number;
    signals_level?: 'basic' | 'advanced' | 'full';
  };
  usage?: {
    used?: number;
    limit?: number;
    remaining?: number;
  };
  plan_limits?: {
    drafts_limit?: number;
    max_locals?: number;
    seats_limit?: number;
  };
  message?: string;
};

type PlanCard = {
  id: PlanCode;
  name: string;
  price: string;
  locations: number;
  seats: number;
  drafts: number;
  signals: string;
  recommended?: boolean;
};

const PLAN_CARDS: PlanCard[] = ([
  {
    id: 'starter',
    name: 'Starter',
    price: '29€',
    signals: 'basic',
  },
  {
    id: 'business',
    name: 'Business',
    price: '49€',
    signals: 'advanced',
    recommended: true,
  },
  {
    id: 'scale',
    name: 'Scale',
    price: '149€',
    signals: 'full',
  },
] as const).map((plan) => {
  const config = getOrgPlanConfig(plan.id);
  const seatsByPlan: Record<PlanCode, number> = {
    starter: 1,
    business: 3,
    scale: 10,
  };

  return {
    id: plan.id,
    name: plan.name,
    price: plan.price,
    locations: config.max_locals,
    seats: seatsByPlan[plan.id],
    drafts: config.drafts_limit,
    signals: plan.signals,
    recommended: 'recommended' in plan ? plan.recommended : undefined,
  };
});

function normalizePlan(value: string | null | undefined): PlanCode {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'scale' || normalized === 'pro_149' || normalized === 'scale_149') return 'scale';
  if (normalized === 'business' || normalized === 'pro' || normalized === 'pro_49') return 'business';
  return 'starter';
}

function signalLabel(value: string | null | undefined): string {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'full') return 'Full';
  if (normalized === 'advanced') return 'Advanced';
  return 'Basic';
}

export default function DashboardPlansPage() {
  const t = useT();
  const { org, membership } = useWorkspace();
  const canManage = useMemo(() => {
    const role = (membership?.role || '').toLowerCase();
    return role === 'owner' || role === 'manager';
  }, [membership?.role]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPlan, setCurrentPlan] = useState<PlanCode>('starter');
  const [usedDrafts, setUsedDrafts] = useState(0);
  const [limitDrafts, setLimitDrafts] = useState(getOrgPlanConfig('starter').drafts_limit);
  const [signals, setSignals] = useState('Basic');

  const trackUpgradeClick = (targetPlan: PlanCode) => {
    if (!org?.id) return;
    void fetch('/api/telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        org_id: org.id,
        event_name: 'upgrade_clicked',
        props: {
          from_plan: currentPlan,
          target_plan: targetPlan,
          source: 'dashboard_plans',
        },
      }),
    }).catch(() => {});
  };

  useEffect(() => {
    if (!org?.id || !canManage) return;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const response = await fetch(`/api/billing/entitlements?org_id=${org.id}`);
        const payload = (await response.json().catch(() => ({}))) as EntitlementsResponse;

        if (!response.ok || !payload.ok) {
          throw new Error(payload.message || 'No s\'ha pogut carregar els límits del pla.');
        }

        const plan = normalizePlan(payload.plan_code || org.plan_code || org.plan);
        setCurrentPlan(plan);

        const planConfig = getOrgPlanConfig(plan);
        const limit = Number(payload.usage?.limit ?? payload.plan_limits?.drafts_limit ?? planConfig.drafts_limit);
        const used = Number(payload.usage?.used ?? 0);
        setLimitDrafts(Number.isFinite(limit) && limit > 0 ? limit : planConfig.drafts_limit);
        setUsedDrafts(Number.isFinite(used) ? used : 0);
        setSignals(signalLabel(payload.entitlements?.signals_level));
      } catch (loadError) {
        const fallbackPlan = normalizePlan(org.plan_code || org.plan);
        setCurrentPlan(fallbackPlan);
        setLimitDrafts(getOrgPlanConfig(fallbackPlan).drafts_limit);
        setError(loadError instanceof Error ? loadError.message : 'No s\'ha pogut carregar el pla.');
      } finally {
        setLoading(false);
      }
    })();
  }, [canManage, org?.id, org?.plan, org?.plan_code]);

  if (!canManage) {
    return (
      <div className="space-y-6 pb-16" data-testid="dashboard-plans-page">
        <header className="space-y-1">
          <h1 className={cn('text-2xl font-semibold md:text-3xl', textMain)}>Plans i Entitlements</h1>
        </header>
        <GlassCard variant="glass" className="space-y-2 p-4 md:p-5">
          <p className={cn('text-sm font-medium', textMain)}>Accés restringit</p>
          <p className={cn('text-sm', textSub)}>Només owner/manager pot veure i gestionar facturació.</p>
          <Link href="/dashboard">
            <Button size="sm">Tornar al dashboard</Button>
          </Link>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-16" data-testid="dashboard-plans-page">
      <header className="space-y-1">
        <h1 className={cn('text-2xl font-semibold md:text-3xl', textMain)}>Plans i Entitlements</h1>
        <p className={cn('text-sm md:text-base', textSub)}>
          Paquets per locals, equip i Drafts LITO mensuals.
        </p>
      </header>

      <GlassCard variant="glass" className="space-y-2 p-4 md:p-5">
        <p className={cn('text-sm font-medium', textMain)}>Consum actual</p>
        <p className={cn('text-sm', textSub)}>Drafts mes: {usedDrafts}/{limitDrafts}</p>
        <p className={cn('text-sm', textSub)}>Signals: {signals}</p>
        {loading ? <p className={cn('text-xs', textSub)}>{t('common.loading')}</p> : null}
        {error ? <p className="text-xs text-amber-300">{error}</p> : null}
      </GlassCard>

      <section className="grid gap-4 lg:grid-cols-3">
        {PLAN_CARDS.map((plan) => {
          const active = currentPlan === plan.id;
          return (
            <GlassCard
              key={plan.id}
              variant={active ? 'strong' : 'glass'}
              className={cn(
                'relative overflow-hidden border p-5',
                active ? 'border-emerald-400/40' : 'border-white/10',
              )}
            >
              {plan.recommended ? (
                <span className="absolute right-3 top-3 rounded-full border border-emerald-300/40 bg-emerald-400/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-100">
                  Recomanat
                </span>
              ) : null}
              <h2 className={cn('text-lg font-semibold', textMain)}>{plan.name}</h2>
              <p className="mt-1 text-2xl font-bold text-white">{plan.price}<span className={cn('ml-1 text-sm font-medium', textSub)}>/mes</span></p>
              <ul className={cn('mt-4 space-y-2 text-sm', textSub)}>
                <li>Locals inclosos: {plan.locations}</li>
                <li>Seients: {plan.seats}</li>
                <li>Drafts LITO/mes: {plan.drafts}</li>
                <li>Signals: {plan.signals}</li>
              </ul>
              <div className="mt-4 flex gap-2">
                {active ? (
                  <span className="inline-flex h-8 items-center rounded-lg border border-emerald-300/35 bg-emerald-500/15 px-3 text-xs font-medium text-emerald-100">
                    Pla actiu
                  </span>
                ) : (
                  <a
                    href="mailto:hello@opinia.app?subject=Canvi%20de%20pla"
                    onClick={() => trackUpgradeClick(plan.id)}
                    className="inline-flex h-8 items-center rounded-lg border border-white/20 bg-white/8 px-3 text-xs font-medium text-white/80 transition hover:bg-white/14"
                  >
                    Contactar
                  </a>
                )}
              </div>
            </GlassCard>
          );
        })}
      </section>

      <GlassCard variant="glass" className="p-4 md:p-5">
        <p className={cn('text-sm', textSub)}>
          Governance staff: límit diari 10 accions, cap mensual 30% de quota org i panic toggle per owner/manager.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/dashboard/settings">
            <Button size="sm">Obrir configuració</Button>
          </Link>
        </div>
      </GlassCard>
    </div>
  );
}
