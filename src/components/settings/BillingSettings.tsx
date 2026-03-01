'use client';

import { useLocale, useT } from '@/components/i18n/I18nContext';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { glass, glassNoise, glassStrong, glassSweep } from '@/components/ui/glass';
import PlanCard from '@/components/pricing/PlanCard';
import ToggleBilling from '@/components/pricing/ToggleBilling';
import {
  formatPrice,
  getPrice,
  SAVINGS_PERCENT,
  plans,
  type BillingCycle,
  type PricingLocale,
} from '@/lib/pricing/plans';
import type { OrgProps } from './types';

interface BillingData {
  org: { plan: string };
  usage: { ai_generations: number; reviews_synced?: number };
  limits: { max_reviews_mo: number };
  plans: { id: string; name: string; price_monthly: number; features: string[] }[];
}

export default function BillingSettings({ org }: OrgProps) {
  const t = useT();
  const locale = (useLocale() || 'ca') as PricingLocale;
  const router = useRouter();
  const [data, setData] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [billing, setBilling] = useState<BillingCycle>('monthly');

  useEffect(() => { loadBilling(); }, [org.id]);

  const loadBilling = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/billing?org_id=${org.id}`);
      const json = await res.json();
      setData(json);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const handleUpgrade = async (planId: string) => {
    setUpgrading(planId);
    try {
      const res = await fetch('/api/billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: org.id, plan_id: planId }),
      });
      const json = await res.json();
      if (json.success) await loadBilling();
      else if (json.action === 'stripe_checkout') {
        if (typeof json.checkout_url === 'string' && json.checkout_url.trim().length > 0) {
          window.location.assign(json.checkout_url);
        } else {
          alert(json.message || 'No s\'ha pogut iniciar Stripe Checkout');
        }
      }
    } catch (e) { console.error(e); }
    setUpgrading(null);
  };

  if (loading) {
    return <div className="space-y-4 max-w-3xl">{[0,1,2].map(i => <div key={i} className="h-24 bg-white/10 rounded-xl animate-pulse" />)}</div>;
  }

  if (!data) return <div className="text-white/70">{t('settings.billing.errorLoad')}</div>;

  const usagePct = data.limits.max_reviews_mo > 0
    ? Math.round((data.usage.ai_generations / data.limits.max_reviews_mo) * 100) : 0;
  const savePercent = SAVINGS_PERCENT;
  const currentPlan = plans.find((plan) => plan.id === data.org.plan) ?? null;
  const currentPlanPrice = currentPlan ? getPrice(currentPlan, billing) : null;
  const otherPlans = currentPlan ? plans.filter((plan) => plan.id !== currentPlan.id) : plans;
  const upgradeablePlanIds = new Set((data.plans || []).map((plan) => plan.id));

  return (
    <div className="max-w-5xl space-y-6">
      <section className={cn(glassStrong, glassNoise, glassSweep, 'p-6 md:p-7')} data-testid="plan-current">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
          <div>
            <h3 className="text-lg font-semibold text-white/92">{t('settings.billing.currentPlan')}</h3>
            <p className="mt-1 text-sm text-white/70">
              {currentPlan ? t(currentPlan.nameKey) : t('common.unknown')}
            </p>
          </div>
          <div className="text-left md:text-right">
            <p className="text-3xl font-bold text-white/92">
              {currentPlanPrice
                ? (billing === 'monthly'
                  ? formatPrice(currentPlanPrice.monthlyPriceCents, locale)
                  : formatPrice(currentPlanPrice.annualPriceCents, locale))
                : data.org.plan === 'free'
                  ? t('common.free')
                  : t('common.unknown')
              }
              {currentPlanPrice && (
                <span className="ml-1 text-base font-medium text-white/65">
                  {billing === 'monthly' ? t('pricing.perMonth') : t('pricing.perYear')}
                </span>
              )}
            </p>
            {billing === 'yearly' && currentPlanPrice && (
              <p className="mt-1 text-xs text-white/70" data-testid="pricing-effective-monthly">
                {t('pricing.effectiveMonthlyBilledAnnually', {
                  amount: formatPrice(currentPlanPrice.effectiveMonthlyCents, locale, { decimals: 2 }),
                })}
              </p>
            )}
            {billing === 'yearly' && currentPlanPrice && (
              <p className="mt-1 text-xs font-medium text-emerald-300" data-testid="pricing-savings-badge">
                {t('pricing.twoMonthsFree')} · {t('pricing.savings', { pct: currentPlanPrice.savingsPct })}
              </p>
            )}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className={cn(glass, glassNoise, glassSweep, 'p-3 transition-all duration-[220ms] ease-premium hover:border-brand-accent/20 hover:shadow-[0_0_20px_rgba(0,168,107,0.10)]')}>
            <p className="text-2xl font-bold text-white/90">{data.usage.ai_generations}</p>
            <p className="text-xs text-white/70">{t('settings.billing.aiGenerations')}</p>
          </div>
          <div className={cn(glass, glassNoise, glassSweep, 'p-3 transition-all duration-[220ms] ease-premium hover:border-brand-accent/20 hover:shadow-[0_0_20px_rgba(0,168,107,0.10)]')}>
            <p className="text-2xl font-bold text-white/90">{data.usage.reviews_synced || 0}</p>
            <p className="text-xs text-white/70">{t('settings.billing.syncedReviews')}</p>
          </div>
          <div className={cn(glass, glassNoise, glassSweep, 'p-3 transition-all duration-[220ms] ease-premium hover:border-brand-accent/20 hover:shadow-[0_0_20px_rgba(0,168,107,0.10)]')}>
            <p className="text-2xl font-bold text-white/90">{data.limits.max_reviews_mo}</p>
            <p className="text-xs text-white/70">{t('settings.billing.monthlyLimit')}</p>
          </div>
        </div>

        <div className="mt-4">
          <div className="flex justify-between text-xs text-white/70 mb-1">
            <span>{t('settings.billing.usageProgress', { used: data.usage.ai_generations, total: data.limits.max_reviews_mo })}</span>
            <span>{usagePct}%</span>
          </div>
          <div className="w-full h-2.5 bg-white/10 rounded-full overflow-hidden">
            <div className={cn('h-full rounded-full transition-all duration-500',
              usagePct >= 90 ? 'bg-red-500' : usagePct >= 70 ? 'bg-amber-500' : 'bg-brand-accent')}
              style={{ width: `${Math.min(usagePct, 100)}%` }} />
          </div>
        </div>
      </section>

      <div className="flex justify-center md:justify-start" data-testid="plan-billing-toggle">
        <ToggleBilling
          value={billing}
          onChange={setBilling}
          monthlyLabel={t('pricing.billing.monthly')}
          yearlyLabel={t('pricing.billing.yearly')}
          saveLabel={t('pricing.savings', { pct: savePercent })}
          showSaveBadge={billing === 'yearly'}
        />
      </div>

      <section className={cn(glass, glassNoise, 'p-5 md:p-6')}>
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-[0.08em] text-white/72">
          {t('settings.billing.changePlan')}
        </h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {otherPlans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              billing={billing}
              t={t}
              variant="compact"
              dataTestId="plan-upgrade-card"
              ctaLabel={
                upgradeablePlanIds.has(plan.id)
                  ? t('common.upgradeTo').replace('{name}', t(plan.nameKey))
                  : t('pricing.cta.allPlans')
              }
              onCta={(selectedPlan) => {
                if (upgradeablePlanIds.has(selectedPlan.id)) {
                  void handleUpgrade(selectedPlan.id);
                  return;
                }
                router.push('/pricing');
              }}
              ctaLoading={upgrading === plan.id}
            />
          ))}
        </div>
      </section>

      {currentPlan && (
        <div className={cn(glass, glassNoise, glassSweep, 'flex items-center justify-between gap-3 p-4 text-sm text-white/72')}>
          <span>{t('settings.billing.currentPlan')}: {t(currentPlan.nameKey)}</span>
          <Button size="sm" variant="secondary" onClick={() => router.push('/pricing')}>
            {t('pricing.cta.allPlans')}
          </Button>
        </div>
      )}
      {!currentPlan && (
        <div className={cn(glass, glassNoise, 'p-4 text-sm text-white/72')}>
          {t('settings.billing.currentPlan')}: {data.org.plan || t('common.unknown')}
        </div>
      )}
    </div>
  );
}
