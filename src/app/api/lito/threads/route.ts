export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { hasAcceptedBusinessMembership } from '@/lib/authz';
import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { validateBody, validateQuery } from '@/lib/validations';

const LitoThreadsBodySchema = z.object({
  biz_id: z.string().uuid(),
  recommendation_id: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(160).nullable().optional(),
});

const LitoThreadsQuerySchema = z.object({
  biz_id: z.string().uuid(),
  limit: z
    .preprocess((value) => {
      if (typeof value !== 'string') return undefined;
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : undefined;
    }, z.number().int().min(1).max(200).optional())
    .optional(),
});

type LitoThreadRow = {
  id: string;
  biz_id: string;
  recommendation_id: string | null;
  title: string;
  status: 'open' | 'closed';
  created_at: string;
  updated_at: string;
};

const LITO_ALLOWED_ROLES = ['owner', 'manager', 'staff'] as const;

function withStandardHeaders(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('x-request-id', requestId);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function isSchemaDependencyError(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  const code = (error?.code || '').toUpperCase();
  const message = (error?.message || '').toLowerCase();
  return (
    code === '42703'
    || code === '42P01'
    || code === 'PGRST204'
    || code === 'PGRST205'
    || message.includes('schema cache')
    || (message.includes('column') && message.includes('does not exist'))
  );
}

function normalizeThreadRows(rows: Array<Record<string, unknown>>): LitoThreadRow[] {
  return rows
    .map((row) => {
      const id = typeof row.id === 'string' ? row.id : null;
      const bizId = typeof row.biz_id === 'string' ? row.biz_id : null;
      const title = typeof row.title === 'string' ? row.title : 'LITO — Consultes';
      const createdAt = typeof row.created_at === 'string' ? row.created_at : new Date(0).toISOString();
      const updatedAt = typeof row.updated_at === 'string' ? row.updated_at : createdAt;
      if (!id || !bizId) return null;
      return {
        id,
        biz_id: bizId,
        recommendation_id: typeof row.recommendation_id === 'string' ? row.recommendation_id : null,
        title,
        status: row.status === 'closed' ? 'closed' : 'open',
        created_at: createdAt,
        updated_at: updatedAt,
      } as LitoThreadRow;
    })
    .filter((row): row is LitoThreadRow => Boolean(row));
}

export async function POST(request: Request) {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'POST /api/lito/threads' });

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

    const [body, bodyErr] = await validateBody(request, LitoThreadsBodySchema);
    if (bodyErr) return withStandardHeaders(bodyErr, requestId);
    const payload = body as z.infer<typeof LitoThreadsBodySchema>;

    const access = await hasAcceptedBusinessMembership({
      supabase,
      userId: user.id,
      businessId: payload.biz_id,
      allowedRoles: [...LITO_ALLOWED_ROLES],
    });
    if (!access.allowed || !access.orgId) {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    const admin = createAdminClient();

    const recommendationId = payload.recommendation_id ?? null;
    if (recommendationId) {
      const { data: recommendationData, error: recommendationErr } = await admin
        .from('recommendation_log')
        .select('id')
        .eq('id', recommendationId)
        .eq('biz_id', payload.biz_id)
        .maybeSingle();
      if (recommendationErr || !recommendationData) {
        return withStandardHeaders(
          NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
          requestId,
        );
      }
    }

    if (recommendationId) {
      const { data: existingData } = await admin
        .from('lito_threads')
        .select('id, biz_id, recommendation_id, title, status, created_at, updated_at')
        .eq('biz_id', payload.biz_id)
        .eq('recommendation_id', recommendationId)
        .maybeSingle();

      if (existingData) {
        return withStandardHeaders(
          NextResponse.json({
            ok: true,
            thread: existingData as LitoThreadRow,
            request_id: requestId,
          }),
          requestId,
        );
      }
    }

    const title = payload.title
      ? payload.title
      : recommendationId
        ? 'LITO — Recomanació'
        : 'LITO — Consultes';

    const { data: insertedData, error: insertErr } = await admin
      .from('lito_threads')
      .insert({
        org_id: access.orgId,
        biz_id: payload.biz_id,
        recommendation_id: recommendationId,
        title,
      })
      .select('id, biz_id, recommendation_id, title, status, created_at, updated_at')
      .single();

    if (insertErr || !insertedData) {
      if (insertErr?.code === '23505' && recommendationId) {
        const { data: conflictData } = await admin
          .from('lito_threads')
          .select('id, biz_id, recommendation_id, title, status, created_at, updated_at')
          .eq('biz_id', payload.biz_id)
          .eq('recommendation_id', recommendationId)
          .maybeSingle();

        if (conflictData) {
          return withStandardHeaders(
            NextResponse.json({
              ok: true,
              thread: conflictData as LitoThreadRow,
              request_id: requestId,
            }),
            requestId,
          );
        }
      }

      log.error('lito_threads_insert_failed', {
        error_code: insertErr?.code || null,
        error: insertErr?.message || null,
        biz_id: payload.biz_id,
      });
      return withStandardHeaders(
        NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
        requestId,
      );
    }

    return withStandardHeaders(
      NextResponse.json(
        {
          ok: true,
          thread: insertedData as LitoThreadRow,
          request_id: requestId,
        },
        { status: 201 },
      ),
      requestId,
    );
  } catch (error) {
    log.error('lito_threads_post_unhandled', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withStandardHeaders(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}

export async function GET(request: Request) {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'GET /api/lito/threads' });

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

    const [query, queryErr] = validateQuery(request, LitoThreadsQuerySchema);
    if (queryErr) return withStandardHeaders(queryErr, requestId);
    const payload = query as z.infer<typeof LitoThreadsQuerySchema>;
    const limit = payload.limit ?? 20;

    const access = await hasAcceptedBusinessMembership({
      supabase,
      userId: user.id,
      businessId: payload.biz_id,
      allowedRoles: [...LITO_ALLOWED_ROLES],
    });
    if (!access.allowed) {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from('lito_threads')
      .select('id, biz_id, recommendation_id, title, status, created_at, updated_at')
      .eq('biz_id', payload.biz_id)
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (error) {
      if (isSchemaDependencyError(error)) {
        log.warn('lito_threads_list_schema_fallback', {
          error_code: error.code || null,
          error: error.message || null,
        });
        return withStandardHeaders(
          NextResponse.json({
            ok: true,
            threads: [],
            request_id: requestId,
          }),
          requestId,
        );
      }
      log.error('lito_threads_list_failed', { error_code: error.code || null, error: error.message || null });
      return withStandardHeaders(
        NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
        requestId,
      );
    }

    return withStandardHeaders(
      NextResponse.json({
        ok: true,
        threads: normalizeThreadRows((data || []) as Array<Record<string, unknown>>),
        request_id: requestId,
      }),
      requestId,
    );
  } catch (error) {
    log.error('lito_threads_get_unhandled', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withStandardHeaders(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}
