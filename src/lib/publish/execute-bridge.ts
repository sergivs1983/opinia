import type { SupabaseClient } from '@supabase/supabase-js';

import type { LitoActionDraftRow } from '@/lib/lito/action-drafts';
import { normalizeReplyContent, parseReplyStatus } from '@/lib/publish/domain';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asUuid(value: unknown): string | null {
  const normalized = asString(value);
  if (!normalized) return null;
  return UUID_RE.test(normalized) ? normalized : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function parseTone(value: unknown): 'proper' | 'professional' | 'premium' {
  if (value === 'proper' || value === 'professional' || value === 'premium') return value;
  return 'proper';
}

type ReviewLookupRow = {
  id: string;
};

type ReplyLookupRow = {
  id: string;
  review_id: string | null;
  updated_at: string;
  status: string | null;
};

export type GbpDraftBridgeResult = {
  reviewId: string;
  replyId: string;
  replyUpdatedAt: string;
  createdReview: boolean;
  createdReply: boolean;
};

async function resolveReviewId(input: {
  admin: SupabaseClient;
  draft: LitoActionDraftRow;
  payload: Record<string, unknown>;
  nowIso: string;
}): Promise<{ reviewId: string; createdReview: boolean }> {
  const { admin, draft, payload, nowIso } = input;

  const explicitReviewId = asUuid(payload.review_id);
  if (explicitReviewId) {
    const { data: byId } = await admin
      .from('reviews')
      .select('id')
      .eq('id', explicitReviewId)
      .eq('biz_id', draft.biz_id)
      .maybeSingle();

    if (byId) {
      return {
        reviewId: (byId as ReviewLookupRow).id,
        createdReview: false,
      };
    }
  }

  const providerReviewId = asString(payload.gbp_review_id)
    || asString(payload.provider_review_id);

  if (!providerReviewId) {
    throw new Error('gbp_review_id_missing');
  }

  const { data: existingByExternal } = await admin
    .from('reviews')
    .select('id')
    .eq('biz_id', draft.biz_id)
    .eq('source', 'google')
    .eq('external_id', providerReviewId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingByExternal) {
    return {
      reviewId: (existingByExternal as ReviewLookupRow).id,
      createdReview: false,
    };
  }

  const reviewText = asString(payload.comment_preview) || '';
  const ratingRaw = asNumber(payload.star_rating);
  const rating = ratingRaw ? Math.max(1, Math.min(5, Math.round(ratingRaw))) : 5;

  const { data: created, error: createError } = await admin
    .from('reviews')
    .insert({
      org_id: draft.org_id,
      biz_id: draft.biz_id,
      source: 'google',
      external_id: providerReviewId,
      review_text: reviewText,
      rating,
      sentiment: 'neutral',
      language_detected: 'ca',
      is_replied: false,
      needs_attention: false,
      metadata: {
        source: 'lito_action_drafts.execute',
        draft_id: draft.id,
      },
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select('id')
    .single();

  if (createError || !created) {
    throw new Error(createError?.message || 'review_create_failed');
  }

  return {
    reviewId: (created as ReviewLookupRow).id,
    createdReview: true,
  };
}

export async function upsertGbpReplyFromDraft(input: {
  admin: SupabaseClient;
  draft: LitoActionDraftRow;
  nowIso: string;
}): Promise<GbpDraftBridgeResult> {
  const payload = asRecord(input.draft.payload);
  const suggestedReply = normalizeReplyContent(
    payload.suggested_reply
      ?? payload.reply
      ?? payload.response_text,
  );

  if (!suggestedReply) {
    throw new Error('suggested_reply_missing');
  }

  const { reviewId, createdReview } = await resolveReviewId({
    admin: input.admin,
    draft: input.draft,
    payload,
    nowIso: input.nowIso,
  });

  const existingReplyIdFromExecution = asUuid(asRecord(payload.execution).reply_id);
  if (existingReplyIdFromExecution) {
    const { data: existingByExecution } = await input.admin
      .from('replies')
      .select('id, review_id, updated_at, status')
      .eq('id', existingReplyIdFromExecution)
      .eq('biz_id', input.draft.biz_id)
      .maybeSingle();

    if (existingByExecution) {
      const row = existingByExecution as ReplyLookupRow;
      return {
        reviewId: row.review_id || reviewId,
        replyId: row.id,
        replyUpdatedAt: row.updated_at,
        createdReview,
        createdReply: false,
      };
    }
  }

  const { data: existingReply } = await input.admin
    .from('replies')
    .select('id, review_id, updated_at, status')
    .eq('biz_id', input.draft.biz_id)
    .eq('review_id', reviewId)
    .eq('content', suggestedReply)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingReply) {
    const row = existingReply as ReplyLookupRow;
    const parsedStatus = parseReplyStatus(row.status);
    if (parsedStatus === 'draft' || parsedStatus === 'selected' || parsedStatus === 'published') {
      return {
        reviewId: row.review_id || reviewId,
        replyId: row.id,
        replyUpdatedAt: row.updated_at,
        createdReview,
        createdReply: false,
      };
    }
  }

  const { data: insertedReply, error: insertReplyError } = await input.admin
    .from('replies')
    .insert({
      review_id: reviewId,
      org_id: input.draft.org_id,
      biz_id: input.draft.biz_id,
      tone: parseTone(payload.tone),
      content: suggestedReply,
      status: 'selected',
      is_edited: true,
      created_at: input.nowIso,
      updated_at: input.nowIso,
    })
    .select('id, review_id, updated_at, status')
    .single();

  if (insertReplyError || !insertedReply) {
    throw new Error(insertReplyError?.message || 'reply_create_failed');
  }

  const row = insertedReply as ReplyLookupRow;

  return {
    reviewId: row.review_id || reviewId,
    replyId: row.id,
    replyUpdatedAt: row.updated_at,
    createdReview,
    createdReply: true,
  };
}
