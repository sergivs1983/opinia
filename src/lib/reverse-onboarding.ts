'use client';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Reply, Review } from '@/types/database';
import { getStoredActiveOrgId, resolveActiveMembership, type MembershipSelectorRow } from '@/lib/workspace/active-org';

export type ReverseOnboardingStatus =
  | 'ok'
  | 'unauthenticated'
  | 'no_workspace'
  | 'no_business'
  | 'no_review';

export type ReverseOnboardingContext = {
  status: ReverseOnboardingStatus;
  bizId: string | null;
  orgId: string | null;
  review: Review | null;
  proposal: Reply | null;
};

function pickFirstReplyProposal(rows: Reply[]): Reply | null {
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

function pickBestReview(reviews: Review[], preferredReviewId?: string | null): Review | null {
  if (!reviews.length) return null;
  if (preferredReviewId) {
    const preferred = reviews.find((review) => review.id === preferredReviewId);
    if (preferred) return preferred;
  }
  return reviews.find((review) => review.rating >= 4) || reviews[0] || null;
}

async function resolveWorkspace(
  supabase: SupabaseClient,
): Promise<{ bizId: string | null; orgId: string | null; userId: string | null }> {
  const { data: authData } = await supabase.auth.getUser();
  const userId = authData.user?.id || null;
  if (!userId) return { userId: null, bizId: null, orgId: null };

  let { data: memberships } = await supabase
    .from('memberships')
    .select('id, org_id, is_default, created_at, accepted_at')
    .eq('user_id', userId)
    .not('accepted_at', 'is', null)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(20);

  if (!memberships || memberships.length === 0) {
    try {
      await fetch('/api/bootstrap', { method: 'POST' });
      const retry = await supabase
        .from('memberships')
        .select('id, org_id, is_default, created_at, accepted_at')
        .eq('user_id', userId)
        .not('accepted_at', 'is', null)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(20);
      memberships = retry.data || [];
    } catch {
      memberships = [];
    }
  }

  if (!memberships || memberships.length === 0) {
    return { userId, bizId: null, orgId: null };
  }

  const activeMembership = resolveActiveMembership(
    (memberships || []) as MembershipSelectorRow[],
    getStoredActiveOrgId(),
  );
  const orgId = activeMembership?.org_id || null;
  if (!orgId) return { userId, bizId: null, orgId: null };

  const { data: businesses } = await supabase
    .from('businesses')
    .select('*')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .order('name', { ascending: true })
    .limit(5);

  const bizId = businesses?.[0]?.id || null;
  return { userId, orgId, bizId };
}

export async function ensureGeneratedReplyForReview(args: {
  review: Review;
}): Promise<void> {
  await fetch(`/api/reviews/${args.review.id}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: args.review.source,
      rating: args.review.rating,
      language: args.review.language_detected,
      regenerate: false,
    }),
  });
}

export async function loadReverseOnboardingContext(args: {
  supabase: SupabaseClient;
  preferredReviewId?: string | null;
  ensureGenerated?: boolean;
}): Promise<ReverseOnboardingContext> {
  const { supabase, preferredReviewId, ensureGenerated = false } = args;

  const { userId, orgId, bizId } = await resolveWorkspace(supabase);
  if (!userId) {
    return { status: 'unauthenticated', bizId: null, orgId: null, review: null, proposal: null };
  }
  if (!orgId) {
    return { status: 'no_workspace', bizId: null, orgId: null, review: null, proposal: null };
  }
  if (!bizId) {
    return { status: 'no_business', bizId: null, orgId, review: null, proposal: null };
  }

  const { data: reviewsData } = await supabase
    .from('reviews')
    .select('*')
    .eq('biz_id', bizId)
    .eq('is_replied', false)
    .order('created_at', { ascending: false })
    .limit(30);

  const reviews = (reviewsData || []) as Review[];
  const selectedReview = pickBestReview(reviews, preferredReviewId);
  if (!selectedReview) {
    return { status: 'no_review', bizId, orgId, review: null, proposal: null };
  }

  const loadReplies = async () => {
    const { data: repliesData } = await supabase
      .from('replies')
      .select('*')
      .eq('review_id', selectedReview.id)
      .order('created_at', { ascending: false })
      .limit(10);
    return (repliesData || []) as Reply[];
  };

  let replies = await loadReplies();
  let proposal = pickFirstReplyProposal(replies);

  if (!proposal && ensureGenerated) {
    await ensureGeneratedReplyForReview({ review: selectedReview });
    replies = await loadReplies();
    proposal = pickFirstReplyProposal(replies);
  }

  return {
    status: 'ok',
    bizId,
    orgId,
    review: selectedReview,
    proposal,
  };
}
