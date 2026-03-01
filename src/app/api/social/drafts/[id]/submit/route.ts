export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { createAdminClient } from '@/lib/supabase/admin';
import { validateParams } from '@/lib/validations';
import { loadSocialDraftContext, withStandardHeaders } from '@/app/api/social/drafts/_shared';

const ParamsSchema = z.object({
  id: z.string().uuid(),
});

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'POST /api/social/drafts/[id]/submit' });

  try {
    const [routeParams, paramsErr] = validateParams(params, ParamsSchema);
    if (paramsErr) return withStandardHeaders(paramsErr, requestId);

    const ctx = await loadSocialDraftContext({
      requestId,
      draftId: routeParams.id,
      route: 'POST /api/social/drafts/[id]/submit',
    });

    if (ctx.response || !ctx.draft || !ctx.userId || !ctx.role) {
      return ctx.response as NextResponse;
    }

    const isStaffOwner = ctx.role === 'staff' && ctx.draft.created_by === ctx.userId;
    const canSubmit = isStaffOwner && (ctx.draft.status === 'draft' || ctx.draft.status === 'rejected');

    if (!canSubmit) {
      return withStandardHeaders(
        NextResponse.json(
          { error: 'forbidden', message: 'No tens permisos per enviar a revisió', request_id: requestId },
          { status: 403 },
        ),
        requestId,
      );
    }

    const nowIso = new Date().toISOString();
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('social_drafts')
      .update({
        status: 'pending',
        reviewed_by: null,
        review_note: null,
        updated_at: nowIso,
      })
      .eq('id', ctx.draft.id)
      .select('id, org_id, biz_id, source, recommendation_id, thread_id, status, channel, format, title, copy_short, copy_long, hashtags, steps, assets_needed, created_by, reviewed_by, review_note, created_at, updated_at')
      .single();

    if (error || !data) {
      log.error('social_draft_submit_failed', {
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
    log.error('social_draft_submit_unhandled', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withStandardHeaders(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}
