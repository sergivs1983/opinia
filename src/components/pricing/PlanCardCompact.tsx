'use client';

import Button from '@/components/ui/Button';
import { useLocale } from '@/components/i18n/I18nContext';
import { cn } from '@/lib/utils';
import { glass, glassActive, textMain, textSub } from '@/components/ui/glass';
import { formatPrice, getPrice, type BillingCycle, type PricingLocale, type PricingPlan } from '@/lib/pricing/plans';

interface PlanCardCompactProps {
  plan: PricingPlan;
  billing: BillingCycle;
  t: (key: string, vars?: Record<string, string | number>) => string;
  canUpgradeDirectly: boolean;
  upgrading: boolean;
  onUpgrade: (planId: string) => void;
  onOpenPricing: () => void;
}

export default function PlanCardCompact({
  plan,
  billing,
  t,
  canUpgradeDirectly,
  upgrading,
  onUpgrade,
  onOpenPricing,
}: PlanCardCompactProps) {
  const locale = (useLocale() || 'ca') as PricingLocale;
  const price = getPrice(plan, billing);

  return (
    <article
      className={cn(
        'relative flex h-full flex-col p-4 transition-all duration-[220ms] ease-premium',
        plan.recommended ? cn(glassActive, 'ring-1 ring-brand-accent/35') : cn(glass, 'hover:bg-white/10'),
      )}
      data-testid="plan-upgrade-card"
    >
      {plan.recommended && (
        <span className="absolute -top-2 left-3 rounded-full bg-brand-accent px-2 py-0.5 text-[10px] font-semibold text-white">
          {t('pricing.recommended')}
        </span>
      )}

      <h4 className={cn('text-base font-semibold', textMain)}>{t(plan.nameKey)}</h4>
      <p className={cn('mt-0.5 text-xs', textSub)}>{t(plan.descriptionKey)}</p>

      <p className={cn('mt-3 text-2xl font-bold', textMain)}>
        {billing === 'monthly'
          ? formatPrice(price.monthlyPriceCents, locale)
          : formatPrice(price.annualPriceCents, locale)}
        <span className="text-sm font-normal text-white/60">
          {billing === 'monthly' ? t('pricing.perMonth') : t('pricing.perYear')}
        </span>
      </p>
      {billing === 'yearly' && (
        <p className="mt-1 text-xs font-medium text-emerald-300">
          {t('pricing.twoMonthsFree')} · {t('pricing.savings', { pct: price.savingsPct })}
        </p>
      )}

      <ul className={cn('mt-3 space-y-1.5 text-xs', textSub)}>
        {plan.bulletsKeys.slice(0, 2).map((bulletKey) => (
          <li key={bulletKey} className="flex items-start gap-2">
            <span className="mt-1 h-1.5 w-1.5 rounded-full bg-brand-accent" aria-hidden="true" />
            <span>{t(bulletKey)}</span>
          </li>
        ))}
      </ul>

      <div className="mt-4 pt-1">
        <Button
          size="sm"
          variant={canUpgradeDirectly ? 'primary' : 'secondary'}
          loading={upgrading}
          className="w-full"
          onClick={() => {
            if (canUpgradeDirectly) {
              onUpgrade(plan.id);
              return;
            }
            onOpenPricing();
          }}
        >
          {canUpgradeDirectly
            ? t('common.upgradeTo').replace('{name}', t(plan.nameKey))
            : t('pricing.cta.allPlans')}
        </Button>
      </div>
    </article>
  );
}
