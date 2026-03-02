import LITOChatTab from '@/components/lito/tabs/LITOChatTab';
import LITOConfigTab from '@/components/lito/tabs/LITOConfigTab';
import LITOHealthTab from '@/components/lito/tabs/LITOHealthTab';
import LITOInboxTab from '@/components/lito/tabs/LITOInboxTab';
import LITOPlannerTab from '@/components/lito/tabs/LITOPlannerTab';

export const dynamic = 'force-dynamic';

type DashboardLitoPageProps = {
  searchParams?: {
    tab?: string | string[];
  };
};

function readTab(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] || 'inbox' : value || 'inbox';
  if (raw === 'chat' || raw === 'inbox' || raw === 'planner' || raw === 'config' || raw === 'health') return raw;
  return 'inbox';
}

export default function DashboardLitoPage({ searchParams }: DashboardLitoPageProps) {
  const tab = readTab(searchParams?.tab);

  if (tab === 'chat') return <LITOChatTab />;
  if (tab === 'planner') return <LITOPlannerTab />;
  if (tab === 'config') return <LITOConfigTab />;
  if (tab === 'health') return <LITOHealthTab />;

  return <LITOInboxTab />;
}
