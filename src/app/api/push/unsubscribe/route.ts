export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { createAdminClient } from '@/lib/supabase/admin';

import { requirePushBizAccess, withNoStore } from '../_shared';

const BodySchema = z.object({
  biz_id: z.string().uuid(),
  endpoint: z.string().url().optional(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'POST /api/push/unsubscribe' });

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return withNoStore(
      NextResponse.json({ error: 'bad_request', message: 'Invalid JSON body', request_id: requestId }, { status: 400 }),
      requestId,
    );
  }

  const parsed = BodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return withNoStore(
      NextResponse.json({
        error: 'bad_request',
        message: parsed.error.issues[0]?.message || 'Invalid request body',
        request_id: requestId,
      }, { status: 400 }),
      requestId,
    );
  }

  const payload = parsed.data;
  const access = await requirePushBizAccess({
    request,
    bizId: payload.biz_id,
    requestId,
    route: 'POST /api/push/unsubscribe',
  });

  if (!access.ok) return access.response;

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  let query = admin
    .from('push_subscriptions')
    .update({ revoked_at: nowIso })
    .eq('user_id', access.userId)
    .eq('org_id', access.orgId)
    .eq('biz_id', access.bizId)
    .is('revoked_at', null);

  if (payload.endpoint) {
    query = query.eq('endpoint', payload.endpoint);
  }

  const { data, error } = await query.select('id');

  if (error) {
    log.error('push_unsubscribe_failed', {
      error_code: error.code || null,
      error: error.message || null,
      biz_id: access.bizId,
      user_id: access.userId,
    });
    return withNoStore(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }

  return withNoStore(
    NextResponse.json({
      ok: true,
      unsubscribed: true,
      revoked_count: Array.isArray(data) ? data.length : 0,
      request_id: requestId,
    }),
    requestId,
  );
}
