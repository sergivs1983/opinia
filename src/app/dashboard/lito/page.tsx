'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import {
  LITOGreeting,
  LITOEmpty,
  LITOLoading,
  LITOError,
  LITORateLimited,
  StaleBanner,
} from '@/components/lito/states/LITOStates';
import { useToast } from '@/components/ui/Toast';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { tokens, cx } from '@/lib/design/tokens';
import type { ActionCard } from '@/types/lito-cards';

type ActionCardsSource = 'cache' | 'stale' | 'empty';

type ActionCardsResponse = {
  ok?: boolean;
  cards?: ActionCard[];
  source?: ActionCardsSource;
  mode?: 'basic' | 'advanced';
  queue_count?: number;
  message?: string;
  code?: string;
  resets_at?: string;
  retry_after?: number;
};

type GuardrailFetchError = Error & {
  status?: number;
  code?: string;
  resets_at?: string;
  retry_after?: number;
};

type ThreadMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

type RateLimitState = {
  variant: 'rate' | 'cap';
  resetsAt?: string;
};

type CommandSubmitDetail = {
  message?: string;
};

type CommandPrefillDetail = {
  value?: string;
};

const LAST_BIZ_STORAGE_KEY = 'opinia.lito.last_biz_id';

function createClientRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readLastBizId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(LAST_BIZ_STORAGE_KEY);
    return value?.trim() || null;
  } catch {
    return null;
  }
}

function writeLastBizId(value: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LAST_BIZ_STORAGE_KEY, value);
  } catch {
    // Ignore storage errors.
  }
}

function toFetchError(status: number, payload: Record<string, unknown>): GuardrailFetchError {
  const message = typeof payload.message === 'string' ? payload.message : `request_failed_${status}`;
  const error = new Error(message) as GuardrailFetchError;
  error.status = status;
  error.code = typeof payload.code === 'string' ? payload.code : undefined;
  error.resets_at = typeof payload.resets_at === 'string' ? payload.resets_at : undefined;
  error.retry_after = typeof payload.retry_after === 'number' ? payload.retry_after : undefined;
  return error;
}

const fetchActionCards = async (url: string): Promise<ActionCardsResponse> => {
  const response = await fetch(url, {
    cache: 'no-store',
    headers: { 'Cache-Control': 'no-store' },
  });

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok || payload.ok === false) {
    throw toFetchError(response.status, payload);
  }

  return {
    ok: true,
    cards: Array.isArray(payload.cards) ? (payload.cards as ActionCard[]) : [],
    source: payload.source === 'stale' ? 'stale' : payload.source === 'cache' ? 'cache' : 'empty',
    mode: payload.mode === 'advanced' ? 'advanced' : 'basic',
    queue_count: typeof payload.queue_count === 'number' ? payload.queue_count : 0,
  };
};

type LocalSWRConfig = {
  refreshInterval?: number;
  revalidateOnFocus?: boolean;
};

