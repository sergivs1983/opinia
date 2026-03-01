import { NextResponse } from 'next/server';

import { createLogger } from '@/lib/logger';
import { getLitoBizAccess, type LitoBizAccess } from '@/lib/lito/action-drafts';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export type SocialDraftStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'published';

export type SocialDraftRow = {
  id: string;
  org_id: string;
  biz_id: string;
  source: 'lito' | 'voice' | 'manual';
  recommendation_id: string | null;
  thread_id: string | null;
  status: SocialDraftStatus;
  channel: 'instagram' | 'tiktok' | 'facebook';
  format: 'post' | 'story' | 'reel';
  title: string | null;
  copy_short: string | null;
  copy_long: string | null;
  hashtags: string[] | null;
  steps: unknown;
  assets_needed: string[] | null;
  created_by: string;
  reviewed_by: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
};

export type SocialDraftContext = {
  response?: NextResponse;
  userId?: string;
  role?: LitoBizAccess['role'];
  access?: LitoBizAccess;
  draft?: SocialDraftRow;
};

export function withStandardHeaders(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('x-request-id', requestId);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export async function requireUser(requestId: string, route: string): Promise<{
  response?: NextResponse;
  userId?: string;
}> {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      response: withStandardHeaders(
        NextResponse.json({ error: 'unauthorized', message: 'Auth required', request_id: requestId }, { status: 401 }),
        requestId,
      ),
    };
  }

  createLogger({ request_id: requestId, route }).info('social_draft_auth_ok', { user_id: user.id });

  return { userId: user.id };
}

export async function loadSocialDraftContext(params: {
  requestId: string;
  draftId: string;
  route: string;
}): Promise<SocialDraftContext> {
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
    .from('social_drafts')
    .select('id, org_id, biz_id, source, recommendation_id, thread_id, status, channel, format, title, copy_short, copy_long, hashtags, steps, assets_needed, created_by, reviewed_by, review_note, created_at, updated_at')
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

  const draft = draftData as SocialDraftRow;
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

  log.info('social_draft_context_loaded', {
    draft_id: draft.id,
    biz_id: draft.biz_id,
    role: access.role,
  });

  return {
    userId: user.id,
    role: access.role,
    access,
    draft,
  };
}
