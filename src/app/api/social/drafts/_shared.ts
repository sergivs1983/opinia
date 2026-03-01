import { NextResponse } from 'next/server';

import { createLogger } from '@/lib/logger';
import { getLitoBizAccess, type LitoBizAccess } from '@/lib/lito/action-drafts';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export type SocialDraftStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'published';
export type SocialDraftEventType = 'submitted' | 'approved' | 'rejected' | 'published';

export const SOCIAL_DRAFT_SELECT = [
  'id',
  'org_id',
  'biz_id',
  'source',
  'recommendation_id',
  'thread_id',
  'status',
  'channel',
  'format',
  'title',
  'copy_short',
  'copy_long',
  'hashtags',
  'steps',
  'assets_needed',
  'created_by',
  'reviewed_by',
  'review_note',
  'rejection_note',
  'version',
  'submitted_at',
  'reviewed_at',
  'created_at',
  'updated_at',
].join(', ');

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
  rejection_note: string | null;
  version: number;
  submitted_at: string | null;
  reviewed_at: string | null;
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

export type TransitionConflict =
  | {
    ok: false;
    kind: 'version_conflict';
    draft: SocialDraftRow;
  }
  | {
    ok: false;
    kind: 'invalid_transition';
    draft: SocialDraftRow;
  };

export type TransitionSuccess = {
  ok: true;
  draft: SocialDraftRow;
  idempotent: boolean;
};

export type TransitionResult = TransitionSuccess | TransitionConflict;

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
    .select(SOCIAL_DRAFT_SELECT)
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

  const draft = draftData as unknown as SocialDraftRow;
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

export async function writeSocialDraftEvent(params: {
  draftId: string;
  fromStatus: SocialDraftStatus;
  toStatus: SocialDraftStatus;
  actorId: string;
  eventType: SocialDraftEventType;
  note?: string | null;
  payload?: Record<string, unknown> | null;
}): Promise<void> {
  const admin = createAdminClient();
  await admin.from('social_draft_events').insert({
    draft_id: params.draftId,
    from_status: params.fromStatus,
    to_status: params.toStatus,
    actor_id: params.actorId,
    event_type: params.eventType,
    note: params.note || null,
    payload: params.payload || null,
  });
}

export async function runOptimisticTransition(params: {
  draft: SocialDraftRow;
  expectedVersion: number;
  expectedStatus: SocialDraftStatus;
  toStatus: SocialDraftStatus;
  update: Record<string, unknown>;
  actorId: string;
  eventType: SocialDraftEventType;
  eventNote?: string | null;
  eventPayload?: Record<string, unknown> | null;
}): Promise<TransitionResult> {
  const admin = createAdminClient();
  const nextVersion = params.draft.version + 1;
  const nowIso = new Date().toISOString();

  const { data, error } = await admin
    .from('social_drafts')
    .update({
      ...params.update,
      status: params.toStatus,
      version: nextVersion,
      updated_at: nowIso,
    })
    .eq('id', params.draft.id)
    .eq('version', params.expectedVersion)
    .eq('status', params.expectedStatus)
    .select(SOCIAL_DRAFT_SELECT)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || 'transition_failed');
  }

  if (data) {
    await writeSocialDraftEvent({
      draftId: params.draft.id,
      fromStatus: params.expectedStatus,
      toStatus: params.toStatus,
      actorId: params.actorId,
      eventType: params.eventType,
      note: params.eventNote,
      payload: params.eventPayload,
    });
    return { ok: true, draft: data as unknown as SocialDraftRow, idempotent: false };
  }

  const { data: currentData, error: currentErr } = await admin
    .from('social_drafts')
    .select(SOCIAL_DRAFT_SELECT)
    .eq('id', params.draft.id)
    .maybeSingle();

  if (currentErr || !currentData) {
    throw new Error(currentErr?.message || 'draft_missing_after_transition');
  }

  const current = currentData as unknown as SocialDraftRow;
  if (current.status === params.toStatus) {
    if (current.version !== params.expectedVersion) {
      return { ok: false, kind: 'version_conflict', draft: current };
    }
    return { ok: true, draft: current, idempotent: true };
  }
  if (current.version !== params.expectedVersion) {
    return { ok: false, kind: 'version_conflict', draft: current };
  }
  if (current.status !== params.expectedStatus) {
    return { ok: false, kind: 'invalid_transition', draft: current };
  }

  return { ok: false, kind: 'invalid_transition', draft: current };
}
