'use client';

import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

interface TabsProps {
  value: string;
  onChange: (v: string) => void;
  items: { key: string; label: string; icon?: ReactNode }[];
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}

export default function Tabs({ value, onChange, items, orientation = 'horizontal', className }: TabsProps) {
  const isVertical = orientation === 'vertical';

  return (
    <nav
      role="tablist"
      className={cn(
        'flex gap-0.5',
        isVertical ? 'flex-col' : 'flex-row overflow-x-auto',
        className
      )}
    >
      {items.map(item => {
        const active = item.key === value;
        return (
          <button
            key={item.key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.key)}
            className={cn(
              'flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-[var(--radius-md)] whitespace-nowrap transition-all duration-[220ms] ease-premium',
              isVertical && 'w-full text-left',
              active
                ? 'bg-brand-accent/20 text-emerald-300 border border-brand-accent/35'
                : 'text-white/70 hover:bg-white/8 hover:text-white/92',
            )}
          >
            {item.icon && <span className="shrink-0 w-4 h-4 flex items-center justify-center">{item.icon}</span>}
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}
