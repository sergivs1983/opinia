'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import { useT } from '@/components/i18n/I18nContext';
import { glass, glassStrong } from '@/components/ui/glass';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useSupabase } from '@/hooks/useSupabase';
import {
  deriveScheduledAtFromBestTime,
  getCurrentWeekStartMonday,
  plannerChannelFromAssetFormat,
  plannerChannelFromSuggestionType,
} from '@/lib/planner';
import type { ContentSuggestion } from '@/types/database';

type OnboardingLanguage = 'ca' | 'es' | 'en';
type OnboardingStep = 1 | 2 | 3 | 4;
type ActionStatus = 'idle' | 'loading' | 'success' | 'error';
type RetryTarget = 'reply' | 'suggestion' | 'asset';
type StudioFormat = 'story' | 'feed';
type StudioTemplateId = 'quote-clean' | 'feature-split' | 'top3-reasons' | 'behind-scenes';

interface OnboardingStateResponse {
  step?: number;
  completed?: boolean;
  dismissed?: boolean;
  hasReviews?: boolean;
  hasSuggestions?: boolean;
  hasAssets?: boolean;
  hasPlannerItems?: boolean;
  language?: OnboardingLanguage;
  request_id?: string;
  error?: string;
  message?: string;
}

interface OnboardingPatchResponse {
  progress?: {
    step?: number;
    completed?: boolean;
    dismissed?: boolean;
  };
  request_id?: string;
  error?: string;
  message?: string;
}

interface OnboardingSeedResponse {
  seeded?: boolean;
  reason?: string;
  count?: number;
  request_id?: string;
  error?: string;
  message?: string;
}

interface ReviewSummaryRow {
  id: string;
  source: 'google' | 'tripadvisor' | 'booking' | 'manual' | 'other';
  rating: number;
  language_detected: string;
}

interface GenerateReplyResponse {
  option_a?: string;
  option_b?: string;
  option_c?: string;
  request_id?: string;
  error?: string;
  message?: string;
}

interface GenerateSuggestionResponse {
  insightId?: string;
  language?: OnboardingLanguage;
  suggestions?: ContentSuggestion[];
  request_id?: string;
  error?: string;
  message?: string;
}

interface GenerateAssetResponse {
  assetId?: string;
  format?: StudioFormat;
  templateId?: StudioTemplateId;
  signedUrl?: string;
  request_id?: string;
  error?: string;
  message?: string;
}

interface PlannerCreateResponse {
  item?: {
    id: string;
    status: 'planned' | 'published';
  };
  request_id?: string;
  error?: string;
  message?: string;
}

interface ExportWeeklyResponse {
  exportId?: string;
  signedUrl?: string;
  request_id?: string;
  error?: string;
  message?: string;
}

interface ChainErrorState {
  message: string;
  requestId: string | null;
  retryTarget: RetryTarget;
}

interface ReplyResult {
  reviewId: string;
  preview: string;
}

interface AssetResult {
  assetId: string;
  format: StudioFormat;
  templateId: StudioTemplateId;
  signedUrl: string;
}

const DEFAULT_STATE = {
  step: 1,
  completed: false,
  dismissed: false,
  hasReviews: false,
  hasSuggestions: false,
  hasAssets: false,
  hasPlannerItems: false,
};

const TEMPLATE_OPTIONS: StudioTemplateId[] = ['quote-clean', 'feature-split', 'top3-reasons', 'behind-scenes'];

function normalizeStep(value: number | undefined): OnboardingStep {
  if (value === 2 || value === 3 || value === 4) return value;
  return 1;
}

function extractRequestId(response: Response, payload: { request_id?: string }): string | null {
  const fromBody = typeof payload.request_id === 'string' ? payload.request_id.trim() : '';
  if (fromBody) return fromBody;
  const fromHeader = response.headers.get('x-request-id')?.trim();
  return fromHeader || null;
}

