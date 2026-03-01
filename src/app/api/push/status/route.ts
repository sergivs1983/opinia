export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { createAdminClient } from '@/lib/supabase/admin';
import { getWebPushPublicKey } from '@/lib/push/webpush';

import { requirePushBizAccess, withNoStore } from '../_shared';

const QuerySchema = z.object({
  biz_id: z.string().uuid(),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'GET /api/push/status' });

  const parsed = QuerySchema.safeParse({
    biz_id: request.nextUrl.searchParams.get('biz_id') || undefined,
  });

  if (!parsed.success) {
    return withNoStore(
      NextResponse.json({
        error: 'bad_request',
        message: parsed.error.issues[0]?.message || 'Invalid query',
        request_id: requestId,
      }, { status: 400 }),
      requestId,
    );
  }

  const bizId = parsed.data.biz_id;
  const access = await requirePushBizAccess({
    bizId,
    requestId,
    route: 'GET /api/push/status',
  });

  if (!access.ok) return access.response;

  const admin = createAdminClient();
  const { count, error } = await admin
    .from('push_subscriptions')
    .select('id', { head: true, count: 'exact' })
    .eq('user_id', access.userId)
    .eq('org_id', access.orgId)
    .eq('biz_id', bizId)
    .is('revoked_at', null);

  if (error) {
    log.error('push_status_count_failed', {
      error_code: error.code || null,
      error: error.message || null,
      biz_id: bizId,
      user_id: access.userId,
    });
    return withNoStore(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }

  const publicKey = getWebPushPublicKey();

  return withNoStore(
    NextResponse.json({
      ok: true,
      subscribed: (count || 0) > 0,
      active_count: count || 0,
      push_enabled: Boolean(publicKey),
      vapid_public_key: publicKey,
      request_id: requestId,
    }),
    requestId,
  );
}
