'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  AppShellGlobalStyles,
  ShellCommandBar,
  ShellIcons,
  shellTokens,
} from '@/components/ui/AppShell';
import SettingsModal, { type SettingsPanelKey } from '@/components/layout/SettingsModal';
import ThemeToggle from '@/components/theme/ThemeToggle';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { createClient } from '@/lib/supabase/client';

type MainLayoutProps = {
  children: ReactNode;
};

type NavItem = {
  key: 'lito' | 'planner' | 'arxiu' | 'settings';
  label: string;
  href: string;
  Icon: () => JSX.Element;
};

const NAV_ITEMS: NavItem[] = [
  { key: 'lito', label: 'LITO', href: '/dashboard/lito', Icon: ShellIcons.Home },
  { key: 'planner', label: 'Planner', href: '/dashboard/planner', Icon: ShellIcons.Calendar },
  { key: 'arxiu', label: 'Arxiu', href: '/dashboard/arxiu', Icon: ShellIcons.Archive },
  { key: 'settings', label: 'Config', href: '/dashboard/settings', Icon: ShellIcons.Settings },
];

function navIsActive(pathname: string, key: NavItem['key']): boolean {
  if (key === 'lito') return pathname === '/dashboard' || pathname.startsWith('/dashboard/lito');
  if (key === 'planner') return pathname.startsWith('/dashboard/planner');
  if (key === 'arxiu') return pathname.startsWith('/dashboard/arxiu') || pathname.startsWith('/dashboard/inbox');
  return (
    pathname.startsWith('/dashboard/settings')
    || pathname.startsWith('/dashboard/config')
    || pathname.startsWith('/dashboard/health')
    || pathname.startsWith('/dashboard/plans')
  );
}

function userInitial(value: string | null | undefined): string {
  if (!value) return 'U';
  return value.trim().charAt(0).toUpperCase() || 'U';
}

function normalizeSettingsPanel(value: string | null | undefined): SettingsPanelKey {
  if (
    value === 'general' || value === 'integrations' || value === 'brand-brain' ||
    value === 'billing' || value === 'language' || value === 'health'
  ) return value;
  return 'general';
}

