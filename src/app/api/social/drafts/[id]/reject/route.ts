export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { createAdminClient } from '@/lib/supabase/admin';
import { validateBody, validateParams } from '@/lib/validations';
import { loadSocialDraftContext, withStandardHeaders } from '@/app/api/social/drafts/_shared';

const ParamsSchema = z.object({
  id: z.string().uuid(),
});

const BodySchema = z.object({
  note: z.string().trim().min(1).max(500).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'POST /api/social/drafts/[id]/reject' });

  try {
    const [routeParams, paramsErr] = validateParams(params, ParamsSchema);
    if (paramsErr) return withStandardHeaders(paramsErr, requestId);

    const [body, bodyErr] = await validateBody(request, BodySchema);
    if (bodyErr) return withStandardHeaders(bodyErr, requestId);
    const payload = body as z.infer<typeof BodySchema>;

    const ctx = await loadSocialDraftContext({
      requestId,
      draftId: routeParams.id,
      route: 'POST /api/social/drafts/[id]/reject',
    });

    if (ctx.response || !ctx.draft || !ctx.userId || !ctx.role) {
      return ctx.response as NextResponse;
    }

    if (ctx.role !== 'owner' && ctx.role !== 'manager') {
      return withStandardHeaders(
        NextResponse.json({ error: 'forbidden', message: 'Cal owner o manager', request_id: requestId }, { status: 403 }),
        requestId,
      );
    }

    if (ctx.draft.status !== 'pending') {
      return withStandardHeaders(
        NextResponse.json(
          { error: 'invalid_state', message: 'Només es poden rebutjar drafts pendents', request_id: requestId },
          { status: 409 },
        ),
        requestId,
      );
    }

    const nowIso = new Date().toISOString();
    const admin = createAdminClient();

    const { data, error } = await admin
      .from('social_drafts')
      .update({
        status: 'rejected',
        reviewed_by: ctx.userId,
        review_note: payload.note || null,
        updated_at: nowIso,
      })
      .eq('id', ctx.draft.id)
      .select('id, org_id, biz_id, source, recommendation_id, thread_id, status, channel, format, title, copy_short, copy_long, hashtags, steps, assets_needed, created_by, reviewed_by, review_note, created_at, updated_at')
      .single();

    if (error || !data) {
      log.error('social_draft_reject_failed', {
        error_code: error?.code || null,
        error: error?.message || null,
        draft_id: ctx.draft.id,
      });
      return withStandardHeaders(
        NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
        requestId,
      );
    }

    return withStandardHeaders(
      NextResponse.json({ ok: true, status: data.status, draft: data, request_id: requestId }),
      requestId,
    );
  } catch (error) {
    log.error('social_draft_reject_unhandled', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withStandardHeaders(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}
