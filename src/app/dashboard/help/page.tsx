import Link from 'next/link';

import { tokens, cx } from '@/lib/design/tokens';

export const dynamic = 'force-dynamic';

export default function DashboardHelpPage() {
  return (
    <section className="space-y-4 pb-10" data-testid="dashboard-help-page">
      <header className="space-y-1">
        <h1 className={cx('text-2xl font-semibold md:text-3xl', tokens.text.primary)}>Ajuda</h1>
        <p className={cx('text-sm md:text-base', tokens.text.secondary)}>
          Guia ràpida per navegar LITO, Inbox, Planner, Config i Health.
        </p>
      </header>

      <div className="grid gap-3 md:grid-cols-2">
        <article className={cx('space-y-2 p-4', tokens.bg.surface, tokens.border.default, tokens.radius.card, tokens.shadow.card)}>
          <h2 className={cx(tokens.text.cardTitle, tokens.text.primary)}>LITO (chat)</h2>
          <p className={cx('text-sm', tokens.text.secondary)}>Conversa amb LITO i genera accions per al teu negoci.</p>
          <Link href="/dashboard/lito?tab=chat" className={tokens.button.secondary}>Obrir chat</Link>
        </article>

        <article className={cx('space-y-2 p-4', tokens.bg.surface, tokens.border.default, tokens.radius.card, tokens.shadow.card)}>
          <h2 className={cx(tokens.text.cardTitle, tokens.text.primary)}>Inbox</h2>
          <p className={cx('text-sm', tokens.text.secondary)}>Revisa ressenyes pendents, genera resposta i aprova enviament.</p>
          <Link href="/dashboard/lito?tab=inbox" className={tokens.button.secondary}>Obrir inbox</Link>
        </article>

        <article className={cx('space-y-2 p-4', tokens.bg.surface, tokens.border.default, tokens.radius.card, tokens.shadow.card)}>
          <h2 className={cx(tokens.text.cardTitle, tokens.text.primary)}>Planner</h2>
          <p className={cx('text-sm', tokens.text.secondary)}>Planifica publicacions i seguiment de l’execució social.</p>
          <Link href="/dashboard/lito?tab=planner" className={tokens.button.secondary}>Obrir planner</Link>
        </article>

        <article className={cx('space-y-2 p-4', tokens.bg.surface, tokens.border.default, tokens.radius.card, tokens.shadow.card)}>
          <h2 className={cx(tokens.text.cardTitle, tokens.text.primary)}>Config</h2>
          <p className={cx('text-sm', tokens.text.secondary)}>Gestiona integracions (Google Business), brand brain i equips.</p>
          <Link href="/dashboard/lito?tab=config" className={tokens.button.secondary}>Obrir config</Link>
        </article>
      </div>
    </section>
  );
}
