'use client';

import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {}

export default function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      className={cn(
        'skeleton h-4 w-full rounded-md bg-white/8',
        className,
      )}
      aria-hidden="true"
      {...props}
    />
  );
}

