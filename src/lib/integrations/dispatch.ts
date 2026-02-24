import { createAdminClient } from '@/lib/supabase/admin';
import { createLogger, createRequestId, type AppLogger } from '@/lib/logger';
import { signPayload } from '@/lib/integrations/crypto';
import type { IntegrationEvent, IntegrationEventPayload } from '@/lib/integrations/events';
import {
  ensureLegacyWebhookConnector,
  normalizeConnectorChannels,
  validateConnectorUrl,
  type ConnectorRow,
  type LegacyWebhookBusinessConfig,
} from '@/lib/integrations/connectors';
import type { JsonObject } from '@/types/json';

const DELIVERY_TIMEOUT_MS = 5_000;
const DELIVERY_RETRY_COUNT = 1;
const DELIVERY_COOLDOWN_MS = 60_000;
const SIGN_FALLBACK_SECRET = process.env.WEBHOOK_SIGN_FALLBACK_SECRET || '';

type AdminClient = ReturnType<typeof createAdminClient>;

type BusinessContextRow = {
  id: string;
  org_id: string;
  name: string;
  webhook_enabled: boolean | null;
  webhook_url: string | null;
  webhook_secret: string | null;
  webhook_channels: string[] | null;
};

export interface DispatchConnector {
  id: string | null;
  business_id: string;
  type: 'webhook';
  enabled: boolean;
  url: string | null;
  secret: string | null;
  allowed_channels: string[];
}

export interface DeliveryRecord {
  connectorId: string | null;
  status: 'sent' | 'failed' | 'skipped';
  responseCode: number | null;
  error?: string;
}

export interface DispatchResult {
  status: 'sent' | 'failed' | 'skipped';
  responseCode: number | null;
  error?: string;
  requestId: string;
  deliveries: DeliveryRecord[];
}

export interface DispatchEventArgs {
  businessId: string;
  event: IntegrationEvent;
  data: Record<string, unknown>;
  requestId?: string;
  userId?: string | null;
  plannerItemId?: string | null;
  connectorsOverride?: DispatchConnector[];
  admin?: AdminClient;
  log?: AppLogger;
  dependencies?: DispatchDependencies;
}

export interface DispatchDependencies {
  fetchImpl?: typeof fetch;
  now?: () => Date;
  loadContext?: (args: {
    admin: AdminClient;
    businessId: string;
    connectorsOverride?: DispatchConnector[];
    log: AppLogger;
  }) => Promise<{ business: BusinessContextRow; connectors: DispatchConnector[] } | null>;
  isCooldown?: (args: {
    admin: AdminClient;
    connectorId: string | null;
    businessId: string;
    event: IntegrationEvent;
    plannerItemId: string | null;
    nowIso: string;
  }) => Promise<boolean>;
  recordDelivery?: (args: {
    admin: AdminClient;
    businessId: string;
    connectorId: string | null;
    plannerItemId: string | null;
    event: IntegrationEvent;
    status: 'sent' | 'failed';
    responseCode: number | null;
    error: string | null;
    requestId: string;
    log: AppLogger;
  }) => Promise<void>;
  enqueueDlq?: (args: {
    admin: AdminClient;
    business: BusinessContextRow;
    connectorId: string | null;
    plannerItemId: string | null;
    event: IntegrationEvent;
    requestId: string;
    userId?: string | null;
    error: string;
    responseCode: number | null;
  }) => Promise<void>;
}

interface SendAttemptResult {
  status: 'sent' | 'failed';
  responseCode: number | null;
  error?: string;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function clampError(value: string): string {
  return value.slice(0, 500);
}

function buildLogger(log: AppLogger | undefined, requestId: string): AppLogger {
  return log || createLogger({ request_id: requestId, route: '/lib/integrations/dispatch' });
}

function resolvePlannerItemId(
  explicitPlannerItemId: string | null | undefined,
  data: Record<string, unknown>,
): string | null {
  if (asText(explicitPlannerItemId)) return asText(explicitPlannerItemId);
  const item = data.item;
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    const itemId = asText((item as Record<string, unknown>).id);
    if (itemId) return itemId;
  }
  const fromData = asText(data.planner_item_id);
  return fromData || null;
}

function resolveEventChannel(data: Record<string, unknown>): string | null {
  const direct = asText(data.channel);
  if (direct) return direct;
  const item = data.item;
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    const fromItem = asText((item as Record<string, unknown>).channel);
    return fromItem || null;
  }
  return null;
}

function shouldRetry(responseCode: number | null, attempt: number, maxAttempt: number): boolean {
  if (attempt >= maxAttempt) return false;
  if (responseCode === null) return true;
  if (responseCode >= 500) return true;
  if (responseCode === 429) return true;
  return false;
}

