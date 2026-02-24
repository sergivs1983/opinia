'use client';

import { cn } from '@/lib/utils';
import { ButtonHTMLAttributes, forwardRef } from 'react';
import { ringAccent, textSub } from '@/components/ui/glass';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, children, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          // Base
          'inline-flex items-center justify-center font-medium rounded-[var(--radius-md)] transition-all duration-[220ms] ease-premium',
          ringAccent,
          'disabled:opacity-50 disabled:cursor-not-allowed',
          // Variants
          variant === 'primary' &&
            'bg-gradient-to-r from-brand-accent/90 to-brand-accent/70 text-white shadow-[0_10px_30px_rgba(0,168,107,0.18)] hover:from-brand-accent hover:to-brand-accent/80 active:translate-y-[1px] focus-visible:ring-offset-black/40',
          variant === 'secondary' && 'bg-white/5 border border-white/12 text-white/85 backdrop-blur-xl hover:bg-white/8',
          variant === 'ghost' && cn(textSub, 'bg-transparent hover:bg-white/5 hover:text-white/92'),
          variant === 'danger' && 'bg-[var(--color-danger)] text-white hover:opacity-90 shadow-xs',
          variant === 'outline' && 'border-2 border-brand-accent/50 text-brand-accent hover:bg-brand-accent/10',
          // Sizes
          size === 'sm' && 'text-xs px-3 py-1.5 gap-1.5',
          size === 'md' && 'text-sm px-4 py-2 gap-2',
          size === 'lg' && 'text-sm px-5 py-2.5 gap-2.5',
          className
        )}
        disabled={disabled || loading}
        {...props}
      >
        {loading && (
          <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
export default Button;
