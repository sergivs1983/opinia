'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import Tabs from '@/components/ui/Tabs';
import Button from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { useT } from '@/components/i18n/I18nContext';
import { textMain, textSub } from '@/components/ui/glass';

type RecommendationHowTo = {
  why?: string;
  steps?: string[];
  checklist?: string[];
  assets_needed?: string[];
  time_estimate_min?: number;
};

type RecommendationTemplate = {
  format?: string;
  hook?: string;
  idea?: string;
  cta?: string;
  assets_needed?: string[];
  how_to?: RecommendationHowTo;
};

type RecommendationInput = {
  id: string;
  vertical?: string;
  hook?: string;
  idea?: string;
  cta?: string;
  format?: string;
  how_to?: RecommendationHowTo;
  recommendation_template?: RecommendationTemplate;
};

type LitoGeneratedCopy = {
  caption_short: string;
  caption_long: string;
  hashtags: string[];
  shotlist: string[];
  image_idea: string;
  execution_checklist: string[];
  stickers: Array<'poll' | 'question' | 'countdown'>;
  director_notes: string[];
  assets_needed: string[];
  format: 'post' | 'story' | 'reel';
  language: 'ca' | 'es' | 'en';
  channel: 'instagram' | 'tiktok' | 'facebook';
  tone: 'formal' | 'neutral' | 'friendly';
};

type QuotaState = {
  used: number;
  limit: number;
  remaining: number;
};

type CopyApiPayload = {
  ok?: boolean;
  copy?: LitoGeneratedCopy | null;
  quota?: QuotaState | null;
  ai?: {
    available?: boolean;
    provider?: string;
  };
  error?: string;
  message?: string;
};

type GeneratePayload = {
  ok?: boolean;
  copy?: LitoGeneratedCopy;
  quota?: QuotaState;
  error?: string;
  message?: string;
};

type RefineMode = 'shorter' | 'premium' | 'funny' | 'formal' | 'translate_ca' | 'translate_es' | 'translate_en';
type LitoTabKey = 'howto' | 'copy' | 'assets';

type LitoAssistDrawerProps = {
  open: boolean;
  onClose: () => void;
  bizId: string | null;
  businessName?: string | null;
  recommendation?: RecommendationInput | null;
  onMarkPublished?: (recommendationId: string) => Promise<void> | void;
  publishing?: boolean;
};

function normalizedFormat(value: string | undefined): 'post' | 'story' | 'reel' {
  if (value === 'story' || value === 'reel') return value;
  return 'post';
}

