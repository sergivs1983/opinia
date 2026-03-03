export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireResourceAccessPatternB, ResourceTable } from '@/lib/api-handler';
import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import {
  badRequest,
  cancelPendingReminders,
  loadSchedule,
  notFound,
  unauthorized,
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
  const log = createLogger({ request_id: requestId, route: 'POST /api/social/schedules/[id]/cancel' });

  const parsedParams = ParamsSchema.safeParse(context.params);
  if (!parsedParams.success) {
    return badRequest(requestId, parsedParams.error.issues[0]?.message || 'Paràmetres invàlids');
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

  if (gate.role !== 'owner' && gate.role !== 'manager') {
    return notFound(requestId);
  }

  if (schedule.status === 'cancelled') {
    return withNoStore(
      NextResponse.json({ ok: true, idempotent: true, schedule, request_id: requestId }),
      requestId,
    );
  }

  const nowIso = new Date().toISOString();
  const admin = createAdminClient();

  const { data: updated, error: updateError } = await admin
    .from('social_schedules')
    .update({
      status: 'cancelled',
      updated_at: nowIso,
    })
    .eq('id', schedule.id)
    .select('id, org_id, biz_id, draft_id, assigned_user_id, platform, scheduled_at, status, notified_at, published_at, snoozed_from, created_at, updated_at')
    .maybeSingle();

  if (updateError || !updated) {
    log.error('social_schedules_cancel_failed', {
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
