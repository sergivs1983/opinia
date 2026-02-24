import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createLogger, createRequestId } from '@/lib/logger';
import { bumpDailyMetric } from '@/lib/metrics';
import { sendPlannerItemWebhook } from '@/lib/webhooks';
import { hasAcceptedBusinessMembership } from '@/lib/authz';
import { asMembershipRoleFilter, PUBLISH_ROLES } from '@/lib/roles';
import {
  validateBody,
  validateParams,
  PlannerPatchSchema,
  PlannerItemParamsSchema,
} from '@/lib/validations';
import type {
  ContentPlannerChannel,
  ContentPlannerItemType,
  ContentPlannerStatus,
} from '@/types/database';

interface PlannerPatchBody {
  status?: ContentPlannerStatus;
  scheduledAt?: string;
  notes?: string;
}

type PlannerExistingRow = {
  id: string;
  business_id: string;
  scheduled_at: string;
  channel: ContentPlannerChannel;
  item_type: ContentPlannerItemType;
  title: string;
  status: ContentPlannerStatus;
  suggestion_id: string | null;
  asset_id: string | null;
  text_post_id: string | null;
};

type BusinessWebhookRow = {
  id: string;
  org_id: string;
  name: string;
  default_language: string | null;
  webhook_enabled: boolean | null;
  webhook_url: string | null;
  webhook_secret: string | null;
  webhook_channels: string[] | null;
};

function toIsoString(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const requestId = request.headers.get('x-request-id')?.trim() || createRequestId();
  const log = createLogger({ request_id: requestId, route: '/api/planner/[id]' });

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

    const [routeParams, paramsErr] = validateParams(params, PlannerItemParamsSchema);
    if (paramsErr) return withResponseRequestId(paramsErr);

    const [body, bodyErr] = await validateBody(request, PlannerPatchSchema);
    if (bodyErr) return withResponseRequestId(bodyErr);

    const payload = body as PlannerPatchBody;

    const { data: existingData, error: existingError } = await supabase
      .from('content_planner_items')
      .select('id, business_id, scheduled_at, channel, item_type, title, status, suggestion_id, asset_id, text_post_id')
      .eq('id', routeParams.id)
      .single();

    if (existingError || !existingData) {
      return withResponseRequestId(NextResponse.json({ error: 'not_found', message: 'Planner item not found' }, { status: 404 }));
    }

    const existingItem = existingData as PlannerExistingRow;
    const workspaceBusinessId = request.headers.get('x-biz-id')?.trim();

    if (workspaceBusinessId && workspaceBusinessId !== existingItem.business_id) {
      return withResponseRequestId(
        NextResponse.json({ error: 'forbidden', message: 'Planner item does not belong to current workspace', request_id: requestId }, { status: 403 }),
      );
    }

    const { data: businessAccess, error: businessAccessError } = await supabase
      .from('businesses')
      .select('id, org_id, name, default_language, webhook_enabled, webhook_url, webhook_secret, webhook_channels')
      .eq('id', existingItem.business_id)
      .single();

    if (businessAccessError || !businessAccess) {
      return withResponseRequestId(NextResponse.json({ error: 'forbidden', message: 'No access to this business', request_id: requestId }, { status: 403 }));
    }
    const business = businessAccess as BusinessWebhookRow;

    const updatePayload: Record<string, string> = {};
    if (payload.status !== undefined) updatePayload.status = payload.status;
    if (payload.scheduledAt !== undefined) updatePayload.scheduled_at = toIsoString(payload.scheduledAt);
    if (payload.notes !== undefined) updatePayload.notes = payload.notes.trim();

    if (payload.status === 'published') {
      const publishAccess = await hasAcceptedBusinessMembership({
        supabase,
        userId: user.id,
        businessId: existingItem.business_id,
        allowedRoles: asMembershipRoleFilter(PUBLISH_ROLES),
      });
      if (!publishAccess.allowed) {
        return withResponseRequestId(
          NextResponse.json({ error: 'forbidden', message: 'No tens permisos per publicar', request_id: requestId }, { status: 403 }),
        );
      }
    }

    const hasUpdates = Object.keys(updatePayload).length > 0;
    if (!hasUpdates) {
      return withResponseRequestId(NextResponse.json({ item: existingItem, request_id: requestId }));
    }

    const { data: updatedData, error: updateError } = await supabase
      .from('content_planner_items')
      .update(updatePayload)
      .eq('id', routeParams.id)
      .select('id, scheduled_at, channel, item_type, title, status, suggestion_id, asset_id, text_post_id')
      .single();

    if (updateError || !updatedData) {
      log.error('Failed to update planner item', { error: updateError?.message || 'unknown', item_id: routeParams.id });
      return withResponseRequestId(
        NextResponse.json({ error: 'db_error', message: 'Failed to update planner item', request_id: requestId }, { status: 500 }),
      );
    }

    const updatedItem = updatedData as PlannerExistingRow;

    if (existingItem.status !== 'published' && updatedItem.status === 'published') {
      await bumpDailyMetric(
        existingItem.business_id,
        new Date().toISOString().slice(0, 10),
        { planner_items_published: 1 },
        { log },
      );

      void sendPlannerItemWebhook({
        event: 'planner.published',
        business,
        plannerItem: {
          id: updatedItem.id,
          business_id: existingItem.business_id,
          scheduled_at: updatedItem.scheduled_at,
          channel: updatedItem.channel,
          title: updatedItem.title,
          suggestion_id: updatedItem.suggestion_id,
          asset_id: updatedItem.asset_id,
        },
        requestId,
        userId: user.id,
        log: log.child({ hook: 'planner.published' }),
      }).catch((webhookError: unknown) => {
        log.warn('planner.published webhook dispatch failed (non-blocking)', {
          item_id: updatedItem.id,
          error: webhookError instanceof Error ? webhookError.message : 'unknown',
        });
      });
    }

    return withResponseRequestId(NextResponse.json({ item: updatedItem, request_id: requestId }));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown';
    log.error('Unhandled planner PATCH error', { error: message });
    return withResponseRequestId(
      NextResponse.json(
        { error: 'internal_error', message: 'Error intern del servidor', request_id: requestId },
        { status: 500 },
      ),
    );
  }
}
