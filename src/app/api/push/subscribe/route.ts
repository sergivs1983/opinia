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
  subscription: z.object({
    endpoint: z.string().url(),
    keys: z.object({
      p256dh: z.string().min(8).max(1024),
      auth: z.string().min(6).max(1024),
    }),
  }),
  user_agent: z.string().trim().max(400).optional(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'POST /api/push/subscribe' });

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
    route: 'POST /api/push/subscribe',
  });

  if (!access.ok) return access.response;

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  const { data, error } = await admin
    .from('push_subscriptions')
    .upsert({
      user_id: access.userId,
      org_id: access.orgId,
      biz_id: access.bizId,
      endpoint: payload.subscription.endpoint,
      p256dh: payload.subscription.keys.p256dh,
      auth: payload.subscription.keys.auth,
      user_agent: payload.user_agent || request.headers.get('user-agent') || null,
      revoked_at: null,
      created_at: nowIso,
    }, { onConflict: 'user_id,biz_id,endpoint', ignoreDuplicates: false })
    .select('id')
    .maybeSingle();

  if (error || !data) {
    log.error('push_subscribe_upsert_failed', {
      error_code: error?.code || null,
      error: error?.message || null,
      biz_id: access.bizId,
      user_id: access.userId,
    });
    return withNoStore(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }

  return withNoStore(
    NextResponse.json({ ok: true, subscribed: true, id: data.id, request_id: requestId }),
    requestId,
  );
}
