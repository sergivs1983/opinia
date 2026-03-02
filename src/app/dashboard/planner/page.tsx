import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function PlannerRedirectPage() {
  redirect('/dashboard/lito?tab=planner');
}
