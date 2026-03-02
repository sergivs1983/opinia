import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function DashboardSettingsPage() {
  redirect('/dashboard/lito?tab=config');
}
