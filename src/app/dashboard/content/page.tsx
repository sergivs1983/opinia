'use client';

export const dynamic = 'force-dynamic';


import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import GlassCard from '@/components/ui/GlassCard';
import { useT } from '@/components/i18n/I18nContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useSupabase } from '@/hooks/useSupabase';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';
import { defaultScheduledAtTomorrow, getCurrentWeekStartMonday, getWeekStartMondayFromDate, normalizeWeekStartMonday, plannerChannelFromAssetFormat } from '@/lib/planner';
import type { ContentSuggestion, Review } from '@/types/database';
import { textMain, textMuted, textSub } from '@/components/ui/glass';
import ContentQuickCreateModal from '@/components/content/ContentQuickCreateModal';
import { roleCanPublish } from '@/lib/roles';

type ContentLanguage = 'ca' | 'es' | 'en';
type AssetFormat = 'story' | 'feed';
type AssetStatus = 'created' | 'failed';
type TemplateId = 'quote-clean' | 'feature-split' | 'top3-reasons' | 'behind-scenes';

type AssetItem = {
  id: string;
  suggestion_id: string | null;
  created_at: string;
  format: AssetFormat;
  template_id: string;
  language: ContentLanguage;
  status: AssetStatus;
};

type SuggestionEvidence = Array<{ review_id?: string; quote?: string }>;

type SuggestionMeta = Pick<ContentSuggestion, 'id' | 'evidence'>;
type ReviewMeta = Pick<Review, 'id' | 'author_name' | 'rating' | 'source'>;

type AssetReviewMeta = {
  authorName: string;
  rating: number;
  source: string;
};

type ListAssetsResponse = {
  items?: AssetItem[];
  error?: string;
  message?: string;
  request_id?: string;
};

type SignedUrlResponse = {
  signedUrl?: string;
  error?: string;
  message?: string;
  request_id?: string;
};

type RenderVariantResponse = {
  assetId?: string;
  signedUrl?: string;
  format?: AssetFormat;
  templateId?: TemplateId;
  error?: string;
  message?: string;
  request_id?: string;
};

type PlannerMutateResponse = {
  item?: { id: string };
  error?: string;
  message?: string;
  request_id?: string;
};

type PlannerWebhookResponse = {
  status?: 'sent' | 'failed';
  error?: string;
  message?: string;
  request_id?: string;
};

const TEMPLATE_ORDER: TemplateId[] = ['quote-clean', 'feature-split', 'top3-reasons', 'behind-scenes'];

function formatStars(rating: number): string {
  return '★'.repeat(Math.max(0, Math.min(5, Math.round(rating))));
}

function extractEvidenceReviewId(evidence: unknown): string | null {
  if (!Array.isArray(evidence)) return null;
  const row = (evidence as SuggestionEvidence).find((item) => typeof item?.review_id === 'string');
  return row?.review_id || null;
}

function nextTemplate(current: string): TemplateId {
  const index = TEMPLATE_ORDER.findIndex((template) => template === current);
  if (index === -1) return 'quote-clean';
  return TEMPLATE_ORDER[(index + 1) % TEMPLATE_ORDER.length];
}

