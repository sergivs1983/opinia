'use client';

import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

interface ToggleProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}

export default function Toggle({ checked, onChange, label, className, disabled, ...props }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 items-center rounded-full border transition-all duration-[220ms] ease-premium',
        checked ? 'bg-brand-accent/35 border-brand-accent/55' : 'bg-white/12 border-white/20',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent/45',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 rounded-full bg-white shadow-glass transition-transform duration-[220ms] ease-premium',
          checked ? 'translate-x-6' : 'translate-x-1',
        )}
      />
    </button>
  );
}

