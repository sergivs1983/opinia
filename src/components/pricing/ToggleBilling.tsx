'use client';

import { cn } from '@/lib/utils';
import { glassStrong } from '@/components/ui/glass';
import type { BillingCycle } from '@/lib/pricing/plans';

interface ToggleBillingProps {
  value: BillingCycle;
  onChange: (value: BillingCycle) => void;
  monthlyLabel: string;
  yearlyLabel: string;
  saveLabel: string;
  showSaveBadge?: boolean;
  dataTestId?: string;
}

export default function ToggleBilling({
  value,
  onChange,
  monthlyLabel,
  yearlyLabel,
  saveLabel,
  showSaveBadge = false,
  dataTestId,
}: ToggleBillingProps) {
  return (
    <div
      className={cn('inline-flex items-center gap-1 p-1', glassStrong)}
      role="group"
      aria-label="Billing cycle"
      data-testid={dataTestId ?? 'pricing-billing-toggle'}
    >
      <button
        type="button"
        onClick={() => onChange('monthly')}
        aria-pressed={value === 'monthly'}
        className={cn(
          'rounded-lg px-3 py-1.5 text-sm transition-all duration-[220ms] ease-premium',
          value === 'monthly'
            ? 'bg-brand-accent text-white shadow-glass'
            : 'text-white/70 hover:bg-white/10',
        )}
      >
        {monthlyLabel}
      </button>
      <button
        type="button"
        onClick={() => onChange('yearly')}
        aria-pressed={value === 'yearly'}
        className={cn(
          'rounded-lg px-3 py-1.5 text-sm transition-all duration-[220ms] ease-premium',
          value === 'yearly'
            ? 'bg-brand-accent text-white shadow-glass'
            : 'text-white/70 hover:bg-white/10',
        )}
      >
        {yearlyLabel}
      </button>
      {showSaveBadge && (
        <span className="rounded-md border border-brand-accent/40 bg-brand-accent/15 px-2 py-1 text-[11px] font-semibold text-emerald-300">
          {saveLabel}
        </span>
      )}
    </div>
  );
}