async function sendWithRetry(args: {
  url: string;
  body: string;
  headers: Record<string, string>;
  timeoutMs: number;
  retryCount: number;
  fetchImpl: typeof fetch;
}): Promise<SendAttemptResult> {
  const { url, body, headers, timeoutMs, retryCount, fetchImpl } = args;

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    let responseCode: number | null = null;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetchImpl(url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));
      responseCode = response.status;

      if (response.ok) {
        return { status: 'sent', responseCode };
      }

      const bodyText = clampError((await response.text().catch(() => '')).trim());
      const baseError = bodyText
        ? `Webhook responded ${response.status}: ${bodyText}`
        : `Webhook responded ${response.status}`;

      if (shouldRetry(response.status, attempt, retryCount)) continue;
      return { status: 'failed', responseCode, error: baseError };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'webhook_fetch_failed';
      if (shouldRetry(responseCode, attempt, retryCount)) continue;
      return { status: 'failed', responseCode, error: clampError(message) };
    }
  }

  return {
    status: 'failed',
    responseCode: null,
    error: 'Webhook delivery failed after retries',
  };
}

async function defaultRecordDelivery(args: {
  admin: AdminClient;
  businessId: string;
  connectorId: string | null;
  plannerItemId: string | null;
  event: IntegrationEvent;
  status: 'sent' | 'failed';
  responseCode: number | null;
  error: string | null;
  requestId: string;
  log: AppLogger;
}): Promise<void> {
  const { error } = await args.admin.from('webhook_deliveries').insert({
    business_id: args.businessId,
    connector_id: args.connectorId,
    planner_item_id: args.plannerItemId,
    event: args.event,
    status: args.status,
    response_code: args.responseCode,
    error: args.error,
    request_id: args.requestId,
  });

  if (error) {
    args.log.warn('Failed to insert webhook delivery (non-blocking)', {
      error: error.message,
      business_id: args.businessId,
      connector_id: args.connectorId,
      planner_item_id: args.plannerItemId,
      event: args.event,
      status: args.status,
    });
  }
}

async function defaultIsCooldown(args: {
  admin: AdminClient;
  connectorId: string | null;
  businessId: string;
  event: IntegrationEvent;
  plannerItemId: string | null;
  nowIso: string;
}): Promise<boolean> {
  const threshold = new Date(new Date(args.nowIso).getTime() - DELIVERY_COOLDOWN_MS).toISOString();
  let query = args.admin
    .from('webhook_deliveries')
    .select('id', { head: true, count: 'exact' })
    .eq('business_id', args.businessId)
    .eq('event', args.event)
    .gte('created_at', threshold);

  if (args.connectorId) query = query.eq('connector_id', args.connectorId);
  else query = query.is('connector_id', null);

  if (args.plannerItemId) query = query.eq('planner_item_id', args.plannerItemId);
  else query = query.is('planner_item_id', null);

  const { count, error } = await query;
  if (error) return false;
  return typeof count === 'number' && count >= 1;
}

async function defaultEnqueueDlq(args: {
  admin: AdminClient;
  business: BusinessContextRow;
  connectorId: string | null;
  plannerItemId: string | null;
  event: IntegrationEvent;
  requestId: string;
  userId?: string | null;
  error: string;
  responseCode: number | null;
}): Promise<void> {
  const payload: JsonObject = {
    request_id: args.requestId,
    event: args.event,
    connector_id: args.connectorId,
    planner_item_id: args.plannerItemId,
    response_code: args.responseCode,
  };

  const { error: dlqError } = await args.admin.from('failed_jobs').insert({
    org_id: args.business.org_id,
    biz_id: args.business.id,
    job_type: 'webhook_delivery',
    payload,
    error_code: 'webhook_delivery_failed',
    error_message: clampError(args.error || 'webhook_delivery_failed'),
    provider: 'webhook',
    model: null,
    status: 'queued',
    next_retry_at: new Date(Date.now() + 60_000).toISOString(),
  });

  if (dlqError) return;

  await args.admin.from('activity_log').insert({
    org_id: args.business.org_id,
    biz_id: args.business.id,
    user_id: args.userId || null,
    action: 'dlq_enqueued',
    target_type: 'webhook_delivery',
    metadata: {
      request_id: args.requestId,
      event: args.event,
      connector_id: args.connectorId,
      planner_item_id: args.plannerItemId,
      error_code: 'webhook_delivery_failed',
    },
  });
}

