'use client';

import { useMemo, useState } from 'react';
import LegalShell from '@/components/ui/LegalShell';
import { cn } from '@/lib/utils';
import { useI18n, useT } from '@/components/i18n/I18nContext';
import { formatPrice, PLANS, type PricingLocale } from '@/lib/pricing/plans';

const FAQ_IDS = [
  'generate',
  'providers',
  'training',
  'gbp',
  'memory',
  'incorrect',
  'plans',
  'cancel',
] as const;

export default function SupportPage() {
  const t = useT();
  const { locale } = useI18n();
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  const pricingLocale: PricingLocale = locale === 'es' || locale === 'en' ? locale : 'ca';
  const starterPrice = formatPrice(PLANS.find((plan) => plan.id === 'starter')?.monthlyPriceCents ?? 0, pricingLocale);
  const proPrice = formatPrice(PLANS.find((plan) => plan.id === 'pro')?.monthlyPriceCents ?? 0, pricingLocale);
  const agencyPrice = formatPrice(PLANS.find((plan) => plan.id === 'agency')?.monthlyPriceCents ?? 0, pricingLocale);

  const faq = useMemo(
    () =>
      FAQ_IDS.map((id) => ({
        q: t(`supportPage.faq.items.${id}.q`),
        a:
          id === 'plans'
            ? t(`supportPage.faq.items.${id}.a`, {
                starter: starterPrice,
                pro: proPrice,
                agency: agencyPrice,
              })
            : t(`supportPage.faq.items.${id}.a`),
      })),
    [t, starterPrice, proPrice, agencyPrice],
  );

  return (
    <LegalShell title={t('supportPage.title')} lastUpdated={t('supportPage.lastUpdated')}>
      {/* Contact */}
      <section className="not-prose">
        <div className="grid sm:grid-cols-2 gap-4 mb-10">
          <a href="mailto:support@opinia.cat" className="block p-5 rounded-xl border border-surface-200 hover:border-brand-300 hover:bg-brand-50/30 transition-all">
            <p className="text-2xl mb-2">📧</p>
            <p className="font-semibold text-surface-800">{t('supportPage.contact.emailTitle')}</p>
            <p className="text-sm text-surface-500 mt-1">{t('supportPage.contact.emailAddress')}</p>
            <p className="text-xs text-surface-400 mt-2">{t('supportPage.contact.emailSla')}</p>
          </a>
          <a href="https://github.com/opinia-app" target="_blank" rel="noopener" className="block p-5 rounded-xl border border-surface-200 hover:border-brand-300 hover:bg-brand-50/30 transition-all">
            <p className="text-2xl mb-2">📖</p>
            <p className="font-semibold text-surface-800">{t('supportPage.contact.docsTitle')}</p>
            <p className="text-sm text-surface-500 mt-1">{t('supportPage.contact.docsSubtitle')}</p>
            <p className="text-xs text-surface-400 mt-2">{t('supportPage.contact.docsStatus')}</p>
          </a>
        </div>
      </section>

      {/* Emergency status */}
      <section className="not-prose mb-10">
        <div className="flex items-center gap-3 p-4 rounded-xl border border-green-200 bg-green-50/30">
          <span className="w-3 h-3 rounded-full bg-green-500 animate-pulse" />
          <div>
            <p className="text-sm font-semibold text-green-800">{t('supportPage.status.okTitle')}</p>
            <p className="text-xs text-green-600">
              {t('supportPage.status.okSubtitle', { path: '' })}
              <a href="/dashboard/status" className="underline">{t('supportPage.status.linkLabel')}</a>
            </p>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section>
        <h2 className="text-lg font-semibold text-surface-900 mb-4">{t('supportPage.faq.title')}</h2>
        <div className="space-y-2">
          {faq.map((item, i) => (
            <div key={i} className="border border-surface-200 rounded-xl overflow-hidden">
              <button
                onClick={() => setOpenIdx(openIdx === i ? null : i)}
                className="w-full text-left px-5 py-4 flex items-center justify-between hover:bg-surface-50/50 transition-colors"
              >
                <span className="text-sm font-medium text-surface-800 pr-4">{item.q}</span>
                <span className={cn('text-surface-400 transition-transform', openIdx === i && 'rotate-180')}>▾</span>
              </button>
              {openIdx === i && (
                <div className="px-5 pb-4">
                  <p className="text-sm text-surface-600 leading-relaxed">{item.a}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </LegalShell>
  );
}
