'use client';

import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { glass, glassStrong, glassActive, glassNoise, glassSweep } from '@/components/ui/glass';

type GlassCardVariant = 'glass' | 'glassStrong' | 'glassActive' | 'default' | 'strong' | 'active';

interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: GlassCardVariant;
  children: ReactNode;
}

export default function GlassCard({ variant = 'default', className, children, ...props }: GlassCardProps) {
  const resolvedVariant =
    variant === 'glass' || variant === 'default'
      ? glass
      : variant === 'glassStrong' || variant === 'strong'
        ? glassStrong
        : glassActive;

  return (
    <div
      className={cn(
        'transition-all duration-[220ms] ease-premium',
        resolvedVariant,
        glassNoise,
        glassSweep,
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
