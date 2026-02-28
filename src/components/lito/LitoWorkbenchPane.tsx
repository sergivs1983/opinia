'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Button from '@/components/ui/Button';
import Tabs from '@/components/ui/Tabs';
import { useToast } from '@/components/ui/Toast';
import { textMain, textSub } from '@/components/ui/glass';
import { cn } from '@/lib/utils';
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
  reason?: LitoCopyStatusReason;
  message?: string;
};

type LitoWorkbenchPaneProps = {
  t: (key: string, vars?: Record<string, string | number>) => string;
  bizId: string | null;
  recommendation: LitoRecommendationItem | null;
  viewerRole: LitoViewerRole;
  selectedFormat: FormatKey;
  onQuotaChange: (quota: LitoQuotaState | null) => void;
  onPublished: (recommendationId: string) => Promise<void>;
};

const IKEA_BY_FORMAT: Record<FormatKey, string[]> = {
  post: [
    'Tria foto o carrusel amb un únic missatge central.',
    'Ajusta llum i color perquè el producte quedi net.',
    'Afegeix ubicació i context local en la primera línia.',
    'Inclou prova real (equip, client, detall de producte).',
    "Tanca amb CTA clar: reserva, visita o opinió.",
  ],
  story: [
    'Obre amb text gran i clar en els primers 2 segons.',
    'Mostra una prova visual curta (producte, ambient o equip).',
    'Afegeix sticker (pregunta o enquesta) per activar resposta.',
    'Inclou link o instrucció concreta (DM, reserva, web).',
    'Publica i revisa respostes durant la primera hora.',
  ],
  reel: [
    'Ganxo visual als 0-3s amb el millor detall.',
    'Munta 3-5 clips curts amb ritme consistent.',
    'Text inicial gran amb proposta de valor.',
    'Mostra procés o abans/després en 1-2 escenes.',
    'Caption curt + hashtags rellevants del negoci.',
    'Tanca amb CTA i resposta ràpida als comentaris.',
  ],
};

const DIRECTOR_NOTES_BY_FORMAT: Record<FormatKey, string[]> = {
  post: [
    'Llum natural lateral o frontal suau.',
    'Enquadrament net, evita fons saturat.',
    'Mantingues coherència de color amb la marca.',
  ],
  story: [
    'Text molt llegible, alt contrast.',
    'Clip curt (3-5s) amb un sol missatge.',
    'Usa sticker només si reforça la CTA.',
  ],
  reel: [
    'Primer pla fort al segon 1.',
    'Canvi de pla cada 1-2 segons.',
    'Audio net i subtítols curts.',
  ],
};

function normalizedFormat(value: string | undefined): FormatKey {
  if (value === 'story' || value === 'reel') return value;
  return 'post';
}

