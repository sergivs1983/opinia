'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Button from '@/components/ui/Button';
import GlassCard from '@/components/ui/GlassCard';
import EntitlementPaywallModal, { type EntitlementModalType } from '@/components/billing/EntitlementPaywallModal';
import { useT } from '@/components/i18n/I18nContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useToast } from '@/components/ui/Toast';
import { emitLitoCopyUpdated, isLitoCopyUpdatedEvent, LITO_COPY_UPDATED_EVENT } from '@/components/lito/copy-sync';
import { buildFallbackRecommendation } from '@/components/lito/recommendation-fallback';
import { getIkeaChecklist, type RecommendationChannel } from '@/lib/recommendations/howto';
import { humanizeVoiceDraftKind } from '@/lib/lito/voice';
import { cn } from '@/lib/utils';
import { textMain, textSub } from '@/components/ui/glass';
import type {
  LitoGeneratedCopy,
  LitoRecommendationItem,
  LitoRecommendationTemplate,
  LitoThreadItem,
  LitoThreadMessage,
  LitoViewerRole,
  LitoVoiceActionDraft,
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
  used?: number;
  limit?: number;
  cap?: number;
  message?: string;
};

type TrialStatusPayload = {
  ok?: boolean;
  trial_state?: 'none' | 'active' | 'ended';
  days_left?: number;
  trial_ends_at?: string | null;
  cap?: number | null;
  used_estimate?: number;
  error?: string;
  message?: string;
};

type VoicePreparePayload = {
  ok?: boolean;
  mode?: 'record' | 'paste_transcript_only';
  maxSeconds?: number;
  upload?: { mode?: 'record' | 'paste_transcript_only'; maxSeconds?: number };
  provider?: 'openai' | 'anthropic' | 'none';
  error?: string;
  reason?: 'disabled' | 'ok';
  message?: string;
};

type VoiceTranscribePayload = {
  ok?: boolean;
  clip_id?: string;
  idempotent?: boolean;
  transcript?: { text?: string; lang?: string };
  actions?: LitoVoiceActionDraft[];
  messages?: LitoThreadMessage[];
  viewer_role?: LitoViewerRole;
  error?: string;
  message?: string;
};

type VoiceSttPayload = {
  ok?: boolean;
  clip_id?: string;
  idempotent?: boolean;
  transcript?: string;
  transcript_lang?: string;
  error?: string;
  reason?: string;
  message?: string;
};

type VoiceTtsPayload = {
  ok?: boolean;
  cached?: boolean;
  clip_id?: string;
  audio_url?: string;
  transcript_lang?: string;
  error?: string;
  reason?: string;
  message?: string;
};

type VoiceDraftsPayload = {
  ok?: boolean;
  items?: LitoVoiceActionDraft[];
  viewer_role?: LitoViewerRole;
  error?: string;
  message?: string;
};

type VoiceDraftMutationPayload = {
  ok?: boolean;
  draft?: LitoVoiceActionDraft;
  error?: string;
  message?: string;
};

type LitoSignalCard = {
  id: string;
  source: 'signal' | 'evergreen';
  kind: 'alert' | 'opportunity';
  code: string;
  severity: 'low' | 'med' | 'high';
  title: string;
  reason: string;
  data?: Record<string, unknown>;
  cta_label: string;
  cta_route: string;
};

type SignalsProPayload = {
  ok?: boolean;
  signals?: LitoSignalCard[];
  signal?: LitoSignalCard | null;
  source?: 'signal' | 'evergreen';
  error?: string;
  message?: string;
};

type InlineActionDraft = {
  id: string;
  kind: LitoVoiceActionDraft['kind'];
  status: LitoVoiceActionDraft['status'];
  title?: string;
  summary?: string;
  payload?: Record<string, unknown>;
};

type QuickRefineMode = 'shorter' | 'premium' | 'funny';

type BrowserSpeechRecognitionResult = {
  transcript?: string;
};

type BrowserSpeechRecognitionEvent = {
  results?: ArrayLike<ArrayLike<BrowserSpeechRecognitionResult>>;
  error?: string;
};

type BrowserSpeechRecognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

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

function voiceDraftStatusLabel(status: LitoVoiceActionDraft['status']): string {
  if (status === 'pending_review') return 'pending_review';
  if (status === 'approved') return 'approved';
  if (status === 'rejected') return 'rejected';
  if (status === 'executed') return 'executed';
  return 'draft';
}

function extractVoiceDraftSummary(payload: Record<string, unknown>): string {
  const summary = payload.human_summary ?? payload.summary;
  if (typeof summary === 'string' && summary.trim().length > 0) return summary.trim();
  const action = payload.action;
  if (typeof action === 'string' && action.trim().length > 0) return action.trim();
  return 'Sense resum';
}

function createClientRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isVoiceDraftKind(value: unknown): value is LitoVoiceActionDraft['kind'] {
  return value === 'gbp_update' || value === 'social_post' || value === 'customer_email';
}

function isVoiceDraftStatus(value: unknown): value is LitoVoiceActionDraft['status'] {
  return value === 'draft'
    || value === 'pending_review'
    || value === 'approved'
    || value === 'rejected'
    || value === 'executed';
}

function extractInlineVoiceDrafts(meta: unknown): InlineActionDraft[] {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return [];
  const data = meta as Record<string, unknown>;
  if (!Array.isArray(data.inline_drafts)) return [];

  return data.inline_drafts
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const raw = item as Record<string, unknown>;
      if (typeof raw.id !== 'string' || !isVoiceDraftKind(raw.kind) || !isVoiceDraftStatus(raw.status)) return null;
      return {
        id: raw.id,
        kind: raw.kind,
        status: raw.status,
        title: typeof raw.title === 'string' ? raw.title : undefined,
        summary: typeof raw.summary === 'string' ? raw.summary : undefined,
        payload: raw.payload && typeof raw.payload === 'object' && !Array.isArray(raw.payload)
          ? raw.payload as Record<string, unknown>
          : undefined,
      } as InlineActionDraft;
    })
    .filter((item): item is InlineActionDraft => Boolean(item));
}

function withInlineVoiceDrafts(params: {
  messages: LitoThreadMessage[] | undefined;
  actions: LitoVoiceActionDraft[] | undefined;
  clipId?: string;
}): LitoThreadMessage[] {
  const baseMessages = Array.isArray(params.messages) ? params.messages : [];
  const actions = Array.isArray(params.actions) ? params.actions : [];
  if (baseMessages.length === 0 || actions.length === 0) return baseMessages;

  const inlineDrafts = actions.map((item) => ({
    id: item.id,
    kind: item.kind,
    status: item.status,
    summary: extractVoiceDraftSummary(item.payload || {}),
    payload: (item.payload || {}) as Record<string, unknown>,
  }));

  return baseMessages.map((message) => {
    if (message.role !== 'assistant') return message;
    const existingInline = extractInlineVoiceDrafts(message.meta);
    if (existingInline.length > 0) return message;

    const metaBase = message.meta && typeof message.meta === 'object' && !Array.isArray(message.meta)
      ? message.meta as Record<string, unknown>
      : {};

    return {
      ...message,
      meta: {
        ...metaBase,
        type: typeof metaBase.type === 'string' ? metaBase.type : 'voice_actions_summary',
        clip_id: typeof metaBase.clip_id === 'string' ? metaBase.clip_id : params.clipId,
        inline_drafts: inlineDrafts,
      },
    };
  });
}

