export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';

import ClassicDashboardPage from '@/components/dashboard/ClassicDashboardPage';

type DashboardPageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

function readClassicFlag(searchParams?: Record<string, string | string[] | undefined>): string | null {
  if (!searchParams) return null;
  const value = searchParams.classic;
  if (Array.isArray(value)) return value[0] || null;
  return value || null;
}

export default function DashboardPage({ searchParams }: DashboardPageProps) {
  if (readClassicFlag(searchParams) === '1') {
    return <ClassicDashboardPage />;
  }

  redirect('/dashboard/lito');
}
