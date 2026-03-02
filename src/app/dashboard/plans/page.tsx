'use client';

export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import Button from '@/components/ui/Button';
import { useT } from '@/components/i18n/I18nContext';
import { getOrgPlanConfig } from '@/lib/ai/quota';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { tokens, cx } from '@/lib/design/tokens';

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
  const stripePortalUrl = process.env.NEXT_PUBLIC_STRIPE_PORTAL_URL || null;
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
          throw new Error(payload.message || 'No sha pogut carregar els limits del pla.');
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
        setError(loadError instanceof Error ? loadError.message : 'No sha pogut carregar el pla.');
      } finally {
        setLoading(false);
      }
    })();
  }, [canManage, org?.id, org?.plan, org?.plan_code]);

  if (!canManage) {
    return (
      <div className={cx('space-y-6 pb-16', tokens.text.primary)} data-testid="dashboard-plans-page">
        <header className="space-y-1">
          <h1 className={cx('text-2xl font-semibold md:text-3xl', tokens.text.primary)}>Plans i Entitlements</h1>
        </header>

        <section className={cx('space-y-2 p-4 md:p-5', tokens.bg.surface, tokens.border.default, tokens.radius.card, tokens.shadow.card)}>
          <p className={cx('text-sm font-medium', tokens.text.primary)}>Accés restringit</p>
          <p className={cx('text-sm', tokens.text.secondary)}>Només owner/manager pot veure i gestionar facturació.</p>
          <Link href="/dashboard/lito">
            <Button size="sm">Tornar a LITO</Button>
          </Link>
        </section>
      </div>
    );
  }

  return (
    <div className={cx('space-y-6 pb-16', tokens.text.primary)} data-testid="dashboard-plans-page">
      <header className="space-y-1">
        <h1 className={cx('text-2xl font-semibold md:text-3xl', tokens.text.primary)}>Plans i Entitlements</h1>
        <p className={cx('text-sm md:text-base', tokens.text.secondary)}>
          Paquets per locals, equip i Drafts LITO mensuals.
        </p>
      </header>

      <section className={cx('space-y-2 p-4 md:p-5', tokens.bg.surface, tokens.border.default, tokens.radius.card, tokens.shadow.card)}>
        <p className={cx('text-sm font-medium', tokens.text.primary)}>Consum actual</p>
        <p className={cx('text-sm', tokens.text.secondary)}>Drafts mes: {usedDrafts}/{limitDrafts}</p>
        <p className={cx('text-sm', tokens.text.secondary)}>Signals: {signals}</p>
        {loading ? <p className={cx('text-xs', tokens.text.secondary)}>{t('common.loading')}</p> : null}
        {error ? <p className={cx('text-xs', tokens.text.warning)}>{error}</p> : null}
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        {PLAN_CARDS.map((plan) => {
          const active = currentPlan === plan.id;
          return (
            <article
              key={plan.id}
              className={cx(
                'relative overflow-hidden p-5',
                tokens.bg.surface,
                active ? tokens.border.strong : tokens.border.default,
                tokens.radius.card,
                tokens.shadow.card,
              )}
            >
              {plan.recommended ? (
                <span className={cx('absolute right-3 top-3 rounded-full px-2 py-0.5 text-[11px] font-semibold', tokens.bg.soft, tokens.text.secondary)}>
                  Recomanat
                </span>
              ) : null}

              <h2 className={cx('text-lg font-semibold', tokens.text.primary)}>{plan.name}</h2>
              <p className={cx('mt-1 text-2xl font-bold', tokens.text.primary)}>
                {plan.price}
                <span className={cx('ml-1 text-sm font-medium', tokens.text.secondary)}>/mes</span>
              </p>

              <ul className={cx('mt-4 space-y-2 text-sm', tokens.text.secondary)}>
                <li>Locals inclosos: {plan.locations}</li>
                <li>Seients: {plan.seats}</li>
                <li>Drafts LITO/mes: {plan.drafts}</li>
                <li>Signals: {plan.signals}</li>
              </ul>

              <div className="mt-4 flex gap-2">
                {active ? (
                  <span className={cx('inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium', tokens.bg.soft, tokens.text.primary)}>
                    Pla actiu
                  </span>
                ) : (
                  <a
                    href="mailto:hello@opinia.app?subject=Canvi%20de%20pla"
                    onClick={() => trackUpgradeClick(plan.id)}
                    className={tokens.button.secondary}
                  >
                    Contactar
                  </a>
                )}
              </div>
            </article>
          );
        })}
      </section>

      <section className={cx('space-y-3 p-4 md:p-5', tokens.bg.surface, tokens.border.default, tokens.radius.card, tokens.shadow.card)}>
        <p className={cx('text-sm', tokens.text.secondary)}>
          Billing gestionat amb Stripe.
          {stripePortalUrl ? (
            <a
              href={stripePortalUrl}
              target="_blank"
              rel="noreferrer"
              className={cx('ml-2 underline underline-offset-2', tokens.text.primary)}
            >
              Obrir portal de facturació
            </a>
          ) : null}
        </p>
        <p className={cx('text-sm', tokens.text.secondary)}>
          Governance staff: límit diari 10 accions, cap mensual 30% de quota org i panic toggle per owner/manager.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/dashboard/lito?tab=config">
            <Button size="sm">Obrir configuració</Button>
          </Link>
        </div>
      </section>
    </div>
  );
}
