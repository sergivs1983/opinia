'use client';

import { useRouter } from 'next/navigation';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import Button from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { glass, glassStrong, textMain, textSub } from '@/components/ui/glass';
import { roleCanManageBusinesses } from '@/lib/roles';

export default function DashboardBusinessesPage() {
  const router = useRouter();
  const { businesses, biz, membership, loading } = useWorkspace();
  const canManageBusinesses = roleCanManageBusinesses(membership?.role);

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-8 w-48 animate-pulse rounded-lg bg-white/10" />
        <div className="h-28 animate-pulse rounded-xl bg-white/10" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className={cn(glassStrong, 'p-6')}>
        <h1 className={cn('text-2xl font-bold', textMain)}>Establiments</h1>
        <p className={cn('mt-1 text-sm', textSub)}>
          Gestiona els teus negocis i continua el flux d&apos;onboarding quan calgui.
        </p>
      </div>

      {businesses.length === 0 ? (
        <div className={cn(glass, 'flex flex-col items-start gap-4 p-6')}>
          <div>
            <h2 className={cn('text-lg font-semibold', textMain)}>Encara no tens establiments</h2>
            <p className={cn('mt-1 text-sm', textSub)}>
              Crea el primer establiment per començar a generar respostes i contingut.
            </p>
          </div>
          {canManageBusinesses ? (
            <Button onClick={() => router.push('/dashboard/onboarding')}>
              Afegir establiment
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {businesses.map((business) => {
            const isActive = biz?.id === business.id;
            return (
              <article
                key={business.id}
                className={cn(
                  glass,
                  'p-5 transition-all duration-[220ms] ease-premium',
                  isActive && 'border-brand-accent/45 bg-brand-accent/10',
                )}
              >
                <h3 className={cn('text-lg font-semibold', textMain)}>{business.name}</h3>
                <p className={cn('mt-1 text-xs uppercase tracking-[0.08em]', textSub)}>
                  {business.type || 'business'}
                </p>
                {business.city && (
                  <p className={cn('mt-2 text-sm', textSub)}>{business.city}</p>
                )}
                {isActive && (
                  <p className="mt-3 text-xs font-semibold text-emerald-300">Actiu</p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
