'use client';

import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import { useT } from '@/components/i18n/I18nContext';
import { useRouter } from 'next/navigation';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import LitoCard from '@/components/ui/LitoCard';
import PageHeader from '@/components/ui/PageHeader';
import StarRating from '@/components/ui/StarRating';
import Chip from '@/components/ui/Chip';
import EmptyState from '@/components/ui/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
import ReviewListItem from '@/components/inbox/ReviewListItem';
import ReviewDetailCard from '@/components/inbox/ReviewDetailCard';
import ReplyCard from '@/components/inbox/ReplyCard';
import { glass, glassStrong, ringAccent, textMain, textMuted, textSub } from '@/components/ui/glass';
import { cn, ratingToSentiment } from '@/lib/utils';
import type {
  GuardrailWarning,
  Reply,
  ReplyTone,
  ReviewSource,
  Sentiment,
} from '@/types/database';
import { useReviews, type ReviewStatusFilter } from '@/hooks/useReviews';
import { useSupabase } from '@/hooks/useSupabase';

type FilterStatus = ReviewStatusFilter;
type MobileTab = 'list' | 'detail' | 'reply';

type TriggerFired = { triggerId: string; triggerName: string };

type ReviewClassification = {
  topics?: string[];
  urgency?: string;
  [key: string]: unknown;
};

type GenerateResponsePayload = {
  error?: string;
  message?: string;
  request_id?: string;
  guardrail_warnings?: GuardrailWarning[];
  classification?: ReviewClassification | null;
  triggers_fired?: TriggerFired[];
};

type GenerateErrorState = {
  message: string;
  requestId: string | null;
};

const MOBILE_TABS: Array<{ id: MobileTab; key: string }> = [
  { id: 'list', key: 'dashboard.inbox.tabList' },
  { id: 'detail', key: 'dashboard.inbox.tabDetail' },
  { id: 'reply', key: 'dashboard.inbox.tabReply' },
];

