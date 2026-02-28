'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useT } from '@/components/i18n/I18nContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useToast } from '@/components/ui/Toast';
import Button from '@/components/ui/Button';
import GlassCard from '@/components/ui/GlassCard';
import LitoContextPanel from '@/components/lito/LitoContextPanel';
import LitoWorkbenchPane from '@/components/lito/LitoWorkbenchPane';
import { buildFallbackRecommendation } from '@/components/lito/recommendation-fallback';
import { cn } from '@/lib/utils';
import { textMain, textSub } from '@/components/ui/glass';
import type {
  LitoQuotaState,
  LitoRecommendationItem,
  LitoRecommendationTemplate,
  LitoThreadItem,
  LitoThreadMessage,
  LitoViewerRole,
} from '@/components/lito/types';

// ── D1.3 Signals ─────────────────────────────────────────────────────────────
type SignalType = 'alert' | 'opportunity' | 'evergreen';
type SignalSeverity = 'high' | 'med' | 'low';

type SignalCard = {
  id: string;
  type: SignalType;
  title: string;
  reason: string;
  severity: SignalSeverity;
  cta_label: string;
  action: { kind: 'open_thread'; recommendation_id?: string };
};

type SignalsPayload = {
  ok?: boolean;
  signals?: SignalCard[];
  error?: string;
  message?: string;
};

// ─────────────────────────────────────────────────────────────────────────────

type WeeklyRecommendationsPayload = {
  items?: Array<Partial<LitoRecommendationItem> & { recommendation_template?: LitoRecommendationTemplate }>;
  viewer_role?: LitoViewerRole;
  error?: string;
  message?: string;
};

type ThreadsPayload = {
  threads?: LitoThreadItem[];
  error?: string;
  message?: string;
};

type ThreadDetailPayload = {
  thread?: LitoThreadItem;
  messages?: LitoThreadMessage[];
  error?: string;
  message?: string;
};

type ThreadCreatePayload = {
  thread?: LitoThreadItem;
  error?: string;
  message?: string;
};

type RecommendationFeedbackPayload = {
  ok?: boolean;
  error?: string;
  message?: string;
};

type GoogleStatusPayload = {
  state?: 'connected' | 'needs_reauth' | 'not_connected';
};

function normalizeRecommendationItem(
  item: Partial<LitoRecommendationItem> & { recommendation_template?: LitoRecommendationTemplate },
): LitoRecommendationItem | null {
  if (!item.id) return null;
  const template = item.recommendation_template;
  return {
    id: item.id,
    rule_id: item.rule_id || '',
    status: item.status || 'shown',
    source: item.source === 'signal' ? 'signal' : item.source === 'evergreen' ? 'evergreen' : undefined,
    vertical: item.vertical || undefined,
    format: item.format || template?.format || 'post',
    hook: item.hook || template?.hook || '',
    idea: item.idea || template?.idea || '',
    cta: item.cta || template?.cta || '',
    how_to: item.how_to || template?.how_to,
    signal_meta: item.signal_meta || template?.signal,
    language: item.language || template?.language,
    recommendation_template: template,
  };
}

function normalizeFormat(value: string | null | undefined): 'post' | 'story' | 'reel' {
  if (value === 'story' || value === 'reel') return value;
  return 'post';
}

function sanitizeMessages(messages: LitoThreadMessage[]): LitoThreadMessage[] {
  return messages.filter((item) => {
    if (item.role === 'system') return false;
    const normalized = item.content.toLowerCase();
    if (normalized.includes('context:')) return false;
    if (normalized.includes('system prompt')) return false;
    if (normalized.includes('payload intern')) return false;
    if (normalized.includes('debug:')) return false;
    return true;
  });
}

