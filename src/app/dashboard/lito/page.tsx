import { redirect } from 'next/navigation';

import LitoDashboardPage from '@/components/dashboard/pages/LitoDashboardPage';

export const dynamic = 'force-dynamic';

type DashboardLitoPageProps = {
  searchParams?: {
    tab?: string | string[];
  };
};

function readTab(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] || null;
  if (typeof value === 'string' && value.trim().length > 0) return value;
  return null;
}

export default function DashboardLitoPage({ searchParams }: DashboardLitoPageProps) {
  const tab = readTab(searchParams?.tab);

  if (tab === 'planner') redirect('/dashboard/planner');
  if (tab === 'inbox' || tab === 'review' || tab === 'archive' || tab === 'arxiu') redirect('/dashboard/arxiu');
  if (tab === 'config') redirect('/dashboard/settings?panel=config');
  if (tab === 'health') redirect('/dashboard/settings?panel=health');
  if (tab === 'plans') redirect('/dashboard/settings?panel=plans');

  return <LitoDashboardPage />;
}
