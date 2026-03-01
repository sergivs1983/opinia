export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  badRequest,
  cancelPendingReminders,
  conflict,
  loadSchedule,
  notFound,
  requireUserAndBizAccess,
  withNoStore,
} from '@/app/api/social/schedules/_shared';

const ParamsSchema = z.object({
  id: z.string().uuid(),
});

export async function POST(
  request: NextRequest,
  context: { params: { id: string } },
): Promise<NextResponse> {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'POST /api/social/schedules/[id]/publish' });

  const parsedParams = ParamsSchema.safeParse(context.params);
  if (!parsedParams.success) {
    return badRequest(requestId, parsedParams.error.issues[0]?.message || 'Paràmetres invàlids');
  }

  const schedule = await loadSchedule(parsedParams.data.id);
  if (!schedule) {
    return notFound(requestId);
  }

  const access = await requireUserAndBizAccess({ bizId: schedule.biz_id, requestId });
  if (!access.ok) return access.response;

  const canManage = access.role === 'owner' || access.role === 'manager';
  const canPublishAssigned = access.role === 'staff'
    && schedule.assigned_user_id === access.userId
    && ['scheduled', 'notified', 'snoozed', 'published'].includes(schedule.status);

  if (!canManage && !canPublishAssigned) {
    return notFound(requestId);
  }

  if (schedule.status === 'published') {
    return withNoStore(
      NextResponse.json({ ok: true, idempotent: true, schedule, request_id: requestId }),
      requestId,
    );
  }

  if (schedule.status === 'cancelled' || schedule.status === 'missed') {
    return conflict(requestId, 'invalid_status', 'Aquest recordatori ja no es pot publicar.');
  }

  const nowIso = new Date().toISOString();
  const admin = createAdminClient();

  const { data: updated, error: updateError } = await admin
    .from('social_schedules')
    .update({
      status: 'published',
      published_at: nowIso,
      updated_at: nowIso,
    })
    .eq('id', schedule.id)
    .select('id, org_id, biz_id, draft_id, assigned_user_id, platform, scheduled_at, status, notified_at, published_at, snoozed_from, created_at, updated_at')
    .maybeSingle();

  if (updateError || !updated) {
    log.error('social_schedules_publish_failed', {
      schedule_id: schedule.id,
      error_code: updateError?.code || null,
      error: updateError?.message || null,
    });
    return withNoStore(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }

  await cancelPendingReminders(schedule.id);

  return withNoStore(
    NextResponse.json({ ok: true, schedule: updated, request_id: requestId }),
    requestId,
  );
}