function resolveInlineVoiceDrafts(params: {
  message: LitoThreadMessage;
  bizId: string;
  voiceDraftById: Map<string, LitoVoiceActionDraft>;
}): LitoVoiceActionDraft[] {
  const inlineDrafts = extractInlineVoiceDrafts(params.message.meta);
  if (inlineDrafts.length === 0) return [];

  return inlineDrafts.map((inlineDraft) => {
    const liveDraft = params.voiceDraftById.get(inlineDraft.id);
    if (liveDraft) return liveDraft;

    return {
      id: inlineDraft.id,
      org_id: '',
      biz_id: params.bizId,
      thread_id: params.message.thread_id,
      source_voice_clip_id: null,
      kind: inlineDraft.kind,
      status: inlineDraft.status,
      payload: inlineDraft.payload || (inlineDraft.summary ? { human_summary: inlineDraft.summary } : {}),
      created_by: '',
      reviewed_by: null,
      created_at: params.message.created_at,
      updated_at: params.message.created_at,
    };
  });
}

/**
 * D1.7: Detect format from thread title.
 * After auto-rename titles look like "Reel: Hook text" or "LITO — Reel: Hook text".
 */
function detectFormatFromTitle(title: string): 'Post' | 'Story' | 'Reel' | null {
  if (/^Reel:/i.test(title)) return 'Reel';
  if (/^Story:/i.test(title)) return 'Story';
  if (/^Post:/i.test(title)) return 'Post';
  if (/LITO\s*—\s*Reel:/i.test(title)) return 'Reel';
  if (/LITO\s*—\s*Story:/i.test(title)) return 'Story';
  if (/LITO\s*—\s*Post:/i.test(title)) return 'Post';
  return null;
}

function normalizeSignalFormat(signal: LitoSignalCard | null): 'post' | 'story' | 'reel' {
  const raw = signal?.data && typeof signal.data === 'object'
    ? (signal.data as Record<string, unknown>).format
    : null;
  if (raw === 'story' || raw === 'reel') return raw;
  return 'post';
}

