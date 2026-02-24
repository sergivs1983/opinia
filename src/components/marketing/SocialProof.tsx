'use client';

import { useT } from '@/components/i18n/I18nContext';
import { cn } from '@/lib/utils';
import { glass, textSub } from '@/components/ui/glass';

const SOCIAL_KEYS = [
  'landing.socialProof.items.restaurants',
  'landing.socialProof.items.hotels',
  'landing.socialProof.items.clinics',
  'landing.socialProof.items.retail',
  'landing.socialProof.items.services',
] as const;

export default function SocialProof() {
  const t = useT();

  return (
    <section className="px-6 pb-12 md:pb-14">
      <div className="mx-auto max-w-6xl">
        <p className="text-center text-xs font-semibold uppercase tracking-[0.12em] text-white/55">
          {t('landing.socialProof.title')}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
          {SOCIAL_KEYS.map((key) => (
            <div key={key} className={cn(glass, 'px-4 py-3 text-center text-sm font-medium', textSub)}>
              {t(key)}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
