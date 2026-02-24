'use client';

import { cn } from '@/lib/utils';
import type { HTMLAttributes, ReactNode } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  children: ReactNode;
}

export default function Card({ interactive, padding = 'md', className, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'card',
        interactive && 'card-interactive cursor-pointer',
        padding === 'sm'   && 'p-3',
        padding === 'md'   && 'p-5',
        padding === 'lg'   && 'p-6',
        padding === 'none' && '',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('mb-4', className)}>{children}</div>;
}

export function CardTitle({ className, children }: { className?: string; children: ReactNode }) {
  return <h3 className={cn('text-base font-semibold text-[var(--color-text)]', className)}>{children}</h3>;
}

export function CardDescription({ className, children }: { className?: string; children: ReactNode }) {
  return <p className={cn('text-sm text-[var(--color-text-secondary)] mt-0.5', className)}>{children}</p>;
}