function signalRecommendationId(signal: LitoSignalCard | null): string | null {
  const raw = signal?.data && typeof signal.data === 'object'
    ? (signal.data as Record<string, unknown>).recommendation_id
    : null;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

function buildSignalKickoffMessage(signal: LitoSignalCard): string {
  const nowSteps = (() => {
    switch (signal.code) {
      case 'REPUTATION_LEAK':
        return [
          '1) Respon primer les 2 ressenyes més crítiques amb to empàtic.',
          '2) Publica un missatge curt explicant la millora immediata.',
        ];
      case 'TOPIC_RECURRENT':
        return [
          '1) Ataca el tema recurrent amb una resposta clara i concreta.',
          '2) Publica una peça curta mostrant la solució en marxa.',
        ];
      case 'LANGUAGE_SHIFT':
        return [
          '1) Adapta la resposta al nou idioma dominant detectat.',
          '2) Publica una versió curta en aquest idioma per connectar millor.',
        ];
      case 'VIP_REVIEW':
        return [
          '1) Reaprofita la ressenya VIP com a prova social.',
          '2) Llença un post breu amb CTA a reserva/visita.',
        ];
      case 'DIGITAL_SILENCE':
        return [
          '1) Reactiva conversa amb un contingut simple de valor local.',
          '2) Tanca amb pregunta directa per generar interacció.',
        ];
      case 'OPPORTUNITY_TREND':
        return [
          '1) Publica avui sobre el tema en tendència positiva.',
          '2) Afegeix CTA curt per convertir interacció en acció.',
        ];
      default:
        return [
          '1) Llença una peça curta i clara avui mateix.',
          '2) Tanca amb CTA concret per moure una acció.',
        ];
    }
  })();

  return [
    `Què he detectat: ${signal.title}. ${signal.reason}`,
    '',
    'Ara mateix:',
    ...nowSteps,
    '',
    'Vols resposta curta o més detall? (A/B)',
  ].join('\n');
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
  const [trialState, setTrialState] = useState<'none' | 'active' | 'ended'>('none');
  const [trialDaysLeft, setTrialDaysLeft] = useState<number>(0);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [paywallType, setPaywallType] = useState<EntitlementModalType>('quota_exceeded');
  const [paywallUsed, setPaywallUsed] = useState<number | undefined>(undefined);
  const [paywallLimit, setPaywallLimit] = useState<number | undefined>(undefined);
  const [ikeaChannel, setIkeaChannel] = useState<RecommendationChannel>('instagram');
  // D1.6: IKEA panel is hidden by default; user opens it on-demand
  const [ikeaOpen, setIkeaOpen] = useState(false);
  const [renamingThreadId, setRenamingThreadId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [renamingLoading, setRenamingLoading] = useState(false);
  const [voicePreparing, setVoicePreparing] = useState(false);
  const [voiceSheetOpen, setVoiceSheetOpen] = useState(false);
  const [voiceSubmitting, setVoiceSubmitting] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [voiceTranscriptLang, setVoiceTranscriptLang] = useState('ca');
  const [voiceDrafts, setVoiceDrafts] = useState<LitoVoiceActionDraft[]>([]);
  const [voiceViewerRole, setVoiceViewerRole] = useState<LitoViewerRole>(null);
  const [voiceExpandedDraftId, setVoiceExpandedDraftId] = useState<string | null>(null);
  const [voiceEditingDraftId, setVoiceEditingDraftId] = useState<string | null>(null);
  const [voiceEditingSummary, setVoiceEditingSummary] = useState('');
  const [voiceRecording, setVoiceRecording] = useState(false);
  const [voiceSpeechSupported, setVoiceSpeechSupported] = useState(false);
  const [voicePrepareMode, setVoicePrepareMode] = useState<'record' | 'paste_transcript_only'>('paste_transcript_only');
  const [voiceAudioFile, setVoiceAudioFile] = useState<File | null>(null);
  const [voiceSttLoading, setVoiceSttLoading] = useState(false);
  const [ttsLoadingMessageId, setTtsLoadingMessageId] = useState<string | null>(null);
  const [activeSignal, setActiveSignal] = useState<LitoSignalCard | null>(null);

  const bootstrapRef = useRef<string | null>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsUrlCacheRef = useRef<Map<string, string>>(new Map());
  const queryBizId = searchParams.get('biz_id');
  const queryRecommendationId = searchParams.get('recommendation_id');
  const queryThreadId = searchParams.get('thread_id');
  const querySignalId = searchParams.get('signal_id');

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

  const openPaywall = useCallback((type: EntitlementModalType, payload?: GeneratePayload) => {
    setPaywallType(type);
    setPaywallUsed(typeof payload?.used === 'number' ? payload.used : undefined);
    const resolvedLimit = typeof payload?.cap === 'number'
      ? payload.cap
      : typeof payload?.limit === 'number'
        ? payload.limit
        : undefined;
    setPaywallLimit(resolvedLimit);
    setPaywallOpen(true);
  }, []);

  const replaceQuery = useCallback((next: {
    bizId?: string | null;
    recommendationId?: string | null;
    threadId?: string | null;
    signalId?: string | null;
  }) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next.bizId) params.set('biz_id', next.bizId);
    else params.delete('biz_id');
    if (next.recommendationId) params.set('recommendation_id', next.recommendationId);
    else params.delete('recommendation_id');
    if (next.threadId) params.set('thread_id', next.threadId);
    else params.delete('thread_id');
    if (next.signalId) params.set('signal_id', next.signalId);
    else params.delete('signal_id');
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

  const loadSignalContext = useCallback(async (signalId: string): Promise<LitoSignalCard | null> => {
    if (!biz?.id) return null;
    try {
      const response = await fetch(
        `/api/lito/signals-pro?biz_id=${biz.id}&signal_id=${signalId}&range_days=7`,
        { cache: 'no-store' },
      );
      const payload = (await response.json().catch(() => ({}))) as SignalsProPayload;
      if (response.status === 401) {
        router.push('/login');
        return null;
      }
      if (!response.ok || payload.error) {
        setActiveSignal(null);
        return null;
      }
      const signal = payload.signal || payload.signals?.[0] || null;
      setActiveSignal(signal || null);
      return signal || null;
    } catch {
      setActiveSignal(null);
      return null;
    }
  }, [biz?.id, router]);

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

  const loadVoiceDrafts = useCallback(async () => {
    if (!biz?.id) return;
    try {
      const response = await fetch(`/api/lito/action-drafts?biz_id=${biz.id}&limit=20`);
      const payload = (await response.json().catch(() => ({}))) as VoiceDraftsPayload;
      if (!response.ok || payload.error) {
        setVoiceDrafts([]);
        return;
      }
      setVoiceDrafts(payload.items || []);
      if (payload.viewer_role) setVoiceViewerRole(payload.viewer_role);
    } catch {
      setVoiceDrafts([]);
    }
  }, [biz?.id]);

  const loadTrialStatus = useCallback(async () => {
    if (!biz?.org_id) {
      setTrialState('none');
      setTrialDaysLeft(0);
      return;
    }
    try {
      const response = await fetch(`/api/billing/trial?org_id=${biz.org_id}`);
      const payload = (await response.json().catch(() => ({}))) as TrialStatusPayload;
      if (!response.ok || payload.error) {
        setTrialState('none');
        setTrialDaysLeft(0);
        return;
      }
      const state = payload.trial_state || 'none';
      setTrialState(state);
      setTrialDaysLeft(typeof payload.days_left === 'number' ? Math.max(0, payload.days_left) : 0);
    } catch {
      setTrialState('none');
      setTrialDaysLeft(0);
    }
  }, [biz?.org_id]);

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
      if (response.status === 402 && payload.error === 'trial_ended') {
        openPaywall('trial_ended', payload);
        toast(payload.message || t('dashboard.litoPage.messages.trialEnded'), 'warning');
        return;
      }
      if (response.status === 402 && payload.error === 'trial_cap_reached') {
        openPaywall('trial_cap_reached', payload);
        toast(payload.message || t('dashboard.litoPage.messages.trialCapReached'), 'warning');
        return;
      }
      if (payload.error === 'quota_exceeded' || (response.status === 402 && !payload.error)) {
        openPaywall('quota_exceeded', payload);
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
  }, [activeRecommendation?.format, activeRecommendation?.id, aiReasonMessage, biz?.id, openPaywall, t, toast]);

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
      if (response.status === 402 && payload.error === 'trial_ended') {
        openPaywall('trial_ended', payload);
        toast(payload.message || t('dashboard.litoPage.messages.trialEnded'), 'warning');
        return;
      }
      if (response.status === 402 && payload.error === 'trial_cap_reached') {
        openPaywall('trial_cap_reached', payload);
        toast(payload.message || t('dashboard.litoPage.messages.trialCapReached'), 'warning');
        return;
      }
      if (payload.error === 'quota_exceeded' || (response.status === 402 && !payload.error)) {
        openPaywall('quota_exceeded', payload);
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
  }, [activeRecommendation?.id, aiReasonMessage, biz?.id, openPaywall, t, toast]);

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
    signalId?: string | null;
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
        signalId: options.signalId ?? null,
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

  const openVoiceSheet = useCallback(async () => {
    if (!biz?.id) {
      toast(t('dashboard.litoPage.chat.threadRequired'), 'warning');
      return;
    }

    setVoicePreparing(true);
    try {
      const response = await fetch('/api/lito/voice/prepare', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-request-id': createClientRequestId(),
        },
        cache: 'no-store',
        body: JSON.stringify({
          biz_id: biz.id,
          thread_id: activeThreadId || undefined,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as VoicePreparePayload;
      if (response.status === 401) {
        router.push('/login');
        return;
      }
      if (response.status === 503 || payload.error === 'voice_unavailable') {
        toast(payload.message || t('dashboard.litoPage.voice.unavailable'), 'warning');
        return;
      }
      if (!response.ok || payload.error) {
        throw new Error(payload.message || t('dashboard.litoPage.voice.prepareError'));
      }
      const nextMode = payload.mode || payload.upload?.mode || 'paste_transcript_only';
      setVoicePrepareMode(nextMode);
      setVoiceSheetOpen(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : t('dashboard.litoPage.voice.prepareError');
      toast(message, 'error');
    } finally {
      setVoicePreparing(false);
    }
  }, [activeThreadId, biz?.id, router, t, toast]);

  const startVoiceCapture = useCallback(() => {
    if (voicePrepareMode !== 'record') {
      toast(t('dashboard.litoPage.voice.manualOnly'), 'warning');
      return;
    }
    if (typeof window === 'undefined') return;
    const speechWindow = window as Window & {
      SpeechRecognition?: BrowserSpeechRecognitionConstructor;
      webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
    };
    const RecognitionCtor = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!RecognitionCtor) {
      toast(t('dashboard.litoPage.voice.speechUnsupported'), 'warning');
      return;
    }

    if (!recognitionRef.current) {
      const instance = new RecognitionCtor();
      instance.lang = voiceTranscriptLang === 'es' ? 'es-ES' : voiceTranscriptLang === 'en' ? 'en-US' : 'ca-ES';
      instance.interimResults = true;
      instance.continuous = false;
      instance.onresult = (event) => {
        const chunks: string[] = [];
        const results = event.results ? Array.from(event.results) : [];
        for (const item of results) {
          const transcript = item?.[0]?.transcript;
          if (typeof transcript === 'string' && transcript.trim()) {
            chunks.push(transcript.trim());
          }
        }
        if (chunks.length > 0) {
          setVoiceTranscript((previous) => `${previous} ${chunks.join(' ')}`.trim());
        }
      };
      instance.onerror = () => {
        setVoiceRecording(false);
      };
      instance.onend = () => {
        setVoiceRecording(false);
      };
      recognitionRef.current = instance;
    }

    recognitionRef.current.lang = voiceTranscriptLang === 'es' ? 'es-ES' : voiceTranscriptLang === 'en' ? 'en-US' : 'ca-ES';
    setVoiceRecording(true);
    recognitionRef.current.start();
  }, [t, toast, voicePrepareMode, voiceTranscriptLang]);

  const stopVoiceCapture = useCallback(() => {
    setVoiceRecording(false);
    recognitionRef.current?.stop();
  }, []);

  const playAudioUrl = useCallback(async (url: string) => {
    try {
      if (ttsAudioRef.current) {
        ttsAudioRef.current.pause();
      }
      const audio = new Audio(url);
      ttsAudioRef.current = audio;
      await audio.play();
    } catch {
      throw new Error(t('dashboard.litoPage.voice.ttsError'));
    }
  }, [t]);

  const handlePlayMessageAudio = useCallback(async (message: LitoThreadMessage) => {
    if (!biz?.id || message.role !== 'assistant') return;
    if (ttsLoadingMessageId === message.id) return;

    const cachedUrl = ttsUrlCacheRef.current.get(message.id);
    if (cachedUrl) {
      try {
        await playAudioUrl(cachedUrl);
        return;
      } catch (error) {
        const errMessage = error instanceof Error ? error.message : t('dashboard.litoPage.voice.ttsError');
        toast(errMessage, 'error');
        return;
      }
    }

    setTtsLoadingMessageId(message.id);
    try {
      const response = await fetch('/api/lito/voice/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-request-id': createClientRequestId(),
        },
        cache: 'no-store',
        body: JSON.stringify({
          biz_id: biz.id,
          message_id: message.id,
          lang: voiceTranscriptLang,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as VoiceTtsPayload;

      if (response.status === 401) {
        router.push('/login');
        return;
      }
      if (response.status === 503 || payload.error === 'voice_unavailable') {
        toast(payload.message || t('dashboard.litoPage.voice.unavailable'), 'warning');
        return;
      }
      if (!response.ok || payload.error || !payload.audio_url) {
        throw new Error(payload.message || t('dashboard.litoPage.voice.ttsError'));
      }

      ttsUrlCacheRef.current.set(message.id, payload.audio_url);
      await playAudioUrl(payload.audio_url);
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : t('dashboard.litoPage.voice.ttsError');
      toast(errMessage, 'error');
    } finally {
      setTtsLoadingMessageId(null);
    }
  }, [biz?.id, playAudioUrl, router, t, toast, ttsLoadingMessageId, voiceTranscriptLang]);

  const handleVoiceSttFromFile = useCallback(async () => {
    if (!voiceAudioFile || !biz?.id) {
      toast(t('dashboard.litoPage.voice.transcriptRequired'), 'warning');
      return;
    }

    setVoiceSttLoading(true);
    try {
      const formData = new FormData();
      formData.append('biz_id', biz.id);
      if (activeThreadId) formData.append('thread_id', activeThreadId);
      formData.append('lang', voiceTranscriptLang);
      formData.append('audio', voiceAudioFile);

      const response = await fetch('/api/lito/voice/stt', {
        method: 'POST',
        headers: {
          'x-request-id': createClientRequestId(),
        },
        cache: 'no-store',
        body: formData,
      });
      const payload = (await response.json().catch(() => ({}))) as VoiceSttPayload;

      if (response.status === 401) {
        router.push('/login');
        return;
      }
      if (response.status === 503 || payload.error === 'voice_unavailable') {
        toast(payload.message || t('dashboard.litoPage.voice.unavailable'), 'warning');
        return;
      }
      if (!response.ok || payload.error || !payload.transcript) {
        throw new Error(payload.message || t('dashboard.litoPage.voice.sttError'));
      }

      setVoiceTranscript(payload.transcript);
      if (payload.transcript_lang) {
        setVoiceTranscriptLang(payload.transcript_lang);
      }
      setVoiceAudioFile(null);
      toast(t('dashboard.litoPage.voice.sttSuccess'), 'success');
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : t('dashboard.litoPage.voice.sttError');
      toast(errMessage, 'error');
    } finally {
      setVoiceSttLoading(false);
    }
  }, [activeThreadId, biz?.id, router, t, toast, voiceAudioFile, voiceTranscriptLang]);

  const handleVoiceDraftMutation = useCallback(async (
    draftId: string,
    action: 'approve' | 'reject' | 'execute' | 'submit',
  ) => {
    try {
      const response = await fetch(`/api/lito/action-drafts/${draftId}/${action}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-request-id': createClientRequestId(),
        },
        cache: 'no-store',
      });
      const payload = (await response.json().catch(() => ({}))) as VoiceDraftMutationPayload;
      if (response.status === 401) {
        router.push('/login');
        return;
      }
      if (!response.ok || payload.error || !payload.draft) {
        throw new Error(payload.message || t('dashboard.litoPage.voice.actionError'));
      }
      setVoiceDrafts((previous) => previous.map((item) => (item.id === payload.draft!.id ? payload.draft! : item)));
      await loadVoiceDrafts();
      const successMessage = action === 'submit'
        ? t('dashboard.litoPage.voice.inline.submitted_toast')
        : action === 'execute'
          ? t('dashboard.litoPage.voice.inline.executed_toast')
          : t('dashboard.litoPage.voice.actionSuccess');
      toast(successMessage, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : t('dashboard.litoPage.voice.actionError');
      toast(message, 'error');
    }
  }, [loadVoiceDrafts, router, t, toast]);

  const handleSaveVoiceDraftEdit = useCallback(async (draft: LitoVoiceActionDraft) => {
    const nextSummary = voiceEditingSummary.trim();
    if (nextSummary.length < 3) {
      toast(t('dashboard.litoPage.voice.editValidation'), 'warning');
      return;
    }
    const nextPayload = {
      ...(draft.payload || {}),
      human_summary: nextSummary,
    };

    try {
      const response = await fetch(`/api/lito/action-drafts/${draft.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-request-id': createClientRequestId(),
        },
        cache: 'no-store',
        body: JSON.stringify({ payload: nextPayload }),
      });
      const payload = (await response.json().catch(() => ({}))) as VoiceDraftMutationPayload;
      if (response.status === 401) {
        router.push('/login');
        return;
      }
      if (!response.ok || payload.error || !payload.draft) {
        throw new Error(payload.message || t('dashboard.litoPage.voice.editError'));
      }
      setVoiceDrafts((previous) => previous.map((item) => (item.id === payload.draft!.id ? payload.draft! : item)));
      setVoiceEditingDraftId(null);
      setVoiceEditingSummary('');
      await loadVoiceDrafts();
      toast(t('dashboard.litoPage.voice.editSuccess'), 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : t('dashboard.litoPage.voice.editError');
      toast(message, 'error');
    }
  }, [loadVoiceDrafts, router, t, toast, voiceEditingSummary]);

  const handleVoiceTranscribe = useCallback(async () => {
    const transcript = voiceTranscript.trim();
    if (!biz?.id || transcript.length < 3) {
      toast(t('dashboard.litoPage.voice.transcriptRequired'), 'warning');
      return;
    }

    setVoiceSubmitting(true);
    try {
      const recommendationContext = {
        recommendationId: activeRecommendation?.id ?? null,
        format: activeRecommendation?.format === 'story' || activeRecommendation?.format === 'reel'
          ? activeRecommendation.format
          : 'post',
        hook: activeRecommendation?.hook || null,
        signalId: activeSignal?.id ?? querySignalId ?? null,
      } as const;

      let threadId = activeThreadId;
      if (!threadId) {
        const createdThread = await openOrCreateThread(recommendationContext);
        threadId = createdThread?.id || null;
      }

      if (!threadId) {
        toast(t('dashboard.litoPage.chat.threadRequired'), 'warning');
        return;
      }

      const postTranscriptToThread = async (targetThreadId: string): Promise<{
        response: Response;
        payload: { messages?: LitoThreadMessage[]; error?: string; message?: string };
      }> => {
        const response = await fetch(`/api/lito/threads/${targetThreadId}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-request-id': createClientRequestId(),
          },
          cache: 'no-store',
          body: JSON.stringify({ content: transcript }),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          messages?: LitoThreadMessage[];
          error?: string;
          message?: string;
        };
        return { response, payload };
      };

      let postResult = await postTranscriptToThread(threadId);
      if (postResult.response.status === 401) {
        router.push('/login');
        return;
      }
      if (postResult.response.status === 404 || postResult.payload.error === 'not_found') {
        const recoveredThread = await openOrCreateThread(recommendationContext);
        threadId = recoveredThread?.id || null;
        if (!threadId) {
          toast(t('dashboard.litoPage.chat.threadRequired'), 'warning');
          return;
        }
        postResult = await postTranscriptToThread(threadId);
      }
      if (postResult.response.status === 401) {
        router.push('/login');
        return;
      }
      if (postResult.response.status >= 500) {
        throw new Error(t('dashboard.litoPage.chat.sendServerError'));
      }
      if (!postResult.response.ok || postResult.payload.error) {
        throw new Error(postResult.payload.message || t('dashboard.home.recommendations.lito.sendError'));
      }

      const response = await fetch('/api/lito/voice/transcribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-request-id': createClientRequestId(),
        },
        cache: 'no-store',
        body: JSON.stringify({
          biz_id: biz.id,
          thread_id: threadId,
          transcript_text: transcript,
          transcript_lang: voiceTranscriptLang,
          append_user_message: false,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as VoiceTranscribePayload;

      if (response.status === 401) {
        router.push('/login');
        return;
      }
      if (response.status === 503 || payload.error === 'voice_unavailable') {
        toast(payload.message || t('dashboard.litoPage.voice.unavailable'), 'warning');
        return;
      }
      if (!response.ok || payload.error) {
        throw new Error(payload.message || t('dashboard.litoPage.voice.transcribeError'));
      }

      if (payload.viewer_role) {
        setVoiceViewerRole(payload.viewer_role);
      }

      if (payload.actions && payload.actions.length > 0) {
        setVoiceDrafts((previous) => {
          const map = new Map<string, LitoVoiceActionDraft>();
          for (const item of previous) map.set(item.id, item);
          for (const item of payload.actions || []) map.set(item.id, item);
          return Array.from(map.values()).sort((a, b) => (
            Date.parse(b.updated_at || b.created_at) - Date.parse(a.updated_at || a.created_at)
          ));
        });
      }

      setActiveThreadId(threadId);
      const postedMessages = Array.isArray(postResult.payload.messages) ? postResult.payload.messages : [];
      if (postedMessages.length > 0) {
        setMessages((previous) => [...previous, ...postedMessages]);
      }
      const voiceMessages = withInlineVoiceDrafts({
        messages: payload.messages,
        actions: payload.actions,
        clipId: payload.clip_id,
      });
      if (voiceMessages.length > 0) {
        setMessages((previous) => [...previous, ...voiceMessages]);
      } else if (payload.actions && payload.actions.length > 0) {
        const inlineDrafts = payload.actions.map((item) => ({
          id: item.id,
          kind: item.kind,
          status: item.status,
          summary: extractVoiceDraftSummary(item.payload || {}),
          payload: (item.payload || {}) as Record<string, unknown>,
        }));
        const fallbackAssistantMessage: LitoThreadMessage = {
          id: `voice-inline-${payload.clip_id || Date.now()}`,
          thread_id: threadId,
          role: 'assistant',
          content: t('dashboard.litoPage.voice.inline.summaryFallback', { count: String(payload.actions.length) }),
          meta: {
            type: 'voice_actions_summary',
            clip_id: payload.clip_id || null,
            actions_count: payload.actions.length,
            inline_drafts: inlineDrafts,
          },
          created_at: new Date().toISOString(),
        };
        setMessages((previous) => [...previous, fallbackAssistantMessage]);
      }

      setVoiceSheetOpen(false);
      setVoiceTranscript('');
      setVoiceAudioFile(null);
      setVoiceExpandedDraftId(null);
      setVoiceEditingDraftId(null);
      setVoiceEditingSummary('');
      await loadThreads();
      await loadVoiceDrafts();
      toast(t('dashboard.litoPage.voice.transcribeSuccess'), 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : t('dashboard.litoPage.voice.transcribeError');
      toast(message, 'error');
    } finally {
      setVoiceSubmitting(false);
    }
  }, [
    activeRecommendation?.format,
    activeRecommendation?.hook,
    activeRecommendation?.id,
    activeSignal?.id,
    activeThreadId,
    biz?.id,
    loadThreads,
    loadVoiceDrafts,
    openOrCreateThread,
    router,
    t,
    toast,
    querySignalId,
    voiceTranscript,
    voiceTranscriptLang,
  ]);

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
      signalId: activeSignal?.id ?? querySignalId ?? null,
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
    activeSignal?.id,
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
    querySignalId,
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
    setVoiceDrafts([]);
    setVoiceViewerRole(null);
    void loadWeeklyRecommendations();
    void loadThreads();
    void loadVoiceDrafts();
    void loadTrialStatus();
  }, [biz?.id, loadThreads, loadTrialStatus, loadVoiceDrafts, loadWeeklyRecommendations]);

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
    if (querySignalId) {
      void (async () => {
        const signal = await loadSignalContext(querySignalId);
        const recommendationId = signalRecommendationId(signal);
        await openOrCreateThread({
          recommendationId,
          format: normalizeSignalFormat(signal),
          hook: signal?.title || null,
          signalId: querySignalId,
        });
      })();
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
    querySignalId,
    queryThreadId,
    loadSignalContext,
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
    if (!biz?.id || !querySignalId) {
      setActiveSignal(null);
      return;
    }
    void loadSignalContext(querySignalId);
  }, [biz?.id, loadSignalContext, querySignalId]);

  useEffect(() => {
    if (!activeSignal || !activeThreadId) return;
    const alreadyExists = messages.some((message) => {
      if (message.role !== 'assistant' || !message.meta || typeof message.meta !== 'object' || Array.isArray(message.meta)) {
        return false;
      }
      const meta = message.meta as Record<string, unknown>;
      return meta.type === 'signal_kickoff' && meta.signal_id === activeSignal.id;
    });
    if (alreadyExists) return;

    const kickoffMessage: LitoThreadMessage = {
      id: `signal-kickoff-${activeSignal.id}-${activeThreadId}`,
      thread_id: activeThreadId,
      role: 'assistant',
      content: buildSignalKickoffMessage(activeSignal),
      meta: {
        type: 'signal_kickoff',
        signal_id: activeSignal.id,
        signal_code: activeSignal.code,
      },
      created_at: new Date().toISOString(),
    };

    setMessages((previous) => {
      const exists = previous.some((message) => {
        if (message.role !== 'assistant' || !message.meta || typeof message.meta !== 'object' || Array.isArray(message.meta)) {
          return false;
        }
        const meta = message.meta as Record<string, unknown>;
        return meta.type === 'signal_kickoff' && meta.signal_id === activeSignal.id;
      });
      if (exists) return previous;
      return [...previous, kickoffMessage];
    });
  }, [activeSignal, activeThreadId, messages]);

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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const speechWindow = window as Window & {
      SpeechRecognition?: BrowserSpeechRecognitionConstructor;
      webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
    };
    setVoiceSpeechSupported(Boolean(speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition));
  }, []);

  useEffect(() => () => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
  }, []);

  useEffect(() => () => {
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current.src = '';
      ttsAudioRef.current = null;
    }
    ttsUrlCacheRef.current.clear();
  }, []);

  const visibleMessages = useMemo(() => sanitizeMessages(messages), [messages]);
  const voiceDraftById = useMemo(
    () => new Map(voiceDrafts.map((draft) => [draft.id, draft])),
    [voiceDrafts],
  );
  const canConfirmVoiceActions = voiceViewerRole === 'owner' || voiceViewerRole === 'manager';
  const canRecordWithBrowser = voicePrepareMode === 'record' && voiceSpeechSupported;

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
          {activeSignal ? (
            <p className="mt-2 inline-flex rounded-full border border-emerald-300/35 bg-emerald-500/12 px-2.5 py-1 text-[11px] font-medium text-emerald-100">
              Context carregat: {activeSignal.title}
            </p>
          ) : null}
          {trialState === 'active' ? (
            <p className="mt-2 inline-flex rounded-full border border-cyan-300/35 bg-cyan-500/12 px-2.5 py-1 text-[11px] font-medium text-cyan-200">
              {t('dashboard.litoPage.trial.activeBadge', { days: trialDaysLeft })}
            </p>
          ) : null}
          {trialState === 'ended' ? (
            <p className="mt-2 inline-flex rounded-full border border-amber-300/35 bg-amber-500/12 px-2.5 py-1 text-[11px] font-medium text-amber-200">
              {t('dashboard.litoPage.trial.readOnlyBadge')}
            </p>
          ) : null}
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
                const timestamp = formatThreadAgo(thread.updated_at || thread.created_at);
                const formatChip = detectFormatFromTitle(thread.title);
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
                          <div className="flex min-w-0 items-center gap-1.5">
                            <p className="truncate text-sm font-semibold text-white/92">{thread.title}</p>
                            {formatChip ? (
                              <span className="shrink-0 rounded border border-white/15 bg-white/8 px-1.5 py-0.5 text-[10px] font-medium text-white/60">
                                {formatChip}
                              </span>
                            ) : null}
                          </div>
                          <p className={cn('mt-0.5 text-xs', textSub)}>{timestamp}</p>
                        </button>
                        <div className="flex shrink-0 items-start">
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
              {generatedCopy && activeRecommendation && canConfirmVoiceActions && biz?.id ? (
                <div className="mt-2 flex justify-end">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-7 px-2.5 text-xs"
                    onClick={() => router.push(`/dashboard/planner?biz_id=${encodeURIComponent(biz.id)}&recommendation_id=${encodeURIComponent(activeRecommendation.id)}`)}
                  >
                    {t('dashboard.home.socialPlanner.scheduleButton')}
                  </Button>
                </div>
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

          {voiceDrafts.length > 0 ? (
            <div className="mb-3 rounded-xl border border-white/10 bg-white/6 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className={cn('text-xs font-semibold uppercase tracking-wide text-white/70')}>
                  {t('dashboard.litoPage.voice.generatedActionsTitle')}
                </p>
                <span className="rounded-full border border-amber-300/30 bg-amber-500/12 px-2 py-0.5 text-[11px] font-semibold text-amber-200">
                  {voiceDrafts.length}
                </span>
              </div>

              <div className="space-y-2">
                {voiceDrafts.slice(0, 6).map((draft) => {
                  const payload = (draft.payload || {}) as Record<string, unknown>;
                  const summary = extractVoiceDraftSummary(payload);
                  const isExpanded = voiceExpandedDraftId === draft.id;
                  const isEditing = voiceEditingDraftId === draft.id;
                  const isStaff = voiceViewerRole === 'staff';
                  const isStaffOwnDraft = isStaff && draft.created_by && draft.status === 'draft';
                  const canSubmitForReview = Boolean(isStaffOwnDraft);
                  const canApproveOrReject = canConfirmVoiceActions && (draft.status === 'draft' || draft.status === 'pending_review');
                  const canExecute = canConfirmVoiceActions && draft.status === 'approved';
                  const canEditDraft = canConfirmVoiceActions || Boolean(isStaffOwnDraft);
                  return (
                    <div key={draft.id} className="rounded-lg border border-white/10 bg-black/20 p-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-semibold text-white/90">
                            {humanizeVoiceDraftKind(draft.kind)}
                          </p>
                          <p className={cn('text-[11px]', textSub)}>
                            {voiceDraftStatusLabel(draft.status)}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => setVoiceExpandedDraftId((prev) => (prev === draft.id ? null : draft.id))}
                            className="rounded-full border border-white/15 bg-white/6 px-2 py-0.5 text-[11px] font-medium text-white/75 transition-colors hover:bg-white/12 hover:text-white"
                          >
                            {isExpanded
                              ? t('dashboard.litoPage.voice.hideDraft')
                              : t('dashboard.litoPage.voice.viewDraft')}
                          </button>
                          {canEditDraft ? (
                            <button
                              type="button"
                              onClick={() => {
                                setVoiceEditingDraftId(draft.id);
                                setVoiceEditingSummary(summary);
                              }}
                              className="rounded-full border border-white/15 bg-white/6 px-2 py-0.5 text-[11px] font-medium text-white/75 transition-colors hover:bg-white/12 hover:text-white"
                            >
                              {t('dashboard.litoPage.voice.editDraft')}
                            </button>
                          ) : null}
                          {canApproveOrReject ? (
                            <>
                              <button
                                type="button"
                                onClick={() => void handleVoiceDraftMutation(draft.id, 'approve')}
                                className="rounded-full border border-emerald-300/35 bg-emerald-500/12 px-2 py-0.5 text-[11px] font-semibold text-emerald-200 transition-colors hover:bg-emerald-500/18"
                              >
                                {t('dashboard.litoPage.voice.confirmAction')}
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleVoiceDraftMutation(draft.id, 'reject')}
                                className="rounded-full border border-rose-300/35 bg-rose-500/12 px-2 py-0.5 text-[11px] font-semibold text-rose-200 transition-colors hover:bg-rose-500/18"
                              >
                                {t('dashboard.litoPage.voice.cancelAction')}
                              </button>
                            </>
                          ) : null}
                          {canExecute ? (
                            <button
                              type="button"
                              onClick={() => void handleVoiceDraftMutation(draft.id, 'execute')}
                              className="rounded-full border border-teal-300/35 bg-teal-500/12 px-2 py-0.5 text-[11px] font-semibold text-teal-200 transition-colors hover:bg-teal-500/18"
                            >
                              {t('dashboard.litoPage.voice.executeAction')}
                            </button>
                          ) : null}
                          {!canConfirmVoiceActions && canSubmitForReview ? (
                            <button
                              type="button"
                              onClick={() => void handleVoiceDraftMutation(draft.id, 'submit')}
                              className="rounded-full border border-cyan-300/35 bg-cyan-500/12 px-2 py-0.5 text-[11px] font-semibold text-cyan-200 transition-colors hover:bg-cyan-500/18"
                            >
                              {t('dashboard.litoPage.voice.submitReview')}
                            </button>
                          ) : null}
                        </div>
                      </div>

                      {isEditing ? (
                        <div className="mt-2 space-y-2">
                          <textarea
                            value={voiceEditingSummary}
                            onChange={(event) => setVoiceEditingSummary(event.target.value)}
                            rows={3}
                            className="w-full rounded-lg border border-white/12 bg-black/35 px-2.5 py-2 text-xs text-white outline-none transition-colors duration-200 ease-premium focus:border-emerald-300/35"
                          />
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              className="h-7 px-2.5 text-[11px]"
                              onClick={() => void handleSaveVoiceDraftEdit(draft)}
                            >
                              {t('dashboard.litoPage.chat.renameSave')}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2.5 text-[11px]"
                              onClick={() => {
                                setVoiceEditingDraftId(null);
                                setVoiceEditingSummary('');
                              }}
                            >
                              {t('dashboard.litoPage.chat.renameCancel')}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <p className={cn('mt-2 text-xs', textSub)}>{summary}</p>
                      )}

                      {isExpanded ? (
                        <div className="mt-2 space-y-1 rounded-md border border-white/10 bg-white/4 px-2.5 py-2 text-[11px] text-white/75">
                          {typeof payload.human_summary === 'string' ? <p><strong>Resum:</strong> {payload.human_summary}</p> : null}
                          {typeof payload.action === 'string' ? <p><strong>Accio:</strong> {payload.action}</p> : null}
                          {typeof payload.channel === 'string' ? <p><strong>Canal:</strong> {payload.channel}</p> : null}
                          {typeof payload.format === 'string' ? <p><strong>Format:</strong> {payload.format}</p> : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
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
              {visibleMessages.map((message) => {
                const inlineVoiceDrafts = message.role === 'assistant'
                  ? resolveInlineVoiceDrafts({
                    message,
                    bizId: biz.id,
                    voiceDraftById,
                  })
                  : [];

                return (
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

                    {inlineVoiceDrafts.length > 0 ? (
                      <div className="mt-3 rounded-xl border border-amber-300/25 bg-amber-500/8 p-2.5">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <p className={cn('text-xs font-semibold uppercase tracking-wide text-amber-100/90')}>
                            {t('dashboard.litoPage.voice.inline.title')}
                          </p>
                          <span className="rounded-full border border-amber-300/30 bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-100">
                            {inlineVoiceDrafts.length}
                          </span>
                        </div>
                        <div className="space-y-2">
                          {inlineVoiceDrafts.map((draft) => {
                            const payload = (draft.payload || {}) as Record<string, unknown>;
                            const summary = extractVoiceDraftSummary(payload);
                            const isExpanded = voiceExpandedDraftId === draft.id;
                            const isEditing = voiceEditingDraftId === draft.id;
                            const isStaff = voiceViewerRole === 'staff';
                            const isStaffOwnDraft = isStaff && Boolean(draft.created_by) && draft.status === 'draft';
                            const canSubmitForReview = Boolean(isStaffOwnDraft);
                            const canApproveOrReject = canConfirmVoiceActions && (draft.status === 'draft' || draft.status === 'pending_review');
                            const canExecute = canConfirmVoiceActions && draft.status === 'approved';
                            const canEditDraft = canConfirmVoiceActions || Boolean(isStaffOwnDraft);

                            return (
                              <div key={`${message.id}-${draft.id}`} className="rounded-lg border border-white/10 bg-black/20 p-2.5">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div>
                                    <p className="text-xs font-semibold text-white/90">
                                      {humanizeVoiceDraftKind(draft.kind)}
                                    </p>
                                    <p className={cn('text-[11px]', textSub)}>
                                      {voiceDraftStatusLabel(draft.status)}
                                    </p>
                                  </div>
                                  <div className="flex flex-wrap gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => setVoiceExpandedDraftId((prev) => (prev === draft.id ? null : draft.id))}
                                      className="rounded-full border border-white/15 bg-white/6 px-2 py-0.5 text-[11px] font-medium text-white/75 transition-colors hover:bg-white/12 hover:text-white"
                                    >
                                      {isExpanded
                                        ? t('dashboard.litoPage.voice.hideDraft')
                                        : t('dashboard.litoPage.voice.inline.view_draft')}
                                    </button>
                                    {canEditDraft ? (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setVoiceEditingDraftId(draft.id);
                                          setVoiceEditingSummary(summary);
                                        }}
                                        className="rounded-full border border-white/15 bg-white/6 px-2 py-0.5 text-[11px] font-medium text-white/75 transition-colors hover:bg-white/12 hover:text-white"
                                      >
                                        {t('dashboard.litoPage.voice.inline.edit')}
                                      </button>
                                    ) : null}
                                    {canApproveOrReject ? (
                                      <button
                                        type="button"
                                        onClick={() => void handleVoiceDraftMutation(draft.id, 'approve')}
                                        className="rounded-full border border-emerald-300/35 bg-emerald-500/12 px-2 py-0.5 text-[11px] font-semibold text-emerald-200 transition-colors hover:bg-emerald-500/18"
                                      >
                                        {t('dashboard.litoPage.voice.inline.confirm')}
                                      </button>
                                    ) : null}
                                    {canExecute ? (
                                      <button
                                        type="button"
                                        onClick={() => void handleVoiceDraftMutation(draft.id, 'execute')}
                                        className="rounded-full border border-teal-300/35 bg-teal-500/12 px-2 py-0.5 text-[11px] font-semibold text-teal-200 transition-colors hover:bg-teal-500/18"
                                      >
                                        {t('dashboard.litoPage.voice.executeAction')}
                                      </button>
                                    ) : null}
                                    {!canConfirmVoiceActions && canSubmitForReview ? (
                                      <button
                                        type="button"
                                        onClick={() => void handleVoiceDraftMutation(draft.id, 'submit')}
                                        className="rounded-full border border-cyan-300/35 bg-cyan-500/12 px-2 py-0.5 text-[11px] font-semibold text-cyan-200 transition-colors hover:bg-cyan-500/18"
                                      >
                                        {t('dashboard.litoPage.voice.inline.submit_review')}
                                      </button>
                                    ) : null}
                                  </div>
                                </div>

                                {isEditing ? (
                                  <div className="mt-2 space-y-2">
                                    <textarea
                                      value={voiceEditingSummary}
                                      onChange={(event) => setVoiceEditingSummary(event.target.value)}
                                      rows={3}
                                      className="w-full rounded-lg border border-white/12 bg-black/35 px-2.5 py-2 text-xs text-white outline-none transition-colors duration-200 ease-premium focus:border-emerald-300/35"
                                    />
                                    <div className="flex gap-2">
                                      <Button
                                        size="sm"
                                        className="h-7 px-2.5 text-[11px]"
                                        onClick={() => void handleSaveVoiceDraftEdit(draft)}
                                      >
                                        {t('dashboard.litoPage.chat.renameSave')}
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-7 px-2.5 text-[11px]"
                                        onClick={() => {
                                          setVoiceEditingDraftId(null);
                                          setVoiceEditingSummary('');
                                        }}
                                      >
                                        {t('dashboard.litoPage.chat.renameCancel')}
                                      </Button>
                                    </div>
                                  </div>
                                ) : (
                                  <p className={cn('mt-2 text-xs', textSub)}>{summary}</p>
                                )}

                                {isExpanded ? (
                                  <div className="mt-2 space-y-1 rounded-md border border-white/10 bg-white/4 px-2.5 py-2 text-[11px] text-white/75">
                                    {typeof payload.human_summary === 'string' ? <p><strong>Resum:</strong> {payload.human_summary}</p> : null}
                                    {typeof payload.action === 'string' ? <p><strong>Accio:</strong> {payload.action}</p> : null}
                                    {typeof payload.channel === 'string' ? <p><strong>Canal:</strong> {payload.channel}</p> : null}
                                    {typeof payload.format === 'string' ? <p><strong>Format:</strong> {payload.format}</p> : null}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}

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
                    <div className="mt-1 flex items-center gap-2">
                      {message.role === 'assistant' ? (
                        <button
                          type="button"
                          onClick={() => void handlePlayMessageAudio(message)}
                          disabled={ttsLoadingMessageId === message.id}
                          className="rounded-full border border-white/15 bg-white/6 px-2 py-0.5 text-[11px] text-white/80 transition-colors hover:bg-white/12 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                          title={t('dashboard.litoPage.voice.ttsPlay')}
                          aria-label={t('dashboard.litoPage.voice.ttsPlay')}
                        >
                          {ttsLoadingMessageId === message.id ? '…' : '🔊'}
                        </button>
                      ) : null}
                      <p className={cn('text-[11px]', textSub)}>{formatThreadDate(message.created_at)}</p>
                    </div>
                  </div>
                );
              })}
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
              variant="secondary"
              className="h-10 w-10 px-0 text-base"
              loading={voicePreparing || voiceSubmitting}
              onClick={() => void openVoiceSheet()}
              title={t('dashboard.litoPage.voice.openSheet')}
              aria-label={t('dashboard.litoPage.voice.openSheet')}
            >
              🎙️
            </Button>
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

      {voiceSheetOpen ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/55 p-4 sm:items-center">
          <div className="w-full max-w-lg rounded-2xl border border-white/12 bg-zinc-950/95 p-4 shadow-2xl backdrop-blur-md">
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <h3 className={cn('text-sm font-semibold', textMain)}>{t('dashboard.litoPage.voice.sheetTitle')}</h3>
                <p className={cn('mt-1 text-xs', textSub)}>{t('dashboard.litoPage.voice.sheetSubtitle')}</p>
              </div>
              <button
                type="button"
                className="rounded-md border border-white/15 bg-white/6 px-2 py-1 text-xs text-white/80 transition-colors hover:bg-white/12 hover:text-white"
                onClick={() => {
                  setVoiceSheetOpen(false);
                  setVoiceRecording(false);
                  setVoiceAudioFile(null);
                  recognitionRef.current?.stop();
                }}
              >
                {t('dashboard.litoPage.chat.renameCancel')}
              </button>
            </div>

            <div className="mb-2 flex items-center justify-between gap-2">
              <label className={cn('text-xs font-medium', textSub)} htmlFor="voice-transcript-lang">
                {t('dashboard.litoPage.voice.languageLabel')}
              </label>
              <select
                id="voice-transcript-lang"
                value={voiceTranscriptLang}
                onChange={(event) => setVoiceTranscriptLang(event.target.value)}
                className="h-8 rounded-lg border border-white/12 bg-black/30 px-2 text-xs text-white outline-none"
              >
                <option value="ca">Català</option>
                <option value="es">Español</option>
                <option value="en">English</option>
              </select>
            </div>

            <div className="mb-3 rounded-xl border border-white/10 bg-black/25 p-3">
              <p className={cn('mb-2 text-xs', textSub)}>
                {canRecordWithBrowser
                  ? t('dashboard.litoPage.voice.holdToTalk')
                  : t('dashboard.litoPage.voice.manualOnly')}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                    voiceRecording
                      ? 'border-rose-300/40 bg-rose-500/15 text-rose-200'
                      : 'border-white/15 bg-white/8 text-white/80 hover:bg-white/12 hover:text-white',
                  )}
                  onMouseDown={() => startVoiceCapture()}
                  onMouseUp={stopVoiceCapture}
                  onMouseLeave={stopVoiceCapture}
                  onTouchStart={(event) => {
                    event.preventDefault();
                    startVoiceCapture();
                  }}
                  onTouchEnd={(event) => {
                    event.preventDefault();
                    stopVoiceCapture();
                  }}
                  disabled={!canRecordWithBrowser}
                >
                  {voiceRecording
                    ? t('dashboard.litoPage.voice.recording')
                    : t('dashboard.litoPage.voice.pushToTalk')}
                </button>
                <span className={cn('text-[11px]', textSub)}>
                  {voiceRecording ? t('dashboard.litoPage.voice.recordingHint') : t('dashboard.litoPage.voice.recordingIdle')}
                </span>
              </div>
            </div>

            <div className="mb-3 rounded-xl border border-white/10 bg-black/20 p-3">
              <label className={cn('mb-2 block text-xs font-medium', textSub)} htmlFor="voice-audio-upload">
                {t('dashboard.litoPage.voice.audioFileLabel')}
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  id="voice-audio-upload"
                  type="file"
                  accept="audio/*"
                  className="max-w-full text-xs text-white/80 file:mr-2 file:rounded-md file:border-0 file:bg-white/10 file:px-2 file:py-1 file:text-xs file:text-white hover:file:bg-white/20"
                  onChange={(event) => {
                    const file = event.target.files?.[0] || null;
                    setVoiceAudioFile(file);
                  }}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-8 px-3 text-xs"
                  loading={voiceSttLoading}
                  disabled={voiceSttLoading || !voiceAudioFile}
                  onClick={() => void handleVoiceSttFromFile()}
                >
                  {t('dashboard.litoPage.voice.transcribeAudio')}
                </Button>
              </div>
            </div>

            <textarea
              value={voiceTranscript}
              onChange={(event) => setVoiceTranscript(event.target.value)}
              rows={5}
              placeholder={t('dashboard.litoPage.voice.transcriptPlaceholder')}
              className="min-h-[120px] w-full rounded-xl border border-white/12 bg-black/35 p-3 text-sm text-white outline-none transition-colors duration-200 ease-premium focus:border-emerald-300/35"
            />

            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-3 text-xs"
                onClick={() => {
                  setVoiceSheetOpen(false);
                  setVoiceRecording(false);
                  setVoiceAudioFile(null);
                  recognitionRef.current?.stop();
                }}
              >
                {t('dashboard.litoPage.chat.renameCancel')}
              </Button>
              <Button
                size="sm"
                className="h-8 px-3 text-xs"
                loading={voiceSubmitting}
                disabled={voiceSubmitting || voiceSttLoading || voiceTranscript.trim().length < 3}
                onClick={() => void handleVoiceTranscribe()}
              >
                {voicePrepareMode === 'paste_transcript_only'
                  ? t('dashboard.home.recommendations.lito.send')
                  : t('dashboard.litoPage.voice.generateActions')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <EntitlementPaywallModal
        isOpen={paywallOpen}
        type={paywallType}
        used={paywallUsed}
        limit={paywallLimit}
        onClose={() => setPaywallOpen(false)}
      />
    </div>
  );
}
