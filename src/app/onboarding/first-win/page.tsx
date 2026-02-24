'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Logo from '@/components/ui/Logo';
import Button from '@/components/ui/Button';
import GlassCard from '@/components/ui/GlassCard';
import ActionReviewCard from '@/components/home/ActionReviewCard';
import PublishSuccessModal from '@/components/home/PublishSuccessModal';
import { useT } from '@/components/i18n/I18nContext';
import { useSupabase } from '@/hooks/useSupabase';
import { useToast } from '@/components/ui/Toast';
import { loadReverseOnboardingContext, ensureGeneratedReplyForReview } from '@/lib/reverse-onboarding';
import type { Reply, Review } from '@/types/database';
import { cn } from '@/lib/utils';
import { textMain, textSub } from '@/components/ui/glass';

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

const REVERSE_ONBOARDING_CACHE_KEY = 'opinia.reverse_onboarding.context';

export default function OnboardingFirstWinPage() {
  const t = useT();
  const router = useRouter();
  const supabase = useSupabase();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [bizId, setBizId] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [proposal, setProposal] = useState<Reply | null>(null);
  const [status, setStatus] = useState<'ok' | 'no_business' | 'no_review'>('ok');
  const [approving, setApproving] = useState(false);
  const [generating, setGenerating] = useState(false);

  const [successModalOpen, setSuccessModalOpen] = useState(false);
  const [successAssetUrl, setSuccessAssetUrl] = useState<string | null>(null);
  const [successAssetLoading, setSuccessAssetLoading] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    let preferredReviewId: string | null = null;

    try {
      const raw = sessionStorage.getItem(REVERSE_ONBOARDING_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { reviewId?: string | null };
        preferredReviewId = parsed.reviewId || null;
      }
    } catch {
      preferredReviewId = null;
    }

    const context = await loadReverseOnboardingContext({
      supabase,
      preferredReviewId,
      ensureGenerated: true,
    });

    if (context.status === 'unauthenticated') {
      router.replace('/onboarding/connect');
      return;
    }

    if (context.status === 'no_business') {
      setStatus('no_business');
      setBizId(null);
      setReview(null);
      setProposal(null);
      setLoading(false);
      return;
    }

    if (context.status === 'no_review' || !context.review) {
      setStatus('no_review');
      setBizId(context.bizId);
      setReview(null);
      setProposal(null);
      setLoading(false);
      return;
    }

    setStatus('ok');
    setBizId(context.bizId);
    setReview(context.review);
    setProposal(context.proposal);
    setLoading(false);
  }, [router, supabase]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleRegenerate = useCallback(async () => {
    if (!review) return;

    setGenerating(true);
    try {
      await ensureGeneratedReplyForReview({ review });
      await loadData();
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : t('onboardingReverse.firstWin.generateError');
      toast(message, 'error');
    } finally {
      setGenerating(false);
    }
  }, [loadData, review, t, toast]);

  const openSuccessModal = useCallback(async () => {
    if (!bizId) {
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
        headers: { 'x-biz-id': bizId },
      });
      const listPayload = (await listResponse.json().catch(() => ({}))) as ContentAssetListPayload;
      const latestAssetId = listPayload.items?.[0]?.id;
      if (!listResponse.ok || !latestAssetId) {
        setSuccessAssetLoading(false);
        return;
      }

      const signedUrlResponse = await fetch(`/api/content-studio/assets/${latestAssetId}/signed-url`, {
        headers: { 'x-biz-id': bizId },
      });
      const signedPayload = (await signedUrlResponse.json().catch(() => ({}))) as AssetSignedUrlPayload;
      if (signedUrlResponse.ok && typeof signedPayload.signedUrl === 'string') {
        setSuccessAssetUrl(signedPayload.signedUrl);
      }
    } catch {
      // no-op: modal still useful without preview
    } finally {
      setSuccessAssetLoading(false);
    }
  }, [bizId]);

  const handleApprove = useCallback(async () => {
    if (!review || !proposal?.content) return;
    setApproving(true);

    try {
      const response = await fetch(`/api/replies/${proposal.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ final_content: proposal.content }),
      });
      const payload = (await response.json().catch(() => ({}))) as ApproveResponsePayload;
      if (!response.ok || payload.error) {
        throw new Error(payload.message || t('onboardingReverse.firstWin.approveError'));
      }

      toast(t('dashboard.home.toasts.approveSuccess'), 'success');
      await openSuccessModal();
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : t('onboardingReverse.firstWin.approveError');
      toast(message, 'error');
    } finally {
      setApproving(false);
    }
  }, [openSuccessModal, proposal, review, t, toast]);

  return (
    <>
      <div className="min-h-screen">
        <header className="p-6 md:p-8">
          <Logo size="md" />
        </header>

        <main className="mx-auto w-full max-w-5xl px-4 pb-10">
          <div className="mx-auto max-w-3xl space-y-6">
            <header className="text-center">
              <h1 className={cn('font-display text-2xl font-semibold md:text-3xl', textMain)}>
                {t('onboardingReverse.firstWin.title')}
              </h1>
            </header>

            {loading ? (
              <GlassCard variant="strong" className="h-64 animate-pulse">
                <div className="h-full w-full" />
              </GlassCard>
            ) : status === 'no_business' ? (
              <GlassCard variant="strong" className="p-8 text-center">
                <p className={cn('text-base', textMain)}>{t('onboardingReverse.firstWin.noBusinessTitle')}</p>
                <p className={cn('mt-2 text-sm', textSub)}>{t('onboardingReverse.firstWin.noBusinessSubtitle')}</p>
                <Button className="mt-6" onClick={() => router.push('/dashboard/onboarding')}>
                  {t('onboardingReverse.firstWin.openOnboarding')}
                </Button>
              </GlassCard>
            ) : status === 'no_review' || !review ? (
              <GlassCard variant="strong" className="p-8 text-center">
                <p className={cn('text-base', textMain)}>{t('onboardingReverse.firstWin.noReviewTitle')}</p>
                <p className={cn('mt-2 text-sm', textSub)}>{t('onboardingReverse.firstWin.noReviewSubtitle')}</p>
                <Button variant="secondary" className="mt-6" onClick={() => router.push('/dashboard')}>
                  {t('onboardingReverse.firstWin.goDashboard')}
                </Button>
              </GlassCard>
            ) : (
              <ActionReviewCard
                review={review}
                proposalText={proposal?.content?.trim() || t('dashboard.home.proposalMissing')}
                approving={approving}
                generating={generating}
                onRedo={() => void handleRegenerate()}
                onApprove={() => void handleApprove()}
                primaryLabel={t('onboardingReverse.firstWin.approveCta')}
                className="md:p-6"
                testId="onboarding-first-win-card"
              />
            )}
          </div>
        </main>
      </div>

      <PublishSuccessModal
        open={successModalOpen}
        title={t('onboardingReverse.success.title')}
        subtitle={t('onboardingReverse.success.subtitle')}
        noAssetText={t('onboardingReverse.success.noAsset')}
        dismissLabel={t('onboardingReverse.success.dismiss')}
        downloadLabel={t('onboardingReverse.success.download')}
        primaryLabel={t('onboardingReverse.success.goInbox')}
        assetUrl={successAssetUrl}
        assetLoading={successAssetLoading}
        onDismiss={() => setSuccessModalOpen(false)}
        onDownload={() => {
          if (!successAssetUrl) return;
          window.open(successAssetUrl, '_blank', 'noopener,noreferrer');
        }}
        onPrimary={() => {
          setSuccessModalOpen(false);
          router.push('/dashboard');
        }}
      />
    </>
  );
}
