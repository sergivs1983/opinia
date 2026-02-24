import type { Metadata } from 'next';
import Link from 'next/link';
import { PricingSection } from '@/components/pricing';
import Logo from '@/components/ui/Logo';
import { glass } from '@/components/ui/glass';
import { cn } from '@/lib/utils';
import { getLocale } from '@/i18n/getLocale';
import { getMessages } from '@/i18n/getMessages';

export const metadata: Metadata = {
  title: 'Pricing · OpinIA',
  description: 'Plans clars per convertir ressenyes en respostes, contingut i publicacions setmanals.',
};

function getMessage(messages: Record<string, unknown>, key: string): string {
  let value: unknown = messages;
  for (const segment of key.split('.')) {
    if (!value || typeof value !== 'object') return key;
    value = (value as Record<string, unknown>)[segment];
  }
  return typeof value === 'string' ? value : key;
}

export default async function PricingPage() {
  const locale = getLocale();
  const messages = await getMessages(locale);
  const t = (key: string) => getMessage(messages, key);

  return (
    <main className="min-h-screen text-white/90">
      <header className={cn(glass, 'mx-auto mt-6 flex w-[calc(100%-3rem)] max-w-6xl items-center justify-between px-5 py-3')}>
        <Link href="/" aria-label="OpinIA home">
          <Logo size="sm" />
        </Link>
        <Link
          href="/login?redirect=/dashboard/onboarding"
          className="rounded-lg border border-white/14 bg-white/8 px-3 py-1.5 text-sm text-white/80 transition-all duration-[220ms] ease-premium hover:bg-white/12 hover:text-white/92"
        >
          {t('landing.nav.signIn')}
        </Link>
      </header>
      <section className="mx-auto max-w-6xl px-6 pt-12">
        <div className={cn(glass, 'p-5 md:p-6 text-center')}>
          <h1 className="font-display text-3xl md:text-4xl font-bold text-white/92">
            {t('pricing.hero.title')}
          </h1>
          <p className="mt-2 text-sm md:text-base text-white/70">
            {t('pricing.hero.subtitle')}
          </p>
        </div>
      </section>
      <PricingSection variant="full" />
    </main>
  );
}
