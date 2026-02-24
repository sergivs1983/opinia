'use client';

import { useState } from 'react';
import { useT, useI18n } from '@/components/i18n/I18nContext';
import { cn } from '@/lib/utils';
import { glassCard, glassPill, textMain, textMuted } from '@/components/ui/glass';
import type { Locale } from '@/i18n/config';

const LOCALE_OPTS = [
  { id: 'ca', labelKey: 'common.locales.ca' },
  { id: 'es', labelKey: 'common.locales.es' },
  { id: 'en', labelKey: 'common.locales.en' },
] as const;

export default function LanguageSettings() {
  const t = useT();
  const { locale, setLocale } = useI18n();
  const [saving, setSaving] = useState(false);

  const handleChange = async (newLocale: Locale) => {
    if (newLocale === locale || saving) return;
    const previousLocale = locale;
    setSaving(true);
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
      setSaving(false);
    }
  };

  return (
    <div className={cn(glassCard, 'max-w-md space-y-4 p-6')}>
      <div>
        <h3 className={cn('font-semibold', textMain)}>{t('settings.language.title')}</h3>
        <p className={cn('mt-1 text-xs', textMuted)}>{t('settings.language.desc')}</p>
      </div>
      <div className="flex gap-2">
        {LOCALE_OPTS.map(l => (
          <button key={l.id} onClick={() => handleChange(l.id)} disabled={saving}
            className={cn(
              'flex-1 rounded-xl border px-4 py-3 text-sm font-medium transition-all duration-[220ms] ease-premium',
              l.id === locale
                ? cn(glassPill, 'border-brand-accent/45 text-white/92 ring-2 ring-brand-accent/35')
                : 'border-white/14 bg-white/8 text-white/72 hover:bg-white/12',
              saving && 'opacity-50'
            )}>
            {t(l.labelKey)}
          </button>
        ))}
      </div>
    </div>
  );
}
