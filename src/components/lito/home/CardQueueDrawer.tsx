'use client';

import ActionCard from '@/components/lito/home/ActionCard';
import type { ActionCard as LitoActionCard, ActionCardCta } from '@/types/lito-cards';

type CardQueueDrawerProps = {
  open: boolean;
  title: string;
  closeLabel: string;
  emptyLabel: string;
  cards: LitoActionCard[];
  queueCount: number;
  busyMap: Record<string, boolean>;
  onClose: () => void;
  onAction: (card: LitoActionCard, cta: ActionCardCta) => void;
};

function cardBusyKey(cardId: string, action: string): string {
  return `${cardId}:${action}`;
}

export default function CardQueueDrawer({
  open,
  title,
  closeLabel,
  emptyLabel,
  cards,
  queueCount,
  busyMap,
  onClose,
  onAction,
}: CardQueueDrawerProps) {
  if (!open) return null;

  return (
    <div className="lito-queue-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="lito-queue-backdrop" onClick={onClose} aria-label={closeLabel} />
      <aside className="lito-queue-drawer">
        <header className="lito-queue-header">
          <h3>{title} ({queueCount})</h3>
          <button type="button" className="lito-queue-close" onClick={onClose}>{closeLabel}</button>
        </header>

        <div className="lito-queue-list">
          {cards.map((card) => (
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
          {cards.length === 0 ? (
            <p className="lito-queue-empty">{emptyLabel}</p>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
