'use client';

import Image from 'next/image';
import { cn } from '@/lib/utils';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg' | 'hero';
  className?: string;
  animate?: boolean;
}

export default function Logo({ size = 'md', className, animate = false }: LogoProps) {
  const sizes = {
    sm: { width: 44, height: 24, className: 'h-6 w-auto' },
    md: { width: 59, height: 32, className: 'h-8 w-auto' },
    lg: { width: 81, height: 44, className: 'h-11 w-auto' },
    hero: { width: 117, height: 64, className: 'h-16 w-auto' },
  };

  const s = sizes[size];

  return (
    <span className={cn('inline-flex items-center', animate && 'group', className)}>
      <Image
        src="/brand/logo.png"
        alt="OpinIA"
        width={s.width}
        height={s.height}
        className={cn(
          s.className,
          'object-contain transition-transform duration-500',
          animate && 'group-hover:scale-110 group-hover:rotate-3'
        )}
        priority
      />
    </span>
  );
}
