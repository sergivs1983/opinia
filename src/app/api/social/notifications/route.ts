export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireImplicitBizAccessPatternB } from '@/lib/api-handler';
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
  page: z
    .preprocess((value) => {
      if (typeof value !== 'string') return undefined;
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : undefined;
    }, z.number().int().min(1).max(1_000).optional())
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
    page: request.nextUrl.searchParams.get('page') || undefined,
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
  const access = await requireImplicitBizAccessPatternB(request, {
    supabase,
    user,
    queryBizId: payload.biz_id,
  });
  if (access instanceof NextResponse) {
    return withNoStore(
      NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
      requestId,
    );
  }
  if (access.role !== 'owner' && access.role !== 'manager' && access.role !== 'staff' && access.role !== 'admin') {
    return withNoStore(
      NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
      requestId,
    );
  }

  const page = payload.page ?? 1;
  const pageSize = payload.limit ?? 20;
  const rangeFrom = (page - 1) * pageSize;
  const rangeTo = rangeFrom + pageSize - 1;

  const admin = createAdminClient();
  const { data: items, error: listError } = await admin
    .from('in_app_notifications')
    .select('id, org_id, biz_id, user_id, type, payload, read_at, created_at')
    .eq('user_id', user.id)
    .eq('org_id', access.membership.orgId)
    .eq('biz_id', access.bizId)
    .order('created_at', { ascending: false })
    .range(rangeFrom, rangeTo);

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

  const { count: unreadCount, error: countError } = await admin
    .from('in_app_notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('org_id', access.membership.orgId)
    .eq('biz_id', access.bizId)
    .is('read_at', null);

  if (countError) {
    log.warn('social_notifications_count_failed', {
      error_code: countError.code || null,
      error: countError.message || null,
      user_id: user.id,
    });
  }

  const scopedItems = (items || []).filter((item) => item.biz_id === access.bizId);

  return withNoStore(
    NextResponse.json({
      ok: true,
      items: scopedItems,
      unread_count: typeof unreadCount === 'number' ? unreadCount : 0,
      page,
      page_size: pageSize,
      request_id: requestId,
    }),
    requestId,
  );
}
