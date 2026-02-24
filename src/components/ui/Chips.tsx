'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { glass, glassActive, textSub } from '@/components/ui/glass';

export interface ChipItem {
  key: string;
  label: ReactNode;
}

interface ChipsProps {
  items: ChipItem[];
  activeKey?: string;
  onChange?: (key: string) => void;
  className?: string;
}

export default function Chips({ items, activeKey, onChange, className }: ChipsProps) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {items.map((item) => {
        const active = item.key === activeKey;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onChange?.(item.key)}
            className={cn(
              'px-3 py-1.5 text-xs font-medium transition-all duration-[220ms] ease-premium',
              active ? cn(glassActive, 'text-white/92') : cn(glass, textSub, 'hover:bg-white/10'),
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

