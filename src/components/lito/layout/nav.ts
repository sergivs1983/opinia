export type LitoNavItem = {
  key: string;
  label: string;
  href: string;
};

export const LITO_NAV_ITEMS: LitoNavItem[] = [
  {
    key: 'lito',
    label: 'LITO',
    href: '/dashboard/lito',
  },
  {
    key: 'inbox',
    label: 'Inbox',
    href: '/dashboard/inbox',
  },
  {
    key: 'planner',
    label: 'Planner',
    href: '/dashboard/planner',
  },
  {
    key: 'health',
    label: 'Health',
    href: '/dashboard/health',
  },
  {
    key: 'config',
    label: 'Config',
    href: '/dashboard/config',
  },
];