function statusBadgeClass(status: ActionStatus): string {
  if (status === 'success') return 'bg-emerald-500/12 text-emerald-300 border-emerald-500/35';
  if (status === 'error') return 'bg-red-500/12 text-red-300 border-red-500/35';
  if (status === 'loading') return 'bg-amber-500/12 text-amber-300 border-amber-500/35';
  return 'bg-white/5 text-white/72 border-white/14';
}

function statusLabel(status: ActionStatus, t: ReturnType<typeof useT>): string {
  if (status === 'success') return t('dashboard.onboarding.actionDone');
  if (status === 'error') return t('dashboard.onboarding.actionError');
  if (status === 'loading') return t('dashboard.onboarding.actionLoading');
  return t('dashboard.onboarding.actionPending');
}

export default function DashboardOnboardingPage() {
  const t = useT();
  const router = useRouter();
  const supabase = useSupabase();
  const { biz } = useWorkspace();

  const [loadingState, setLoadingState] = useState(true);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [state, setState] = useState(DEFAULT_STATE);
  const [currentStep, setCurrentStep] = useState<OnboardingStep>(1);
  const [language, setLanguage] = useState<OnboardingLanguage>('ca');
  const [languageHydrated, setLanguageHydrated] = useState(false);

  const [savingStep, setSavingStep] = useState(false);
  const [seedLoading, setSeedLoading] = useState(false);
  const [plannerLoading, setPlannerLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [chainRunning, setChainRunning] = useState(false);

  const [replyStatus, setReplyStatus] = useState<ActionStatus>('idle');
  const [suggestionStatus, setSuggestionStatus] = useState<ActionStatus>('idle');
  const [assetStatus, setAssetStatus] = useState<ActionStatus>('idle');

  const [replyResult, setReplyResult] = useState<ReplyResult | null>(null);
  const [suggestionResult, setSuggestionResult] = useState<ContentSuggestion | null>(null);
  const [assetResult, setAssetResult] = useState<AssetResult | null>(null);
  const [plannerItemId, setPlannerItemId] = useState<string | null>(null);

  const [exportSignedUrl, setExportSignedUrl] = useState<string | null>(null);
  const [exportRequestId, setExportRequestId] = useState<string | null>(null);
  const [copiedExportLink, setCopiedExportLink] = useState(false);

  const [chainError, setChainError] = useState<ChainErrorState | null>(null);

  const [assetModalOpen, setAssetModalOpen] = useState(false);
  const [assetTemplateId, setAssetTemplateId] = useState<StudioTemplateId>('quote-clean');
  const [assetFormat, setAssetFormat] = useState<StudioFormat>('story');

  const weekStart = useMemo(() => getCurrentWeekStartMonday(), []);

  const voiceConfigured = useMemo(() => {
    if (!biz) return false;
    return Boolean((biz.default_signature || '').trim());
  }, [biz]);

  const brandKitConfigured = useMemo(() => {
    if (!biz) return false;
    const hasInstructions = Boolean((biz.ai_instructions || '').trim());
    const hasPositive = Array.isArray(biz.tone_keywords_positive) && biz.tone_keywords_positive.length > 0;
    const hasNegative = Array.isArray(biz.tone_keywords_negative) && biz.tone_keywords_negative.length > 0;
    return voiceConfigured && (hasInstructions || hasPositive || hasNegative);
  }, [biz, voiceConfigured]);

  useEffect(() => {
    if (!biz) {
      setLoadingState(false);
      return;
    }
    void loadOnboardingState();
  }, [biz?.id]);

  async function loadOnboardingState() {
    if (!biz) return;
    setLoadingState(true);
    setLoadingError(null);

    try {
      const response = await fetch('/api/onboarding', {
        headers: {
          'x-biz-id': biz.id,
        },
      });

      const payload = (await response.json().catch(() => ({}))) as OnboardingStateResponse;
      const requestId = extractRequestId(response, payload);

      if (!response.ok || payload.error) {
        const message = payload.message || t('dashboard.onboarding.errorLoad');
        setLoadingError(requestId ? `${message} (ID: ${requestId})` : message);
        setLoadingState(false);
        return;
      }

      const normalizedStep = normalizeStep(payload.step);
      setState({
        step: normalizedStep,
        completed: Boolean(payload.completed),
        dismissed: Boolean(payload.dismissed),
        hasReviews: Boolean(payload.hasReviews),
        hasSuggestions: Boolean(payload.hasSuggestions),
        hasAssets: Boolean(payload.hasAssets),
        hasPlannerItems: Boolean(payload.hasPlannerItems),
      });
      setCurrentStep(normalizedStep);
      if (!languageHydrated && payload.language) {
        setLanguage(payload.language);
        setLanguageHydrated(true);
      }
      setLoadingState(false);
    } catch (error: unknown) {
      setLoadingError(error instanceof Error ? error.message : t('dashboard.onboarding.errorLoad'));
      setLoadingState(false);
    }
  }

  async function patchProgress(patch: {
    step?: OnboardingStep;
    completed?: boolean;
    dismissed?: boolean;
  }): Promise<boolean> {
    if (!biz) return false;

    setSavingStep(true);
    setLoadingError(null);

    try {
      const response = await fetch('/api/onboarding', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-biz-id': biz.id,
        },
        body: JSON.stringify(patch),
      });

      const payload = (await response.json().catch(() => ({}))) as OnboardingPatchResponse;
      const requestId = extractRequestId(response, payload);

      if (!response.ok || payload.error) {
        const message = payload.message || t('dashboard.onboarding.errorSave');
        setLoadingError(requestId ? `${message} (ID: ${requestId})` : message);
        setSavingStep(false);
        return false;
      }

      setState((prev) => ({
        ...prev,
        step: normalizeStep(payload.progress?.step),
        completed: payload.progress?.completed ?? prev.completed,
        dismissed: payload.progress?.dismissed ?? prev.dismissed,
      }));
      if (payload.progress?.step) {
        setCurrentStep(normalizeStep(payload.progress.step));
      }

      setSavingStep(false);
      return true;
    } catch (error: unknown) {
      setLoadingError(error instanceof Error ? error.message : t('dashboard.onboarding.errorSave'));
      setSavingStep(false);
      return false;
    }
  }

  async function goToStep(step: OnboardingStep) {
    const ok = await patchProgress({ step });
    if (!ok) return;
    setCurrentStep(step);
  }

  async function handleSeedDemo() {
    if (!biz) return;
    setSeedLoading(true);
    setLoadingError(null);

    try {
      const response = await fetch('/api/onboarding/seed', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-biz-id': biz.id,
        },
        body: JSON.stringify({
          businessId: biz.id,
          language,
          count: 5,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as OnboardingSeedResponse;
      const requestId = extractRequestId(response, payload);

      if (!response.ok || payload.error) {
        const message = payload.message || t('dashboard.onboarding.errorSeed');
        setLoadingError(requestId ? `${message} (ID: ${requestId})` : message);
        setSeedLoading(false);
        return;
      }

      if (payload.seeded || payload.reason === 'already_has_reviews') {
        setState((prev) => ({ ...prev, hasReviews: true }));
      }

      setSeedLoading(false);
    } catch (error: unknown) {
      setLoadingError(error instanceof Error ? error.message : t('dashboard.onboarding.errorSeed'));
      setSeedLoading(false);
    }
  }

  async function runGenerateReply(): Promise<boolean> {
    if (!biz) return false;

    setReplyStatus('loading');
    setChainError(null);

    try {
      const { data: reviewData, error: reviewError } = await supabase
        .from('reviews')
        .select('id, source, rating, language_detected')
        .eq('biz_id', biz.id)
        .order('review_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (reviewError || !reviewData) {
        const message = t('dashboard.onboarding.errorNoReview');
        setReplyStatus('error');
        setChainError({ message, requestId: null, retryTarget: 'reply' });
        return false;
      }

      const review = reviewData as ReviewSummaryRow;

      const response = await fetch(`/api/reviews/${review.id}/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          platform: review.source,
          rating: review.rating,
          language: review.language_detected || language,
          regenerate: false,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as GenerateReplyResponse;
      const requestId = extractRequestId(response, payload);

      if (!response.ok || payload.error) {
        const message = payload.message || t('dashboard.onboarding.errorGenerateReply');
        setReplyStatus('error');
        setChainError({ message, requestId, retryTarget: 'reply' });
        return false;
      }

      const preview = payload.option_b || payload.option_a || payload.option_c || '';
      setReplyResult({ reviewId: review.id, preview });
      setReplyStatus('success');
      setState((prev) => ({ ...prev, hasReviews: true }));
      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : t('dashboard.onboarding.errorGenerateReply');
      setReplyStatus('error');
      setChainError({ message, requestId: null, retryTarget: 'reply' });
      return false;
    }
  }

  async function runGenerateSuggestion(): Promise<boolean> {
    if (!biz) return false;

    setSuggestionStatus('loading');
    setChainError(null);

    try {
      const response = await fetch('/api/content-intel/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-biz-id': biz.id,
        },
        body: JSON.stringify({
          businessId: biz.id,
          weekStart,
          language,
          maxReviews: 50,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as GenerateSuggestionResponse;
      const requestId = extractRequestId(response, payload);

      if (!response.ok || payload.error || !Array.isArray(payload.suggestions) || payload.suggestions.length === 0) {
        const message = payload.message || t('dashboard.onboarding.errorGenerateSuggestion');
        setSuggestionStatus('error');
        setChainError({ message, requestId, retryTarget: 'suggestion' });
        return false;
      }

      const firstSuggestion = payload.suggestions[0];
      setSuggestionResult(firstSuggestion);
      setSuggestionStatus('success');
      setState((prev) => ({ ...prev, hasSuggestions: true }));
      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : t('dashboard.onboarding.errorGenerateSuggestion');
      setSuggestionStatus('error');
      setChainError({ message, requestId: null, retryTarget: 'suggestion' });
      return false;
    }
  }

  async function runGenerateAsset(): Promise<boolean> {
    if (!biz || !suggestionResult) {
      const message = t('dashboard.onboarding.errorNeedSuggestion');
      setAssetStatus('error');
      setChainError({ message, requestId: null, retryTarget: 'asset' });
      return false;
    }

    setAssetStatus('loading');
    setChainError(null);

    try {
      const response = await fetch('/api/content-studio/render', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-biz-id': biz.id,
        },
        body: JSON.stringify({
          suggestionId: suggestionResult.id,
          format: assetFormat,
          templateId: assetTemplateId,
          language,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as GenerateAssetResponse;
      const requestId = extractRequestId(response, payload);

      if (!response.ok || payload.error || !payload.assetId || !payload.signedUrl || !payload.templateId || !payload.format) {
        const message = payload.message || t('dashboard.onboarding.errorGenerateAsset');
        setAssetStatus('error');
        setChainError({ message, requestId, retryTarget: 'asset' });
        return false;
      }

      setAssetResult({
        assetId: payload.assetId,
        format: payload.format,
        templateId: payload.templateId,
        signedUrl: payload.signedUrl,
      });
      setAssetStatus('success');
      setState((prev) => ({ ...prev, hasAssets: true }));
      setAssetModalOpen(false);
      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : t('dashboard.onboarding.errorGenerateAsset');
      setAssetStatus('error');
      setChainError({ message, requestId: null, retryTarget: 'asset' });
      return false;
    }
  }

  async function runAhaChain() {
    setChainRunning(true);

    const replyOk = replyStatus === 'success' ? true : await runGenerateReply();
    if (!replyOk) {
      setChainRunning(false);
      return;
    }

    const suggestionOk = suggestionStatus === 'success' ? true : await runGenerateSuggestion();
    if (!suggestionOk) {
      setChainRunning(false);
      return;
    }

    const assetOk = assetStatus === 'success' ? true : await runGenerateAsset();
    if (!assetOk) {
      setChainRunning(false);
      return;
    }

    setChainRunning(false);
  }

  async function retryFromError() {
    if (!chainError) return;
    if (chainError.retryTarget === 'reply') {
      await runGenerateReply();
      return;
    }
    if (chainError.retryTarget === 'suggestion') {
      await runGenerateSuggestion();
      return;
    }
    await runGenerateAsset();
  }

  async function addToPlanner() {
    if (!biz) return;

    setPlannerLoading(true);
    setLoadingError(null);

    try {
      const suggestion = suggestionResult;
      const asset = assetResult;
      if (!suggestion && !asset) {
        setLoadingError(t('dashboard.onboarding.errorNeedSuggestionOrAsset'));
        setPlannerLoading(false);
        return;
      }

      const payload = suggestion
        ? {
            businessId: biz.id,
            weekStart,
            scheduledAt: deriveScheduledAtFromBestTime({
              weekStart,
              bestTime: suggestion.best_time,
            }),
            channel: plannerChannelFromSuggestionType(suggestion.type),
            itemType: 'suggestion',
            suggestionId: suggestion.id,
            title: suggestion.title || t('dashboard.onboarding.defaultPlannerTitle'),
          }
        : {
            businessId: biz.id,
            weekStart,
            scheduledAt: deriveScheduledAtFromBestTime({
              weekStart,
              bestTime: null,
            }),
            channel: plannerChannelFromAssetFormat(asset!.format),
            itemType: 'asset',
            assetId: asset!.assetId,
            title: `Asset: ${asset!.templateId}`,
          };

      const response = await fetch('/api/planner', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-biz-id': biz.id,
        },
        body: JSON.stringify(payload),
      });

      const result = (await response.json().catch(() => ({}))) as PlannerCreateResponse;
      const requestId = extractRequestId(response, result);

      if (!response.ok || result.error || !result.item?.id) {
        const message = result.message || t('dashboard.onboarding.errorPlanner');
        setLoadingError(requestId ? `${message} (ID: ${requestId})` : message);
        setPlannerLoading(false);
        return;
      }

      setPlannerItemId(result.item.id);
      setState((prev) => ({ ...prev, hasPlannerItems: true }));
      setPlannerLoading(false);
    } catch (error: unknown) {
      setLoadingError(error instanceof Error ? error.message : t('dashboard.onboarding.errorPlanner'));
      setPlannerLoading(false);
    }
  }

  async function handleExportWeekly() {
    if (!biz) return;

    setExportLoading(true);
    setLoadingError(null);
    setCopiedExportLink(false);

    try {
      const response = await fetch('/api/exports/weekly', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-biz-id': biz.id,
        },
        body: JSON.stringify({
          weekStart,
          language,
          includeAssets: true,
          includeTexts: true,
          includeCsv: true,
          includeReadme: true,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as ExportWeeklyResponse;
      const requestId = extractRequestId(response, payload);

      if (!response.ok || payload.error || !payload.signedUrl) {
        const message = payload.message || t('dashboard.onboarding.errorExport');
        setLoadingError(requestId ? `${message} (ID: ${requestId})` : message);
        setExportLoading(false);
        return;
      }

      setExportSignedUrl(payload.signedUrl);
      setExportRequestId(requestId);
      setExportLoading(false);
    } catch (error: unknown) {
      setLoadingError(error instanceof Error ? error.message : t('dashboard.onboarding.errorExport'));
      setExportLoading(false);
    }
  }

  async function copyExportLink() {
    if (!exportSignedUrl) return;
    await navigator.clipboard.writeText(exportSignedUrl);
    setCopiedExportLink(true);
    window.setTimeout(() => setCopiedExportLink(false), 1200);
  }

  async function finishOnboarding() {
    const ok = await patchProgress({ completed: true, step: 4 });
    if (!ok) return;
    router.push('/dashboard/growth-hub');
  }

  if (!biz) {
    return (
      <div className="flex items-center justify-center h-[60vh] text-white/55">
        <div className="text-center">
          <p className="text-3xl mb-2">⟡</p>
          <p className="font-medium">{t('dashboard.onboarding.needBusiness')}</p>
        </div>
      </div>
    );
  }

  if (loadingState) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="w-5 h-5 border-2 border-white/25 border-t-brand-accent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6" data-testid="onboarding-page">
      <section className={`${glassStrong} p-5 md:p-6`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-xl font-bold text-white/92">{t('dashboard.onboarding.title')}</h1>
            <p className="text-sm text-white/68 mt-1">{t('dashboard.onboarding.subtitle')}</p>
          </div>
          <Link href="/dashboard/growth-hub" className="text-sm text-emerald-300 hover:text-emerald-200 underline underline-offset-2">
            {t('dashboard.onboarding.skip')}
          </Link>
        </div>

        <div className="mt-4 grid grid-cols-4 gap-2" data-testid="onboarding-step" data-step={currentStep}>
          {[1, 2, 3, 4].map((step) => (
            <div key={step} className="space-y-1">
              <div className={`h-2 rounded-full ${step <= currentStep ? 'bg-brand-accent' : 'bg-white/15'}`} />
              <p className={`text-xs ${step <= currentStep ? 'text-emerald-300' : 'text-white/55'}`}>
                {t('dashboard.onboarding.stepLabel', { n: step, total: 4 })}
              </p>
            </div>
          ))}
        </div>
      </section>

      {loadingError && (
        <div className="rounded-xl border border-red-500/35 bg-red-500/12 px-4 py-3 text-sm text-red-300">
          {loadingError}
        </div>
      )}

      {currentStep === 1 && (
        <section className={`${glassStrong} p-5 space-y-4`}>
          <h2 className="text-lg font-semibold text-white/92">{t('dashboard.onboarding.step1Title')}</h2>

          <label className="text-sm text-white/72 block max-w-xs">
            {t('dashboard.onboarding.languageLabel')}
            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value as OnboardingLanguage)}
              className="mt-1 block w-40 rounded-xl border border-white/14 bg-white/8 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-accent/40"
              data-testid="onboarding-language"
            >
              <option value="ca">{t('common.locales.ca')}</option>
              <option value="es">{t('common.locales.es')}</option>
              <option value="en">{t('common.locales.en')}</option>
            </select>
          </label>

          <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-white/88">{t('dashboard.onboarding.voiceStatus')}</p>
              <p className="text-xs text-white/68">
                {voiceConfigured ? t('dashboard.onboarding.statusComplete') : t('dashboard.onboarding.statusIncomplete')}
              </p>
            </div>
            <Link href="/dashboard/settings" className="text-xs text-emerald-300 hover:text-emerald-200 underline underline-offset-2">
              {t('dashboard.onboarding.openSettings')}
            </Link>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-white/88">{t('dashboard.onboarding.brandKitStatus')}</p>
              <p className="text-xs text-white/68">
                {brandKitConfigured ? t('dashboard.onboarding.statusComplete') : t('dashboard.onboarding.statusIncomplete')}
              </p>
            </div>
            <Link href="/dashboard/settings" className="text-xs text-emerald-300 hover:text-emerald-200 underline underline-offset-2">
              {t('dashboard.onboarding.openSettings')}
            </Link>
          </div>

          <Button onClick={() => void goToStep(2)} loading={savingStep} data-testid="onboarding-next">
            {t('dashboard.onboarding.continue')}
          </Button>
        </section>
      )}

      {currentStep === 2 && (
        <section className={`${glassStrong} p-5 space-y-4`}>
          <h2 className="text-lg font-semibold text-white/92">{t('dashboard.onboarding.step2Title')}</h2>

          {state.hasReviews ? (
            <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/12 px-4 py-3 text-sm text-emerald-300">
              {t('dashboard.onboarding.reviewsDetected')}
            </div>
          ) : (
            <div className="rounded-xl border border-amber-500/35 bg-amber-500/12 px-4 py-3 space-y-3">
              <p className="text-sm text-amber-200">{t('dashboard.onboarding.reviewsMissing')}</p>
              <Button
                variant="secondary"
                onClick={() => void handleSeedDemo()}
                loading={seedLoading}
                data-testid="onboarding-seed-btn"
              >
                {t('dashboard.onboarding.seedDemo')}
              </Button>
            </div>
          )}

          <Button
            onClick={() => void goToStep(3)}
            loading={savingStep}
            disabled={!state.hasReviews && !seedLoading}
            data-testid="onboarding-next"
          >
            {t('dashboard.onboarding.continue')}
          </Button>
        </section>
      )}

      {currentStep === 3 && (
        <section className={`${glassStrong} p-5 space-y-4`}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-white/92">{t('dashboard.onboarding.step3Title')}</h2>
            <Button
              variant="secondary"
              onClick={() => void runAhaChain()}
              loading={chainRunning}
            >
              {t('dashboard.onboarding.runChain')}
            </Button>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <article className={`${glass} p-4 space-y-3`}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-white/88">{t('dashboard.onboarding.generateReply')}</h3>
                <span className={`text-[11px] px-2 py-1 rounded-full border ${statusBadgeClass(replyStatus)}`}>
                  {statusLabel(replyStatus, t)}
                </span>
              </div>
              {replyResult?.preview && (
                <p className="text-xs text-white/72 line-clamp-3">{replyResult.preview}</p>
              )}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void runGenerateReply()}
                  className="px-3 py-1.5 rounded-lg border border-white/14 text-xs text-white/72 hover:bg-white/8 transition-all duration-[220ms] ease-premium"
                  data-testid="onboarding-generate-reply"
                >
                  {t('dashboard.onboarding.runAction')}
                </button>
                {replyResult && (
                  <Link href={`/dashboard/inbox/${replyResult.reviewId}`} className="text-xs text-emerald-300 hover:text-emerald-200 underline underline-offset-2">
                    {t('dashboard.onboarding.view')}
                  </Link>
                )}
              </div>
            </article>

            <article className={`${glass} p-4 space-y-3`}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-white/88">{t('dashboard.onboarding.generateSuggestion')}</h3>
                <span className={`text-[11px] px-2 py-1 rounded-full border ${statusBadgeClass(suggestionStatus)}`}>
                  {statusLabel(suggestionStatus, t)}
                </span>
              </div>
              {suggestionResult?.title && (
                <p className="text-xs text-white/72 line-clamp-3">{suggestionResult.title}</p>
              )}
              <button
                onClick={() => void runGenerateSuggestion()}
                className="px-3 py-1.5 rounded-lg border border-white/14 text-xs text-white/72 hover:bg-white/8 transition-all duration-[220ms] ease-premium"
                data-testid="onboarding-generate-suggestion"
              >
                {t('dashboard.onboarding.runAction')}
              </button>
            </article>

            <article className={`${glass} p-4 space-y-3`}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-white/88">{t('dashboard.onboarding.generateAsset')}</h3>
                <span className={`text-[11px] px-2 py-1 rounded-full border ${statusBadgeClass(assetStatus)}`}>
                  {statusLabel(assetStatus, t)}
                </span>
              </div>
              {assetResult && (
                <div className="text-xs text-white/72">
                  <p>ID: {assetResult.assetId}</p>
                  <a href={assetResult.signedUrl} target="_blank" rel="noreferrer" className="text-brand-600 underline underline-offset-2">
                    {t('dashboard.onboarding.view')}
                  </a>
                </div>
              )}
              <button
                onClick={() => setAssetModalOpen(true)}
                className="px-3 py-1.5 rounded-lg border border-white/14 text-xs text-white/72 hover:bg-white/8 transition-all duration-[220ms] ease-premium"
                data-testid="onboarding-generate-asset"
              >
                {t('dashboard.onboarding.openStudio')}
              </button>
            </article>
          </div>

          {chainError && (
            <div className="rounded-xl border border-red-500/35 bg-red-500/12 px-4 py-3 text-sm text-red-300" data-testid="onboarding-error-box">
              <p>{chainError.message}</p>
              {chainError.requestId && (
                <p className="text-xs mt-1" data-testid="onboarding-error-request-id">ID: {chainError.requestId}</p>
              )}
              <button
                onClick={() => void retryFromError()}
                className="mt-2 px-3 py-1.5 rounded-lg border border-red-400/40 text-xs hover:bg-red-500/20"
              >
                {t('dashboard.onboarding.retry')}
              </button>
            </div>
          )}

          <Button
            onClick={() => void goToStep(4)}
            loading={savingStep}
            disabled={replyStatus !== 'success' || suggestionStatus !== 'success' || assetStatus !== 'success'}
            data-testid="onboarding-next"
          >
            {t('dashboard.onboarding.continue')}
          </Button>
        </section>
      )}

      {currentStep === 4 && (
        <section className={`${glassStrong} p-5 space-y-4`}>
          <h2 className="text-lg font-semibold text-white/92">{t('dashboard.onboarding.step4Title')}</h2>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => void addToPlanner()}
              loading={plannerLoading}
              data-testid="onboarding-add-planner"
            >
              {t('dashboard.onboarding.addPlanner')}
            </Button>

            <Button
              variant="secondary"
              onClick={() => void handleExportWeekly()}
              loading={exportLoading}
              data-testid="onboarding-export-weekly"
            >
              {t('dashboard.onboarding.exportWeekly')}
            </Button>
          </div>

          {plannerItemId && (
            <p className="text-sm text-emerald-300">{t('dashboard.onboarding.plannerAdded')} #{plannerItemId}</p>
          )}

          {exportSignedUrl && (
            <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/12 px-4 py-3 text-sm text-emerald-200">
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={exportSignedUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2"
                  data-testid="onboarding-export-link"
                >
                  {t('dashboard.onboarding.downloadZip')}
                </a>
                <button
                  onClick={() => void copyExportLink()}
                  className="px-2 py-1 rounded-lg border border-emerald-400/40 text-xs hover:bg-emerald-500/20"
                  data-testid="onboarding-export-copy"
                >
                  {copiedExportLink ? t('dashboard.onboarding.copied') : t('dashboard.onboarding.copyLink')}
                </button>
              </div>
              {exportRequestId && (
                <p className="text-[11px] mt-1">ID: {exportRequestId}</p>
              )}
            </div>
          )}

          <Button onClick={() => void finishOnboarding()} loading={savingStep} data-testid="onboarding-finish">
            {t('dashboard.onboarding.finish')}
          </Button>
        </section>
      )}

      {assetModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setAssetModalOpen(false)}>
          <div
            className={`${glassStrong} w-full max-w-md p-5 space-y-4`}
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="font-semibold text-white/92">{t('dashboard.onboarding.studioTitle')}</h3>

            <label className="text-sm text-white/72 block">
              {t('dashboard.onboarding.studioFormat')}
              <select
                value={assetFormat}
                onChange={(event) => setAssetFormat(event.target.value as StudioFormat)}
                className="mt-1 w-full rounded-xl border border-white/14 bg-white/8 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-accent/40"
              >
                <option value="story">{t('dashboard.studio.formatStory')}</option>
                <option value="feed">{t('dashboard.studio.formatFeed')}</option>
              </select>
            </label>

            <label className="text-sm text-white/72 block">
              {t('dashboard.onboarding.studioTemplate')}
              <select
                value={assetTemplateId}
                onChange={(event) => setAssetTemplateId(event.target.value as StudioTemplateId)}
                className="mt-1 w-full rounded-xl border border-white/14 bg-white/8 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-accent/40"
              >
                {TEMPLATE_OPTIONS.map((template) => (
                  <option key={template} value={template}>{template}</option>
                ))}
              </select>
            </label>

            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setAssetModalOpen(false)} data-testid="onboarding-asset-cancel">
                {t('dashboard.onboarding.cancel')}
              </Button>
              <Button onClick={() => void runGenerateAsset()} loading={assetStatus === 'loading'} data-testid="onboarding-asset-generate">
                {t('dashboard.onboarding.generate')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
