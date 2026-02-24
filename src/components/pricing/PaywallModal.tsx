'use client';

import { useEffect, useMemo } from 'react';
import { useLocale, useT } from '@/components/i18n/I18nContext';
import Button from '@/components/ui/Button';
import { formatPrice, PLANS, type PricingLocale } from '@/lib/pricing/plans';
import { cn } from '@/lib/utils';
import { glass, glassActive, glassStrong, textMain, textMuted, textSub } from '@/components/ui/glass';

export type PaywallTriggerReason = 'editor_access' | 'limit_reached' | 'trial_start' | 'default';
export type PaywallAction = 'essential_trial' | 'pro_upgrade';

interface PaywallModalProps {
  isOpen: boolean;
  triggerReason?: PaywallTriggerReason | string;
  onClose: () => void;
  onAction?: (action: PaywallAction) => void;
}

function resolveTriggerReason(reason: PaywallTriggerReason | string | undefined): PaywallTriggerReason {
  if (reason === 'editor_access' || reason === 'limit_reached' || reason === 'trial_start' || reason === 'default') {
    return reason;
  }
  return 'default';
}

function triggerTitleKey(reason: PaywallTriggerReason | string | undefined): string {
  const resolved = resolveTriggerReason(reason);
  if (resolved === 'editor_access') return 'dashboard.paywall.titles.editor_access';
  if (resolved === 'limit_reached') return 'dashboard.paywall.titles.limit_reached';
  if (resolved === 'trial_start') return 'dashboard.paywall.titles.trial_start';
  return 'dashboard.paywall.titles.default';
}

const checkIcon = (
  <svg className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
    <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export default function PaywallModal({
  isOpen,
  triggerReason = 'default',
  onClose,
  onAction,
}: PaywallModalProps) {
  const t = useT();
  const locale = useLocale();

  const starter = useMemo(() => PLANS.find((plan) => plan.id === 'starter') || PLANS[0], []);
  const pro = useMemo(() => PLANS.find((plan) => plan.id === 'pro') || PLANS[1], []);

  const pricingLocale: PricingLocale = locale === 'es' || locale === 'en' ? locale : 'ca';
  const starterPrice = formatPrice(starter.monthlyPriceCents, pricingLocale);
  const proPrice = formatPrice(pro.monthlyPriceCents, pricingLocale);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[1px]"
      onClick={onClose}
      data-testid="paywall-modal-backdrop"
    >
      <div
        className={cn(glassStrong, 'w-full max-w-4xl p-5 md:p-6 shadow-float')}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        data-testid="paywall-modal"
      >
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className={cn('font-display text-2xl font-semibold md:text-3xl', textMain)}>
              {t(triggerTitleKey(triggerReason))}
            </h2>
            <p className={cn('text-sm md:text-base', textSub)}>{t('dashboard.paywall.subtitle')}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t('dashboard.paywall.close')}
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <section className={cn(glassActive, 'p-4 md:p-5')}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className={cn('text-lg font-semibold', textMain)}>{t('dashboard.paywall.plans.essential.title')}</h3>
              <span className="rounded-full border border-emerald-300/40 bg-emerald-400/18 px-2 py-0.5 text-[11px] font-semibold text-emerald-200">
                {t('dashboard.paywall.plans.essential.badge')}
              </span>
            </div>
            <p className={cn('text-2xl font-bold', textMain)}>
              {starterPrice}
              <span className={cn('ml-1 text-sm font-medium', textSub)}>{t('dashboard.paywall.perMonth')}</span>
            </p>
            <ul className="mt-3 space-y-2">
              <li className={cn('flex items-start gap-2 text-sm', textSub)}>{checkIcon}<span>{t('dashboard.paywall.plans.essential.f1')}</span></li>
              <li className={cn('flex items-start gap-2 text-sm', textSub)}>{checkIcon}<span>{t('dashboard.paywall.plans.essential.f2')}</span></li>
              <li className={cn('flex items-start gap-2 text-sm', textSub)}>{checkIcon}<span>{t('dashboard.paywall.plans.essential.f3')}</span></li>
            </ul>
            <Button className="mt-4 w-full" onClick={() => onAction?.('essential_trial')}>
              {t('dashboard.paywall.plans.essential.cta')}
            </Button>
          </section>

          <section className={cn(glass, 'p-4 md:p-5')}>
            <div className="mb-3">
              <h3 className={cn('text-lg font-semibold', textMain)}>{t('dashboard.paywall.plans.pro.title')}</h3>
            </div>
            <p className={cn('text-2xl font-bold', textMain)}>
              {proPrice}
              <span className={cn('ml-1 text-sm font-medium', textSub)}>{t('dashboard.paywall.perMonth')}</span>
            </p>
            <ul className="mt-3 space-y-2">
              <li className={cn('flex items-start gap-2 text-sm', textSub)}>{checkIcon}<span>{t('dashboard.paywall.plans.pro.f1')}</span></li>
              <li className={cn('flex items-start gap-2 text-sm', textSub)}>{checkIcon}<span>{t('dashboard.paywall.plans.pro.f2')}</span></li>
              <li className={cn('flex items-start gap-2 text-sm', textSub)}>{checkIcon}<span>{t('dashboard.paywall.plans.pro.f3')}</span></li>
              <li className={cn('flex items-start gap-2 text-sm', textSub)}>{checkIcon}<span>{t('dashboard.paywall.plans.pro.f4')}</span></li>
            </ul>
            <Button variant="secondary" className="mt-4 w-full" onClick={() => onAction?.('pro_upgrade')}>
              {t('dashboard.paywall.plans.pro.cta')}
            </Button>
          </section>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs">
          <span className={textMuted}>{t('dashboard.paywall.trust.secure')}</span>
          <span className={textMuted}>|</span>
          <span className={textMuted}>{t('dashboard.paywall.trust.invoice')}</span>
          <span className={textMuted}>|</span>
          <span className={textMuted}>{t('dashboard.paywall.trust.support')}</span>
        </div>
      </div>
    </div>
  );
}
