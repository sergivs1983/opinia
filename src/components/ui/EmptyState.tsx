'use client';

import type { ReactNode } from 'react';

import LitoCard from '@/components/ui/LitoCard';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export default function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <LitoCard spotlight={false} className={cn('p-8 text-center', className)}>
      {icon ? <div className="mb-3 text-3xl text-zinc-500">{icon}</div> : null}
      <h3 className="text-base font-semibold text-[#1a1917]" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>
        {title}
      </h3>
      {description ? <p className="mt-2 text-sm text-[#6b6a65]">{description}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </LitoCard>
  );
}
