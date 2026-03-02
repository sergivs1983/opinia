export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { createHash } from 'crypto';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getLitoBizAccess } from '@/lib/lito/action-drafts';
import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { validateBody } from '@/lib/validations';

const BodySchema = z.object({
  biz_id: z.string().uuid(),
  review_id: z.string().uuid(),
  response_text: z.string().trim().min(1).max(3000),
});

type GbpReviewRow = {
  id: string;
  gbp_review_id: string;
  star_rating: number;
  comment_preview: string;
  create_time: string;
};

function withNoStore(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('x-request-id', requestId);
  return response;
}

function normalizeDraftText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ca');
}

function buildDraftFingerprint(input: {
  bizId: string;
  gbpReviewId: string;
  normalizedText: string;
}): string {
  return createHash('sha256')
    .update(`${input.bizId}:${input.gbpReviewId}:${input.normalizedText}`)
    .digest('hex');
}

export async function POST(request: Request) {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'POST /api/lito/reviews/drafts' });

  try {
    const supabase = createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return withNoStore(
        NextResponse.json({ error: 'unauthorized', message: 'Auth required', request_id: requestId }, { status: 401 }),
        requestId,
      );
    }

    const [body, bodyErr] = await validateBody(request, BodySchema);
    if (bodyErr) return withNoStore(bodyErr, requestId);
    const payload = body as z.infer<typeof BodySchema>;

    const access = await getLitoBizAccess({
      supabase,
      userId: user.id,
      bizId: payload.biz_id,
    });
    if (!access.allowed || !access.orgId || !access.role) {
      return withNoStore(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    if (access.role !== 'owner' && access.role !== 'manager') {
      return withNoStore(
        NextResponse.json({ error: 'forbidden', message: 'Cal owner o manager', request_id: requestId }, { status: 403 }),
        requestId,
      );
    }

    const admin = createAdminClient();
    const { data: reviewData, error: reviewError } = await admin
      .from('gbp_reviews')
      .select('id, gbp_review_id, star_rating, comment_preview, create_time')
      .eq('id', payload.review_id)
      .eq('biz_id', payload.biz_id)
      .maybeSingle();

    if (reviewError || !reviewData) {
      return withNoStore(
        NextResponse.json({ error: 'not_found', message: 'Ressenya no trobada', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }
    const review = reviewData as GbpReviewRow;
    const normalizedText = normalizeDraftText(payload.response_text);
    const fingerprint = buildDraftFingerprint({
      bizId: payload.biz_id,
      gbpReviewId: review.gbp_review_id,
      normalizedText,
    });

    const { data: existingDraftData, error: existingDraftError } = await admin
      .from('lito_action_drafts')
      .select('id, org_id, biz_id, kind, status, payload, created_by, created_at, updated_at')
      .eq('org_id', access.orgId)
      .eq('biz_id', payload.biz_id)
      .eq('kind', 'gbp_update')
      .eq('idempotency_key', fingerprint)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingDraftError) {
      log.error('lito_review_draft_lookup_failed', {
        biz_id: payload.biz_id,
        review_id: payload.review_id,
        error_code: existingDraftError.code || null,
        error: existingDraftError.message || null,
      });
      return withNoStore(
        NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
        requestId,
      );
    }

    if (existingDraftData) {
      return withNoStore(
        NextResponse.json({ ok: true, reused: true, draft: existingDraftData, request_id: requestId }, { status: 200 }),
        requestId,
      );
    }

    const { data: inserted, error: insertError } = await admin
      .from('lito_action_drafts')
      .insert({
        org_id: access.orgId,
        biz_id: payload.biz_id,
        idempotency_key: fingerprint,
        kind: 'gbp_update',
        status: 'draft',
        payload: {
          source: 'gbp_reviews',
          review_id: review.id,
          gbp_review_id: review.gbp_review_id,
          star_rating: review.star_rating,
          comment_preview: review.comment_preview,
          review_create_time: review.create_time,
          dedupe_fingerprint: fingerprint,
          suggested_reply: payload.response_text,
        },
        created_by: user.id,
      })
      .select('id, org_id, biz_id, kind, status, payload, created_by, created_at, updated_at')
      .single();

    if (insertError || !inserted) {
      if (insertError?.code === '23505') {
        const { data: racedDraftData } = await admin
          .from('lito_action_drafts')
          .select('id, org_id, biz_id, kind, status, payload, created_by, created_at, updated_at')
          .eq('org_id', access.orgId)
          .eq('biz_id', payload.biz_id)
          .eq('kind', 'gbp_update')
          .eq('idempotency_key', fingerprint)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (racedDraftData) {
          return withNoStore(
            NextResponse.json({ ok: true, reused: true, draft: racedDraftData, request_id: requestId }, { status: 200 }),
            requestId,
          );
        }
      }

      log.error('lito_review_draft_insert_failed', {
        biz_id: payload.biz_id,
        review_id: payload.review_id,
        error_code: insertError?.code || null,
        error: insertError?.message || null,
      });
      return withNoStore(
        NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
        requestId,
      );
    }

    return withNoStore(
      NextResponse.json({ ok: true, draft: inserted, request_id: requestId }, { status: 201 }),
      requestId,
    );
  } catch (error) {
    log.error('lito_review_draft_unhandled', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withNoStore(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}
