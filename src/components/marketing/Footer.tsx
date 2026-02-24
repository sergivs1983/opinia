'use client';

import Link from 'next/link';
import Logo from '@/components/ui/Logo';
import { useT } from '@/components/i18n/I18nContext';
import { cn } from '@/lib/utils';
import { glass, textMuted } from '@/components/ui/glass';

export default function Footer() {
  const t = useT();

  return (
    <footer className="px-6 pb-10 pt-8">
      <div className={cn(glass, 'mx-auto flex max-w-6xl flex-col items-start gap-4 p-5 md:flex-row md:items-center md:justify-between')}>
        <div>
          <Logo size="sm" />
          <p className={cn('mt-2 text-xs', textMuted)}>{t('landing.footer.copy')}</p>
        </div>

        <nav className="flex flex-wrap items-center gap-4 text-sm text-white/70">
          <Link href="/pricing" className="transition-colors hover:text-white/90">{t('landing.nav.pricing')}</Link>
          <Link href="/terms" className="transition-colors hover:text-white/90">{t('legal.terms')}</Link>
          <Link href="/privacy" className="transition-colors hover:text-white/90">{t('legal.privacy')}</Link>
        </nav>
      </div>
    </footer>
  );
}
