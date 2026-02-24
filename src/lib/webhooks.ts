import { createHmac } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { storagePathToObjectPath } from '@/lib/content-studio';
import { createLogger, createRequestId, type AppLogger } from '@/lib/logger';
import { dispatchEvent } from '@/lib/integrations';
import type { ContentPlannerChannel } from '@/types/database';
import type { JsonObject, JsonValue } from '@/types/json';

export type PlannerWebhookEvent = 'planner.ready' | 'planner.published';
export type WebhookSendStatus = 'sent' | 'failed' | 'skipped';

const DELIVERY_RATE_LIMIT_PER_MINUTE = 20;
const PLANNER_ITEM_COOLDOWN_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_RETRY_COUNT = 1;
const WEBHOOK_SIGN_FALLBACK_SECRET = process.env.WEBHOOK_SIGN_FALLBACK_SECRET || '';
const CHANNEL_SET = new Set<ContentPlannerChannel>(['ig_story', 'ig_feed', 'ig_reel', 'x', 'threads']);

type AdminClient = ReturnType<typeof createAdminClient>;

type BusinessWebhookConfig = {
  id: string;
  org_id: string;
  name: string;
  default_language: string | null;
  webhook_enabled: boolean | null;
  webhook_url: string | null;
  webhook_secret: string | null;
  webhook_channels: string[] | null;
};

type PlannerItemWebhookSource = {
  id: string;
  business_id: string;
  scheduled_at: string;
  channel: ContentPlannerChannel;
  title: string;
  suggestion_id: string | null;
  asset_id: string | null;
};

type SuggestionWebhookSource = {
  id: string;
  language: string | null;
  caption: string | null;
  cta: string | null;
  hashtags: string[] | null;
};

type AssetWebhookSource = {
  id: string;
  suggestion_id: string | null;
  storage_bucket: string;
  storage_path: string;
  language: string | null;
  payload: JsonValue;
};

export interface PlannerWebhookPayload {
  event: PlannerWebhookEvent;
  business: {
    id: string;
    name: string;
  };
  item: {
    id: string;
    channel: ContentPlannerChannel;
    scheduled_at: string;
    title: string;
    caption?: string;
    cta?: string;
    asset_signed_url?: string;
    hashtags?: string[];
  };
  assets: Array<{
    type: 'image';
    url: string;
  }>;
  language: 'ca' | 'es' | 'en';
  request_id: string;
}

export interface SendWebhookArgs {
  business: BusinessWebhookConfig;
  event: PlannerWebhookEvent;
  payload: PlannerWebhookPayload;
  plannerItemId?: string | null;
  userId?: string | null;
  requestId?: string;
  timeoutMs?: number;
  retryCount?: number;
  admin?: AdminClient;
  log?: AppLogger;
}

export interface SendPlannerItemWebhookArgs {
  event: PlannerWebhookEvent;
  business: BusinessWebhookConfig;
  plannerItem: PlannerItemWebhookSource;
  requestId: string;
  userId?: string | null;
  admin?: AdminClient;
  log?: AppLogger;
}

export interface WebhookSendResult {
  status: WebhookSendStatus;
  responseCode: number | null;
  error?: string;
  requestId: string;
}

interface DeliveryInsert {
  business_id: string;
  planner_item_id: string | null;
  event: PlannerWebhookEvent;
  status: 'sent' | 'failed';
  response_code: number | null;
  error: string | null;
  request_id: string;
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

function asLanguage(value: unknown): 'ca' | 'es' | 'en' {
  if (value === 'es' || value === 'en') return value;
  return 'ca';
}

function asHashtags(value: JsonValue): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    const raw = asText(item);
    if (!raw) continue;
    const tag = raw.startsWith('#') ? raw : `#${raw}`;
    const normalized = tag.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(tag);
    if (out.length >= 8) break;
  }

  return out;
}

function asChannels(value: string[] | null | undefined): ContentPlannerChannel[] {
  if (!Array.isArray(value)) return [];
  const out: ContentPlannerChannel[] = [];
  const seen = new Set<ContentPlannerChannel>();
  for (const item of value) {
    if (!CHANNEL_SET.has(item as ContentPlannerChannel)) continue;
    const channel = item as ContentPlannerChannel;
    if (seen.has(channel)) continue;
    seen.add(channel);
    out.push(channel);
  }
  return out;
}

function buildLogger(log: AppLogger | undefined, requestId: string): AppLogger {
  return log || createLogger({ request_id: requestId, route: '/lib/webhooks' });
}

