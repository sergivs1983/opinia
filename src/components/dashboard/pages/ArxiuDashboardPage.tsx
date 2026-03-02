'use client';

import LITOInboxTab from '@/components/lito/tabs/LITOInboxTab';
import { ShellPageHeader } from '@/components/ui/AppShell';

export default function ArxiuDashboardPage() {
  return (
    <section>
      <ShellPageHeader
        title="Arxiu."
        subtitle="Inbox real de ressenyes, aprovacions i historial d'accions."
      />
      <LITOInboxTab />
    </section>
  );
}
