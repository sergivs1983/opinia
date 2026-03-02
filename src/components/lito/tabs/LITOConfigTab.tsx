'use client';

import Link from 'next/link';

import { useWorkspace } from '@/contexts/WorkspaceContext';
import { tokens, cx } from '@/lib/design/tokens';

export default function LITOConfigTab() {
  const { biz, org, membership } = useWorkspace();

  return (
    <section className="space-y-4 pb-12" data-testid="lito-config-tab">
      <header className="space-y-1">
        <h1 className={cx('text-2xl font-semibold md:text-3xl', tokens.text.primary)}>Config</h1>
        <p className={cx('text-sm md:text-base', tokens.text.secondary)}>
          Paràmetres del negoci, equip i facturació dins del nou shell.
        </p>
      </header>

      <article className={cx('p-5', tokens.bg.surface, tokens.border.default, tokens.radius.card, tokens.shadow.card)}>
        <h2 className={cx(tokens.text.cardTitle, tokens.text.primary)}>Context actiu</h2>
        <dl className="mt-3 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <dt className={cx(tokens.text.cardSub, tokens.text.secondary)}>Negoci</dt>
            <dd className={cx(tokens.text.cardSub, tokens.text.primary)}>{biz?.name || 'Sense negoci'}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className={cx(tokens.text.cardSub, tokens.text.secondary)}>Org</dt>
            <dd className={cx(tokens.text.cardSub, tokens.text.primary)}>{org?.name || '—'}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className={cx(tokens.text.cardSub, tokens.text.secondary)}>Rol</dt>
            <dd className={cx(tokens.text.cardSub, tokens.text.primary)}>{membership?.role || '—'}</dd>
          </div>
        </dl>
      </article>

      <article className={cx('p-5', tokens.bg.surface, tokens.border.default, tokens.radius.card, tokens.shadow.card)}>
        <h2 className={cx(tokens.text.cardTitle, tokens.text.primary)}>Accions ràpides</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/dashboard/plans" className={tokens.button.secondary}>Plans</Link>
          <Link href="/dashboard/lito?tab=health" className={tokens.button.secondary}>Health</Link>
          <Link href="/dashboard/lito?tab=inbox" className={tokens.button.secondary}>Tornar a Inbox</Link>
        </div>
      </article>
    </section>
  );
}
