'use client';

export const dynamic = 'force-dynamic';


import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/components/i18n/I18nContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useReviews } from '@/hooks/useReviews';
import { useSupabase } from '@/hooks/useSupabase';
import { useToast } from '@/components/ui/Toast';
import Button from '@/components/ui/Button';
import GlassCard from '@/components/ui/GlassCard';
import ActionReviewCard from '@/components/home/ActionReviewCard';
import PublishSuccessModal from '@/components/home/PublishSuccessModal';
import { cn } from '@/lib/utils';
import { textMain, textSub } from '@/components/ui/glass';
import type { Reply, Review } from '@/types/database';

type ReplyDraftRow = Pick<Reply, 'id' | 'review_id' | 'tone' | 'status' | 'content' | 'created_at'>;

type GenerateResponsePayload = {
  error?: string;
  message?: string;
  request_id?: string;
};

type ApproveResponsePayload = {
  error?: string;
  message?: string;
  request_id?: string;
};

type ContentAssetListPayload = {
  items?: Array<{ id: string }>;
};

type AssetSignedUrlPayload = {
  signedUrl?: string;
};

const DISMISSED_SOCIAL_MAGIC_REVIEWS_KEY = 'opinia.home.dismissedSocialMagicReviews';

function pickProposalReply(rows: ReplyDraftRow[]): ReplyDraftRow | null {
  if (!rows.length) return null;
  return (
    rows.find((reply) => reply.status === 'draft' && reply.tone === 'professional')
    || rows.find((reply) => reply.status === 'draft')
    || rows.find((reply) => reply.status === 'selected')
    || rows.find((reply) => reply.status === 'published')
    || rows[0]
    || null
  );
}

