'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Button from '@/components/ui/Button';
import Tabs from '@/components/ui/Tabs';
import { useToast } from '@/components/ui/Toast';
import EntitlementPaywallModal, { type EntitlementModalType } from '@/components/billing/EntitlementPaywallModal';
import { textMain, textSub } from '@/components/ui/glass';
import { cn } from '@/lib/utils';
import { emitLitoCopyUpdated, isLitoCopyUpdatedEvent, LITO_COPY_UPDATED_EVENT } from '@/components/lito/copy-sync';
import { getIkeaChecklist, type RecommendationChannel } from '@/lib/recommendations/howto';
import type {
  LitoGeneratedCopy,
  LitoQuotaState,
  LitoRecommendationItem,
  LitoViewerRole,
} from '@/components/lito/types';

type LitoCopyStatusReason = 'missing_api_key' | 'paused' | 'disabled' | 'ok';
type LitoTabKey = 'copy_short' | 'copy_long' | 'hashtags' | 'shotlist' | 'image_idea';
type RefineMode = 'shorter' | 'premium' | 'funny';
type FormatKey = 'post' | 'story' | 'reel';
type PreviewChannel = 'instagram' | 'tiktok';
type QuickRefineTrigger = { id: number; mode: RefineMode };
type SocialDraftStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'published';

type SocialDraftItem = {
  id: string;
  recommendation_id: string | null;
  status: SocialDraftStatus;
  title: string | null;
  copy_short: string | null;
  copy_long: string | null;
  hashtags: string[] | null;
  assets_needed: string[] | null;
  review_note: string | null;
  rejection_note?: string | null;
  version: number;
  submitted_at?: string | null;
  reviewed_at?: string | null;
  updated_at: string;
};

type CopyStatusPayload = {
  enabled?: boolean;
  reason?: LitoCopyStatusReason;
  provider?: 'openai' | 'anthropic' | 'none';
  error?: string;
  message?: string;
};

type CopyApiPayload = {
  ok?: boolean;
  copy?: LitoGeneratedCopy | null;
  quota?: LitoQuotaState | null;
  ai?: { available?: boolean; reason?: LitoCopyStatusReason };
  error?: string;
  message?: string;
};

type GeneratePayload = {
  ok?: boolean;
  copy?: LitoGeneratedCopy;
  quota?: LitoQuotaState;
  error?: string;
  feature?: string;
  reason?: LitoCopyStatusReason;
  paywall_reason?: string;
  used?: number;
  limit?: number;
  remaining?: number;
  cap?: number;
  message?: string;
};

type SocialDraftListPayload = {
  ok?: boolean;
  items?: SocialDraftItem[];
  error?: string;
  message?: string;
};

type SocialDraftMutationPayload = {
  ok?: boolean;
  draft?: SocialDraftItem;
  status?: SocialDraftStatus;
  error?: string;
  message?: string;
};

type LitoWorkbenchPaneProps = {
  t: (key: string, vars?: Record<string, string | number>) => string;
  bizId: string | null;
  orgId: string | null;
  businessName: string;
  recommendation: LitoRecommendationItem | null;
  viewerRole: LitoViewerRole;
  selectedFormat: FormatKey;
  onQuotaChange: (quota: LitoQuotaState | null) => void;
  onPublished: (recommendationId: string) => Promise<void>;
  quickRefineTrigger?: QuickRefineTrigger | null;
};

function normalizedFormat(value: string | undefined): FormatKey {
  if (value === 'story' || value === 'reel') return value;
  return 'post';
}

