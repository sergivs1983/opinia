import { NextResponse } from 'next/server';

import { getLitoBizAccess, type LitoBizAccess } from '@/lib/lito/action-drafts';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { buildReminderQueueRows, type SocialScheduleStatus } from '@/lib/social/schedules';

export type ViewerRole = 'owner' | 'manager' | 'staff';

export type SocialScheduleRow = {
  id: string;
  org_id: string;
  biz_id: string;
  draft_id: string;
  assigned_user_id: string;
  platform: 'instagram' | 'tiktok';
  scheduled_at: string;
  status: SocialScheduleStatus;
  notified_at: string | null;
  published_at: string | null;
  snoozed_from: string | null;
  created_at: string;
  updated_at: string;
};

export type SocialDraftSnapshot = {
  id: string;
  org_id: string;
  biz_id: string;
  status: 'draft' | 'pending' | 'approved' | 'rejected' | 'published';
  title: string | null;
  copy_short: string | null;
  copy_long: string | null;
  hashtags: string[] | null;
  format: 'post' | 'story' | 'reel';
  channel: 'instagram' | 'tiktok' | 'facebook';
  assets_needed: string[] | null;
  steps: string[] | null;
};

export function withNoStore(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('x-request-id', requestId);
  return response;
}

export function unauthorized(requestId: string): NextResponse {
  return withNoStore(
    NextResponse.json({ error: 'unauthorized', message: 'Auth required', request_id: requestId }, { status: 401 }),
    requestId,
  );
}

export function notFound(requestId: string): NextResponse {
  return withNoStore(
    NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
    requestId,
  );
}

export function badRequest(requestId: string, message: string): NextResponse {
  return withNoStore(
    NextResponse.json({ error: 'bad_request', message, request_id: requestId }, { status: 400 }),
    requestId,
  );
}

export function conflict(requestId: string, reason: string, message: string): NextResponse {
  return withNoStore(
    NextResponse.json({ error: 'conflict', reason, message, request_id: requestId }, { status: 409 }),
    requestId,
  );
}

export async function requireUserAndBizAccess(args: {
  bizId: string;
  requestId: string;
}): Promise<
  | { ok: false; response: NextResponse }
  | {
    ok: true;
    userId: string;
    role: ViewerRole;
    orgId: string;
    access: LitoBizAccess;
  }
> {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, response: unauthorized(args.requestId) };
  }

  const access = await getLitoBizAccess({
    supabase,
    userId: user.id,
    bizId: args.bizId,
  });

  if (!access.allowed || !access.role || !access.orgId) {
    return { ok: false, response: notFound(args.requestId) };
  }

  return {
    ok: true,
    userId: user.id,
    role: access.role,
    orgId: access.orgId,
    access,
  };
}

export async function loadSocialDraftSnapshot(draftId: string): Promise<SocialDraftSnapshot | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('social_drafts')
    .select('id, org_id, biz_id, status, title, copy_short, copy_long, hashtags, format, channel, assets_needed, steps')
    .eq('id', draftId)
    .maybeSingle();

  if (error || !data) return null;
  return data as unknown as SocialDraftSnapshot;
}

export async function loadSchedule(scheduleId: string): Promise<SocialScheduleRow | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('social_schedules')
    .select('id, org_id, biz_id, draft_id, assigned_user_id, platform, scheduled_at, status, notified_at, published_at, snoozed_from, created_at, updated_at')
    .eq('id', scheduleId)
    .maybeSingle();

  if (error || !data) return null;
  return data as SocialScheduleRow;
}

export async function cancelPendingReminders(scheduleId: string): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from('social_reminders_queue')
    .update({ status: 'canceled' })
    .eq('schedule_id', scheduleId)
    .eq('status', 'pending');
}

export async function createReminderQueue(scheduleId: string, scheduledAtIso: string): Promise<void> {
  const admin = createAdminClient();
  const rows = buildReminderQueueRows(scheduleId, scheduledAtIso);
  await admin.from('social_reminders_queue').insert(rows);
}

export async function refreshReminderQueue(scheduleId: string, scheduledAtIso: string): Promise<void> {
  await cancelPendingReminders(scheduleId);
  await createReminderQueue(scheduleId, scheduledAtIso);
}

export async function loadScheduleWithDraft(args: {
  scheduleId: string;
}): Promise<{ schedule: SocialScheduleRow; draft: SocialDraftSnapshot | null } | null> {
  const schedule = await loadSchedule(args.scheduleId);
  if (!schedule) return null;

  const admin = createAdminClient();
  const { data: draftData } = await admin
    .from('social_drafts')
    .select('id, org_id, biz_id, status, title, copy_short, copy_long, hashtags, format, channel, assets_needed, steps')
    .eq('id', schedule.draft_id)
    .maybeSingle();

  return {
    schedule,
    draft: (draftData as SocialDraftSnapshot | null) || null,
  };
}

export async function listDraftSnapshotsByIds(draftIds: string[]): Promise<Record<string, SocialDraftSnapshot>> {
  if (draftIds.length === 0) return {};

  const admin = createAdminClient();
  const { data } = await admin
    .from('social_drafts')
    .select('id, org_id, biz_id, status, title, copy_short, copy_long, hashtags, format, channel, assets_needed, steps')
    .in('id', draftIds);

  const result: Record<string, SocialDraftSnapshot> = {};
  for (const row of (data || []) as SocialDraftSnapshot[]) {
    result[row.id] = row;
  }

  return result;
}
