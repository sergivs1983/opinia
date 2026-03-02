import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

type DashboardLitoChatLegacyPageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

function firstQueryValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] || null;
  if (typeof value === 'string') return value;
  return null;
}

export default function DashboardLitoChatLegacyPage({ searchParams }: DashboardLitoChatLegacyPageProps) {
  const params = new URLSearchParams();

  if (searchParams) {
    for (const [key, rawValue] of Object.entries(searchParams)) {
      if (key === 'tab') continue;
      const value = firstQueryValue(rawValue);
      if (!value) continue;
      params.set(key, value);
    }
  }

  const query = params.toString();
  redirect(query ? `/dashboard/lito?${query}` : '/dashboard/lito');
}
