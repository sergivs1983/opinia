export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { requireBizAccessPatternB } from '@/lib/api-handler';
import { createLogger, createRequestId } from '@/lib/logger';
import {
  validateQuery,
  ExportsListQuerySchema,
} from '@/lib/validations';
import { normalizeWeekStartMonday } from '@/lib/planner';
import type { ExportLanguage } from '@/types/database';

interface ExportsListQuery {
  weekStart?: string;
  language?: ExportLanguage;
  limit: number;
}

export async function GET(request: Request) {
  const requestId = request.headers.get('x-request-id')?.trim() || createRequestId();
  const log = createLogger({ request_id: requestId, route: '/api/exports' });

  const withResponseRequestId = (response: NextResponse) => {
    response.headers.set('x-request-id', requestId);
    return response;
  };

  try {
    const supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return withResponseRequestId(NextResponse.json({ error: 'unauthorized', message: 'Auth required', request_id: requestId }, { status: 401 }));
    }

    const [query, queryErr] = validateQuery(request, ExportsListQuerySchema);
    if (queryErr) return withResponseRequestId(queryErr);

    const payload = query as ExportsListQuery;
    const businessId = request.headers.get('x-biz-id')?.trim();
    const access = await requireBizAccessPatternB(request, businessId, {
      supabase,
      user,
      headerBizId: businessId || null,
    });
    if (access instanceof NextResponse) return withResponseRequestId(access);

    let exportsQuery = supabase
      .from('exports')
      .select('id, week_start, language, kind, bytes, items_count, status, created_at')
      .eq('business_id', access.bizId)
      .order('created_at', { ascending: false })
      .limit(payload.limit);

    if (payload.weekStart) exportsQuery = exportsQuery.eq('week_start', normalizeWeekStartMonday(payload.weekStart));
    if (payload.language) exportsQuery = exportsQuery.eq('language', payload.language);

    const { data: exportsData, error: exportsError } = await exportsQuery;
    if (exportsError) {
      log.error('Failed to list exports', { error: exportsError.message, business_id: access.bizId });
      return withResponseRequestId(
        NextResponse.json({ error: 'db_error', message: 'Failed to list exports', request_id: requestId }, { status: 500 }),
      );
    }

    return withResponseRequestId(
      NextResponse.json({ items: exportsData || [], request_id: requestId }),
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown';
    log.error('Unhandled exports list error', { error: message });
    return withResponseRequestId(
      NextResponse.json(
        { error: 'internal_error', message: 'Error intern del servidor', request_id: requestId },
        { status: 500 },
      ),
    );
  }
}
