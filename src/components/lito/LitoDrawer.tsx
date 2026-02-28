'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Button from '@/components/ui/Button';
import { useT } from '@/components/i18n/I18nContext';
import { useToast } from '@/components/ui/Toast';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import LitoThreadPane from '@/components/lito/LitoThreadPane';
import LitoWorkbenchPane from '@/components/lito/LitoWorkbenchPane';
import { cn } from '@/lib/utils';
import { textMain, textSub } from '@/components/ui/glass';
import type {
  LitoRecommendationItem,
  LitoRecommendationTemplate,
  LitoThreadItem,
  LitoThreadMessage,
  LitoViewerRole,
} from '@/components/lito/types';

type LitoCopyStatusReason = 'missing_api_key' | 'paused' | 'disabled' | 'ok';

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

type LitoDrawerProps = {
  open: boolean;
  onClose: () => void;
  enabled: boolean;
  reason: LitoCopyStatusReason;
  canActivate: boolean;
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

function buildSignalReason(item: LitoRecommendationItem): string {
  const signal = item.signal_meta || item.recommendation_template?.signal;
  if (!signal) return item.idea;
  if (signal.keyword && typeof signal.keyword_mentions === 'number' && signal.keyword_mentions > 0) {
    return `${signal.keyword_mentions} mentions de “${signal.keyword}”`;
  }
  if (typeof signal.neg_reviews === 'number' && signal.neg_reviews > 0) {
    return `${signal.neg_reviews} negatives`;
  }
  if (typeof signal.avg_rating === 'number' && Number.isFinite(signal.avg_rating)) {
    return `Mitjana ${signal.avg_rating.toFixed(1)}★`;
  }
  return item.idea;
}

export default function LitoDrawer({ open, onClose, enabled, reason, canActivate }: LitoDrawerProps) {
  const t = useT();
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
  const [sendingMessage, setSendingMessage] = useState(false);
  const [messageDraft, setMessageDraft] = useState('');

  const [selectedFormat, setSelectedFormat] = useState<'post' | 'story' | 'reel'>('post');
  const [quickRefineTrigger, setQuickRefineTrigger] = useState<{ id: number; mode: 'shorter' | 'premium' | 'funny' } | null>(null);

  const bootstrapRef = useRef<string | null>(null);
  const quickRefineIdRef = useRef(0);

  const activeRecommendation = useMemo(() => {
    const recommendationId = activeThread?.recommendation_id;
    if (!recommendationId) return null;
    return weeklyRecommendations.find((item) => item.id === recommendationId) || null;
  }, [activeThread?.recommendation_id, weeklyRecommendations]);

  const disabledMessage = reason === 'missing_api_key'
    ? t('dashboard.litoPage.launcher.bannerMissingKey')
    : t('dashboard.litoPage.launcher.bannerPaused');

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
      setWeeklyRecommendations([]);
      setWeeklyViewerRole(null);
      const message = error instanceof Error ? error.message : t('dashboard.home.recommendations.loadError');
      toast(message, 'error');
    } finally {
      setWeeklyLoading(false);
    }
  }, [biz?.id, t, toast]);

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
      setThreads([]);
      const message = error instanceof Error ? error.message : t('dashboard.home.recommendations.lito.loadError');
      toast(message, 'error');
    } finally {
      setThreadsLoading(false);
    }
  }, [biz?.id, t, toast]);

  const loadThreadDetail = useCallback(async (threadId: string) => {
    setMessagesLoading(true);
    try {
      const response = await fetch(`/api/lito/threads/${threadId}?limit=200`);
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
      setActiveThread(null);
      setMessages([]);
      const message = error instanceof Error ? error.message : t('dashboard.home.recommendations.lito.loadError');
      toast(message, 'error');
    } finally {
      setMessagesLoading(false);
    }
  }, [t, toast, weeklyRecommendations]);

  const openOrCreateThread = useCallback(async (options: { recommendationId?: string | null; title?: string | null }) => {
    if (!biz?.id) return null;
    try {
      const response = await fetch('/api/lito/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          biz_id: biz.id,
          recommendation_id: options.recommendationId ?? null,
          title: options.title ?? null,
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
      return thread;
    } catch (error) {
      const message = error instanceof Error ? error.message : t('dashboard.home.recommendations.lito.openError');
      toast(message, 'error');
      return null;
    }
  }, [biz?.id, t, toast]);

  const openGeneralThread = useCallback(async () => {
    await openOrCreateThread({
      recommendationId: null,
      title: t('dashboard.litoPage.thread.generalThreadTitle'),
    });
  }, [openOrCreateThread, t]);

  const openThreadForRecommendation = useCallback(async (recommendation: LitoRecommendationItem) => {
    setSelectedFormat(normalizeFormat(recommendation.format));
    await openOrCreateThread({
      recommendationId: recommendation.id,
      title: recommendation.hook || t('dashboard.litoPage.thread.recommendationThreadTitle'),
    });
  }, [openOrCreateThread, t]);

  const openThreadForFormat = useCallback(async (format: 'post' | 'story' | 'reel') => {
    setSelectedFormat(format);
    const candidate = weeklyRecommendations.find((item) => normalizeFormat(item.format) === format) || weeklyRecommendations[0];
    if (candidate) {
      await openThreadForRecommendation(candidate);
      return;
    }
    await openGeneralThread();
  }, [openGeneralThread, openThreadForRecommendation, weeklyRecommendations]);

  const handleSendMessage = useCallback(async () => {
    if (!activeThreadId || messageDraft.trim().length < 2) return;
    setSendingMessage(true);
    try {
      const response = await fetch(`/api/lito/threads/${activeThreadId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: messageDraft.trim() }),
      });
      const payload = (await response.json().catch(() => ({}))) as { messages?: LitoThreadMessage[]; error?: string; message?: string };
      if (!response.ok || payload.error) {
        throw new Error(payload.message || t('dashboard.home.recommendations.lito.sendError'));
      }
      setMessageDraft('');
      const appendedMessages = Array.isArray(payload.messages) ? payload.messages : [];
      if (appendedMessages.length > 0) {
        setMessages((previous) => [...previous, ...appendedMessages]);
      }
      await loadThreads();
    } catch (error) {
      const message = error instanceof Error ? error.message : t('dashboard.home.recommendations.lito.sendError');
      toast(message, 'error');
    } finally {
      setSendingMessage(false);
    }
  }, [activeThreadId, loadThreads, messageDraft, t, toast]);

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
    if (!open || !biz?.id) return;
    setMessageDraft('');
    setQuickRefineTrigger(null);
    void loadWeeklyRecommendations();
    void loadThreads();
  }, [biz?.id, loadThreads, loadWeeklyRecommendations, open]);

  useEffect(() => {
    if (!open || !biz?.id) return;
    if (bootstrapRef.current === biz.id) return;
    if (threadsLoading || weeklyLoading) return;

    bootstrapRef.current = biz.id;

    if (threads.length > 0) {
      setActiveThreadId(threads[0].id);
      return;
    }

    void openGeneralThread();
  }, [biz?.id, open, openGeneralThread, threads, threadsLoading, weeklyLoading]);

  useEffect(() => {
    if (!open || !activeThreadId) return;
    void loadThreadDetail(activeThreadId);
  }, [activeThreadId, loadThreadDetail, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90]">
      <button
        type="button"
        className="absolute inset-0 bg-black/55 backdrop-blur-[1px]"
        aria-label={t('common.close')}
        onClick={onClose}
      />

      <aside className="absolute bottom-0 left-0 top-0 w-[min(96vw,1240px)] border-r border-white/10 bg-zinc-950/95 p-4 shadow-[24px_0_80px_rgba(0,0,0,0.45)] backdrop-blur-xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className={cn('text-base font-semibold tracking-wide', textMain)}>
              {t('dashboard.litoPage.launcher.drawerTitle')}
            </h2>
            <p className={cn('mt-1 text-xs', textSub)}>{t('dashboard.litoPage.launcher.drawerSubtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={biz?.id || ''}
              onChange={(event) => void switchBiz(event.target.value)}
              className="h-8 rounded-lg border border-white/10 bg-black/30 px-2.5 text-xs text-white outline-none transition-colors duration-200 ease-premium hover:border-white/20 focus:border-emerald-300/35"
            >
              {businesses.map((entry) => (
                <option key={entry.id} value={entry.id} className="bg-zinc-900 text-white">
                  {entry.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/12 bg-white/5 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
              onClick={onClose}
              aria-label={t('common.close')}
            >
              ×
            </button>
          </div>
        </div>

        {!enabled ? (
          <div className="mb-4 rounded-xl border border-amber-300/30 bg-amber-500/10 p-3">
            <p className="text-sm font-semibold text-amber-100">{t('dashboard.litoPage.launcher.bannerTitle')}</p>
            <p className="mt-1 text-xs text-amber-100/90">{disabledMessage}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {canActivate ? (
                <Link
                  href="/dashboard/admin"
                  className="inline-flex items-center rounded-lg border border-amber-200/35 bg-amber-200/20 px-2.5 py-1.5 text-xs font-medium text-amber-100 transition-colors hover:bg-amber-200/30"
                >
                  {t('dashboard.litoPage.launcher.goToSettings')}
                </Link>
              ) : (
                <span className="text-xs font-medium text-amber-100/90">
                  {t('dashboard.litoPage.launcher.ownerManagerOnly')}
                </span>
              )}
            </div>
          </div>
        ) : null}

        <div className="grid h-[calc(100%-96px)] min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_430px]">
          <div className="flex min-h-0 flex-col gap-3">
            <div className="rounded-2xl border border-white/10 bg-zinc-900/45 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className={cn('text-xs font-semibold uppercase tracking-wide', textMain)}>
                  {t('dashboard.litoPage.launcher.menuTitle')}
                </p>
                <Button size="sm" variant="secondary" className="h-7 px-2.5 text-xs" onClick={() => void openGeneralThread()}>
                  {t('dashboard.litoPage.context.askLito')}
                </Button>
              </div>
              {weeklyLoading ? (
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="h-20 animate-pulse rounded-xl border border-white/8 bg-white/6" />
                  <div className="h-20 animate-pulse rounded-xl border border-white/8 bg-white/6" />
                  <div className="h-20 animate-pulse rounded-xl border border-white/8 bg-white/6" />
                </div>
              ) : weeklyRecommendations.length > 0 ? (
                <div className="grid gap-2 sm:grid-cols-3">
                  {weeklyRecommendations.slice(0, 3).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => void openThreadForRecommendation(item)}
                      className="rounded-xl border border-white/10 bg-white/6 p-2.5 text-left transition-colors hover:border-white/20 hover:bg-white/10"
                    >
                      <p className="text-[11px] uppercase tracking-wide text-white/55">{item.format}</p>
                      <p className="mt-1 line-clamp-2 text-xs font-semibold text-white/90">{item.hook}</p>
                      <p className={cn('mt-1 line-clamp-2 text-[11px]', textSub)}>{buildSignalReason(item)}</p>
                    </button>
                  ))}
                </div>
              ) : (
                <p className={cn('rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-xs', textSub)}>
                  {t('dashboard.home.recommendations.empty')}
                </p>
              )}
            </div>

            <div className="min-h-0 flex-1">
              <LitoThreadPane
                t={t}
                threads={threads}
                threadsLoading={threadsLoading}
                selectedThreadId={activeThreadId}
                onSelectThread={(threadId) => setActiveThreadId(threadId)}
                onOpenGeneralThread={() => void openGeneralThread()}
                onOpenThreadForFormat={(format) => void openThreadForFormat(format)}
                selectedFormat={selectedFormat}
                messages={messages}
                messagesLoading={messagesLoading}
                draftMessage={messageDraft}
                sending={sendingMessage}
                onDraftMessageChange={setMessageDraft}
                onSendMessage={() => void handleSendMessage()}
                activeRecommendation={activeRecommendation}
                onQuickRefine={(mode) => {
                  quickRefineIdRef.current += 1;
                  setQuickRefineTrigger({ id: quickRefineIdRef.current, mode });
                }}
              />
            </div>
          </div>

          <div className="min-h-0">
            <LitoWorkbenchPane
              t={t}
              bizId={biz?.id || null}
              businessName={biz?.name || ''}
              recommendation={activeRecommendation}
              viewerRole={weeklyViewerRole}
              selectedFormat={selectedFormat}
              onQuotaChange={() => undefined}
              onPublished={handleMarkPublished}
              quickRefineTrigger={quickRefineTrigger}
            />
          </div>
        </div>
      </aside>
    </div>
  );
}
