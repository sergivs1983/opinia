export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getAdminClient } from '@/lib/supabase/admin';
import { assertServiceRoleAllowed } from '@/lib/security/service-role';
import { createLogger, createRequestId } from '@/lib/logger';
import { hasAcceptedOrgMembership } from '@/lib/authz';
import {
  ensureLegacyWebhookConnector,
  normalizeConnectorChannels,
  syncBusinessLegacyWebhook,
  validateConnectorUrl,
  type ConnectorRow,
  type LegacyWebhookBusinessConfig,
} from '@/lib/integrations/connectors';
import { validateBody, WebhookConfigSchema } from '@/lib/validations';
import type { ContentPlannerChannel } from '@/types/database';

type WebhookConfigBody = {
  enabled: boolean;
  url?: string | null;
  channels: ContentPlannerChannel[];
};

type BusinessLegacyRow = {
  id: string;
  org_id: string;
  webhook_enabled: boolean | null;
  webhook_url: string | null;
  webhook_secret: string | null;
  webhook_channels: string[] | null;
};

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toConfigPayload(args: {
  enabled: boolean;
  url: string | null;
  channels: ContentPlannerChannel[];
  requestId: string;
}) {
  return {
    enabled: args.enabled,
    url: args.url,
    channels: args.channels,
    request_id: args.requestId,
  };
}

async function loadBusiness(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  businessId: string,
): Promise<BusinessLegacyRow | null> {
  const { data, error } = await supabase
    .from('businesses')
    .select('id, org_id, webhook_enabled, webhook_url, webhook_secret, webhook_channels')
    .eq('id', businessId)
    .single();

  if (error || !data) return null;
  return data as BusinessLegacyRow;
}

async function loadConnector(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  businessId: string,
): Promise<ConnectorRow | null> {
  const { data, error } = await supabase
    .from('connectors')
    .select('id, business_id, type, enabled, url, secret, allowed_channels, created_at, updated_at')
    .eq('business_id', businessId)
    .eq('type', 'webhook')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data as ConnectorRow;
}

