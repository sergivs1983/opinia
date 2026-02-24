'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Logo from '@/components/ui/Logo';
import GlassCard from '@/components/ui/GlassCard';
import { useT } from '@/components/i18n/I18nContext';
import { cn } from '@/lib/utils';
import { textMain, textSub } from '@/components/ui/glass';
import { useSupabase } from '@/hooks/useSupabase';
import { loadReverseOnboardingContext } from '@/lib/reverse-onboarding';

const REVERSE_ONBOARDING_CACHE_KEY = 'opinia.reverse_onboarding.context';
const MIN_ANALYZING_MS = 7000;
const ROTATE_MS = 2500;

export default function OnboardingAnalyzingPage() {
  const t = useT();
  const router = useRouter();
  const supabase = useSupabase();
  const [lineIndex, setLineIndex] = useState(0);
  const [minElapsed, setMinElapsed] = useState(false);
  const [fetchDone, setFetchDone] = useState(false);

  const lines = useMemo(
    () => [
      t('onboardingReverse.analyzing.line1'),
      t('onboardingReverse.analyzing.line2'),
      t('onboardingReverse.analyzing.line3'),
    ],
    [t],
  );

  useEffect(() => {
    const id = window.setInterval(() => {
      setLineIndex((previous) => (previous + 1) % lines.length);
    }, ROTATE_MS);
    return () => window.clearInterval(id);
  }, [lines.length]);

  useEffect(() => {
    const id = window.setTimeout(() => setMinElapsed(true), MIN_ANALYZING_MS);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const context = await loadReverseOnboardingContext({
        supabase,
        ensureGenerated: true,
      });

      if (cancelled) return;

      if (context.status === 'unauthenticated') {
        router.replace('/onboarding/connect');
        return;
      }

      try {
        sessionStorage.setItem(
          REVERSE_ONBOARDING_CACHE_KEY,
          JSON.stringify({
            bizId: context.bizId,
            reviewId: context.review?.id || null,
            loadedAt: Date.now(),
          }),
        );
      } catch {
        // non-blocking cache write
      }

      setFetchDone(true);
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [router, supabase]);

  useEffect(() => {
    if (!minElapsed || !fetchDone) return;
    router.replace('/onboarding/first-win');
  }, [fetchDone, minElapsed, router]);

  return (
    <div className="min-h-screen">
      <header className="p-6 md:p-8">
        <Logo size="md" />
      </header>

      <main className="mx-auto flex min-h-[calc(100vh-88px)] w-full max-w-3xl items-center justify-center px-4 pb-10">
        <GlassCard variant="strong" className="w-full max-w-xl p-8 text-center md:p-10">
          <div className="mx-auto mb-5 h-12 w-12 animate-spin rounded-full border-2 border-white/20 border-t-emerald-300" />
          <h1 className={cn('font-display text-2xl font-semibold md:text-3xl', textMain)}>
            {t('onboardingReverse.analyzing.title')}
          </h1>
          <p className={cn('mt-4 text-sm md:text-base transition-opacity duration-300', textSub)}>
            {lines[lineIndex]}
          </p>
        </GlassCard>
      </main>
    </div>
  );
}
