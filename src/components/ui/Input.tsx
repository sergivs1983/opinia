'use client';

import { cn } from '@/lib/utils';
import { InputHTMLAttributes, forwardRef } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, hint, id, ...props }, ref) => {
    return (
      <div className="w-full">
        {label && (
          <label htmlFor={id} className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={id}
          className={cn(
            'w-full rounded-[var(--radius-md)] border px-3.5 py-2 text-sm',
            'bg-white/8 text-white/90 placeholder:text-white/45',
            'transition-all duration-[220ms] ease-premium',
            'focus:outline-none focus:ring-2 focus:ring-brand-accent/35 focus:border-brand-accent/45',
            error
              ? 'border-[var(--color-danger)] focus:ring-[var(--color-danger-subtle)]'
              : 'border-white/15',
            className
          )}
          {...props}
        />
        {hint && !error && <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">{hint}</p>}
        {error && <p className="mt-1 text-xs text-[var(--color-danger)]">{error}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';
export default Input;