async function createSignedAssetUrl(
  admin: AdminClient,
  asset: AssetWebhookSource,
): Promise<string | null> {
  const objectPath = storagePathToObjectPath(asset.storage_path, asset.storage_bucket);
  const { data, error } = await admin.storage
    .from(asset.storage_bucket)
    .createSignedUrl(objectPath, 60 * 60 * 24);

  if (error || !data?.signedUrl) {
    return null;
  }
  return data.signedUrl;
}

async function recordDelivery(
  admin: AdminClient,
  log: AppLogger,
  payload: DeliveryInsert,
): Promise<void> {
  const { error } = await admin.from('webhook_deliveries').insert(payload);
  if (error) {
    log.warn('Failed to insert webhook delivery log (non-blocking)', {
      error: error.message,
      business_id: payload.business_id,
      planner_item_id: payload.planner_item_id,
      event: payload.event,
    });
  }
}

async function checkRateLimit(
  admin: AdminClient,
  businessId: string,
): Promise<boolean> {
  const minuteAgo = new Date(Date.now() - 60_000).toISOString();
  const { count, error } = await admin
    .from('webhook_deliveries')
    .select('id', { head: true, count: 'exact' })
    .eq('business_id', businessId)
    .gte('created_at', minuteAgo);

  if (error) return false;
  return typeof count === 'number' && count >= DELIVERY_RATE_LIMIT_PER_MINUTE;
}

async function checkPlannerItemCooldown(
  admin: AdminClient,
  businessId: string,
  plannerItemId: string,
): Promise<boolean> {
  const threshold = new Date(Date.now() - PLANNER_ITEM_COOLDOWN_MS).toISOString();
  const { count, error } = await admin
    .from('webhook_deliveries')
    .select('id', { head: true, count: 'exact' })
    .eq('business_id', businessId)
    .eq('planner_item_id', plannerItemId)
    .gte('created_at', threshold);

  if (error) return false;
  return typeof count === 'number' && count >= 1;
}

async function enqueueDlqDeliveryFailure(args: {
  admin: AdminClient;
  business: BusinessWebhookConfig;
  plannerItemId?: string | null;
  event: PlannerWebhookEvent;
  requestId: string;
  userId?: string | null;
  error: string;
  responseCode: number | null;
}): Promise<void> {
  const { admin, business, plannerItemId, event, requestId, userId, error, responseCode } = args;

  const safeError = clampError(error || 'webhook_delivery_failed');
  const payload: JsonObject = {
    request_id: requestId,
    event,
    planner_item_id: plannerItemId || null,
    webhook_url: business.webhook_url || null,
    response_code: responseCode,
  };

  const { error: dlqError } = await admin.from('failed_jobs').insert({
    org_id: business.org_id,
    biz_id: business.id,
    job_type: 'webhook_delivery',
    payload,
    error_code: 'webhook_delivery_failed',
    error_message: safeError,
    provider: 'webhook',
    model: null,
    status: 'queued',
    next_retry_at: new Date(Date.now() + 60_000).toISOString(),
  });

  if (dlqError) return;

  await admin.from('activity_log').insert({
    org_id: business.org_id,
    biz_id: business.id,
    user_id: userId || null,
    action: 'dlq_enqueued',
    target_type: 'webhook_delivery',
    metadata: {
      request_id: requestId,
      event,
      planner_item_id: plannerItemId || null,
      error_code: 'webhook_delivery_failed',
    },
  });
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
}): Promise<SendAttemptResult> {
  const { url, body, headers, timeoutMs, retryCount } = args;

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    let responseCode: number | null = null;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(url, {
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

      if (shouldRetry(response.status, attempt, retryCount)) {
        continue;
      }
      return { status: 'failed', responseCode, error: baseError };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'webhook_fetch_failed';
      if (shouldRetry(responseCode, attempt, retryCount)) {
        continue;
      }
      return { status: 'failed', responseCode, error: clampError(message) };
    }
  }

  return {
    status: 'failed',
    responseCode: null,
    error: 'Webhook delivery failed after retries',
  };
}

