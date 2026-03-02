import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function DashboardPlannerPage() {
  redirect('/dashboard/lito?tab=planner');
}
