'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import Logo from '@/components/ui/Logo';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Divider from '@/components/ui/Divider';
import { cn } from '@/lib/utils';
import { glassStrong } from '@/components/ui/glass';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get('redirect') || '/dashboard';
  const supabase = createClient();

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    if (isSignUp) {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/callback` },
      });
      if (error) setError(error.message);
      else setMessage('Revisa el teu correu per confirmar el compte!');
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
      else router.push(redirect);
    }
    setLoading(false);
  };

  const handleOAuth = async (provider: 'google' | 'apple') => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/callback?redirect=${redirect}` },
    });
    if (error) setError(error.message);
  };

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-full max-w-md mx-auto px-6">
        <div className="text-center mb-8">
          <Logo size="lg" />
          <p className="text-white/68 mt-2">
            {isSignUp ? 'Crea el teu compte' : 'Entra al teu compte'}
          </p>
        </div>

        <div className={cn(glassStrong, 'rounded-2xl p-8 shadow-xl')}>
          {/* OAuth */}
          <div className="space-y-3 mb-6">
            <Button variant="secondary" className="w-full gap-3" onClick={() => handleOAuth('google')}>
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Continuar amb Google
            </Button>
            <Button variant="secondary" className="w-full gap-3" onClick={() => handleOAuth('apple')}>
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
              </svg>
              Continuar amb Apple
            </Button>
          </div>

          {/* Divider */}
          <Divider className="my-6" label="o amb correu" />

          {/* Email form */}
          <form onSubmit={handleEmailAuth} className="space-y-4" data-testid="login-form">
            <Input
              id="email"
              type="email"
              label="Correu electrònic"
              placeholder="el-teu@correu.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              data-testid="login-email"
              required
            />
            <Input
              id="password"
              type="password"
              label="Contrasenya"
              placeholder="Mínim 6 caràcters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              data-testid="login-password"
              required
              minLength={6}
            />

            {error && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
                {error}
              </div>
            )}
            {message && (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm">
                {message}
              </div>
            )}

            <Button type="submit" className="w-full" loading={loading} data-testid="login-submit">
              {isSignUp ? 'Crear compte' : 'Entrar'}
            </Button>
          </form>

          <p className="text-center text-sm text-white/68 mt-4">
            {isSignUp ? 'Ja tens compte?' : 'No tens compte?'}{' '}
            <button
              type="button"
              onClick={() => { setIsSignUp(!isSignUp); setError(''); setMessage(''); }}
              className="text-brand-600 font-medium hover:underline"
              data-testid="login-toggle-mode"
            >
              {isSignUp ? 'Entra' : 'Registra\'t'}
            </button>
          </p>
        </div>

        <p className="text-center text-xs text-white/55 mt-6">
          <button onClick={() => router.push('/')} className="hover:text-white/72 transition-colors">
            ← Tornar a l&apos;inici
          </button>
        </p>
      </div>
    </div>
  );
}
