'use client';

import Badge from '@/components/ui/Badge';
import { useT } from '@/components/i18n/I18nContext';
import { cn } from '@/lib/utils';
import { glass, glassActive, textMain, textSub } from '@/components/ui/glass';

const REVIEW_IDS = ['speed', 'service', 'clarity', 'value'] as const;
const PLATFORM_TONES = {
  speed: 'google',
  service: 'tripadvisor',
  clarity: 'booking',
  value: 'google',
} as const;

export default function ReviewsMosaic() {
  const t = useT();

  return (
    <section className="px-6 py-12 md:py-14">
      <div className="mx-auto max-w-6xl">
        <h2 className={cn('text-center font-display text-2xl font-bold md:text-3xl', textMain)}>
          {t('landing.reviews.title')}
        </h2>
        <p className={cn('mx-auto mt-3 max-w-2xl text-center text-sm md:text-base', textSub)}>
          {t('landing.reviews.subtitle')}
        </p>

        <div className="mt-8 grid gap-4 md:grid-cols-12">
          {REVIEW_IDS.map((id, index) => (
            <article
              key={id}
              className={cn(
                index === 0 ? `${glassActive} md:col-span-6` : `${glass} md:col-span-6`,
                'p-5',
              )}
            >
              <header className="flex items-center justify-between gap-3">
                <Badge kind="platform" tone={PLATFORM_TONES[id]}>
                  {t(`landing.reviews.cards.${id}.platform`)}
                </Badge>
                <span className="text-sm font-semibold text-amber-300">
                  {t(`landing.reviews.cards.${id}.rating`)}
                </span>
              </header>

              <p className={cn('mt-3 text-sm leading-relaxed', textSub)}>
                “{t(`landing.reviews.cards.${id}.snippet`)}”
              </p>

              <div className={cn('mt-4 rounded-lg border border-white/10 bg-black/20 p-3', textSub)}>
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-emerald-300">
                  {t('landing.reviews.suggestedLabel')}
                </p>
                <p className="mt-1 text-sm leading-relaxed">
                  {t(`landing.reviews.cards.${id}.reply`)}
                </p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
