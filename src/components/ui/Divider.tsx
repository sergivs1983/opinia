'use client';

import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { glassDivider, textMuted } from '@/components/ui/glass';

interface DividerProps extends HTMLAttributes<HTMLDivElement> {
  orientation?: 'horizontal' | 'vertical';
  label?: string;
}

export default function Divider({ orientation = 'horizontal', label, className, ...props }: DividerProps) {
  if (orientation === 'vertical') {
    return (
      <div
        aria-hidden="true"
        className={cn(
          'h-full w-px bg-gradient-to-b from-transparent via-white/15 to-transparent shadow-[0_0_10px_rgba(0,168,107,0.10)]',
          glassDivider,
          className
        )}
        {...props}
      />
    );
  }

  if (!label) {
    return (
      <div
        aria-hidden="true"
        className={cn(
          'h-px w-full bg-gradient-to-r from-transparent via-white/15 to-transparent shadow-[0_0_12px_rgba(0,168,107,0.10)]',
          glassDivider,
          className
        )}
        {...props}
      />
    );
  }

  return (
    <div className={cn('relative flex items-center', className)} {...props}>
      <div
        aria-hidden="true"
        className={cn(
          'h-px w-full bg-gradient-to-r from-transparent via-white/15 to-transparent shadow-[0_0_12px_rgba(0,168,107,0.10)]',
          glassDivider
        )}
      />
      <span
        className={cn(
          'absolute left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-white/12 bg-black/25 px-3 py-0.5 text-xs backdrop-blur-lg',
          textMuted,
        )}
      >
        {label}
      </span>
    </div>
  );
}
