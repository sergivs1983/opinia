export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { requireBizAccessPatternB } from '@/lib/api-handler';
import { createLogger, createRequestId } from '@/lib/logger';
import {
  validateQuery,
  ContentStudioAssetsListQuerySchema,
} from '@/lib/validations';
import type { ContentAsset } from '@/types/database';

type AssetListRow = Pick<ContentAsset,
  'id' | 'suggestion_id' | 'created_at' | 'format' | 'template_id' | 'language' | 'status'>;

interface ListQuery {
  businessId?: string;
  weekStart?: string;
  format?: 'story' | 'feed';
  language?: 'ca' | 'es' | 'en';
  templateId?: string;
  status?: 'created' | 'failed';
  limit: number;
  cursor?: string;
}

function toWeekRange(weekStart: string): { from: string; to: string } {
  const start = new Date(`${weekStart}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  return {
    from: start.toISOString(),
    to: end.toISOString(),
  };
}

function parseCursor(raw?: string): string | null {
  if (!raw) return null;
  const [createdAt] = raw.split('|');
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function buildCursor(row: AssetListRow): string {
  return `${row.created_at}|${row.id}`;
}

export async function GET(request: Request) {
  const requestId = request.headers.get('x-request-id')?.trim() || createRequestId();
  const log = createLogger({ request_id: requestId, route: '/api/content-studio/assets' });

  const withResponseRequestId = (response: NextResponse) => {
    response.headers.set('x-request-id', requestId);
    return response;
  };

  try {
    const supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return withResponseRequestId(NextResponse.json({ error: 'unauthorized', message: 'Auth required' }, { status: 401 }));
    }

    const [query, queryErr] = validateQuery(request, ContentStudioAssetsListQuerySchema);
    if (queryErr) return withResponseRequestId(queryErr);

    const payload = query as ListQuery;
    const workspaceBusinessId = request.headers.get('x-biz-id')?.trim();
    const businessId = payload.businessId || workspaceBusinessId;

    const access = await requireBizAccessPatternB(request, businessId, {
      supabase,
      user,
      queryBizId: payload.businessId || null,
      headerBizId: workspaceBusinessId || null,
    });
    if (access instanceof NextResponse) return withResponseRequestId(access);

    let assetsQuery = supabase
      .from('content_assets')
      .select('id, suggestion_id, created_at, format, template_id, language, status')
      .eq('business_id', access.bizId)
      .order('created_at', { ascending: false })
      .limit(payload.limit + 1);

    if (payload.format) assetsQuery = assetsQuery.eq('format', payload.format);
    if (payload.language) assetsQuery = assetsQuery.eq('language', payload.language);
    if (payload.templateId) assetsQuery = assetsQuery.eq('template_id', payload.templateId);
    if (payload.status) assetsQuery = assetsQuery.eq('status', payload.status);

    if (payload.weekStart) {
      const { from, to } = toWeekRange(payload.weekStart);
      assetsQuery = assetsQuery.gte('created_at', from).lt('created_at', to);
    }

    const cursorCreatedAt = parseCursor(payload.cursor);
    if (cursorCreatedAt) {
      assetsQuery = assetsQuery.lt('created_at', cursorCreatedAt);
    }

    const { data: assetsData, error: assetsError } = await assetsQuery;

    if (assetsError) {
      log.error('Failed to list content assets', { error: assetsError.message, business_id: access.bizId });
      return withResponseRequestId(
        NextResponse.json({ error: 'db_error', message: 'Failed to list content assets', request_id: requestId }, { status: 500 }),
      );
    }

    const rows = (assetsData || []) as AssetListRow[];
    const hasNextPage = rows.length > payload.limit;
    const items = hasNextPage ? rows.slice(0, payload.limit) : rows;
    const nextCursor = hasNextPage ? buildCursor(items[items.length - 1]) : null;

    return withResponseRequestId(
      NextResponse.json({
        items,
        nextCursor,
        request_id: requestId,
      }),
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown';
    log.error('Unhandled content assets list error', { error: message });
    return withResponseRequestId(
      NextResponse.json(
        { error: 'internal_error', message: 'Error intern del servidor', request_id: requestId },
        { status: 500 },
      ),
    );
  }
}