export default function MainLayout({ children }: MainLayoutProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { biz, org } = useWorkspace();
  const [userName, setUserName] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let mounted = true;

    void (async () => {
      const { data, error } = await supabase.auth.getUser();
      if (!mounted || error) return;
      const metadataName = data.user?.user_metadata?.full_name;
      if (typeof metadataName === 'string' && metadataName.trim().length > 0) {
        setUserName(metadataName.trim());
        return;
      }
      const email = data.user?.email;
      if (typeof email === 'string' && email.trim().length > 0) {
        setUserName(email.trim().split('@')[0] || null);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const planLabel = useMemo(() => {
    const raw = org?.plan_code || org?.plan || 'starter';
    if (raw === 'scale') return 'Pla Scale';
    if (raw === 'business' || raw === 'pro' || raw === 'pro_49') return 'Pla Professional';
    return 'Pla Starter';
  }, [org?.plan, org?.plan_code]);

  const businessLabel = biz?.name || 'Sense negoci actiu';
  const initial = userInitial(userName);
  const showCommandBar = false;
  const isLitoRoute = pathname.startsWith('/dashboard/lito');
  const contentMaxWidth = isLitoRoute ? '100%' : 1040;
  const contentPadding = isLitoRoute ? '0' : '48px 24px 120px';

  // Settings modal state (driven by ?modal=settings&panel=)
  const modalParam = searchParams?.get('modal');
  const panelParam = searchParams?.get('panel');
  const settingsOpen = modalParam === 'settings';
  const initialPanel = normalizeSettingsPanel(panelParam);

  const closeSettings = useCallback(() => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    params.delete('modal');
    params.delete('panel');
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  return (
    <div style={{ height: '100dvh', overflow: 'hidden', background: shellTokens.bg, color: shellTokens.textPrimary }}>
      <AppShellGlobalStyles />

      <div style={{ display: 'flex', height: '100dvh', overflow: 'hidden', background: shellTokens.bg }}>
        {/* ── Left sidebar (never scrolls) ── */}
        <aside
          data-shell="sidebar"
          style={{
            width: 64,
            height: '100%',
            flexShrink: 0,
            background: shellTokens.white,
            borderRight: `1px solid ${shellTokens.borderSolid}`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            paddingTop: 24,
            paddingBottom: 24,
            gap: 4,
            zIndex: 20,
          }}
        >
          <Link href="/dashboard/lito" aria-label="Anar a LITO" style={{ marginBottom: 32, textDecoration: 'none' }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: 'linear-gradient(135deg,#18181b,#3f3f46)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span style={{ color: 'white', fontSize: 14, fontWeight: 700, fontFamily: shellTokens.serif }}>L</span>
            </div>
          </Link>

          <nav style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%', padding: '0 8px' }}>
            {NAV_ITEMS.map((item) => {
              const active = navIsActive(pathname, item.key);
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  title={item.label}
                  style={{
                    width: '100%',
                    height: 44,
                    borderRadius: 10,
                    textDecoration: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: active ? '#f4f4f5' : 'transparent',
                    color: active ? shellTokens.textPrimary : shellTokens.textMuted,
                    transition: 'all 0.15s ease',
                    position: 'relative',
                  }}
                >
                  <item.Icon />
                  {active ? (
                    <span
                      style={{
                        position: 'absolute',
                        right: 6,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        width: 4,
                        height: 4,
                        borderRadius: '50%',
                        background: shellTokens.emerald500,
                      }}
                    />
                  ) : null}
                </Link>
              );
            })}
          </nav>

          <div style={{ marginTop: 'auto' }}>
            <Link href="/logout" title="Tancar sessio" style={{ textDecoration: 'none' }}>
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg,#d4d4d8,#a1a1aa)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'white',
                  cursor: 'pointer',
                }}
              >
                {initial}
              </div>
            </Link>
          </div>
        </aside>

        {/* ── Right column (header + scrollable main) ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
          <header
            data-shell="topbar"
            style={{
              height: 56,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 32px',
              background: 'rgba(250,250,249,0.9)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              borderBottom: `1px solid ${shellTokens.border}`,
              zIndex: 15,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: shellTokens.textSecondary }}>{businessLabel}</span>
              <span style={{ color: shellTokens.textSubtle, fontSize: 12 }}>·</span>
              <span style={{ fontSize: 12, color: shellTokens.textMuted, background: '#f4f4f5', padding: '2px 10px', borderRadius: 20 }}>
                {planLabel}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {/* Theme toggle */}
              <ThemeToggle />

              {/* Bell */}
              <div style={{ position: 'relative' }}>
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: shellTokens.emerald500,
                    position: 'absolute',
                    top: -1,
                    right: -1,
                    zIndex: 1,
                    border: `1.5px solid ${shellTokens.bg}`,
                    animation: 'opiniaPulse 3s ease-in-out infinite',
                  }}
                />
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: '#f4f4f5',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: shellTokens.textSecondary,
                  }}
                >
                  <ShellIcons.Bell />
                </div>
              </div>

              {/* Settings gear (opens modal) */}
              <button
                type="button"
                title="Configuració"
                onClick={() => {
                  const params = new URLSearchParams(searchParams?.toString() ?? '');
                  params.set('modal', 'settings');
                  if (!params.get('panel')) params.set('panel', 'general');
                  router.push(`${pathname}?${params.toString()}`, { scroll: false });
                }}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: settingsOpen ? '#f4f4f5' : 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: settingsOpen ? shellTokens.textPrimary : shellTokens.textSecondary,
                  transition: 'all 0.15s ease',
                }}
              >
                <ShellIcons.Settings />
              </button>

              {/* User avatar */}
              <Link href="/logout" title="Tancar sessio" style={{ textDecoration: 'none' }}>
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg,#18181b,#52525b)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'white',
                  }}
                >
                  {initial}
                </div>
              </Link>
            </div>
          </header>

          {/* Only main scrolls */}
          <main
            style={{
              flex: 1,
              overflowY: 'auto',
              display: 'flex',
              justifyContent: 'center',
            }}
          >
            <div
              style={{
                width: '100%',
                maxWidth: contentMaxWidth,
                margin: '0 auto',
                padding: contentPadding,
              }}
            >
              {children}
            </div>
          </main>
        </div>
      </div>

      {/* Settings modal (overlay, z-300) */}
      {settingsOpen ? (
        <SettingsModal
          onClose={closeSettings}
          initialPanel={initialPanel}
        />
      ) : null}

      {showCommandBar ? (
        <ShellCommandBar
          onSubmit={(message) => {
            if (typeof window === 'undefined') return;
            window.dispatchEvent(new CustomEvent('lito:command-submit', { detail: { message } }));
          }}
        />
      ) : null}
    </div>
  );
}
