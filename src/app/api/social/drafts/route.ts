export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { getLitoBizAccess } from '@/lib/lito/action-drafts';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { validateBody, validateQuery } from '@/lib/validations';
import { withStandardHeaders } from '@/app/api/social/drafts/_shared';

const StatusSchema = z.enum(['draft', 'pending', 'approved', 'rejected', 'published']);

const QuerySchema = z.object({
  biz_id: z.string().uuid(),
  recommendation_id: z.string().uuid().optional(),
  status: StatusSchema.optional(),
  limit: z
    .preprocess((value) => {
      if (typeof value !== 'string') return undefined;
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : undefined;
    }, z.number().int().min(1).max(50).optional())
    .optional(),
});

const BodySchema = z.object({
  biz_id: z.string().uuid(),
  channel: z.enum(['instagram', 'tiktok', 'facebook']).default('instagram'),
  format: z.enum(['post', 'story', 'reel']).default('post'),
  title: z.string().trim().min(1).max(140).optional().nullable(),
  copy_short: z.string().trim().max(500).optional().nullable(),
  copy_long: z.string().trim().max(4000).optional().nullable(),
  hashtags: z.array(z.string().trim().min(1).max(80)).max(30).optional().nullable(),
  assets_needed: z.array(z.string().trim().min(1).max(120)).max(30).optional().nullable(),
  steps: z.array(z.string().trim().min(1).max(200)).max(30).optional().nullable(),
  recommendation_id: z.string().uuid().optional().nullable(),
  thread_id: z.string().uuid().optional().nullable(),
  source: z.enum(['lito', 'voice', 'manual']).default('lito'),
});

function normalizeList(values?: string[] | null): string[] | null {
  if (!values || values.length === 0) return null;
  return values.map((entry) => entry.trim()).filter(Boolean);
}

export async function GET(request: Request) {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'GET /api/social/drafts' });

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

    const access = await getLitoBizAccess({
      supabase,
      userId: user.id,
      bizId: payload.biz_id,
    });

    if (!access.allowed || !access.role) {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    const admin = createAdminClient();
    let queryBuilder = admin
      .from('social_drafts')
      .select('id, org_id, biz_id, source, recommendation_id, thread_id, status, channel, format, title, copy_short, copy_long, hashtags, steps, assets_needed, created_by, reviewed_by, review_note, created_at, updated_at')
      .eq('biz_id', payload.biz_id)
      .order('updated_at', { ascending: false })
      .limit(payload.limit ?? 20);

    if (payload.recommendation_id) {
      queryBuilder = queryBuilder.eq('recommendation_id', payload.recommendation_id);
    }

    if (payload.status) {
      queryBuilder = queryBuilder.eq('status', payload.status);
    }

    if (access.role === 'staff') {
      queryBuilder = queryBuilder.eq('created_by', user.id);
    }

    const { data, error } = await queryBuilder;

    if (error) {
      log.error('social_drafts_list_failed', {
        error_code: error.code || null,
        error: error.message || null,
        biz_id: payload.biz_id,
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
        viewer_role: access.role,
        request_id: requestId,
      }),
      requestId,
    );
  } catch (error) {
    log.error('social_drafts_list_unhandled', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withStandardHeaders(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}

export async function POST(request: Request) {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'POST /api/social/drafts' });

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

    const [body, bodyErr] = await validateBody(request, BodySchema);
    if (bodyErr) return withStandardHeaders(bodyErr, requestId);
    const payload = body as z.infer<typeof BodySchema>;

    const access = await getLitoBizAccess({
      supabase,
      userId: user.id,
      bizId: payload.biz_id,
    });

    if (!access.allowed || !access.role || !access.orgId) {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    const nowIso = new Date().toISOString();
    const admin = createAdminClient();

    const insertPayload = {
      org_id: access.orgId,
      biz_id: payload.biz_id,
      source: payload.source,
      recommendation_id: payload.recommendation_id || null,
      thread_id: payload.thread_id || null,
      status: 'draft' as const,
      channel: payload.channel,
      format: payload.format,
      title: payload.title || null,
      copy_short: payload.copy_short || null,
      copy_long: payload.copy_long || null,
      hashtags: normalizeList(payload.hashtags),
      steps: Array.isArray(payload.steps) ? payload.steps : null,
      assets_needed: normalizeList(payload.assets_needed),
      created_by: user.id,
      reviewed_by: null,
      review_note: null,
      created_at: nowIso,
      updated_at: nowIso,
    };

    const { data, error } = await admin
      .from('social_drafts')
      .insert(insertPayload)
      .select('id, org_id, biz_id, source, recommendation_id, thread_id, status, channel, format, title, copy_short, copy_long, hashtags, steps, assets_needed, created_by, reviewed_by, review_note, created_at, updated_at')
      .single();

    if (error || !data) {
      log.error('social_draft_create_failed', {
        error_code: error?.code || null,
        error: error?.message || null,
        biz_id: payload.biz_id,
      });
      return withStandardHeaders(
        NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
        requestId,
      );
    }

    return withStandardHeaders(
      NextResponse.json({ ok: true, draft: data, request_id: requestId }, { status: 201 }),
      requestId,
    );
  } catch (error) {
    log.error('social_draft_create_unhandled', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withStandardHeaders(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}