function useSWR<T>(
  key: string | null,
  fetcher: (input: string) => Promise<T>,
  config: LocalSWRConfig = {},
): {
  data: T | undefined;
  error: unknown;
  isLoading: boolean;
  mutate: () => Promise<void>;
} {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const requestSeqRef = useRef(0);

  const runFetch = useCallback(async () => {
    if (!key) {
      setData(undefined);
      setError(undefined);
      setIsLoading(false);
      return;
    }

    const seq = ++requestSeqRef.current;
    setIsLoading(true);

    try {
      const nextData = await fetcher(key);
      if (seq !== requestSeqRef.current) return;
      setData(nextData);
      setError(undefined);
    } catch (fetchError) {
      if (seq !== requestSeqRef.current) return;
      setError(fetchError);
    } finally {
      if (seq === requestSeqRef.current) {
        setIsLoading(false);
      }
    }
  }, [key, fetcher]);

  useEffect(() => {
    void runFetch();
  }, [runFetch]);

  useEffect(() => {
    if (!key || !config.refreshInterval) return;
    const timer = window.setInterval(() => {
      void runFetch();
    }, config.refreshInterval);
    return () => window.clearInterval(timer);
  }, [config.refreshInterval, key, runFetch]);

  useEffect(() => {
    if (!key || !config.revalidateOnFocus) return;
    const onFocus = () => {
      void runFetch();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [config.revalidateOnFocus, key, runFetch]);

  const mutate = useCallback(async () => {
    await runFetch();
  }, [runFetch]);

  return { data, error, isLoading, mutate };
}

type StreamHandlers = {
  onToken: (delta: string) => void;
  onDone: (text: string) => void;
};

async function consumeChatStream(response: Response, handlers: StreamHandlers): Promise<void> {
  const body = response.body;
  if (!body) return;

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    let delimiter = buffer.indexOf('\n\n');
    while (delimiter >= 0) {
      const rawEvent = buffer.slice(0, delimiter);
      buffer = buffer.slice(delimiter + 2);

      const lines = rawEvent.split(/\r?\n/).filter(Boolean);
      let eventName = 'message';
      const dataLines: string[] = [];

      for (const line of lines) {
        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim() || 'message';
          continue;
        }
        if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart());
        }
      }

      const rawData = dataLines.join('\n');
      if (rawData.length > 0) {
        let parsed: Record<string, unknown> = {};
        try {
          parsed = JSON.parse(rawData) as Record<string, unknown>;
        } catch {
          parsed = {};
        }

        if (eventName === 'token') {
          const delta = typeof parsed.delta === 'string' ? parsed.delta : typeof parsed.token === 'string' ? parsed.token : '';
          if (delta) handlers.onToken(delta);
        }

        if (eventName === 'done') {
          const text = typeof parsed.text === 'string' ? parsed.text : '';
          handlers.onDone(text);
        }

        if (eventName === 'error') {
          const message = typeof parsed.message === 'string' ? parsed.message : 'chat_stream_failed';
          throw new Error(message);
        }
      }

      delimiter = buffer.indexOf('\n\n');
    }
  }
}

function ActionCardItem({ card, onResolve }: { card: ActionCard; onResolve: (cardId: string, action: string) => void }) {
  const [resolvingAction, setResolvingAction] = useState<string | null>(null);
  const isUrgent = card.priority >= 80;

  const triggerAction = useCallback(
    (action: string) => {
      if (resolvingAction) return;
      setResolvingAction(action);
      window.setTimeout(() => {
        onResolve(card.id, action);
      }, 180);
    },
    [card.id, onResolve, resolvingAction],
  );

  return (
    <article
      className={cx(
        'p-4',
        tokens.bg.surface,
        tokens.border.default,
        tokens.radius.card,
        tokens.shadow.card,
        tokens.shadow.hover,
        tokens.anim.enter,
        isUrgent && tokens.border.urgent,
        resolvingAction === card.secondary_cta?.action && tokens.anim.snooze,
        resolvingAction && resolvingAction !== card.secondary_cta?.action && tokens.anim.resolve,
      )}
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <p className={cx(tokens.text.cardTitle, tokens.text.primary)}>{card.title}</p>
        <span className={cx(tokens.badge.base, isUrgent ? tokens.badge.urgent : tokens.badge.neutral)}>{card.priority}</span>
      </div>

      {card.subtitle ? <p className={cx('mb-4', tokens.text.cardSub, tokens.text.secondary)}>{card.subtitle}</p> : null}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => triggerAction(card.primary_cta.action)} className={tokens.button.primary} disabled={Boolean(resolvingAction)}>
          {card.primary_cta.label}
        </button>

        {card.secondary_cta ? (
          <button
            type="button"
            onClick={() => triggerAction(card.secondary_cta?.action || '')}
            className={tokens.button.secondary}
            disabled={Boolean(resolvingAction)}
          >
            {card.secondary_cta.label}
          </button>
        ) : null}
      </div>
    </article>
  );
}

function ActionCardStack({ cards, onResolve }: { cards: ActionCard[]; onResolve: (cardId: string, action: string) => void }) {
  const [showAll, setShowAll] = useState(false);
  const visibleCards = showAll ? cards : cards.slice(0, 2);
  const hiddenCount = Math.max(0, cards.length - visibleCards.length);

  return (
    <section className="space-y-3">
      {visibleCards.map((card) => (
        <ActionCardItem key={card.id} card={card} onResolve={onResolve} />
      ))}

      {hiddenCount > 0 ? (
        <button type="button" className={cx('w-full py-2 text-center', tokens.text.tiny, tokens.text.secondary)} onClick={() => setShowAll(true)}>
          Veure tot · {hiddenCount} mes
        </button>
      ) : null}
    </section>
  );
}