function formatThreadDate(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return '';
  return new Date(parsed).toLocaleString('ca-ES', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

type LitoCommandCenterProps = {
  embedded?: boolean;
  className?: string;
};

export default function LitoCommandCenter({ embedded = false, className }: LitoCommandCenterProps) {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { biz, businesses, switchBiz } = useWorkspace();

  const [weeklyRecommendations, setWeeklyRecommendations] = useState<LitoRecommendationItem[]>([]);
  const [weeklyLoading, setWeeklyLoading] = useState(false);
  const [weeklyViewerRole, setWeeklyViewerRole] = useState<LitoViewerRole>(null);

  const [threads, setThreads] = useState<LitoThreadItem[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [activeThread, setActiveThread] = useState<LitoThreadItem | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<LitoThreadMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);

  const [signals, setSignals] = useState<SignalCard[]>([]);
  const [signalsLoading, setSignalsLoading] = useState(false);

  const [gbpState, setGbpState] = useState<'connected' | 'needs_reauth' | 'not_connected' | 'unknown'>('unknown');
  const [quota, setQuota] = useState<LitoQuotaState | null>(null);
  const [selectedFormat, setSelectedFormat] = useState<'post' | 'story' | 'reel'>('post');

  const bootstrapRef = useRef<string | null>(null);

  const queryBizId = embedded ? null : searchParams.get('biz_id');
  const queryRecommendationId = embedded ? null : searchParams.get('recommendation_id');
  const queryThreadId = embedded ? null : searchParams.get('thread_id');

  const activeRecommendation = useMemo(() => {
    const recommendationId = activeThread?.recommendation_id || queryRecommendationId;
    if (!recommendationId) return null;
    const fromWeekly = weeklyRecommendations.find((item) => item.id === recommendationId);
    if (fromWeekly) return fromWeekly;
    if (!activeThread || activeThread.recommendation_id !== recommendationId) return null;
    return buildFallbackRecommendation({
      thread: activeThread,
      recommendationId,
      selectedFormat,
      defaultTitle: t('dashboard.home.recommendations.lito.defaultTitle'),
    });
  }, [activeThread, queryRecommendationId, selectedFormat, t, weeklyRecommendations]);

  const selectedRecommendationId = activeRecommendation?.id || null;

  /** 3 cards: 1 alert (highest severity) + up to 2 opportunities/evergreen */
  const displaySignals = useMemo(() => {
    const alerts = signals.filter((s) => s.type === 'alert');
    const others = signals.filter((s) => s.type !== 'alert');
    const result: SignalCard[] = [];
    if (alerts.length > 0) {
      const top =
        alerts.find((a) => a.severity === 'high') ??
        alerts.find((a) => a.severity === 'med') ??
        alerts[0];
      result.push(top);
    }
    for (const s of others) {
      if (result.length >= 3) break;
      result.push(s);
    }
    return result;
  }, [signals]);
  const previewMessages = useMemo(() => sanitizeMessages(messages).slice(-10), [messages]);

  const replaceQuery = useCallback((next: { bizId?: string | null; recommendationId?: string | null; threadId?: string | null }) => {
    if (embedded) return;
    const params = new URLSearchParams(searchParams.toString());
    if (next.bizId) params.set('biz_id', next.bizId);
    else params.delete('biz_id');
    if (next.recommendationId) params.set('recommendation_id', next.recommendationId);
    else params.delete('recommendation_id');
    if (next.threadId) params.set('thread_id', next.threadId);
    else params.delete('thread_id');
    const qs = params.toString();
    const basePath = '/dashboard/lito';
    router.replace(qs ? `${basePath}?${qs}` : basePath);
  }, [embedded, router, searchParams]);

  const openChatView = useCallback(() => {
    if (!biz?.id || !activeThreadId) return;
    const params = new URLSearchParams();
    params.set('biz_id', biz.id);
    params.set('thread_id', activeThreadId);
    if (activeThread?.recommendation_id) {
      params.set('recommendation_id', activeThread.recommendation_id);
    }
    router.push(`/dashboard/lito/chat?${params.toString()}`);
  }, [activeThread?.recommendation_id, activeThreadId, biz?.id, router]);

  const loadWeeklyRecommendations = useCallback(async () => {
    if (!biz?.id) return;
    setWeeklyLoading(true);
    try {
      const response = await fetch(`/api/recommendations/weekly?biz_id=${biz.id}`);
      const payload = (await response.json().catch(() => ({}))) as WeeklyRecommendationsPayload;
      if (!response.ok || payload.error) {
        throw new Error(payload.message || t('dashboard.home.recommendations.loadError'));
      }

      setWeeklyViewerRole(payload.viewer_role || null);
      setWeeklyRecommendations(
        (payload.items || [])
          .map((item) => normalizeRecommendationItem(item))
          .filter((item): item is LitoRecommendationItem => Boolean(item)),
      );
    } catch (error) {
      setWeeklyViewerRole(null);
      setWeeklyRecommendations([]);
      const message = error instanceof Error ? error.message : t('dashboard.home.recommendations.loadError');
      toast(message, 'error');
    } finally {
      setWeeklyLoading(false);
    }
  }, [biz?.id, t, toast]);

  const loadGoogleStatus = useCallback(async () => {
    if (!biz?.id) return;
    try {
      const response = await fetch(`/api/integrations/google/status?biz_id=${biz.id}`);
      if (!response.ok) {
        setGbpState('unknown');
        return;
      }
      const payload = (await response.json().catch(() => ({}))) as GoogleStatusPayload;
      if (payload.state === 'connected' || payload.state === 'needs_reauth' || payload.state === 'not_connected') {
        setGbpState(payload.state);
      } else {
        setGbpState('unknown');
      }
    } catch {
      setGbpState('unknown');
    }
  }, [biz?.id]);

  const loadSignals = useCallback(async () => {
    if (!biz?.id) return;
    setSignalsLoading(true);
    try {
      const response = await fetch(`/api/lito/signals?biz_id=${biz.id}`);
      const payload = (await response.json().catch(() => ({}))) as SignalsPayload;
      if (!response.ok || payload.error) {
        // Signals are non-critical: silently fallback to empty
        setSignals([]);
        return;
      }
      setSignals(payload.signals || []);
    } catch {
      setSignals([]);
    } finally {
      setSignalsLoading(false);
    }
  }, [biz?.id]);

  const loadThreads = useCallback(async () => {
    if (!biz?.id) return;
    setThreadsLoading(true);
    try {
      const response = await fetch(`/api/lito/threads?biz_id=${biz.id}&limit=20`);
      const payload = (await response.json().catch(() => ({}))) as ThreadsPayload;
      if (!response.ok || payload.error) {
        throw new Error(payload.message || t('dashboard.home.recommendations.lito.loadError'));
      }
      setThreads(payload.threads || []);
    } catch (error) {
      const message = error instanceof Error ? error.message : t('dashboard.home.recommendations.lito.loadError');
      toast(message, 'error');
      setThreads([]);
    } finally {
      setThreadsLoading(false);
    }
  }, [biz?.id, t, toast]);

  const loadThreadDetail = useCallback(async (threadId: string) => {
    setMessagesLoading(true);
    try {
      const response = await fetch(`/api/lito/messages?thread_id=${threadId}&limit=10`);
      const payload = (await response.json().catch(() => ({}))) as ThreadDetailPayload;
      if (!response.ok || payload.error || !payload.thread) {
        throw new Error(payload.message || t('dashboard.home.recommendations.lito.loadError'));
      }
      setActiveThread(payload.thread);
      setMessages(payload.messages || []);
      if (payload.thread.recommendation_id) {
        const recommendation = weeklyRecommendations.find((item) => item.id === payload.thread?.recommendation_id);
        if (recommendation) setSelectedFormat(normalizeFormat(recommendation.format));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : t('dashboard.home.recommendations.lito.loadError');
      toast(message, 'error');
      setActiveThread(null);
      setMessages([]);
    } finally {
      setMessagesLoading(false);
    }
  }, [t, toast, weeklyRecommendations]);

  const openOrCreateThread = useCallback(async (options: {
    recommendationId?: string | null;
    title?: string | null;
    format?: 'post' | 'story' | 'reel' | null;
    hook?: string | null;
  }) => {
    if (!biz?.id) return null;
    try {
      const response = await fetch('/api/lito/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          biz_id: biz.id,
          recommendation_id: options.recommendationId ?? null,
          title: options.title ?? null,
          format: options.format ?? null,
          hook: options.hook ?? null,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as ThreadCreatePayload;
      if (!response.ok || payload.error || !payload.thread) {
        throw new Error(payload.message || t('dashboard.home.recommendations.lito.openError'));
      }

      const thread = payload.thread;
      setThreads((previous) => {
        const merged = [thread, ...previous.filter((item) => item.id !== thread.id)];
        return merged.slice(0, 20);
      });
      setActiveThreadId(thread.id);
      setActiveThread(thread);
      setMessages([]);
      replaceQuery({
        bizId: biz.id,
        recommendationId: thread.recommendation_id,
        threadId: thread.id,
      });
      return thread;
    } catch (error) {
      const message = error instanceof Error ? error.message : t('dashboard.home.recommendations.lito.openError');
      toast(message, 'error');
      return null;
    }
  }, [biz?.id, replaceQuery, t, toast]);

  const openGeneralThread = useCallback(async () => {
    await openOrCreateThread({
      recommendationId: null,
    });
  }, [openOrCreateThread]);

  const openThreadForRecommendation = useCallback(async (recommendation: LitoRecommendationItem) => {
    setSelectedFormat(normalizeFormat(recommendation.format));
    const thread = await openOrCreateThread({
      recommendationId: recommendation.id,
      format: recommendation.format === 'story' || recommendation.format === 'reel' ? recommendation.format : 'post',
      hook: recommendation.hook || null,
    });
    if (!thread || !biz?.id) return;

    const params = new URLSearchParams();
    params.set('biz_id', biz.id);
    params.set('thread_id', thread.id);
    if (thread.recommendation_id) params.set('recommendation_id', thread.recommendation_id);
    router.push(`/dashboard/lito/chat?${params.toString()}`);
  }, [biz?.id, openOrCreateThread, router]);

  const handleMarkPublished = useCallback(async (recommendationId: string) => {
    const response = await fetch(`/api/recommendations/${recommendationId}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'published' }),
    });
    const payload = (await response.json().catch(() => ({}))) as RecommendationFeedbackPayload;
    if (!response.ok || payload.error) {
      throw new Error(payload.message || t('dashboard.home.recommendations.feedbackError'));
    }

    setWeeklyRecommendations((previous) => (
      previous.map((item) => (item.id === recommendationId ? { ...item, status: 'published' } : item))
    ));
    toast(t('dashboard.home.toasts.approveSuccess'), 'success');
  }, [t, toast]);

  useEffect(() => {
    if (!biz?.id) return;
    setQuota(null);
    setSignals([]);
    void loadWeeklyRecommendations();
    void loadThreads();
    void loadGoogleStatus();
    void loadSignals();
  }, [biz?.id, loadGoogleStatus, loadSignals, loadThreads, loadWeeklyRecommendations]);

  useEffect(() => {
    if (!biz?.id || !queryBizId) return;
    if (queryBizId === biz.id) return;
    if (businesses.some((item) => item.id === queryBizId)) {
      void switchBiz(queryBizId);
    }
  }, [biz?.id, businesses, queryBizId, switchBiz]);

  useEffect(() => {
    if (!biz?.id) return;
    if (bootstrapRef.current === biz.id) return;
    if (threadsLoading || weeklyLoading) return;

    bootstrapRef.current = biz.id;

    if (queryThreadId) {
      setActiveThreadId(queryThreadId);
      return;
    }

    if (queryRecommendationId) {
      const recommendation = weeklyRecommendations.find((item) => item.id === queryRecommendationId);
      void openOrCreateThread({
        recommendationId: queryRecommendationId,
        format: recommendation?.format === 'story' || recommendation?.format === 'reel' ? recommendation.format : 'post',
        hook: recommendation?.hook || null,
      });
      return;
    }

    if (threads.length > 0) {
      setActiveThreadId(threads[0].id);
      replaceQuery({ bizId: biz.id, recommendationId: threads[0].recommendation_id, threadId: threads[0].id });
      return;
    }

    void openGeneralThread();
  }, [
    biz?.id,
    openGeneralThread,
    openOrCreateThread,
    queryRecommendationId,
    queryThreadId,
    replaceQuery,
    t,
    threads,
    threadsLoading,
    weeklyLoading,
    weeklyRecommendations,
  ]);

  useEffect(() => {
    if (!activeThreadId) return;
    void loadThreadDetail(activeThreadId);
  }, [activeThreadId, loadThreadDetail]);

  if (!biz) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <GlassCard variant="strong" className="w-full max-w-xl p-8 text-center">
          <p className={cn('text-sm', textSub)}>{t('dashboard.metrics.selectBusiness')}</p>
          <Button className="mt-5" onClick={() => router.push('/dashboard')}>
            {t('dashboard.home.navHome')}
          </Button>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', className)} data-testid="dashboard-lito-page">
      <header className="flex flex-wrap items-start justify-between gap-3">
        {!embedded ? (
          <div>
            <h1 className={cn('text-2xl font-semibold tracking-tight', textMain)}>
              {t('dashboard.litoPage.title')}
            </h1>
            <p className={cn('mt-1 text-sm', textSub)}>{t('dashboard.litoPage.subtitle')}</p>
          </div>
        ) : (
          <div>
            <p className={cn('text-sm font-semibold tracking-wide', textMain)}>
              {t('dashboard.litoPage.title')}
            </p>
            <p className={cn('mt-1 text-xs', textSub)}>{t('dashboard.litoPage.subtitle')}</p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={biz.id}
            onChange={(event) => void switchBiz(event.target.value)}
            className="h-9 rounded-lg border border-white/10 bg-black/30 px-3 text-sm text-white outline-none transition-colors duration-200 ease-premium hover:border-white/20 focus:border-emerald-300/35"
          >
            {businesses.map((entry) => (
              <option key={entry.id} value={entry.id} className="bg-zinc-900 text-white">
                {entry.name}
              </option>
            ))}
          </select>
          <Button variant="secondary" className="h-9 px-3 text-xs" onClick={() => void openGeneralThread()}>
            {t('dashboard.litoPage.context.askLito')}
          </Button>
        </div>
      </header>

      {/* ── D1.3 Signals strip ── */}
      {(signalsLoading || displaySignals.length > 0) && (
        <section aria-label="Signals PRO" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {signalsLoading
            ? Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="h-[88px] animate-pulse rounded-2xl border border-white/8 bg-white/4"
                />
              ))
            : displaySignals.map((signal) => {
                const isAlert = signal.type === 'alert';
                const isOpportunity = signal.type === 'opportunity';
                const severityBorder =
                  isAlert && signal.severity === 'high'
                    ? 'border-rose-500/40'
                    : isAlert && signal.severity === 'med'
                      ? 'border-amber-400/40'
                      : isOpportunity
                        ? 'border-emerald-400/35'
                        : 'border-white/10';
                const badgeClass =
                  isAlert && signal.severity === 'high'
                    ? 'bg-rose-500/20 text-rose-300'
                    : isAlert && signal.severity === 'med'
                      ? 'bg-amber-400/20 text-amber-200'
                      : isOpportunity
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-white/10 text-white/50';
                const badgeLabel =
                  signal.type === 'alert'
                    ? 'Alerta'
                    : signal.type === 'opportunity'
                      ? 'Oportunitat'
                      : 'Evergreen';

                const ctaParams = new URLSearchParams();
                ctaParams.set('biz_id', biz.id);
                ctaParams.set('signal_id', signal.id);
                if (signal.action.recommendation_id) {
                  ctaParams.set('recommendation_id', signal.action.recommendation_id);
                }
                const ctaHref = `/dashboard/lito/chat?${ctaParams.toString()}`;

                return (
                  <div
                    key={signal.id}
                    className={cn(
                      'flex flex-col justify-between gap-2 rounded-2xl border bg-zinc-900/50 px-4 py-3 backdrop-blur-sm',
                      severityBorder,
                    )}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', badgeClass)}>
                          {badgeLabel}
                        </span>
                      </div>
                      <p className={cn('mt-1.5 text-[13px] font-semibold leading-snug', textMain)}>
                        {signal.title}
                      </p>
                      <p className={cn('mt-0.5 line-clamp-2 text-[11px] leading-relaxed', textSub)}>
                        {signal.reason}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => router.push(ctaHref)}
                      className="self-start rounded-lg bg-white/8 px-2.5 py-1 text-[11px] font-medium text-white/80 transition-colors hover:bg-white/14 hover:text-white"
                    >
                      {signal.cta_label}
                    </button>
                  </div>
                );
              })}
        </section>
      )}

      <div className="grid gap-4 2xl:grid-cols-[300px_minmax(0,1fr)_420px]">
        <LitoContextPanel
          t={t}
          businessName={biz.name}
          businessVertical={biz.type || 'general'}
          businessLanguage={biz.default_language || 'ca'}
          gbpState={gbpState}
          viewerRole={weeklyViewerRole}
          recommendations={weeklyRecommendations}
          recommendationsLoading={weeklyLoading}
          quota={quota}
          selectedRecommendationId={selectedRecommendationId}
          onOpenGeneral={() => void openGeneralThread()}
          onSelectRecommendation={(item) => void openThreadForRecommendation(item)}
        />

        <section className="flex min-h-[70vh] flex-col rounded-2xl border border-white/10 bg-zinc-900/45 backdrop-blur-md">
          <header className="border-b border-white/10 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className={cn('text-sm font-semibold tracking-wide', textMain)}>
                {t('dashboard.litoPage.command.threadPreviewTitle')}
              </h2>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" className="h-7 px-2.5 text-xs" onClick={() => void openGeneralThread()}>
                  {t('dashboard.litoPage.thread.newThread')}
                </Button>
                <Button
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  disabled={!activeThreadId}
                  onClick={openChatView}
                >
                  {t('dashboard.litoPage.command.openChat')}
                </Button>
              </div>
            </div>
            <div className="mt-2">
              <select
                value={activeThreadId || ''}
                onChange={(event) => {
                  const threadId = event.target.value || null;
                  setActiveThreadId(threadId);
                  const thread = threads.find((item) => item.id === threadId);
                  replaceQuery({
                    bizId: biz.id,
                    recommendationId: thread?.recommendation_id || null,
                    threadId,
                  });
                }}
                className="h-8 w-full rounded-lg border border-white/10 bg-black/30 px-2.5 text-xs text-white outline-none transition-colors duration-200 ease-premium hover:border-white/20 focus:border-emerald-300/35"
              >
                {threadsLoading ? (
                  <option value="">{t('common.loading')}</option>
                ) : threads.length > 0 ? (
                  threads.map((thread) => (
                    <option key={thread.id} value={thread.id} className="bg-zinc-900 text-white">
                      {`${thread.title} · ${formatThreadDate(thread.updated_at || thread.created_at)}`}
                    </option>
                  ))
                ) : (
                  <option value="">{t('dashboard.litoPage.command.noThreads')}</option>
                )}
              </select>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto px-4 py-3">
            {activeRecommendation ? (
              <div className="mb-3 rounded-xl border border-white/10 bg-white/6 p-3">
                <p className={cn('text-xs font-semibold', textMain)}>{activeRecommendation.hook}</p>
                <p className={cn('mt-1 text-sm text-white/80')}>{activeRecommendation.idea}</p>
              </div>
            ) : null}

            {messagesLoading ? (
              <div className="space-y-2">
                <div className="h-14 animate-pulse rounded-xl border border-white/8 bg-white/6" />
                <div className="h-14 animate-pulse rounded-xl border border-white/8 bg-white/6" />
              </div>
            ) : previewMessages.length > 0 ? (
              <div className="space-y-2.5">
                {previewMessages.map((message) => (
                  <div
                    key={message.id}
                    className={cn(
                      'max-w-[90%] rounded-2xl border px-3 py-2 text-sm',
                      message.role === 'user'
                        ? 'ml-auto border-emerald-300/30 bg-emerald-500/12 text-emerald-100'
                        : 'border-white/10 bg-white/6 text-white/88',
                    )}
                  >
                    <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
                    <p className={cn('mt-1 text-[11px]', textSub)}>{formatThreadDate(message.created_at)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className={cn('rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-sm', textSub)}>
                {t('dashboard.litoPage.command.emptyPreview')}
              </p>
            )}
          </div>
        </section>

        <LitoWorkbenchPane
          t={t}
          bizId={biz.id}
          businessName={biz.name}
          recommendation={activeRecommendation}
          viewerRole={weeklyViewerRole}
          selectedFormat={selectedFormat}
          onQuotaChange={setQuota}
          onPublished={handleMarkPublished}
        />
      </div>
    </div>
  );
}
