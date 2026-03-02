'use client';

import { tokens, cx } from '@/lib/design/tokens';

function SparkleIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden="true">
      <path
        d="M10 2.5 12 8h5.5L13 11.2 14.8 17 10 13.8 5.2 17 7 11.2 2.5 8H8l2-5.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function WifiIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden="true">
      <path d="M3 8c2.5-2.5 4.9-3.5 7-3.5s4.5 1 7 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M5.5 11.2c1.5-1.4 2.9-2 4.5-2s3 .6 4.5 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="10" cy="15.2" r="1.2" fill="currentColor" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden="true">
      <path d="M10 3 17 16.5H3L10 3Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M10 7.8v3.4M10 13.4v.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function formatResetTime(value?: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleTimeString('ca-ES', { hour: '2-digit', minute: '2-digit' });
}

export function LITOGreeting({ userName, priorityLine }: { userName?: string | null; priorityLine?: string | null }) {
  const hour = new Date().getHours();
  const salutation = hour < 14 ? 'Bon dia' : hour < 21 ? 'Bona tarda' : 'Bona nit';

  return (
    <header className={cx('mb-6', tokens.anim.enter)}>
      <h1 className={cx(tokens.text.greeting, tokens.text.primary)}>{userName ? `${salutation}, ${userName}.` : `${salutation}.`}</h1>
      {priorityLine ? <p className={cx('mt-1', tokens.text.greetingSub, tokens.text.secondary)}>{priorityLine}</p> : null}
    </header>
  );
}

export function StaleBanner() {
  return (
    <div className={cx('mb-3 inline-flex items-center gap-2 rounded-full px-3 py-1', tokens.bg.soft, tokens.text.muted, tokens.text.tiny, tokens.anim.fade)}>
      <span className={cx('h-1.5 w-1.5 rounded-full', tokens.misc.staleDot)} aria-hidden="true" />
      <span>Actualitzant...</span>
    </div>
  );
}

function SkeletonCard() {
  return (
    <article className={cx('p-4', tokens.bg.surface, tokens.border.subtle, tokens.radius.card, tokens.shadow.card)}>
      <div className={cx('mb-3 h-3 w-24 animate-pulse rounded', tokens.misc.skeleton)} />
      <div className={cx('mb-2 h-4 w-3/4 animate-pulse rounded', tokens.misc.skeleton)} />
      <div className={cx('mb-4 h-3 w-2/3 animate-pulse rounded', tokens.misc.skeleton)} />
      <div className="flex gap-2">
        <div className={cx('h-10 w-24 animate-pulse rounded', tokens.misc.skeleton)} />
        <div className={cx('h-10 w-20 animate-pulse rounded', tokens.misc.skeletonSoft)} />
      </div>
    </article>
  );
}

export function LITOLoading() {
  return (
    <section className="space-y-3">
      <SkeletonCard />
      <SkeletonCard />
    </section>
  );
}

export function LITOError({ onRetry }: { onRetry?: () => void }) {
  return (
    <article className={cx('p-5', tokens.bg.surface, tokens.border.default, tokens.radius.card, tokens.shadow.card, tokens.anim.enter)}>
      <div className="flex items-start gap-3">
        <span className={cx('inline-flex h-8 w-8 items-center justify-center rounded-full', tokens.bg.danger, tokens.text.danger)}>
          <WifiIcon />
        </span>
        <div className="flex-1">
          <p className={cx(tokens.text.cardTitle, tokens.text.primary)}>No he pogut carregar el panell.</p>
          <p className={cx('mt-1', tokens.text.cardSub, tokens.text.secondary)}>Comprova la connexio i torna-ho a provar.</p>
          {onRetry ? (
            <button type="button" onClick={onRetry} className={cx('mt-3', tokens.button.ghost)}>
              Reintentar
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function LITORateLimited({ resetsAt, variant = 'cap' }: { resetsAt?: string; variant?: 'rate' | 'cap' }) {
  const resetTime = formatResetTime(resetsAt);

  const title = variant === 'rate' ? 'Has fet massa peticions seguides.' : 'Has arribat al limit d avui.';
  const body = variant === 'rate'
    ? 'Espera uns segons i torna-ho a provar.'
    : resetTime
      ? `Podras continuar a partir de les ${resetTime}.`
      : 'Torna-ho a provar dema.';

  return (
    <article className={cx('p-4', tokens.bg.warning, tokens.border.warning, tokens.radius.card, tokens.anim.enter)}>
      <div className="flex items-start gap-2.5">
        <span className={tokens.text.warning}>
          <WarningIcon />
        </span>
        <div>
          <p className={cx(tokens.text.cardTitle, tokens.text.warning)}>{title}</p>
          <p className={cx('mt-0.5', tokens.text.cardSub, tokens.text.warningSubtle)}>{body}</p>
        </div>
      </div>
    </article>
  );
}

function QuickPill({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cx('inline-flex min-h-9 items-center px-3', tokens.radius.pill, tokens.bg.soft, tokens.text.secondary, tokens.text.button, 'hover:opacity-90')}>
      {label}
    </button>
  );
}

export function LITOEmpty({ userName, onPrepareWeek, onViewReviews }: { userName?: string | null; onPrepareWeek?: () => void; onViewReviews?: () => void }) {
  return (
    <article className={cx('flex flex-col items-center justify-center py-16 text-center', tokens.anim.enter)}>
      <span className={cx('mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full', tokens.bg.soft, tokens.text.muted)}>
        <SparkleIcon />
      </span>

      <h2 className={cx(tokens.text.cardTitle, tokens.text.primary)}>{userName ? `Tot al dia, ${userName}.` : 'Tot al dia.'}</h2>
      <p className={cx('mt-1 max-w-xs', tokens.text.cardSub, tokens.text.secondary)}>Quan hi hagi una nova prioritat, apareixera aqui.</p>

      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <QuickPill label="Prepara la setmana" onClick={onPrepareWeek} />
        <QuickPill label="Veure ressenyes" onClick={onViewReviews} />
      </div>
    </article>
  );
}