async function defaultLoadContext(args: {
  admin: AdminClient;
  businessId: string;
  connectorsOverride?: DispatchConnector[];
  log: AppLogger;
}): Promise<{ business: BusinessContextRow; connectors: DispatchConnector[] } | null> {
  const { data: businessData, error: businessError } = await args.admin
    .from('businesses')
    .select('id, org_id, name, webhook_enabled, webhook_url, webhook_secret, webhook_channels')
    .eq('id', args.businessId)
    .single();

  if (businessError || !businessData) return null;
  const business = businessData as BusinessContextRow;

  if (Array.isArray(args.connectorsOverride)) {
    return {
      business,
      connectors: args.connectorsOverride.map((connector) => ({
        ...connector,
        allowed_channels: normalizeConnectorChannels(connector.allowed_channels, 'all'),
      })),
    };
  }

  const { data: connectorRows, error: connectorError } = await args.admin
    .from('connectors')
    .select('id, business_id, type, enabled, url, secret, allowed_channels, created_at, updated_at')
    .eq('business_id', args.businessId)
    .eq('type', 'webhook');

  const connectors = (connectorRows || []) as ConnectorRow[];
  if (!connectorError && connectors.length > 0) {
    return {
      business,
      connectors: connectors.map((connector) => ({
        id: connector.id,
        business_id: connector.business_id,
        type: connector.type,
        enabled: !!connector.enabled,
        url: connector.url,
        secret: connector.secret,
        allowed_channels: normalizeConnectorChannels(connector.allowed_channels, 'all'),
      })),
    };
  }

  const legacy = {
    webhook_enabled: business.webhook_enabled,
    webhook_url: business.webhook_url,
    webhook_secret: business.webhook_secret,
    webhook_channels: business.webhook_channels,
  } satisfies LegacyWebhookBusinessConfig;

  const created = await ensureLegacyWebhookConnector({
    admin: args.admin,
    businessId: args.businessId,
    legacy,
  });

  if (created) {
    return {
      business,
      connectors: [{
        id: created.id,
        business_id: created.business_id,
        type: created.type,
        enabled: !!created.enabled,
        url: created.url,
        secret: created.secret,
        allowed_channels: normalizeConnectorChannels(created.allowed_channels, 'all'),
      }],
    };
  }

  const legacyUrl = asText(business.webhook_url);
  if (business.webhook_enabled && legacyUrl) {
    return {
      business,
      connectors: [{
        id: null,
        business_id: business.id,
        type: 'webhook',
        enabled: true,
        url: legacyUrl,
        secret: asText(business.webhook_secret) || null,
        allowed_channels: normalizeConnectorChannels(business.webhook_channels, 'all'),
      }],
    };
  }

  return { business, connectors: [] };
}

function toSummary(result: DeliveryRecord[], requestId: string): DispatchResult {
  const firstSent = result.find((entry) => entry.status === 'sent');
  if (firstSent) {
    return {
      status: 'sent',
      responseCode: firstSent.responseCode,
      requestId,
      deliveries: result,
    };
  }

  const firstFailed = result.find((entry) => entry.status === 'failed');
  if (firstFailed) {
    return {
      status: 'failed',
      responseCode: firstFailed.responseCode,
      error: firstFailed.error,
      requestId,
      deliveries: result,
    };
  }

  const firstSkipped = result.find((entry) => entry.status === 'skipped');
  if (firstSkipped) {
    return {
      status: 'skipped',
      responseCode: null,
      error: firstSkipped.error,
      requestId,
      deliveries: result,
    };
  }

  return {
    status: 'skipped',
    responseCode: null,
    error: 'webhook_disabled',
    requestId,
    deliveries: result,
  };
}

