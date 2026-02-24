'use client';

import type {
  BillingCycle,
  PlanFeatureValue,
  PricingFeature,
  PricingFeatureId,
  PricingPlan,
} from '@/lib/pricing/plans';
import { cn } from '@/lib/utils';
import { glassStrong, textMain, textSub } from '@/components/ui/glass';

interface FeatureTableProps {
  features: PricingFeature[];
  plans: PricingPlan[];
  billing: BillingCycle;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

function resolveFeatureValue(
  value: PlanFeatureValue,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  if (typeof value === 'boolean') {
    return value ? t('pricing.included') : t('pricing.notIncluded');
  }
  const translated = t(value);
  return translated === value ? value : translated;
}

function featureCellClass(value: PlanFeatureValue): string {
  if (value === true) return 'text-emerald-300';
  if (value === false) return 'text-white/45';
  return 'text-white/75';
}

function hasFeature(plan: PricingPlan, id: PricingFeatureId): PlanFeatureValue {
  return plan.features[id];
}

export default function FeatureTable({ features, plans, billing, t }: FeatureTableProps) {
  return (
    <section className={cn(glassStrong, 'p-4 md:p-6')} data-testid="pricing-feature-table">
      <h2 className={cn('text-xl font-semibold', textMain)}>{t('pricing.tableTitle')}</h2>
      <p className={cn('mt-1 text-sm', textSub)}>
        {billing === 'yearly' ? t('pricing.billing.yearly') : t('pricing.billing.monthly')}
      </p>

      <div className="mt-4 overflow-x-auto">
        <table className="min-w-[840px] w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-20 bg-[#0A1B2D]/95 px-3 py-3 text-left font-semibold text-white/85">
                {t('pricing.tableFeature')}
              </th>
              {plans.map((plan) => (
                <th key={plan.id} className="border-b border-white/14 px-3 py-3 text-left font-semibold text-white/80">
                  {t(plan.nameKey)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {features.map((feature) => (
              <tr key={feature.id}>
                <td className="sticky left-0 z-10 border-b border-white/10 bg-[#0A1B2D]/95 px-3 py-3 font-medium text-white/78">
                  {t(feature.labelKey)}
                </td>
                {plans.map((plan) => {
                  const value = hasFeature(plan, feature.id);
                  return (
                    <td
                      key={`${feature.id}-${plan.id}`}
                      className={`border-b border-white/10 px-3 py-3 ${featureCellClass(value)}`}
                    >
                      {resolveFeatureValue(value, t)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
