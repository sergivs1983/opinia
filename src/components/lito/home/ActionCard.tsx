'use client';

import type { ActionCard as LitoActionCard, ActionCardCta } from '@/types/lito-cards';

type ActionCardProps = {
  card: LitoActionCard;
  busy?: boolean;
  onAction: (card: LitoActionCard, cta: ActionCardCta) => void;
};

function severityLabel(value: LitoActionCard['severity']): string {
  if (value === 'high') return 'Alta';
  if (value === 'medium') return 'Mitjana';
  return 'Baixa';
}

export default function ActionCard({ card, busy = false, onAction }: ActionCardProps) {
  return (
    <article className={`lito-action-card severity-${card.severity}`}>
      <div className="lito-action-card-head">
        <span className="lito-action-card-type">{card.type.replace('_', ' ')}</span>
        <span className="lito-action-card-severity">{severityLabel(card.severity)}</span>
      </div>

      <h3 className="lito-action-card-title">{card.title}</h3>
      <p className="lito-action-card-subtitle">{card.subtitle}</p>

      <div className="lito-action-card-actions">
        <button
          type="button"
          className="lito-action-card-primary"
          disabled={busy}
          onClick={() => onAction(card, card.primary_cta)}
        >
          {card.primary_cta.label}
        </button>
        {card.secondary_cta ? (
          <button
            type="button"
            className="lito-action-card-secondary"
            disabled={busy}
            onClick={() => onAction(card, card.secondary_cta as ActionCardCta)}
          >
            {card.secondary_cta.label}
          </button>
        ) : null}
      </div>
    </article>
  );
}
