'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ActionCard, ActionCardMode } from '@/types/lito-cards';

export type ActionCardsSource = 'cache' | 'stale' | 'empty';

type ActionCardsResponse = {
  ok?: boolean;
  generated_at?: string;
  mode?: ActionCardMode;
  cards?: ActionCard[];
  queue_count?: number;
  source?: ActionCardsSource;
  error?: string;
  message?: string;
};

type UseActionCardsInput = {
  bizId: string | null;
};

type UseActionCardsResult = {
  cards: ActionCard[];
  mode: ActionCardMode;
  queueCount: number;
  generatedAt: string | null;
  source: ActionCardsSource;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

function createClientRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const POLL_EVERY_MS = 2_000;
const POLL_MAX_MS = 20_000;

export function useActionCards(input: UseActionCardsInput): UseActionCardsResult {
  const { bizId } = input;

  const [cards, setCards] = useState<ActionCard[]>([]);
  const [mode, setMode] = useState<ActionCardMode>('basic');
  const [queueCount, setQueueCount] = useState(0);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [source, setSource] = useState<ActionCardsSource>('empty');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pollStartedAtRef = useRef<number | null>(null);

  const fetchCards = useCallback(
    async (silent = false): Promise<void> => {
      if (!bizId) {
        setCards([]);
        setQueueCount(0);
        setGeneratedAt(null);
        setMode('basic');
        setSource('empty');
        setError(null);
        setLoading(false);
        return;
      }

      if (!silent) {
        setLoading(true);
      }

      try {
        const response = await fetch(`/api/lito/action-cards?biz_id=${encodeURIComponent(bizId)}`, {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-store',
            'x-request-id': createClientRequestId(),
          },
        });

        const payload = (await response.json().catch(() => ({}))) as ActionCardsResponse;

        if (!response.ok || !payload.ok) {
          throw new Error(payload.message || payload.error || 'action_cards_request_failed');
        }

        setCards(Array.isArray(payload.cards) ? payload.cards : []);
        setQueueCount(Number.isFinite(payload.queue_count) ? Number(payload.queue_count) : 0);
        setMode(payload.mode === 'advanced' ? 'advanced' : 'basic');
        setGeneratedAt(payload.generated_at || null);
        setSource(payload.source === 'stale' ? 'stale' : payload.source === 'cache' ? 'cache' : 'empty');
        setError(null);
      } catch (fetchError) {
        setError(fetchError instanceof Error ? fetchError.message : 'action_cards_request_failed');
      } finally {
        setLoading(false);
      }
    },
    [bizId],
  );

  useEffect(() => {
    void fetchCards(false);
  }, [fetchCards]);

  useEffect(() => {
    if (!bizId) return;
    if (source !== 'empty' && source !== 'stale') {
      pollStartedAtRef.current = null;
      return;
    }

    if (!pollStartedAtRef.current) {
      pollStartedAtRef.current = Date.now();
    }

    const timer = window.setInterval(() => {
      const startedAt = pollStartedAtRef.current || Date.now();
      if (Date.now() - startedAt > POLL_MAX_MS) {
        window.clearInterval(timer);
        return;
      }
      void fetchCards(true);
    }, POLL_EVERY_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [bizId, source, fetchCards]);

  const refresh = useCallback(async () => {
    await fetchCards(false);
  }, [fetchCards]);

  return useMemo(
    () => ({
      cards,
      mode,
      queueCount,
      generatedAt,
      source,
      loading,
      error,
      refresh,
    }),
    [cards, mode, queueCount, generatedAt, source, loading, error, refresh],
  );
}
