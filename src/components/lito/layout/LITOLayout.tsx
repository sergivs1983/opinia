'use client';

import { useCallback, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

import { tokens, cx } from '@/lib/design/tokens';

type NavItem = {
  id: string;
  label: string;
  href: string;
};

const NAV_ITEMS: NavItem[] = [
  { id: 'lito', label: 'LITO', href: '/dashboard/lito' },
  { id: 'inbox', label: 'Inbox', href: '/dashboard/inbox' },
  { id: 'planner', label: 'Planner', href: '/dashboard/planner' },
  { id: 'archive', label: 'Arxiu', href: '/dashboard/arxiu' },
  { id: 'settings', label: 'Config', href: '/dashboard/settings' },
];

function LogoIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="7.4" cy="8.2" r="0.8" fill="currentColor" />
      <circle cx="12.6" cy="8.2" r="0.8" fill="currentColor" />
      <path d="M7 11.2c.4.7 1.3 1.5 3 1.5s2.6-.8 3-1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden="true">
      <path d="M3.5 5.5h13M3.5 10h13M3.5 14.5h13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden="true">
      <path d="M17 3.5 8.8 11.7M17 3.5l-5.1 13-2.7-5.2L4 8.6 17 3.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden="true">
      <rect x="7" y="2.5" width="6" height="9" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4.5 10.5a5.5 5.5 0 0 0 11 0M10 15.5V18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function NavIcon() {
  return <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />;
}

function commandKeyDown(event: KeyboardEvent<HTMLInputElement>, submit: () => void) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    submit();
  }
}

function initialFromName(value: string | null | undefined): string {
  if (!value) return 'U';
  return value.trim().charAt(0).toUpperCase() || 'U';
}

export type LITOLayoutProps = {
  children: ReactNode;
  activeNav?: string;
  businessName?: string | null;
  userName?: string | null;
  commandValue: string;
  commandDisabled?: boolean;
  commandPlaceholder?: string;
  onCommandChange: (value: string) => void;
  onCommandSubmit: () => void;
};

export function LITOLayout({
  children,
  activeNav = 'lito',
  businessName,
  userName,
  commandValue,
  commandDisabled = false,
  commandPlaceholder = 'Digues-me...',
  onCommandChange,
  onCommandSubmit,
}: LITOLayoutProps) {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const businessLabel = businessName || 'Sense negoci actiu';

  const submitDisabled = commandDisabled || commandValue.trim().length === 0;

  const avatarText = useMemo(() => initialFromName(userName), [userName]);

  const onNavClick = useCallback(
    (item: NavItem) => {
      setSidebarOpen(false);
      if (item.href) {
        router.push(item.href);
      }
    },
    [router],
  );

  return (
    <div className={cx('lito-layout relative overflow-hidden', tokens.bg.page)}>
      <header
        className={cx(
          'fixed inset-x-0 top-0 z-40 flex items-center justify-between px-4',
          tokens.layout.topbarHeight,
          tokens.bg.surface,
          tokens.shadow.topbar,
        )}
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={cx(tokens.button.icon, 'lg:hidden')}
            onClick={() => setSidebarOpen((prev) => !prev)}
            aria-label="Obrir menu"
          >
            <MenuIcon />
          </button>
          <span className={cx('inline-flex items-center gap-2', tokens.text.primary)}>
            <LogoIcon />
            <span className="text-sm font-semibold tracking-tight">OpinIA</span>
          </span>
        </div>

        <div
          className={cx(
            'hidden max-w-[240px] items-center gap-2 truncate px-3 py-1.5 sm:inline-flex',
            tokens.border.default,
            tokens.radius.button,
            tokens.text.secondary,
            tokens.text.tiny,
          )}
          title={businessLabel}
        >
          <span className="truncate">{businessLabel}</span>
        </div>

        <span
          className={cx(
            'inline-flex h-8 w-8 items-center justify-center',
            tokens.radius.pill,
            tokens.bg.soft,
            tokens.text.secondary,
            tokens.text.tiny,
          )}
          aria-hidden="true"
        >
          {avatarText}
        </span>
      </header>

      <div className="flex h-full pt-12">
        <div
          className={cx(
            'fixed inset-0 z-20 lg:hidden',
            tokens.bg.overlay,
            tokens.anim.fade,
            sidebarOpen ? 'block' : 'hidden',
          )}
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />

        <aside
          className={cx(
            'fixed bottom-0 left-0 top-12 z-30 flex flex-col lg:sticky lg:block',
            tokens.layout.sidebarWidth,
            tokens.bg.surface,
            tokens.border.right,
            'transform transition-transform duration-200',
            sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
          )}
        >
          <nav className="flex-1 overflow-y-auto px-2 py-3">
            {NAV_ITEMS.map((item) => {
              const isActive = item.id === activeNav;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onNavClick(item)}
                  className={cx(
                    'mb-1 flex w-full items-center gap-2.5 px-3 py-2 text-left',
                    tokens.radius.button,
                    tokens.text.nav,
                    isActive
                      ? tokens.nav.itemActive
                      : tokens.nav.itemIdle,
                  )}
                >
                  <NavIcon />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className={cx('px-3 pb-4 pt-2', tokens.border.subtle, tokens.text.muted)}>
            <p className={tokens.text.tiny}>Negoci actiu</p>
            <p className={cx('mt-1 truncate', tokens.text.secondary, tokens.text.nav)} title={businessLabel}>
              {businessLabel}
            </p>
          </div>
        </aside>

        <main className={cx('flex-1 overflow-y-auto', tokens.layout.stagePad, tokens.layout.stageInset)}>
          <div className={cx('mx-auto w-full', tokens.layout.stageMax)}>{children}</div>
        </main>
      </div>

      <footer
        className={cx(
          'fixed inset-x-0 bottom-0 z-40 px-4 pt-3',
          tokens.bg.command,
          tokens.border.top,
          tokens.shadow.command,
          'lito-commandbar-safe',
        )}
      >
        <div
          className={cx(
            'mx-auto flex w-full max-w-3xl items-center gap-2 px-3 py-2',
            tokens.bg.subtle,
            tokens.border.default,
            tokens.radius.input,
          )}
        >
          <button type="button" className={tokens.button.icon} disabled={commandDisabled} aria-label="Microfon">
            <MicIcon />
          </button>

          <input
            type="text"
            value={commandValue}
            disabled={commandDisabled}
            placeholder={commandPlaceholder}
            onChange={(event) => onCommandChange(event.target.value)}
            onKeyDown={(event) => commandKeyDown(event, onCommandSubmit)}
            className={tokens.input.command}
          />

          <button
            type="button"
            className={cx(tokens.button.icon, submitDisabled ? cx(tokens.bg.soft, tokens.text.muted) : cx(tokens.bg.userBubble, tokens.text.inverse))}
            disabled={submitDisabled}
            onClick={onCommandSubmit}
            aria-label="Enviar"
          >
            <SendIcon />
          </button>
        </div>
      </footer>
    </div>
  );
}
