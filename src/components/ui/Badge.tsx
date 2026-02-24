'use client';

import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';
import { glass, glassActive, textMain, textSub } from '@/components/ui/glass';

type BadgeVariant = 'default' | 'brand' | 'success' | 'warning' | 'danger';
type BadgeKind = 'platform' | 'status' | 'sentiment';
type BadgeTone =
  | 'google'
  | 'tripadvisor'
  | 'booking'
  | 'manual'
  | 'other'
  | 'draft'
  | 'selected'
  | 'published'
  | 'archived'
  | 'sent'
  | 'failed'
  | 'positive'
  | 'neutral'
  | 'negative';

interface BadgeProps {
  variant?: BadgeVariant;
  kind?: BadgeKind;
  tone?: BadgeTone;
  dot?: boolean;
  className?: string;
  children: ReactNode;
}

function presetClass(kind: BadgeKind | undefined, tone: BadgeTone | undefined): string | null {
  if (!kind || !tone) return null;
  if (kind === 'platform') {
    if (tone === 'google') return cn(glass, 'text-blue-200 border-blue-400/35');
    if (tone === 'tripadvisor') return cn(glass, 'text-emerald-300 border-emerald-400/35');
    if (tone === 'booking') return cn(glass, 'text-cyan-200 border-cyan-400/35');
    if (tone === 'manual') return cn(glass, 'text-white/82 border-white/30');
    return cn(glass, textSub, 'border-white/20');
  }
  if (kind === 'status') {
    if (tone === 'published' || tone === 'sent') return cn(glass, 'text-emerald-300 border-emerald-400/35');
    if (tone === 'selected') return cn(glassActive, 'text-emerald-300 border-brand-accent/40');
    if (tone === 'failed') return cn(glass, 'text-red-300 border-red-400/35');
    if (tone === 'archived') return cn(glass, 'text-white/62 border-white/18');
    return cn(glass, textSub, 'border-white/20');
  }
  if (tone === 'positive') return cn(glass, 'text-emerald-300 border-emerald-400/35');
  if (tone === 'neutral') return cn(glass, 'text-amber-300 border-amber-400/35');
  return cn(glass, 'text-red-300 border-red-400/35');
}

export default function Badge({ variant = 'default', kind, tone, dot, className, children }: BadgeProps) {
  const preset = presetClass(kind, tone);
  const variantClass =
    preset ? preset
      : variant === 'brand'
      ? cn(glassActive, 'text-emerald-300 border-brand-accent/40')
      : variant === 'success'
        ? cn(glass, 'text-emerald-300 border-emerald-400/35')
        : variant === 'warning'
          ? cn(glass, 'text-amber-300 border-amber-400/35')
          : variant === 'danger'
            ? cn(glass, 'text-red-300 border-red-400/35')
            : cn(glass, textSub, 'border-white/15');

  return (
    <span className={cn('badge', textMain, variantClass, className)}>
      {dot && (
        <span
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{
            background: variant === 'default'  ? 'var(--color-text-tertiary)'
                       : variant === 'brand'   ? 'var(--color-brand)'
                       : variant === 'success'  ? 'var(--color-success)'
                       : variant === 'warning'  ? 'var(--color-warning)'
                       : 'var(--color-danger)',
          }}
        />
      )}
      {children}
    </span>
  );
}
