'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import ActionCard from '@/components/lito/home/ActionCard';
import type { ActionCardsSource } from '@/components/lito/home/useActionCards';
import type { ActionCard as LitoActionCard, ActionCardCta, ActionCardMode } from '@/types/lito-cards';

type CardUIState = 'idle' | 'loading' | 'resolved';

export type ActionResolveResult = {
  resolved: boolean;
};

export type RefreshedActionCards = {
  cards: LitoActionCard[];
  mode: ActionCardMode;
  queueCount: number;
  source: ActionCardsSource;
};

type ActionCardStackProps = {
  cards: LitoActionCard[];
  mode: ActionCardMode;
  source: ActionCardsSource;
  queueCount: number;
  queueIsRemaining?: boolean;
  title: string;
  emptyTitle: string;
  emptySubtitle: string;
  preparingText: string;
  updatingText: string;
  viewAllLabel: string;
  onOpenQueue: () => void;
  onAction: (card: LitoActionCard, cta: ActionCardCta) => Promise<ActionResolveResult>;
  onRefreshCards?: () => Promise<RefreshedActionCards | null>;
  onQueueCardsChange?: (cards: LitoActionCard[], queueCount: number) => void;
  busyMap: Record<string, boolean>;
};

function cardBusyKey(cardId: string, action: string): string {
  return `${cardId}:${action}`;
}

const RESOLVE_ANIMATION_MS = 220;

