export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { validateCsrf } from '@/lib/security/csrf';

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createLogger, createRequestId } from '@/lib/logger';
import { bumpDailyMetric } from '@/lib/metrics';
import {
  validateBody,
  validateQuery,
  PlannerCreateSchema,
  PlannerListQuerySchema,
} from '@/lib/validations';
import { normalizeWeekStartMonday } from '@/lib/planner';
import type {
  ContentPlannerChannel,
  ContentPlannerItemType,
  ContentPlannerStatus,
} from '@/types/database';
import { rateLimitStandard } from '@/lib/security/ratelimit';

interface PlannerListQuery {
  weekStart: string;
  businessId?: string;
  channel?: ContentPlannerChannel;
  status?: ContentPlannerStatus;
  limit: number;
}

interface PlannerCreateBody {
  businessId: string;
  weekStart: string;
  scheduledAt: string;
  channel: ContentPlannerChannel;
  itemType: ContentPlannerItemType;
  suggestionId?: string;
  assetId?: string;
  textPostId?: string;
  title: string;
  notes?: string;
}

type PlannerListItemRow = {
  id: string;
  scheduled_at: string;
  channel: ContentPlannerChannel;
  item_type: ContentPlannerItemType;
  title: string;
  status: ContentPlannerStatus;
  suggestion_id: string | null;
  asset_id: string | null;
  text_post_id: string | null;
};

type LinkedEntityRow = {
  id: string;
  business_id: string;
};

