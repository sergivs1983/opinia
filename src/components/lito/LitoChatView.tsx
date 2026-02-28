'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Button from '@/components/ui/Button';
import GlassCard from '@/components/ui/GlassCard';
import { useT } from '@/components/i18n/I18nContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useToast } from '@/components/ui/Toast';
import { emitLitoCopyUpdated, isLitoCopyUpdatedEvent, LITO_COPY_UPDATED_EVENT } from '@/components/lito/copy-sync';
import { buildFallbackRecommendation } from '@/components/lito/recommendation-fallback';
import { getIkeaChecklist, type RecommendationChannel } from '@/lib/recommendations/howto';
import { cn } from '@/lib/utils';
import { textMain, textSub } from '@/components/ui/glass';
import type {
  LitoGeneratedCopy,
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

type CopyApiPayload = {
  ok?: boolean;
  copy?: LitoGeneratedCopy | null;
  error?: string;
  message?: string;
};

type GeneratePayload = {
  ok?: boolean;
  copy?: LitoGeneratedCopy;
  error?: string;
  reason?: 'missing_api_key' | 'paused' | 'disabled' | 'ok';
  message?: string;
};

type QuickRefineMode = 'shorter' | 'premium' | 'funny';

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

function formatThreadAgo(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return '';
  const diffMs = Date.now() - parsed;
  if (!Number.isFinite(diffMs) || diffMs < 0) return formatThreadDate(value);

  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes < 1) return 'fa uns segons';
  if (diffMinutes < 60) return `fa ${diffMinutes} min`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `fa ${diffHours} h`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `fa ${diffDays} d`;

  return formatThreadDate(value);
}

function buildThreadPreview(thread: LitoThreadItem): string {
  const preview = typeof thread.last_message_preview === 'string'
    ? thread.last_message_preview.replace(/\s+/g, ' ').trim()
    : '';
  return preview;
}

