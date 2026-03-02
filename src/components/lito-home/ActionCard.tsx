'use client';

import { type MouseEvent } from 'react';
import { cn } from '@/lib/utils';

type ActionCardProps = {
  title: string;
  description: string;
  badge?: string;
  ctaLabel: string;
  onCta: () => void;
  className?: string;
};

export default function ActionCard({ title, description, badge, ctaLabel, onCta, className }: ActionCardProps) {
  const handleMouseMove = (event: MouseEvent<HTMLElement>) => {
    const card = event.currentTarget;
    const rect = card.getBoundingClientRect();
    card.style.setProperty('--mouse-x', `${event.clientX - rect.left}px`);
    card.style.setProperty('--mouse-y', `${event.clientY - rect.top}px`);
  };

  return (
    <article
      className={cn('lito-home-action-card', className)}
      onMouseMove={handleMouseMove}
    >
      <div className="lito-home-action-card-content">
        {badge ? <span className="lito-home-action-badge">{badge}</span> : null}
        <h3 className="lito-home-action-title">{title}</h3>
        <p className="lito-home-action-description">{description}</p>
        <button type="button" className="lito-home-action-cta" onClick={onCta}>
          {ctaLabel}
        </button>
      </div>
    </article>
  );
}
