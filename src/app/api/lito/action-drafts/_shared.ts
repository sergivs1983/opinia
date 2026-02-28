import { NextResponse } from 'next/server';

import { createLogger } from '@/lib/logger';
import { getLitoBizAccess, type LitoActionDraftRow } from '@/lib/lito/action-drafts';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';

type SharedContext = {
  response?: NextResponse;
  userId?: string;
  role?: 'owner' | 'manager' | 'staff' | null;
  draft?: LitoActionDraftRow;
};

export function withStandardHeaders(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('x-request-id', requestId);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export async function loadDraftContext(params: {
  requestId: string;
  draftId: string;
  route: string;
}): Promise<SharedContext> {
  const log = createLogger({ request_id: params.requestId, route: params.route });
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      response: withStandardHeaders(
        NextResponse.json({ error: 'unauthorized', message: 'Auth required', request_id: params.requestId }, { status: 401 }),
        params.requestId,
      ),
    };
  }

  const admin = createAdminClient();
  const { data: draftData, error: draftErr } = await admin
    .from('lito_action_drafts')
    .select('id, org_id, biz_id, thread_id, source_voice_clip_id, kind, status, payload, created_by, reviewed_by, created_at, updated_at')
    .eq('id', params.draftId)
    .maybeSingle();

  if (draftErr || !draftData) {
    return {
      response: withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: params.requestId }, { status: 404 }),
        params.requestId,
      ),
    };
  }

  const draft = draftData as LitoActionDraftRow;
  const access = await getLitoBizAccess({
    supabase,
    userId: user.id,
    bizId: draft.biz_id,
  });
  if (!access.allowed || !access.role || access.orgId !== draft.org_id) {
    return {
      response: withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: params.requestId }, { status: 404 }),
        params.requestId,
      ),
    };
  }

  log.info('lito_action_draft_context_loaded', {
    draft_id: draft.id,
    biz_id: draft.biz_id,
    role: access.role,
  });

  return {
    userId: user.id,
    role: access.role,
    draft,
  };
}
