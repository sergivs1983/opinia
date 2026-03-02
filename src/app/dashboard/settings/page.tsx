import SettingsDashboardPage from '@/components/dashboard/pages/SettingsDashboardPage';

export const dynamic = 'force-dynamic';

type DashboardSettingsPageProps = {
  searchParams?: {
    panel?: string | string[];
  };
};

function normalizePanel(value: string | string[] | undefined): 'config' | 'health' | 'plans' {
  const raw = Array.isArray(value) ? value[0] || 'config' : value || 'config';
  if (raw === 'health') return 'health';
  if (raw === 'plans') return 'plans';
  return 'config';
}

export default function DashboardSettingsPage({ searchParams }: DashboardSettingsPageProps) {
  const panel = normalizePanel(searchParams?.panel);
  return <SettingsDashboardPage panel={panel} />;
}
