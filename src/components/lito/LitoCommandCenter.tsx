'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useT } from '@/components/i18n/I18nContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useToast } from '@/components/ui/Toast';
import Button from '@/components/ui/Button';
import GlassCard from '@/components/ui/GlassCard';
import LitoContextPanel from '@/components/lito/LitoContextPanel';
import LitoThreadPane from '@/components/lito/LitoThreadPane';
import LitoWorkbenchPane from '@/components/lito/LitoWorkbenchPane';
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
  const [sendingMessage, setSendingMessage] = useState(false);
  const [messageDraft, setMessageDraft] = useState('');

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
    return weeklyRecommendations.find((item) => item.id === recommendationId) || null;
  }, [activeThread?.recommendation_id, queryRecommendationId, weeklyRecommendations]);

  const selectedRecommendationId = activeRecommendation?.id || null;

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
      const message = error instanceof Error ? error.message : t('dashboard.home.recommendations.lito.loadError');
      toast(message, 'error');
      setActiveThread(null);
      setMessages([]);
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
    if (!biz?.id) return;
    setQuota(null);
    void loadWeeklyRecommendations();
    void loadThreads();
    void loadGoogleStatus();
  }, [biz?.id, loadGoogleStatus, loadThreads, loadWeeklyRecommendations]);

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
      if (recommendation) {
        void openThreadForRecommendation(recommendation);
        return;
      }
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
    openThreadForRecommendation,
    queryRecommendationId,
    queryThreadId,
    replaceQuery,
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

        <LitoThreadPane
          t={t}
          threads={threads}
          threadsLoading={threadsLoading}
          selectedThreadId={activeThreadId}
          onSelectThread={(threadId) => {
            setActiveThreadId(threadId);
            const thread = threads.find((item) => item.id === threadId);
            replaceQuery({ bizId: biz.id, recommendationId: thread?.recommendation_id || null, threadId });
          }}
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
        />

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
