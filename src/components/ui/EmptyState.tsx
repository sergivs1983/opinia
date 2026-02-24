'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { glass, textMain, textSub } from '@/components/ui/glass';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export default function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn(glass, 'p-8 text-center', className)}>
      {icon && <div className="mb-3 text-3xl">{icon}</div>}
      <h3 className={cn('text-base font-semibold', textMain)}>{title}</h3>
      {description && <p className={cn('mt-2 text-sm', textSub)}>{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