export default function ContentPage() {
  const t = useT();
  const { biz, membership } = useWorkspace();
  const router = useRouter();
  const supabase = useSupabase();
  const { toast } = useToast();
  const canPublishContent = roleCanPublish(membership?.role);

  const initialLanguage = useMemo<ContentLanguage>(() => {
    const value = biz?.default_language;
    if (value === 'es' || value === 'en') return value;
    return 'ca';
  }, [biz?.default_language]);

  const [weekStart, setWeekStart] = useState<string>(getCurrentWeekStartMonday);
  const [language, setLanguage] = useState<ContentLanguage>(initialLanguage);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [previewByAssetId, setPreviewByAssetId] = useState<Record<string, string>>({});
  const [metaByAssetId, setMetaByAssetId] = useState<Record<string, AssetReviewMeta>>({});
  const [variantLoadingId, setVariantLoadingId] = useState<string | null>(null);
  const [downloadLoadingId, setDownloadLoadingId] = useState<string | null>(null);
  const [publishLoadingId, setPublishLoadingId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const openEditorForAsset = useCallback((asset: { id: string; suggestionId?: string | null }) => {
    const params = new URLSearchParams();
    params.set('from', 'content');
    params.set('assetId', asset.id);
    params.set('edit', '1');
    if (asset.suggestionId) params.set('suggestionId', asset.suggestionId);
    router.push(`/dashboard/studio?${params.toString()}`);
  }, [router]);

  useEffect(() => {
    setLanguage(initialLanguage);
  }, [initialLanguage]);

  const fetchSignedUrl = useCallback(async (assetId: string): Promise<string | null> => {
    if (!biz) return null;
    if (previewByAssetId[assetId]) return previewByAssetId[assetId];

    const response = await fetch(`/api/content-studio/assets/${assetId}/signed-url`, {
      headers: { 'x-biz-id': biz.id },
    });
    const payload = (await response.json().catch(() => ({}))) as SignedUrlResponse;
    if (!response.ok || payload.error || !payload.signedUrl) {
      throw new Error(payload.message || t('dashboard.contentGallery.errorSignedUrl'));
    }

    setPreviewByAssetId((previous) => ({ ...previous, [assetId]: payload.signedUrl! }));
    return payload.signedUrl;
  }, [biz, previewByAssetId, t]);

  const hydrateAssetMeta = useCallback(async (rows: AssetItem[]) => {
    const suggestionIds = [...new Set(rows.map((row) => row.suggestion_id).filter((value): value is string => !!value))];
    if (suggestionIds.length === 0) {
      setMetaByAssetId({});
      return;
    }

    const { data: suggestionData, error: suggestionError } = await supabase
      .from('content_suggestions')
      .select('id, evidence')
      .in('id', suggestionIds);

    if (suggestionError || !Array.isArray(suggestionData)) {
      setMetaByAssetId({});
      return;
    }

    const suggestions = suggestionData as SuggestionMeta[];
    const reviewIds = [...new Set(suggestions.map((suggestion) => extractEvidenceReviewId(suggestion.evidence)).filter((value): value is string => !!value))];

    if (reviewIds.length === 0) {
      setMetaByAssetId({});
      return;
    }

    const { data: reviewData, error: reviewError } = await supabase
      .from('reviews')
      .select('id, author_name, rating, source')
      .in('id', reviewIds);

    if (reviewError || !Array.isArray(reviewData)) {
      setMetaByAssetId({});
      return;
    }

    const reviewMap = new Map<string, ReviewMeta>(
      (reviewData as ReviewMeta[]).map((review) => [review.id, review]),
    );

    const suggestionReviewMap = new Map<string, ReviewMeta>();
    for (const suggestion of suggestions) {
      const reviewId = extractEvidenceReviewId(suggestion.evidence);
      if (!reviewId) continue;
      const review = reviewMap.get(reviewId);
      if (review) suggestionReviewMap.set(suggestion.id, review);
    }

    const nextMeta: Record<string, AssetReviewMeta> = {};
    for (const row of rows) {
      if (!row.suggestion_id) continue;
      const review = suggestionReviewMap.get(row.suggestion_id);
      if (!review) continue;
      nextMeta[row.id] = {
        authorName: review.author_name || t('dashboard.contentGallery.meta.anonymous'),
        rating: review.rating,
        source: review.source,
      };
    }

    setMetaByAssetId(nextMeta);
  }, [supabase, t]);

  const loadAssets = useCallback(async () => {
    if (!biz) return;
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set('weekStart', normalizeWeekStartMonday(weekStart));
      params.set('limit', '48');
      params.set('language', language);
      const response = await fetch(`/api/content-studio/assets?${params.toString()}`, {
        headers: { 'x-biz-id': biz.id },
      });
      const payload = (await response.json().catch(() => ({}))) as ListAssetsResponse;
      if (!response.ok || payload.error || !Array.isArray(payload.items)) {
        throw new Error(payload.message || t('dashboard.contentGallery.errorLoadAssets'));
      }

      setAssets(payload.items);
      setLoading(false);

      void hydrateAssetMeta(payload.items);
      void Promise.all(payload.items.slice(0, 16).map(async (item) => {
        try {
          await fetchSignedUrl(item.id);
        } catch {
          // silent prefetch failure
        }
      }));
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : t('dashboard.contentGallery.errorLoadAssets'));
      setAssets([]);
      setLoading(false);
    }
  }, [biz, fetchSignedUrl, hydrateAssetMeta, language, t, weekStart]);

  useEffect(() => {
    if (!biz) return;
    void loadAssets();
  }, [biz, loadAssets]);

  async function handleDownload(asset: AssetItem) {
    setDownloadLoadingId(asset.id);
    try {
      const signedUrl = await fetchSignedUrl(asset.id);
      if (!signedUrl) {
        setDownloadLoadingId(null);
        return;
      }
      const anchor = document.createElement('a');
      anchor.href = signedUrl;
      anchor.download = `opinia-${asset.format}-${asset.id}.png`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      setDownloadLoadingId(null);
    } catch (downloadError: unknown) {
      setError(downloadError instanceof Error ? downloadError.message : t('dashboard.contentGallery.errorDownload'));
      setDownloadLoadingId(null);
    }
  }

  async function handleVariant(asset: AssetItem) {
    if (!biz) return;
    setVariantLoadingId(asset.id);
    setError(null);

    try {
      const response = await fetch('/api/content-studio/render', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-biz-id': biz.id,
        },
        body: JSON.stringify({
          sourceAssetId: asset.id,
          format: asset.format,
          templateId: nextTemplate(asset.template_id),
          language: asset.language,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as RenderVariantResponse;
      if (!response.ok || payload.error || !payload.assetId) {
        throw new Error(payload.message || t('dashboard.contentGallery.errorVariant'));
      }

      await loadAssets();
      toast(t('dashboard.contentGallery.variantSuccess'), 'success');
      setVariantLoadingId(null);
    } catch (variantError: unknown) {
      setError(variantError instanceof Error ? variantError.message : t('dashboard.contentGallery.errorVariant'));
      setVariantLoadingId(null);
    }
  }

  async function publishAsset(asset: { id: string; format: AssetFormat; templateId?: string }) {
    if (!biz) return;
    setPublishLoadingId(asset.id);
    setError(null);

    try {
      const scheduledAt = defaultScheduledAtTomorrow();
      const plannerWeekStart = getWeekStartMondayFromDate(new Date(scheduledAt));
      const createResponse = await fetch('/api/planner', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-biz-id': biz.id,
        },
        body: JSON.stringify({
          businessId: biz.id,
          weekStart: plannerWeekStart,
          scheduledAt,
          channel: plannerChannelFromAssetFormat(asset.format),
          itemType: 'asset',
          assetId: asset.id,
          title: `Asset: ${asset.templateId || 'quote-clean'}`,
        }),
      });

      const createPayload = (await createResponse.json().catch(() => ({}))) as PlannerMutateResponse;
      if (!createResponse.ok || createPayload.error || !createPayload.item?.id) {
        throw new Error(createPayload.message || t('dashboard.contentGallery.errorPublish'));
      }

      const sendResponse = await fetch(`/api/planner/${createPayload.item.id}/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-biz-id': biz.id,
        },
        body: JSON.stringify({ event: 'planner.ready' }),
      });

      const sendPayload = (await sendResponse.json().catch(() => ({}))) as PlannerWebhookResponse;
      if (!sendResponse.ok || sendPayload.error) {
        throw new Error(sendPayload.message || t('dashboard.contentGallery.errorPublish'));
      }

      toast(t('dashboard.contentGallery.publishSuccess'), 'success');
      setPublishLoadingId(null);
    } catch (publishError: unknown) {
      setError(publishError instanceof Error ? publishError.message : t('dashboard.contentGallery.errorPublish'));
      setPublishLoadingId(null);
      throw publishError;
    }
  }

  if (!biz) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-white/60">
        <p>{t('common.loading')}</p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-5 p-4 md:p-6" data-testid="content-page">
        <GlassCard variant="strong" className="space-y-4 p-5 md:p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className={cn('font-display text-2xl font-semibold', textMain)}>
                {t('dashboard.contentGallery.title')}
              </h1>
              <p className={cn('mt-1 text-sm md:text-base', textSub)}>
                {t('dashboard.contentGallery.subtitle')}
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-sm text-white/72">
                {t('dashboard.contentGallery.weekLabel')}
                <input
                  type="date"
                  value={weekStart}
                  onChange={(event) => setWeekStart(normalizeWeekStartMonday(event.target.value))}
                  className="glass-input mt-1 block w-44 px-3 py-2 text-sm"
                  data-testid="content-week-picker"
                />
              </label>

              <label className="text-sm text-white/72">
                {t('dashboard.contentGallery.languageLabel')}
                <select
                  value={language}
                  onChange={(event) => setLanguage(event.target.value as ContentLanguage)}
                  className="glass-input mt-1 block w-36 px-3 py-2 text-sm"
                  data-testid="content-language-picker"
                >
                  <option value="ca">{t('dashboard.contentGallery.languageCa')}</option>
                  <option value="es">{t('dashboard.contentGallery.languageEs')}</option>
                  <option value="en">{t('dashboard.contentGallery.languageEn')}</option>
                </select>
              </label>

              <Button
                onClick={() => setModalOpen(true)}
                data-testid="content-generate-btn"
                className="self-end"
              >
                {t('dashboard.contentGallery.createButton')}
              </Button>
            </div>
          </div>
        </GlassCard>

        {error && (
          <div className="rounded-xl border border-rose-300/35 bg-rose-500/12 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        )}

        {loading && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <GlassCard key={`content-skeleton-${index}`} variant="glass" className="h-[360px] animate-pulse">
                <div className="h-full w-full" />
              </GlassCard>
            ))}
          </div>
        )}

        {!loading && assets.length === 0 && (
          <GlassCard variant="strong" className="mx-auto max-w-2xl p-8 text-center">
            <p className="text-5xl">🖼️</p>
            <h2 className={cn('mt-4 text-xl font-semibold', textMain)}>{t('dashboard.contentGallery.emptyTitle')}</h2>
            <p className={cn('mx-auto mt-2 max-w-xl text-sm', textSub)}>{t('dashboard.contentGallery.emptyText')}</p>
            <Button onClick={() => setModalOpen(true)} className="mt-6">
              {t('dashboard.contentGallery.emptyAction')}
            </Button>
          </GlassCard>
        )}

        {!loading && assets.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {assets.map((asset) => {
              const previewUrl = previewByAssetId[asset.id];
              const meta = metaByAssetId[asset.id];
              const stars = formatStars(meta?.rating || 5);
              const author = meta?.authorName || t('dashboard.contentGallery.meta.unknownAuthor');
              const source = meta?.source || t('dashboard.contentGallery.meta.unknownSource');
              return (
                <article key={asset.id} className="group" data-testid="content-card">
                  <GlassCard variant="glass" className="space-y-3 p-3 md:p-4">
                    <header className="flex items-center justify-between gap-2">
                      <p className={cn('truncate text-sm font-semibold', textMain)}>{stars} {author}</p>
                      <p className={cn('text-[11px] uppercase tracking-wide', textMuted)}>{source}</p>
                    </header>

                    <div className="relative overflow-hidden rounded-xl border border-white/12 bg-white/5">
                      {previewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- Supabase signed URL (expiring token); next/image optimizer cannot cache these correctly
                        <img
                          src={previewUrl}
                          alt={t('dashboard.contentGallery.previewAlt')}
                          className="aspect-[4/5] w-full object-cover"
                        />
                      ) : (
                        <div className="flex aspect-[4/5] items-center justify-center text-xs text-white/60">
                          {t('dashboard.contentGallery.loadingPreview')}
                        </div>
                      )}

                      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent opacity-0 transition-opacity duration-[220ms] ease-premium md:group-hover:opacity-100" />
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => void handleVariant(asset)}
                        loading={variantLoadingId === asset.id}
                        className="max-md:flex-1"
                        data-testid="content-copy-hook"
                      >
                        {t('dashboard.contentGallery.actions.variant')}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => void handleDownload(asset)}
                        loading={downloadLoadingId === asset.id}
                        className="max-md:flex-1"
                        data-testid="content-copy-caption"
                      >
                        {t('dashboard.contentGallery.actions.download')}
                      </Button>
                      {canPublishContent && (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void publishAsset({ id: asset.id, format: asset.format, templateId: asset.template_id })}
                          loading={publishLoadingId === asset.id}
                          className="max-md:flex-1"
                          data-testid="content-approve"
                        >
                          {t('dashboard.contentGallery.actions.publish')}
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => openEditorForAsset({ id: asset.id, suggestionId: asset.suggestion_id })}
                        className="hidden border-brand-accent/35 text-emerald-200 md:inline-flex"
                      >
                        {t('dashboard.contentGallery.actions.openEditor')}
                      </Button>
                    </div>
                  </GlassCard>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <ContentQuickCreateModal
        isOpen={modalOpen}
        bizId={biz.id}
        language={language}
        supabase={supabase}
        onClose={() => setModalOpen(false)}
        onCreated={loadAssets}
        onPublish={publishAsset}
        canPublish={canPublishContent}
        onCustomize={(asset) => {
          setModalOpen(false);
          openEditorForAsset({ id: asset.id, suggestionId: asset.suggestionId });
        }}
      />
    </>
  );
}
