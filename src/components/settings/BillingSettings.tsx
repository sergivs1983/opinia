'use client';

import { useLocale, useT } from '@/components/i18n/I18nContext';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown } from 'lucide-react';

import { cn } from '@/lib/utils';
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
  const [planAccordionOpen, setPlanAccordionOpen] = useState(false);
  const [detailsAccordionOpen, setDetailsAccordionOpen] = useState(false);

  const loadBilling = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/billing?org_id=${org.id}`);
      const json = await res.json();
      setData(json);
    } catch (error) {
      console.error(error);
    }
    setLoading(false);
  }, [org.id]);

  useEffect(() => {
    void loadBilling();
  }, [loadBilling]);

  const handleUpgrade = async (planId: string) => {
    setUpgrading(planId);
    try {
      const res = await fetch('/api/billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: org.id, plan_id: planId }),
      });
      const json = await res.json();
      if (json.success) {
        await loadBilling();
      } else if (json.action === 'stripe_checkout') {
        if (typeof json.checkout_url === 'string' && json.checkout_url.trim().length > 0) {
          window.location.assign(json.checkout_url);
        } else {
          alert(json.message || "No s'ha pogut iniciar Stripe Checkout");
        }
      }
    } catch (error) {
      console.error(error);
    }
    setUpgrading(null);
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl border border-black/10 bg-zinc-100/80" />
        ))}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-xl border border-black/10 bg-white px-4 py-3 text-sm text-zinc-600">
        {t('settings.billing.errorLoad')}
      </div>
    );
  }

  const monthlyLimit = Math.max(0, data.limits.max_reviews_mo || 0);
  const aiGenerations = Math.max(0, data.usage.ai_generations || 0);
  const syncedReviews = Math.max(0, data.usage.reviews_synced || 0);
  const usagePct = monthlyLimit > 0 ? Math.round((aiGenerations / monthlyLimit) * 100) : 0;
  const boundedUsagePct = Math.min(100, Math.max(0, usagePct));

  const currentPlan = plans.find((plan) => plan.id === data.org.plan) ?? null;
  const currentPlanPrice = currentPlan ? getPrice(currentPlan, billing) : null;
  const upgradeablePlanIds = new Set((data.plans || []).map((plan) => plan.id));
  const billingSuffix = billing === 'monthly' ? t('pricing.perMonth') : t('pricing.perYear');

  return (
    <div className="space-y-4">
      <section
        className="overflow-hidden rounded-2xl border border-black/10 bg-white shadow-[0_16px_42px_rgba(15,23,42,0.08)]"
        data-testid="plan-current"
      >
        <div className="flex flex-col gap-4 border-b border-black/10 px-6 py-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-zinc-500">
              {t('settings.billing.currentPlan')}
            </p>
            <h3 className="mt-1 text-xl font-semibold text-zinc-900">
              {currentPlan ? t(currentPlan.nameKey) : t('common.unknown')}
            </h3>
            <p className="mt-1 text-sm text-zinc-500">Resum de consum i pla actiu.</p>
          </div>
          <div className="space-y-2">
            <div className="inline-flex rounded-full border border-black/10 bg-zinc-100 p-1" data-testid="plan-billing-toggle">
              <button
                type="button"
                onClick={() => setBilling('monthly')}
                className={cn(
                  'rounded-full px-3 py-1.5 text-xs font-medium transition',
                  billing === 'monthly'
                    ? 'bg-white text-zinc-900 shadow-sm'
                    : 'text-zinc-600 hover:text-zinc-900',
                )}
              >
                {t('pricing.billing.monthly')}
              </button>
              <button
                type="button"
                onClick={() => setBilling('yearly')}
                className={cn(
                  'rounded-full px-3 py-1.5 text-xs font-medium transition',
                  billing === 'yearly'
                    ? 'bg-white text-zinc-900 shadow-sm'
                    : 'text-zinc-600 hover:text-zinc-900',
                )}
              >
                {t('pricing.billing.yearly')}
              </button>
            </div>
            <p className="text-xs text-emerald-700">{t('pricing.savings', { pct: SAVINGS_PERCENT })}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 divide-y divide-black/10 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div className="px-6 py-4">
            <p className="text-xs text-zinc-500">{t('settings.billing.aiGenerations')}</p>
            <p className="mt-1 font-mono text-xl font-semibold text-zinc-900">{aiGenerations}</p>
          </div>
          <div className="px-6 py-4">
            <p className="text-xs text-zinc-500">{t('settings.billing.syncedReviews')}</p>
            <p className="mt-1 font-mono text-xl font-semibold text-zinc-900">{syncedReviews}</p>
          </div>
          <div className="px-6 py-4">
            <p className="text-xs text-zinc-500">{t('settings.billing.monthlyLimit')}</p>
            <p className="mt-1 font-mono text-xl font-semibold text-zinc-900">{monthlyLimit}</p>
          </div>
        </div>

        <div className="space-y-2 px-6 py-4">
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>{t('settings.billing.usageProgress', { used: aiGenerations, total: monthlyLimit })}</span>
            <span className="font-mono">{boundedUsagePct}%</span>
          </div>
          <div className="h-2 rounded-full bg-zinc-200">
            <div
              className={cn(
                'h-2 rounded-full transition-all duration-500',
                boundedUsagePct >= 90
                  ? 'bg-red-500'
                  : boundedUsagePct >= 70
                    ? 'bg-amber-500'
                    : 'bg-emerald-500',
              )}
              style={{ width: `${boundedUsagePct}%` }}
            />
          </div>
          <p className="text-xs text-zinc-500">
            {currentPlanPrice
              ? `${billing === 'monthly'
                ? formatPrice(currentPlanPrice.monthlyPriceCents, locale)
                : formatPrice(currentPlanPrice.annualPriceCents, locale)
              } ${billingSuffix}`
              : t('common.unknown')}
          </p>
          {billing === 'yearly' && currentPlanPrice ? (
            <p className="text-xs text-zinc-500">
              {t('pricing.effectiveMonthlyBilledAnnually', {
                amount: formatPrice(currentPlanPrice.effectiveMonthlyCents, locale, { decimals: 2 }),
              })}
            </p>
          ) : null}
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm">
        <button
          type="button"
          onClick={() => setPlanAccordionOpen((open) => !open)}
          className="flex w-full items-center justify-between px-6 py-5 text-left"
          aria-expanded={planAccordionOpen}
        >
          <div>
            <p className="text-sm font-semibold text-zinc-900">{t('settings.billing.changePlan')}</p>
            <p className="mt-1 text-xs text-zinc-500">Compara Starter, Pro i Agency i canvia de pla quan vulguis.</p>
          </div>
          <ChevronDown
            size={18}
            className={cn('text-zinc-500 transition-transform', planAccordionOpen ? 'rotate-180' : 'rotate-0')}
          />
        </button>
        {planAccordionOpen ? (
          <div className="border-t border-black/10 px-6 py-5">
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
              {plans.map((plan) => {
                const planPrice = getPrice(plan, billing);
                const isCurrentPlan = currentPlan?.id === plan.id;
                const canUpgrade = upgradeablePlanIds.has(plan.id);
                const ctaLabel = isCurrentPlan
                  ? 'Pla actual'
                  : canUpgrade
                    ? t('common.upgradeTo').replace('{name}', t(plan.nameKey))
                    : t('pricing.cta.allPlans');

                const onCta = () => {
                  if (isCurrentPlan) return;
                  if (canUpgrade) {
                    void handleUpgrade(plan.id);
                    return;
                  }
                  router.push('/pricing');
                };

                return (
                  <article
                    key={plan.id}
                    className={cn(
                      'rounded-xl border p-4',
                      isCurrentPlan ? 'border-emerald-300 bg-emerald-50/40' : 'border-black/10 bg-zinc-50/60',
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-zinc-900">{t(plan.nameKey)}</p>
                        <p className="mt-1 text-xs text-zinc-500">{t(plan.descriptionKey)}</p>
                      </div>
                      {plan.recommended ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-semibold text-emerald-700">
                          Recomanat
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-3 flex items-end gap-1">
                      <p className="text-2xl font-semibold text-zinc-900">
                        {billing === 'monthly'
                          ? formatPrice(planPrice.monthlyPriceCents, locale)
                          : formatPrice(planPrice.annualPriceCents, locale)}
                      </p>
                      <span className="pb-1 text-xs text-zinc-500">{billingSuffix}</span>
                    </div>

                    {billing === 'yearly' ? (
                      <p className="mt-1 text-xs text-zinc-500">
                        {t('pricing.effectiveMonthlyBilledAnnually', {
                          amount: formatPrice(planPrice.effectiveMonthlyCents, locale, { decimals: 2 }),
                        })}
                      </p>
                    ) : null}

                    <button
                      type="button"
                      onClick={onCta}
                      disabled={isCurrentPlan || upgrading === plan.id}
                      className={cn(
                        'mt-4 inline-flex w-full items-center justify-center rounded-lg border px-3 py-2 text-sm font-medium transition',
                        isCurrentPlan
                          ? 'cursor-default border-zinc-200 bg-zinc-100 text-zinc-500'
                          : 'border-zinc-900 bg-zinc-900 text-white hover:bg-zinc-800',
                      )}
                    >
                      {upgrading === plan.id ? 'Actualitzant…' : ctaLabel}
                    </button>
                  </article>
                );
              })}
            </div>
          </div>
        ) : null}
      </section>

      <section className="overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm">
        <button
          type="button"
          onClick={() => setDetailsAccordionOpen((open) => !open)}
          className="flex w-full items-center justify-between px-6 py-5 text-left"
          aria-expanded={detailsAccordionOpen}
        >
          <div>
            <p className="text-sm font-semibold text-zinc-900">Detalls de consum</p>
            <p className="mt-1 text-xs text-zinc-500">Informació ampliada de límits i ús mensual.</p>
          </div>
          <ChevronDown
            size={18}
            className={cn('text-zinc-500 transition-transform', detailsAccordionOpen ? 'rotate-180' : 'rotate-0')}
          />
        </button>
        {detailsAccordionOpen ? (
          <div className="divide-y divide-black/10 border-t border-black/10 px-6">
            <div className="grid grid-cols-2 gap-4 py-4">
              <div>
                <p className="text-xs text-zinc-500">IA generacions</p>
                <p className="mt-1 font-mono text-sm font-semibold text-zinc-900">{aiGenerations}</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">Ressenyes sincronitzades</p>
                <p className="mt-1 font-mono text-sm font-semibold text-zinc-900">{syncedReviews}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 py-4">
              <div>
                <p className="text-xs text-zinc-500">Límit mensual</p>
                <p className="mt-1 font-mono text-sm font-semibold text-zinc-900">{monthlyLimit}</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">Ús actual</p>
                <p className="mt-1 font-mono text-sm font-semibold text-zinc-900">{boundedUsagePct}%</p>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      <div className="rounded-xl border border-black/10 bg-zinc-50 px-4 py-3 text-xs text-zinc-600">
        {t('settings.billing.currentPlan')}:{' '}
        <span className="font-semibold text-zinc-900">
          {currentPlan ? t(currentPlan.nameKey) : data.org.plan || t('common.unknown')}
        </span>
      </div>
    </div>
  );
}
