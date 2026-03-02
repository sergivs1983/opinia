'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

import { LITOLayout } from '@/components/lito/layout/LITOLayout';
import { LITO_NAV_ITEMS } from '@/components/lito/layout/nav';
import { WorkspaceProvider, useWorkspace } from '@/contexts/WorkspaceContext';
import { createClient } from '@/lib/supabase/client';

type CommandSubmitDetail = {
  message?: string;
};

type CommandPrefillDetail = {
  value?: string;
};

type CommandDisabledDetail = {
  disabled?: boolean;
};

function resolveActiveNav(pathname: string, tab: string | null): string {
  if (pathname.startsWith('/dashboard/health')) return 'health';
  if (pathname.startsWith('/dashboard/settings') || pathname.startsWith('/dashboard/config')) return 'config';
  if (pathname.startsWith('/dashboard/inbox')) return 'inbox';
  if (pathname.startsWith('/dashboard/planner')) return 'planner';
  if (pathname.startsWith('/dashboard/lito')) {
    if (tab === 'inbox') return 'inbox';
    if (tab === 'planner') return 'planner';
    if (tab === 'config') return 'config';
    if (tab === 'health') return 'health';
  }
  return 'lito';
}

function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { biz, membership } = useWorkspace();
  const supabase = useMemo(() => createClient(), []);

  const [userName, setUserName] = useState<string | null>(null);
  const [commandValue, setCommandValue] = useState('');
  const [commandDisabled, setCommandDisabled] = useState(false);

  const showCommandBar = pathname === '/dashboard/lito';
  const activeTab = pathname === '/dashboard/lito' ? searchParams?.get('tab') : null;
  const canSeeHealthNav = membership?.role === 'owner' || membership?.role === 'manager';
  const navItems = useMemo(
    () => (canSeeHealthNav ? LITO_NAV_ITEMS : LITO_NAV_ITEMS.filter((item) => item.key !== 'health')),
    [canSeeHealthNav],
  );

  useEffect(() => {
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
  }, [supabase]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handlePrefill = (event: Event) => {
      const detail = (event as CustomEvent<CommandPrefillDetail>).detail;
      if (!detail || typeof detail.value !== 'string') return;
      setCommandValue(detail.value);
    };

    const handleDisabled = (event: Event) => {
      const detail = (event as CustomEvent<CommandDisabledDetail>).detail;
      setCommandDisabled(Boolean(detail?.disabled));
    };

    window.addEventListener('lito:command-prefill', handlePrefill as EventListener);
    window.addEventListener('lito:command-disabled', handleDisabled as EventListener);

    return () => {
      window.removeEventListener('lito:command-prefill', handlePrefill as EventListener);
      window.removeEventListener('lito:command-disabled', handleDisabled as EventListener);
    };
  }, []);

  useEffect(() => {
    if (showCommandBar) return;
    setCommandValue('');
    setCommandDisabled(false);
  }, [showCommandBar]);

  const handleCommandSubmit = useCallback(() => {
    const message = commandValue.trim();
    if (!message || typeof window === 'undefined') return;

    window.dispatchEvent(new CustomEvent<CommandSubmitDetail>('lito:command-submit', {
      detail: { message },
    }));
    setCommandValue('');
  }, [commandValue]);

  return (
    <LITOLayout
      activeNav={resolveActiveNav(pathname, activeTab)}
      userName={userName}
      bizName={biz?.name || null}
      bizId={biz?.id || null}
      navItems={navItems}
      showCommandBar={showCommandBar}
      commandValue={commandValue}
      commandDisabled={commandDisabled}
      onCommandChange={setCommandValue}
      onCommandSubmit={handleCommandSubmit}
    >
      {children}
    </LITOLayout>
  );
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <WorkspaceProvider>
      <DashboardShell>{children}</DashboardShell>
    </WorkspaceProvider>
  );
}
