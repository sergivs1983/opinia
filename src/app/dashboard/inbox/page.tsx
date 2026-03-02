import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function InboxRedirectPage() {
  redirect('/dashboard/lito?tab=inbox');
}
