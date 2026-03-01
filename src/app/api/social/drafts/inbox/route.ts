export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { getLitoBizAccess } from '@/lib/lito/action-drafts';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { validateQuery } from '@/lib/validations';
import { withStandardHeaders } from '@/app/api/social/drafts/_shared';

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

    const { data: orgMembership, error: membershipError } = await supabase
      .from('memberships')
      .select('role')
      .eq('org_id', payload.org_id)
      .eq('user_id', user.id)
      .not('accepted_at', 'is', null)
      .limit(1)
      .maybeSingle();

    if (membershipError || !orgMembership) {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    const role = orgMembership.role;
    const isManager = role === 'owner' || role === 'manager';
    if (!isManager) {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    if (payload.biz_id) {
      const access = await getLitoBizAccess({
        supabase,
        userId: user.id,
        bizId: payload.biz_id,
      });
      if (!access.allowed || !access.role || access.orgId !== payload.org_id) {
        return withStandardHeaders(
          NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
          requestId,
        );
      }
    }

    const admin = createAdminClient();
    let queryBuilder = admin
      .from('social_drafts')
      .select('id, org_id, biz_id, recommendation_id, thread_id, status, channel, format, title, copy_short, copy_long, hashtags, steps, assets_needed, created_by, reviewed_by, review_note, created_at, updated_at')
      .eq('org_id', payload.org_id)
      .eq('status', payload.status || 'pending')
      .order('updated_at', { ascending: false })
      .limit(payload.limit ?? 5);

    if (payload.biz_id) {
      queryBuilder = queryBuilder.eq('biz_id', payload.biz_id);
    }

    const { data, error } = await queryBuilder;

    if (error) {
      log.error('social_drafts_inbox_failed', {
        error_code: error.code || null,
        error: error.message || null,
        org_id: payload.org_id,
        biz_id: payload.biz_id || null,
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
