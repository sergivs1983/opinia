'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { glassStrong, textMain, textSub } from '@/components/ui/glass';

interface FaqProps {
  ids: string[];
  t: (key: string, vars?: Record<string, string | number>) => string;
}

export default function Faq({ ids, t }: FaqProps) {
  const [openId, setOpenId] = useState<string | null>(ids[0] || null);

  return (
    <section className={cn(glassStrong, 'p-4 md:p-6')} data-testid="pricing-faq">
      <h2 className={cn('text-xl font-semibold', textMain)}>{t('pricing.faq.title')}</h2>
      <div className="mt-4 divide-y divide-white/10">
        {ids.map((id) => {
          const isOpen = openId === id;
          const panelId = `pricing-faq-panel-${id}`;
          const buttonId = `pricing-faq-button-${id}`;

          return (
            <div key={id} className="py-2">
              <button
                id={buttonId}
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => setOpenId(isOpen ? null : id)}
                className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm font-medium text-white/88 transition-all duration-[220ms] ease-premium hover:bg-white/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent/40"
              >
                <span>{t(`pricing.faq.${id}.q`)}</span>
                <span className="ml-3 text-white/55" aria-hidden="true">
                  {isOpen ? '−' : '+'}
                </span>
              </button>
              <div
                id={panelId}
                role="region"
                aria-labelledby={buttonId}
                hidden={!isOpen}
                className={cn('px-2 pb-2 pt-1 text-sm leading-relaxed', textSub)}
              >
                {t(`pricing.faq.${id}.a`)}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
