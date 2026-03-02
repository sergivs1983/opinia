import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function DashboardInboxReviewPage() {
  redirect('/dashboard/lito?tab=inbox');
}
