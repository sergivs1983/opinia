export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireBizAccessPatternB } from '@/lib/api-handler';
import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const QuerySchema = z.object({
  biz_id: z.string().uuid().optional(),
});

type IntegrationHealthRow = {
  provider: string | null;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_error_code: string | null;
  last_error_detail: string | null;
  consecutive_failures: number | null;
  needs_reauth: boolean | null;
};

function withNoStore(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('x-request-id', requestId);
  return response;
}

function normalizeBizId(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeSyncStatus(value: string | null | undefined): 'ok' | 'error' | 'needs_reauth' | null {
  if (value === 'ok' || value === 'error' || value === 'needs_reauth') return value;
  return null;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'GET /api/integrations/health' });

  try {
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

    const parsed = QuerySchema.safeParse({
      biz_id: request.nextUrl.searchParams.get('biz_id') || undefined,
    });
    if (!parsed.success) {
      return withNoStore(
        NextResponse.json(
          {
            error: 'validation_error',
            message: parsed.error.issues[0]?.message || 'Query invàlida',
            request_id: requestId,
          },
          { status: 400 },
        ),
        requestId,
      );
    }

    const queryBizId = normalizeBizId(parsed.data.biz_id || null);
    const headerBizId = normalizeBizId(request.headers.get('x-biz-id'));
    const bizId = queryBizId || headerBizId;

    const access = await requireBizAccessPatternB(request, bizId, {
      supabase,
      user,
      queryBizId,
      headerBizId,
    });
    if (access instanceof NextResponse) return withNoStore(access, requestId);

    if (access.role !== 'owner' && access.role !== 'manager' && access.role !== 'staff') {
      return withNoStore(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    const { data, error } = await supabase
      .from('integrations')
      .select('provider, last_sync_at, last_sync_status, last_error_code, last_error_detail, consecutive_failures, needs_reauth')
      .eq('biz_id', access.bizId)
      .eq('provider', 'google_business')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      log.error('integrations_health_lookup_failed', {
        biz_id: access.bizId,
        error_code: error.code || null,
        error: error.message || null,
      });
      return withNoStore(
        NextResponse.json(
          { error: 'db_error', message: 'Failed to load integration health', request_id: requestId },
          { status: 500 },
        ),
        requestId,
      );
    }

    const row = (data || null) as IntegrationHealthRow | null;
    return withNoStore(
      NextResponse.json({
        ok: true,
        provider: row?.provider || 'google_business',
        health: {
          last_sync_at: row?.last_sync_at || null,
          last_sync_status: normalizeSyncStatus(row?.last_sync_status),
          last_error_code: row?.last_error_code || null,
          last_error_detail: row?.last_error_detail || null,
          consecutive_failures: typeof row?.consecutive_failures === 'number' ? row.consecutive_failures : 0,
          needs_reauth: Boolean(row?.needs_reauth),
        },
        request_id: requestId,
      }),
      requestId,
    );
  } catch (error) {
    log.error('integrations_health_unhandled', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withNoStore(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}
