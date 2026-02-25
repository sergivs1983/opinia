export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { validateCsrf } from '@/lib/security/csrf';

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createLogger, createRequestId } from '@/lib/logger';
import { hasAcceptedOrgMembership } from '@/lib/authz';
import { requireBizAccess } from '@/lib/api-handler';
import {
  ensureLegacyWebhookConnector,
  generateConnectorSecret,
  normalizeConnectorChannels,
  syncBusinessLegacyWebhook,
  toPublicConnector,
  validateConnectorUrl,
  type ConnectorRow,
  type LegacyWebhookBusinessConfig,
} from '@/lib/integrations/connectors';
import {
  validateBody,
  IntegrationsConnectorsUpsertSchema,
} from '@/lib/validations';

type UpsertBody = {
  type: 'webhook';
  enabled: boolean;
  url?: string | null;
  allowed_channels: Array<'ig_feed' | 'ig_story' | 'ig_reel'>;
  regenerateSecret?: boolean;
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

async function loadWebhookConnectorRows(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  businessId: string,
): Promise<ConnectorRow[]> {
  const { data, error } = await supabase
    .from('connectors')
    .select('id, business_id, type, enabled, url, secret, allowed_channels, created_at, updated_at')
    .eq('business_id', businessId)
    .eq('type', 'webhook')
    .order('created_at', { ascending: true });

  if (error || !Array.isArray(data)) return [];
  return data as ConnectorRow[];
}

export async function GET(request: Request) {
  const requestId = request.headers.get('x-request-id')?.trim() || createRequestId();
  const log = createLogger({ request_id: requestId, route: '/api/integrations/connectors' });

  const withRequestId = (response: NextResponse) => {
    response.headers.set('x-request-id', requestId);
    return response;
  };

  try {
    const supabase = createServerSupabaseClient();
    const admin = createAdminClient();
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

    // ── Layer 1: biz-level membership guard ──────────────────────────────────
    // 400 UUID invàlid | 404 biz no existeix | 403 BIZ_FORBIDDEN sense accés
    const bizGuard = await requireBizAccess({ supabase, userId: user.id, bizId: businessId });
    if (bizGuard) return withRequestId(bizGuard);

    // ── Layer 2: role check (integrations management requires owner/admin) ───
    const business = await loadBusiness(supabase, businessId);
    if (!business) {
      // Defensiu: no hauria de passar si el guard ha passat, però protegim el race
      return withRequestId(
        NextResponse.json({ error: 'not_found', message: 'Negoci no trobat', request_id: requestId }, { status: 404 }),
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
        NextResponse.json({ error: 'forbidden', code: 'ROLE_INSUFFICIENT', message: 'Calen permisos owner/admin per gestionar integracions', request_id: requestId }, { status: 403 }),
      );
    }

    let connectors = await loadWebhookConnectorRows(supabase, businessId);
    if (connectors.length === 0) {
      const created = await ensureLegacyWebhookConnector({
        admin,
        businessId,
        legacy: {
          webhook_enabled: business.webhook_enabled,
          webhook_url: business.webhook_url,
          webhook_secret: business.webhook_secret,
          webhook_channels: business.webhook_channels,
        } satisfies LegacyWebhookBusinessConfig,
      });

      if (created) connectors = [created];
    }

    const publicConnectors = connectors.map((connector) => {
      const sanitized = toPublicConnector(connector);
      return {
        ...sanitized,
        secret_present: sanitized.secret_present,
      };
    });

    return withRequestId(
      NextResponse.json({
        connectors: publicConnectors,
        request_id: requestId,
      }),
    );
  } catch (error: unknown) {
    log.error('Unhandled integrations connectors GET error', {
      error: error instanceof Error ? error.message : 'unknown',
    });
    return withRequestId(
      NextResponse.json({ error: 'internal_error', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
    );
  }
}

export async function POST(request: Request) {
  const blocked = validateCsrf(request); if (blocked) return blocked;

  const requestId = request.headers.get('x-request-id')?.trim() || createRequestId();
  const log = createLogger({ request_id: requestId, route: '/api/integrations/connectors' });

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

    const [body, bodyErr] = await validateBody(request, IntegrationsConnectorsUpsertSchema);
    if (bodyErr) return withRequestId(bodyErr);
    const payload = body as UpsertBody;

    // ── Layer 1: biz-level membership guard ──────────────────────────────────
    const bizGuard = await requireBizAccess({ supabase, userId: user.id, bizId: businessId });
    if (bizGuard) return withRequestId(bizGuard);

    // ── Layer 2: role check (owner/admin only for writes) ────────────────────
    const business = await loadBusiness(supabase, businessId);
    if (!business) {
      return withRequestId(
        NextResponse.json({ error: 'not_found', message: 'Negoci no trobat', request_id: requestId }, { status: 404 }),
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
        NextResponse.json({ error: 'forbidden', code: 'ROLE_INSUFFICIENT', message: 'Calen permisos owner/admin per gestionar integracions', request_id: requestId }, { status: 403 }),
      );
    }

    const url = asText(payload.url) || null;
    const urlValidation = validateConnectorUrl(url);
    if (!urlValidation.ok) {
      return withRequestId(
        NextResponse.json({ error: 'validation_error', message: urlValidation.error, request_id: requestId }, { status: 400 }),
      );
    }

    const allowedChannels = normalizeConnectorChannels(payload.allowed_channels, 'api');

    const existingRows = await loadWebhookConnectorRows(supabase, businessId);
    const existing = existingRows[0] || null;
    const shouldGenerateSecret = payload.regenerateSecret || !asText(existing?.secret);
    const secret = shouldGenerateSecret
      ? generateConnectorSecret()
      : asText(existing?.secret) || null;

    const updatePayload = {
      business_id: businessId,
      type: 'webhook' as const,
      enabled: payload.enabled,
      url,
      secret,
      allowed_channels: allowedChannels,
    };

    let saved: ConnectorRow | null = null;
    if (existing) {
      const { data, error } = await supabase
        .from('connectors')
        .update(updatePayload)
        .eq('id', existing.id)
        .select('id, business_id, type, enabled, url, secret, allowed_channels, created_at, updated_at')
        .single();

      if (error || !data) {
        log.error('Failed to update connector', { error: error?.message || 'unknown', business_id: businessId });
        return withRequestId(
          NextResponse.json({ error: 'db_error', message: 'Failed to update connector', request_id: requestId }, { status: 500 }),
        );
      }
      saved = data as ConnectorRow;
    } else {
      const { data, error } = await supabase
        .from('connectors')
        .insert(updatePayload)
        .select('id, business_id, type, enabled, url, secret, allowed_channels, created_at, updated_at')
        .single();

      if (error || !data) {
        log.error('Failed to insert connector', { error: error?.message || 'unknown', business_id: businessId });
        return withRequestId(
          NextResponse.json({ error: 'db_error', message: 'Failed to create connector', request_id: requestId }, { status: 500 }),
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
      NextResponse.json({
        connector: toPublicConnector(saved),
        request_id: requestId,
      }),
    );
  } catch (error: unknown) {
    log.error('Unhandled integrations connectors POST error', {
      error: error instanceof Error ? error.message : 'unknown',
    });
    return withRequestId(
      NextResponse.json({ error: 'internal_error', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
    );
  }
}
