'use client';

import type { ReactNode } from 'react';

import MainLayout from '@/components/layout/MainLayout';
import { WorkspaceProvider } from '@/contexts/WorkspaceContext';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <WorkspaceProvider>
      <MainLayout>{children}</MainLayout>
    </WorkspaceProvider>
  );
}
