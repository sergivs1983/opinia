export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { hasAcceptedBusinessMembership } from '@/lib/authz';
import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const QuerySchema = z.object({
  biz_id: z.string().uuid().optional(),
  limit: z
    .preprocess((value) => {
      if (typeof value !== 'string') return undefined;
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : undefined;
    }, z.number().int().min(1).max(50).optional())
    .optional(),
});

function withNoStore(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('x-request-id', requestId);
  return response;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'GET /api/social/notifications' });

  const parsed = QuerySchema.safeParse({
    biz_id: request.nextUrl.searchParams.get('biz_id') || undefined,
    limit: request.nextUrl.searchParams.get('limit') || undefined,
  });

  if (!parsed.success) {
    return withNoStore(
      NextResponse.json({ error: 'bad_request', message: parsed.error.issues[0]?.message || 'Query invàlida', request_id: requestId }, { status: 400 }),
      requestId,
    );
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

  if (payload.biz_id) {
    const access = await hasAcceptedBusinessMembership({
      supabase,
      userId: user.id,
      businessId: payload.biz_id,
      allowedRoles: ['owner', 'manager', 'staff'],
    });

    if (!access.allowed) {
      return withNoStore(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }
  }

  const admin = createAdminClient();
  let query = admin
    .from('in_app_notifications')
    .select('id, org_id, biz_id, user_id, type, payload, read_at, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(payload.limit ?? 20);

  if (payload.biz_id) {
    query = query.eq('biz_id', payload.biz_id);
  }

  const { data: items, error: listError } = await query;

  if (listError) {
    log.error('social_notifications_list_failed', {
      error_code: listError.code || null,
      error: listError.message || null,
      user_id: user.id,
    });
    return withNoStore(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }

  let unreadQuery = admin
    .from('in_app_notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .is('read_at', null);

  if (payload.biz_id) {
    unreadQuery = unreadQuery.eq('biz_id', payload.biz_id);
  }

  const { count: unreadCount, error: countError } = await unreadQuery;

  if (countError) {
    log.warn('social_notifications_count_failed', {
      error_code: countError.code || null,
      error: countError.message || null,
      user_id: user.id,
    });
  }

  return withNoStore(
    NextResponse.json({
      ok: true,
      items: items || [],
      unread_count: typeof unreadCount === 'number' ? unreadCount : 0,
      request_id: requestId,
    }),
    requestId,
  );
}
