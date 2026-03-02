'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';

import { tokens, cx } from '@/lib/design/tokens';
import { LITO_NAV_ITEMS, type LitoNavItem } from '@/components/lito/layout/nav';
import { createClient } from '@/lib/supabase/client';

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

function ChevronIcon() {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" fill="none" aria-hidden="true">
      <path d="M6.5 8.5 10 12l3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
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

function bizLabelFromProps(input: { bizName?: string | null; bizId?: string | null }): string {
  if (input.bizName && input.bizName.trim()) return input.bizName;
  if (input.bizId && input.bizId.trim()) return input.bizId;
  return 'Sense negoci actiu';
}

export type LITOLayoutProps = {
  children: ReactNode;
  activeNav?: string;
  userName?: string | null;
  bizName?: string | null;
  bizId?: string | null;
  navItems?: LitoNavItem[];
  showCommandBar?: boolean;
  commandValue?: string;
  commandDisabled?: boolean;
  commandPlaceholder?: string;
  onCommandChange?: (value: string) => void;
  onCommandSubmit?: () => void;
};

export function LITOLayout({
  children,
  activeNav,
  userName,
  bizName,
  bizId,
  navItems,
  showCommandBar = false,
  commandValue,
  commandDisabled = false,
  commandPlaceholder = 'Digues-me...',
  onCommandChange,
  onCommandSubmit,
}: LITOLayoutProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [localCommandValue, setLocalCommandValue] = useState('');

  const tab = searchParams?.get('tab') ?? 'chat';
  const resolvedNavItems = navItems && navItems.length > 0 ? navItems : LITO_NAV_ITEMS;
  const selectedNav = useMemo(() => {
    const hasItem = (value: string | null | undefined) =>
      Boolean(value && resolvedNavItems.some((item) => item.key === value));

    if (pathname === '/dashboard/lito') {
      const rawTab = searchParams?.get('tab');
      if (hasItem(rawTab)) return rawTab as string;
      if (hasItem(tab)) return tab;
      return hasItem('chat') ? 'chat' : (resolvedNavItems[0]?.key || 'chat');
    }

    if (pathname.startsWith('/dashboard/lito/')) {
      return hasItem('chat') ? 'chat' : (resolvedNavItems[0]?.key || 'chat');
    }

    if (pathname.startsWith('/dashboard/health')) {
      return hasItem('health') ? 'health' : (resolvedNavItems[0]?.key || 'chat');
    }

    if (activeNav && hasItem(activeNav)) {
      return activeNav;
    }

    return hasItem('chat') ? 'chat' : (resolvedNavItems[0]?.key || 'chat');
  }, [activeNav, pathname, resolvedNavItems, searchParams, tab]);
  const businessLabel = bizLabelFromProps({ bizName, bizId });
  const avatarText = useMemo(() => initialFromName(userName), [userName]);

  const inputValue = typeof commandValue === 'string' ? commandValue : localCommandValue;
  const setInputValue = onCommandChange || setLocalCommandValue;

  const submitDisabled = commandDisabled || inputValue.trim().length === 0;

  const handleSubmit = useCallback(() => {
    if (submitDisabled) return;
    if (onCommandSubmit) {
      onCommandSubmit();
      return;
    }
    setLocalCommandValue('');
  }, [onCommandSubmit, submitDisabled]);

  const handleUserMenuNavigate = useCallback((href: string) => {
    setUserMenuOpen(false);
    router.push(href);
  }, [router]);

  const handleSignOut = useCallback(async () => {
    setUserMenuOpen(false);
    try {
      await supabase.auth.signOut();
    } catch {
      // Ignore sign-out errors and continue redirect to recover the session state.
    }
    router.push('/login');
    router.refresh();
  }, [router, supabase]);

  return (
    <div className={cx('lito-layout relative overflow-hidden', tokens.bg.page)}>
      {userMenuOpen ? (
        <div
          className="fixed inset-0 z-[90] pointer-events-auto"
          onClick={() => setUserMenuOpen(false)}
          aria-hidden="true"
        />
      ) : null}

      <header
        className={cx(
          'fixed inset-x-0 top-0 z-[95] flex items-center justify-between px-4',
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

        <div className="relative">
          <button
            type="button"
            className={cx('inline-flex items-center gap-1 rounded-xl px-1 py-1', tokens.text.secondary, 'hover:bg-[#f0efec]')}
            aria-haspopup="menu"
            aria-expanded={userMenuOpen}
            aria-label="Obrir menú d'usuari"
            onClick={() => setUserMenuOpen((prev) => !prev)}
          >
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
            <span className="hidden sm:inline-flex" aria-hidden="true">
              <ChevronIcon />
            </span>
          </button>

          {userMenuOpen ? (
            <div
              className={cx(
                'absolute right-0 top-full z-[100] mt-2 w-48 p-1',
                tokens.bg.surface,
                tokens.border.default,
                tokens.radius.button,
                tokens.shadow.card,
                'pointer-events-auto',
              )}
              role="menu"
            >
              <button
                type="button"
                className={cx('flex w-full items-center rounded-lg px-3 py-2 text-left text-sm', tokens.text.secondary, 'hover:bg-[#f7f7f5] hover:text-[#1a1917]')}
                role="menuitem"
                onClick={() => handleUserMenuNavigate('/dashboard/lito?tab=config')}
              >
                Ajustes
              </button>
              <button
                type="button"
                className={cx('flex w-full items-center rounded-lg px-3 py-2 text-left text-sm', tokens.text.secondary, 'hover:bg-[#f7f7f5] hover:text-[#1a1917]')}
                role="menuitem"
                onClick={() => handleUserMenuNavigate('/dashboard/lito?tab=config&section=language')}
              >
                Idioma
              </button>
              <button
                type="button"
                className={cx('flex w-full items-center rounded-lg px-3 py-2 text-left text-sm', tokens.text.secondary, 'hover:bg-[#f7f7f5] hover:text-[#1a1917]')}
                role="menuitem"
                onClick={() => handleUserMenuNavigate('/dashboard/help')}
              >
                Ajuda
              </button>
              <button
                type="button"
                className={cx('flex w-full items-center rounded-lg px-3 py-2 text-left text-sm', tokens.text.secondary, 'hover:bg-[#f7f7f5] hover:text-[#1a1917]')}
                role="menuitem"
                onClick={() => handleUserMenuNavigate('/dashboard/plans')}
              >
                Plans
              </button>
              <button
                type="button"
                className={cx('flex w-full items-center rounded-lg px-3 py-2 text-left text-sm', tokens.text.secondary, 'hover:bg-[#f7f7f5] hover:text-[#1a1917]')}
                role="menuitem"
                onClick={() => { void handleSignOut(); }}
              >
                Tancar sessio
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <div className="flex h-full pt-12">
        {sidebarOpen ? (
          <div
            className={cx(
              'fixed inset-0 z-20 lg:hidden pointer-events-auto',
              tokens.bg.overlay,
              tokens.anim.fade,
            )}
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
        ) : null}

        <aside
          className={cx(
            'fixed bottom-0 left-0 top-12 z-30 flex flex-col lg:sticky lg:block',
            tokens.layout.sidebarWidth,
            tokens.bg.surface,
            tokens.border.right,
            'transform transition-transform duration-200',
            sidebarOpen
              ? 'pointer-events-auto translate-x-0'
              : 'pointer-events-none -translate-x-full lg:pointer-events-auto lg:translate-x-0',
          )}
        >
          <nav className="flex-1 overflow-y-auto px-2 py-3">
            {resolvedNavItems.map((item) => {
              const isActive = item.key === selectedNav;
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  onClick={() => setSidebarOpen(false)}
                  className={cx(
                    'mb-1 flex w-full items-center gap-2.5 px-3 py-2 text-left',
                    tokens.radius.button,
                    tokens.text.nav,
                    isActive ? tokens.nav.itemActive : tokens.nav.itemIdle,
                  )}
                >
                  <NavIcon />
                  <span>{item.label}</span>
                </Link>
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

        <main
          className={cx(
            'lito-light-scope flex-1 overflow-y-auto',
            tokens.layout.stagePad,
            showCommandBar ? 'pt-6 pb-28' : 'pt-6 pb-8',
          )}
        >
          <div className={cx('mx-auto w-full', tokens.layout.stageMax)}>{children}</div>
        </main>
      </div>

      {showCommandBar ? (
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
              value={inputValue}
              disabled={commandDisabled}
              placeholder={commandPlaceholder}
              onChange={(event) => setInputValue(event.target.value)}
              onKeyDown={(event) => commandKeyDown(event, handleSubmit)}
              className={tokens.input.command}
            />

            <button
              type="button"
              className={cx(tokens.button.icon, submitDisabled ? cx(tokens.bg.soft, tokens.text.muted) : cx(tokens.bg.userBubble, tokens.text.inverse))}
              disabled={submitDisabled}
              onClick={handleSubmit}
              aria-label="Enviar"
            >
              <SendIcon />
            </button>
          </div>
        </footer>
      ) : null}
    </div>
  );
}
