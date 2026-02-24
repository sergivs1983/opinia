'use client';

import { useT } from '@/components/i18n/I18nContext';
import { cn } from '@/lib/utils';
import { glass, textMain, textSub } from '@/components/ui/glass';

const STEP_IDS = ['reviews', 'reply', 'content'] as const;

export default function HowItWorks() {
  const t = useT();

  return (
    <section className="px-6 py-12 md:py-14">
      <div className="mx-auto max-w-6xl">
        <h2 className={cn('text-center font-display text-2xl font-bold md:text-3xl', textMain)}>
          {t('landing.howItWorks.title')}
        </h2>

        <div className="mt-7 grid gap-4 md:grid-cols-3">
          {STEP_IDS.map((step, index) => (
            <article key={step} className={cn(glass, 'p-5')}>
              <div className="mb-4 flex items-center gap-3">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-brand-accent/45 bg-brand-accent/15 text-sm font-bold text-emerald-300">
                  {index + 1}
                </span>
                <p className={cn('text-sm font-semibold uppercase tracking-[0.08em]', textSub)}>
                  {t(`landing.howItWorks.steps.${step}.label`)}
                </p>
              </div>

              <h3 className={cn('text-lg font-semibold', textMain)}>
                {t(`landing.howItWorks.steps.${step}.title`)}
              </h3>
              <p className={cn('mt-2 text-sm leading-relaxed', textSub)}>
                {t(`landing.howItWorks.steps.${step}.description`)}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
