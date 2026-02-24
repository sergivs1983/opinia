'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Hero from '@/components/marketing/Hero';
import HowItWorks from '@/components/marketing/HowItWorks';
import SocialProof from '@/components/marketing/SocialProof';
import ReviewsMosaic from '@/components/marketing/ReviewsMosaic';
import Footer from '@/components/marketing/Footer';
import { PricingSection } from '@/components/pricing';
import Logo from '@/components/ui/Logo';
import Button from '@/components/ui/Button';
import { useT } from '@/components/i18n/I18nContext';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { glass, glassStrong, textMain, textSub } from '@/components/ui/glass';

const DEFAULT_START_HREF = '/login?redirect=/dashboard/onboarding';
const FLOW_IDS = ['reviews', 'reply', 'content'] as const;
const EXAMPLE_IDS = ['empathy', 'operations', 'upsell'] as const;
const MINI_IDS = ['studio', 'planner', 'export'] as const;
const FAQ_IDS = ['fast', 'editing', 'catalan'] as const;

export default function LandingPage() {
  const t = useT();
  const router = useRouter();

  async function openStart() {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    router.push(session ? '/dashboard/onboarding' : DEFAULT_START_HREF);
  }

  return (
    <div className="opinia-hero-bg opinia-hero-overlay min-h-screen text-white/90">
      <nav className="sticky top-0 z-50 border-b border-white/10 bg-white/5 bg-gradient-to-b from-black/30 via-black/10 to-transparent px-6 py-4 backdrop-blur-xl shadow-glass transition-all duration-200 ease-premium">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4">
          <Link href="/" className="shrink-0">
            <Logo size="hero" className="origin-left scale-[1.02] md:scale-105" />
          </Link>

          <div className="flex items-center gap-2 sm:gap-3">
            <Link href="/pricing" className="hidden text-sm text-white/80 transition-colors duration-200 ease-premium hover:text-white sm:inline">
              {t('landing.nav.pricing')}
            </Link>
            <a href="#faq" className="hidden text-sm text-white/80 transition-colors duration-200 ease-premium hover:text-white sm:inline">
              {t('landing.nav.help')}
            </a>
            <Button variant="secondary" size="sm" onClick={() => router.push('/login')}>
              {t('landing.nav.signIn')}
            </Button>
            <Button size="sm" onClick={openStart}>
              {t('landing.nav.start')}
            </Button>
          </div>
        </div>
      </nav>

      <main>
        <Hero onStart={openStart} onViewPricing={() => router.push('/pricing')} />
        <SocialProof />
        <HowItWorks />

        <section className="px-6 py-12 md:py-14">
          <div className="mx-auto max-w-6xl">
            <div className="mx-auto max-w-3xl text-center">
              <h2 className={cn('font-display text-2xl font-bold md:text-3xl', textMain)}>
                {t('landing.flow.title')}
              </h2>
              <p className={cn('mt-3 text-sm md:text-base', textSub)}>{t('landing.flow.subtitle')}</p>
            </div>

            <div className="mt-7 grid gap-4 md:grid-cols-3">
              {FLOW_IDS.map((flowId) => (
                <article key={flowId} className={cn(glassStrong, 'p-5')}>
                  <p className="text-xs font-semibold uppercase tracking-[0.1em] text-emerald-300">
                    {t(`landing.flow.cards.${flowId}.label`)}
                  </p>
                  <h3 className={cn('mt-2 text-lg font-semibold', textMain)}>{t(`landing.flow.cards.${flowId}.title`)}</h3>
                  <p className={cn('mt-2 text-sm leading-relaxed', textSub)}>
                    {t(`landing.flow.cards.${flowId}.description`)}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <ReviewsMosaic />

        <section className="px-6 py-12 md:py-14">
          <div className="mx-auto max-w-6xl">
            <h2 className={cn('text-center font-display text-2xl font-bold md:text-3xl', textMain)}>
              {t('landing.examples.title')}
            </h2>
            <p className={cn('mx-auto mt-3 max-w-2xl text-center text-sm md:text-base', textSub)}>
              {t('landing.examples.subtitle')}
            </p>

            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {EXAMPLE_IDS.map((exampleId) => (
                <article key={exampleId} className={cn(glass, 'p-5')}>
                  <p className="text-xs font-semibold uppercase tracking-[0.1em] text-cyan-200">
                    {t(`landing.examples.items.${exampleId}.tone`)}
                  </p>
                  <p className={cn('mt-3 text-sm leading-relaxed', textSub)}>
                    “{t(`landing.examples.items.${exampleId}.reply`)}”
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="px-6 py-12 md:py-14">
          <div className={cn(glassStrong, 'mx-auto max-w-6xl p-6 md:p-8')}>
            <h2 className={cn('text-center font-display text-2xl font-bold md:text-3xl', textMain)}>
              {t('landing.mini.title')}
            </h2>
            <div className="mt-6 grid gap-3 md:grid-cols-3">
              {MINI_IDS.map((item) => (
                <div key={item} className={cn(glass, 'px-4 py-4 text-sm', textSub)}>
                  {t(`landing.mini.items.${item}`)}
                </div>
              ))}
            </div>
          </div>
        </section>

        <PricingSection variant="compact" />

        <section id="faq" className="px-6 py-12 md:py-14">
          <div className="mx-auto max-w-4xl">
            <h2 className={cn('text-center font-display text-2xl font-bold md:text-3xl', textMain)}>
              {t('landing.faqShort.title')}
            </h2>

            <div className="mt-7 space-y-3">
              {FAQ_IDS.map((id) => (
                <article key={id} className={cn(glass, 'p-5')}>
                  <h3 className={cn('text-sm font-semibold md:text-base', textMain)}>{t(`landing.faqShort.items.${id}.q`)}</h3>
                  <p className={cn('mt-2 text-sm leading-relaxed', textSub)}>{t(`landing.faqShort.items.${id}.a`)}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
