'use client';

import SocialPlannerPanel from '@/components/planner/SocialPlannerPanel';
import { ShellPageHeader } from '@/components/ui/AppShell';

export default function PlannerDashboardPage() {
  return (
    <section>
      <ShellPageHeader
        title="Planner."
        subtitle="Planificacio setmanal, calendari social i execucio assistida."
      />
      <SocialPlannerPanel />
    </section>
  );
}
