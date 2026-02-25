export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { validateCsrf } from '@/lib/security/csrf';

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createLogger, createRequestId } from '@/lib/logger';
import { hasAcceptedBusinessMembership } from '@/lib/authz';
import {
  generateConnectorSecret,
  normalizeConnectorChannels,
  syncBusinessLegacyWebhook,
  toPublicConnector,
  validateConnectorUrl,
  type ConnectorRow,
} from '@/lib/integrations/connectors';
import {
  validateBody,
  validateParams,
  IntegrationsConnectorPatchSchema,
  IntegrationsConnectorParamsSchema,
} from '@/lib/validations';

type PatchBody = {
  enabled?: boolean;
  url?: string | null;
  allowed_channels?: Array<'ig_feed' | 'ig_story' | 'ig_reel'>;
  regenerateSecret?: boolean;
};

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const blocked = validateCsrf(request); if (blocked) return blocked;

  const requestId = request.headers.get('x-request-id')?.trim() || createRequestId();
  const log = createLogger({ request_id: requestId, route: '/api/integrations/connectors/[id]' });

  const withRequestId = (response: NextResponse) => {
    response.headers.set('x-request-id', requestId);
    return response;
  };

  try {
    const supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return withRequestId(
        NextResponse.json({ error: 'unauthorized', message: 'Auth required', request_id: requestId }, { status: 401 }),
      );
    }

    const businessId = request.headers.get('x-biz-id')?.trim();
    if (!businessId) {
      return withRequestId(
        NextResponse.json({ error: 'validation_error', message: 'Missing x-biz-id workspace header', request_id: requestId }, { status: 400 }),
      );
    }

    const [routeParams, paramsErr] = validateParams(params, IntegrationsConnectorParamsSchema);
    if (paramsErr) return withRequestId(paramsErr);

    const [body, bodyErr] = await validateBody(request, IntegrationsConnectorPatchSchema);
    if (bodyErr) return withRequestId(bodyErr);
    const payload = body as PatchBody;

    const businessAccess = await hasAcceptedBusinessMembership({
      supabase,
      userId: user.id,
      businessId,
      allowedRoles: ['owner', 'admin'],
    });
    if (!businessAccess.allowed) {
      return withRequestId(
        NextResponse.json({ error: 'forbidden', message: 'No tens permisos per gestionar integracions', request_id: requestId }, { status: 403 }),
      );
    }

    const { data: existingData, error: existingError } = await supabase
      .from('connectors')
      .select('id, business_id, type, enabled, url, secret, allowed_channels, created_at, updated_at')
      .eq('id', routeParams.id)
      .eq('business_id', businessId)
      .single();

    if (existingError || !existingData) {
      return withRequestId(
        NextResponse.json({ error: 'not_found', message: 'Connector not found', request_id: requestId }, { status: 404 }),
      );
    }

    const existing = existingData as ConnectorRow;
    const nextEnabled = payload.enabled ?? existing.enabled;
    const nextUrl = payload.url !== undefined
      ? (asText(payload.url) || null)
      : (asText(existing.url) || null);
    const nextChannels = payload.allowed_channels !== undefined
      ? normalizeConnectorChannels(payload.allowed_channels, 'api')
      : normalizeConnectorChannels(existing.allowed_channels, 'all');
    const nextSecret = payload.regenerateSecret
      ? generateConnectorSecret()
      : (asText(existing.secret) || null);

    if (nextEnabled && !nextUrl) {
      return withRequestId(
        NextResponse.json({ error: 'validation_error', message: 'url is required when webhook is enabled', request_id: requestId }, { status: 400 }),
      );
    }

    const urlValidation = validateConnectorUrl(nextUrl);
    if (!urlValidation.ok) {
      return withRequestId(
        NextResponse.json({ error: 'validation_error', message: urlValidation.error, request_id: requestId }, { status: 400 }),
      );
    }

    const { data: updatedData, error: updateError } = await supabase
      .from('connectors')
      .update({
        enabled: nextEnabled,
        url: nextUrl,
        secret: nextSecret,
        allowed_channels: nextChannels,
      })
      .eq('id', routeParams.id)
      .eq('business_id', businessId)
      .select('id, business_id, type, enabled, url, secret, allowed_channels, created_at, updated_at')
      .single();

    if (updateError || !updatedData) {
      log.error('Failed to update connector', { error: updateError?.message || 'unknown', connector_id: routeParams.id });
      return withRequestId(
        NextResponse.json({ error: 'db_error', message: 'Failed to update connector', request_id: requestId }, { status: 500 }),
      );
    }

    const updated = updatedData as ConnectorRow;
    await syncBusinessLegacyWebhook(supabase, businessId, {
      enabled: updated.enabled,
      url: updated.url,
      secret: updated.secret,
      allowed_channels: updated.allowed_channels,
    });

    return withRequestId(
      NextResponse.json({ connector: toPublicConnector(updated), request_id: requestId }),
    );
  } catch (error: unknown) {
    log.error('Unhandled integrations connectors PATCH error', {
      error: error instanceof Error ? error.message : 'unknown',
    });
    return withRequestId(
      NextResponse.json({ error: 'internal_error', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
    );
  }
}
