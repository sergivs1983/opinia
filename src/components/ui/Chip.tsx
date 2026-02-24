'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { glass, glassActive, textSub } from '@/components/ui/glass';

interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  children: ReactNode;
}

export default function Chip({ active, className, children, ...props }: ChipProps) {
  return (
    <button
      type="button"
      className={cn(
        'px-3 py-1.5 text-xs font-medium transition-all duration-[220ms] ease-premium',
        active ? cn(glassActive, 'text-white/92') : cn(glass, textSub, 'hover:bg-white/10'),
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

