import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

type DashboardSettingsPageProps = {
  searchParams?: {
    panel?: string | string[];
  };
};

function normalizePanel(value: string | string[] | undefined): 'general' | 'health' | 'billing' {
  const raw = Array.isArray(value) ? value[0] || 'general' : value || 'general';
  if (raw === 'health') return 'health';
  if (raw === 'plans' || raw === 'billing') return 'billing';
  return 'general';
}

export default function DashboardSettingsPage({ searchParams }: DashboardSettingsPageProps) {
  const panel = normalizePanel(searchParams?.panel);
  redirect(`/dashboard/lito?modal=settings&panel=${panel}`);
}
