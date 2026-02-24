'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PrimaryButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
}

export default function PrimaryButton({ className, children, ...props }: PrimaryButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold',
        'bg-brand-accent text-white shadow-glass transition-all duration-[220ms] ease-premium',
        'hover:brightness-110 hover:shadow-float focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent/50',
        'disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