function ChatThread({ messages }: { messages: ThreadMessage[] }) {
  if (messages.length === 0) return null;

  return (
    <section className="mt-6 space-y-3 pb-1">
      <div className={tokens.border.divider} />
      {messages.map((message) => (
        <div key={message.id} className={message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
          <div
            className={cx(
              'max-w-[86%] px-3.5 py-2.5',
              tokens.radius.bubble,
              tokens.text.cardSub,
              message.role === 'user'
                ? cx(tokens.bg.userBubble, tokens.text.inverse)
                : cx(tokens.bg.assistantBubble, tokens.border.default, tokens.text.primary),
            )}
          >
            {message.content || '...'}
          </div>
        </div>
      ))}
    </section>
  );
}

export default function DashboardLitoPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { biz, businesses, switchBiz, loading: workspaceLoading } = useWorkspace();

  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [resolvedCards, setResolvedCards] = useState<Set<string>>(new Set());
  const [chatRateLimit, setChatRateLimit] = useState<RateLimitState | null>(null);

  useEffect(() => {
    if (workspaceLoading) return;
    if (businesses.length === 0) return;

    const queryBizId = (searchParams?.get('biz_id') || '').trim();
    const storedBizId = readLastBizId();
    const allowedBizIds = new Set(businesses.map((entry) => entry.id));

    let targetBizId: string | null = null;
    if (queryBizId && allowedBizIds.has(queryBizId)) {
      targetBizId = queryBizId;
    } else if (storedBizId && allowedBizIds.has(storedBizId)) {
      targetBizId = storedBizId;
    } else {
      targetBizId = businesses[0]?.id || null;
    }

    if (!targetBizId) return;

    if (biz?.id !== targetBizId) {
      switchBiz(targetBizId);
    }

    writeLastBizId(targetBizId);

    if (queryBizId !== targetBizId) {
      const params = new URLSearchParams(searchParams?.toString() || '');
      params.set('biz_id', targetBizId);
      router.replace(`/dashboard/lito?${params.toString()}`);
    }
  }, [workspaceLoading, businesses, searchParams, biz?.id, switchBiz, router]);

  const activeBizId = biz?.id || null;

  const { data, error, isLoading, mutate } = useSWR<ActionCardsResponse>(
    activeBizId ? `/api/lito/action-cards?biz_id=${encodeURIComponent(activeBizId)}` : null,
    fetchActionCards,
    {
      refreshInterval: 30_000,
      revalidateOnFocus: true,
    },
  );

  useEffect(() => {
    setResolvedCards(new Set());
    setMessages([]);
    setChatRateLimit(null);
  }, [activeBizId]);

  const cards = useMemo(() => data?.cards || [], [data?.cards]);

  const visibleCards = useMemo(
    () => cards.filter((card) => !resolvedCards.has(card.id)),
    [cards, resolvedCards],
  );

  const priorityLine = useMemo(() => {
    if (visibleCards.length === 0) return null;
    const urgentCount = visibleCards.filter((card) => card.priority >= 80).length;
    if (urgentCount > 0) {
      return `Tens ${urgentCount} prioritat${urgentCount > 1 ? 's' : ''} urgent${urgentCount > 1 ? 's' : ''}.`;
    }
    return `Tens ${visibleCards.length} accio${visibleCards.length > 1 ? 'ns' : ''} pendent${visibleCards.length > 1 ? 's' : ''}.`;
  }, [visibleCards]);

  const applyAssistantText = useCallback((assistantId: string, next: string | ((prev: string) => string)) => {
    setMessages((prev) =>
      prev.map((entry) => {
        if (entry.id !== assistantId) return entry;
        const content = typeof next === 'function' ? next(entry.content) : next;
        return { ...entry, content };
      }),
    );
  }, []);

  const prefillCommand = useCallback((value: string) => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent<CommandPrefillDetail>('lito:command-prefill', {
      detail: { value },
    }));
  }, []);

  const handleResolve = useCallback(
    (cardId: string, action: string) => {
      setResolvedCards((prev) => {
        const next = new Set(prev);
        next.add(cardId);
        return next;
      });

      if (action === 'open_weekly_wizard') {
        prefillCommand('Prepara la setmana amb 3 posts.');
      }

      // Endpoint de resolve no disponible en aquest refactor UI.
      // Mantenim UX optimista i refresquem la llista existent.
      void mutate();
    },
    [mutate, prefillCommand],
  );

  const submitChatMessage = useCallback(async (rawMessage: string) => {
    const message = rawMessage.trim();
    if (!message || streaming) return;

    if (!activeBizId) {
      toast('Selecciona un negoci per continuar.', 'warning');
      return;
    }

    setChatRateLimit(null);

    const assistantId = createClientRequestId();
    setMessages((prev) => [
      ...prev,
      { id: createClientRequestId(), role: 'user', content: message },
      { id: assistantId, role: 'assistant', content: '' },
    ]);

    setStreaming(true);

    try {
      const response = await fetch('/api/lito/chat', {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'Cache-Control': 'no-store',
          'x-request-id': createClientRequestId(),
        },
        body: JSON.stringify({
          biz_id: activeBizId,
          message,
          mode: 'chat',
        }),
      });

      if (response.status === 429 || response.status === 402) {
        const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        const code = typeof payload.code === 'string' ? payload.code : '';
        const statusMessage = typeof payload.message === 'string' ? payload.message : `Error ${response.status}`;
        const resetsAt = typeof payload.resets_at === 'string' ? payload.resets_at : undefined;
        setChatRateLimit({
          variant: code === 'orchestrator_cap_reached' ? 'cap' : 'rate',
          resetsAt,
        });
        applyAssistantText(assistantId, statusMessage);
        return;
      }

      if (!response.ok || !response.body) {
        throw new Error(`chat_failed_${response.status}`);
      }

      await consumeChatStream(response, {
        onToken: (delta) => {
          applyAssistantText(assistantId, (current) => `${current}${delta}`);
        },
        onDone: (text) => {
          if (text.trim().length > 0) {
            applyAssistantText(assistantId, text);
          }
        },
      });
    } catch {
      applyAssistantText(assistantId, 'No he pogut completar la resposta ara mateix.');
      toast('No he pogut completar la resposta.', 'error');
    } finally {
      setStreaming(false);
    }
  }, [streaming, activeBizId, toast, applyAssistantText]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<CommandSubmitDetail>).detail;
      if (!detail || typeof detail.message !== 'string') return;
      void submitChatMessage(detail.message);
    };
    window.addEventListener('lito:command-submit', listener as EventListener);
    return () => window.removeEventListener('lito:command-submit', listener as EventListener);
  }, [submitChatMessage]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('lito:command-disabled', {
      detail: { disabled: !activeBizId || streaming },
    }));
  }, [activeBizId, streaming]);

  const cardsError = error as GuardrailFetchError | undefined;

  const cardsRateLimit: RateLimitState | null = useMemo(() => {
    if (!cardsError) return null;
    if (cardsError.status !== 429 && cardsError.status !== 402) return null;
    return {
      variant: cardsError.code === 'orchestrator_cap_reached' ? 'cap' : 'rate',
      resetsAt: cardsError.resets_at,
    };
  }, [cardsError]);

  const activeRateLimit = chatRateLimit || cardsRateLimit;
  const showCardsError = Boolean(cardsError) && !cardsRateLimit;

  return (
    <>
      <LITOGreeting priorityLine={priorityLine} />

      {!activeBizId ? (
        <article className={cx('p-5', tokens.bg.surface, tokens.border.default, tokens.radius.card, tokens.shadow.card)}>
          <p className={cx(tokens.text.cardTitle, tokens.text.primary)}>Selecciona un negoci per continuar.</p>
          <p className={cx('mt-1', tokens.text.cardSub, tokens.text.secondary)}>
            Si tens mes d un negoci, canvia el context des del selector del dashboard.
          </p>
        </article>
      ) : null}

      {activeBizId ? (
        <section>
          {activeRateLimit ? <LITORateLimited variant={activeRateLimit.variant} resetsAt={activeRateLimit.resetsAt} /> : null}

          {!activeRateLimit && showCardsError ? <LITOError onRetry={() => void mutate()} /> : null}

          {!activeRateLimit && !showCardsError && isLoading ? <LITOLoading /> : null}

          {!activeRateLimit && !showCardsError && !isLoading ? (
            <>
              {data?.source === 'stale' ? <StaleBanner /> : null}

              {visibleCards.length === 0 ? (
                <LITOEmpty
                  onPrepareWeek={() => prefillCommand('Prepara la setmana.')}
                  onViewReviews={() => prefillCommand('Revisa ressenyes pendents.')}
                />
              ) : (
                <ActionCardStack cards={visibleCards} onResolve={handleResolve} />
              )}
            </>
          ) : null}
        </section>
      ) : null}

      <ChatThread messages={messages} />
    </>
  );
}