export async function dispatchEvent(args: DispatchEventArgs): Promise<DispatchResult> {
  const requestId = asText(args.requestId) || createRequestId();
  const log = buildLogger(args.log, requestId);
  const admin = args.admin || createAdminClient();
  const fetchImpl = args.dependencies?.fetchImpl || fetch;
  const now = args.dependencies?.now || (() => new Date());

  const loadContext = args.dependencies?.loadContext || defaultLoadContext;
  const recordDelivery = args.dependencies?.recordDelivery || defaultRecordDelivery;
  const isCooldown = args.dependencies?.isCooldown || defaultIsCooldown;
  const enqueueDlq = args.dependencies?.enqueueDlq || defaultEnqueueDlq;

  const context = await loadContext({
    admin,
    businessId: args.businessId,
    connectorsOverride: args.connectorsOverride,
    log,
  });

  if (!context || context.connectors.length === 0) {
    return {
      status: 'skipped',
      responseCode: null,
      error: 'webhook_disabled',
      requestId,
      deliveries: [],
    };
  }

  const channel = resolveEventChannel(args.data);
  const plannerItemId = resolvePlannerItemId(args.plannerItemId, args.data);
  const occurredAt = now().toISOString();
  const deliveryResults: DeliveryRecord[] = [];

  for (const connector of context.connectors) {
    if (!connector.enabled) {
      deliveryResults.push({
        connectorId: connector.id,
        status: 'skipped',
        responseCode: null,
        error: 'webhook_disabled',
      });
      continue;
    }

    const url = asText(connector.url);
    if (!url) {
      deliveryResults.push({
        connectorId: connector.id,
        status: 'skipped',
        responseCode: null,
        error: 'webhook_missing_url',
      });
      continue;
    }

    const channelList = normalizeConnectorChannels(connector.allowed_channels, 'all');
    if (channel && channelList.length > 0 && !channelList.includes(channel as never)) {
      deliveryResults.push({
        connectorId: connector.id,
        status: 'skipped',
        responseCode: null,
        error: 'channel_not_allowed',
      });
      continue;
    }

    const validUrl = validateConnectorUrl(url);
    if (!validUrl.ok) {
      const error = 'invalid_webhook_url';
      await recordDelivery({
        admin,
        businessId: context.business.id,
        connectorId: connector.id,
        plannerItemId,
        event: args.event,
        status: 'failed',
        responseCode: 400,
        error,
        requestId,
        log,
      });
      deliveryResults.push({
        connectorId: connector.id,
        status: 'failed',
        responseCode: 400,
        error,
      });
      continue;
    }

    const nowIso = now().toISOString();
    const cooldown = await isCooldown({
      admin,
      connectorId: connector.id,
      businessId: context.business.id,
      event: args.event,
      plannerItemId,
      nowIso,
    }).catch(() => false);

    if (cooldown) {
      const error = 'webhook_cooldown_rate_limited';
      await recordDelivery({
        admin,
        businessId: context.business.id,
        connectorId: connector.id,
        plannerItemId,
        event: args.event,
        status: 'failed',
        responseCode: 429,
        error,
        requestId,
        log,
      });
      deliveryResults.push({
        connectorId: connector.id,
        status: 'failed',
        responseCode: 429,
        error,
      });
      continue;
    }

    const payload: IntegrationEventPayload = {
      event: args.event,
      occurred_at: occurredAt,
      request_id: requestId,
      business: {
        id: context.business.id,
        name: context.business.name,
      },
      data: args.data,
    };

    const body = JSON.stringify(payload);
    const secret = asText(connector.secret) || SIGN_FALLBACK_SECRET;
    const signature = signPayload(secret, body);

    const sendResult = await sendWithRetry({
      url,
      body,
      headers: {
        'Content-Type': 'application/json',
        'x-opinia-signature': `sha256=${signature}`,
        'x-opinia-event': args.event,
        'x-request-id': requestId,
      },
      timeoutMs: DELIVERY_TIMEOUT_MS,
      retryCount: DELIVERY_RETRY_COUNT,
      fetchImpl,
    });

    if (sendResult.status === 'sent') {
      await recordDelivery({
        admin,
        businessId: context.business.id,
        connectorId: connector.id,
        plannerItemId,
        event: args.event,
        status: 'sent',
        responseCode: sendResult.responseCode,
        error: null,
        requestId,
        log,
      });
      deliveryResults.push({
        connectorId: connector.id,
        status: 'sent',
        responseCode: sendResult.responseCode,
      });
      continue;
    }

    const error = clampError(sendResult.error || 'webhook_delivery_failed');
    log.warn('Integration webhook delivery failed', {
      connector_id: connector.id,
      business_id: context.business.id,
      event: args.event,
      response_code: sendResult.responseCode,
      error,
    });

    await recordDelivery({
      admin,
      businessId: context.business.id,
      connectorId: connector.id,
      plannerItemId,
      event: args.event,
      status: 'failed',
      responseCode: sendResult.responseCode,
      error,
      requestId,
      log,
    });

    await enqueueDlq({
      admin,
      business: context.business,
      connectorId: connector.id,
      plannerItemId,
      event: args.event,
      requestId,
      userId: args.userId || null,
      error,
      responseCode: sendResult.responseCode,
    }).catch((dlqError: unknown) => {
      log.warn('Failed to enqueue integration DLQ (non-blocking)', {
        connector_id: connector.id,
        business_id: context.business.id,
        event: args.event,
        error: dlqError instanceof Error ? dlqError.message : 'unknown',
      });
    });

    deliveryResults.push({
      connectorId: connector.id,
      status: 'failed',
      responseCode: sendResult.responseCode,
      error,
    });
  }

  return toSummary(deliveryResults, requestId);
}

