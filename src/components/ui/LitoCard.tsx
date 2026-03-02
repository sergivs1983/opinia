'use client';

import type { HTMLAttributes, ReactNode } from 'react';

import SpotlightCard from '@/components/ui/SpotlightCard';
import { cn } from '@/lib/utils';

type LitoCardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  spotlight?: boolean;
};

const baseClasses =
  'lito-card rounded-[28px] border border-[#ebeae4] bg-white p-0 shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.03)]';

export default function LitoCard({ children, className, spotlight = true, ...props }: LitoCardProps) {
  if (spotlight) {
    return (
      <SpotlightCard className={cn(baseClasses, className)} {...props}>
        {children}
      </SpotlightCard>
    );
  }

  return (
    <div className={cn(baseClasses, className)} {...props}>
      {children}
    </div>
  );
}
