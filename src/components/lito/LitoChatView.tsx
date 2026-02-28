'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Button from '@/components/ui/Button';
import GlassCard from '@/components/ui/GlassCard';
import { useT } from '@/components/i18n/I18nContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';
import { textMain, textSub } from '@/components/ui/glass';
import type {
  LitoRecommendationItem,
  LitoRecommendationTemplate,
  LitoThreadItem,
  LitoThreadMessage,
} from '@/components/lito/types';

type WeeklyRecommendationsPayload = {
  items?: Array<Partial<LitoRecommendationItem> & { recommendation_template?: LitoRecommendationTemplate }>;
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

function sanitizeMessages(messages: LitoThreadMessage[]): LitoThreadMessage[] {
  return messages.filter((item) => {
    if (item.role !== 'system') return true;
    return !item.content.toUpperCase().includes('CONTEXT');
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

export default function LitoChatView() {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { biz, businesses, switchBiz } = useWorkspace();

  const [threads, setThreads] = useState<LitoThreadItem[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [activeThread, setActiveThread] = useState<LitoThreadItem | null>(null);
  const [messages, setMessages] = useState<LitoThreadMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [messageDraft, setMessageDraft] = useState('');
  const [weeklyRecommendations, setWeeklyRecommendations] = useState<LitoRecommendationItem[]>([]);

  const bootstrapRef = useRef<string | null>(null);
  const queryBizId = searchParams.get('biz_id');
  const queryRecommendationId = searchParams.get('recommendation_id');
  const queryThreadId = searchParams.get('thread_id');

  const activeRecommendation = useMemo(() => {
    if (!activeThread?.recommendation_id) return null;
    return weeklyRecommendations.find((item) => item.id === activeThread.recommendation_id) || null;
  }, [activeThread?.recommendation_id, weeklyRecommendations]);

  const replaceQuery = useCallback((next: { bizId?: string | null; recommendationId?: string | null; threadId?: string | null }) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next.bizId) params.set('biz_id', next.bizId);
    else params.delete('biz_id');
    if (next.recommendationId) params.set('recommendation_id', next.recommendationId);
    else params.delete('recommendation_id');
    if (next.threadId) params.set('thread_id', next.threadId);
    else params.delete('thread_id');
    const qs = params.toString();
    router.replace(qs ? `/dashboard/lito/chat?${qs}` : '/dashboard/lito/chat');
  }, [router, searchParams]);

  const loadWeeklyRecommendations = useCallback(async () => {
    if (!biz?.id) return;
    try {
      const response = await fetch(`/api/recommendations/weekly?biz_id=${biz.id}`);
      const payload = (await response.json().catch(() => ({}))) as WeeklyRecommendationsPayload;
      if (!response.ok || payload.error) return;
      setWeeklyRecommendations(
        (payload.items || [])
          .map((item) => normalizeRecommendationItem(item))
          .filter((item): item is LitoRecommendationItem => Boolean(item)),
      );
    } catch {
      setWeeklyRecommendations([]);
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
    } catch (error) {
      setActiveThread(null);
      setMessages([]);
      const message = error instanceof Error ? error.message : t('dashboard.home.recommendations.lito.loadError');
      toast(message, 'error');
    } finally {
      setMessagesLoading(false);
    }
  }, [t, toast]);

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
      setThreads((previous) => [thread, ...previous.filter((item) => item.id !== thread.id)].slice(0, 20));
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

  const sendMessage = useCallback(async (content: string) => {
    if (!activeThreadId || content.trim().length < 2) return;
    setSending(true);
    try {
      const response = await fetch(`/api/lito/threads/${activeThreadId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: content.trim() }),
      });
      const payload = (await response.json().catch(() => ({}))) as { messages?: LitoThreadMessage[]; error?: string; message?: string };
      if (!response.ok || payload.error) {
        throw new Error(payload.message || t('dashboard.home.recommendations.lito.sendError'));
      }
      setMessageDraft('');
      const appended = Array.isArray(payload.messages) ? payload.messages : [];
      if (appended.length > 0) {
        setMessages((previous) => [...previous, ...appended]);
      }
      await loadThreads();
    } catch (error) {
      const message = error instanceof Error ? error.message : t('dashboard.home.recommendations.lito.sendError');
      toast(message, 'error');
    } finally {
      setSending(false);
    }
  }, [activeThreadId, loadThreads, t, toast]);

  useEffect(() => {
    if (!biz?.id || !queryBizId) return;
    if (queryBizId === biz.id) return;
    if (businesses.some((item) => item.id === queryBizId)) {
      void switchBiz(queryBizId);
    }
  }, [biz?.id, businesses, queryBizId, switchBiz]);

  useEffect(() => {
    if (!biz?.id) return;
    setMessageDraft('');
    void loadWeeklyRecommendations();
    void loadThreads();
  }, [biz?.id, loadThreads, loadWeeklyRecommendations]);

  useEffect(() => {
    if (!biz?.id) return;
    if (bootstrapRef.current === biz.id) return;
    if (threadsLoading) return;

    bootstrapRef.current = biz.id;
    if (queryThreadId) {
      setActiveThreadId(queryThreadId);
      return;
    }
    if (queryRecommendationId) {
      const recommendation = weeklyRecommendations.find((item) => item.id === queryRecommendationId);
      void openOrCreateThread({
        recommendationId: queryRecommendationId,
        title: recommendation?.hook || t('dashboard.litoPage.thread.recommendationThreadTitle'),
      });
      return;
    }
    if (threads.length > 0) {
      setActiveThreadId(threads[0].id);
      replaceQuery({
        bizId: biz.id,
        recommendationId: threads[0].recommendation_id,
        threadId: threads[0].id,
      });
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
    weeklyRecommendations,
  ]);

  useEffect(() => {
    if (!activeThreadId) return;
    void loadThreadDetail(activeThreadId);
  }, [activeThreadId, loadThreadDetail]);

  const visibleMessages = useMemo(() => sanitizeMessages(messages), [messages]);

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
    <div className="mx-auto w-full max-w-5xl space-y-4" data-testid="dashboard-lito-chat-page">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className={cn('text-2xl font-semibold tracking-tight', textMain)}>
            {t('dashboard.litoPage.chat.title')}
          </h1>
          <p className={cn('mt-1 text-sm', textSub)}>{t('dashboard.litoPage.chat.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
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
          <Link
            href={`/dashboard/lito?biz_id=${biz.id}`}
            className="inline-flex h-9 items-center rounded-lg border border-white/10 bg-white/6 px-3 text-xs font-medium text-white/85 transition-colors hover:bg-white/10 hover:text-white"
          >
            {t('dashboard.litoPage.chat.openCommandCenter')}
          </Link>
        </div>
      </header>

      <section className="flex min-h-[72vh] flex-col rounded-2xl border border-white/10 bg-zinc-900/45 backdrop-blur-md">
        <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-4 py-3">
          <label className={cn('text-xs font-medium', textSub)} htmlFor="lito-thread-select">
            {t('dashboard.litoPage.chat.threadLabel')}
          </label>
          <select
            id="lito-thread-select"
            value={activeThreadId || ''}
            onChange={(event) => {
              const nextId = event.target.value || null;
              setActiveThreadId(nextId);
              const thread = threads.find((item) => item.id === nextId);
              replaceQuery({
                bizId: biz.id,
                recommendationId: thread?.recommendation_id || null,
                threadId: nextId,
              });
            }}
            className="h-8 min-w-[240px] rounded-lg border border-white/10 bg-black/30 px-2.5 text-xs text-white outline-none transition-colors duration-200 ease-premium hover:border-white/20 focus:border-emerald-300/35"
          >
            {threadsLoading ? (
              <option value="">{t('common.loading')}</option>
            ) : threads.length > 0 ? (
              threads.map((thread) => (
                <option key={thread.id} value={thread.id} className="bg-zinc-900 text-white">
                  {thread.title}
                </option>
              ))
            ) : (
              <option value="">{t('dashboard.litoPage.chat.emptyThreads')}</option>
            )}
          </select>
          <Button size="sm" variant="secondary" className="h-8 px-3 text-xs" onClick={() => void openGeneralThread()}>
            {t('dashboard.litoPage.chat.newThread')}
          </Button>
        </div>

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
          ) : visibleMessages.length > 0 ? (
            <div className="space-y-2.5">
              {visibleMessages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    'max-w-[88%] rounded-2xl border px-3 py-2 text-sm',
                    message.role === 'user'
                      ? 'ml-auto border-emerald-300/30 bg-emerald-500/12 text-emerald-100'
                      : 'border-white/10 bg-white/6 text-white/88',
                  )}
                >
                  <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
                  {message.role === 'assistant' && activeThread?.recommendation_id ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => void sendMessage(t('dashboard.litoPage.chat.quickPrompts.shorter'))}
                        className="rounded-full border border-white/15 bg-white/6 px-2.5 py-1 text-[11px] font-medium text-white/80 transition-colors hover:bg-white/12 hover:text-white"
                      >
                        {t('dashboard.home.recommendations.lito.refine.shorter')}
                      </button>
                      <button
                        type="button"
                        onClick={() => void sendMessage(t('dashboard.litoPage.chat.quickPrompts.premium'))}
                        className="rounded-full border border-white/15 bg-white/6 px-2.5 py-1 text-[11px] font-medium text-white/80 transition-colors hover:bg-white/12 hover:text-white"
                      >
                        {t('dashboard.home.recommendations.lito.refine.premium')}
                      </button>
                      <button
                        type="button"
                        onClick={() => void sendMessage(t('dashboard.litoPage.chat.quickPrompts.funny'))}
                        className="rounded-full border border-white/15 bg-white/6 px-2.5 py-1 text-[11px] font-medium text-white/80 transition-colors hover:bg-white/12 hover:text-white"
                      >
                        {t('dashboard.home.recommendations.lito.refine.funny')}
                      </button>
                    </div>
                  ) : null}
                  <p className={cn('mt-1 text-[11px]', textSub)}>{formatThreadDate(message.created_at)}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className={cn('rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-sm', textSub)}>
              {t('dashboard.home.recommendations.lito.emptyChat')}
            </p>
          )}
        </div>

        <div className="border-t border-white/10 px-4 py-3">
          <div className="flex items-end gap-2">
            <textarea
              value={messageDraft}
              onChange={(event) => setMessageDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  if (!sending && messageDraft.trim().length >= 2) {
                    void sendMessage(messageDraft);
                  }
                }
              }}
              rows={2}
              placeholder={t('dashboard.home.recommendations.lito.inputPlaceholder')}
              className="min-h-[72px] w-full rounded-xl border border-white/10 bg-black/30 p-3 text-sm text-white outline-none transition-all duration-200 ease-premium focus:border-emerald-300/35 focus:ring-2 focus:ring-emerald-400/20"
            />
            <Button
              size="sm"
              className="h-10 px-3 text-xs"
              loading={sending}
              disabled={sending || messageDraft.trim().length < 2}
              onClick={() => void sendMessage(messageDraft)}
            >
              {t('dashboard.home.recommendations.lito.send')}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
