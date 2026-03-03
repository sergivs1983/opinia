export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { createAdminClient } from '@/lib/supabase/admin';
import { validateBody, validateParams } from '@/lib/validations';
import { loadDraftContext, withStandardHeaders } from '@/app/api/lito/action-drafts/_shared';

const ParamsSchema = z.object({
  id: z.string().uuid(),
});

const BodySchema = z.object({
  payload: z.record(z.unknown()),
});

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'PATCH /api/lito/action-drafts/[id]' });

  try {
    const [routeParams, paramsErr] = validateParams(params, ParamsSchema);
    if (paramsErr) return withStandardHeaders(paramsErr, requestId);
    const [body, bodyErr] = await validateBody(request, BodySchema);
    if (bodyErr) return withStandardHeaders(bodyErr, requestId);
    const payload = body as z.infer<typeof BodySchema>;

    const ctx = await loadDraftContext({
      request,
      requestId,
      draftId: routeParams.id,
      route: 'PATCH /api/lito/action-drafts/[id]',
    });
    if (ctx.response || !ctx.draft || !ctx.userId || !ctx.role) {
      return ctx.response as NextResponse;
    }

    const isManager = ctx.role === 'owner' || ctx.role === 'manager';
    const isStaffOwnDraft = ctx.role === 'staff' && ctx.draft.created_by === ctx.userId && ctx.draft.status === 'draft';
    if (!isManager && !isStaffOwnDraft) {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    if ((ctx.draft.status === 'executed' || ctx.draft.status === 'rejected') && !isManager) {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    const admin = createAdminClient();
    const nowIso = new Date().toISOString();
    const { data, error } = await admin
      .from('lito_action_drafts')
      .update({
        payload: payload.payload,
        updated_at: nowIso,
      })
      .eq('id', ctx.draft.id)
      .select('id, org_id, biz_id, thread_id, source_voice_clip_id, kind, status, payload, created_by, reviewed_by, created_at, updated_at')
      .single();

    if (error || !data) {
      log.error('lito_action_draft_patch_failed', {
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
      NextResponse.json({
        ok: true,
        draft: data,
        request_id: requestId,
      }),
      requestId,
    );
  } catch (error) {
    log.error('lito_action_draft_patch_unhandled', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withStandardHeaders(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}
