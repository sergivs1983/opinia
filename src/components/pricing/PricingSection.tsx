'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import { useT } from '@/components/i18n/I18nContext';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { glass, glassStrong, textMain, textSub, textMuted } from '@/components/ui/glass';
import { FEATURES, SAVINGS_PERCENT, plans, type BillingCycle, type PricingPlan } from '@/lib/pricing/plans';
import Faq from '@/components/pricing/Faq';
import PlanCard from '@/components/pricing/PlanCard';
import FeatureTable from '@/components/pricing/FeatureTable';
import ToggleBilling from '@/components/pricing/ToggleBilling';

const FAQ_IDS = ['robotic', 'edit', 'catalan', 'export', 'integrations', 'limits'] as const;

export interface PricingSectionProps {
  variant?: 'full' | 'compact';
}

export default function PricingSection({ variant = 'full' }: PricingSectionProps) {
  const t = useT();
  const router = useRouter();
  const supabase = createClient();
  const [billing, setBilling] = useState<BillingCycle>('monthly');

  const savePercent = useMemo(() => SAVINGS_PERCENT, []);

  async function openDemo() {
    const { data: { session } } = await supabase.auth.getSession();
    router.push(session ? '/dashboard/onboarding' : '/login');
  }

  function openPrimaryCta() {
    router.push('/login?redirect=/dashboard/onboarding');
  }

  function openPlanCta(plan: PricingPlan) {
    router.push(plan.ctaHref || '/login?redirect=/dashboard/onboarding');
  }

  const isCompact = variant === 'compact';
  const faqIds = isCompact ? [...FAQ_IDS].slice(0, 3) : [...FAQ_IDS];

  return (
    <section id="pricing" className="py-14 md:py-16">
      <div className="mx-auto max-w-6xl px-6">
        <div className={cn(glassStrong, 'p-6 md:p-10')}>
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-300">{t('pricing.sectionTitle')}</p>
            <h2 className={cn('mt-3 font-display text-3xl font-bold tracking-tight md:text-4xl', textMain)}>
              {t('pricing.hero.title')}
            </h2>
            <p className={cn('mt-3 text-sm leading-relaxed md:text-base', textSub)}>
              {t('pricing.hero.subtitle')}
            </p>
            <p className={cn('mt-2 text-xs font-medium', textMuted)}>{t('pricing.hero.trust')}</p>
          </div>

          <div className="mt-7 grid gap-3 md:grid-cols-3">
            <div className={cn(glass, 'px-3 py-3 text-sm', textSub)}>
              {t('pricing.value.saveHours')}
            </div>
            <div className={cn(glass, 'px-3 py-3 text-sm', textSub)}>
              {t('pricing.value.evidence')}
            </div>
            <div className={cn(glass, 'px-3 py-3 text-sm', textSub)}>
              {t('pricing.value.closedFlow')}
            </div>
          </div>

          <div className="mt-6 flex justify-center">
            <ToggleBilling
              value={billing}
              onChange={setBilling}
              monthlyLabel={t('pricing.billing.monthly')}
              yearlyLabel={t('pricing.billing.yearly')}
              saveLabel={t('pricing.savings', { pct: savePercent })}
              showSaveBadge={billing === 'yearly'}
            />
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {plans.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                billing={billing}
                t={t}
                onCta={openPlanCta}
              />
            ))}
          </div>

          {isCompact ? (
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button onClick={openPrimaryCta}>{t('pricing.cta.primary')}</Button>
              <Button variant="secondary" onClick={() => router.push('/pricing')}>
                {t('pricing.cta.allPlans')}
              </Button>
            </div>
          ) : (
            <div className="mt-10 space-y-6">
              <FeatureTable features={FEATURES} plans={plans} billing={billing} t={t} />
              <Faq ids={faqIds} t={t} />

              <div className={cn(glass, 'p-6 text-center')}>
                <h3 className={cn('text-2xl font-semibold', textMain)}>{t('pricing.cta.finalTitle')}</h3>
                <p className={cn('mx-auto mt-2 max-w-2xl text-sm', textSub)}>{t('pricing.cta.finalSubtitle')}</p>
                <div className="mt-5 flex flex-col items-center justify-center gap-3 sm:flex-row">
                  <Button onClick={openPrimaryCta}>{t('pricing.cta.primary')}</Button>
                  <Button variant="secondary" onClick={() => void openDemo()}>
                    {t('pricing.cta.secondary')}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        {isCompact && (
          <div className="mt-6 space-y-6">
            <Faq ids={faqIds} t={t} />
            <div className="flex justify-center">
              <Button variant="secondary" onClick={() => void openDemo()}>
                {t('pricing.cta.secondary')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
