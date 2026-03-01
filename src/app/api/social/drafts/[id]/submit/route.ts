export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { runOptimisticTransition } from '@/app/api/social/drafts/_shared';
import { validateParams } from '@/lib/validations';
import { loadSocialDraftContext, withStandardHeaders } from '@/app/api/social/drafts/_shared';

const ParamsSchema = z.object({
  id: z.string().uuid(),
});

const BodySchema = z.object({
  version: z.number().int().min(1),
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
    const jsonBody = await request.json().catch(() => ({}));
    const parseBody = BodySchema.safeParse(jsonBody);
    if (!parseBody.success) {
      return withStandardHeaders(
        NextResponse.json(
          { error: 'bad_request', message: 'Body invàlid', request_id: requestId },
          { status: 400 },
        ),
        requestId,
      );
    }
    const payload = parseBody.data;

    const ctx = await loadSocialDraftContext({
      requestId,
      draftId: routeParams.id,
      route: 'POST /api/social/drafts/[id]/submit',
    });

    if (ctx.response || !ctx.draft || !ctx.userId || !ctx.role) {
      return ctx.response as NextResponse;
    }

    const isStaffOwner = ctx.role === 'staff' && ctx.draft.created_by === ctx.userId;
    if (!isStaffOwner) {
      return withStandardHeaders(
        NextResponse.json(
          { error: 'forbidden', message: 'No tens permisos per enviar a revisió', request_id: requestId },
          { status: 403 },
        ),
        requestId,
      );
    }

    if (ctx.draft.status === 'pending') {
      return withStandardHeaders(
        NextResponse.json({
          ok: true,
          status: ctx.draft.status,
          draft: ctx.draft,
          request_id: requestId,
          idempotent: true,
        }),
        requestId,
      );
    }

    if (ctx.draft.status !== 'draft' && ctx.draft.status !== 'rejected') {
      return withStandardHeaders(
        NextResponse.json(
          {
            error: 'invalid_transition',
            message: 'Transició d’estat no permesa.',
            request_id: requestId,
            current_version: ctx.draft.version,
            current_status: ctx.draft.status,
          },
          { status: 422 },
        ),
        requestId,
      );
    }

    const nowIso = new Date().toISOString();
    const expectedStatus = ctx.draft.status === 'rejected' ? 'rejected' : 'draft';
    const transition = await runOptimisticTransition({
      draft: ctx.draft,
      expectedVersion: payload.version,
      expectedStatus,
      toStatus: 'pending',
      actorId: ctx.userId,
      eventType: 'submitted',
      update: {
        submitted_at: nowIso,
        reviewed_at: null,
        reviewed_by: null,
        review_note: null,
        rejection_note: null,
      },
    });

    if (!transition.ok) {
      if (transition.kind === 'version_conflict') {
        return withStandardHeaders(
          NextResponse.json(
            {
              error: 'version_conflict',
              message: 'El draft ha canviat. Refresca i torna-ho a provar.',
              request_id: requestId,
              current_version: transition.draft.version,
              current_status: transition.draft.status,
            },
            { status: 409 },
          ),
          requestId,
        );
      }
      return withStandardHeaders(
        NextResponse.json(
          {
            error: 'invalid_transition',
            message: 'Transició d’estat no permesa.',
            request_id: requestId,
            current_version: transition.draft.version,
            current_status: transition.draft.status,
          },
          { status: 422 },
        ),
        requestId,
      );
    }

    return withStandardHeaders(
      NextResponse.json({
        ok: true,
        status: transition.draft.status,
        draft: transition.draft,
        request_id: requestId,
        idempotent: transition.idempotent,
      }),
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
