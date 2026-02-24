'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/components/i18n/I18nContext';
import Button from '@/components/ui/Button';
import ContentStudioModal from '@/components/content/ContentStudioModal';
import { glass, glassStrong, ringAccent } from '@/components/ui/glass';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useSupabase } from '@/hooks/useSupabase';
import { cn } from '@/lib/utils';
import {
  extractPrimaryEvidenceQuote,
  GROWTH_NO_DATA_THEME,
  GROWTH_NO_RECURRING_ISSUES_THEME,
  pickOpportunity,
  pickStrongPoint,
  type GrowthHubTheme,
  type GrowthHubThemesPayload,
} from '@/lib/growth-hub';
import {
  deriveScheduledAtFromBestTime,
  getCurrentWeekStartMonday,
  normalizeWeekStartMonday,
  plannerChannelFromSuggestionType,
} from '@/lib/planner';
import type {
  ContentPlannerChannel,
  ContentPlannerItemType,
  ContentPlannerStatus,
  ContentSuggestion,
} from '@/types/database';

type ContentLanguage = 'ca' | 'es' | 'en';
type StudioFormat = 'story' | 'feed';

type InsightApiPayload = {
  id?: string;
  week_start?: string;
  source_platforms?: string[];
  themes?: {
    top_themes?: GrowthHubTheme[];
    differentiators?: string[];
    complaints?: string[];
    audience_signals?: string[];
  };
};

type GrowthGenerateResponse = {
  insightId?: string;
  language?: ContentLanguage;
  insight?: InsightApiPayload;
  suggestions?: ContentSuggestion[];
  request_id?: string;
  error?: string;
  message?: string;
};

type PlannerItem = {
  id: string;
  scheduled_at: string;
  channel: ContentPlannerChannel;
  item_type: ContentPlannerItemType;
  title: string;
  status: ContentPlannerStatus;
  suggestion_id: string | null;
  asset_id: string | null;
  text_post_id: string | null;
};

type PlannerListResponse = {
  weekStart?: string;
  items?: PlannerItem[];
  request_id?: string;
  error?: string;
  message?: string;
};

type PlannerMutateResponse = {
  item?: PlannerItem;
  deduped?: boolean;
  request_id?: string;
  error?: string;
  message?: string;
};

type PlannerWebhookSendResponse = {
  ok?: boolean;
  status?: 'sent' | 'failed' | 'skipped';
  response_code?: number | null;
  error?: string;
  request_id?: string;
  message?: string;
};

type WebhookConfigResponse = {
  enabled?: boolean;
  url?: string | null;
  channels?: ContentPlannerChannel[];
  connectors?: Array<{
    id: string;
    type: 'webhook';
    enabled: boolean;
    url: string | null;
    allowed_channels: Array<'ig_feed' | 'ig_story' | 'ig_reel'>;
    secret_present: boolean;
  }>;
  request_id?: string;
  error?: string;
  message?: string;
};

type WeeklyExportResponse = {
  exportId?: string;
  weekStart?: string;
  language?: ContentLanguage;
  signedUrl?: string;
  bytes?: number;
  itemsCount?: number;
  request_id?: string;
  error?: string;
  message?: string;
};

type MetricsSeriesPoint = {
  day: string;
  avg_rating?: number | null;
};

type MetricsSummaryPayload = {
  totals?: {
    replies_generated?: number;
    assets_created?: number;
    time_saved_minutes_est?: number;
  };
  value?: {
    time_saved_hours?: number;
  };
  series?: MetricsSeriesPoint[];
  request_id?: string;
  error?: string;
  message?: string;
};

type OnboardingStatusResponse = {
  completed?: boolean;
  dismissed?: boolean;
  request_id?: string;
  error?: string;
  message?: string;
};

