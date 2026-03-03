export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireBizAccessPatternB } from '@/lib/api-handler';
import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { toIsoStringUtc, parseDateRange } from '@/lib/social/schedules';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import {
  badRequest,
  conflict,
  createReminderQueue,
  listDraftSnapshotsByIds,
  loadSocialDraftSnapshot,
  notFound,
  type SocialScheduleRow,
  withNoStore,
} from '@/app/api/social/schedules/_shared';

const QuerySchema = z.object({
  biz_id: z.string().uuid(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z
    .preprocess((value) => {
      if (typeof value !== 'string') return undefined;
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : undefined;
    }, z.number().int().min(1).max(200).optional())
    .optional(),
});

const BodySchema = z.object({
  biz_id: z.string().uuid(),
  draft_id: z.string().uuid(),
  platform: z.enum(['instagram', 'tiktok']),
  scheduled_at: z.string().min(1),
  assigned_user_id: z.string().uuid(),
});

function mapScheduleItem(schedule: SocialScheduleRow, draft?: Record<string, unknown>) {
  return {
    ...schedule,
    draft: draft || null,
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'GET /api/social/schedules' });

  const parsed = QuerySchema.safeParse({
    biz_id: request.nextUrl.searchParams.get('biz_id'),
    from: request.nextUrl.searchParams.get('from') || undefined,
    to: request.nextUrl.searchParams.get('to') || undefined,
    limit: request.nextUrl.searchParams.get('limit') || undefined,
  });

  if (!parsed.success) {
    return badRequest(requestId, parsed.error.issues[0]?.message || 'Query invàlida');
  }

  const payload = parsed.data;
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return withNoStore(
      NextResponse.json({ error: 'unauthorized', message: 'Auth required', request_id: requestId }, { status: 401 }),
      requestId,
    );
  }
  const access = await requireBizAccessPatternB(request, payload.biz_id, {
    supabase,
    user,
    queryBizId: payload.biz_id,
  });
  if (access instanceof NextResponse) return withNoStore(access, requestId);
  if (access.role !== 'owner' && access.role !== 'manager' && access.role !== 'staff') {
    return notFound(requestId);
  }

  const fromIso = parseDateRange(payload.from || null);
  const toIso = parseDateRange(payload.to || null);

  const admin = createAdminClient();

  let query = admin
    .from('social_schedules')
    .select('id, org_id, biz_id, draft_id, assigned_user_id, platform, scheduled_at, status, notified_at, published_at, snoozed_from, created_at, updated_at')
    .eq('biz_id', access.bizId)
    .order('scheduled_at', { ascending: true })
    .limit(payload.limit ?? 120);

  if (fromIso) query = query.gte('scheduled_at', fromIso);
  if (toIso) query = query.lte('scheduled_at', toIso);
  if (access.role === 'staff') {
    query = query.eq('assigned_user_id', access.userId);
  }

  const { data: rows, error } = await query;

  if (error) {
    log.error('social_schedules_list_failed', {
        error_code: error.code || null,
        error: error.message || null,
        biz_id: access.bizId,
      });
    return withNoStore(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }

  const schedules = (rows || []) as SocialScheduleRow[];
  const draftMap = await listDraftSnapshotsByIds(Array.from(new Set(schedules.map((item) => item.draft_id))));

  return withNoStore(
    NextResponse.json({
      ok: true,
      viewer_role: access.role,
      items: schedules.map((item) => mapScheduleItem(item, draftMap[item.draft_id] || null)),
      request_id: requestId,
    }),
    requestId,
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'POST /api/social/schedules' });

  let bodyRaw: unknown;
  try {
    bodyRaw = await request.json();
  } catch {
    return badRequest(requestId, 'Body invàlid');
  }

  const parsed = BodySchema.safeParse(bodyRaw);
  if (!parsed.success) {
    return badRequest(requestId, parsed.error.issues[0]?.message || 'Body invàlid');
  }

  const payload = parsed.data;
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return withNoStore(
      NextResponse.json({ error: 'unauthorized', message: 'Auth required', request_id: requestId }, { status: 401 }),
      requestId,
    );
  }

  const access = await requireBizAccessPatternB(request, payload.biz_id, {
    supabase,
    user,
    bodyBizId: payload.biz_id,
  });
  if (access instanceof NextResponse) return withNoStore(access, requestId);
  if (access.role !== 'owner' && access.role !== 'manager' && access.role !== 'staff') {
    return notFound(requestId);
  }

  if (access.role !== 'owner' && access.role !== 'manager') {
    return notFound(requestId);
  }

  let scheduledAtIso = '';
  try {
    scheduledAtIso = toIsoStringUtc(payload.scheduled_at);
  } catch {
    return badRequest(requestId, 'scheduled_at invàlid');
  }

  const draft = await loadSocialDraftSnapshot(payload.draft_id);
  if (!draft || draft.biz_id !== access.bizId || draft.org_id !== access.membership.orgId) {
    return notFound(requestId);
  }

  if (draft.status !== 'approved') {
    return conflict(requestId, 'draft_not_approved', 'El draft ha d\'estar aprovat per programar.');
  }

  const admin = createAdminClient();

  const { data: assignedBusinessMembership, error: assignedBmError } = await admin
    .from('business_memberships')
    .select('user_id')
    .eq('org_id', access.membership.orgId)
    .eq('business_id', access.bizId)
    .eq('user_id', payload.assigned_user_id)
    .eq('is_active', true)
    .maybeSingle();

  const { data: assignedMembership, error: assignedMembershipError } = await admin
    .from('memberships')
    .select('role')
    .eq('org_id', access.membership.orgId)
    .eq('user_id', payload.assigned_user_id)
    .not('accepted_at', 'is', null)
    .maybeSingle();

  const assignedRole = ((assignedMembership as { role?: string } | null)?.role || null);
  const assignedRoleAllowed = assignedRole === 'owner' || assignedRole === 'manager' || assignedRole === 'staff';

  if (assignedBmError || assignedMembershipError || !assignedBusinessMembership || !assignedRoleAllowed) {
    return notFound(requestId);
  }

  const { data: existingSchedule } = await admin
    .from('social_schedules')
    .select('id, org_id, biz_id, draft_id, assigned_user_id, platform, scheduled_at, status, notified_at, published_at, snoozed_from, created_at, updated_at')
    .eq('draft_id', payload.draft_id)
    .in('status', ['scheduled', 'notified', 'snoozed'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingSchedule) {
    return withNoStore(
      NextResponse.json({
        ok: true,
        idempotent: true,
        schedule: mapScheduleItem(existingSchedule as SocialScheduleRow, draft),
        request_id: requestId,
      }),
      requestId,
    );
  }

  const nowIso = new Date().toISOString();
  const insertPayload = {
    org_id: access.membership.orgId,
    biz_id: access.bizId,
    draft_id: payload.draft_id,
    assigned_user_id: payload.assigned_user_id,
    platform: payload.platform,
    scheduled_at: scheduledAtIso,
    status: 'scheduled',
    notified_at: null,
    published_at: null,
    snoozed_from: null,
    created_at: nowIso,
    updated_at: nowIso,
  };

  const { data: inserted, error: insertError } = await admin
    .from('social_schedules')
    .insert(insertPayload)
    .select('id, org_id, biz_id, draft_id, assigned_user_id, platform, scheduled_at, status, notified_at, published_at, snoozed_from, created_at, updated_at')
    .maybeSingle();

  if (insertError || !inserted) {
    if (insertError?.code === '23505') {
      const { data: conflictSchedule } = await admin
        .from('social_schedules')
        .select('id, org_id, biz_id, draft_id, assigned_user_id, platform, scheduled_at, status, notified_at, published_at, snoozed_from, created_at, updated_at')
        .eq('draft_id', payload.draft_id)
        .in('status', ['scheduled', 'notified', 'snoozed'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (conflictSchedule) {
        return withNoStore(
          NextResponse.json({
            ok: true,
            idempotent: true,
            schedule: mapScheduleItem(conflictSchedule as SocialScheduleRow, draft),
            request_id: requestId,
          }),
          requestId,
        );
      }
    }

    log.error('social_schedules_create_failed', {
      error_code: insertError?.code || null,
      error: insertError?.message || null,
      biz_id: access.bizId,
      draft_id: payload.draft_id,
    });

    return withNoStore(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }

  const schedule = inserted as SocialScheduleRow;

  try {
    await createReminderQueue(schedule.id, schedule.scheduled_at);
  } catch (queueError) {
    log.error('social_schedules_reminder_queue_failed', {
      schedule_id: schedule.id,
      error: queueError instanceof Error ? queueError.message : String(queueError),
    });
  }

  return withNoStore(
    NextResponse.json({
      ok: true,
      schedule: mapScheduleItem(schedule, draft),
      request_id: requestId,
    }),
    requestId,
  );
}
