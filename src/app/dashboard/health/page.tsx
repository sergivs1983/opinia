import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function DashboardHealthPage() {
  redirect('/dashboard/lito?modal=settings&panel=health');
}
