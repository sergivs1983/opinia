export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireResourceAccessPatternB, ResourceTable } from '@/lib/api-handler';
import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { validateParams } from '@/lib/validations';

const ParamsSchema = z.object({
  id: z.string().uuid(),
});

type VoiceDraftRow = {
  id: string;
  org_id: string;
  biz_id: string;
  created_by: string;
};

function withStandardHeaders(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('x-request-id', requestId);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } },
) {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'DELETE /api/lito/voice/drafts/[id]' });

  try {
    const [routeParams, paramsErr] = validateParams(params, ParamsSchema);
    if (paramsErr) return withStandardHeaders(paramsErr, requestId);

    const supabase = createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return withStandardHeaders(
        NextResponse.json({ error: 'unauthorized', message: 'Auth required', request_id: requestId }, { status: 401 }),
        requestId,
      );
    }

    const gate = await requireResourceAccessPatternB(request, routeParams.id, ResourceTable.Drafts, {
      supabase,
      user,
    });
    if (gate instanceof NextResponse) return withStandardHeaders(gate, requestId);

    const admin = createAdminClient();
    const { data: draftData, error: draftErr } = await admin
      .from('lito_action_drafts')
      .select('id, org_id, biz_id, created_by')
      .eq('id', routeParams.id)
      .eq('biz_id', gate.bizId)
      .maybeSingle();

    if (draftErr) {
      log.error('lito_voice_draft_delete_lookup_failed', {
        draft_id: routeParams.id,
        error_code: draftErr.code || null,
        error: draftErr.message || null,
      });
      return withStandardHeaders(
        NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
        requestId,
      );
    }

    if (!draftData) {
      return withStandardHeaders(
        NextResponse.json({ ok: true, deleted: false, request_id: requestId }),
        requestId,
      );
    }

    const draft = draftData as VoiceDraftRow;
    if (gate.membership.orgId !== draft.org_id) {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    const canDelete = gate.role === 'owner'
      || gate.role === 'manager'
      || draft.created_by === user.id;
    if (!canDelete) {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    const { error: deleteErr } = await admin
      .from('lito_action_drafts')
      .delete()
      .eq('id', draft.id);

    if (deleteErr) {
      log.error('lito_voice_draft_delete_failed', {
        draft_id: draft.id,
        error_code: deleteErr.code || null,
        error: deleteErr.message || null,
      });
      return withStandardHeaders(
        NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
        requestId,
      );
    }

    return withStandardHeaders(
      NextResponse.json({ ok: true, deleted: true, request_id: requestId }),
      requestId,
    );
  } catch (error) {
    log.error('lito_voice_draft_delete_unhandled', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withStandardHeaders(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}