export default function LitoWorkbenchPane({
  t,
  bizId,
  recommendation,
  viewerRole,
  selectedFormat,
  onQuotaChange,
  onPublished,
}: LitoWorkbenchPaneProps) {
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<LitoTabKey>('copy_short');
  const [loadingStored, setLoadingStored] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [pollingCopy, setPollingCopy] = useState(false);
  const [publishing, setPublishing] = useState(false);
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
  const [quota, setQuota] = useState<LitoQuotaState | null>(null);

  const [aiUnavailable, setAiUnavailable] = useState(false);
  const [aiStatusReason, setAiStatusReason] = useState<LitoCopyStatusReason>('ok');
  const [aiMessage, setAiMessage] = useState('');
  const [hasGeneratedCopy, setHasGeneratedCopy] = useState(false);
  const [stepsDone, setStepsDone] = useState<Record<string, boolean>>({});

  const recommendationTemplate = recommendation?.recommendation_template;
  const fallbackFormat = normalizedFormat(recommendation?.format || recommendationTemplate?.format);
  const effectiveFormat = recommendation ? fallbackFormat : selectedFormat;
  const hookTitle = recommendation?.hook || recommendationTemplate?.hook || t('dashboard.home.recommendations.lito.defaultTitle');
  const ideaText = recommendation?.idea || recommendationTemplate?.idea || '';
  const ctaText = recommendation?.cta || recommendationTemplate?.cta || '';
  const localHowTo = recommendation?.how_to || recommendationTemplate?.how_to;
  const canMarkPublished = viewerRole !== 'staff';
  const settingsHref = '/dashboard/admin';

  const aiReasonMessage = useCallback((reason?: LitoCopyStatusReason, fallback?: string) => {
    if (reason === 'missing_api_key') return t('dashboard.home.recommendations.lito.copyDisabledMissingKey');
    if (reason === 'disabled' || reason === 'paused') return t('dashboard.home.recommendations.lito.copyDisabledManager');
    return fallback || t('dashboard.home.recommendations.lito.aiUnavailable');
  }, [t]);

  const applyCopy = useCallback((copy: LitoGeneratedCopy) => {
    setCopyShort(copy.caption_short || '');
    setCopyLong(copy.caption_long || '');
    setHashtags(copy.hashtags || []);
    setShotlist(copy.shotlist || []);
    setImageIdea(copy.image_idea || '');
    setSteps(copy.execution_checklist || IKEA_BY_FORMAT[normalizedFormat(copy.format)]);
    setDirectorNotes(copy.director_notes || DIRECTOR_NOTES_BY_FORMAT[normalizedFormat(copy.format)]);
    setAssets(copy.assets_needed || []);
    setHasGeneratedCopy(true);
  }, []);

  const hydrateFallbackPlan = useCallback(() => {
    const fallbackSteps = localHowTo?.steps?.length
      ? localHowTo.steps
      : IKEA_BY_FORMAT[effectiveFormat];
    const fallbackAssets = localHowTo?.assets_needed?.length
      ? localHowTo.assets_needed
      : recommendationTemplate?.assets_needed || [];

    setSteps(fallbackSteps.slice(0, 9));
    setDirectorNotes(DIRECTOR_NOTES_BY_FORMAT[effectiveFormat]);
    setAssets(fallbackAssets.slice(0, 10));
    setCopyShort('');
    setCopyLong('');
    setHashtags([]);
    setShotlist([]);
    setImageIdea('');
    setHasGeneratedCopy(false);
  }, [effectiveFormat, localHowTo?.assets_needed, localHowTo?.steps, recommendationTemplate?.assets_needed]);

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

      if (response.status === 402 || payload.error === 'quota_exceeded') {
        toast(payload.message || t('dashboard.litoPage.messages.quotaExceeded'), 'warning');
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
  }, [aiReasonMessage, applyCopy, bizId, effectiveFormat, onQuotaChange, pollUntilCopyAvailable, recommendation?.id, t, toast]);

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

      if (response.status === 402 || payload.error === 'quota_exceeded') {
        toast(payload.message || t('dashboard.litoPage.messages.quotaExceeded'), 'warning');
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
  }, [aiReasonMessage, applyCopy, bizId, onQuotaChange, pollUntilCopyAvailable, recommendation?.id, t, toast]);

  const handleCopyText = useCallback(async (value: string) => {
    if (!value.trim()) return;
    try {
      await navigator.clipboard.writeText(value);
      toast(t('dashboard.home.recommendations.lito.copySuccess'), 'success');
    } catch {
      toast(t('dashboard.home.recommendations.lito.copyError'), 'error');
    }
  }, [t, toast]);

  useEffect(() => {
    setStepsDone({});
    setActiveTab('copy_short');
    setQuota(null);
    setAiUnavailable(false);
    setAiStatusReason('ok');
    setAiMessage('');
    setCustomInstruction('');
    hydrateFallbackPlan();
    void loadCopyStatus();
    void loadStoredCopy();
  }, [hydrateFallbackPlan, loadCopyStatus, loadStoredCopy, recommendation?.id]);

  const tabValue = useMemo(() => {
    if (activeTab === 'copy_long') return copyLong;
    if (activeTab === 'hashtags') return hashtags.join(' ');
    if (activeTab === 'shotlist') return shotlist.join('\n');
    if (activeTab === 'image_idea') return imageIdea;
    return copyShort;
  }, [activeTab, copyLong, copyShort, hashtags, imageIdea, shotlist]);

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
            {t('dashboard.litoPage.workbench.selectRecommendation')}
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
                    <Button size="sm" variant="secondary" onClick={() => void handleCopyText(tabValue)}>
                      {t('dashboard.home.recommendations.lito.actions.copy')}
                    </Button>
                  </div>
                </>
              )}
            </div>

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
              <p className={cn('text-sm font-semibold', textMain)}>{t('dashboard.litoPage.workbench.ikeaTitle')}</p>
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
              <p className={cn('mt-3 text-xs font-medium text-white/65')}>{t('dashboard.home.recommendations.lito.directorNotes')}</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-white/75">
                {directorNotes.map((note, index) => (
                  <li key={`note-${index}`}>{note}</li>
                ))}
              </ul>
              {assets.length > 0 ? (
                <>
                  <p className={cn('mt-3 text-xs font-medium text-white/65')}>{t('dashboard.home.recommendations.lito.tabs.assets')}</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-white/75">
                    {assets.map((asset, index) => (
                      <li key={`asset-${index}`}>{asset}</li>
                    ))}
                  </ul>
                </>
              ) : null}
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
          <Button
            size="sm"
            loading={publishing}
            disabled={!recommendation?.id || !canMarkPublished}
            title={!canMarkPublished ? t('dashboard.litoPage.messages.managerRequired') : undefined}
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
        </div>
      </footer>
    </section>
  );
}