export default function LITOInboxTab() {
  const t = useT();
  const { biz, org } = useWorkspace();
  const router = useRouter();
  const supabase = useSupabase();

  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [filterSentiment, setFilterSentiment] = useState<Sentiment | 'all'>('all');
  const [filterSource, setFilterSource] = useState<ReviewSource | 'all'>('all');
  const [filterRating, setFilterRating] = useState<number>(0);
  const [showAddModal, setShowAddModal] = useState(false);

  const [mobileTab, setMobileTab] = useState<MobileTab>('list');
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null);

  const [replies, setReplies] = useState<Reply[]>([]);
  const [selectedTone, setSelectedTone] = useState<ReplyTone>('professional');
  const [editedContent, setEditedContent] = useState<Record<string, string>>({});
  const [warnings, setWarnings] = useState<GuardrailWarning[]>([]);
  const [guardrailAcknowledged, setGuardrailAcknowledged] = useState(false);
  const [classification, setClassification] = useState<ReviewClassification | null>(null);
  const [triggersFired, setTriggersFired] = useState<TriggerFired[]>([]);

  const [generating, setGenerating] = useState(false);
  const [approving, setApproving] = useState(false);
  const [generateError, setGenerateError] = useState<GenerateErrorState | null>(null);
  const [copiedRequestId, setCopiedRequestId] = useState(false);

  const { reviews, loading, error, refetch } = useReviews({
    bizId: biz?.id,
    status: filterStatus,
    sentiment: filterSentiment,
    source: filterSource,
    rating: filterRating,
    limit: 100,
  });

  const loadReplies = useCallback(
    async (reviewId: string) => {
      const { data, error: repliesError } = await supabase
        .from('replies')
        .select('*')
        .eq('review_id', reviewId)
        .order('created_at', { ascending: false });

      if (repliesError) {
        setReplies([]);
        return;
      }

      setReplies((data as Reply[]) || []);
    },
    [supabase],
  );

  useEffect(() => {
    if (reviews.length === 0) {
      setSelectedReviewId(null);
      setReplies([]);
      return;
    }

    if (!selectedReviewId || !reviews.some((review) => review.id === selectedReviewId)) {
      setSelectedReviewId(reviews[0].id);
    }
  }, [reviews, selectedReviewId]);

  useEffect(() => {
    if (!selectedReviewId) return;

    setSelectedTone('professional');
    setEditedContent({});
    setWarnings([]);
    setGuardrailAcknowledged(false);
    setClassification(null);
    setGenerateError(null);
    setCopiedRequestId(false);
    setTriggersFired([]);

    void loadReplies(selectedReviewId);
  }, [selectedReviewId, loadReplies]);

  const selectedReview = reviews.find((review) => review.id === selectedReviewId) || null;
  const currentReply = replies.find((reply) => reply.tone === selectedTone) || null;
  const currentContent = editedContent[selectedTone] || currentReply?.content || '';
  const currentWarnings = warnings.filter((warning) => warning.tone === selectedTone);

  const metadataTopics = useMemo(() => {
    if (!selectedReview?.metadata || typeof selectedReview.metadata !== 'object') return [] as string[];

    const topics = (selectedReview.metadata as Record<string, unknown>).topics;
    if (!Array.isArray(topics)) return [] as string[];

    return topics.filter((topic): topic is string => typeof topic === 'string').slice(0, 5);
  }, [selectedReview]);

  const detailTopics = (classification?.topics || metadataTopics).slice(0, 5);

  const seoEnabled = Boolean(biz?.seo_enabled ?? biz?.seo_mode);
  const seoAggressiveness = Math.max(1, Math.min(3, biz?.seo_aggressiveness || 1));
  const seoKeywords = [
    ...new Set([...(biz?.seo_keywords || []), ...(biz?.target_keywords || [])]),
  ].filter(Boolean) as string[];

  const pending = reviews.filter((review) => !review.is_replied).length;
  const urgent = reviews.filter((review) => !review.is_replied && review.rating <= 2).length;

  const handleSelectReview = (reviewId: string) => {
    setSelectedReviewId(reviewId);
    setMobileTab('detail');
  };

  const handleDelete = async (reviewId: string, event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!confirm(t('dashboard.inbox.deleteReviewConfirm'))) return;

    await supabase.from('replies').delete().eq('review_id', reviewId);
    await supabase.from('reviews').delete().eq('id', reviewId);

    if (selectedReviewId === reviewId) {
      setSelectedReviewId(null);
      setMobileTab('list');
    }

    await refetch();
  };

  const handleGenerate = async () => {
    if (!selectedReview) return;

    setGenerating(true);
    setWarnings([]);
    setGuardrailAcknowledged(false);
    setGenerateError(null);
    setCopiedRequestId(false);
    setTriggersFired([]);

    try {
      const response = await fetch(`/api/reviews/${selectedReview.id}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: selectedReview.source,
          rating: selectedReview.rating,
          language: selectedReview.language_detected,
          regenerate: replies.length > 0,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as GenerateResponsePayload;
      const requestId = payload.request_id || response.headers.get('x-request-id');

        if (!response.ok || payload.error) {
          setGenerateError({
            message: payload.message || t('dashboard.home.toasts.generateError'),
            requestId: requestId || null,
          });
        setGenerating(false);
        return;
      }

      setWarnings(payload.guardrail_warnings || []);
      setClassification(payload.classification || null);
      setTriggersFired(payload.triggers_fired || []);
      await Promise.all([loadReplies(selectedReview.id), refetch()]);
      setMobileTab('reply');
    } catch (generationError) {
      setGenerateError({
        message: generationError instanceof Error ? generationError.message : t('dashboard.home.toasts.generateError'),
        requestId: null,
      });
    }

    setGenerating(false);
  };

  const handleApprove = async () => {
    if (!selectedReview || !currentReply) return;
    if (currentWarnings.length > 0 && !guardrailAcknowledged) return;

    setApproving(true);

    const finalContent = editedContent[selectedTone] || currentReply.content;

    await supabase
      .from('replies')
      .update({
        status: 'published',
        content: finalContent,
        is_edited: Boolean(editedContent[selectedTone]),
        published_at: new Date().toISOString(),
      })
      .eq('id', currentReply.id);

    const otherReplyIds = replies.filter((reply) => reply.id !== currentReply.id).map((reply) => reply.id);
    if (otherReplyIds.length > 0) {
      await supabase.from('replies').update({ status: 'archived' }).in('id', otherReplyIds);
    }

    await supabase.from('reviews').update({ is_replied: true }).eq('id', selectedReview.id);

    await Promise.all([loadReplies(selectedReview.id), refetch()]);
    setApproving(false);
    setMobileTab('list');
  };

  const handleCopyReply = async () => {
    if (!currentContent.trim()) return;
    await navigator.clipboard.writeText(currentContent);
  };

  const handleCopyRequestId = async () => {
    if (!generateError?.requestId) return;
    await navigator.clipboard.writeText(generateError.requestId);
    setCopiedRequestId(true);
    window.setTimeout(() => setCopiedRequestId(false), 1500);
  };

  if (!biz) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-zinc-500">
        <div className="text-center">
          <p className="mb-3 text-4xl">📭</p>
          <p className="font-medium">{t('dashboard.inbox.businessMissing')}</p>
          <Button className="mt-4" onClick={() => router.push('/onboarding')}>{t('dashboard.layout.createBusiness')}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="lito-light-scope flex min-h-0 flex-col gap-4 pb-10" data-testid="inbox-page">
      <PageHeader
        title="Inbox"
        subtitle="Ressenyes pendents, generació de resposta i aprovació."
      />

      {biz.panic_mode && (
        <LitoCard spotlight={false} className="rounded-xl border border-red-500/35 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span className="font-medium">{t('dashboard.inbox.panicBanner')}</span>
          {biz.panic_reason ? <span className="ml-1 opacity-80">— {biz.panic_reason}</span> : null}
        </LitoCard>
      )}

      <LitoCard spotlight={false} className={cn('md:hidden p-2')}>
        <div className="flex items-center gap-2 overflow-x-auto">
          {MOBILE_TABS.map((tab) => (
            <Chip key={tab.id} active={mobileTab === tab.id} onClick={() => setMobileTab(tab.id)}>
              {t(tab.key)}
            </Chip>
          ))}
        </div>
      </LitoCard>

      <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)_360px]">
        <section className={cn(glassStrong, 'min-h-0 overflow-hidden border border-white/10 p-4 shadow-glass', mobileTab === 'list' ? 'block' : 'hidden', 'md:block')}>
          <header className="mb-3 flex items-center justify-between gap-2">
            <div>
              <h1 className={cn('font-display text-lg font-semibold', textMain)}>{t('dashboard.inbox.title')}</h1>
              <p className={cn('text-xs', textMuted)}>{pending} {t('dashboard.inbox.pending')} · {urgent} {t('dashboard.inbox.urgent')}</p>
            </div>
            <Button size="sm" onClick={() => setShowAddModal(true)} data-testid="inbox-add-review">
              + {t('dashboard.inbox.addReview')}
            </Button>
          </header>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Chip active={filterStatus === 'all'} onClick={() => setFilterStatus('all')}>{t('dashboard.inbox.all')}</Chip>
            <Chip active={filterStatus === 'pending'} onClick={() => setFilterStatus('pending')}>{t('dashboard.inbox.pendingFilter')}</Chip>
            <Chip active={filterStatus === 'replied'} onClick={() => setFilterStatus('replied')}>{t('dashboard.inbox.replied')}</Chip>
          </div>

          <div className="mb-3 grid grid-cols-3 gap-2">
            <select
              value={filterSentiment}
              onChange={(event) => setFilterSentiment(event.target.value as Sentiment | 'all')}
              className={cn('rounded-lg border border-white/15 bg-white/8 px-2 py-1.5 text-xs text-white/85', ringAccent)}
            >
              <option value="all">{t('common.anySentiment')}</option>
              <option value="positive">{t('common.sentiment.positive')}</option>
              <option value="neutral">{t('common.sentiment.neutral')}</option>
              <option value="negative">{t('common.sentiment.negative')}</option>
            </select>
            <select
              value={filterSource}
              onChange={(event) => setFilterSource(event.target.value as ReviewSource | 'all')}
              className={cn('rounded-lg border border-white/15 bg-white/8 px-2 py-1.5 text-xs text-white/85', ringAccent)}
            >
              <option value="all">{t('dashboard.inbox.sourceAll')}</option>
              <option value="google">{t('common.platforms.google')}</option>
              <option value="tripadvisor">{t('common.platforms.tripadvisor')}</option>
              <option value="booking">{t('common.platforms.booking')}</option>
              <option value="manual">{t('common.platforms.manual')}</option>
            </select>
            <select
              value={String(filterRating)}
              onChange={(event) => setFilterRating(Number(event.target.value))}
              className={cn('rounded-lg border border-white/15 bg-white/8 px-2 py-1.5 text-xs text-white/85', ringAccent)}
            >
              <option value="0">{t('dashboard.inbox.ratingAll')}</option>
              <option value="5">5★</option>
              <option value="4">4★</option>
              <option value="3">3★</option>
              <option value="2">2★</option>
              <option value="1">1★</option>
            </select>
          </div>

          <div className="min-h-0 overflow-y-auto pr-1" data-testid="inbox-review-list">
            {loading ? (
              <div className="space-y-3">
                {[0, 1, 2, 3].map((index) => (
                  <div key={index} className="rounded-xl border border-white/10 bg-white/6 p-4">
                    <div className="flex gap-3">
                      <Skeleton className="h-10 w-10 rounded-full" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-3 w-1/3" />
                        <Skeleton className="h-3 w-2/3" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : error ? (
              <div className="py-8 text-center">
                <p className="text-sm text-red-300">{error}</p>
                <Button className="mt-3" variant="secondary" onClick={() => void refetch()}>
                  {t('common.tryAgain')}
                </Button>
              </div>
            ) : reviews.length === 0 ? (
              <EmptyState
                title={t('dashboard.inbox.title')}
                description={t('dashboard.inbox.noReviews')}
                action={<Button onClick={() => setShowAddModal(true)}>+ {t('dashboard.inbox.addReview')}</Button>}
              />
            ) : (
              <div className="space-y-2">
                {reviews.map((review) => (
                  <ReviewListItem
                    key={review.id}
                    review={review}
                    selected={review.id === selectedReviewId}
                    onSelect={handleSelectReview}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        <section className={cn('min-h-0', mobileTab === 'detail' ? 'block' : 'hidden', 'md:block')}>
          <ReviewDetailCard review={selectedReview} topics={detailTopics} />

          {triggersFired.length > 0 && (
            <div className="mt-3 rounded-xl border border-amber-500/35 bg-amber-500/12 p-3">
              <p className="text-xs font-semibold text-amber-200">{t('dashboard.inbox.triggersCount', { count: triggersFired.length })}</p>
            </div>
          )}
        </section>

        <section className={cn('min-h-0', mobileTab === 'reply' ? 'block' : 'hidden', 'md:hidden xl:block')}>
          <ReplyCard
            review={selectedReview}
            replies={replies}
            selectedTone={selectedTone}
            value={currentContent}
            generating={generating}
            approving={approving}
            guardrailWarnings={currentWarnings}
            guardrailAcknowledged={guardrailAcknowledged}
            seoEnabled={seoEnabled}
            seoAggressiveness={seoAggressiveness}
            seoKeywords={seoKeywords}
            error={generateError}
            copiedRequestId={copiedRequestId}
            onToneChange={(tone) => {
              setSelectedTone(tone);
              setGuardrailAcknowledged(false);
            }}
            onChange={(value) => setEditedContent((previous) => ({ ...previous, [selectedTone]: value }))}
            onGenerate={handleGenerate}
            onApprove={handleApprove}
            onCopy={handleCopyReply}
            onGuardrailAcknowledge={setGuardrailAcknowledged}
            onCopyRequestId={handleCopyRequestId}
          />
        </section>
      </div>

      {showAddModal && org && (
        <AddReviewModal
          biz={{ id: biz.id, defaultLanguage: biz.default_language }}
          org={{ id: org.id }}
          onClose={() => setShowAddModal(false)}
          onSaved={() => {
            setShowAddModal(false);
            void refetch();
          }}
        />
      )}
    </div>
  );
}

type AddReviewModalProps = {
  biz: { id: string; defaultLanguage?: string | null };
  org: { id: string };
  onClose: () => void;
  onSaved: () => void;
};

function AddReviewModal({ biz, org, onClose, onSaved }: AddReviewModalProps) {
  const t = useT();
  const [text, setText] = useState('');
  const [rating, setRating] = useState(0);
  const [author, setAuthor] = useState('');
  const [source, setSource] = useState<ReviewSource>('manual');
  const [saving, setSaving] = useState(false);
  const supabase = useSupabase();

  const handleSave = async () => {
    if (!text.trim() || rating === 0) return;
    setSaving(true);

    const { error: insertError } = await supabase.from('reviews').insert({
      biz_id: biz.id,
      org_id: org.id,
      source,
      author_name: author || null,
      review_text: text,
      rating,
      sentiment: ratingToSentiment(rating),
      language_detected: biz.defaultLanguage || 'ca',
      review_date: new Date().toISOString(),
      needs_attention: rating <= 2,
    });

    if (!insertError) onSaved();
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className={cn(glassStrong, 'w-full max-w-lg space-y-4 p-6')} onClick={(event) => event.stopPropagation()} data-testid="inbox-add-review-modal">
        <h2 className={cn('font-display text-lg font-bold', textMain)}>{t('dashboard.inbox.addReview')}</h2>

        <div className="flex gap-3">
          <Input
            label={t('dashboard.inbox.authorLabel')}
            placeholder={t('dashboard.inbox.authorPlaceholder')}
            value={author}
            onChange={(event) => setAuthor(event.target.value)}
            className="flex-1"
            data-testid="inbox-add-review-author"
          />

          <div>
            <label className={cn('mb-1 block text-sm font-medium', textSub)}>{t('dashboard.inbox.sourceLabel')}</label>
            <select
              value={source}
              onChange={(event) => setSource(event.target.value as ReviewSource)}
              data-testid="inbox-add-review-source"
              className={cn('rounded-xl border border-white/15 bg-white/8 px-3 py-2 text-sm', ringAccent)}
            >
              <option value="manual">{t('common.platforms.manual')}</option>
              <option value="google">{t('common.platforms.google')}</option>
              <option value="tripadvisor">{t('common.platforms.tripadvisor')}</option>
              <option value="booking">{t('common.platforms.booking')}</option>
              <option value="other">{t('common.platforms.other')}</option>
            </select>
          </div>
        </div>

        <div>
          <label className={cn('mb-1 block text-sm font-medium', textSub)}>{t('dashboard.inbox.ratingRequired')}</label>
          <StarRating rating={rating} onChange={setRating} size="lg" />
        </div>

        <div>
          <label className={cn('mb-1 block text-sm font-medium', textSub)}>{t('dashboard.inbox.reviewTextRequired')}</label>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={t('dashboard.inbox.reviewTextPlaceholder')}
            data-testid="inbox-add-review-text"
            className={cn('min-h-[120px] w-full resize-y rounded-xl border border-white/15 bg-white/8 px-4 py-3 text-sm focus:border-brand-accent/40', ringAccent)}
          />
        </div>

        <div className="flex gap-3 pt-2">
          <Button variant="secondary" onClick={onClose} className="flex-1" data-testid="inbox-add-review-cancel">
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleSave}
            loading={saving}
            disabled={!text.trim() || rating === 0}
            className="flex-[2]"
            data-testid="inbox-add-review-save"
          >
            {t('dashboard.inbox.saveReview')}
          </Button>
        </div>
      </div>
    </div>
  );
}
