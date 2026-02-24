'use client';

import { useState } from 'react';
import { useI18n, useT } from './I18nContext';
import { cn } from '@/lib/utils';
import { glassPill } from '@/components/ui/glass';
import type { Locale } from '@/i18n/config';

const OPTS = [
  { id: 'ca', labelKey: 'common.locales.ca', short: 'CA' },
  { id: 'es', labelKey: 'common.locales.es', short: 'ES' },
  { id: 'en', labelKey: 'common.locales.en', short: 'EN' },
] as const;

export default function LanguageSwitcher({ className }: { className?: string }) {
  const t = useT();
  const { locale, setLocale } = useI18n();
  const [loading, setLoading] = useState(false);

  const switchLocale = async (newLocale: Locale) => {
    if (newLocale === locale || loading) return;
    const previousLocale = locale;
    setLoading(true);

    setLocale(newLocale);
    try {
      const response = await fetch('/api/locale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale: newLocale }),
      });
      if (!response.ok) {
        throw new Error('locale_update_failed');
      }
    } catch {
      setLocale(previousLocale);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={cn('inline-flex items-center gap-1 rounded-full border border-white/14 bg-white/8 p-1', className)}>
      {OPTS.map((option) => {
        const active = option.id === locale;
        return (
          <button
            key={option.id}
            onClick={() => void switchLocale(option.id)}
            disabled={loading}
            aria-label={t(option.labelKey)}
            className={cn(
              'min-w-[38px] rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all duration-[220ms] ease-premium',
              active ? cn(glassPill, 'border-brand-accent/45 text-white/92') : 'text-white/68 hover:bg-white/10',
              loading && 'opacity-60',
            )}
          >
            {option.short}
          </button>
        );
      })}
    </div>
  );
}