export default function DashboardPage() {
  const t = useT();
  const router = useRouter();
  const supabase = useSupabase();
  const { toast } = useToast();
  const { biz } = useWorkspace();

  const [draftsByReview, setDraftsByReview] = useState<Record<string, ReplyDraftRow[]>>({});
  const [approvingByReview, setApprovingByReview] = useState<Record<string, boolean>>({});
  const [generatingByReview, setGeneratingByReview] = useState<Record<string, boolean>>({});
  const [removingByReview, setRemovingByReview] = useState<Record<string, boolean>>({});
  const [hiddenReviewIds, setHiddenReviewIds] = useState<string[]>([]);
  const [userName, setUserName] = useState<string | null>(null);

  const [successModalOpen, setSuccessModalOpen] = useState(false);
  const [successModalReviewId, setSuccessModalReviewId] = useState<string | null>(null);
  const [successAssetUrl, setSuccessAssetUrl] = useState<string | null>(null);
  const [successAssetLoading, setSuccessAssetLoading] = useState(false);
  const [dismissedSocialMagicReviewIds, setDismissedSocialMagicReviewIds] = useState<string[]>([]);

  const { reviews, loading, error, refetch } = useReviews({
    bizId: biz?.id,
    status: 'pending',
    limit: 50,
  });

  const queue = useMemo(
    () => reviews.filter((review) => !review.is_replied && !hiddenReviewIds.includes(review.id)),
    [reviews, hiddenReviewIds],
  );

  const pendingCount = queue.length;
  const completedCount = hiddenReviewIds.length;
  const progressTotal = pendingCount + completedCount;
  const savedMinutesToday = completedCount * 5;
  const greetingName = userName || t('common.appName');

  const loadDraftReplies = useCallback(
    async (reviewIds: string[]) => {
      if (!biz?.id || reviewIds.length === 0) return;

      const { data, error: repliesError } = await supabase
        .from('replies')
        .select('id, review_id, tone, status, content, created_at')
        .eq('biz_id', biz.id)
        .in('review_id', reviewIds)
        .order('created_at', { ascending: false });

      if (repliesError) return;

      const grouped = (data || []).reduce<Record<string, ReplyDraftRow[]>>((acc, row) => {
        const reply = row as ReplyDraftRow;
        if (!acc[reply.review_id]) acc[reply.review_id] = [];
        acc[reply.review_id].push(reply);
        return acc;
      }, {});

      setDraftsByReview((previous) => {
        const next = { ...previous };
        for (const reviewId of reviewIds) {
          next[reviewId] = grouped[reviewId] || [];
        }
        return next;
      });
    },
    [biz?.id, supabase],
  );

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      const metadata = (data.user?.user_metadata || {}) as Record<string, unknown>;
      const fullName = metadata.full_name ?? metadata.name ?? metadata.display_name;
      setUserName(typeof fullName === 'string' && fullName.trim() ? fullName.trim() : null);
    });
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  useEffect(() => {
    if (!queue.length) return;
    void loadDraftReplies(queue.map((review) => review.id));
  }, [queue, loadDraftReplies]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const rawValue = window.localStorage.getItem(DISMISSED_SOCIAL_MAGIC_REVIEWS_KEY);
    if (!rawValue) return;
    try {
      const parsed = JSON.parse(rawValue) as unknown;
      if (Array.isArray(parsed)) {
        setDismissedSocialMagicReviewIds(parsed.filter((value): value is string => typeof value === 'string'));
      }
    } catch {
      // ignore malformed local storage values
    }
  }, []);

  const markSocialMagicDismissed = useCallback((reviewId: string | null) => {
    if (!reviewId || typeof window === 'undefined') return;
    setDismissedSocialMagicReviewIds((previous) => {
      if (previous.includes(reviewId)) return previous;
      const next = [...previous, reviewId];
      window.localStorage.setItem(DISMISSED_SOCIAL_MAGIC_REVIEWS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const openSuccessModal = useCallback(async (reviewId: string) => {
    if (dismissedSocialMagicReviewIds.includes(reviewId)) {
      return;
    }

    setSuccessModalReviewId(reviewId);
    if (!biz?.id) {
      setSuccessAssetLoading(false);
      setSuccessAssetUrl(null);
      setSuccessModalOpen(true);
      return;
    }

    setSuccessModalOpen(true);
    setSuccessAssetLoading(true);
    setSuccessAssetUrl(null);

    try {
      const listResponse = await fetch('/api/content-studio/assets?limit=1', {
        headers: { 'x-biz-id': biz.id },
      });
      const listPayload = (await listResponse.json().catch(() => ({}))) as ContentAssetListPayload;
      const latestAssetId = listPayload.items?.[0]?.id;
      if (!listResponse.ok || !latestAssetId) {
        setSuccessAssetLoading(false);
        return;
      }

      const signedUrlResponse = await fetch(`/api/content-studio/assets/${latestAssetId}/signed-url`, {
        headers: { 'x-biz-id': biz.id },
      });
      const signedPayload = (await signedUrlResponse.json().catch(() => ({}))) as AssetSignedUrlPayload;
      if (signedUrlResponse.ok && typeof signedPayload.signedUrl === 'string') {
        setSuccessAssetUrl(signedPayload.signedUrl);
      }
    } catch {
      // non-blocking modal preview
    } finally {
      setSuccessAssetLoading(false);
    }
  }, [biz?.id, dismissedSocialMagicReviewIds]);

  const handleRegenerate = useCallback(
    async (review: Review) => {
      setGeneratingByReview((previous) => ({ ...previous, [review.id]: true }));

      try {
        const response = await fetch(`/api/reviews/${review.id}/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            platform: review.source,
            rating: review.rating,
            language: review.language_detected,
            regenerate: true,
          }),
        });

        const payload = (await response.json().catch(() => ({}))) as GenerateResponsePayload;
        if (!response.ok || payload.error) {
          throw new Error(payload.message || t('dashboard.home.toasts.generateError'));
        }

        await Promise.all([loadDraftReplies([review.id]), refetch()]);
      } catch (requestError) {
        const message = requestError instanceof Error ? requestError.message : t('dashboard.home.toasts.generateError');
        toast(message, 'error');
      } finally {
        setGeneratingByReview((previous) => ({ ...previous, [review.id]: false }));
      }
    },
    [loadDraftReplies, refetch, t, toast],
  );

  const handleApproveAndPublish = useCallback(
    async (review: Review) => {
      const proposal = pickProposalReply(draftsByReview[review.id] || []);
      if (!proposal?.content) {
        toast(t('dashboard.home.toasts.generateError'), 'warning');
        return;
      }

      setApprovingByReview((previous) => ({ ...previous, [review.id]: true }));

      try {
        const response = await fetch(`/api/replies/${proposal.id}/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ final_content: proposal.content }),
        });
        const payload = (await response.json().catch(() => ({}))) as ApproveResponsePayload;
        if (!response.ok || payload.error) {
          throw new Error(payload.message || t('dashboard.home.toasts.approveError'));
        }

        setRemovingByReview((previous) => ({ ...previous, [review.id]: true }));
        window.setTimeout(() => {
          setHiddenReviewIds((previous) => (previous.includes(review.id) ? previous : [...previous, review.id]));
          setRemovingByReview((previous) => {
            const next = { ...previous };
            delete next[review.id];
            return next;
          });
        }, 280);

        toast(t('dashboard.home.toasts.approveSuccess'), 'success');
        void refetch();
        void openSuccessModal(review.id);
      } catch (requestError) {
        const message = requestError instanceof Error ? requestError.message : t('dashboard.home.toasts.approveError');
        toast(message, 'error');
      } finally {
        setApprovingByReview((previous) => ({ ...previous, [review.id]: false }));
      }
    },
    [draftsByReview, openSuccessModal, refetch, t, toast],
  );

  if (!biz) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <GlassCard variant="strong" className="w-full max-w-xl p-8 text-center">
          <p className={cn('text-sm', textSub)}>{t('dashboard.metrics.selectBusiness')}</p>
          <Button className="mt-5" onClick={() => router.push('/onboarding')}>
            {t('onboarding.createBusiness')}
          </Button>
        </GlassCard>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-5 w-72 animate-pulse rounded-md bg-white/12" />
        <div className="h-4 w-80 animate-pulse rounded-md bg-white/10" />
        <GlassCard variant="strong" className="h-40 animate-pulse">
          <div />
        </GlassCard>
        <GlassCard variant="strong" className="h-40 animate-pulse">
          <div />
        </GlassCard>
      </div>
    );
  }

  if (error) {
    return (
      <GlassCard variant="strong" className="p-6">
        <p className="text-sm text-rose-300">{error}</p>
        <Button className="mt-4" variant="secondary" onClick={() => void refetch()}>
          {t('common.tryAgain')}
        </Button>
      </GlassCard>
    );
  }

  return (
    <>
      <div className="space-y-5" data-testid="dashboard-action-inbox">
        <header className="space-y-2">
          <h1 className={cn('font-display text-2xl font-semibold tracking-tight', textMain)}>
            {t('dashboard.home.title', { name: greetingName, count: pendingCount })}
          </h1>
          <p className={cn('text-sm', textSub)}>{t('dashboard.home.subtitle')}</p>
          {progressTotal > 0 && (
            <p className="inline-flex rounded-full border border-white/12 bg-white/6 px-3 py-1 text-xs font-medium text-white/80">
              {t('dashboard.home.progress', {
                pending: pendingCount,
                completed: completedCount,
                total: progressTotal,
              })}
            </p>
          )}
        </header>

        {pendingCount === 0 ? (
          <div className="flex min-h-[55vh] items-center justify-center">
            <GlassCard variant="strong" className="w-full max-w-2xl p-10 text-center">
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-emerald-300/30 bg-emerald-400/15 text-3xl shadow-[0_0_24px_rgba(52,211,153,0.18)]">
                ✓
              </div>
              <h2 className={cn('text-2xl font-semibold', textMain)}>{t('dashboard.home.emptyTitle')}</h2>
              <p className={cn('mx-auto mt-2 max-w-lg text-sm', textSub)}>
                {t('dashboard.home.emptySavedToday', { minutes: savedMinutesToday })}
              </p>
              <Button variant="secondary" className="mt-6" onClick={() => router.push('/dashboard/metrics')}>
                {t('dashboard.home.viewImpact')}
              </Button>
            </GlassCard>
          </div>
        ) : (
          <div className="space-y-4">
            {queue.map((review) => {
              const proposal = pickProposalReply(draftsByReview[review.id] || []);
              const proposalText = proposal?.content?.trim() || t('dashboard.home.proposalMissing');
              const approving = Boolean(approvingByReview[review.id]);
              const generating = Boolean(generatingByReview[review.id]);
              const removing = Boolean(removingByReview[review.id]);

              return (
                <ActionReviewCard
                  key={review.id}
                  review={review}
                  proposalText={proposalText}
                  approving={approving}
                  generating={generating}
                  removing={removing}
                  showToneActions={review.rating <= 2}
                  onEdit={() => router.push(`/dashboard/inbox/${review.id}`)}
                  onRedo={() => void handleRegenerate(review)}
                  onToneApology={() => router.push(`/dashboard/inbox/${review.id}`)}
                  onToneContact={() => router.push(`/dashboard/inbox/${review.id}`)}
                  onApprove={() => void handleApproveAndPublish(review)}
                />
              );
            })}
          </div>
        )}
      </div>

      <PublishSuccessModal
        open={successModalOpen}
        title={t('dashboard.home.successModal.title')}
        subtitle={t('dashboard.home.successModal.subtitle')}
        benefitLine={t('dashboard.home.successModal.benefitLine')}
        noAssetText={t('dashboard.home.successModal.noAsset')}
        dismissLabel={t('dashboard.home.actions.dismiss')}
        downloadLabel={t('dashboard.home.actions.downloadImage')}
        primaryLabel={t('dashboard.home.actions.schedulePost')}
        assetUrl={successAssetUrl}
        assetLoading={successAssetLoading}
        onDismiss={() => {
          markSocialMagicDismissed(successModalReviewId);
          setSuccessModalOpen(false);
          setSuccessModalReviewId(null);
        }}
        onDownload={() => {
          if (!successAssetUrl) return;
          window.open(successAssetUrl, '_blank', 'noopener,noreferrer');
        }}
        onPrimary={() => {
          setSuccessModalOpen(false);
          setSuccessModalReviewId(null);
          router.push('/dashboard/planner');
        }}
      />
    </>
  );
}
