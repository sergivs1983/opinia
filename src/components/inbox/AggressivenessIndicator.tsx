'use client';

import { cn } from '@/lib/utils';

interface AggressivenessIndicatorProps {
  level: number;
}

export default function AggressivenessIndicator({ level }: AggressivenessIndicatorProps) {
  const normalized = Math.max(1, Math.min(3, Math.round(level || 1)));

  return (
    <div className="inline-flex items-center gap-1" aria-label={`SEO aggressiveness ${normalized}/3`}>
      {[1, 2, 3].map((step) => (
        <span
          key={step}
          className={cn(
            'h-1.5 w-6 rounded-full border border-white/15 transition-all duration-[220ms] ease-premium',
            step <= normalized ? 'bg-brand-accent/75' : 'bg-white/12',
          )}
        />
      ))}
    </div>
  );
}