export default function ActionCardStack({
  cards,
  mode,
  source,
  queueCount,
  queueIsRemaining = false,
  title,
  emptyTitle,
  emptySubtitle,
  preparingText,
  updatingText,
  viewAllLabel,
  onOpenQueue,
  onAction,
  onRefreshCards,
  onQueueCardsChange,
  busyMap,
}: ActionCardStackProps) {
  const [visibleCards, setVisibleCards] = useState<LitoActionCard[]>([]);
  const [queuedCards, setQueuedCards] = useState<LitoActionCard[]>([]);
  const [cardStates, setCardStates] = useState<Record<string, CardUIState>>({});

  const visibleCardsRef = useRef<LitoActionCard[]>([]);
  const queuedCardsRef = useRef<LitoActionCard[]>([]);
  const dismissedCardIdsRef = useRef<Set<string>>(new Set());
  const syncLockedRef = useRef(false);

  const visibleLimit = mode === 'advanced' ? 6 : 2;

  const applyLayout = useCallback((nextVisible: LitoActionCard[], nextQueued: LitoActionCard[]) => {
    visibleCardsRef.current = nextVisible;
    queuedCardsRef.current = nextQueued;
    setVisibleCards(nextVisible);
    setQueuedCards(nextQueued);
    if (onQueueCardsChange) {
      const effectiveQueueCount = queueIsRemaining ? Math.max(queueCount, nextQueued.length) : nextQueued.length;
      onQueueCardsChange(nextQueued, effectiveQueueCount);
    }
  }, [onQueueCardsChange, queueCount, queueIsRemaining]);

  useEffect(() => {
    if (syncLockedRef.current) return;
    const dismissed = dismissedCardIdsRef.current;
    const incomingIds = new Set(cards.map((card) => card.id));
    for (const cardId of Array.from(dismissed)) {
      if (!incomingIds.has(cardId)) dismissed.delete(cardId);
    }

    const filteredCards = cards.filter((card) => !dismissed.has(card.id));
    const nextVisible = filteredCards.slice(0, visibleLimit);
    const nextQueue = filteredCards.slice(visibleLimit);
    applyLayout(nextVisible, nextQueue);

    const allowed = new Set(filteredCards.map((card) => card.id));
    setCardStates((prev) => {
      const next: Record<string, CardUIState> = {};
      for (const [cardId, state] of Object.entries(prev)) {
        if (allowed.has(cardId) && state !== 'resolved') next[cardId] = state;
      }
      return next;
    });
  }, [cards, visibleLimit, applyLayout]);

  const displayQueueCount = useMemo(() => {
    if (queueIsRemaining) return Math.max(queueCount, queuedCards.length);
    return queuedCards.length;
  }, [queueIsRemaining, queueCount, queuedCards.length]);

  const shouldShowQueue = displayQueueCount > 0;

  const cardBusy = useCallback((card: LitoActionCard): boolean => {
    const primaryBusy = Boolean(busyMap[cardBusyKey(card.id, card.primary_cta.action)]);
    const secondaryBusy = Boolean(card.secondary_cta && busyMap[cardBusyKey(card.id, card.secondary_cta.action)]);
    const state = cardStates[card.id];
    return primaryBusy || secondaryBusy || state === 'loading' || state === 'resolved';
  }, [busyMap, cardStates]);

  const refreshAfterResolve = useCallback(async (currentVisible: LitoActionCard[]) => {
    if (!onRefreshCards) return;
    const refreshed = await onRefreshCards();
    if (!refreshed || (refreshed.source !== 'cache' && refreshed.source !== 'stale')) return;

    const dismissed = dismissedCardIdsRef.current;
    const incomingIds = new Set(refreshed.cards.map((card) => card.id));
    for (const cardId of Array.from(dismissed)) {
      if (!incomingIds.has(cardId)) dismissed.delete(cardId);
    }

    const incoming = refreshed.cards.filter((card) => !dismissed.has(card.id));
    const incomingById = new Map(incoming.map((card) => [card.id, card]));
    const used = new Set<string>();

    const nextVisible: LitoActionCard[] = [];
    for (const card of currentVisible) {
      const updated = incomingById.get(card.id);
      if (!updated) continue;
      nextVisible.push(updated);
      used.add(updated.id);
    }

    for (const card of incoming) {
      if (nextVisible.length >= visibleLimit) break;
      if (used.has(card.id)) continue;
      nextVisible.push(card);
      used.add(card.id);
    }

    const nextQueued = incoming.filter((card) => !used.has(card.id));
    applyLayout(nextVisible, nextQueued);
  }, [onRefreshCards, applyLayout, visibleLimit]);

  const wait = useCallback((ms: number) => new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  }), []);

  const resolveCard = useCallback(async (cardId: string) => {
    dismissedCardIdsRef.current.add(cardId);
    syncLockedRef.current = true;
    setCardStates((prev) => ({ ...prev, [cardId]: 'resolved' }));
    await wait(RESOLVE_ANIMATION_MS);

    const currentVisible = visibleCardsRef.current;
    const currentQueued = queuedCardsRef.current;

    let nextVisible = currentVisible.filter((card) => card.id !== cardId);
    let nextQueued = [...currentQueued];
    if (nextVisible.length < visibleLimit && nextQueued.length > 0) {
      const promoted = nextQueued.shift() as LitoActionCard;
      nextVisible = [...nextVisible, promoted];
    }

    applyLayout(nextVisible, nextQueued);
    setCardStates((prev) => {
      const next = { ...prev };
      delete next[cardId];
      return next;
    });

    await refreshAfterResolve(nextVisible);
    syncLockedRef.current = false;
  }, [wait, visibleLimit, applyLayout, refreshAfterResolve]);

  const handleAction = useCallback(async (card: LitoActionCard, cta: ActionCardCta) => {
    if (cardStates[card.id] === 'loading' || cardStates[card.id] === 'resolved') return;
    setCardStates((prev) => ({ ...prev, [card.id]: 'loading' }));

    try {
      const result = await onAction(card, cta);
      if (result.resolved) {
        await resolveCard(card.id);
        return;
      }
      setCardStates((prev) => ({ ...prev, [card.id]: 'idle' }));
    } catch {
      setCardStates((prev) => ({ ...prev, [card.id]: 'idle' }));
    }
  }, [cardStates, onAction, resolveCard]);

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
          {shouldShowQueue ? (
            <button type="button" className="lito-view-all" onClick={onOpenQueue}>
              {viewAllLabel} ({displayQueueCount})
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
            <div
              key={card.id}
              className={`lito-action-item state-${cardStates[card.id] || 'idle'}`}
            >
              <ActionCard
                card={card}
                busy={cardBusy(card)}
                onAction={(nextCard, cta) => {
                  void handleAction(nextCard, cta);
                }}
              />
            </div>
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
