'use client';

import { useState } from 'react';
import Logo from '@/components/ui/Logo';
import Button from '@/components/ui/Button';
import GlassCard from '@/components/ui/GlassCard';
import { useT } from '@/components/i18n/I18nContext';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { textMain, textSub } from '@/components/ui/glass';

export default function OnboardingConnectPage() {
  const t = useT();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnectGoogle = async () => {
    setLoading(true);
    setError(null);
    const redirectTo = `${window.location.origin}/callback?redirect=/onboarding/analyzing`;
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });

    if (oauthError) {
      setError(oauthError.message);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen">
      <header className="p-6 md:p-8">
        <Logo size="md" />
      </header>

      <main className="mx-auto flex min-h-[calc(100vh-88px)] w-full max-w-4xl items-center justify-center px-4 pb-10">
        <GlassCard variant="strong" className="w-full max-w-2xl p-7 text-center md:p-10">
          <h1 className={cn('font-display text-3xl font-semibold tracking-tight md:text-4xl', textMain)}>
            {t('onboardingReverse.connect.title')}
          </h1>
          <p className={cn('mx-auto mt-3 max-w-xl text-sm md:text-base', textSub)}>
            {t('onboardingReverse.connect.subtitle')}
          </p>

          <Button
            className="mt-8 w-full py-4 text-base md:text-lg"
            loading={loading}
            onClick={() => void handleConnectGoogle()}
            data-testid="onboarding-connect-google"
          >
            {t('onboardingReverse.connect.cta')}
          </Button>

          {error && (
            <p className="mt-4 text-sm text-rose-300">{error}</p>
          )}
        </GlassCard>
      </main>
    </div>
  );
}
