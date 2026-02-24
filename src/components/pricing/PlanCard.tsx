'use client';

import Button from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { glass, glassActive, textMain, textSub } from '@/components/ui/glass';
import { useLocale } from '@/components/i18n/I18nContext';
import {
  formatPrice,
  getPrice,
  type BillingCycle,
  type PricingLocale,
  type PricingPlan,
} from '@/lib/pricing/plans';

interface PlanCardProps {
  plan: PricingPlan;
  billing: BillingCycle;
  t: (key: string, vars?: Record<string, string | number>) => string;
  onCta: (plan: PricingPlan) => void;
  variant?: 'default' | 'compact';
  ctaLabel?: string;
  dataTestId?: string;
  ctaLoading?: boolean;
}

export default function PlanCard({
  plan,
  billing,
  t,
  onCta,
  variant = 'default',
  ctaLabel,
  dataTestId,
  ctaLoading = false,
}: PlanCardProps) {
  const locale = (useLocale() || 'ca') as PricingLocale;
  const price = getPrice(plan, billing);
  const isCompact = variant === 'compact';
  const priceLabel = billing === 'monthly'
    ? `${formatPrice(price.monthlyPriceCents, locale)}${t('pricing.perMonth')}`
    : `${formatPrice(price.annualPriceCents, locale)}${t('pricing.perYear')}`;
  const effectiveMonthlyLabel = t('pricing.effectiveMonthlyBilledAnnually', {
    amount: formatPrice(price.effectiveMonthlyCents, locale, { decimals: 2 }),
  });
  const savingsLabel = `${t('pricing.twoMonthsFree')} · ${t('pricing.savings', { pct: price.savingsPct })}`;
  const bullets = isCompact ? plan.bulletsKeys.slice(0, 2) : plan.bulletsKeys;

  return (
    <article
      className={cn(
        'relative flex h-full flex-col transition-all duration-[220ms] ease-premium',
        isCompact ? 'p-4' : 'p-5',
        plan.recommended ? cn(glassActive, 'ring-1 ring-brand-accent/40') : cn(glass, 'hover:bg-white/10'),
      )}
      data-testid={dataTestId ?? 'pricing-plan-card'}
      aria-label={t(plan.nameKey)}
    >
      {plan.recommended && (
        <span className={cn(
          'absolute rounded-full bg-brand-accent font-semibold text-white',
          isCompact ? '-top-2 left-3 px-2 py-0.5 text-[10px]' : '-top-3 left-4 px-2.5 py-1 text-[11px]',
        )}>
          {t('pricing.recommended')}
        </span>
      )}

      <h3 className={cn(isCompact ? 'text-base' : 'text-lg', 'font-semibold', textMain)}>{t(plan.nameKey)}</h3>
      <p className={cn('mt-1', isCompact ? 'text-xs' : 'text-sm', textSub)}>{t(plan.descriptionKey)}</p>

      <p className={cn(isCompact ? 'mt-3 text-2xl' : 'mt-5 text-3xl', 'font-bold', textMain)}>
        {priceLabel}
      </p>
      {billing === 'yearly' && (
        <>
          <p className={cn('mt-1 text-xs text-white/70')} data-testid="pricing-effective-monthly">
            {effectiveMonthlyLabel}
          </p>
          <p className="mt-1 text-xs font-medium text-emerald-300" data-testid="pricing-savings-badge">
            {savingsLabel}
          </p>
        </>
      )}

      <ul className={cn(isCompact ? 'mt-3 space-y-1.5 text-xs' : 'mt-5 space-y-2 text-sm', textSub)}>
        {bullets.map((bulletKey) => (
          <li key={bulletKey} className="flex items-start gap-2">
            <span className={cn('rounded-full bg-brand-accent', isCompact ? 'mt-1 h-1.5 w-1.5' : 'mt-1 h-2 w-2')} aria-hidden="true" />
            <span>{t(bulletKey)}</span>
          </li>
        ))}
      </ul>

      <div className={cn(isCompact ? 'mt-4 pt-1' : 'mt-6 pt-2')}>
        <Button
          className="w-full"
          variant={plan.recommended ? 'primary' : 'secondary'}
          onClick={() => onCta(plan)}
          loading={ctaLoading}
          data-testid="pricing-plan-cta"
          aria-label={`${t('pricing.cta.primary')} ${t(plan.nameKey)}`}
        >
          {ctaLabel ?? t('pricing.cta.primary')}
        </Button>
      </div>
    </article>
  );
}
