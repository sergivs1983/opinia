export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { buildGlobalProps } from '@/lib/analytics/properties';
import { requireResourceAccessPatternB, ResourceTable } from '@/lib/api-handler';
import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { computeSnoozedAt } from '@/lib/social/schedules';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { trackEvent } from '@/lib/telemetry';
import {
  badRequest,
  conflict,
  loadSchedule,
  notFound,
  refreshReminderQueue,
  unauthorized,
  withNoStore,
} from '@/app/api/social/schedules/_shared';

const ParamsSchema = z.object({
  id: z.string().uuid(),
});

const BodySchema = z.object({
  mode: z.enum(['plus_1h', 'tomorrow_same_time']),
});

export async function POST(
  request: NextRequest,
  context: { params: { id: string } },
): Promise<NextResponse> {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'POST /api/social/schedules/[id]/snooze' });

  const parsedParams = ParamsSchema.safeParse(context.params);
  if (!parsedParams.success) {
    return badRequest(requestId, parsedParams.error.issues[0]?.message || 'Paràmetres invàlids');
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return badRequest(requestId, 'Body invàlid');
  }

  const parsedBody = BodySchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return badRequest(requestId, parsedBody.error.issues[0]?.message || 'Body invàlid');
  }

  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthorized(requestId);

  const gate = await requireResourceAccessPatternB(request, parsedParams.data.id, ResourceTable.SocialSchedules, {
    supabase,
    user,
  });
  if (gate instanceof NextResponse) return withNoStore(gate, requestId);

  const schedule = await loadSchedule(parsedParams.data.id, gate.bizId);
  if (!schedule) {
    return notFound(requestId);
  }

  const canManage = gate.role === 'owner' || gate.role === 'manager';
  const canSnoozeAssigned = gate.role === 'staff'
    && schedule.assigned_user_id === gate.userId;
  if (!canManage && !canSnoozeAssigned) {
    return notFound(requestId);
  }

  if (schedule.status === 'published' || schedule.status === 'cancelled' || schedule.status === 'missed') {
    return conflict(requestId, 'invalid_status', 'Aquest recordatori no es pot ajornar.');
  }

  if (schedule.status === 'snoozed' && schedule.snoozed_from) {
    try {
      const previousExpected = computeSnoozedAt(schedule.snoozed_from, parsedBody.data.mode);
      const previousExpectedMs = new Date(previousExpected).getTime();
      const currentScheduledMs = new Date(schedule.scheduled_at).getTime();
      const updatedAtMs = new Date(schedule.updated_at).getTime();
      const duplicateWindowMs = 45_000;
      const nowMs = Date.now();
      if (
        Number.isFinite(previousExpectedMs)
        && Number.isFinite(currentScheduledMs)
        && previousExpectedMs === currentScheduledMs
        && Number.isFinite(updatedAtMs)
        && nowMs - updatedAtMs <= duplicateWindowMs
      ) {
        return withNoStore(
          NextResponse.json({ ok: true, idempotent: true, schedule, request_id: requestId }),
          requestId,
        );
      }
    } catch {
      // Ignore invalid historical data and continue with standard snooze flow.
    }
  }

  let nextScheduledAtIso = '';
  try {
    nextScheduledAtIso = computeSnoozedAt(schedule.scheduled_at, parsedBody.data.mode);
  } catch {
    return badRequest(requestId, 'Data de programació invàlida');
  }

  const nowIso = new Date().toISOString();
  const admin = createAdminClient();

  const { data: updated, error: updateError } = await admin
    .from('social_schedules')
    .update({
      status: 'snoozed',
      snoozed_from: schedule.scheduled_at,
      scheduled_at: nextScheduledAtIso,
      updated_at: nowIso,
    })
    .eq('id', schedule.id)
    .select('id, org_id, biz_id, draft_id, assigned_user_id, platform, scheduled_at, status, notified_at, published_at, snoozed_from, created_at, updated_at')
    .maybeSingle();

  if (updateError || !updated) {
    log.error('social_schedules_snooze_failed', {
      schedule_id: schedule.id,
      error_code: updateError?.code || null,
      error: updateError?.message || null,
    });
    return withNoStore(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }

  try {
    await refreshReminderQueue(schedule.id, nextScheduledAtIso);
  } catch (error) {
    log.error('social_schedules_snooze_queue_failed', {
      schedule_id: schedule.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  await trackEvent({
    supabase,
    orgId: gate.membership.orgId,
    userId: gate.userId,
    name: 'post_snoozed',
    props: {
      ...buildGlobalProps({
        userId: gate.userId,
        bizId: schedule.biz_id,
        orgId: gate.membership.orgId,
        role: gate.role,
        mode: 'basic',
        platform: 'web',
      }),
      schedule_id: schedule.id,
      action: 'snooze',
      snooze_mode: parsedBody.data.mode,
      source: 'social_schedules_snooze',
    },
    requestId,
    sendPosthog: true,
  });

  return withNoStore(
    NextResponse.json({ ok: true, schedule: updated, request_id: requestId }),
    requestId,
  );
}
