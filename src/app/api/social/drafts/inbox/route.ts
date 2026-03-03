export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireImplicitBizAccessPatternB } from '@/lib/api-handler';
import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { validateQuery } from '@/lib/validations';
import { SOCIAL_DRAFT_SELECT, withStandardHeaders } from '@/app/api/social/drafts/_shared';

const QuerySchema = z.object({
  org_id: z.string().uuid(),
  biz_id: z.string().uuid().optional(),
  status: z.enum(['draft', 'pending', 'approved', 'rejected', 'published']).default('pending').optional(),
  limit: z
    .preprocess((value) => {
      if (typeof value !== 'string') return undefined;
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : undefined;
    }, z.number().int().min(1).max(50).optional())
    .optional(),
});

export async function GET(request: Request) {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'GET /api/social/drafts/inbox' });

  try {
    const supabase = createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return withStandardHeaders(
        NextResponse.json({ error: 'unauthorized', message: 'Auth required', request_id: requestId }, { status: 401 }),
        requestId,
      );
    }

    const [query, queryErr] = validateQuery(request, QuerySchema);
    if (queryErr) return withStandardHeaders(queryErr, requestId);
    const payload = query as z.infer<typeof QuerySchema>;

    const access = await requireImplicitBizAccessPatternB(request, {
      supabase,
      user,
      queryBizId: payload.biz_id,
    });
    if (access instanceof NextResponse) {
      return withStandardHeaders(access, requestId);
    }
    if (access.membership.orgId !== payload.org_id) {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }
    const isManager = access.role === 'owner' || access.role === 'manager' || access.role === 'admin';
    if (!isManager) {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    const scopedBizId = payload.biz_id ? access.bizId : null;

    const admin = createAdminClient();
    let queryBuilder = admin
      .from('social_drafts')
      .select(SOCIAL_DRAFT_SELECT)
      .eq('org_id', payload.org_id)
      .eq('status', payload.status || 'pending')
      .order('updated_at', { ascending: false })
      .limit(payload.limit ?? 5);

    if (scopedBizId) {
      queryBuilder = queryBuilder.eq('biz_id', scopedBizId);
    }

    const { data, error } = await queryBuilder;

    if (error) {
      log.error('social_drafts_inbox_failed', {
        error_code: error.code || null,
        error: error.message || null,
        org_id: payload.org_id,
        biz_id: scopedBizId,
      });
      return withStandardHeaders(
        NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
        requestId,
      );
    }

    return withStandardHeaders(
      NextResponse.json({
        ok: true,
        items: data || [],
        request_id: requestId,
      }),
      requestId,
    );
  } catch (error) {
    log.error('social_drafts_inbox_unhandled', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withStandardHeaders(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}