export default function LitoAssistDrawer({
  open,
  onClose,
  bizId,
  businessName,
  recommendation,
  onMarkPublished,
  publishing = false,
}: LitoAssistDrawerProps) {
  const t = useT();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<LitoTabKey>('howto');
  const [loadingStored, setLoadingStored] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [pollingCopy, setPollingCopy] = useState(false);
  const [refineLoading, setRefineLoading] = useState<string | null>(null);
  const [customInstruction, setCustomInstruction] = useState('');

  const [steps, setSteps] = useState<string[]>([]);
  const [directorNotes, setDirectorNotes] = useState<string[]>([]);
  const [assets, setAssets] = useState<string[]>([]);
  const [copyShort, setCopyShort] = useState('');
  const [copyLong, setCopyLong] = useState('');
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [shotlist, setShotlist] = useState<string[]>([]);
  const [imageIdea, setImageIdea] = useState('');
  const [quota, setQuota] = useState<QuotaState | null>(null);
  const [aiUnavailable, setAiUnavailable] = useState(false);
  const [aiMessage, setAiMessage] = useState('');
  const [hasGeneratedCopy, setHasGeneratedCopy] = useState(false);

  const [assetsDone, setAssetsDone] = useState<Record<string, boolean>>({});
  const [stepsDone, setStepsDone] = useState<Record<string, boolean>>({});

  const recommendationTemplate = recommendation?.recommendation_template;
  const formatLabel = recommendation?.format || recommendationTemplate?.format || 'post';
  const hookTitle = recommendation?.hook || recommendationTemplate?.hook || t('dashboard.home.recommendations.lito.defaultTitle');
  const ideaText = recommendation?.idea || recommendationTemplate?.idea || '';
  const ctaText = recommendation?.cta || recommendationTemplate?.cta || '';
  const localHowTo = recommendation?.how_to || recommendationTemplate?.how_to;

  const baseAssets = useMemo(() => {
    const source = recommendationTemplate?.assets_needed
      || recommendation?.how_to?.assets_needed
      || [];
    return source.filter((asset): asset is string => typeof asset === 'string' && asset.trim().length > 0);
  }, [recommendation?.how_to?.assets_needed, recommendationTemplate?.assets_needed]);

  const copyCombined = useMemo(() => {
    const tags = hashtags.length ? `\n\n${hashtags.join(' ')}` : '';
    return `${copyLong || copyShort}${tags}`.trim();
  }, [copyLong, copyShort, hashtags]);

  const applyCopy = useCallback((copy: LitoGeneratedCopy) => {
    setCopyShort(copy.caption_short || '');
    setCopyLong(copy.caption_long || '');
    setHashtags(copy.hashtags || []);
    setShotlist(copy.shotlist || []);
    setImageIdea(copy.image_idea || '');
    setSteps(copy.execution_checklist || []);
    setDirectorNotes(copy.director_notes || []);
    setAssets(copy.assets_needed || []);
    setHasGeneratedCopy(true);
  }, []);

  const hydrateFallbackPlan = useCallback(() => {
    const fallbackSteps = localHowTo?.steps?.length
      ? localHowTo.steps
      : [
          `${t('dashboard.home.recommendations.lito.fallbackSteps.step1')} ${hookTitle}`,
          `${t('dashboard.home.recommendations.lito.fallbackSteps.step2')} ${ideaText}`.trim(),
          `${t('dashboard.home.recommendations.lito.fallbackSteps.step3')} ${ctaText}`.trim(),
        ].filter(Boolean);

    const fallbackAssets = localHowTo?.assets_needed?.length
      ? localHowTo.assets_needed
      : baseAssets;

    setSteps(fallbackSteps.slice(0, 9));
    setDirectorNotes([
      t('dashboard.home.recommendations.lito.fallbackDirector.notes1'),
      t('dashboard.home.recommendations.lito.fallbackDirector.notes2'),
      t('dashboard.home.recommendations.lito.fallbackDirector.notes3'),
    ]);
    setAssets(fallbackAssets.slice(0, 12));
    setCopyShort('');
    setCopyLong('');
    setHashtags([]);
    setShotlist([]);
    setImageIdea('');
    setHasGeneratedCopy(false);
  }, [baseAssets, ctaText, hookTitle, ideaText, localHowTo?.assets_needed, localHowTo?.steps, t]);

  const loadStoredCopy = useCallback(async () => {
    if (!bizId || !recommendation?.id) return;
    setLoadingStored(true);
    try {
      const response = await fetch(`/api/lito/copy?biz_id=${bizId}&recommendation_id=${recommendation.id}`);
      const payload = (await response.json().catch(() => ({}))) as CopyApiPayload;
      if (response.status === 503 || payload.error === 'ai_unavailable') {
        setAiUnavailable(true);
        setAiMessage(payload.message || t('dashboard.home.recommendations.lito.aiUnavailable'));
      } else {
        setAiUnavailable(Boolean(payload.ai && payload.ai.available === false));
        setAiMessage(payload.ai?.available === false ? t('dashboard.home.recommendations.lito.aiUnavailable') : '');
      }

      if (payload.quota) setQuota(payload.quota);
      if (payload.copy) {
        applyCopy(payload.copy);
      }
    } catch {
      // Keep fallback state silently; drawer remains usable.
    } finally {
      setLoadingStored(false);
    }
  }, [applyCopy, bizId, recommendation?.id, t]);

  const pollUntilCopyAvailable = useCallback(async (): Promise<boolean> => {
    if (!bizId || !recommendation?.id) return false;
    setPollingCopy(true);
    try {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const response = await fetch(`/api/lito/copy?biz_id=${bizId}&recommendation_id=${recommendation.id}`);
        if (!response.ok) continue;
        const payload = (await response.json().catch(() => ({}))) as CopyApiPayload;
        if (payload.quota) setQuota(payload.quota);
        if (payload.copy) {
          applyCopy(payload.copy);
          return true;
        }
      }
      return false;
    } finally {
      setPollingCopy(false);
    }
  }, [applyCopy, bizId, recommendation?.id]);

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
          format: normalizedFormat(recommendation?.format || recommendationTemplate?.format),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as GeneratePayload;

      if (response.status === 503 || payload.error === 'ai_unavailable') {
        setAiUnavailable(true);
        setAiMessage(payload.message || t('dashboard.home.recommendations.lito.aiUnavailable'));
        toast(payload.message || t('dashboard.home.recommendations.lito.aiUnavailable'), 'error');
        return;
      }
      if (response.status === 409 && (payload.error === 'in_flight' || payload.error === 'retry_later')) {
        toast(t('dashboard.home.recommendations.lito.inFlightToast'), 'warning');
        const resolved = await pollUntilCopyAvailable();
        if (!resolved) {
          toast(t('dashboard.home.recommendations.lito.pollTimeout'), 'error');
        }
        return;
      }
      if (!response.ok || payload.error || !payload.copy) {
        throw new Error(payload.message || t('dashboard.home.recommendations.lito.generateError'));
      }

      applyCopy(payload.copy);
      if (payload.quota) setQuota(payload.quota);
      setAiUnavailable(false);
      setAiMessage('');
      setActiveTab('copy');
    } catch (error) {
      const message = error instanceof Error ? error.message : t('dashboard.home.recommendations.lito.generateError');
      toast(message, 'error');
    } finally {
      setGenerating(false);
    }
  }, [applyCopy, bizId, pollUntilCopyAvailable, recommendation?.format, recommendation?.id, recommendationTemplate?.format, t, toast]);

  const runRefine = useCallback(async (opts: { mode: 'quick' | 'custom'; quickMode?: RefineMode; instruction?: string }) => {
    if (!bizId || !recommendation?.id) return;
    const loadingKey = opts.mode === 'quick' ? opts.quickMode || 'quick' : 'custom';
    setRefineLoading(loadingKey);

    try {
      const response = await fetch('/api/lito/copy/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          biz_id: bizId,
          recommendation_id: recommendation.id,
          mode: opts.mode,
          quick_mode: opts.quickMode,
          instruction: opts.instruction,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as GeneratePayload;

      if (response.status === 503 || payload.error === 'ai_unavailable') {
        setAiUnavailable(true);
        setAiMessage(payload.message || t('dashboard.home.recommendations.lito.aiUnavailable'));
        toast(payload.message || t('dashboard.home.recommendations.lito.aiUnavailable'), 'error');
        return;
      }
      if (response.status === 409 && (payload.error === 'in_flight' || payload.error === 'retry_later')) {
        toast(t('dashboard.home.recommendations.lito.inFlightToast'), 'warning');
        const resolved = await pollUntilCopyAvailable();
        if (!resolved) {
          toast(t('dashboard.home.recommendations.lito.pollTimeout'), 'error');
        }
        return;
      }
      if (!response.ok || payload.error || !payload.copy) {
        throw new Error(payload.message || t('dashboard.home.recommendations.lito.refineError'));
      }

      applyCopy(payload.copy);
      if (payload.quota) setQuota(payload.quota);
      if (opts.mode === 'custom') setCustomInstruction('');
      setAiUnavailable(false);
      setAiMessage('');
    } catch (error) {
      const message = error instanceof Error ? error.message : t('dashboard.home.recommendations.lito.refineError');
      toast(message, 'error');
    } finally {
      setRefineLoading(null);
    }
  }, [applyCopy, bizId, pollUntilCopyAvailable, recommendation?.id, t, toast]);

  useEffect(() => {
    if (!open) return;
    setActiveTab('howto');
    setAssetsDone({});
    setStepsDone({});
    setQuota(null);
    setAiUnavailable(false);
    setAiMessage('');
    setCustomInstruction('');
    hydrateFallbackPlan();
    void loadStoredCopy();
  }, [hydrateFallbackPlan, loadStoredCopy, open]);

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
        aria-label={t('common.close')}
        className="absolute inset-0 bg-black/55 backdrop-blur-[1px]"
        onClick={onClose}
      />

      <aside className="absolute right-0 top-0 h-full w-full max-w-2xl border-l border-white/10 bg-zinc-950/85 shadow-[0_20px_80px_rgba(0,0,0,0.65)] backdrop-blur-2xl">
        <div className="flex h-full flex-col">
          <header className="border-b border-white/10 px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className={cn('text-lg font-semibold', textMain)}>{t('dashboard.home.recommendations.lito.ikeaTitle')}</p>
                <p className={cn('mt-1 text-xs', textSub)}>
                  {businessName || t('common.appName')}
                  {bizId ? ` · ${formatLabel}` : ''}
                </p>
                <p className="mt-2 text-sm text-white/85">{hookTitle}</p>
                {quota?.limit ? (
                  <p className="mt-1 text-xs text-emerald-300/85">
                    {t('dashboard.home.recommendations.lito.quotaBadge', {
                      used: quota.used,
                      limit: quota.limit,
                    })}
                  </p>
                ) : null}
                {aiUnavailable ? (
                  <p className="mt-1 text-xs text-amber-300">{aiMessage || t('dashboard.home.recommendations.lito.aiUnavailable')}</p>
                ) : null}
              </div>
              <Button variant="ghost" size="sm" onClick={onClose}>
                {t('common.close')}
              </Button>
            </div>
          </header>

          <div className="border-b border-white/10 px-5 py-3">
            <Tabs
              value={activeTab}
              onChange={(tab) => setActiveTab(tab as LitoTabKey)}
              items={[
                { key: 'howto', label: t('dashboard.home.recommendations.lito.tabs.howTo') },
                { key: 'copy', label: t('dashboard.home.recommendations.lito.tabs.copy') },
                { key: 'assets', label: t('dashboard.home.recommendations.lito.tabs.assets') },
              ]}
            />
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {loadingStored ? (
              <div className="space-y-3">
                <p className={cn('text-sm', textSub)}>{t('common.loading')}</p>
                <div className="h-16 animate-pulse rounded-xl border border-white/10 bg-white/6" />
              </div>
            ) : null}

            {!loadingStored && activeTab === 'howto' ? (
              <div className="space-y-3">
                <section className="rounded-xl border border-white/10 bg-white/6 p-3">
                  <p className={cn('text-sm font-semibold', textMain)}>{t('dashboard.home.recommendations.lito.objective')}</p>
                  <p className={cn('mt-1 text-sm text-white/85')}>{ideaText || ctaText || hookTitle}</p>
                </section>
                <section className="rounded-xl border border-white/10 bg-white/6 p-3">
                  <p className={cn('text-sm font-semibold', textMain)}>{t('dashboard.home.recommendations.lito.stepsTitle')}</p>
                  <ul className="mt-2 space-y-2">
                    {steps.map((step, index) => {
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
                </section>
                <section className="rounded-xl border border-white/10 bg-white/6 p-3">
                  <p className={cn('text-sm font-semibold', textMain)}>{t('dashboard.home.recommendations.lito.directorNotes')}</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-white/78">
                    {directorNotes.map((note, index) => (
                      <li key={`note-${index}`}>{note}</li>
                    ))}
                  </ul>
                </section>
              </div>
            ) : null}

            {!loadingStored && activeTab === 'copy' ? (
              <div className="space-y-3">
                <section className="rounded-xl border border-white/10 bg-white/6 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className={cn('text-sm font-semibold', textMain)}>{t('dashboard.home.recommendations.lito.copyShort')}</p>
                    <Button
                      size="sm"
                      className="h-8 px-3 text-xs"
                      loading={generating}
                      disabled={generating || pollingCopy || aiUnavailable}
                      onClick={() => void runGenerate()}
                    >
                      {t('dashboard.home.recommendations.actions.generateLito')}
                    </Button>
                  </div>
                  {!hasGeneratedCopy ? (
                    <p className="mt-2 text-xs text-white/70">{t('dashboard.home.recommendations.lito.generatingHint')}</p>
                  ) : null}
                  <textarea
                    value={copyShort}
                    onChange={(event) => setCopyShort(event.target.value)}
                    rows={3}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 p-3 text-sm text-white outline-none transition-all duration-200 ease-premium focus:border-emerald-300/35 focus:ring-2 focus:ring-emerald-400/20"
                  />
                </section>

                <section className="rounded-xl border border-white/10 bg-white/6 p-3">
                  <p className={cn('text-sm font-semibold', textMain)}>{t('dashboard.home.recommendations.lito.copyLong')}</p>
                  <textarea
                    value={copyLong}
                    onChange={(event) => setCopyLong(event.target.value)}
                    rows={6}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 p-3 text-sm text-white outline-none transition-all duration-200 ease-premium focus:border-emerald-300/35 focus:ring-2 focus:ring-emerald-400/20"
                  />
                </section>

                <section className="rounded-xl border border-white/10 bg-white/6 p-3">
                  <p className={cn('text-sm font-semibold', textMain)}>{t('dashboard.home.recommendations.lito.hashtags')}</p>
                  <input
                    value={hashtags.join(' ')}
                    onChange={(event) => {
                      const values = event.target.value
                        .split(/\s+/)
                        .map((value) => value.trim())
                        .filter(Boolean)
                        .slice(0, 12);
                      setHashtags(values);
                    }}
                    className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-black/25 px-3 text-sm text-white outline-none transition-all duration-200 ease-premium focus:border-emerald-300/35 focus:ring-2 focus:ring-emerald-400/20"
                  />
                </section>

                {shotlist.length > 0 ? (
                  <section className="rounded-xl border border-white/10 bg-white/6 p-3">
                    <p className={cn('text-sm font-semibold', textMain)}>{t('dashboard.home.recommendations.lito.shotlist')}</p>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-white/78">
                      {shotlist.map((item, index) => (
                        <li key={`shot-${index}`}>{item}</li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {imageIdea ? (
                  <section className="rounded-xl border border-white/10 bg-white/6 p-3">
                    <p className={cn('text-sm font-semibold', textMain)}>{t('dashboard.home.recommendations.lito.imageIdea')}</p>
                    <p className="mt-2 text-sm text-white/82">{imageIdea}</p>
                  </section>
                ) : null}

                <section className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={async () => {
                      if (!copyCombined) return;
                      try {
                        await navigator.clipboard.writeText(copyCombined);
                        toast(t('dashboard.home.recommendations.lito.copySuccess'), 'success');
                      } catch {
                        toast(t('dashboard.home.recommendations.lito.copyError'), 'error');
                      }
                    }}
                  >
                    {t('dashboard.home.recommendations.lito.actions.copy')}
                  </Button>
                  <Button size="sm" variant="ghost" loading={refineLoading === 'shorter'} onClick={() => void runRefine({ mode: 'quick', quickMode: 'shorter' })} disabled={pollingCopy || aiUnavailable}>
                    {t('dashboard.home.recommendations.lito.refine.shorter')}
                  </Button>
                  <Button size="sm" variant="ghost" loading={refineLoading === 'premium'} onClick={() => void runRefine({ mode: 'quick', quickMode: 'premium' })} disabled={pollingCopy || aiUnavailable}>
                    {t('dashboard.home.recommendations.lito.refine.premium')}
                  </Button>
                  <Button size="sm" variant="ghost" loading={refineLoading === 'funny'} onClick={() => void runRefine({ mode: 'quick', quickMode: 'funny' })} disabled={pollingCopy || aiUnavailable}>
                    {t('dashboard.home.recommendations.lito.refine.funny')}
                  </Button>
                  <Button size="sm" variant="ghost" loading={refineLoading === 'formal'} onClick={() => void runRefine({ mode: 'quick', quickMode: 'formal' })} disabled={pollingCopy || aiUnavailable}>
                    {t('dashboard.home.recommendations.lito.refine.formal')}
                  </Button>
                  <Button size="sm" variant="ghost" loading={refineLoading === 'translate_ca'} onClick={() => void runRefine({ mode: 'quick', quickMode: 'translate_ca' })} disabled={pollingCopy || aiUnavailable}>
                    {t('dashboard.home.recommendations.lito.refine.translateCa')}
                  </Button>
                  <Button size="sm" variant="ghost" loading={refineLoading === 'translate_es'} onClick={() => void runRefine({ mode: 'quick', quickMode: 'translate_es' })} disabled={pollingCopy || aiUnavailable}>
                    {t('dashboard.home.recommendations.lito.refine.translateEs')}
                  </Button>
                  <Button size="sm" variant="ghost" loading={refineLoading === 'translate_en'} onClick={() => void runRefine({ mode: 'quick', quickMode: 'translate_en' })} disabled={pollingCopy || aiUnavailable}>
                    {t('dashboard.home.recommendations.lito.refine.translateEn')}
                  </Button>
                </section>

                <section className="rounded-xl border border-white/10 bg-white/6 p-3">
                  <p className={cn('text-sm font-semibold', textMain)}>{t('dashboard.home.recommendations.lito.customRefineTitle')}</p>
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
                      disabled={pollingCopy || aiUnavailable || customInstruction.trim().length < 2}
                      onClick={() => void runRefine({ mode: 'custom', instruction: customInstruction.trim() })}
                    >
                      {t('dashboard.home.recommendations.lito.actions.refineCustom')}
                    </Button>
                  </div>
                </section>
              </div>
            ) : null}

            {!loadingStored && activeTab === 'assets' ? (
              <div className="space-y-2 rounded-xl border border-white/10 bg-white/6 p-3">
                {assets.length > 0 ? (
                  assets.map((asset, index) => {
                    const key = `${index}-${asset}`;
                    const checked = Boolean(assetsDone[key]);
                    return (
                      <label key={key} className="flex items-center gap-2 text-sm text-white/85">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => setAssetsDone((previous) => ({ ...previous, [key]: !checked }))}
                          className="h-4 w-4 rounded border-white/25 bg-transparent accent-emerald-400"
                        />
                        <span className={checked ? 'text-white/55 line-through' : ''}>{asset}</span>
                      </label>
                    );
                  })
                ) : (
                  <p className="text-sm text-white/70">{t('dashboard.home.recommendations.lito.noAssets')}</p>
                )}
              </div>
            ) : null}
          </div>

          <footer className="border-t border-white/10 px-5 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className={cn('text-xs', textSub)}>
                {t('dashboard.home.recommendations.lito.footerHint')}
              </p>
              <Button
                size="sm"
                loading={publishing}
                onClick={() => {
                  if (!recommendation?.id || !onMarkPublished) return;
                  void onMarkPublished(recommendation.id);
                }}
                disabled={!recommendation?.id || !onMarkPublished}
              >
                {t('dashboard.home.recommendations.lito.actions.markPublished')}
              </Button>
            </div>
          </footer>
        </div>
      </aside>
    </div>
  );
}
