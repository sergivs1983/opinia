'use client';

import { useRouter, usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { WorkspaceProvider, useWorkspace } from '@/contexts/WorkspaceContext';
import Logo from '@/components/ui/Logo';
import Divider from '@/components/ui/Divider';
import LanguageSwitcher from '@/components/i18n/LanguageSwitcher';
import ThemeToggle from '@/components/theme/ThemeToggle';
import PaywallModal, { type PaywallAction, type PaywallTriggerReason } from '@/components/pricing/PaywallModal';
import LitoLauncher from '@/components/lito/LitoLauncher';
import { useToast } from '@/components/ui/Toast';
import { useT } from '@/components/i18n/I18nContext';
import { ringAccent } from '@/components/ui/glass';
import { cn } from '@/lib/utils';
import { roleCanAccessAdmin } from '@/lib/roles';
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';

/* ── SVG Icons ── */
const icons = {
  dashboard: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>,
  inbox: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/></svg>,
  content: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><line x1="8" y1="9" x2="16" y2="9"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>,
  growth: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 6-6"/><path d="M15 8h5v5"/></svg>,
  planner: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  analytics: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><rect x="6" y="11" width="3" height="7"/><rect x="11" y="8" width="3" height="10"/><rect x="16" y="5" width="3" height="13"/></svg>,
  studio: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7h18"/><path d="M6 3h12l3 4v13a1 1 0 01-1 1H4a1 1 0 01-1-1V7l3-4z"/><circle cx="12" cy="14" r="3"/></svg>,
  exports: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
  settings: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z"/><circle cx="12" cy="12" r="3"/></svg>,
  help: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 115.82 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  logout: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
  chevron: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>,
  check: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
  menu: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>,
  sidebar: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="9" y1="4" x2="9" y2="20"/></svg>,
  pin: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 17v5"/><path d="M7 4h10l-2 5v4l2 2H7l2-2V9z"/></svg>,
  pinOff: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 17v5"/><path d="M7 4h10l-2 5v4l2 2H7l2-2V9z"/><line x1="4" y1="4" x2="20" y2="20"/></svg>,
  bell: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>,
  user: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21a8 8 0 10-16 0"/><circle cx="12" cy="7" r="4"/></svg>,
  search: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
};

function getInitials(value: string | null | undefined): string {
  if (!value) return '?';
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
}

function normalizeIdentityLine(value: string | null | undefined): string {
  return (value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

const SIDEBAR_COLLAPSED_KEY = 'opinia.sidebar.collapsed';
const SIDEBAR_PINNED_KEY = 'opinia.sidebar.pinned';
const TOPBAR_CHIP_CLASS =
  'inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-lg border px-3 text-xs font-medium leading-none backdrop-blur-xl transition-all duration-[220ms] ease-premium';

type EngagementTriggerItem = {
  id: 'monday' | 'thursday' | 'friday';
  type: 'notification' | 'email';
  message: string;
};

type CommandPaletteItem = {
  id: string;
  type: 'route' | 'org';
  label: string;
  hint: string;
  route?: string;
  orgId?: string;
  active?: boolean;
};

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest('[contenteditable="true"]'));
}

function DashboardShell({ children }: { children: React.ReactNode }) {
  const t = useT();
  const { toast } = useToast();
  const { org, biz, membership, memberships, orgs, businesses, switchOrg, switchBiz, loading } = useWorkspace();
  const [orgOpen, setOrgOpen] = useState(false);
  const [orgSearch, setOrgSearch] = useState('');
  const [orgFocusIndex, setOrgFocusIndex] = useState(0);
  const [bizOpen, setBizOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [commandFocusIndex, setCommandFocusIndex] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarPinned, setSidebarPinned] = useState(true);
  const [sidebarHoverOpen, setSidebarHoverOpen] = useState(false);
  const [sidebarPrefsReady, setSidebarPrefsReady] = useState(false);
  const [bizBrandSignedUrl, setBizBrandSignedUrl] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [hoursSavedThisMonth, setHoursSavedThisMonth] = useState<number | null>(null);
  const [weeklyHoursSaved, setWeeklyHoursSaved] = useState<number | null>(null);
  const [hoursSavedLoading, setHoursSavedLoading] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [paywallReason, setPaywallReason] = useState<PaywallTriggerReason>('trial_start');
  const orgRef = useRef<HTMLDivElement>(null);
  const bizRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const notificationsRef = useRef<HTMLDivElement>(null);
  const commandRef = useRef<HTMLDivElement>(null);
  const commandInputRef = useRef<HTMLInputElement>(null);
  const logoCacheRef = useRef<Map<string, string>>(new Map());
  const sidebarCloseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const supabase = useMemo(() => createClient(), []);

  type NavItem = { key: string; href: string; label: string; icon: React.ReactNode; active: boolean };
  const NAV: NavItem[] = [
    {
      key: 'dashboard',
      href: '/dashboard',
      label: t('dashboard.home.navHome'),
      icon: icons.dashboard,
      active: pathname === '/dashboard',
    },
    {
      key: 'content',
      href: '/dashboard/content',
      label: t('nav.content'),
      icon: icons.content,
      active: pathname.startsWith('/dashboard/content'),
    },
    {
      key: 'growth',
      href: '/dashboard/growth-hub',
      label: t('nav.growth'),
      icon: icons.growth,
      active: pathname === '/dashboard/growth-hub' || pathname === '/dashboard/growth',
    },
    {
      key: 'settings',
      href: '/dashboard/settings',
      label: t('nav.settings'),
      icon: icons.settings,
      active: pathname.startsWith('/dashboard/settings'),
    },
  ];

  const MOBILE_TABS: NavItem[] = [
    {
      key: 'dashboard',
      href: '/dashboard',
      label: t('dashboard.home.navHome'),
      icon: icons.dashboard,
      active: pathname === '/dashboard',
    },
    {
      key: 'content',
      href: '/dashboard/content',
      label: t('nav.content'),
      icon: icons.content,
      active: pathname.startsWith('/dashboard/content'),
    },
    {
      key: 'growth',
      href: '/dashboard/growth-hub',
      label: t('nav.growth'),
      icon: icons.growth,
      active: pathname === '/dashboard/growth-hub' || pathname === '/dashboard/growth',
    },
    {
      key: 'settings',
      href: '/dashboard/settings',
      label: t('nav.settings'),
      icon: icons.settings,
      active: pathname.startsWith('/dashboard/settings'),
    },
  ];
  const uniqueOrgs = useMemo(
    () => Array.from(new Map(orgs.map((item) => [item.id, item])).values()),
    [orgs],
  );
  const uniqueBusinesses = useMemo(
    () => Array.from(new Map(businesses.map((item) => [item.id, item])).values()),
    [businesses],
  );
  const orgSearchNormalized = orgSearch.trim().toLowerCase();
  const filteredOrgs = useMemo(
    () => uniqueOrgs.filter((item) => item.name.toLowerCase().includes(orgSearchNormalized)),
    [orgSearchNormalized, uniqueOrgs],
  );
  const membershipRoleLabel = useMemo(() => {
    const role = membership?.role;
    if (!role) return null;
    if (role === 'owner') return t('dashboard.layout.roleOwner');
    if (role === 'admin') return t('dashboard.layout.roleAdmin');
    if (role === 'manager') return t('dashboard.layout.roleManager');
    if (role === 'responder' || role === 'staff') return t('dashboard.layout.roleResponder');
    return t('dashboard.layout.roleMember');
  }, [membership?.role, t]);
  const canAccessAdminPanel = useMemo(
    () => roleCanAccessAdmin(membership?.role),
    [membership?.role],
  );
  const membershipRoleLabelsByOrg = useMemo(
    () =>
      new Map(
        memberships.map((entry) => {
          const role = entry.role;
          if (role === 'owner') return [entry.org_id, t('dashboard.layout.roleOwner')] as const;
          if (role === 'admin') return [entry.org_id, t('dashboard.layout.roleAdmin')] as const;
          if (role === 'manager') return [entry.org_id, t('dashboard.layout.roleManager')] as const;
          if (role === 'responder' || role === 'staff') return [entry.org_id, t('dashboard.layout.roleResponder')] as const;
          return [entry.org_id, t('dashboard.layout.roleMember')] as const;
        }),
      ),
    [memberships, t],
  );

  const routeCommands = useMemo(
    (): CommandPaletteItem[] => {
      const base: CommandPaletteItem[] = [
        {
          id: 'route-inbox',
          type: 'route',
          label: t('dashboard.layout.commandGoInbox'),
          hint: '/dashboard/inbox',
          route: '/dashboard/inbox',
        },
        {
          id: 'route-planner',
          type: 'route',
          label: t('dashboard.layout.commandGoPlanner'),
          hint: '/dashboard/planner',
          route: '/dashboard/planner',
        },
        {
          id: 'route-growth',
          type: 'route',
          label: t('dashboard.layout.commandGoGrowth'),
          hint: '/dashboard/growth-hub',
          route: '/dashboard/growth-hub',
        },
        {
          id: 'route-settings',
          type: 'route',
          label: t('dashboard.layout.commandGoSettings'),
          hint: '/dashboard/settings',
          route: '/dashboard/settings',
        },
      ];

      if (canAccessAdminPanel) {
        base.push({
          id: 'route-admin',
          type: 'route',
          label: t('dashboard.layout.commandGoAdmin'),
          hint: '/dashboard/admin',
          route: '/dashboard/admin',
        });
      }
      return base;
    },
    [canAccessAdminPanel, t],
  );

  const commandItems = useMemo(() => {
    const orgItems: CommandPaletteItem[] = uniqueOrgs.map((item) => ({
      id: `org-${item.id}`,
      type: 'org',
      label: `${t('dashboard.layout.switchToOrg')} ${item.name}`,
      hint: t('dashboard.layout.orgCommandHint'),
      orgId: item.id,
      active: item.id === org?.id,
    }));
    const all = [...routeCommands, ...orgItems];
    const query = commandQuery.trim().toLowerCase();
    if (!query) return all;
    return all.filter((item) => item.label.toLowerCase().includes(query) || item.hint.toLowerCase().includes(query));
  }, [commandQuery, org?.id, routeCommands, t, uniqueOrgs]);
  const clearSidebarCloseTimeout = () => {
    if (!sidebarCloseTimeoutRef.current) return;
    clearTimeout(sidebarCloseTimeoutRef.current);
    sidebarCloseTimeoutRef.current = null;
  };

  const openSidebarHover = () => {
    if (sidebarPinned || !sidebarCollapsed) return;
    clearSidebarCloseTimeout();
    setSidebarHoverOpen(true);
  };

  const scheduleSidebarHoverClose = () => {
    if (sidebarPinned || !sidebarCollapsed) return;
    clearSidebarCloseTimeout();
    sidebarCloseTimeoutRef.current = setTimeout(() => {
      setSidebarHoverOpen(false);
      sidebarCloseTimeoutRef.current = null;
    }, 150);
  };

  const handleSelectOrg = useCallback(async (orgId: string) => {
    setOrgOpen(false);
    setOrgSearch('');
    setUserMenuOpen(false);
    setBizOpen(false);
    if (orgId === org?.id) return;
    await switchOrg(orgId);
    router.refresh();
  }, [org?.id, router, switchOrg]);

  const handleOrgSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!filteredOrgs.length) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOrgOpen(false);
      }
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOrgFocusIndex((previous) => (previous + 1) % filteredOrgs.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setOrgFocusIndex((previous) => (previous - 1 + filteredOrgs.length) % filteredOrgs.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const item = filteredOrgs[orgFocusIndex];
      if (item) void handleSelectOrg(item.id);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setOrgOpen(false);
    }
  };

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (orgRef.current && !orgRef.current.contains(e.target as Node)) setOrgOpen(false);
      if (bizRef.current && !bizRef.current.contains(e.target as Node)) setBizOpen(false);
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setUserMenuOpen(false);
      if (notificationsRef.current && !notificationsRef.current.contains(e.target as Node)) setNotificationsOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  useEffect(() => {
    try {
      const storedCollapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
      const storedPinned = localStorage.getItem(SIDEBAR_PINNED_KEY);
      if (storedCollapsed !== null) setSidebarCollapsed(storedCollapsed === '1');
      if (storedPinned !== null) setSidebarPinned(storedPinned === '1');
    } catch {}
    setSidebarPrefsReady(true);
  }, []);

  useEffect(() => {
    if (!sidebarPrefsReady) return;
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? '1' : '0');
    } catch {}
  }, [sidebarCollapsed, sidebarPrefsReady]);

  useEffect(() => {
    if (!sidebarPrefsReady) return;
    try {
      localStorage.setItem(SIDEBAR_PINNED_KEY, sidebarPinned ? '1' : '0');
    } catch {}
  }, [sidebarPinned, sidebarPrefsReady]);

  useEffect(() => {
    if (sidebarPinned || !sidebarCollapsed) {
      clearSidebarCloseTimeout();
      setSidebarHoverOpen(false);
    }
  }, [sidebarCollapsed, sidebarPinned]);

  useEffect(() => {
    setMobileDrawerOpen(false);
    setSidebarHoverOpen(false);
    setUserMenuOpen(false);
    setNotificationsOpen(false);
    setBizOpen(false);
    setOrgOpen(false);
    setCommandOpen(false);
    clearSidebarCloseTimeout();
  }, [pathname]);

  useEffect(() => () => clearSidebarCloseTimeout(), []);

  useEffect(() => {
    if (!orgOpen) {
      setOrgSearch('');
      setOrgFocusIndex(0);
      return;
    }
    const activeIndex = filteredOrgs.findIndex((item) => item.id === org?.id);
    setOrgFocusIndex(activeIndex >= 0 ? activeIndex : 0);
  }, [filteredOrgs, org?.id, orgOpen]);

  useEffect(() => {
    if (!orgOpen) return;
    const timeoutId = window.setTimeout(() => {
      const input = document.getElementById('workspace-switcher-search') as HTMLInputElement | null;
      input?.focus();
      input?.select();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [orgOpen]);

  useEffect(() => {
    if (!mobileDrawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileDrawerOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobileDrawerOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k') return;
      if (!(event.metaKey || event.ctrlKey)) return;
      if (isEditableTarget(event.target)) return;
      event.preventDefault();
      setCommandQuery('');
      setCommandFocusIndex(0);
      setCommandOpen(true);
      setOrgOpen(false);
      setBizOpen(false);
      setUserMenuOpen(false);
      setNotificationsOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!commandOpen) return;
    const timeoutId = window.setTimeout(() => commandInputRef.current?.focus(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [commandOpen]);

  useEffect(() => {
    if (!commandOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setCommandOpen(false);
        return;
      }

      if (!commandItems.length) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setCommandFocusIndex((previous) => (previous + 1) % commandItems.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setCommandFocusIndex((previous) => (previous - 1 + commandItems.length) % commandItems.length);
        return;
      }
      if (event.key !== 'Enter') return;

      event.preventDefault();
      const selectedItem = commandItems[commandFocusIndex];
      if (!selectedItem) return;
      if (selectedItem.type === 'route' && selectedItem.route) {
        setCommandOpen(false);
        router.push(selectedItem.route);
        return;
      }
      if (selectedItem.type === 'org' && selectedItem.orgId) {
        setCommandOpen(false);
        void handleSelectOrg(selectedItem.orgId);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [commandFocusIndex, commandItems, commandOpen, handleSelectOrg, router]);

  useEffect(() => {
    if (!commandItems.length) {
      setCommandFocusIndex(0);
      return;
    }
    setCommandFocusIndex((previous) => {
      if (previous < commandItems.length) return previous;
      return commandItems.length - 1;
    });
  }, [commandItems]);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      const user = data.user;
      if (!user) {
        setUserName(null);
        setUserEmail(null);
        setUserRole(null);
        return;
      }

      const metadata = (user.user_metadata || {}) as Record<string, unknown>;
      const appMetadata = (user.app_metadata || {}) as Record<string, unknown>;
      const fullName = metadata.full_name ?? metadata.name ?? metadata.display_name;
      const derivedName = typeof fullName === 'string' && fullName.trim().length > 0 ? fullName : null;
      const roleValue =
        typeof metadata.role === 'string'
          ? metadata.role
          : typeof appMetadata.role === 'string'
            ? appMetadata.role
            : null;

      setUserName(derivedName);
      setUserEmail(user.email ?? null);
      setUserRole(roleValue);
    });

    return () => {
      cancelled = true;
    };
  }, [supabase]);

  useEffect(() => {
    if (!biz?.id) {
      setBizBrandSignedUrl(null);
      return;
    }
    const businessId = biz.id;

    const cachedSignedUrl = logoCacheRef.current.get(businessId);
    if (cachedSignedUrl) {
      setBizBrandSignedUrl(cachedSignedUrl);
      return;
    }

    let cancelled = false;
    async function fetchBrandImageSignedUrl(attempt: number): Promise<string | null> {
      try {
        const response = await fetch(`/api/businesses/${businessId}/brand-image/signed-url`, {
          headers: { 'x-biz-id': businessId },
        });
        const payload = (await response.json().catch(() => ({}))) as {
          url?: string | null;
          signedUrl?: string | null;
        };

        if (!response.ok) {
          if (response.status === 401 || response.status === 403 || response.status === 404) return null;
          return null;
        }

        if (typeof payload.url === 'string') return payload.url;
        if (typeof payload.signedUrl === 'string') return payload.signedUrl;
        return null;
      } catch (error: unknown) {
        if (attempt < 1 && error instanceof TypeError) {
          return fetchBrandImageSignedUrl(attempt + 1);
        }
        return null;
      }
    }

    void (async () => {
      const signedUrl = await fetchBrandImageSignedUrl(0);
      if (cancelled) return;
      if (signedUrl) {
        logoCacheRef.current.set(businessId, signedUrl);
      }
      setBizBrandSignedUrl(signedUrl);
    })();

    return () => {
      cancelled = true;
    };
  }, [biz?.id]);

  useEffect(() => {
    const businessId = biz?.id;
    if (!businessId) {
      setHoursSavedThisMonth(null);
      setHoursSavedLoading(false);
      return;
    }
    const resolvedBusinessId: string = businessId;

    const controller = new AbortController();
    let cancelled = false;

    async function loadHoursSaved() {
      setHoursSavedLoading(true);
      try {
        const response = await fetch('/api/metrics/summary?range=30', {
          headers: { 'x-biz-id': resolvedBusinessId },
          signal: controller.signal,
        });
        const payload = (await response.json().catch(() => ({}))) as {
          value?: { time_saved_hours?: number };
          totals?: { time_saved_minutes_est?: number };
        };

        if (!response.ok) {
          if (!cancelled) setHoursSavedThisMonth(null);
          return;
        }

        const valueHours = payload.value?.time_saved_hours;
        const totalsMinutes = payload.totals?.time_saved_minutes_est;
        const normalizedHours = typeof valueHours === 'number'
          ? valueHours
          : typeof totalsMinutes === 'number'
            ? Number((totalsMinutes / 60).toFixed(1))
            : null;

        if (!cancelled) {
          setHoursSavedThisMonth(normalizedHours);
        }
      } catch {
        if (!cancelled) setHoursSavedThisMonth(null);
      } finally {
        if (!cancelled) setHoursSavedLoading(false);
      }
    }

    void loadHoursSaved();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [biz?.id]);

  useEffect(() => {
    const businessId = biz?.id;
    if (!businessId) {
      setWeeklyHoursSaved(null);
      return;
    }
    const resolvedBusinessId: string = businessId;
    const controller = new AbortController();
    let cancelled = false;

    async function loadWeeklyHoursSaved() {
      try {
        const response = await fetch('/api/metrics/summary?range=7', {
          headers: { 'x-biz-id': resolvedBusinessId },
          signal: controller.signal,
        });
        const payload = (await response.json().catch(() => ({}))) as {
          value?: { time_saved_hours?: number };
          totals?: { time_saved_minutes_est?: number };
        };

        if (!response.ok) {
          if (!cancelled) setWeeklyHoursSaved(null);
          return;
        }

        const valueHours = payload.value?.time_saved_hours;
        const totalsMinutes = payload.totals?.time_saved_minutes_est;
        const normalizedHours = typeof valueHours === 'number'
          ? valueHours
          : typeof totalsMinutes === 'number'
            ? Number((totalsMinutes / 60).toFixed(1))
            : null;

        if (!cancelled) {
          setWeeklyHoursSaved(normalizedHours);
        }
      } catch {
        if (!cancelled) setWeeklyHoursSaved(null);
      }
    }

    void loadWeeklyHoursSaved();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [biz?.id]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  const toggleSidebarCollapsed = () => {
    setSidebarCollapsed((previous) => !previous);
  };

  const toggleSidebarPinned = () => {
    setSidebarPinned((previous) => {
      const next = !previous;
      if (!next) {
        setSidebarCollapsed(true);
      }
      return next;
    });
  };

  const renderSidebarNav = ({
    compact = false,
    onNavigate,
  }: {
    compact?: boolean;
    onNavigate?: () => void;
  }) => (
    <nav className="flex flex-col gap-1">
      {NAV.map((item) => (
        <button
          key={item.key}
          onClick={() => {
            router.push(item.href);
            onNavigate?.();
          }}
          title={compact ? item.label : undefined}
          className={cn(
            'nav-item w-full transition-all duration-[220ms] ease-premium',
            compact ? 'justify-center px-2' : 'justify-start',
            item.active &&
              'bg-white/8 border-brand-accent/35 text-white shadow-[0_0_0_1px_rgba(0,168,107,0.2),0_16px_34px_rgba(0,0,0,0.4)] ring-1 ring-brand-accent/20',
          )}
        >
          <span className="shrink-0">{item.icon}</span>
          <span className={cn('truncate transition-all duration-[220ms] ease-premium', compact && 'sr-only')}>
            {item.label}
          </span>
        </button>
      ))}
    </nav>
  );

  const userDisplayName = userName || (userEmail ? userEmail.split('@')[0] : t('dashboard.layout.accountFallback'));
  const userDisplayRole = membershipRoleLabel || (userRole ? userRole.replace(/[_-]/g, ' ') : null);
  const userAvatarLabel = userDisplayName || userEmail || t('dashboard.layout.userFallback');
  const normalizedUserName = normalizeIdentityLine(userDisplayName);
  const normalizedUserEmail = normalizeIdentityLine(userEmail || '');
  const normalizedUserEmailLocal = normalizeIdentityLine((userEmail || '').split('@')[0] || '');
  const showUserEmail =
    Boolean(userEmail) &&
    (userEmail ?? '').includes('@') &&
    normalizedUserEmail !== normalizedUserName &&
    normalizedUserEmailLocal !== normalizedUserName;
  const dropdownMotionClass = (isOpen: boolean) =>
    cn(
      'dropdown absolute right-0 top-full z-50 mt-1 w-64 border border-white/10 bg-zinc-900/90 p-1.5 shadow-2xl backdrop-blur-xl transition-all duration-[240ms] ease-out transform-gpu origin-top-right',
      isOpen
        ? 'opacity-100 translate-y-0 scale-100 pointer-events-auto'
        : 'opacity-0 -translate-y-1 scale-[0.98] pointer-events-none',
    );

  const hoursSavedValue = hoursSavedLoading
    ? '...'
    : typeof hoursSavedThisMonth === 'number'
      ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(hoursSavedThisMonth)
      : '—';
  const weeklyHoursSavedValue = typeof weeklyHoursSaved === 'number'
    ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(weeklyHoursSaved)
    : '0';

  const engagementItems = useMemo<EngagementTriggerItem[]>(() => {
    const dayOfWeek = new Date().getDay(); // 0=Sun, 1=Mon, 4=Thu, 5=Fri
    const items: EngagementTriggerItem[] = [];

    if (dayOfWeek === 1) {
      items.push({
        id: 'monday',
        type: 'notification',
        message: t('dashboard.engagement.mondayNotification'),
      });
    }

    if (dayOfWeek === 4) {
      items.push({
        id: 'thursday',
        type: 'notification',
        message: t('dashboard.engagement.thursdayReminder'),
      });
    }

    if (dayOfWeek === 5) {
      items.push({
        id: 'friday',
        type: 'email',
        message: t('dashboard.engagement.fridayEmail', { hours: weeklyHoursSavedValue }),
      });
    }

    return items;
  }, [t, weeklyHoursSavedValue]);

  const handlePaywallAction = (action: PaywallAction) => {
    const plan = action === 'pro_upgrade' ? 'pro' : 'starter';
    console.log('[paywall] mock checkout redirect', { action, plan, reason: paywallReason });
    toast(
      t('dashboard.paywall.mockCheckout', {
        plan: action === 'pro_upgrade'
          ? t('dashboard.paywall.plans.pro.title')
          : t('dashboard.paywall.plans.essential.title'),
      }),
      'info',
    );
    setPaywallOpen(false);
    router.push(`/pricing?source=paywall&plan=${plan}&reason=${paywallReason}`);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--color-bg)' }}>
        <div className="flex items-center gap-3 text-[var(--color-text-tertiary)]">
          <div className="w-4 h-4 border-2 border-[var(--color-border)] border-t-[var(--color-brand)] rounded-full animate-spin" />
          <span className="text-sm">{t('common.loading')}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="opinia-bg min-h-screen bg-zinc-950 text-zinc-100">
      {/* ── Topbar ── */}
      <header
        data-testid="dashboard-topbar"
        className="sticky top-0 z-50 border-b border-white/5 bg-zinc-950/95 backdrop-blur-md shadow-glass transition-all duration-200 ease-premium"
      >
        <div className="mx-auto flex h-16 max-w-[1480px] items-center gap-2 px-6">
          <button
            onClick={() => setMobileDrawerOpen((prev) => !prev)}
            className={cn('inline-flex h-9 w-9 items-center justify-center rounded-lg text-white/75 transition-all duration-[220ms] ease-premium hover:bg-white/10 hover:text-white/92 lg:hidden', ringAccent)}
            aria-label={t('dashboard.layout.toggleNavigation')}
          >
            {icons.menu}
          </button>

          <button onClick={() => router.push('/dashboard/businesses')} className="shrink-0">
            <Logo size="sm" />
          </button>

          <Divider orientation="vertical" className="mx-1 hidden h-6 sm:block" />

          {/* Org switcher */}
          <div className="relative" ref={orgRef}>
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={orgOpen}
              aria-label={t('nav.switchOrg')}
              onClick={() => {
                setOrgOpen((previous) => !previous);
                setBizOpen(false);
                setUserMenuOpen(false);
                setNotificationsOpen(false);
                setCommandOpen(false);
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setOrgOpen(true);
                  return;
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setOrgOpen(false);
                }
              }}
              className={cn(
                'flex items-center gap-2 rounded-xl border border-white/10 bg-black/40 px-2.5 py-1.5 text-sm text-zinc-100 transition-all duration-[220ms] ease-premium hover:border-white/15 hover:bg-white/5',
                ringAccent,
              )}
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-primary/65 text-[10px] font-bold text-white">
                {getInitials(org?.name)}
              </span>
              <span className="max-w-[90px] truncate text-sm font-medium text-white/90 sm:max-w-[120px]">
                {org?.name || t('nav.switchOrg')}
              </span>
              {membershipRoleLabel && (
                <span className="hidden rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-emerald-400 md:inline-flex">
                  {membershipRoleLabel}
                </span>
              )}
              <span className="text-white/50">{icons.chevron}</span>
            </button>
            <div
              className={cn(dropdownMotionClass(orgOpen), 'left-0 right-auto mt-2 w-[300px] origin-top-left p-2')}
              aria-hidden={!orgOpen}
              role="menu"
            >
              <div className="mb-2">
                <input
                  id="workspace-switcher-search"
                  type="search"
                  value={orgSearch}
                  onChange={(event) => {
                    setOrgSearch(event.target.value);
                    setOrgFocusIndex(0);
                  }}
                  onKeyDown={handleOrgSearchKeyDown}
                  placeholder={t('dashboard.layout.searchOrgPlaceholder')}
                  aria-label={t('dashboard.layout.searchOrgAria')}
                  className="glass-input w-full px-3 py-2 text-sm"
                />
              </div>
              <div className="max-h-64 space-y-1 overflow-auto pr-1">
                {filteredOrgs.length === 0 ? (
                  <div className="rounded-lg border border-white/5 bg-black/30 px-3 py-2 text-sm text-zinc-400">
                    {t('common.noResults')}
                  </div>
                ) : (
                  filteredOrgs.map((item, index) => (
                    <button
                      key={item.id}
                      type="button"
                      role="menuitem"
                      onMouseEnter={() => setOrgFocusIndex(index)}
                      onClick={() => {
                        void handleSelectOrg(item.id);
                      }}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-all duration-[220ms] ease-out',
                        item.id === org?.id
                          ? 'border-white/12 bg-white/5 text-white'
                          : orgFocusIndex === index
                            ? 'border-white/12 bg-white/5 text-white'
                            : 'border-transparent text-zinc-300 hover:bg-white/5 hover:text-white',
                      )}
                    >
                      <span className="flex h-5 w-5 items-center justify-center rounded-md bg-white/12 text-[10px] font-bold">
                        {getInitials(item.name)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{item.name}</span>
                        <span className="block truncate text-[10px] uppercase tracking-[0.08em] text-white/55">
                          {membershipRoleLabelsByOrg.get(item.id) || t('dashboard.layout.roleMember')}
                        </span>
                      </span>
                      {item.id === org?.id && <span className="ml-auto text-emerald-400">{icons.check}</span>}
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <div className="hidden items-center gap-2 xl:flex">
              <div className={cn('flex items-center gap-2 rounded-xl border border-white/10 bg-zinc-900/50 px-3 py-1.5 text-sm text-zinc-300 backdrop-blur-md')}>
                <span className="text-zinc-500">{icons.search}</span>
                <input
                  type="text"
                  aria-label={t('common.search')}
                  placeholder={t('common.search')}
                  className="w-40 border-0 bg-transparent px-0 py-0 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-0"
                />
              </div>
              <select
                aria-label={t('dashboard.layout.platformFilterAria')}
                className={cn('rounded-full border border-white/10 bg-zinc-900/60 px-3 py-1.5 text-sm text-zinc-300 backdrop-blur-md transition-all duration-[220ms] ease-premium hover:bg-white/5 hover:text-white', ringAccent)}
                defaultValue="all"
              >
                <option value="all">{t('dashboard.layout.platformAll')}</option>
                <option value="google">{t('dashboard.home.platform.google')}</option>
                <option value="tripadvisor">{t('dashboard.home.platform.tripadvisor')}</option>
                <option value="booking">{t('dashboard.home.platform.booking')}</option>
              </select>
              <button
                type="button"
                onClick={() => {
                  setCommandQuery('');
                  setCommandFocusIndex(0);
                  setCommandOpen(true);
                }}
                className={cn('inline-flex items-center gap-1 rounded-full border border-white/10 bg-zinc-900/60 px-3 py-1.5 text-xs text-zinc-400 backdrop-blur-md transition-all duration-[220ms] ease-premium hover:bg-white/5 hover:text-zinc-100', ringAccent)}
                aria-label={t('dashboard.layout.openCommandPalette')}
              >
                <span>⌘K</span>
              </button>
            </div>

            <div className="relative hidden sm:block" ref={notificationsRef}>
              <button
                type="button"
                aria-label={t('dashboard.engagement.title')}
                onClick={() => {
                  setNotificationsOpen(!notificationsOpen);
                  setOrgOpen(false);
                  setBizOpen(false);
                  setUserMenuOpen(false);
                  setCommandOpen(false);
                }}
                className={cn('relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-zinc-900/60 text-zinc-400 transition-all duration-[220ms] ease-premium hover:bg-white/5 hover:text-white', ringAccent)}
                data-testid="dashboard-engagement-bell"
              >
                {icons.bell}
                {engagementItems.length > 0 && (
                  <span className="absolute -right-1 -top-1 inline-flex min-w-[18px] items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/15 px-1 text-[10px] font-semibold text-emerald-300">
                    {engagementItems.length}
                  </span>
                )}
              </button>
              <div className={cn(dropdownMotionClass(notificationsOpen), 'w-80 p-2')} aria-hidden={!notificationsOpen}>
                <p className="px-2 pt-1 text-[11px] font-semibold uppercase tracking-wide text-white/55">
                  {t('dashboard.engagement.title')}
                </p>
                <div className="my-2 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                {engagementItems.length === 0 ? (
                  <p className="px-2 pb-1 text-sm text-white/65">{t('dashboard.engagement.empty')}</p>
                ) : (
                  <div className="space-y-1">
                    {engagementItems.map((item) => (
                      <div
                        key={item.id}
                        className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-200"
                        data-testid={`dashboard-engagement-${item.id}`}
                      >
                        <div className="mb-1 flex items-center gap-2">
                          <span className="inline-flex rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
                            {item.type === 'email'
                              ? t('dashboard.engagement.emailLabel')
                              : t('dashboard.engagement.notificationLabel')}
                          </span>
                        </div>
                        <p>{item.message}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                setPaywallReason('trial_start');
                setPaywallOpen(true);
              }}
              className={cn(
                TOPBAR_CHIP_CLASS,
                'hidden justify-center border-white/10 bg-zinc-900/60 text-zinc-300 shadow-glass lg:inline-flex',
                'hover:-translate-y-[1px] hover:bg-white/5 hover:text-white',
                'active:translate-y-0 active:scale-[0.98]',
                ringAccent,
              )}
            >
              {t('dashboard.paywall.testButton')}
            </button>

            <div className={cn(TOPBAR_CHIP_CLASS, 'hidden gap-2 border-emerald-500/20 bg-emerald-500/10 text-emerald-400 shadow-none lg:flex')}>
              <span aria-hidden>⏱</span>
              <span className="whitespace-nowrap">
                {t('dashboard.home.hoursSavedBadge', { hours: hoursSavedValue })}
              </span>
            </div>

            <div className="relative hidden sm:block" ref={bizRef}>
              <button
                onClick={() => {
                  setBizOpen(!bizOpen);
                  setOrgOpen(false);
                  setUserMenuOpen(false);
                  setCommandOpen(false);
                }}
                data-testid="business-switcher"
                className={cn('flex items-center gap-1.5 rounded-lg border border-white/10 bg-zinc-900/60 px-2.5 py-1.5 text-sm text-zinc-100 transition-all duration-[220ms] ease-premium hover:bg-white/5', ringAccent)}
              >
                <span data-testid="business-logo" className="flex h-6 w-6 items-center justify-center">
                  {bizBrandSignedUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={bizBrandSignedUrl}
                      alt={`${biz?.name || 'Business'} logo`}
                      className="h-6 w-6 rounded-md border border-white/20 object-cover"
                      data-testid="business-avatar"
                    />
                  ) : (
                    <span
                      className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-primary/65 text-[10px] font-bold text-white"
                      data-testid="business-avatar"
                    >
                      {getInitials(biz?.name)}
                    </span>
                  )}
                </span>
                <span className="max-w-[150px] truncate font-semibold text-white/90">
                  {biz?.name || t('nav.switchBiz')}
                </span>
                <span className="text-white/50">{icons.chevron}</span>
              </button>
              <div className={cn(dropdownMotionClass(bizOpen), 'py-1')} aria-hidden={!bizOpen}>
                {uniqueBusinesses.length === 0 ? (
                  <div className="px-3 py-4 text-center text-sm text-white/55">{t('common.noResults')}</div>
                ) : (
                  uniqueBusinesses.map((business) => (
                    <button
                      key={business.id}
                      onClick={() => {
                        switchBiz(business.id);
                        setBizOpen(false);
                      }}
                      className={cn(
                        'w-full rounded-lg border border-transparent px-3 py-2 text-left text-sm transition-all duration-[220ms] ease-out',
                        business.id === biz?.id
                          ? 'border-white/12 bg-white/5 text-white'
                          : 'text-zinc-300 hover:bg-white/5 hover:text-white',
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="truncate font-medium">{business.name}</span>
                        <span className="ml-2 shrink-0 text-[10px] uppercase text-white/50">{business.type}</span>
                      </div>
                      {business.city && <span className="text-xs text-white/55">{business.city}</span>}
                    </button>
                  ))
                )}
              </div>
            </div>

              <div className="relative" ref={userMenuRef}>
              <button
                type="button"
                aria-label={t('dashboard.layout.profileMenu')}
                onClick={() => {
                  setUserMenuOpen(!userMenuOpen);
                  setBizOpen(false);
                  setOrgOpen(false);
                  setCommandOpen(false);
                }}
                className={cn(
                  'inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-zinc-900/70 text-zinc-100 transition-all duration-[220ms] ease-premium hover:bg-white/5',
                  ringAccent,
                )}
              >
                <span className="text-xs font-semibold">{getInitials(userAvatarLabel)}</span>
              </button>
              <div className={dropdownMotionClass(userMenuOpen)} aria-hidden={!userMenuOpen}>
                <div className="rounded-lg border border-white/10 bg-black/25 px-3 py-2">
                  <p className="truncate text-sm font-semibold text-white/92">{userDisplayName}</p>
                  {showUserEmail && <p className="truncate text-xs text-zinc-400">{userEmail}</p>}
                  {userDisplayRole && <p className="mt-1 text-[11px] uppercase tracking-[0.08em] text-emerald-400">{userDisplayRole}</p>}
                </div>
                <div className="my-1 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                <button
                  type="button"
                  onClick={() => {
                    setUserMenuOpen(false);
                    if (canAccessAdminPanel) router.push('/dashboard/admin');
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg border border-transparent px-3 py-2 text-left text-sm text-zinc-300 transition-all duration-[220ms] ease-out hover:bg-white/5 hover:text-white',
                    !canAccessAdminPanel && 'hidden',
                  )}
                >
                  {icons.settings}
                  <span>{t('dashboard.layout.adminPanel')}</span>
                </button>
                {canAccessAdminPanel && (
                  <div className="my-1 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                )}
                <button
                  type="button"
                  onClick={() => {
                    setUserMenuOpen(false);
                    router.push('/dashboard/settings');
                  }}
                  className="flex w-full items-center gap-2 rounded-lg border border-transparent px-3 py-2 text-left text-sm text-zinc-300 transition-all duration-[220ms] ease-out hover:bg-white/5 hover:text-white"
                >
                  {icons.settings}
                  <span>{t('dashboard.layout.accountSettings')}</span>
                </button>
                <div className="my-1 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                <div className="space-y-2 rounded-lg border border-white/10 bg-black/25 p-2">
                  <LanguageSwitcher className="w-full justify-center" />
                  <div className="flex justify-end">
                    <ThemeToggle className="rounded-lg border border-white/10 bg-white/5 p-2 text-zinc-300 transition-all duration-200 ease-premium hover:bg-white/10 hover:text-white" />
                  </div>
                </div>
                <div className="my-1 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                <button
                  type="button"
                  onClick={() => {
                    setUserMenuOpen(false);
                    void handleLogout();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg border border-transparent px-3 py-2 text-left text-sm text-zinc-300 transition-all duration-[220ms] ease-out hover:bg-white/5 hover:text-white"
                >
                  {icons.logout}
                  <span>{t('nav.logout')}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {mobileDrawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/55 backdrop-blur-[1px]"
            aria-label={t('dashboard.layout.closeNavigationDrawer')}
            onClick={() => setMobileDrawerOpen(false)}
          />
          <aside className="absolute left-0 top-0 h-full w-[280px] rounded-r-xl border-r border-white/10 bg-zinc-900/85 p-4 shadow-glass backdrop-blur-xl animate-slide-in-left">
            <div className="mb-4 flex items-center justify-between">
              <button type="button" onClick={() => router.push('/dashboard/businesses')} className="shrink-0">
                <Logo size="sm" />
              </button>
              <button
                type="button"
                onClick={() => setMobileDrawerOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-white/70 transition-all duration-[220ms] ease-premium hover:bg-white/10 hover:text-white/92"
                aria-label={t('common.close')}
              >
                ×
              </button>
            </div>
            {renderSidebarNav({ onNavigate: () => setMobileDrawerOpen(false) })}
          </aside>
        </div>
      )}

      {!sidebarPinned && sidebarCollapsed && (
        <div
          className="fixed bottom-0 left-0 top-16 z-30 hidden w-3 lg:block"
          onMouseEnter={openSidebarHover}
          aria-hidden
        />
      )}

      {sidebarHoverOpen && !sidebarPinned && sidebarCollapsed && (
        <div className="fixed inset-0 z-40 hidden lg:block">
          <button
            type="button"
            className="absolute inset-0 bg-black/20 backdrop-blur-[1px]"
            aria-label={t('dashboard.layout.closeSidebarPreview')}
            onClick={() => {
              clearSidebarCloseTimeout();
              setSidebarHoverOpen(false);
            }}
          />
          <aside
            className="absolute bottom-0 left-0 top-16 w-[280px] rounded-r-xl border-r border-white/10 bg-zinc-900/90 p-4 shadow-float backdrop-blur-xl"
            onMouseEnter={openSidebarHover}
            onMouseLeave={scheduleSidebarHoverClose}
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={toggleSidebarCollapsed}
                className={cn(
                  'inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/14 bg-white/6 text-white/80 transition-all duration-[220ms] ease-premium hover:bg-white/12 hover:text-white',
                  ringAccent,
                )}
                aria-label={sidebarCollapsed ? t('dashboard.layout.expandSidebar') : t('dashboard.layout.collapseSidebar')}
                aria-pressed={sidebarCollapsed}
              >
                {icons.sidebar}
              </button>
              <button
                type="button"
                onClick={toggleSidebarPinned}
                className={cn(
                  'inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/14 bg-white/6 text-white/80 transition-all duration-[220ms] ease-premium hover:bg-white/12 hover:text-white',
                  sidebarPinned && 'border-brand-accent/35 text-emerald-300 shadow-[0_0_16px_rgba(0,168,107,0.22)]',
                  ringAccent,
                )}
                aria-label={sidebarPinned ? t('dashboard.layout.enableAutoSidebar') : t('dashboard.layout.pinSidebar')}
                aria-pressed={sidebarPinned}
              >
                {sidebarPinned ? icons.pin : icons.pinOff}
              </button>
            </div>
            {renderSidebarNav({
              onNavigate: () => {
                clearSidebarCloseTimeout();
                setSidebarHoverOpen(false);
              },
            })}
          </aside>
        </div>
      )}

      <div className="mx-auto flex w-full min-w-0 max-w-[1480px] items-start gap-6 overflow-hidden px-6 py-6">
        <aside
          data-testid="dashboard-sidebar"
            className={cn(
              'hidden shrink-0 rounded-xl border border-white/10 bg-zinc-900/60 p-4 shadow-glass backdrop-blur-xl transition-[width] duration-[220ms] ease-premium lg:flex lg:flex-col',
              sidebarCollapsed ? 'w-[84px]' : 'w-[280px]',
            )}
        >
          <div className={cn('mb-3 flex items-center gap-2', sidebarCollapsed ? 'flex-col justify-center' : 'justify-between')}>
            <button
              type="button"
              onClick={toggleSidebarCollapsed}
              className={cn(
                'inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/14 bg-white/6 text-white/80 transition-all duration-[220ms] ease-premium hover:bg-white/12 hover:text-white',
                ringAccent,
              )}
              aria-label={sidebarCollapsed ? t('dashboard.layout.expandSidebar') : t('dashboard.layout.collapseSidebar')}
              aria-pressed={sidebarCollapsed}
            >
              {icons.sidebar}
            </button>
            <button
              type="button"
              onClick={toggleSidebarPinned}
              className={cn(
                'inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/14 bg-white/6 text-white/80 transition-all duration-[220ms] ease-premium hover:bg-white/12 hover:text-white',
                sidebarPinned && 'border-brand-accent/35 text-emerald-300 shadow-[0_0_16px_rgba(0,168,107,0.22)]',
                ringAccent,
              )}
              aria-label={sidebarPinned ? t('dashboard.layout.enableAutoSidebar') : t('dashboard.layout.pinSidebar')}
              aria-pressed={sidebarPinned}
            >
              {sidebarPinned ? icons.pin : icons.pinOff}
            </button>
          </div>
          {renderSidebarNav({ compact: sidebarCollapsed })}
        </aside>

        {/* ── Content ── */}
        <main className="w-0 min-w-0 flex-1 pb-20 md:pb-0">
          <div className="mx-auto w-full max-w-[1320px]">
            <section className="glass-panel p-6 md:p-7">
              {children}
            </section>
          </div>
        </main>
      </div>

      {/* ── Mobile tabs ── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex justify-around border-t border-white/12 bg-[#070B14]/90 py-1.5 backdrop-blur-xl">
        {MOBILE_TABS.map(item => (
          <button
            key={item.key}
            onClick={() => router.push(item.href)}
            className={cn(
              'flex flex-col items-center gap-0.5 rounded-lg px-3 py-1 text-[10px] font-medium transition-colors',
              item.active ? 'text-brand-accent' : 'text-white/55',
            )}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {commandOpen && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center px-4 pt-24">
          <button
            type="button"
            className="absolute inset-0 bg-black/45 backdrop-blur-[1px]"
            aria-label={t('common.close')}
            onClick={() => setCommandOpen(false)}
          />
          <div
            ref={commandRef}
            className="relative z-[71] w-full max-w-2xl rounded-2xl border border-white/10 bg-zinc-900/90 p-3 shadow-float backdrop-blur-xl transition-all duration-200 ease-premium"
          >
            <div className="mb-2 flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2">
              <span className="text-zinc-500">{icons.search}</span>
              <input
                ref={commandInputRef}
                value={commandQuery}
                onChange={(event) => {
                  setCommandQuery(event.target.value);
                  setCommandFocusIndex(0);
                }}
                placeholder={t('dashboard.layout.commandPlaceholder')}
                aria-label={t('dashboard.layout.commandAria')}
                className="w-full bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
              />
              <span className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-400">Esc</span>
            </div>

            <div className="max-h-[55vh] space-y-1 overflow-auto pr-1">
              {commandItems.length === 0 ? (
                  <div className="rounded-lg border border-white/10 bg-black/25 px-3 py-3 text-sm text-zinc-400">
                    {t('common.noResults')}
                  </div>
                ) : (
                commandItems.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    onMouseEnter={() => setCommandFocusIndex(index)}
                    onClick={() => {
                      if (item.type === 'route' && item.route) {
                        setCommandOpen(false);
                        router.push(item.route);
                        return;
                      }
                      if (item.type === 'org' && item.orgId) {
                        setCommandOpen(false);
                        void handleSelectOrg(item.orgId);
                      }
                    }}
                    className={cn(
                      'flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left transition-all duration-[220ms] ease-out',
                      commandFocusIndex === index
                        ? 'border-white/12 bg-white/5 text-white'
                        : 'border-transparent bg-transparent text-zinc-300 hover:bg-white/5 hover:text-white',
                    )}
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium">{item.label}</span>
                      <span className="truncate text-xs text-zinc-500">{item.hint}</span>
                    </div>
                    {item.active && (
                      <span className="ml-2 inline-flex rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-emerald-400">
                        {t('dashboard.layout.currentOrg')}
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      <PaywallModal
        isOpen={paywallOpen}
        triggerReason={paywallReason}
        onClose={() => setPaywallOpen(false)}
        onAction={handlePaywallAction}
      />

      <LitoLauncher />
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceProvider>
      <DashboardShell>{children}</DashboardShell>
    </WorkspaceProvider>
  );
}
