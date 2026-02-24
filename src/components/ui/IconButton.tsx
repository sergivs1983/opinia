'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { glass, textMain } from '@/components/ui/glass';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  label: string;
}

export default function IconButton({ className, icon, label, ...props }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        'inline-flex h-9 w-9 items-center justify-center rounded-xl transition-all duration-[220ms] ease-premium',
        glass,
        textMain,
        'hover:scale-[1.02] hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent/45',
        'disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
      {...props}
    >
      {icon}
    </button>
  );
}