export default function LitoWorkbenchPane({
  t,
  bizId,
  orgId,
  businessName,
  recommendation,
  viewerRole,
  selectedFormat,
  onQuotaChange,
  onPublished,
  quickRefineTrigger,
}: LitoWorkbenchPaneProps) {
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<LitoTabKey>('copy_short');
  const [loadingStored, setLoadingStored] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [pollingCopy, setPollingCopy] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [refineLoading, setRefineLoading] = useState<string | null>(null);
  const [customInstruction, setCustomInstruction] = useState('');

  const [assets, setAssets] = useState<string[]>([]);
  const [copyShort, setCopyShort] = useState('');
  const [copyLong, setCopyLong] = useState('');
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [shotlist, setShotlist] = useState<string[]>([]);
  const [imageIdea, setImageIdea] = useState('');
  const [quota, setQuota] = useState<LitoQuotaState | null>(null);

  const [aiUnavailable, setAiUnavailable] = useState(false);
  const [aiStatusReason, setAiStatusReason] = useState<LitoCopyStatusReason>('ok');
  const [aiMessage, setAiMessage] = useState('');
  const [hasGeneratedCopy, setHasGeneratedCopy] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [paywallType, setPaywallType] = useState<EntitlementModalType>('quota_exceeded');
  const [paywallUsed, setPaywallUsed] = useState<number | undefined>(undefined);
  const [paywallLimit, setPaywallLimit] = useState<number | undefined>(undefined);
  const [stepsDone, setStepsDone] = useState<Record<string, boolean>>({});
  const [previewChannel, setPreviewChannel] = useState<PreviewChannel>('instagram');
  const [ikeaChannel, setIkeaChannel] = useState<RecommendationChannel>('instagram');
  const [reviewActionLoading, setReviewActionLoading] = useState<'submit' | 'approve' | 'reject' | null>(null);
  const [currentDraft, setCurrentDraft] = useState<SocialDraftItem | null>(null);
  const lastQuickRefineHandled = useRef<number | null>(null);

  const recommendationTemplate = recommendation?.recommendation_template;
  const fallbackFormat = normalizedFormat(recommendation?.format || recommendationTemplate?.format);
  const effectiveFormat = recommendation ? fallbackFormat : selectedFormat;
  const hookTitle = recommendation?.hook || recommendationTemplate?.hook || t('dashboard.home.recommendations.lito.defaultTitle');
  const localHowTo = recommendation?.how_to || recommendationTemplate?.how_to;
  const canMarkPublished = viewerRole !== 'staff';
  const staffCopyLocked = viewerRole === 'staff' && currentDraft?.status !== 'approved';
  const settingsHref = '/dashboard/admin';
  const ikeaChecklist = useMemo(() => {
    if (!recommendation) return null;
    return getIkeaChecklist({
      format: effectiveFormat,
      channel: ikeaChannel,
      vertical: recommendation.vertical || null,
      hook: recommendation.hook || recommendationTemplate?.hook || null,
      idea: recommendation.idea || recommendationTemplate?.idea || null,
      cta: recommendation.cta || recommendationTemplate?.cta || null,
      t,
    });
  }, [
    effectiveFormat,
    ikeaChannel,
    recommendation,
    recommendationTemplate?.cta,
    recommendationTemplate?.hook,
    recommendationTemplate?.idea,
    t,
  ]);

  const aiReasonMessage = useCallback((reason?: LitoCopyStatusReason, fallback?: string) => {
    if (reason === 'missing_api_key') return t('dashboard.home.recommendations.lito.copyDisabledMissingKey');
    if (reason === 'disabled' || reason === 'paused') return t('dashboard.home.recommendations.lito.copyDisabledManager');
    return fallback || t('dashboard.home.recommendations.lito.aiUnavailable');
  }, [t]);

  const openPaywall = useCallback((type: EntitlementModalType, payload?: GeneratePayload) => {
    setPaywallType(type);
    setPaywallUsed(typeof payload?.used === 'number' ? payload.used : undefined);
    setPaywallLimit(typeof payload?.limit === 'number' ? payload.limit : undefined);
    setPaywallOpen(true);
  }, []);

  const applyCopy = useCallback((copy: LitoGeneratedCopy) => {
    setCopyShort(copy.caption_short || '');
    setCopyLong(copy.caption_long || '');
    setHashtags(copy.hashtags || []);
    setShotlist(copy.shotlist || []);
    setImageIdea(copy.image_idea || '');
    setAssets(copy.assets_needed || []);
    setHasGeneratedCopy(true);
    setPreviewChannel(copy.channel === 'tiktok' ? 'tiktok' : 'instagram');
    setIkeaChannel(copy.channel === 'tiktok' ? 'tiktok' : 'instagram');
  }, []);

  const hydrateFallbackPlan = useCallback(() => {
    const fallbackAssets = localHowTo?.assets_needed?.length
      ? localHowTo.assets_needed
      : recommendationTemplate?.assets_needed || [];

    setAssets(fallbackAssets.slice(0, 10));
    setCopyShort('');
    setCopyLong('');
    setHashtags([]);
    setShotlist([]);
    setImageIdea('');
    setHasGeneratedCopy(false);
  }, [localHowTo?.assets_needed, recommendationTemplate?.assets_needed]);

  const loadCopyStatus = useCallback(async () => {
    if (!bizId) return;
    try {
      const response = await fetch(`/api/lito/copy/status?biz_id=${bizId}`);
      const payload = (await response.json().catch(() => ({}))) as CopyStatusPayload;
      if (!response.ok || typeof payload.enabled !== 'boolean') return;

      if (payload.enabled) {
        setAiUnavailable(false);
        setAiStatusReason('ok');
        setAiMessage('');
        return;
      }

      const reason = payload.reason || 'disabled';
      setAiUnavailable(true);
      setAiStatusReason(reason);
      setAiMessage(aiReasonMessage(reason, payload.message));
    } catch {
      // keep current local state
    }
  }, [aiReasonMessage, bizId]);

  const loadStoredCopy = useCallback(async () => {
    if (!bizId || !recommendation?.id) {
      onQuotaChange(null);
      return;
    }

    setLoadingStored(true);
    try {
      const response = await fetch(`/api/lito/copy?biz_id=${bizId}&recommendation_id=${recommendation.id}`);
      const payload = (await response.json().catch(() => ({}))) as CopyApiPayload;

      if (payload.quota) {
        setQuota(payload.quota);
        onQuotaChange(payload.quota);
      } else {
        onQuotaChange(null);
      }

      if (payload.ai) {
        const available = Boolean(payload.ai.available);
        setAiUnavailable(!available);
        setAiStatusReason(payload.ai.reason || (available ? 'ok' : 'disabled'));
        if (!available) {
          setAiMessage(aiReasonMessage(payload.ai.reason || 'disabled'));
        }
      }

      if (payload.copy) applyCopy(payload.copy);
    } catch {
      onQuotaChange(null);
    } finally {
      setLoadingStored(false);
    }
  }, [aiReasonMessage, applyCopy, bizId, onQuotaChange, recommendation?.id]);

  const pollUntilCopyAvailable = useCallback(async (): Promise<boolean> => {
    if (!bizId || !recommendation?.id) return false;
    setPollingCopy(true);
    try {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const response = await fetch(`/api/lito/copy?biz_id=${bizId}&recommendation_id=${recommendation.id}`);
        if (!response.ok) continue;
        const payload = (await response.json().catch(() => ({}))) as CopyApiPayload;
        if (payload.quota) {
          setQuota(payload.quota);
          onQuotaChange(payload.quota);
        }
        if (payload.copy) {
          applyCopy(payload.copy);
          return true;
        }
      }
      return false;
    } finally {
      setPollingCopy(false);
    }
  }, [applyCopy, bizId, onQuotaChange, recommendation?.id]);

  const loadCurrentDraft = useCallback(async () => {
    if (!bizId || !recommendation?.id) {
      setCurrentDraft(null);
      return;
    }

    try {
      const response = await fetch(`/api/social/drafts?biz_id=${bizId}&recommendation_id=${recommendation.id}&limit=1`);
      const payload = (await response.json().catch(() => ({}))) as SocialDraftListPayload;
      if (!response.ok || payload.error) {
        setCurrentDraft(null);
        return;
      }
      setCurrentDraft((payload.items || [])[0] || null);
    } catch {
      setCurrentDraft(null);
    }
  }, [bizId, recommendation?.id]);

  const submitToReview = useCallback(async () => {
    if (!bizId || !recommendation?.id || !orgId || viewerRole !== 'staff') return;
    setReviewActionLoading('submit');
    try {
      const draftForSubmit = currentDraft?.status === 'draft' || currentDraft?.status === 'rejected'
        ? currentDraft
        : null;

      let targetDraft = draftForSubmit;
      if (!targetDraft) {
        const createResponse = await fetch('/api/social/drafts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            biz_id: bizId,
            source: 'lito',
            recommendation_id: recommendation.id,
            channel: previewChannel,
            format: effectiveFormat,
            title: hookTitle,
            copy_short: copyShort || null,
            copy_long: copyLong || null,
            hashtags: hashtags.length ? hashtags : null,
            assets_needed: assets.length ? assets : null,
            steps: ikeaChecklist?.steps || shotlist,
          }),
        });
        const createPayload = (await createResponse.json().catch(() => ({}))) as SocialDraftMutationPayload;
        if (!createResponse.ok || createPayload.error || !createPayload.draft?.id) {
          throw new Error(createPayload.message || t('dashboard.litoPage.approval.submitError'));
        }
        targetDraft = createPayload.draft;
      }

      const submitResponse = await fetch(`/api/social/drafts/${targetDraft.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: targetDraft.version }),
      });
      const submitPayload = (await submitResponse.json().catch(() => ({}))) as SocialDraftMutationPayload;
      if (!submitResponse.ok || submitPayload.error) {
        throw new Error(submitPayload.message || t('dashboard.litoPage.approval.submitError'));
      }

      setCurrentDraft(submitPayload.draft || targetDraft);
      toast(t('dashboard.litoPage.approval.submitSuccess'), 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : t('dashboard.litoPage.approval.submitError');
      toast(message, 'error');
    } finally {
      setReviewActionLoading(null);
    }
  }, [
    assets,
    bizId,
    copyLong,
    copyShort,
    effectiveFormat,
    hashtags,
    hookTitle,
    ikeaChecklist?.steps,
    orgId,
    previewChannel,
    recommendation?.id,
    shotlist,
    t,
    toast,
    viewerRole,
  ]);

  const approvePendingDraft = useCallback(async () => {
    if (!currentDraft?.id || (viewerRole !== 'owner' && viewerRole !== 'manager')) return;
    setReviewActionLoading('approve');
    try {
      const response = await fetch(`/api/social/drafts/${currentDraft.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: currentDraft.version,
          title: hookTitle,
          copy_short: copyShort || null,
          copy_long: copyLong || null,
          hashtags: hashtags.length ? hashtags : null,
          assets_needed: assets.length ? assets : null,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as SocialDraftMutationPayload;
      if (!response.ok || payload.error || !payload.draft) {
        throw new Error(payload.message || t('dashboard.litoPage.approval.approveError'));
      }
      setCurrentDraft(payload.draft);
      toast(t('dashboard.litoPage.approval.approveSuccess'), 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : t('dashboard.litoPage.approval.approveError');
      toast(message, 'error');
    } finally {
      setReviewActionLoading(null);
    }
  }, [assets, copyLong, copyShort, currentDraft?.id, hashtags, hookTitle, t, toast, viewerRole]);

  const rejectPendingDraft = useCallback(async () => {
    if (!currentDraft?.id || (viewerRole !== 'owner' && viewerRole !== 'manager')) return;
    setReviewActionLoading('reject');
    try {
      const response = await fetch(`/api/social/drafts/${currentDraft.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: currentDraft.version,
          note: t('dashboard.litoPage.approval.rejectDefaultNote'),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as SocialDraftMutationPayload;
      if (!response.ok || payload.error || !payload.draft) {
        throw new Error(payload.message || t('dashboard.litoPage.approval.rejectError'));
      }
      setCurrentDraft(payload.draft);
      toast(t('dashboard.litoPage.approval.rejectSuccess'), 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : t('dashboard.litoPage.approval.rejectError');
      toast(message, 'error');
    } finally {
      setReviewActionLoading(null);
    }
  }, [currentDraft?.id, t, toast, viewerRole]);

  const runGenerate = useCallback(async () => {
    if (!bizId || !recommendation?.id) return;
    setGenerating(true);
    try {
      const response = await fetch('/api/lito/copy/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          biz_id: bizId,
          recommendation_id: recommendation.id,
          format: effectiveFormat,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as GeneratePayload;

      if (response.status === 503 || payload.error === 'ai_unavailable') {
        const reason = payload.reason || 'missing_api_key';
        const message = aiReasonMessage(reason, payload.message);
        setAiUnavailable(true);
        setAiStatusReason(reason);
        setAiMessage(message);
        toast(message, 'error');
        return;
      }

      if (payload.error === 'quota_exceeded' || (response.status === 402 && !payload.error)) {
        openPaywall('quota_exceeded', payload);
        toast(payload.message || t('dashboard.litoPage.messages.quotaExceeded'), 'warning');
        return;
      }

      if (response.status === 402 && payload.error === 'trial_ended') {
        openPaywall('trial_ended', payload);
        toast(payload.message || t('dashboard.litoPage.messages.trialEnded'), 'warning');
        return;
      }

      if (response.status === 402 && payload.error === 'trial_cap_reached') {
        openPaywall('trial_cap_reached', {
          ...payload,
          limit: typeof payload.cap === 'number' ? payload.cap : payload.limit,
        });
        toast(payload.message || t('dashboard.litoPage.messages.trialCapReached'), 'warning');
        return;
      }

      if (payload.error === 'limit_reached') {
        openPaywall('limit_reached', payload);
        toast(payload.message || t('dashboard.home.recommendations.lito.copyDisabledManager'), 'warning');
        return;
      }

      if (response.status === 403 && (payload.error === 'feature_locked' || payload.error === 'staff_ai_paused')) {
        openPaywall('feature_locked', payload);
        toast(payload.message || t('dashboard.home.recommendations.lito.copyDisabledManager'), 'warning');
        return;
      }

      if (response.status === 409 && (payload.error === 'in_flight' || payload.error === 'retry_later')) {
        toast(t('dashboard.home.recommendations.lito.inFlightToast'), 'warning');
        const resolved = await pollUntilCopyAvailable();
        if (!resolved) toast(t('dashboard.home.recommendations.lito.pollTimeout'), 'error');
        return;
      }

      if (!response.ok || payload.error || !payload.copy) {
        throw new Error(payload.message || t('dashboard.home.recommendations.lito.generateError'));
      }

      applyCopy(payload.copy);
      if (payload.quota) {
        setQuota(payload.quota);
        onQuotaChange(payload.quota);
      }
      emitLitoCopyUpdated({
        bizId,
        recommendationId: recommendation.id,
        source: 'workbench',
      });
      setAiUnavailable(false);
      setAiStatusReason('ok');
      setAiMessage('');
      setActiveTab('copy_short');
    } catch (error) {
      const message = error instanceof Error ? error.message : t('dashboard.home.recommendations.lito.generateError');
      toast(message, 'error');
    } finally {
      setGenerating(false);
    }
  }, [aiReasonMessage, applyCopy, bizId, effectiveFormat, onQuotaChange, openPaywall, pollUntilCopyAvailable, recommendation?.id, t, toast]);

  const runRefine = useCallback(async (mode: RefineMode | 'custom', instruction?: string) => {
    if (!bizId || !recommendation?.id) return;
    setRefineLoading(mode);
    try {
      const response = await fetch('/api/lito/copy/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          biz_id: bizId,
          recommendation_id: recommendation.id,
          mode: mode === 'custom' ? 'custom' : 'quick',
          quick_mode: mode === 'custom' ? undefined : mode,
          instruction: mode === 'custom' ? instruction : undefined,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as GeneratePayload;

      if (response.status === 503 || payload.error === 'ai_unavailable') {
        const reason = payload.reason || 'missing_api_key';
        const message = aiReasonMessage(reason, payload.message);
        setAiUnavailable(true);
        setAiStatusReason(reason);
        setAiMessage(message);
        toast(message, 'error');
        return;
      }

      if (payload.error === 'quota_exceeded' || (response.status === 402 && !payload.error)) {
        openPaywall('quota_exceeded', payload);
        toast(payload.message || t('dashboard.litoPage.messages.quotaExceeded'), 'warning');
        return;
      }

      if (response.status === 402 && payload.error === 'trial_ended') {
        openPaywall('trial_ended', payload);
        toast(payload.message || t('dashboard.litoPage.messages.trialEnded'), 'warning');
        return;
      }

      if (response.status === 402 && payload.error === 'trial_cap_reached') {
        openPaywall('trial_cap_reached', {
          ...payload,
          limit: typeof payload.cap === 'number' ? payload.cap : payload.limit,
        });
        toast(payload.message || t('dashboard.litoPage.messages.trialCapReached'), 'warning');
        return;
      }

      if (payload.error === 'limit_reached') {
        openPaywall('limit_reached', payload);
        toast(payload.message || t('dashboard.home.recommendations.lito.copyDisabledManager'), 'warning');
        return;
      }

      if (response.status === 403 && (payload.error === 'feature_locked' || payload.error === 'staff_ai_paused')) {
        openPaywall('feature_locked', payload);
        toast(payload.message || t('dashboard.home.recommendations.lito.copyDisabledManager'), 'warning');
        return;
      }

      if (response.status === 409 && (payload.error === 'in_flight' || payload.error === 'retry_later')) {
        toast(t('dashboard.home.recommendations.lito.inFlightToast'), 'warning');
        const resolved = await pollUntilCopyAvailable();
        if (!resolved) toast(t('dashboard.home.recommendations.lito.pollTimeout'), 'error');
        return;
      }

      if (!response.ok || payload.error || !payload.copy) {
        throw new Error(payload.message || t('dashboard.home.recommendations.lito.refineError'));
      }

      applyCopy(payload.copy);
      if (payload.quota) {
        setQuota(payload.quota);
        onQuotaChange(payload.quota);
      }
      emitLitoCopyUpdated({
        bizId,
        recommendationId: recommendation.id,
        source: 'workbench',
      });
      if (mode === 'custom') setCustomInstruction('');
      setAiUnavailable(false);
      setAiStatusReason('ok');
      setAiMessage('');
    } catch (error) {
      const message = error instanceof Error ? error.message : t('dashboard.home.recommendations.lito.refineError');
      toast(message, 'error');
    } finally {
      setRefineLoading(null);
    }
  }, [aiReasonMessage, applyCopy, bizId, onQuotaChange, openPaywall, pollUntilCopyAvailable, recommendation?.id, t, toast]);

  const handleCopyText = useCallback(async (value: string) => {
    if (!value.trim()) return;
    try {
      await navigator.clipboard.writeText(value);
      toast(t('dashboard.home.recommendations.lito.copySuccess'), 'success');
    } catch {
      toast(t('dashboard.home.recommendations.lito.copyError'), 'error');
    }
  }, [t, toast]);

  const handleCopyChecklist = useCallback(async () => {
    if (!ikeaChecklist?.copyText?.trim()) return;
    try {
      await navigator.clipboard.writeText(ikeaChecklist.copyText);
      toast(t('dashboard.litoPage.ikea.copiedToast'), 'success');
    } catch {
      toast(t('dashboard.litoPage.ikea.copyError'), 'error');
    }
  }, [ikeaChecklist, t, toast]);

  useEffect(() => {
    setStepsDone({});
    setActiveTab('copy_short');
    setQuota(null);
    setCurrentDraft(null);
    setAiUnavailable(false);
    setAiStatusReason('ok');
    setAiMessage('');
    setCustomInstruction('');
    setPreviewChannel('instagram');
    setIkeaChannel('instagram');
    hydrateFallbackPlan();
    void loadCopyStatus();
    void loadStoredCopy();
    void loadCurrentDraft();
  }, [hydrateFallbackPlan, loadCopyStatus, loadCurrentDraft, loadStoredCopy, recommendation?.id]);

  useEffect(() => {
    if (!quickRefineTrigger || !recommendation?.id) return;
    if (lastQuickRefineHandled.current === quickRefineTrigger.id) return;
    lastQuickRefineHandled.current = quickRefineTrigger.id;
    void runRefine(quickRefineTrigger.mode);
  }, [quickRefineTrigger, recommendation?.id, runRefine]);

  useEffect(() => {
    if (!bizId || !recommendation?.id) return;

    const onCopyUpdated = (event: Event) => {
      if (!isLitoCopyUpdatedEvent(event)) return;
      const detail = event.detail;
      if (!detail) return;
      if (detail.source === 'workbench') return;
      if (detail.bizId !== bizId || detail.recommendationId !== recommendation.id) return;
      void loadStoredCopy();
      void loadCurrentDraft();
    };

    window.addEventListener(LITO_COPY_UPDATED_EVENT, onCopyUpdated as EventListener);
    return () => {
      window.removeEventListener(LITO_COPY_UPDATED_EVENT, onCopyUpdated as EventListener);
    };
  }, [bizId, loadCurrentDraft, loadStoredCopy, recommendation?.id]);

  const tabValue = useMemo(() => {
    if (activeTab === 'copy_long') return copyLong;
    if (activeTab === 'hashtags') return hashtags.join(' ');
    if (activeTab === 'shotlist') return shotlist.join('\n');
    if (activeTab === 'image_idea') return imageIdea;
    return copyShort;
  }, [activeTab, copyLong, copyShort, hashtags, imageIdea, shotlist]);

  const hasDraftContent = useMemo(() => {
    return Boolean(copyShort.trim() || copyLong.trim() || hashtags.length || shotlist.length || imageIdea.trim());
  }, [copyLong, copyShort, hashtags.length, imageIdea, shotlist.length]);

  const hasPendingReview = currentDraft?.status === 'pending';

  return (
    <section className="flex min-h-[70vh] flex-col rounded-2xl border border-white/10 bg-zinc-900/45 backdrop-blur-md">
      <header className="border-b border-white/10 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className={cn('text-sm font-semibold tracking-wide', textMain)}>
              {t('dashboard.litoPage.workbench.title')}
            </h2>
            <p className={cn('mt-1 text-xs', textSub)}>
              {recommendation ? hookTitle : t('dashboard.litoPage.workbench.emptyTitle')}
            </p>
            {quota?.limit ? (
              <p className="mt-1 text-xs text-emerald-300/85">
                {t('dashboard.home.recommendations.lito.quotaBadge', { used: quota.used, limit: quota.limit })}
              </p>
            ) : null}
          </div>
          <Button
            size="sm"
            className="h-8 px-3 text-xs"
            disabled={!recommendation?.id || generating || pollingCopy || aiUnavailable}
            loading={generating}
            title={aiUnavailable ? (aiMessage || aiReasonMessage(aiStatusReason)) : undefined}
            onClick={() => void runGenerate()}
          >
            {t('dashboard.home.recommendations.actions.generateLito')}
          </Button>
        </div>

        {aiUnavailable ? (
          <div className="mt-3 rounded-xl border border-amber-300/25 bg-amber-500/10 px-3 py-2">
            <p className="text-xs font-semibold text-amber-100">{t('dashboard.home.recommendations.lito.copyDisabledTitle')}</p>
            <p className="mt-1 text-xs text-amber-200/95">{aiMessage || aiReasonMessage(aiStatusReason)}</p>
            <Link
              href={settingsHref}
              className="mt-2 inline-flex h-7 items-center rounded-md border border-amber-200/35 px-2.5 text-xs font-medium text-amber-100 transition-colors duration-200 ease-premium hover:bg-amber-300/15"
            >
              {t('dashboard.home.recommendations.lito.copyDisabledActivate')}
            </Link>
          </div>
        ) : null}
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {!recommendation ? (
          <p className={cn('rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-sm', textSub)}>
            {t('dashboard.litoPage.workbench.selectRecommendationIkea')}
          </p>
        ) : (
          <div className="space-y-3">
            <Tabs
              value={activeTab}
              onChange={(key) => setActiveTab(key as LitoTabKey)}
              items={[
                { key: 'copy_short', label: t('dashboard.litoPage.workbench.tabs.short') },
                { key: 'copy_long', label: t('dashboard.litoPage.workbench.tabs.long') },
                { key: 'hashtags', label: t('dashboard.litoPage.workbench.tabs.hashtags') },
                { key: 'shotlist', label: t('dashboard.litoPage.workbench.tabs.shotlist') },
                { key: 'image_idea', label: t('dashboard.litoPage.workbench.tabs.imageIdea') },
              ]}
            />

            <div className="rounded-xl border border-white/10 bg-white/6 p-3">
              {loadingStored ? (
                <div className="h-24 animate-pulse rounded-xl border border-white/8 bg-white/6" />
              ) : (
                <>
                  {(activeTab === 'copy_short' || activeTab === 'copy_long') && (
                    <textarea
                      value={activeTab === 'copy_short' ? copyShort : copyLong}
                      onChange={(event) => {
                        if (activeTab === 'copy_short') setCopyShort(event.target.value);
                        else setCopyLong(event.target.value);
                      }}
                      rows={activeTab === 'copy_short' ? 4 : 7}
                      className="w-full rounded-xl border border-white/10 bg-black/25 p-3 text-sm text-white outline-none transition-all duration-200 ease-premium focus:border-emerald-300/35 focus:ring-2 focus:ring-emerald-400/20"
                    />
                  )}

                  {activeTab === 'hashtags' && (
                    <textarea
                      value={hashtags.join(' ')}
                      onChange={(event) => {
                        const values = event.target.value
                          .split(/\s+/)
                          .map((value) => value.trim())
                          .filter(Boolean)
                          .slice(0, 12);
                        setHashtags(values);
                      }}
                      rows={3}
                      className="w-full rounded-xl border border-white/10 bg-black/25 p-3 text-sm text-white outline-none transition-all duration-200 ease-premium focus:border-emerald-300/35 focus:ring-2 focus:ring-emerald-400/20"
                    />
                  )}

                  {activeTab === 'shotlist' && (
                    <textarea
                      value={shotlist.join('\n')}
                      onChange={(event) => {
                        const values = event.target.value
                          .split('\n')
                          .map((value) => value.trim())
                          .filter(Boolean)
                          .slice(0, 8);
                        setShotlist(values);
                      }}
                      rows={6}
                      className="w-full rounded-xl border border-white/10 bg-black/25 p-3 text-sm text-white outline-none transition-all duration-200 ease-premium focus:border-emerald-300/35 focus:ring-2 focus:ring-emerald-400/20"
                    />
                  )}

                  {activeTab === 'image_idea' && (
                    <textarea
                      value={imageIdea}
                      onChange={(event) => setImageIdea(event.target.value)}
                      rows={4}
                      className="w-full rounded-xl border border-white/10 bg-black/25 p-3 text-sm text-white outline-none transition-all duration-200 ease-premium focus:border-emerald-300/35 focus:ring-2 focus:ring-emerald-400/20"
                    />
                  )}

                  <div className="mt-2 flex justify-end">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={staffCopyLocked || !tabValue.trim()}
                      title={staffCopyLocked ? t('dashboard.litoPage.approval.staffCopyLockedHint') : undefined}
                      onClick={() => void handleCopyText(tabValue)}
                    >
                      {t('dashboard.home.recommendations.lito.actions.copy')}
                    </Button>
                  </div>
                </>
              )}
            </div>

            {currentDraft ? (
              <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                <p className={cn('text-xs font-medium text-white/80')}>
                  {t('dashboard.litoPage.approval.statusLabel')}: <span className="text-white">{currentDraft.status}</span>
                </p>
                {currentDraft.review_note ? (
                  <p className={cn('mt-1 text-xs text-white/70')}>{currentDraft.review_note}</p>
                ) : null}
              </div>
            ) : null}

            <div className="rounded-xl border border-white/10 bg-white/6 p-3">
              <p className={cn('text-sm font-semibold', textMain)}>{t('dashboard.litoPage.workbench.refineTitle')}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="ghost" disabled={aiUnavailable || pollingCopy} loading={refineLoading === 'shorter'} onClick={() => void runRefine('shorter')}>
                  {t('dashboard.home.recommendations.lito.refine.shorter')}
                </Button>
                <Button size="sm" variant="ghost" disabled={aiUnavailable || pollingCopy} loading={refineLoading === 'premium'} onClick={() => void runRefine('premium')}>
                  {t('dashboard.home.recommendations.lito.refine.premium')}
                </Button>
                <Button size="sm" variant="ghost" disabled={aiUnavailable || pollingCopy} loading={refineLoading === 'funny'} onClick={() => void runRefine('funny')}>
                  {t('dashboard.home.recommendations.lito.refine.funny')}
                </Button>
              </div>
              <textarea
                value={customInstruction}
                onChange={(event) => setCustomInstruction(event.target.value)}
                rows={3}
                placeholder={t('dashboard.home.recommendations.lito.customInstructionPlaceholder')}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 p-3 text-sm text-white outline-none transition-all duration-200 ease-premium focus:border-emerald-300/35 focus:ring-2 focus:ring-emerald-400/20"
              />
              <div className="mt-2 flex justify-end">
                <Button
                  size="sm"
                  loading={refineLoading === 'custom'}
                  disabled={aiUnavailable || pollingCopy || customInstruction.trim().length < 2}
                  onClick={() => void runRefine('custom', customInstruction.trim())}
                >
                  {t('dashboard.home.recommendations.lito.actions.refineCustom')}
                </Button>
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/6 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className={cn('text-sm font-semibold', textMain)}>{t('dashboard.litoPage.workbench.previewTitle')}</p>
                  <p className={cn('mt-1 text-xs', textSub)}>{t('dashboard.litoPage.workbench.previewSubtitle')}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPreviewChannel('instagram')}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-xs font-medium transition-all duration-200 ease-premium',
                      previewChannel === 'instagram'
                        ? 'border-emerald-300/45 bg-emerald-500/12 text-emerald-200'
                        : 'border-white/12 bg-white/6 text-white/75 hover:text-white',
                    )}
                  >
                    {t('dashboard.litoPage.workbench.previewChannels.instagram')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewChannel('tiktok')}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-xs font-medium transition-all duration-200 ease-premium',
                      previewChannel === 'tiktok'
                        ? 'border-emerald-300/45 bg-emerald-500/12 text-emerald-200'
                        : 'border-white/12 bg-white/6 text-white/75 hover:text-white',
                    )}
                  >
                    {t('dashboard.litoPage.workbench.previewChannels.tiktok')}
                  </button>
                </div>
              </div>

              <div className="mt-3 flex justify-center">
                <div className="w-full max-w-[280px] rounded-[28px] border border-white/12 bg-zinc-950 p-2.5 shadow-[0_10px_30px_rgba(0,0,0,0.4)]">
                  <div className="rounded-[22px] border border-white/10 bg-black/35 p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-semibold text-white/90">{businessName || 'Negoci'}</p>
                        <p className="text-[11px] text-white/60">
                          {previewChannel === 'instagram'
                            ? t('dashboard.litoPage.workbench.previewChannels.instagram')
                            : t('dashboard.litoPage.workbench.previewChannels.tiktok')}
                        </p>
                      </div>
                      <span className="rounded-full border border-white/15 bg-white/8 px-2 py-0.5 text-[10px] text-white/70">
                        {effectiveFormat}
                      </span>
                    </div>
                    <div className="mt-3 min-h-[160px] rounded-xl border border-white/8 bg-zinc-900/50 p-3">
                      {(copyLong || copyShort || hashtags.length > 0) ? (
                        <>
                          <p className="whitespace-pre-wrap text-sm leading-relaxed text-white/88">
                            {copyLong || copyShort}
                          </p>
                          {hashtags.length > 0 ? (
                            <p className="mt-3 text-xs text-emerald-300/85">{hashtags.join(' ')}</p>
                          ) : null}
                        </>
                      ) : (
                        <p className="text-sm text-white/55">{t('dashboard.litoPage.workbench.previewEmpty')}</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/6 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className={cn('text-sm font-semibold', textMain)}>
                  {ikeaChecklist?.title || t('dashboard.litoPage.ikea.title')}
                </p>
                <div className="inline-flex rounded-full border border-white/15 bg-white/5 p-0.5">
                  {(['instagram', 'tiktok'] as RecommendationChannel[]).map((channel) => (
                    <button
                      key={`ikea-channel-${channel}`}
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
              <ul className="mt-2 space-y-2">
                {(ikeaChecklist?.steps || []).map((step, index) => {
                  const key = `${index}:${step}`;
                  const checked = Boolean(stepsDone[key]);
                  return (
                    <li key={key} className="flex items-start gap-2 text-sm text-white/82">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setStepsDone((previous) => ({ ...previous, [key]: !checked }))}
                        className="mt-0.5 h-4 w-4 rounded border-white/25 bg-transparent accent-emerald-400"
                      />
                      <span className={checked ? 'line-through text-white/55' : ''}>{step}</span>
                    </li>
                  );
                })}
              </ul>
              <p className={cn('mt-3 text-xs font-medium text-white/65')}>{t('dashboard.litoPage.ikea.sectionNotes')}</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-white/75">
                {(ikeaChecklist?.notes || []).map((note, index) => (
                  <li key={`note-${index}`}>{note}</li>
                ))}
              </ul>
              <p className={cn('mt-3 text-xs font-medium text-white/65')}>{t('dashboard.home.recommendations.lito.tabs.assets')}</p>
              {assets.length > 0 ? (
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-white/75">
                  {assets.map((asset, index) => (
                    <li key={`asset-${index}`}>{asset}</li>
                  ))}
                </ul>
              ) : (
                <p className={cn('mt-1 text-sm text-white/65')}>
                  {t('dashboard.litoPage.workbench.assetsEmpty')}
                </p>
              )}
              <div className="mt-3 flex justify-end">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 px-3 text-xs"
                  onClick={() => void handleCopyChecklist()}
                  disabled={!ikeaChecklist}
                >
                  {t('dashboard.litoPage.ikea.copyChecklist')}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      <footer className="border-t border-white/10 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className={cn('text-xs', textSub)}>
            {canMarkPublished
              ? t('dashboard.home.recommendations.lito.footerHint')
              : t('dashboard.home.recommendations.lito.staffDraftOnly')}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {viewerRole === 'staff' ? (
              <Button
                size="sm"
                loading={reviewActionLoading === 'submit'}
                disabled={!recommendation?.id || !hasDraftContent || hasPendingReview}
                title={!hasDraftContent ? t('dashboard.litoPage.approval.staffCopyLockedHint') : undefined}
                onClick={() => void submitToReview()}
              >
                {hasPendingReview
                  ? t('dashboard.litoPage.approval.pending')
                  : t('dashboard.litoPage.approval.submit')}
              </Button>
            ) : null}

            {(viewerRole === 'owner' || viewerRole === 'manager') && hasPendingReview ? (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={reviewActionLoading === 'reject'}
                  onClick={() => void rejectPendingDraft()}
                >
                  {t('dashboard.litoPage.approval.reject')}
                </Button>
                <Button
                  size="sm"
                  loading={reviewActionLoading === 'approve'}
                  onClick={() => void approvePendingDraft()}
                >
                  {t('dashboard.litoPage.approval.approve')}
                </Button>
              </>
            ) : null}

            {canMarkPublished ? (
              <Button
                size="sm"
                loading={publishing}
                disabled={!recommendation?.id}
                onClick={() => {
                  if (!recommendation?.id) return;
                  setPublishing(true);
                  void onPublished(recommendation.id)
                    .catch((error) => {
                      const message = error instanceof Error ? error.message : t('dashboard.home.recommendations.feedbackError');
                      toast(message, 'error');
                    })
                    .finally(() => setPublishing(false));
                }}
              >
                {t('dashboard.home.recommendations.lito.actions.markPublished')}
              </Button>
            ) : null}
          </div>
        </div>
      </footer>

      <EntitlementPaywallModal
        isOpen={paywallOpen}
        type={paywallType}
        used={paywallUsed}
        limit={paywallLimit}
        onClose={() => setPaywallOpen(false)}
      />
    </section>
  );
}