export async function GET(request: Request) {
  const serviceBlocked = assertServiceRoleAllowed(request);
  if (serviceBlocked) return serviceBlocked;
  const requestId = request.headers.get('x-request-id')?.trim() || createRequestId();
  const log = createLogger({ request_id: requestId, route: '/api/webhooks/config' });

  const withRequestId = (response: NextResponse) => {
    response.headers.set('x-request-id', requestId);
    return response;
  };

  try {
    const supabase = createServerSupabaseClient();
    const admin = getAdminClient();
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

    const business = await loadBusiness(supabase, businessId);
    if (!business) {
      return withRequestId(
        NextResponse.json({ error: 'forbidden', message: 'No access to this business', request_id: requestId }, { status: 403 }),
      );
    }
    const canManageIntegrations = await hasAcceptedOrgMembership({
      supabase,
      userId: user.id,
      orgId: business.org_id,
      allowedRoles: ['owner', 'admin'],
    });
    if (!canManageIntegrations) {
      return withRequestId(
        NextResponse.json({ error: 'forbidden', message: 'No tens permisos per gestionar integracions', request_id: requestId }, { status: 403 }),
      );
    }

    let connector = await loadConnector(supabase, businessId);
    if (!connector) {
      connector = await ensureLegacyWebhookConnector({
        admin,
        businessId,
        legacy: {
          webhook_enabled: business.webhook_enabled,
          webhook_url: business.webhook_url,
          webhook_secret: business.webhook_secret,
          webhook_channels: business.webhook_channels,
        } satisfies LegacyWebhookBusinessConfig,
      });
    }

    if (connector) {
      return withRequestId(
        NextResponse.json(toConfigPayload({
          enabled: !!connector.enabled,
          url: connector.url || null,
          channels: normalizeConnectorChannels(connector.allowed_channels, 'all'),
          requestId,
        })),
      );
    }

    return withRequestId(
      NextResponse.json(toConfigPayload({
        enabled: !!business.webhook_enabled,
        url: business.webhook_url || null,
        channels: normalizeConnectorChannels(business.webhook_channels, 'all'),
        requestId,
      })),
    );
  } catch (error: unknown) {
    log.error('Unhandled webhook config GET error', {
      error: error instanceof Error ? error.message : 'unknown',
    });
    return withRequestId(
      NextResponse.json({ error: 'internal_error', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
    );
  }
}

export async function PATCH(request: Request) {
  const serviceBlocked = assertServiceRoleAllowed(request);
  if (serviceBlocked) return serviceBlocked;
  const requestId = request.headers.get('x-request-id')?.trim() || createRequestId();
  const log = createLogger({ request_id: requestId, route: '/api/webhooks/config' });

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

    const [body, bodyErr] = await validateBody(request, WebhookConfigSchema);
    if (bodyErr) return withRequestId(bodyErr);
    const payload = body as WebhookConfigBody;

    const business = await loadBusiness(supabase, businessId);
    if (!business) {
      return withRequestId(
        NextResponse.json({ error: 'forbidden', message: 'No access to this business', request_id: requestId }, { status: 403 }),
      );
    }
    const canManageIntegrations = await hasAcceptedOrgMembership({
      supabase,
      userId: user.id,
      orgId: business.org_id,
      allowedRoles: ['owner', 'admin'],
    });
    if (!canManageIntegrations) {
      return withRequestId(
        NextResponse.json({ error: 'forbidden', message: 'No tens permisos per gestionar integracions', request_id: requestId }, { status: 403 }),
      );
    }

    const url = asText(payload.url) || null;
    const urlValidation = validateConnectorUrl(url);
    if (!urlValidation.ok) {
      return withRequestId(
        NextResponse.json({ error: 'validation_error', message: urlValidation.error, request_id: requestId }, { status: 400 }),
      );
    }

    const channels = normalizeConnectorChannels(payload.channels, 'all');
    const existing = await loadConnector(supabase, businessId);
    const secret = asText(existing?.secret) || asText(business.webhook_secret) || randomBytes(24).toString('hex');

    let saved: ConnectorRow | null = null;
    if (existing) {
      const { data, error } = await supabase
        .from('connectors')
        .update({
          enabled: payload.enabled,
          url,
          secret,
          allowed_channels: channels,
        })
        .eq('id', existing.id)
        .select('id, business_id, type, enabled, url, secret, allowed_channels, created_at, updated_at')
        .single();

      if (error || !data) {
        log.error('Failed to update webhook connector', { error: error?.message || 'unknown', business_id: businessId });
        return withRequestId(
          NextResponse.json({ error: 'db_error', message: 'Failed to update webhook config', request_id: requestId }, { status: 500 }),
        );
      }
      saved = data as ConnectorRow;
    } else {
      const { data, error } = await supabase
        .from('connectors')
        .insert({
          business_id: businessId,
          type: 'webhook',
          enabled: payload.enabled,
          url,
          secret,
          allowed_channels: channels,
        })
        .select('id, business_id, type, enabled, url, secret, allowed_channels, created_at, updated_at')
        .single();

      if (error || !data) {
        log.error('Failed to create webhook connector', { error: error?.message || 'unknown', business_id: businessId });
        return withRequestId(
          NextResponse.json({ error: 'db_error', message: 'Failed to update webhook config', request_id: requestId }, { status: 500 }),
        );
      }
      saved = data as ConnectorRow;
    }

    await syncBusinessLegacyWebhook(supabase, businessId, {
      enabled: saved.enabled,
      url: saved.url,
      secret: saved.secret,
      allowed_channels: saved.allowed_channels,
    });

    return withRequestId(
      NextResponse.json(toConfigPayload({
        enabled: !!saved.enabled,
        url: saved.url || null,
        channels: normalizeConnectorChannels(saved.allowed_channels, 'all'),
        requestId,
      })),
    );
  } catch (error: unknown) {
    log.error('Unhandled webhook config PATCH error', {
      error: error instanceof Error ? error.message : 'unknown',
    });
    return withRequestId(
      NextResponse.json({ error: 'internal_error', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
    );
  }
}
