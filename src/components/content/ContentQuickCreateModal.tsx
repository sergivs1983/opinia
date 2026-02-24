'use client';

import { useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import Button from '@/components/ui/Button';
import GlassCard from '@/components/ui/GlassCard';
import { useT } from '@/components/i18n/I18nContext';
import { cn } from '@/lib/utils';
import type { ContentSuggestion, Review } from '@/types/database';
import { getWeekStartMondayFromDate } from '@/lib/planner';
import { textMain, textMuted, textSub } from '@/components/ui/glass';

type ContentLanguage = 'ca' | 'es' | 'en';
type ContentAssetFormat = 'story' | 'feed';

type GenerateResponse = {
  suggestions?: ContentSuggestion[];
  request_id?: string;
  error?: string;
  message?: string;
};

type RenderResponse = {
  assetId?: string;
  signedUrl?: string;
  format?: ContentAssetFormat;
  templateId?: string;
  request_id?: string;
  error?: string;
  message?: string;
};

type ReviewLite = Pick<
  Review,
  'id' | 'author_name' | 'rating' | 'review_text' | 'source' | 'created_at' | 'review_date' | 'language_detected'
>;

type CreatedAsset = {
  id: string;
  signedUrl: string;
  format: ContentAssetFormat;
  templateId: string;
  suggestionId: string | null;
};

interface ContentQuickCreateModalProps {
  isOpen: boolean;
  bizId: string;
  language: ContentLanguage;
  supabase: SupabaseClient;
  onClose: () => void;
  onCreated: () => Promise<void> | void;
  onPublish: (asset: CreatedAsset) => Promise<void> | void;
  onCustomize: (asset: CreatedAsset) => void;
  canPublish?: boolean;
}

function formatStars(rating: number): string {
  return '★'.repeat(Math.max(0, Math.min(5, Math.round(rating))));
}

function extractEvidenceReviewId(suggestion: ContentSuggestion): string | null {
  if (!Array.isArray(suggestion.evidence)) return null;
  const first = suggestion.evidence.find(
    (item) => item && typeof item === 'object' && 'review_id' in item && typeof (item as { review_id?: unknown }).review_id === 'string',
  ) as { review_id?: string } | undefined;
  return first?.review_id || null;
}

export default function ContentQuickCreateModal({
  isOpen,
  bizId,
  language,
  supabase,
  onClose,
  onCreated,
  onPublish,
  onCustomize,
  canPublish = true,
}: ContentQuickCreateModalProps) {
  const t = useT();
  const [step, setStep] = useState<'pick' | 'loading' | 'result'>('pick');
  const [reviews, setReviews] = useState<ReviewLite[]>([]);
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null);
  const [loadingReviews, setLoadingReviews] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loadingLineIndex, setLoadingLineIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [resultAsset, setResultAsset] = useState<CreatedAsset | null>(null);
  const [publishing, setPublishing] = useState(false);

  const loadingLines = useMemo(
    () => [
      t('dashboard.contentGallery.modal.loadingLine1'),
      t('dashboard.contentGallery.modal.loadingLine2'),
      t('dashboard.contentGallery.modal.loadingLine3'),
    ],
    [t],
  );

  useEffect(() => {
    if (!isOpen) return;

    setStep('pick');
    setError(null);
    setSubmitting(false);
    setLoadingReviews(true);
    setReviews([]);
    setSelectedReviewId(null);
    setResultAsset(null);

    void (async () => {
      const { data, error: reviewsError } = await supabase
        .from('reviews')
        .select('id, author_name, rating, review_text, source, created_at, review_date, language_detected')
        .eq('biz_id', bizId)
        .gte('rating', 4)
        .order('created_at', { ascending: false })
        .limit(18);

      if (reviewsError || !Array.isArray(data)) {
        setReviews([]);
        setError(t('dashboard.contentGallery.errorLoadReviews'));
        setLoadingReviews(false);
        return;
      }

      const rows = data as ReviewLite[];
      setReviews(rows);
      setSelectedReviewId(rows[0]?.id || null);
      setLoadingReviews(false);
    })();
  }, [bizId, isOpen, supabase, t]);

  useEffect(() => {
    if (!isOpen || step !== 'loading') return;
    const id = window.setInterval(() => {
      setLoadingLineIndex((previous) => (previous + 1) % loadingLines.length);
    }, 2500);
    return () => window.clearInterval(id);
  }, [isOpen, loadingLines.length, step]);

  if (!isOpen) return null;

  const selectedReview = reviews.find((review) => review.id === selectedReviewId) || null;

  async function handleCreate() {
    if (!selectedReview) return;
    setError(null);
    setSubmitting(true);
    setStep('loading');

    try {
      const baseDate = selectedReview.review_date
        ? new Date(`${selectedReview.review_date}T10:00:00`)
        : new Date(selectedReview.created_at);
      const weekStart = getWeekStartMondayFromDate(baseDate);

      const generateResponse = await fetch('/api/content-intel/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-biz-id': bizId,
        },
        body: JSON.stringify({
          businessId: bizId,
          weekStart,
          language,
          maxReviews: 50,
        }),
      });

      const generatePayload = (await generateResponse.json().catch(() => ({}))) as GenerateResponse;
      if (!generateResponse.ok || generatePayload.error || !Array.isArray(generatePayload.suggestions) || generatePayload.suggestions.length === 0) {
        throw new Error(generatePayload.message || t('dashboard.contentGallery.errorGenerateSuggestions'));
      }

      const suggestion = generatePayload.suggestions.find(
        (item) => extractEvidenceReviewId(item) === selectedReview.id,
      ) || generatePayload.suggestions[0];

      const renderResponse = await fetch('/api/content-studio/render', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-biz-id': bizId,
        },
        body: JSON.stringify({
          suggestionId: suggestion.id,
          format: 'feed',
          templateId: 'quote-clean',
          language,
        }),
      });

      const renderPayload = (await renderResponse.json().catch(() => ({}))) as RenderResponse;
      if (!renderResponse.ok || renderPayload.error || !renderPayload.assetId || !renderPayload.signedUrl) {
        throw new Error(renderPayload.message || t('dashboard.contentGallery.errorCreateAsset'));
      }

      setResultAsset({
        id: renderPayload.assetId,
        signedUrl: renderPayload.signedUrl,
        format: renderPayload.format || 'feed',
        templateId: renderPayload.templateId || 'quote-clean',
        suggestionId: suggestion.id,
      });
      setStep('result');
      await onCreated();
      setSubmitting(false);
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : t('dashboard.contentGallery.errorCreateAsset'));
      setStep('pick');
      setSubmitting(false);
    }
  }

  async function handlePublish() {
    if (!resultAsset) return;
    setPublishing(true);
    try {
      await onPublish(resultAsset);
      setPublishing(false);
      onClose();
    } catch {
      setPublishing(false);
    }
  }

  function downloadResult() {
    if (!resultAsset) return;
    const anchor = document.createElement('a');
    anchor.href = resultAsset.signedUrl;
    anchor.download = `opinia-post-${resultAsset.id}.png`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4" onClick={onClose}>
      <div
        className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-2xl border border-white/16 bg-[#070B14]/88 p-4 shadow-float backdrop-blur-xl md:p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className={cn('font-display text-xl font-semibold', textMain)}>
              {step === 'result' ? t('dashboard.contentGallery.modal.resultTitle') : t('dashboard.contentGallery.modal.title')}
            </h2>
            <p className={cn('text-sm', textSub)}>
              {step === 'pick'
                ? t('dashboard.contentGallery.modal.pickSubtitle')
                : step === 'loading'
                  ? t('dashboard.contentGallery.modal.loadingSubtitle')
                  : t('dashboard.contentGallery.modal.resultSubtitle')}
            </p>
          </div>
          <Button variant="secondary" onClick={onClose}>
            {t('dashboard.studio.close')}
          </Button>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-rose-300/35 bg-rose-500/12 px-3 py-2 text-sm text-rose-200">
            {error}
          </div>
        )}

        {step === 'pick' && (
          <div className="space-y-3">
            {loadingReviews && (
              <GlassCard variant="strong" className="h-28 animate-pulse">
                <div className="h-full w-full" />
              </GlassCard>
            )}

            {!loadingReviews && reviews.length === 0 && (
              <GlassCard variant="glass" className="p-6 text-center">
                <p className={cn('text-sm', textMain)}>{t('dashboard.contentGallery.modal.noEligibleReviews')}</p>
                <p className={cn('mt-1 text-xs', textMuted)}>{t('dashboard.contentGallery.modal.noEligibleReviewsHelp')}</p>
              </GlassCard>
            )}

            {!loadingReviews && reviews.length > 0 && (
              <div className="max-h-[52vh] space-y-2 overflow-y-auto pr-1">
                {reviews.map((review) => {
                  const selected = review.id === selectedReviewId;
                  return (
                    <button
                      key={review.id}
                      type="button"
                      onClick={() => setSelectedReviewId(review.id)}
                      className={cn(
                        'w-full rounded-xl border p-3 text-left transition-all duration-[220ms] ease-premium',
                        selected
                          ? 'bg-emerald-400/15 border-emerald-300/40 shadow-[0_0_18px_rgba(52,211,153,0.18)]'
                          : 'bg-white/5 border-white/12 hover:bg-white/8',
                      )}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className={cn('text-sm font-semibold', textMain)}>
                          {formatStars(review.rating)} {review.author_name || t('dashboard.contentGallery.meta.anonymous')}
                        </p>
                        <p className={cn('text-xs uppercase tracking-wide', textMuted)}>{review.source}</p>
                      </div>
                      <p className={cn('mt-2 line-clamp-3 text-sm', textSub)}>{review.review_text}</p>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="flex justify-end pt-2">
              <Button onClick={() => void handleCreate()} loading={submitting} disabled={!selectedReview}>
                {t('dashboard.contentGallery.modal.createPost')}
              </Button>
            </div>
          </div>
        )}

        {step === 'loading' && (
          <div className="flex min-h-[320px] flex-col items-center justify-center gap-4 text-center">
            <div className="h-12 w-12 animate-spin rounded-full border-2 border-white/20 border-t-emerald-300" />
            <p className={cn('text-sm md:text-base transition-opacity duration-300', textSub)}>{loadingLines[loadingLineIndex]}</p>
          </div>
        )}

        {step === 'result' && resultAsset && (
          <div className="space-y-4">
            <GlassCard variant="glass" className="p-3">
              <img
                src={resultAsset.signedUrl}
                alt={t('dashboard.contentGallery.modal.previewAlt')}
                className="aspect-[4/5] w-full rounded-xl border border-white/14 object-cover"
              />
            </GlassCard>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={downloadResult}>
                {t('dashboard.contentGallery.actions.download')}
              </Button>
              <Button variant="secondary" onClick={() => onCustomize(resultAsset)}>
                {t('dashboard.contentGallery.actions.customize')}
              </Button>
              {canPublish && (
                <Button onClick={() => void handlePublish()} loading={publishing}>
                  {t('dashboard.contentGallery.actions.publish')}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
