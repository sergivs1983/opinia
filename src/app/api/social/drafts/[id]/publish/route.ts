export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { validateBody, validateParams } from '@/lib/validations';
import { loadSocialDraftContext, runOptimisticTransition, withStandardHeaders } from '@/app/api/social/drafts/_shared';

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
  const log = createLogger({ request_id: requestId, route: 'POST /api/social/drafts/[id]/publish' });

  try {
    const [routeParams, paramsErr] = validateParams(params, ParamsSchema);
    if (paramsErr) return withStandardHeaders(paramsErr, requestId);

    const [body, bodyErr] = await validateBody(request, BodySchema);
    if (bodyErr) return withStandardHeaders(bodyErr, requestId);
    const payload = body as z.infer<typeof BodySchema>;

    const ctx = await loadSocialDraftContext({
      request,
      requestId,
      draftId: routeParams.id,
      route: 'POST /api/social/drafts/[id]/publish',
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

    const nowIso = new Date().toISOString();
    const transition = await runOptimisticTransition({
      draft: ctx.draft,
      expectedVersion: payload.version,
      expectedStatus: 'approved',
      toStatus: 'published',
      actorId: ctx.userId,
      eventType: 'published',
      update: {
        reviewed_by: ctx.userId,
        reviewed_at: nowIso,
        submitted_at: ctx.draft.submitted_at || nowIso,
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
    log.error('social_draft_publish_unhandled', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withStandardHeaders(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}
