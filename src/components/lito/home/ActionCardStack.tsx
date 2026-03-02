'use client';

import ActionCard from '@/components/lito/home/ActionCard';
import type { ActionCardsSource } from '@/components/lito/home/useActionCards';
import type { ActionCard as LitoActionCard, ActionCardCta, ActionCardMode } from '@/types/lito-cards';

type ActionCardStackProps = {
  cards: LitoActionCard[];
  mode: ActionCardMode;
  source: ActionCardsSource;
  queueCount: number;
  title: string;
  emptyTitle: string;
  emptySubtitle: string;
  preparingText: string;
  updatingText: string;
  viewAllLabel: string;
  onOpenQueue: () => void;
  onAction: (card: LitoActionCard, cta: ActionCardCta) => void;
  busyMap: Record<string, boolean>;
};

function cardBusyKey(cardId: string, action: string): string {
  return `${cardId}:${action}`;
}

export default function ActionCardStack({
  cards,
  mode,
  source,
  queueCount,
  title,
  emptyTitle,
  emptySubtitle,
  preparingText,
  updatingText,
  viewAllLabel,
  onOpenQueue,
  onAction,
  busyMap,
}: ActionCardStackProps) {
  const visibleLimit = mode === 'advanced' ? 6 : 2;
  const visibleCards = cards.slice(0, visibleLimit);

  return (
    <section className="lito-action-stack">
      <div className="lito-action-stack-head">
        <h2>{title}</h2>
        <div className="lito-action-stack-meta">
          {source === 'stale' ? (
            <span className="lito-source-status" role="status" aria-live="polite">
              <span className="lito-source-spinner" aria-hidden="true" />
              {updatingText}
            </span>
          ) : null}
          {queueCount > visibleCards.length ? (
            <button type="button" className="lito-view-all" onClick={onOpenQueue}>
              {viewAllLabel} ({queueCount})
            </button>
          ) : null}
        </div>
      </div>

      {source === 'empty' ? (
        <div className="lito-skeleton-wrap" role="status" aria-live="polite">
          <p className="lito-skeleton-text">{preparingText}</p>
          <div className="lito-skeleton-grid">
            {Array.from({ length: Math.min(2, visibleLimit) }).map((_, idx) => (
              <div className="lito-skeleton-card" key={`skeleton-${idx}`} aria-hidden="true" />
            ))}
          </div>
        </div>
      ) : null}

      {source !== 'empty' ? (
        <div className="lito-action-grid">
          {visibleCards.map((card) => (
            <ActionCard
              key={card.id}
              card={card}
              busy={Boolean(
                busyMap[cardBusyKey(card.id, card.primary_cta.action)]
                || (card.secondary_cta && busyMap[cardBusyKey(card.id, card.secondary_cta.action)]),
              )}
              onAction={onAction}
            />
          ))}
          {visibleCards.length === 0 ? (
            <article className="lito-empty-card">
              <h3>{emptyTitle}</h3>
              <p>{emptySubtitle}</p>
            </article>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