function getWeekRange(weekStart: string): { from: string; to: string } {
  const start = new Date(`${weekStart}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  return {
    from: start.toISOString(),
    to: end.toISOString(),
  };
}

function asThemesPayload(raw: unknown): GrowthHubThemesPayload {
  if (!raw || typeof raw !== 'object') {
    return { top_themes: [], differentiators: [], complaints: [] };
  }

  const data = raw as {
    top_themes?: unknown;
    differentiators?: unknown;
    complaints?: unknown;
  };

  const topThemes = Array.isArray(data.top_themes)
    ? data.top_themes
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const rec = item as { theme?: unknown; mentions?: unknown; sentiment?: unknown };
          const theme = typeof rec.theme === 'string' ? rec.theme.trim() : '';
          const mentions = typeof rec.mentions === 'number' && Number.isFinite(rec.mentions)
            ? Math.max(0, Math.round(rec.mentions))
            : 0;
          const sentiment = rec.sentiment === 'positive' || rec.sentiment === 'neutral' || rec.sentiment === 'negative'
            ? rec.sentiment
            : undefined;
          if (!theme) return null;
          return { theme, mentions, sentiment } as GrowthHubTheme;
        })
        .filter((item): item is GrowthHubTheme => item !== null)
    : [];

  const differentiators = Array.isArray(data.differentiators)
    ? data.differentiators.map((value) => (typeof value === 'string' ? value.trim() : '')).filter(Boolean)
    : [];

  const complaints = Array.isArray(data.complaints)
    ? data.complaints.map((value) => (typeof value === 'string' ? value.trim() : '')).filter(Boolean)
    : [];

  return {
    top_themes: topThemes,
    differentiators,
    complaints,
  };
}

function toLocalPlannerLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

function plannerChannelLabel(channel: ContentPlannerChannel): string {
  if (channel === 'ig_story') return 'IG Story';
  if (channel === 'ig_feed') return 'IG Feed';
  if (channel === 'ig_reel') return 'IG Reel';
  if (channel === 'threads') return 'Threads';
  return 'X';
}

function formatSignedDelta(value: number | null): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  if (value === 0) return '0.0';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}`;
}

export default function GrowthHubPage() {
  const t = useT();
  const router = useRouter();
  const supabase = useSupabase();
  const { biz } = useWorkspace();

  const initialLanguage = useMemo<ContentLanguage>(() => {
    const value = biz?.default_language;
    if (value === 'es' || value === 'en') return value;
    return 'ca';
  }, [biz?.default_language]);

  const [weekStart, setWeekStart] = useState<string>(getCurrentWeekStartMonday);
  const [language, setLanguage] = useState<ContentLanguage>(initialLanguage);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [insightId, setInsightId] = useState<string | null>(null);
  const [themes, setThemes] = useState<GrowthHubThemesPayload>({ top_themes: [], differentiators: [], complaints: [] });
  const [suggestions, setSuggestions] = useState<ContentSuggestion[]>([]);
  const [negativeReviewId, setNegativeReviewId] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [plannerItems, setPlannerItems] = useState<PlannerItem[]>([]);
  const [plannerLoading, setPlannerLoading] = useState(false);
  const [plannerPendingKey, setPlannerPendingKey] = useState<string | null>(null);
  const [webhookEnabled, setWebhookEnabled] = useState(false);
  const [webhookChannels, setWebhookChannels] = useState<ContentPlannerChannel[]>([]);
  const [webhookPendingId, setWebhookPendingId] = useState<string | null>(null);
  const [webhookStatusByItem, setWebhookStatusByItem] = useState<Record<string, { status: 'sent' | 'failed' | 'skipped'; requestId?: string; error?: string }>>({});
  const [exportingWeekly, setExportingWeekly] = useState(false);
  const [exportSignedUrl, setExportSignedUrl] = useState<string | null>(null);
  const [exportRequestId, setExportRequestId] = useState<string | null>(null);
  const [copiedExportLink, setCopiedExportLink] = useState(false);
  const [studioOpen, setStudioOpen] = useState(false);
  const [studioSuggestion, setStudioSuggestion] = useState<ContentSuggestion | null>(null);
  const [studioInitialFormat, setStudioInitialFormat] = useState<StudioFormat>('story');
  const [showOnboardingBanner, setShowOnboardingBanner] = useState(false);
  const [onboardingLoading, setOnboardingLoading] = useState(false);
  const [dismissingOnboarding, setDismissingOnboarding] = useState(false);
  const [weeklySummary, setWeeklySummary] = useState<MetricsSummaryPayload | null>(null);

  const ideasRef = useRef<HTMLDivElement | null>(null);
  const loadPlanSeqRef = useRef(0);

  useEffect(() => {
    setLanguage(initialLanguage);
  }, [initialLanguage]);

  useEffect(() => {
    if (!biz) return;
    void loadExistingPlan();
    void loadNegativeReview();
  }, [biz?.id, weekStart, language]);

  useEffect(() => {
    if (!biz) return;
    void loadOnboardingBanner();
  }, [biz?.id]);

  useEffect(() => {
    if (!biz) return;
    void loadPlanner();
  }, [biz?.id, weekStart]);

  useEffect(() => {
    if (!biz) return;
    void loadWebhookConfig();
  }, [biz?.id]);

  useEffect(() => {
    if (!biz) return;
    void loadWeeklySummary();
  }, [biz?.id]);

  useEffect(() => {
    setExportSignedUrl(null);
    setExportRequestId(null);
    setCopiedExportLink(false);
  }, [biz?.id, weekStart, language]);

  useEffect(() => {
    setWebhookStatusByItem({});
  }, [biz?.id, weekStart]);

  const strongPoint = useMemo(() => pickStrongPoint(themes), [themes]);
  const opportunity = useMemo(() => pickOpportunity(themes), [themes]);
  const strongPointThemeLabel = useMemo(
    () => (strongPoint.theme === GROWTH_NO_DATA_THEME ? t('dashboard.growth.impactNoActivity') : strongPoint.theme),
    [strongPoint.theme, t],
  );
  const opportunityThemeLabel = useMemo(
    () => (opportunity.theme === GROWTH_NO_RECURRING_ISSUES_THEME ? t('dashboard.growth.noRecurringIssues') : opportunity.theme),
    [opportunity.theme, t],
  );
  const primaryEvidence = useMemo(() => extractPrimaryEvidenceQuote(suggestions), [suggestions]);
  const weeklyRatingDelta = useMemo(() => {
    const points = (weeklySummary?.series || [])
      .map((point) => (typeof point.avg_rating === 'number' ? point.avg_rating : null))
      .filter((value): value is number => value !== null);

    if (points.length < 2) return null;
    return points[points.length - 1] - points[0];
  }, [weeklySummary?.series]);

  const weeklyHoursSaved = useMemo(() => {
    const valueHours = weeklySummary?.value?.time_saved_hours;
    if (typeof valueHours === 'number' && Number.isFinite(valueHours)) {
      return valueHours;
    }

    const minutes = weeklySummary?.totals?.time_saved_minutes_est;
    if (typeof minutes === 'number' && Number.isFinite(minutes)) {
      return minutes / 60;
    }

    return 0;
  }, [weeklySummary?.totals?.time_saved_minutes_est, weeklySummary?.value?.time_saved_hours]);

  const impactSentence = useMemo(() => {
    if (!weeklySummary) return t('dashboard.growth.impactNoActivity');
    if (typeof weeklyRatingDelta === 'number' && weeklyRatingDelta > 0) {
      return t('dashboard.growth.impactSentenceImproving');
    }
    return t('dashboard.growth.impactSentenceNeutral');
  }, [t, weeklyRatingDelta, weeklySummary]);

  async function loadPlanner() {
    if (!biz) return;
    setPlannerLoading(true);

    try {
      const params = new URLSearchParams();
      params.set('weekStart', normalizeWeekStartMonday(weekStart));
      params.set('limit', '50');

      const response = await fetch(`/api/planner?${params.toString()}`, {
        headers: {
          'x-biz-id': biz.id,
        },
      });

      const payload = (await response.json().catch(() => ({}))) as PlannerListResponse;
      if (!response.ok || payload.error || !Array.isArray(payload.items)) {
        setPlannerItems([]);
        setPlannerLoading(false);
        return;
      }

      setPlannerItems(payload.items);
      setPlannerLoading(false);
    } catch {
      setPlannerItems([]);
      setPlannerLoading(false);
    }
  }

  async function loadWebhookConfig() {
    if (!biz) return;
    try {
      const response = await fetch('/api/integrations/connectors', {
        headers: { 'x-biz-id': biz.id },
      });
      const payload = (await response.json().catch(() => ({}))) as WebhookConfigResponse;
      if (!response.ok || payload.error) {
        throw new Error(payload.message || payload.error || 'connectors_load_failed');
      }

      const connector = Array.isArray(payload.connectors) ? payload.connectors[0] : undefined;
      if (connector) {
        setWebhookEnabled(!!connector.enabled);
        setWebhookChannels(Array.isArray(connector.allowed_channels) ? connector.allowed_channels : []);
        return;
      }

      setWebhookEnabled(false);
      setWebhookChannels([]);
    } catch {
      try {
        const legacyResponse = await fetch('/api/webhooks/config', {
          headers: { 'x-biz-id': biz.id },
        });
        const legacyPayload = (await legacyResponse.json().catch(() => ({}))) as WebhookConfigResponse;
        if (!legacyResponse.ok || legacyPayload.error) {
          setWebhookEnabled(false);
          setWebhookChannels([]);
          return;
        }

        setWebhookEnabled(!!legacyPayload.enabled);
        setWebhookChannels(Array.isArray(legacyPayload.channels) ? legacyPayload.channels : []);
      } catch {
        setWebhookEnabled(false);
        setWebhookChannels([]);
      }
    }
  }

  async function loadWeeklySummary() {
    if (!biz) return;

    try {
      const response = await fetch('/api/metrics/summary?range=7', {
        headers: { 'x-biz-id': biz.id },
      });

      const payload = (await response.json().catch(() => ({}))) as MetricsSummaryPayload;
      if (!response.ok || payload.error) {
        setWeeklySummary(null);
        return;
      }

      setWeeklySummary(payload);
    } catch {
      setWeeklySummary(null);
    }
  }

  async function loadExistingPlan() {
    if (!biz) return;
    const seq = ++loadPlanSeqRef.current;

    setError(null);

    const { data: insightData, error: insightError } = await supabase
      .from('content_insights')
      .select('id, themes')
      .eq('business_id', biz.id)
      .eq('week_start', weekStart)
      .eq('language', language)
      .maybeSingle();

    if (seq !== loadPlanSeqRef.current) return;

    if (insightError || !insightData) {
      setInsightId(null);
      setThemes({ top_themes: [], differentiators: [], complaints: [] });
      setSuggestions([]);
      return;
    }

    setInsightId(insightData.id as string);
    setThemes(asThemesPayload(insightData.themes));

    const { data: suggestionsData } = await supabase
      .from('content_suggestions')
      .select('id, insight_id, business_id, language, type, title, hook, shot_list, caption, cta, best_time, hashtags, evidence, status, created_at')
      .eq('insight_id', insightData.id)
      .order('created_at', { ascending: true })
      .limit(3);

    if (seq !== loadPlanSeqRef.current) return;

    const loadedSuggestions = (suggestionsData || []) as ContentSuggestion[];
    setSuggestions(loadedSuggestions);
  }

  async function loadNegativeReview() {
    if (!biz) return;

    const { from, to } = getWeekRange(weekStart);

    const { data: reviewData } = await supabase
      .from('reviews')
      .select('id')
      .eq('biz_id', biz.id)
      .lte('rating', 2)
      .gte('review_date', from)
      .lt('review_date', to)
      .order('review_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (reviewData?.id) {
      setNegativeReviewId(reviewData.id as string);
      return;
    }

    const { data: fallbackData } = await supabase
      .from('reviews')
      .select('id')
      .eq('biz_id', biz.id)
      .lte('rating', 2)
      .gte('created_at', from)
      .lt('created_at', to)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    setNegativeReviewId((fallbackData?.id as string | undefined) || null);
  }

  async function handleGeneratePlan() {
    if (!biz) return;

    // Ignore older async "load existing plan" responses that may arrive late.
    loadPlanSeqRef.current += 1;
    setLoading(true);
    setError(null);

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

      const payload = (await response.json().catch(() => ({}))) as GrowthGenerateResponse;
      const requestId = payload.request_id || response.headers.get('x-request-id');

      if (!response.ok || payload.error) {
        const message = payload.message || t('dashboard.growth.generatePlanError');
        setError(requestId ? `${message} (ID: ${requestId})` : message);
        setLoading(false);
        return;
      }

      setInsightId(payload.insightId || payload.insight?.id || null);
      if (payload.language) setLanguage(payload.language);
      setSuggestions(payload.suggestions || []);

      const incomingThemes = payload.insight?.themes ? asThemesPayload(payload.insight.themes) : null;
      if (incomingThemes && (incomingThemes.top_themes.length > 0 || incomingThemes.differentiators.length > 0 || incomingThemes.complaints.length > 0)) {
        setThemes(incomingThemes);
      } else {
        await loadExistingPlan();
      }

      await loadNegativeReview();
      setLoading(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('dashboard.growth.generatePlanError'));
      setLoading(false);
    }
  }

  async function copyText(key: string, value: string | null | undefined) {
    await navigator.clipboard.writeText(value || '');
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey(null), 1200);
  }

  async function approveSuggestion(id: string) {
    if (!biz) return;

    setApprovingId(id);
    setError(null);

    try {
      const response = await fetch(`/api/content-intel/suggestions/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-biz-id': biz.id,
        },
        body: JSON.stringify({ status: 'approved' }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        suggestion?: ContentSuggestion;
        error?: string;
        message?: string;
        request_id?: string;
      };

      if (!response.ok || payload.error || !payload.suggestion) {
        const requestId = payload.request_id || response.headers.get('x-request-id');
        const message = payload.message || t('dashboard.growth.approveIdeaError');
        setError(requestId ? `${message} (ID: ${requestId})` : message);
        setApprovingId(null);
        return;
      }

      setSuggestions((prev) => prev.map((item) => (item.id === id ? payload.suggestion! : item)));
      setApprovingId(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('dashboard.growth.approveIdeaError'));
      setApprovingId(null);
    }
  }

  async function addSuggestionToPlanner(suggestion: ContentSuggestion) {
    if (!biz) return;

    const pendingKey = `add-${suggestion.id}`;
    setPlannerPendingKey(pendingKey);
    setError(null);

    try {
      const response = await fetch('/api/planner', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-biz-id': biz.id,
        },
        body: JSON.stringify({
          businessId: biz.id,
          weekStart: normalizeWeekStartMonday(weekStart),
          scheduledAt: deriveScheduledAtFromBestTime({
            bestTime: suggestion.best_time,
            weekStart,
          }),
          channel: plannerChannelFromSuggestionType(suggestion.type),
          itemType: 'suggestion',
          suggestionId: suggestion.id,
          title: suggestion.title || t('dashboard.growth.defaultPlannerTitle'),
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as PlannerMutateResponse;
      const requestId = payload.request_id || response.headers.get('x-request-id');

      if (!response.ok || payload.error || !payload.item) {
        const message = payload.message || t('dashboard.growth.plannerErrorSave');
        setError(requestId ? `${message} (ID: ${requestId})` : message);
        setPlannerPendingKey(null);
        return;
      }

      await loadPlanner();
      setPlannerPendingKey(null);
    } catch (plannerError: unknown) {
      setError(plannerError instanceof Error ? plannerError.message : t('dashboard.growth.plannerErrorSave'));
      setPlannerPendingKey(null);
    }
  }

  async function markPlannerPublished(id: string) {
    if (!biz) return;

    const pendingKey = `publish-${id}`;
    setPlannerPendingKey(pendingKey);
    setError(null);

    try {
      const response = await fetch(`/api/planner/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-biz-id': biz.id,
        },
        body: JSON.stringify({ status: 'published' }),
      });

      const payload = (await response.json().catch(() => ({}))) as PlannerMutateResponse;
      const requestId = payload.request_id || response.headers.get('x-request-id');

      if (!response.ok || payload.error || !payload.item) {
        const message = payload.message || t('dashboard.growth.plannerErrorPublish');
        setError(requestId ? `${message} (ID: ${requestId})` : message);
        setPlannerPendingKey(null);
        return;
      }

      setPlannerItems((prev) => prev.map((item) => (item.id === id ? payload.item! : item)));
      setPlannerPendingKey(null);
    } catch (plannerError: unknown) {
      setError(plannerError instanceof Error ? plannerError.message : t('dashboard.growth.plannerErrorPublish'));
      setPlannerPendingKey(null);
    }
  }

  async function sendPlannerWebhook(id: string) {
    if (!biz) return;

    setWebhookPendingId(id);
    setError(null);

    try {
      const response = await fetch(`/api/planner/${id}/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-biz-id': biz.id,
        },
        body: JSON.stringify({ event: 'planner.ready' }),
      });

      const payload = (await response.json().catch(() => ({}))) as PlannerWebhookSendResponse;
      const requestId = payload.request_id || response.headers.get('x-request-id') || undefined;

      if (!response.ok || payload.error || !payload.status) {
        const message = payload.message || t('dashboard.growth.webhookSendError');
        setError(requestId ? `${message} (ID: ${requestId})` : message);
        setWebhookStatusByItem((prev) => ({
          ...prev,
          [id]: { status: 'failed', requestId, error: payload.error || message },
        }));
        setWebhookPendingId(null);
        return;
      }

      setWebhookStatusByItem((prev) => ({
        ...prev,
        [id]: { status: payload.status!, requestId, error: payload.error },
      }));
      setWebhookPendingId(null);
    } catch (webhookError: unknown) {
      setError(webhookError instanceof Error ? webhookError.message : t('dashboard.growth.webhookSendError'));
      setWebhookStatusByItem((prev) => ({
        ...prev,
        [id]: { status: 'failed', error: webhookError instanceof Error ? webhookError.message : t('common.unknown') },
      }));
      setWebhookPendingId(null);
    }
  }

  async function handleWeeklyExport() {
    if (!biz) return;

    setExportingWeekly(true);
    setError(null);
    setCopiedExportLink(false);

    try {
      const response = await fetch('/api/exports/weekly', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-biz-id': biz.id,
        },
        body: JSON.stringify({
          weekStart: normalizeWeekStartMonday(weekStart),
          language,
          includeAssets: true,
          includeTexts: true,
          includeCsv: true,
          includeReadme: true,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as WeeklyExportResponse;
      const requestId = payload.request_id || response.headers.get('x-request-id');

      if (!response.ok || payload.error || !payload.signedUrl || !payload.exportId) {
        const message = payload.message || t('dashboard.growth.exportError');
        setError(requestId ? `${message} (ID: ${requestId})` : message);
        setExportingWeekly(false);
        return;
      }

      setExportSignedUrl(payload.signedUrl);
      setExportRequestId(requestId || null);
      setExportingWeekly(false);
    } catch (exportError: unknown) {
      setError(exportError instanceof Error ? exportError.message : t('dashboard.growth.exportError'));
      setExportingWeekly(false);
    }
  }

  async function copyExportLink() {
    if (!exportSignedUrl) return;
    await navigator.clipboard.writeText(exportSignedUrl);
    setCopiedExportLink(true);
    window.setTimeout(() => setCopiedExportLink(false), 1200);
  }

  function openStudio(suggestion: ContentSuggestion, format: StudioFormat) {
    setStudioSuggestion(suggestion);
    setStudioInitialFormat(format);
    setStudioOpen(true);
  }

  async function loadOnboardingBanner() {
    if (!biz) return;
    setOnboardingLoading(true);

    try {
      const response = await fetch('/api/onboarding', {
        headers: {
          'x-biz-id': biz.id,
        },
      });

      const payload = (await response.json().catch(() => ({}))) as OnboardingStatusResponse;
      if (!response.ok || payload.error) {
        setShowOnboardingBanner(false);
        setOnboardingLoading(false);
        return;
      }

      setShowOnboardingBanner(!payload.completed && !payload.dismissed);
      setOnboardingLoading(false);
    } catch {
      setShowOnboardingBanner(false);
      setOnboardingLoading(false);
    }
  }

  async function dismissOnboardingBanner() {
    if (!biz) return;
    setDismissingOnboarding(true);

    try {
      const response = await fetch('/api/onboarding', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-biz-id': biz.id,
        },
        body: JSON.stringify({ dismissed: true }),
      });

      if (response.ok) {
        setShowOnboardingBanner(false);
      }
      setDismissingOnboarding(false);
    } catch {
      setDismissingOnboarding(false);
    }
  }

  if (!biz) {
    return (
      <div className="flex items-center justify-center h-[60vh] text-white/55">
        <div className="text-center">
          <p className="text-3xl mb-2">📈</p>
          <p className="font-medium">{t('dashboard.growth.selectBusiness')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6" data-testid="growth-page">
      {!onboardingLoading && showOnboardingBanner && (
        <section className={`${glass} border border-amber-300/40 rounded-2xl p-4 shadow-glass flex flex-col gap-3 md:flex-row md:items-center md:justify-between`}>
          <div>
            <h2 className="text-sm font-semibold text-amber-200">{t('dashboard.onboarding.bannerTitle')}</h2>
            <p className="text-xs text-amber-100/80 mt-1">{t('dashboard.onboarding.bannerSubtitle')}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => router.push('/dashboard/onboarding')}
              className={cn('px-3 py-2 rounded-xl bg-amber-500/85 text-white text-xs font-medium transition-all duration-[220ms] ease-premium hover:bg-amber-500', ringAccent)}
              data-testid="onboarding-start"
            >
              {t('dashboard.onboarding.bannerStart')}
            </button>
            <button
              onClick={() => void dismissOnboardingBanner()}
              disabled={dismissingOnboarding}
              className={cn('px-3 py-2 rounded-xl border border-amber-300/45 text-amber-100 text-xs font-medium transition-all duration-[220ms] ease-premium hover:bg-amber-500/18 disabled:opacity-50', ringAccent)}
            >
              {t('dashboard.onboarding.bannerDismiss')}
            </button>
          </div>
        </section>
      )}

      <section className={`${glassStrong} border border-white/10 p-5 shadow-glass`}>
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="font-display text-xl font-bold text-white/92">{t('dashboard.growth.impactTitle')}</h1>
            <p className="text-sm text-white/68 mt-1">{t('dashboard.growth.subtitle')}</p>
            {insightId && <p className="text-xs text-white/55 mt-2">{t('dashboard.growth.insightIdLabel')}: {insightId}</p>}
          </div>

          <div className="flex flex-wrap gap-3">
            <label className="text-sm text-white/72">
              {t('dashboard.growth.weekLabel')}
              <input
                type="date"
                value={weekStart}
                onChange={(event) => setWeekStart(normalizeWeekStartMonday(event.target.value))}
                className={cn('mt-1 block w-44 rounded-xl border border-white/14 bg-white/8 px-3 py-2 text-sm text-white/90', ringAccent)}
                data-testid="growth-week-picker"
              />
            </label>

            <label className="text-sm text-white/72">
              {t('common.language')}
              <select
                value={language}
                onChange={(event) => setLanguage(event.target.value as ContentLanguage)}
                className={cn('mt-1 block w-32 rounded-xl border border-white/14 bg-white/8 px-3 py-2 text-sm text-white/90', ringAccent)}
                data-testid="growth-language-picker"
              >
                <option value="ca">{t('common.locales.ca')}</option>
                <option value="es">{t('common.locales.es')}</option>
                <option value="en">{t('common.locales.en')}</option>
              </select>
            </label>

            <Button
              onClick={() => void handleGeneratePlan()}
              loading={loading}
              className="self-end"
              data-testid="growth-generate-btn"
            >
              {t('dashboard.growth.generatePlan')}
            </Button>
          </div>
        </div>
      </section>

      <section className={`${glassStrong} border border-white/10 p-5 shadow-glass space-y-4`}>
        <h2 className="text-base font-semibold text-white/92">{t('dashboard.growth.weekSummaryTitle')}</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <article className={`${glass} border border-white/10 p-4`}>
            <p className="text-[11px] uppercase tracking-wide text-white/55 font-semibold">{t('dashboard.growth.summaryReviewsAnswered')}</p>
            <p className="mt-2 text-2xl font-bold text-white/92">{weeklySummary?.totals?.replies_generated ?? 0}</p>
          </article>
          <article className={`${glass} border border-white/10 p-4`}>
            <p className="text-[11px] uppercase tracking-wide text-white/55 font-semibold">{t('dashboard.growth.summaryPostsCreated')}</p>
            <p className="mt-2 text-2xl font-bold text-white/92">{weeklySummary?.totals?.assets_created ?? 0}</p>
          </article>
          <article className={`${glass} border border-white/10 p-4`}>
            <p className="text-[11px] uppercase tracking-wide text-white/55 font-semibold">{t('dashboard.growth.summaryHoursSaved')}</p>
            <p className="mt-2 text-2xl font-bold text-white/92">{weeklyHoursSaved.toFixed(1)} h</p>
          </article>
          <article className={`${glass} border border-white/10 p-4`}>
            <p className="text-[11px] uppercase tracking-wide text-white/55 font-semibold">{t('dashboard.growth.summaryRatingChange')}</p>
            <p className="mt-2 text-2xl font-bold text-white/92">{formatSignedDelta(weeklyRatingDelta)}</p>
          </article>
        </div>
        <p className="text-sm text-emerald-200/85">{impactSentence}</p>
      </section>

      {error && (
        <div className="rounded-xl border border-rose-400/40 bg-rose-500/12 px-4 py-3 text-sm text-rose-200 shadow-glass">
          {error}
        </div>
      )}

      <section className="grid gap-4 md:grid-cols-2">
        <article className={`${glass} border border-emerald-300/30 p-5 shadow-glass transition-all duration-[220ms] ease-premium hover:shadow-float`} data-testid="growth-strong-point-card">
          <div>
            <p className="text-xs uppercase tracking-wider text-emerald-300 font-bold">{t('dashboard.growth.mixLabel')}</p>
            <h2 className="text-lg font-semibold text-white/92">{t('dashboard.growth.strongPoint')}</h2>
          </div>

          <div className="rounded-xl border border-emerald-300/35 bg-emerald-500/14 px-4 py-3">
            <p className="font-semibold text-emerald-100">{strongPointThemeLabel}</p>
            <p className="text-sm text-emerald-200/85 mt-1">{strongPoint.mentions} {t('dashboard.growth.mentionsSuffix')}</p>
          </div>

          {primaryEvidence && (
            <blockquote className="text-sm text-white/72 italic border-l-2 border-emerald-200 pl-3">
              “{primaryEvidence}”
            </blockquote>
          )}

          <Button
            variant="secondary"
            onClick={() => ideasRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          >
            {t('dashboard.growth.createContent')}
          </Button>
        </article>

        <article className={`${glass} border border-amber-300/30 p-5 shadow-glass transition-all duration-[220ms] ease-premium hover:shadow-float`} data-testid="growth-opportunity-card">
          <div>
            <p className="text-xs uppercase tracking-wider text-amber-300 font-bold">{t('dashboard.growth.mixLabel')}</p>
            <h2 className="text-lg font-semibold text-white/92">{t('dashboard.growth.opportunity')}</h2>
          </div>

          <div className="rounded-xl border border-amber-300/35 bg-amber-500/14 px-4 py-3">
            <p className="font-semibold text-amber-100">{opportunityThemeLabel}</p>
            <p className="text-sm text-amber-200/88 mt-1">{opportunity.complaint || t('dashboard.growth.noRecurringIssues')}</p>
            {opportunity.hasOpportunity && (
              <p className="text-xs text-amber-200/85 mt-2">{opportunity.mentions} {t('dashboard.growth.mentionsSuffix')}</p>
            )}
          </div>

          <button
            onClick={() => {
              if (negativeReviewId) router.push(`/dashboard/inbox/${negativeReviewId}`);
            }}
            disabled={!negativeReviewId}
            title={!negativeReviewId ? t('dashboard.growth.noNegativeWeekly') : ''}
            className={cn('inline-flex items-center justify-center px-4 py-2 rounded-xl bg-amber-500/85 text-white text-sm font-medium transition-all duration-[220ms] ease-premium hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed', ringAccent)}
          >
            {t('dashboard.growth.generateResponse')}
          </button>
        </article>
      </section>

      <section ref={ideasRef} className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white/92">{t('dashboard.growth.readyIdeas')}</h3>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {suggestions.map((suggestion) => (
            <article key={suggestion.id} className={`${glass} border border-white/10 p-4 shadow-glass transition-all duration-[220ms] ease-premium hover:border-white/15 hover:shadow-float`} data-testid="growth-suggestion-card">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs uppercase tracking-wider text-white/55 font-semibold">{suggestion.type}</p>
                  <h4 className="font-semibold text-white/92 leading-tight">{suggestion.title || t('dashboard.growth.defaultIdeaTitle')}</h4>
                </div>
                <span className="text-[11px] px-2 py-1 rounded-full border border-white/14 bg-white/5 text-white/72">{suggestion.status}</span>
              </div>

              <p className="text-sm text-white/82"><strong>{t('dashboard.growth.hookLabel')}:</strong> {suggestion.hook}</p>
              <p className="text-sm text-white/82 whitespace-pre-line"><strong>{t('dashboard.growth.captionLabel')}:</strong> {suggestion.caption}</p>
              <p className="text-xs text-white/68"><strong>{t('dashboard.growth.bestTimeLabel')}:</strong> {suggestion.best_time || '-'}</p>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => void copyText(`hook-${suggestion.id}`, suggestion.hook)}
                  className="px-3 py-1.5 rounded-lg border border-white/14 text-xs text-white/72 hover:bg-white/5"
                  data-testid="growth-copy-hook"
                >
                  {copiedKey === `hook-${suggestion.id}` ? t('dashboard.growth.copied') : t('dashboard.growth.copyHook')}
                </button>

                <button
                  onClick={() => void copyText(`caption-${suggestion.id}`, suggestion.caption)}
                  className="px-3 py-1.5 rounded-lg border border-white/14 text-xs text-white/72 hover:bg-white/5"
                  data-testid="growth-copy-caption"
                >
                  {copiedKey === `caption-${suggestion.id}` ? t('dashboard.growth.copied') : t('dashboard.growth.copyCaption')}
                </button>

                <button
                  onClick={() => void approveSuggestion(suggestion.id)}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-50"
                  disabled={suggestion.status === 'approved' || suggestion.status === 'published' || approvingId === suggestion.id}
                  data-testid="growth-approve"
                >
                  {approvingId === suggestion.id ? '...' : suggestion.status === 'approved' || suggestion.status === 'published' ? t('dashboard.growth.approved') : t('dashboard.growth.approve')}
                </button>
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  onClick={() => openStudio(suggestion, 'story')}
                  className="px-3 py-1.5 rounded-lg border border-white/14 text-xs text-white/72 hover:bg-white/5"
                >
                  {t('dashboard.growth.createStory')}
                </button>
                <button
                  onClick={() => openStudio(suggestion, 'feed')}
                  className="px-3 py-1.5 rounded-lg border border-white/14 text-xs text-white/72 hover:bg-white/5"
                >
                  {t('dashboard.growth.createFeed')}
                </button>
                <button
                  onClick={() => openStudio(suggestion, 'feed')}
                  className="px-3 py-1.5 rounded-lg border border-white/14 text-xs text-white/72 hover:bg-white/5"
                >
                  {t('dashboard.studio.createXThreads')}
                </button>
                <button
                  onClick={() => void addSuggestionToPlanner(suggestion)}
                  disabled={plannerPendingKey === `add-${suggestion.id}`}
                  className="px-3 py-1.5 rounded-lg border border-white/14 text-xs text-white/72 hover:bg-white/5 disabled:opacity-50"
                  data-testid="planner-add"
                >
                  {plannerPendingKey === `add-${suggestion.id}` ? '...' : t('dashboard.growth.addToPlanner')}
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className={`${glassStrong} border border-white/10 p-5 shadow-glass space-y-3`}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h3 className="text-lg font-semibold text-white/92">{t('dashboard.growth.nextOpportunities')}</h3>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-sm text-white/72">
              {t('dashboard.growth.weekLabel')}
              <input
                type="date"
                value={weekStart}
                onChange={(event) => setWeekStart(normalizeWeekStartMonday(event.target.value))}
                className={cn('mt-1 block w-44 rounded-xl border border-white/14 bg-white/8 px-3 py-2 text-sm text-white/90', ringAccent)}
                data-testid="planner-week-picker"
              />
            </label>
            <button
              onClick={() => void handleWeeklyExport()}
              className={cn('px-3 py-2 rounded-xl border border-white/14 text-sm text-white/82 transition-all duration-[220ms] ease-premium hover:bg-white/8 disabled:opacity-50', ringAccent)}
              disabled={exportingWeekly}
              data-testid="export-weekly-btn"
            >
              {t('dashboard.growth.exportWeekly')}
            </button>
          </div>
        </div>

        {exportingWeekly && (
          <p className="text-sm text-white/68" data-testid="export-weekly-loading">
            {t('dashboard.growth.exportLoading')}
          </p>
        )}

        {exportSignedUrl && (
          <div className="rounded-xl border border-emerald-300/35 bg-emerald-500/12 px-3 py-2 text-sm text-emerald-200">
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={exportSignedUrl}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
                data-testid="export-weekly-link"
              >
                {t('dashboard.growth.exportDownload')}
              </a>
              <button
                onClick={() => void copyExportLink()}
                className="px-2 py-1 rounded-lg border border-emerald-300/50 text-xs hover:bg-emerald-400/20"
                data-testid="export-weekly-copy"
              >
                {copiedExportLink ? t('dashboard.studio.copied') : t('dashboard.growth.exportCopyLink')}
              </button>
              <a href="/dashboard/exports" className="text-xs underline underline-offset-2">
                {t('dashboard.growth.exportOpenHistory')}
              </a>
            </div>
            {exportRequestId && (
              <p className="text-[11px] text-emerald-300 mt-1">ID: {exportRequestId}</p>
            )}
          </div>
        )}

        {plannerLoading && (
          <p className="text-sm text-white/68">{t('common.loading')}</p>
        )}

        {!plannerLoading && plannerItems.length === 0 && (
          <p className="text-sm text-white/68">{t('dashboard.growth.noPlannerItems')}</p>
        )}

        <div className="space-y-2">
          {plannerItems.map((item) => (
            <div key={item.id} className={`${glass} border border-white/10 px-4 py-3 shadow-glass transition-all duration-[220ms] ease-premium hover:border-white/15 hover:shadow-float flex items-center justify-between gap-3`} data-testid="planner-item">
              <div className="space-y-1">
                <p className="text-sm font-medium text-white/88">{toLocalPlannerLabel(item.scheduled_at)}</p>
                <p className="text-xs text-white/68">{item.title}</p>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center rounded-full border border-white/14 bg-white/8 px-2 py-0.5 text-[11px] text-white/72" data-testid="planner-channel-badge">
                    {plannerChannelLabel(item.channel)}
                  </span>
                  <span className="text-[11px] text-white/68">
                    {item.status === 'published' ? t('dashboard.growth.publishedStatus') : t('dashboard.growth.plannedStatus')}
                  </span>
                </div>
                {webhookStatusByItem[item.id] && (
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-white/72" data-testid="planner-webhook-status">
                    <span>
                      {webhookStatusByItem[item.id].status === 'sent'
                        ? t('dashboard.growth.webhookSent')
                        : webhookStatusByItem[item.id].status === 'failed'
                          ? t('dashboard.growth.webhookFailed')
                          : t('dashboard.growth.webhookSkipped')}
                      {webhookStatusByItem[item.id].requestId ? ` · ID: ${webhookStatusByItem[item.id].requestId}` : ''}
                    </span>
                    {webhookStatusByItem[item.id].requestId && (
                      <button
                        type="button"
                        onClick={() => void copyText(`webhook-${item.id}`, webhookStatusByItem[item.id].requestId)}
                        className="rounded border border-white/14 bg-white/8 px-1.5 py-0.5 text-[10px] text-white/72 hover:bg-white/12"
                        data-testid="planner-webhook-copy-id"
                      >
                        {copiedKey === `webhook-${item.id}` ? t('dashboard.growth.copied') : t('dashboard.growth.copyId')}
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-2 justify-end">
                {webhookEnabled && webhookChannels.includes(item.channel) && (
                  <button
                    onClick={() => void sendPlannerWebhook(item.id)}
                    disabled={webhookPendingId === item.id}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/8 border border-white/14 text-white/72 disabled:opacity-50"
                    data-testid="planner-send-webhook"
                  >
                    {webhookPendingId === item.id ? '...' : t('dashboard.growth.sendToPublish')}
                  </button>
                )}
                <button
                  onClick={() => void markPlannerPublished(item.id)}
                  disabled={item.status === 'published' || plannerPendingKey === `publish-${item.id}`}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/8 border border-white/14 text-white/72 disabled:opacity-50"
                  data-testid="planner-mark-published"
                >
                  {item.status === 'published'
                    ? t('dashboard.growth.published')
                    : plannerPendingKey === `publish-${item.id}`
                      ? '...'
                      : t('dashboard.growth.markPublished')}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <ContentStudioModal
        isOpen={studioOpen}
        bizId={biz.id}
        suggestion={studioSuggestion}
        initialFormat={studioInitialFormat}
        onClose={() => setStudioOpen(false)}
      />
    </div>
  );
}
