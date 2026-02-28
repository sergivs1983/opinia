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

type GeneratePayload = {
  ok?: boolean;
  steps?: string[];
  director_notes?: string[];
  copy_short?: string;
  copy_long?: string;
  hashtags?: string[];
  assets_needed?: string[];
  remaining?: number;
  error?: string;
  message?: string;
};

type RefineMode = 'shorter' | 'funny' | 'formal' | 'translate_es' | 'translate_en';
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
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [refineLoading, setRefineLoading] = useState<RefineMode | null>(null);
  const [steps, setSteps] = useState<string[]>([]);
  const [directorNotes, setDirectorNotes] = useState<string[]>([]);
  const [assets, setAssets] = useState<string[]>([]);
  const [copyShort, setCopyShort] = useState('');
  const [copyLong, setCopyLong] = useState('');
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [remaining, setRemaining] = useState<number | null>(null);
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
    setCopyShort(`${hookTitle}. ${ctaText}`.trim());
    setCopyLong([hookTitle, '', ideaText, '', ctaText].filter(Boolean).join('\n'));
    setHashtags(['#OpinIA', '#NegociLocal']);
    setRemaining(null);
  }, [baseAssets, ctaText, hookTitle, ideaText, localHowTo?.assets_needed, localHowTo?.steps, t]);

  const runGenerate = useCallback(async () => {
    if (!bizId || !recommendation?.id) return;
    setLoadingPlan(true);
    try {
      const response = await fetch('/api/lito/copy/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          biz_id: bizId,
          recommendation_id: recommendation.id,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as GeneratePayload;
      if (!response.ok || payload.error) {
        throw new Error(payload.message || t('dashboard.home.recommendations.lito.generateError'));
      }
      setSteps((payload.steps || []).slice(0, 12));
      setDirectorNotes((payload.director_notes || []).slice(0, 12));
      setAssets((payload.assets_needed || []).slice(0, 12));
      setCopyShort(payload.copy_short || '');
      setCopyLong(payload.copy_long || '');
      setHashtags((payload.hashtags || []).slice(0, 12));
      setRemaining(typeof payload.remaining === 'number' ? payload.remaining : null);
    } catch (error) {
      hydrateFallbackPlan();
      const message = error instanceof Error ? error.message : t('dashboard.home.recommendations.lito.generateError');
      toast(message, 'error');
    } finally {
      setLoadingPlan(false);
    }
  }, [bizId, hydrateFallbackPlan, recommendation?.id, t, toast]);

  const runRefine = useCallback(async (mode: RefineMode) => {
    if (!bizId || !recommendation?.id) return;
    setRefineLoading(mode);
    try {
      const response = await fetch('/api/lito/copy/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          biz_id: bizId,
          recommendation_id: recommendation.id,
          mode,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as GeneratePayload;
      if (!response.ok || payload.error) {
        throw new Error(payload.message || t('dashboard.home.recommendations.lito.refineError'));
      }
      setCopyShort(payload.copy_short || '');
      setCopyLong(payload.copy_long || '');
      setHashtags((payload.hashtags || []).slice(0, 12));
      setRemaining(typeof payload.remaining === 'number' ? payload.remaining : null);
    } catch (error) {
      const message = error instanceof Error ? error.message : t('dashboard.home.recommendations.lito.refineError');
      toast(message, 'error');
    } finally {
      setRefineLoading(null);
    }
  }, [bizId, recommendation?.id, t, toast]);

  useEffect(() => {
    if (!open) return;
    setActiveTab('howto');
    setAssetsDone({});
    setStepsDone({});
    hydrateFallbackPlan();
    void runGenerate();
  }, [hydrateFallbackPlan, open, runGenerate]);

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
                {remaining !== null ? (
                  <p className="mt-1 text-xs text-emerald-300/85">
                    {t('dashboard.home.recommendations.lito.remainingQuota', { count: remaining })}
                  </p>
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
            {loadingPlan ? (
              <div className="space-y-3">
                <p className={cn('text-sm', textSub)}>{t('dashboard.home.recommendations.lito.generating')}</p>
                <div className="h-16 animate-pulse rounded-xl border border-white/10 bg-white/6" />
                <div className="h-16 animate-pulse rounded-xl border border-white/10 bg-white/6" />
              </div>
            ) : null}

            {!loadingPlan && activeTab === 'howto' ? (
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

            {!loadingPlan && activeTab === 'copy' ? (
              <div className="space-y-3">
                <section className="rounded-xl border border-white/10 bg-white/6 p-3">
                  <p className={cn('text-sm font-semibold', textMain)}>{t('dashboard.home.recommendations.lito.copyShort')}</p>
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
                  <Button size="sm" variant="ghost" loading={refineLoading === 'shorter'} onClick={() => void runRefine('shorter')}>
                    {t('dashboard.home.recommendations.lito.refine.shorter')}
                  </Button>
                  <Button size="sm" variant="ghost" loading={refineLoading === 'funny'} onClick={() => void runRefine('funny')}>
                    {t('dashboard.home.recommendations.lito.refine.funny')}
                  </Button>
                  <Button size="sm" variant="ghost" loading={refineLoading === 'formal'} onClick={() => void runRefine('formal')}>
                    {t('dashboard.home.recommendations.lito.refine.formal')}
                  </Button>
                  <Button size="sm" variant="ghost" loading={refineLoading === 'translate_es'} onClick={() => void runRefine('translate_es')}>
                    {t('dashboard.home.recommendations.lito.refine.translateEs')}
                  </Button>
                  <Button size="sm" variant="ghost" loading={refineLoading === 'translate_en'} onClick={() => void runRefine('translate_en')}>
                    {t('dashboard.home.recommendations.lito.refine.translateEn')}
                  </Button>
                </section>
              </div>
            ) : null}

            {!loadingPlan && activeTab === 'assets' ? (
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
