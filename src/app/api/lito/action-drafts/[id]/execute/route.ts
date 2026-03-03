export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { upsertGbpReplyFromDraft } from '@/lib/publish/execute-bridge';
import { createAdminClient } from '@/lib/supabase/admin';
import { validateParams } from '@/lib/validations';
import { loadDraftContext, withStandardHeaders } from '@/app/api/lito/action-drafts/_shared';

const ParamsSchema = z.object({
  id: z.string().uuid(),
});

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'POST /api/lito/action-drafts/[id]/execute' });

  try {
    const [routeParams, paramsErr] = validateParams(params, ParamsSchema);
    if (paramsErr) return withStandardHeaders(paramsErr, requestId);

    const ctx = await loadDraftContext({
      request,
      requestId,
      draftId: routeParams.id,
      route: 'POST /api/lito/action-drafts/[id]/execute',
    });
    if (ctx.response || !ctx.draft || !ctx.userId || !ctx.role) {
      return ctx.response as NextResponse;
    }

    if (ctx.role !== 'owner' && ctx.role !== 'manager') {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    const admin = createAdminClient();
    const nowIso = new Date().toISOString();
    const payload = (ctx.draft.payload && typeof ctx.draft.payload === 'object'
      ? ctx.draft.payload
      : {}) as Record<string, unknown>;

    let bridgeResult: {
      reviewId: string;
      replyId: string;
      replyUpdatedAt: string;
      createdReview: boolean;
      createdReply: boolean;
    } | null = null;

    if (ctx.draft.kind === 'gbp_update') {
      try {
        bridgeResult = await upsertGbpReplyFromDraft({
          admin,
          draft: ctx.draft,
          nowIso,
        });
      } catch (bridgeError) {
        log.error('lito_action_draft_execute_bridge_failed', {
          draft_id: ctx.draft.id,
          error: bridgeError instanceof Error ? bridgeError.message : String(bridgeError),
        });
        return withStandardHeaders(
          NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
          requestId,
        );
      }
    }

    const nextPayload = {
      ...payload,
      execution: {
        executed_at: nowIso,
        mode: 'manual_mvp',
        review_id: bridgeResult?.reviewId ?? null,
        reply_id: bridgeResult?.replyId ?? null,
        reply_updated_at: bridgeResult?.replyUpdatedAt ?? null,
        created_review: bridgeResult?.createdReview ?? false,
        created_reply: bridgeResult?.createdReply ?? false,
      },
    };

    const { data, error } = await admin
      .from('lito_action_drafts')
      .update({
        status: 'executed',
        reviewed_by: ctx.userId,
        payload: nextPayload,
        updated_at: nowIso,
      })
      .eq('id', ctx.draft.id)
      .select('id, org_id, biz_id, thread_id, source_voice_clip_id, kind, status, payload, created_by, reviewed_by, created_at, updated_at')
      .single();

    if (error || !data) {
      log.error('lito_action_draft_execute_failed', {
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
    log.error('lito_action_draft_execute_unhandled', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withStandardHeaders(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}