function toIsoString(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

async function ensureBusinessAccess(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  businessId: string,
): Promise<boolean> {
  const { data: businessAccess, error: businessAccessError } = await supabase
    .from('businesses')
    .select('id')
    .eq('id', businessId)
    .single();

  return !businessAccessError && !!businessAccess;
}

async function validateLinkedEntity(args: {
  supabase: ReturnType<typeof createServerSupabaseClient>;
  itemType: ContentPlannerItemType;
  suggestionId?: string;
  assetId?: string;
  textPostId?: string;
  businessId: string;
}): Promise<'ok' | 'not_found' | 'forbidden'> {
  const { supabase, itemType, suggestionId, assetId, textPostId, businessId } = args;

  if (itemType === 'suggestion' && suggestionId) {
    const { data, error } = await supabase
      .from('content_suggestions')
      .select('id, business_id')
      .eq('id', suggestionId)
      .maybeSingle();

    if (error || !data) return 'not_found';
    return (data as LinkedEntityRow).business_id === businessId ? 'ok' : 'forbidden';
  }

  if (itemType === 'asset' && assetId) {
    const { data, error } = await supabase
      .from('content_assets')
      .select('id, business_id')
      .eq('id', assetId)
      .maybeSingle();

    if (error || !data) return 'not_found';
    return (data as LinkedEntityRow).business_id === businessId ? 'ok' : 'forbidden';
  }

  if (itemType === 'text' && textPostId) {
    const { data, error } = await supabase
      .from('content_text_posts')
      .select('id, business_id')
      .eq('id', textPostId)
      .maybeSingle();

    if (error || !data) return 'not_found';
    return (data as LinkedEntityRow).business_id === businessId ? 'ok' : 'forbidden';
  }

  return 'not_found';
}

export async function GET(request: Request) {
  const requestId = request.headers.get('x-request-id')?.trim() || createRequestId();
  const log = createLogger({ request_id: requestId, route: '/api/planner' });

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

    const [query, queryErr] = validateQuery(request, PlannerListQuerySchema);
    if (queryErr) return withResponseRequestId(queryErr);

    const payload = query as PlannerListQuery;
    const workspaceBusinessId = request.headers.get('x-biz-id')?.trim();
    const businessId = payload.businessId || workspaceBusinessId;

    if (!businessId) {
      return withResponseRequestId(
        NextResponse.json({ error: 'validation_error', message: 'businessId is required', request_id: requestId }, { status: 400 }),
      );
    }

    if (workspaceBusinessId && payload.businessId && payload.businessId !== workspaceBusinessId) {
      return withResponseRequestId(
        NextResponse.json({ error: 'forbidden', message: 'businessId does not match current workspace', request_id: requestId }, { status: 403 }),
      );
    }

    // ── Bloc 8: Standard rate limit ──
    const rlKey = `${businessId}:${user.id}`;
    const rl = await rateLimitStandard(rlKey);
    if (!rl.ok) return withResponseRequestId(rl.res);

    const hasAccess = await ensureBusinessAccess(supabase, businessId);
    if (!hasAccess) {
      return withResponseRequestId(NextResponse.json({ error: 'forbidden', message: 'No access to this business', request_id: requestId }, { status: 403 }));
    }

    let plannerQuery = supabase
      .from('content_planner_items')
      .select('id, scheduled_at, channel, item_type, title, status, suggestion_id, asset_id, text_post_id')
      .eq('business_id', businessId)
      .eq('week_start', normalizeWeekStartMonday(payload.weekStart))
      .order('scheduled_at', { ascending: true })
      .limit(payload.limit);

    if (payload.channel) plannerQuery = plannerQuery.eq('channel', payload.channel);
    if (payload.status) plannerQuery = plannerQuery.eq('status', payload.status);

    const { data: plannerData, error: plannerError } = await plannerQuery;

    if (plannerError) {
      log.error('Failed to load planner items', { error: plannerError.message, business_id: businessId });
      return withResponseRequestId(
        NextResponse.json({ error: 'db_error', message: 'Failed to load planner items', request_id: requestId }, { status: 500 }),
      );
    }

    const items = (plannerData || []) as PlannerListItemRow[];
    return withResponseRequestId(
      NextResponse.json({ weekStart: normalizeWeekStartMonday(payload.weekStart), items, request_id: requestId }),
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown';
    log.error('Unhandled planner GET error', { error: message });
    return withResponseRequestId(
      NextResponse.json(
        { error: 'internal_error', message: 'Error intern del servidor', request_id: requestId },
        { status: 500 },
      ),
    );
  }
}

export async function POST(request: Request) {
  const blocked = validateCsrf(request); if (blocked) return blocked;

  const requestId = request.headers.get('x-request-id')?.trim() || createRequestId();
  const log = createLogger({ request_id: requestId, route: '/api/planner' });

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

    const [body, bodyErr] = await validateBody(request, PlannerCreateSchema);
    if (bodyErr) return withResponseRequestId(bodyErr);

    const payload = body as PlannerCreateBody;
    const workspaceBusinessId = request.headers.get('x-biz-id')?.trim();

    if (workspaceBusinessId && workspaceBusinessId !== payload.businessId) {
      return withResponseRequestId(
        NextResponse.json({ error: 'forbidden', message: 'businessId does not match current workspace', request_id: requestId }, { status: 403 }),
      );
    }

    const hasAccess = await ensureBusinessAccess(supabase, payload.businessId);
    if (!hasAccess) {
      return withResponseRequestId(NextResponse.json({ error: 'forbidden', message: 'No access to this business', request_id: requestId }, { status: 403 }));
    }

    const linkedStatus = await validateLinkedEntity({
      supabase,
      itemType: payload.itemType,
      suggestionId: payload.suggestionId,
      assetId: payload.assetId,
      textPostId: payload.textPostId,
      businessId: payload.businessId,
    });

    if (linkedStatus === 'not_found') {
      return withResponseRequestId(
        NextResponse.json({ error: 'not_found', message: 'Linked item not found', request_id: requestId }, { status: 404 }),
      );
    }

    if (linkedStatus === 'forbidden') {
      return withResponseRequestId(
        NextResponse.json({ error: 'forbidden', message: 'Linked item does not belong to current workspace', request_id: requestId }, { status: 403 }),
      );
    }

    const normalizedWeekStart = normalizeWeekStartMonday(payload.weekStart);
    const scheduledAt = toIsoString(payload.scheduledAt);
    const title = payload.title.trim();
    const notes = payload.notes ? payload.notes.trim() : null;

    const { data: existingRows, error: existingError } = await supabase
      .from('content_planner_items')
      .select('id, scheduled_at, channel, item_type, title, status, suggestion_id, asset_id, text_post_id')
      .eq('business_id', payload.businessId)
      .eq('scheduled_at', scheduledAt)
      .eq('channel', payload.channel)
      .eq('title', title)
      .order('created_at', { ascending: false })
      .limit(1);

    if (existingError) {
      log.error('Failed to check planner dedup', { error: existingError.message, business_id: payload.businessId });
      return withResponseRequestId(
        NextResponse.json({ error: 'db_error', message: 'Failed to save planner item', request_id: requestId }, { status: 500 }),
      );
    }

    const existingItem = (existingRows || [])[0] as PlannerListItemRow | undefined;
    if (existingItem) {
      return withResponseRequestId(
        NextResponse.json({ item: existingItem, deduped: true, request_id: requestId }),
      );
    }

    const suggestionId = payload.itemType === 'suggestion' ? payload.suggestionId || null : null;
    const assetId = payload.itemType === 'asset' ? payload.assetId || null : null;
    const textPostId = payload.itemType === 'text' ? payload.textPostId || null : null;

    const { data: insertedData, error: insertError } = await supabase
      .from('content_planner_items')
      .insert({
        business_id: payload.businessId,
        week_start: normalizedWeekStart,
        scheduled_at: scheduledAt,
        channel: payload.channel,
        item_type: payload.itemType,
        suggestion_id: suggestionId,
        asset_id: assetId,
        text_post_id: textPostId,
        title,
        notes,
        status: 'planned',
      })
      .select('id, scheduled_at, channel, item_type, title, status, suggestion_id, asset_id, text_post_id')
      .single();

    if (insertError || !insertedData) {
      log.error('Failed to insert planner item', { error: insertError?.message || 'unknown', business_id: payload.businessId });
      return withResponseRequestId(
        NextResponse.json({ error: 'db_error', message: 'Failed to save planner item', request_id: requestId }, { status: 500 }),
      );
    }

    const item = insertedData as PlannerListItemRow;

    await bumpDailyMetric(
      payload.businessId,
      new Date().toISOString().slice(0, 10),
      { planner_items_added: 1 },
      { log },
    );

    return withResponseRequestId(
      NextResponse.json({ item, deduped: false, request_id: requestId }, { status: 201 }),
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown';
    log.error('Unhandled planner POST error', { error: message });
    return withResponseRequestId(
      NextResponse.json(
        { error: 'internal_error', message: 'Error intern del servidor', request_id: requestId },
        { status: 500 },
      ),
    );
  }
}