function resolveQuickRefineModeFromText(value: string): QuickRefineMode | null {
  const text = value.toLowerCase();
  if (
    text.includes('més curt')
    || text.includes('mes curt')
    || text.includes('más corto')
    || text.includes('shorter')
  ) return 'shorter';
  if (
    text.includes('més premium')
    || text.includes('mes premium')
    || text.includes('más premium')
    || text.includes('premium')
  ) return 'premium';
  if (
    text.includes('més divertit')
    || text.includes('mes divertit')
    || text.includes('més proper')
    || text.includes('mes proper')
    || text.includes('más divertido')
    || text.includes('funny')
  ) return 'funny';
  return null;
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
  const [generatedCopy, setGeneratedCopy] = useState<LitoGeneratedCopy | null>(null);
  const [copyLoading, setCopyLoading] = useState(false);
  const [copyAction, setCopyAction] = useState<'generate' | QuickRefineMode | null>(null);
  const [quickRefinePrompt, setQuickRefinePrompt] = useState('');
  const [ikeaChannel, setIkeaChannel] = useState<RecommendationChannel>('instagram');
  // D1.6: IKEA panel is hidden by default; user opens it on-demand
  const [ikeaOpen, setIkeaOpen] = useState(false);
  const [renamingThreadId, setRenamingThreadId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [renamingLoading, setRenamingLoading] = useState(false);

  const bootstrapRef = useRef<string | null>(null);
  const queryBizId = searchParams.get('biz_id');
  const queryRecommendationId = searchParams.get('recommendation_id');
  const queryThreadId = searchParams.get('thread_id');

  const activeRecommendation = useMemo(() => {
    if (!activeThread?.recommendation_id) return null;
    const fromWeekly = weeklyRecommendations.find((item) => item.id === activeThread.recommendation_id);
    if (fromWeekly) return fromWeekly;
    return buildFallbackRecommendation({
      thread: activeThread,
      recommendationId: activeThread.recommendation_id,
      selectedFormat: 'post',
      defaultTitle: t('dashboard.home.recommendations.lito.defaultTitle'),
    });
  }, [activeThread, t, weeklyRecommendations]);
  const ikeaChecklist = useMemo(() => {
    if (!activeRecommendation) return null;
    return getIkeaChecklist({
      format: activeRecommendation.format,
      channel: ikeaChannel,
      vertical: activeRecommendation.vertical || null,
      hook: activeRecommendation.hook || activeRecommendation.recommendation_template?.hook || null,
      idea: activeRecommendation.idea || activeRecommendation.recommendation_template?.idea || null,
      cta: activeRecommendation.cta || activeRecommendation.recommendation_template?.cta || null,
      t,
    });
  }, [activeRecommendation, ikeaChannel, t]);

  const commandCenterHref = useMemo(() => {
    if (!biz?.id) return '/dashboard/lito';
    const params = new URLSearchParams();
    params.set('biz_id', biz.id);
    if (activeThreadId) params.set('thread_id', activeThreadId);
    if (activeThread?.recommendation_id) params.set('recommendation_id', activeThread.recommendation_id);
    return `/dashboard/lito?${params.toString()}`;
  }, [activeThread?.recommendation_id, activeThreadId, biz?.id]);

  const aiReasonMessage = useCallback((reason?: 'missing_api_key' | 'paused' | 'disabled' | 'ok', fallback?: string) => {
    if (reason === 'missing_api_key') return t('dashboard.home.recommendations.lito.copyDisabledMissingKey');
    if (reason === 'disabled' || reason === 'paused') return t('dashboard.home.recommendations.lito.copyDisabledManager');
    return fallback || t('dashboard.home.recommendations.lito.aiUnavailable');
  }, [t]);

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
      const response = await fetch(`/api/lito/messages?thread_id=${threadId}&limit=50`);
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

  const loadStoredCopy = useCallback(async () => {
    if (!biz?.id || !activeThread?.recommendation_id) {
      setGeneratedCopy(null);
      return;
    }

    setCopyLoading(true);
    try {
      const response = await fetch(`/api/lito/copy?biz_id=${biz.id}&recommendation_id=${activeThread.recommendation_id}`);
      const payload = (await response.json().catch(() => ({}))) as CopyApiPayload;
      if (!response.ok || payload.error) {
        setGeneratedCopy(null);
        return;
      }
      setGeneratedCopy(payload.copy || null);
    } catch {
      setGeneratedCopy(null);
    } finally {
      setCopyLoading(false);
    }
  }, [activeThread?.recommendation_id, biz?.id]);

  const runGenerate = useCallback(async () => {
    if (!biz?.id || !activeRecommendation?.id) return;
    setCopyAction('generate');
    try {
      const response = await fetch('/api/lito/copy/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          biz_id: biz.id,
          recommendation_id: activeRecommendation.id,
          format: activeRecommendation.format || 'post',
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as GeneratePayload;

      if (response.status === 503 || payload.error === 'ai_unavailable') {
        toast(aiReasonMessage(payload.reason, payload.message), 'warning');
        return;
      }
      if (response.status === 402 || payload.error === 'quota_exceeded') {
        toast(payload.message || t('dashboard.litoPage.messages.quotaExceeded'), 'warning');
        return;
      }
      if (response.status === 403 && (payload.error === 'feature_locked' || payload.error === 'staff_ai_paused')) {
        toast(payload.message || t('dashboard.home.recommendations.lito.copyDisabledManager'), 'warning');
        return;
      }
      if (response.status === 409 && payload.error === 'in_flight') {
        toast(t('dashboard.home.recommendations.lito.inFlightToast'), 'warning');
        return;
      }
      if (!response.ok || payload.error || !payload.copy) {
        throw new Error(payload.message || t('dashboard.home.recommendations.lito.generateError'));
      }

      setGeneratedCopy(payload.copy);
      setQuickRefinePrompt('');
      emitLitoCopyUpdated({
        bizId: biz.id,
        recommendationId: activeRecommendation.id,
        source: 'chat',
      });
      toast(t('dashboard.home.recommendations.lito.copySuccess'), 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : t('dashboard.home.recommendations.lito.generateError');
      toast(message, 'error');
    } finally {
      setCopyAction(null);
    }
  }, [activeRecommendation?.format, activeRecommendation?.id, aiReasonMessage, biz?.id, t, toast]);

  const runQuickRefine = useCallback(async (mode: QuickRefineMode) => {
    if (!biz?.id || !activeRecommendation?.id) return;
    setCopyAction(mode);
    try {
      const response = await fetch('/api/lito/copy/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          biz_id: biz.id,
          recommendation_id: activeRecommendation.id,
          mode: 'quick',
          quick_mode: mode,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as GeneratePayload;

      if (response.status === 503 || payload.error === 'ai_unavailable') {
        toast(aiReasonMessage(payload.reason, payload.message), 'warning');
        return;
      }
      if (response.status === 402 || payload.error === 'quota_exceeded') {
        toast(payload.message || t('dashboard.litoPage.messages.quotaExceeded'), 'warning');
        return;
      }
      if (response.status === 403 && (payload.error === 'feature_locked' || payload.error === 'staff_ai_paused')) {
        toast(payload.message || t('dashboard.home.recommendations.lito.copyDisabledManager'), 'warning');
        return;
      }
      if (response.status === 409 && payload.error === 'in_flight') {
        toast(t('dashboard.home.recommendations.lito.inFlightToast'), 'warning');
        return;
      }
      if (!response.ok || payload.error || !payload.copy) {
        throw new Error(payload.message || t('dashboard.home.recommendations.lito.refineError'));
      }

      setGeneratedCopy(payload.copy);
      const prompt = mode === 'shorter'
        ? t('dashboard.litoPage.chat.quickPrompts.shorter')
        : mode === 'premium'
          ? t('dashboard.litoPage.chat.quickPrompts.premium')
          : t('dashboard.litoPage.chat.quickPrompts.funny');
      setQuickRefinePrompt(prompt);

      emitLitoCopyUpdated({
        bizId: biz.id,
        recommendationId: activeRecommendation.id,
        source: 'chat',
      });
      toast(t('dashboard.home.recommendations.lito.copySuccess'), 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : t('dashboard.home.recommendations.lito.refineError');
      toast(message, 'error');
    } finally {
      setCopyAction(null);
    }
  }, [activeRecommendation?.id, aiReasonMessage, biz?.id, t, toast]);

  const handleCopyText = useCallback(async (value: string) => {
    if (!value.trim()) return;
    try {
      await navigator.clipboard.writeText(value);
      toast(t('dashboard.home.recommendations.lito.copySuccess'), 'success');
    } catch {
      toast(t('dashboard.home.recommendations.lito.copyError'), 'error');
    }
  }, [t, toast]);

  const handleCopyIkeaChecklist = useCallback(async () => {
    if (!ikeaChecklist?.copyText?.trim()) return;
    try {
      await navigator.clipboard.writeText(ikeaChecklist.copyText);
      toast(t('dashboard.litoPage.ikea.copiedToast'), 'success');
    } catch {
      toast(t('dashboard.litoPage.ikea.copyError'), 'error');
    }
  }, [ikeaChecklist, t, toast]);

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
    });
  }, [openOrCreateThread]);

  const startRenaming = useCallback((thread: LitoThreadItem) => {
    setRenamingThreadId(thread.id);
    setRenameDraft(thread.title);
  }, []);

  const cancelRenaming = useCallback(() => {
    setRenamingThreadId(null);
    setRenameDraft('');
  }, []);

  const saveRenaming = useCallback(async () => {
    if (!renamingThreadId) return;
    const nextTitle = renameDraft.trim();
    if (nextTitle.length < 3 || nextTitle.length > 80) {
      toast(t('dashboard.litoPage.chat.renameError'), 'warning');
      return;
    }

    setRenamingLoading(true);
    try {
      const response = await fetch(`/api/lito/threads/${renamingThreadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: nextTitle }),
      });
      const payload = (await response.json().catch(() => ({}))) as ThreadCreatePayload;
      if (!response.ok || payload.error || !payload.thread) {
        throw new Error(payload.message || t('dashboard.litoPage.chat.renameError'));
      }

      setThreads((previous) => previous.map((thread) => (
        thread.id === renamingThreadId
          ? { ...thread, title: payload.thread!.title, updated_at: payload.thread!.updated_at }
          : thread
      )));
      if (activeThreadId === renamingThreadId) {
        setActiveThread((previous) => (
          previous
            ? { ...previous, title: payload.thread!.title, updated_at: payload.thread!.updated_at }
            : previous
        ));
      }
      setRenamingThreadId(null);
      setRenameDraft('');
    } catch (error) {
      const message = error instanceof Error ? error.message : t('dashboard.litoPage.chat.renameError');
      toast(message, 'error');
    } finally {
      setRenamingLoading(false);
    }
  }, [activeThreadId, renameDraft, renamingThreadId, t, toast]);

  const sendMessage = useCallback(async (content: string) => {
    const normalized = content.trim();
    if (normalized.length < 2) return;
    if (!biz?.id) {
      toast(t('dashboard.litoPage.chat.threadRequired'), 'warning');
      return;
    }

    const recommendationContext = {
      recommendationId: activeRecommendation?.id ?? null,
      format: activeRecommendation?.format === 'story' || activeRecommendation?.format === 'reel'
        ? activeRecommendation.format
        : 'post',
      hook: activeRecommendation?.hook || null,
    } as const;

    setSending(true);
    try {
      const ensureThreadId = async (): Promise<string | null> => {
        if (activeThreadId) return activeThreadId;
        const createdThread = await openOrCreateThread(recommendationContext);
        return createdThread?.id || null;
      };

      let threadId = await ensureThreadId();
      if (!threadId) {
        toast(t('dashboard.litoPage.chat.threadRequired'), 'warning');
        return;
      }

      const quickMode = resolveQuickRefineModeFromText(normalized);
      if (activeRecommendation?.id && quickMode) {
        if (generatedCopy) {
          await runQuickRefine(quickMode);
        } else {
          await runGenerate();
        }
      }

      const postMessage = async (targetThreadId: string): Promise<{
        response: Response;
        payload: { messages?: LitoThreadMessage[]; error?: string; message?: string };
      }> => {
        const requestId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const response = await fetch(`/api/lito/threads/${targetThreadId}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-request-id': requestId,
          },
          cache: 'no-store',
          body: JSON.stringify({
            content: normalized,
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          messages?: LitoThreadMessage[];
          error?: string;
          message?: string;
        };
        return { response, payload };
      };

      let { response, payload } = await postMessage(threadId);
      if (response.status === 401) {
        router.push('/login');
        return;
      }
      if (response.status === 404 || payload.error === 'not_found') {
        const recoveredThread = await openOrCreateThread(recommendationContext);
        threadId = recoveredThread?.id || null;
        if (!threadId) {
          toast(t('dashboard.litoPage.chat.threadRequired'), 'warning');
          return;
        }
        ({ response, payload } = await postMessage(threadId));
      }

      if (response.status === 401) {
        router.push('/login');
        return;
      }
      if (response.status >= 500) {
        throw new Error(t('dashboard.litoPage.chat.sendServerError'));
      }
      if (!response.ok || payload.error) {
        throw new Error(payload.message || t('dashboard.home.recommendations.lito.sendError'));
      }
      setMessageDraft('');
      setActiveThreadId(threadId);
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
  }, [
    activeRecommendation?.format,
    activeRecommendation?.hook,
    activeRecommendation?.id,
    activeThreadId,
    biz?.id,
    generatedCopy,
    loadThreads,
    openOrCreateThread,
    router,
    runGenerate,
    runQuickRefine,
    t,
    toast,
  ]);

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
        format: recommendation?.format === 'story' || recommendation?.format === 'reel' ? recommendation.format : 'post',
        hook: recommendation?.hook || null,
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

  useEffect(() => {
    void loadStoredCopy();
  }, [loadStoredCopy]);

  useEffect(() => {
    setIkeaChannel('instagram');
    // D1.6: collapse IKEA panel whenever the recommendation changes
    setIkeaOpen(false);
  }, [activeRecommendation?.id]);

  useEffect(() => {
    if (!biz?.id || !activeThread?.recommendation_id) return;

    const onCopyUpdated = (event: Event) => {
      if (!isLitoCopyUpdatedEvent(event)) return;
      const detail = event.detail;
      if (!detail) return;
      if (detail.source === 'chat') return;
      if (detail.bizId !== biz.id || detail.recommendationId !== activeThread.recommendation_id) return;
      void loadStoredCopy();
    };

    window.addEventListener(LITO_COPY_UPDATED_EVENT, onCopyUpdated as EventListener);
    return () => {
      window.removeEventListener(LITO_COPY_UPDATED_EVENT, onCopyUpdated as EventListener);
    };
  }, [activeThread?.recommendation_id, biz?.id, loadStoredCopy]);

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
          <Button size="sm" variant="secondary" className="h-9 px-3 text-xs" onClick={() => void openGeneralThread()}>
            {t('dashboard.litoPage.chat.newThread')}
          </Button>
          <Link
            href={commandCenterHref}
            className="inline-flex h-9 items-center rounded-lg border border-white/10 bg-white/6 px-3 text-xs font-medium text-white/85 transition-colors hover:bg-white/10 hover:text-white"
          >
            {t('dashboard.litoPage.chat.openCommandCenter')}
          </Link>
        </div>
      </header>

      <section className="flex min-h-[72vh] flex-col rounded-2xl border border-white/10 bg-zinc-900/45 backdrop-blur-md">
        <div className="border-b border-white/10 px-4 py-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <label className={cn('text-xs font-medium', textSub)}>
              {t('dashboard.litoPage.chat.threadLabel')}
            </label>
            <Button size="sm" variant="secondary" className="h-8 px-3 text-xs" onClick={() => void openGeneralThread()}>
              {t('dashboard.litoPage.chat.newThread')}
            </Button>
          </div>

          {threadsLoading ? (
            <div className="space-y-2">
              <div className="h-12 animate-pulse rounded-xl border border-white/8 bg-white/6" />
              <div className="h-12 animate-pulse rounded-xl border border-white/8 bg-white/6" />
            </div>
          ) : threads.length > 0 ? (
            <div className="max-h-[220px] space-y-2 overflow-y-auto pr-1">
              {threads.map((thread) => {
                const isActive = activeThreadId === thread.id;
                const isRenaming = renamingThreadId === thread.id;
                const preview = buildThreadPreview(thread);
                const timestamp = formatThreadAgo(thread.updated_at || thread.created_at);
                return (
                  <div
                    key={thread.id}
                    className={cn(
                      'rounded-xl border px-3 py-2 transition-all duration-200 ease-premium',
                      isActive
                        ? 'border-emerald-300/45 bg-emerald-500/12'
                        : 'border-white/10 bg-white/6 hover:border-white/20 hover:bg-white/10',
                    )}
                  >
                    {isRenaming ? (
                      <div className="space-y-2">
                        <input
                          value={renameDraft}
                          onChange={(event) => setRenameDraft(event.target.value)}
                          maxLength={80}
                          className="h-8 w-full rounded-lg border border-white/12 bg-black/35 px-2.5 text-xs text-white outline-none transition-colors duration-200 ease-premium focus:border-emerald-300/35"
                          placeholder={t('dashboard.litoPage.chat.renamePlaceholder')}
                        />
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            className="h-7 px-2.5 text-[11px]"
                            loading={renamingLoading}
                            disabled={renamingLoading}
                            onClick={() => void saveRenaming()}
                          >
                            {t('dashboard.litoPage.chat.renameSave')}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2.5 text-[11px]"
                            disabled={renamingLoading}
                            onClick={cancelRenaming}
                          >
                            {t('dashboard.litoPage.chat.renameCancel')}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            const nextId = thread.id;
                            setActiveThreadId(nextId);
                            replaceQuery({
                              bizId: biz.id,
                              recommendationId: thread.recommendation_id || null,
                              threadId: nextId,
                            });
                          }}
                          className="min-w-0 flex-1 text-left"
                        >
                          <p className="truncate text-sm font-semibold text-white/92">{thread.title}</p>
                          <p className={cn('mt-1 truncate text-xs', textSub)}>
                            {preview || t('dashboard.litoPage.chat.emptyPreview')}
                          </p>
                        </button>
                        <div className="flex shrink-0 items-start gap-2">
                          <span className={cn('pt-0.5 text-[11px]', textSub)}>{timestamp}</span>
                          <button
                            type="button"
                            className="rounded-md border border-white/15 bg-white/6 px-2 py-1 text-[11px] font-medium text-white/75 transition-colors hover:bg-white/12 hover:text-white"
                            onClick={() => startRenaming(thread)}
                          >
                            {t('dashboard.litoPage.chat.rename')}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className={cn('rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-xs', textSub)}>
              {t('dashboard.litoPage.chat.emptyThreads')}
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {activeRecommendation ? (
            <div className="mb-3 rounded-xl border border-white/10 bg-white/6 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="rounded-full border border-white/15 bg-white/6 px-2 py-1 text-[11px] font-medium text-white/75">
                  {t('dashboard.litoPage.thread.assignmentTitle')}
                </span>
                <span className="rounded-full border border-emerald-300/30 bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-200/90">
                  {activeRecommendation.format}
                </span>
              </div>
              <p className={cn('text-xs font-semibold', textMain)}>{activeRecommendation.hook}</p>
              <p className={cn('mt-1 text-sm text-white/80')}>{activeRecommendation.idea}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  loading={copyAction === 'generate'}
                  disabled={Boolean(copyAction)}
                  onClick={() => void runGenerate()}
                >
                  {t('dashboard.home.recommendations.actions.generateLito')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2.5 text-xs"
                  loading={copyAction === 'shorter'}
                  disabled={Boolean(copyAction)}
                  onClick={() => void runQuickRefine('shorter')}
                >
                  {t('dashboard.home.recommendations.lito.refine.shorter')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2.5 text-xs"
                  loading={copyAction === 'premium'}
                  disabled={Boolean(copyAction)}
                  onClick={() => void runQuickRefine('premium')}
                >
                  {t('dashboard.home.recommendations.lito.refine.premium')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2.5 text-xs"
                  loading={copyAction === 'funny'}
                  disabled={Boolean(copyAction)}
                  onClick={() => void runQuickRefine('funny')}
                >
                  {t('dashboard.home.recommendations.lito.refine.funny')}
                </Button>
              </div>
              {quickRefinePrompt ? (
                <p className={cn('mt-2 text-xs text-white/65')}>
                  {quickRefinePrompt}
                </p>
              ) : null}
            </div>
          ) : null}

          {activeRecommendation ? (
            <div className="mb-3 rounded-xl border border-white/10 bg-white/6 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className={cn('text-xs font-semibold uppercase tracking-wide text-white/70')}>
                  {t('dashboard.litoPage.workbench.title')}
                </p>
              </div>

              {copyLoading ? (
                <div className="space-y-2">
                  <div className="h-10 animate-pulse rounded-md border border-white/10 bg-white/6" />
                  <div className="h-10 animate-pulse rounded-md border border-white/10 bg-white/6" />
                </div>
              ) : generatedCopy ? (
                <div className="space-y-2.5">
                  <div className="rounded-md border border-white/10 bg-black/25 p-2.5">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <p className={cn('text-[11px] uppercase tracking-wide text-white/70')}>{t('dashboard.litoPage.workbench.tabs.short')}</p>
                      <Button size="sm" variant="secondary" className="h-6 px-2 text-[11px]" onClick={() => void handleCopyText(generatedCopy.caption_short)}>
                        {t('dashboard.home.recommendations.lito.actions.copy')}
                      </Button>
                    </div>
                    <p className="text-sm text-white/90">{generatedCopy.caption_short}</p>
                  </div>

                  <div className="rounded-md border border-white/10 bg-black/25 p-2.5">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <p className={cn('text-[11px] uppercase tracking-wide text-white/70')}>{t('dashboard.litoPage.workbench.tabs.long')}</p>
                      <Button size="sm" variant="secondary" className="h-6 px-2 text-[11px]" onClick={() => void handleCopyText(generatedCopy.caption_long)}>
                        {t('dashboard.home.recommendations.lito.actions.copy')}
                      </Button>
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-white/90">{generatedCopy.caption_long}</p>
                  </div>

                  <div className="rounded-md border border-white/10 bg-black/25 p-2.5">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <p className={cn('text-[11px] uppercase tracking-wide text-white/70')}>{t('dashboard.litoPage.workbench.tabs.hashtags')}</p>
                      <Button size="sm" variant="secondary" className="h-6 px-2 text-[11px]" onClick={() => void handleCopyText(generatedCopy.hashtags.join(' '))}>
                        {t('dashboard.home.recommendations.lito.actions.copy')}
                      </Button>
                    </div>
                    <p className="text-sm text-white/90">{generatedCopy.hashtags.join(' ') || '—'}</p>
                  </div>

                  <div className="rounded-md border border-white/10 bg-black/25 p-2.5">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <p className={cn('text-[11px] uppercase tracking-wide text-white/70')}>{t('dashboard.litoPage.workbench.tabs.shotlist')}</p>
                      <Button size="sm" variant="secondary" className="h-6 px-2 text-[11px]" onClick={() => void handleCopyText(generatedCopy.shotlist.join('\n'))}>
                        {t('dashboard.home.recommendations.lito.actions.copy')}
                      </Button>
                    </div>
                    <ul className="list-disc space-y-1 pl-4 text-sm text-white/90">
                      {generatedCopy.shotlist.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="rounded-md border border-white/10 bg-black/25 p-2.5">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <p className={cn('text-[11px] uppercase tracking-wide text-white/70')}>{t('dashboard.litoPage.workbench.tabs.imageIdea')}</p>
                      <Button size="sm" variant="secondary" className="h-6 px-2 text-[11px]" onClick={() => void handleCopyText(generatedCopy.image_idea)}>
                        {t('dashboard.home.recommendations.lito.actions.copy')}
                      </Button>
                    </div>
                    <p className="text-sm text-white/90">{generatedCopy.image_idea || '—'}</p>
                  </div>
                </div>
              ) : (
                <p className={cn('rounded-md border border-white/8 bg-white/4 px-2.5 py-2 text-sm', textSub)}>
                  {t('dashboard.litoPage.workbench.previewEmpty')}
                </p>
              )}
            </div>
          ) : null}

          {/* D1.6: IKEA panel is rendered only when ikeaOpen=true */}
          {ikeaOpen && activeRecommendation && ikeaChecklist ? (
            <div className="mb-3 rounded-xl border border-white/10 bg-white/6 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className={cn('text-xs font-semibold uppercase tracking-wide text-white/70')}>
                  {t('dashboard.litoPage.ikea.title')}
                </p>
                <div className="inline-flex rounded-full border border-white/15 bg-white/5 p-0.5">
                  {(['instagram', 'tiktok'] as RecommendationChannel[]).map((channel) => (
                    <button
                      key={`chat-ikea-channel-${channel}`}
                      type="button"
                      onClick={() => setIkeaChannel(channel)}
                      className={cn(
                        'rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors',
                        ikeaChannel === channel
                          ? 'bg-white/15 text-white'
                          : 'text-white/65 hover:bg-white/10 hover:text-white/90',
                      )}
                    >
                      {t(`dashboard.litoPage.ikea.channel.${channel}`)}
                    </button>
                  ))}
                </div>
              </div>
              <ol className="list-decimal space-y-1 pl-4 text-sm text-white/88">
                {ikeaChecklist.steps.map((step, index) => (
                  <li key={`chat-ikea-step-${index}`}>{step}</li>
                ))}
              </ol>
              <p className={cn('mt-3 text-xs font-medium text-white/65')}>{t('dashboard.litoPage.ikea.sectionNotes')}</p>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-white/78">
                {ikeaChecklist.notes.map((note, index) => (
                  <li key={`chat-ikea-note-${index}`}>{note}</li>
                ))}
              </ul>
              <div className="mt-3 flex justify-end">
                <Button size="sm" variant="secondary" className="h-7 px-2.5 text-xs" onClick={() => void handleCopyIkeaChecklist()}>
                  {t('dashboard.litoPage.ikea.copyChecklist')}
                </Button>
              </div>
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
          <div className="mt-2 flex flex-wrap gap-2">
            {/* D1.6: on-demand IKEA toggle — only shown when a recommendation is active */}
            {activeRecommendation && ikeaChecklist ? (
              <button
                type="button"
                onClick={() => setIkeaOpen((prev) => !prev)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
                  ikeaOpen
                    ? 'border-amber-300/40 bg-amber-500/15 text-amber-200 hover:bg-amber-500/20'
                    : 'border-white/15 bg-white/6 text-white/80 hover:bg-white/12 hover:text-white',
                )}
              >
                {ikeaOpen
                  ? t('lito.chat.ikea.toggle_hide')
                  : t('lito.chat.ikea.toggle_show')}
              </button>
            ) : null}
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
        </div>
      </section>
    </div>
  );
}
