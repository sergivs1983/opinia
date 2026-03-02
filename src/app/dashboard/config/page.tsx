import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function DashboardConfigPage() {
  redirect('/dashboard/lito?modal=settings&panel=general');
}
