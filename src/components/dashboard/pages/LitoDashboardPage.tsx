'use client';

import LITOChatTab from '@/components/lito/tabs/LITOChatTab';
import { ShellPageHeader } from '@/components/ui/AppShell';
import { useWorkspace } from '@/contexts/WorkspaceContext';

export default function LitoDashboardPage() {
  const { biz } = useWorkspace();

  return (
    <section>
      <ShellPageHeader
        title="LITO."
        subtitle={biz?.name ? `Conversa i executa accions per ${biz.name}.` : 'Conversa i executa accions del negoci en temps real.'}
      />
      <LITOChatTab />
    </section>
  );
}
