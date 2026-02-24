'use client';

import Button from '@/components/ui/Button';
import { useT } from '@/components/i18n/I18nContext';
import { cn } from '@/lib/utils';
import { glass, glassStrong, textMain, textSub, textMuted } from '@/components/ui/glass';

interface HeroProps {
  onStart: () => void;
  onViewPricing: () => void;
}

export default function Hero({ onStart, onViewPricing }: HeroProps) {
  const t = useT();

  return (
    <section className="px-6 pt-12 pb-14 md:pt-20 md:pb-20">
      <div className="mx-auto max-w-6xl">
        <div className={cn(glassStrong, 'relative overflow-hidden p-8 text-center md:p-14')}>
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(0,168,107,0.15),transparent_45%),radial-gradient(circle_at_80%_25%,rgba(10,37,64,0.5),transparent_45%)]" />
          <div className="relative mx-auto max-w-4xl">
            <span className={cn(glass, 'inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em]', textSub)}>
              <span className="h-2 w-2 rounded-full bg-brand-accent" />
              {t('landing.heroArtlist.badge')}
            </span>

            <h1 className={cn('mt-6 font-display text-4xl font-bold leading-[1.04] tracking-tight md:text-6xl', textMain)}>
              {t('landing.heroArtlist.title')}
            </h1>

            <p className={cn('mx-auto mt-4 max-w-2xl text-base md:text-lg', textSub)}>
              {t('landing.heroArtlist.subtitle')}
            </p>

            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button onClick={onStart} size="lg">
                {t('landing.heroArtlist.primaryCta')}
              </Button>
              <Button onClick={onViewPricing} variant="secondary" size="lg">
                {t('landing.heroArtlist.secondaryCta')}
              </Button>
            </div>

            <p className={cn('mt-4 text-xs font-medium', textMuted)}>{t('landing.heroArtlist.trust')}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