export function signPayload(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

export function buildPlannerWebhookPayload(args: {
  event: PlannerWebhookEvent;
  requestId: string;
  businessId: string;
  businessName: string;
  channel: ContentPlannerChannel;
  scheduledAt: string;
  title: string;
  language: 'ca' | 'es' | 'en';
  caption?: string;
  cta?: string;
  hashtags?: string[];
  assetSignedUrl?: string | null;
  plannerItemId: string;
}): PlannerWebhookPayload {
  const hashtags = Array.isArray(args.hashtags) ? args.hashtags.filter(Boolean).slice(0, 8) : [];
  const assetSignedUrl = asText(args.assetSignedUrl);
  const item = {
    id: args.plannerItemId,
    channel: args.channel,
    scheduled_at: args.scheduledAt,
    title: args.title,
    ...(args.caption ? { caption: args.caption } : {}),
    ...(args.cta ? { cta: args.cta } : {}),
    ...(hashtags.length > 0 ? { hashtags } : {}),
    ...(assetSignedUrl ? { asset_signed_url: assetSignedUrl } : {}),
  };

  return {
    event: args.event,
    business: {
      id: args.businessId,
      name: args.businessName,
    },
    item,
    assets: assetSignedUrl
      ? [{ type: 'image', url: assetSignedUrl }]
      : [],
    language: args.language,
    request_id: args.requestId,
  };
}

export function buildWebhookTestPayload(args: {
  event: PlannerWebhookEvent;
  requestId: string;
  businessId: string;
  businessName: string;
  language: 'ca' | 'es' | 'en';
  channel: ContentPlannerChannel;
}): PlannerWebhookPayload {
  return buildPlannerWebhookPayload({
    event: args.event,
    requestId: args.requestId,
    businessId: args.businessId,
    businessName: args.businessName,
    channel: args.channel,
    scheduledAt: new Date().toISOString(),
    title: 'Demo planner item',
    language: args.language,
    caption: 'Demo caption from OpinIA',
    cta: 'Publica avui',
    hashtags: ['#opinia', '#demo'],
    plannerItemId: `demo-${args.channel}`,
  });
}

export function toWebhookTestResponse(result: WebhookSendResult): {
  ok: boolean;
  status: WebhookSendStatus;
} {
  return {
    ok: result.status === 'sent',
    status: result.status,
  };
}

export async function sendWebhook(args: SendWebhookArgs): Promise<WebhookSendResult> {
  const requestId = args.requestId?.trim() || createRequestId();
  const log = buildLogger(args.log, requestId);
  const admin = args.admin || createAdminClient();
  const business = args.business;
  const plannerItemId = args.plannerItemId || null;

  if (!business.webhook_enabled || !asText(business.webhook_url)) {
    return { status: 'skipped', responseCode: null, error: 'webhook_disabled', requestId };
  }

  const channels = asChannels(business.webhook_channels);
  const itemChannel = args.payload.item.channel;
  if (channels.length === 0 || !channels.includes(itemChannel)) {
    return { status: 'skipped', responseCode: null, error: 'channel_not_allowed', requestId };
  }

  if (plannerItemId) {
    const plannerItemRateLimited = await checkPlannerItemCooldown(admin, business.id, plannerItemId).catch(() => false);
    if (plannerItemRateLimited) {
      const error = 'webhook_planner_item_rate_limited';
      log.warn('Webhook planner item blocked by cooldown', {
        business_id: business.id,
        planner_item_id: plannerItemId,
        event: args.event,
      });
      await recordDelivery(admin, log, {
        business_id: business.id,
        planner_item_id: plannerItemId,
        event: args.event,
        status: 'failed',
        response_code: 429,
        error,
        request_id: requestId,
      });
      return { status: 'failed', responseCode: 429, error, requestId };
    }
  }

  const rateLimited = await checkRateLimit(admin, business.id).catch(() => false);
  if (rateLimited) {
    const error = 'webhook_rate_limited';
    log.warn('Webhook business rate limit reached', {
      business_id: business.id,
      planner_item_id: plannerItemId,
      event: args.event,
    });
    await recordDelivery(admin, log, {
      business_id: business.id,
      planner_item_id: plannerItemId,
      event: args.event,
      status: 'failed',
      response_code: 429,
      error,
      request_id: requestId,
    });
    return { status: 'failed', responseCode: 429, error, requestId };
  }

  const payload = {
    ...args.payload,
    request_id: requestId,
  };

  const body = JSON.stringify(payload);
  const secret = asText(business.webhook_secret) || WEBHOOK_SIGN_FALLBACK_SECRET;
  const signature = signPayload(secret, body);

  const sendResult = await sendWithRetry({
    url: asText(business.webhook_url),
    body,
    headers: {
      'Content-Type': 'application/json',
      'x-request-id': requestId,
      'x-opinia-event': args.event,
      'x-opinia-signature': `sha256=${signature}`,
    },
    timeoutMs: args.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    retryCount: args.retryCount ?? DEFAULT_RETRY_COUNT,
  });

  if (sendResult.status === 'sent') {
    await recordDelivery(admin, log, {
      business_id: business.id,
      planner_item_id: plannerItemId,
      event: args.event,
      status: 'sent',
      response_code: sendResult.responseCode,
      error: null,
      request_id: requestId,
    });
    return { status: 'sent', responseCode: sendResult.responseCode, requestId };
  }

  const error = clampError(sendResult.error || 'webhook_delivery_failed');
  log.warn('Webhook delivery failed', {
    business_id: business.id,
    planner_item_id: plannerItemId,
    event: args.event,
    response_code: sendResult.responseCode,
    error,
  });
  await recordDelivery(admin, log, {
    business_id: business.id,
    planner_item_id: plannerItemId,
    event: args.event,
    status: 'failed',
    response_code: sendResult.responseCode,
    error,
    request_id: requestId,
  });

  await enqueueDlqDeliveryFailure({
    admin,
    business,
    plannerItemId,
    event: args.event,
    requestId,
    userId: args.userId || null,
    error,
    responseCode: sendResult.responseCode,
  }).catch((dlqError: unknown) => {
    log.warn('Failed to enqueue webhook delivery in DLQ (non-blocking)', {
      error: dlqError instanceof Error ? dlqError.message : 'unknown',
      business_id: business.id,
      planner_item_id: plannerItemId,
      event: args.event,
    });
  });

  return {
    status: 'failed',
    responseCode: sendResult.responseCode,
    error,
    requestId,
  };
}

async function loadSuggestion(
  admin: AdminClient,
  suggestionId: string | null,
  businessId: string,
): Promise<SuggestionWebhookSource | null> {
  if (!suggestionId) return null;
  const { data, error } = await admin
    .from('content_suggestions')
    .select('id, language, caption, cta, hashtags')
    .eq('id', suggestionId)
    .eq('business_id', businessId)
    .maybeSingle();

  if (error || !data) return null;
  return data as SuggestionWebhookSource;
}

async function loadAsset(
  admin: AdminClient,
  assetId: string | null,
  businessId: string,
): Promise<AssetWebhookSource | null> {
  if (!assetId) return null;
  const { data, error } = await admin
    .from('content_assets')
    .select('id, suggestion_id, storage_bucket, storage_path, language, payload')
    .eq('id', assetId)
    .eq('business_id', businessId)
    .maybeSingle();

  if (error || !data) return null;
  return data as AssetWebhookSource;
}

function captionFromAssetPayload(payload: JsonValue): string {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return '';
  return asText((payload as Record<string, unknown>).caption);
}

function ctaFromAssetPayload(payload: JsonValue): string {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return '';
  return asText((payload as Record<string, unknown>).cta);
}

function hashtagsFromAssetPayload(payload: JsonValue): string[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const raw = (payload as Record<string, unknown>).hashtags as JsonValue;
  return asHashtags(raw);
}

export async function sendPlannerItemWebhook(args: SendPlannerItemWebhookArgs): Promise<WebhookSendResult> {
  const requestId = args.requestId?.trim() || createRequestId();
  const log = buildLogger(args.log, requestId);
  const admin = args.admin || createAdminClient();
  const { business, plannerItem } = args;

  let suggestion = await loadSuggestion(admin, plannerItem.suggestion_id, plannerItem.business_id);
  const asset = await loadAsset(admin, plannerItem.asset_id, plannerItem.business_id);

  if (!suggestion && asset?.suggestion_id) {
    suggestion = await loadSuggestion(admin, asset.suggestion_id, plannerItem.business_id);
  }

  const assetSignedUrl = asset
    ? await createSignedAssetUrl(admin, asset)
    : null;

  const caption = suggestion?.caption || captionFromAssetPayload(asset?.payload || null);
  const cta = suggestion?.cta || ctaFromAssetPayload(asset?.payload || null);
  const hashtags = (suggestion?.hashtags || []).filter(Boolean);
  const payloadHashtags = hashtags.length > 0 ? hashtags : hashtagsFromAssetPayload(asset?.payload || null);
  const language = asLanguage(suggestion?.language || asset?.language || business.default_language);

  const payload = buildPlannerWebhookPayload({
    event: args.event,
    requestId,
    businessId: business.id,
    businessName: business.name,
    channel: plannerItem.channel,
    scheduledAt: plannerItem.scheduled_at,
    title: plannerItem.title,
    language,
    caption: caption || undefined,
    cta: cta || undefined,
    hashtags: payloadHashtags,
    assetSignedUrl,
    plannerItemId: plannerItem.id,
  });

  const dispatchResult = await dispatchEvent({
    businessId: business.id,
    event: args.event,
    data: payload as unknown as Record<string, unknown>,
    requestId,
    userId: args.userId,
    plannerItemId: plannerItem.id,
    admin,
    log,
  });

  return {
    status: dispatchResult.status,
    responseCode: dispatchResult.responseCode,
    error: dispatchResult.error,
    requestId: dispatchResult.requestId,
  };
}
