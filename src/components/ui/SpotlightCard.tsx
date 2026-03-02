'use client';

import {
  forwardRef,
  useEffect,
  useState,
  type HTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { motion, useMotionTemplate, useMotionValue } from 'framer-motion';

import { cn } from '@/lib/utils';

type SpotlightCardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  disabled?: boolean;
};

function supportsSpotlightMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(pointer: fine)').matches;
  const canHover = window.matchMedia('(hover: hover)').matches;
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  if (coarsePointer) return false;
  if (!canHover) return false;
  return !prefersReducedMotion && finePointer;
}

const SpotlightCard = forwardRef<HTMLDivElement, SpotlightCardProps>(function SpotlightCard(
  { children, className, style, disabled = false, onMouseMove, onMouseEnter, onMouseLeave, ...props },
  ref,
) {
  const [spotlightEnabled, setSpotlightEnabled] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const pointerX = useMotionValue(160);
  const pointerY = useMotionValue(160);
  const spotlightBackground = useMotionTemplate`radial-gradient(320px circle at ${pointerX}px ${pointerY}px, rgba(16, 185, 129, 0.07) 0%, transparent 65%)`;
  const borderGlow = useMotionTemplate`radial-gradient(220px circle at ${pointerX}px ${pointerY}px, rgba(16, 185, 129, 0.18) 0%, transparent 62%)`;

  useEffect(() => {
    const update = () => setSpotlightEnabled(supportsSpotlightMotion());
    update();

    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    const queries = [
      window.matchMedia('(prefers-reduced-motion: reduce)'),
      window.matchMedia('(pointer: fine)'),
      window.matchMedia('(pointer: coarse)'),
      window.matchMedia('(hover: hover)'),
    ];

    for (const mediaQuery of queries) {
      mediaQuery.addEventListener('change', update);
    }

    return () => {
      for (const mediaQuery of queries) {
        mediaQuery.removeEventListener('change', update);
      }
    };
  }, []);

  const motionEnabled = spotlightEnabled && !disabled;

  const handleMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    if (!motionEnabled) {
      onMouseMove?.(event);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    pointerX.set(event.clientX - rect.left);
    pointerY.set(event.clientY - rect.top);
    onMouseMove?.(event);
  };

  const handleMouseEnter = (event: MouseEvent<HTMLDivElement>) => {
    setIsHovered(true);
    onMouseEnter?.(event);
  };

  const handleMouseLeave = (event: MouseEvent<HTMLDivElement>) => {
    setIsHovered(false);
    onMouseLeave?.(event);
  };

  return (
    <div
      ref={ref}
      className={cn('relative isolate overflow-hidden rounded-[28px]', className)}
      style={style}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      {...props}
    >
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-[-1px] z-0 rounded-[29px]"
        style={{ background: borderGlow }}
        animate={{ opacity: motionEnabled && isHovered ? 1 : 0 }}
        transition={{ duration: 0.26, ease: 'easeOut' }}
      />
      <div aria-hidden="true" className="pointer-events-none absolute inset-[1px] z-[1] rounded-[27px] bg-white dark:bg-zinc-900" />
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[2] rounded-[28px]"
        style={{ background: spotlightBackground }}
        animate={{ opacity: motionEnabled && isHovered ? 1 : 0 }}
        transition={{ duration: 0.26, ease: 'easeOut' }}
      />
      <div className="relative z-[3] rounded-[28px]">{children}</div>
    </div>
  );
});

export default SpotlightCard;
