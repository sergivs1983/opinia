'use client';

import {
  forwardRef,
  useEffect,
  useState,
  type HTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from 'react';

import { cn } from '@/lib/utils';

type SpotlightCardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  disabled?: boolean;
};

function supportsSpotlightMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(pointer: fine)').matches;
  return !prefersReducedMotion && finePointer;
}

const SpotlightCard = forwardRef<HTMLDivElement, SpotlightCardProps>(function SpotlightCard(
  { children, className, style, disabled = false, onMouseMove, onMouseEnter, onMouseLeave, ...props },
  ref,
) {
  const [spotlightEnabled, setSpotlightEnabled] = useState(false);
  const [pointer, setPointer] = useState({ x: 160, y: 160 });

  useEffect(() => {
    setSpotlightEnabled(supportsSpotlightMotion());
  }, []);

  const motionEnabled = spotlightEnabled && !disabled;

  const handleMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    if (!motionEnabled) {
      onMouseMove?.(event);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setPointer({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
    onMouseMove?.(event);
  };

  return (
    <div
      ref={ref}
      className={cn('spotlight-card', motionEnabled ? 'spotlight-card-enabled' : '', className)}
      style={{
        ...style,
        ['--spot-x' as string]: `${pointer.x}px`,
        ['--spot-y' as string]: `${pointer.y}px`,
      }}
      onMouseMove={handleMouseMove}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      {...props}
    >
      <div className="spotlight-card-border" aria-hidden="true" />
      <div className="spotlight-card-surface" aria-hidden="true" />
      <div className="spotlight-card-glow" aria-hidden="true" />
      <div className="spotlight-card-content">{children}</div>
    </div>
  );
});

export default SpotlightCard;
