import { randomBytes } from 'node:crypto';
import type { ContentPlannerChannel } from '@/types/database';

export type ConnectorType = 'webhook';
export type ConnectorChannel = ContentPlannerChannel;
export type ApiConnectorChannel = 'ig_feed' | 'ig_story' | 'ig_reel';

export interface ConnectorRow {
  id: string;
  business_id: string;
  type: ConnectorType;
  enabled: boolean;
  url: string | null;
  secret: string | null;
  allowed_channels: string[] | null;
  created_at?: string;
  updated_at?: string;
}

export interface LegacyWebhookBusinessConfig {
  webhook_enabled: boolean | null;
  webhook_url: string | null;
  webhook_secret: string | null;
  webhook_channels: string[] | null;
}

export interface PublicConnector {
  id: string;
  type: ConnectorType;
  enabled: boolean;
  url: string | null;
  allowed_channels: ConnectorChannel[];
  secret_present: boolean;
  created_at?: string;
  updated_at?: string;
}

const ALL_CHANNELS: ConnectorChannel[] = ['ig_feed', 'ig_story', 'ig_reel', 'x', 'threads'];
const API_CHANNELS: ApiConnectorChannel[] = ['ig_feed', 'ig_story', 'ig_reel'];
const ALL_CHANNEL_SET = new Set<string>(ALL_CHANNELS);
const API_CHANNEL_SET = new Set<string>(API_CHANNELS);

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeConnectorChannels(
  value: string[] | null | undefined,
  mode: 'all' | 'api' = 'all',
): ConnectorChannel[] {
  if (!Array.isArray(value)) return [];
  const out: ConnectorChannel[] = [];
  const seen = new Set<ConnectorChannel>();
  const channelSet = mode === 'api' ? API_CHANNEL_SET : ALL_CHANNEL_SET;
  for (const item of value) {
    if (!channelSet.has(item)) continue;
    const channel = item as ConnectorChannel;
    if (seen.has(channel)) continue;
    seen.add(channel);
    out.push(channel);
  }
  return out;
}

export function generateConnectorSecret(): string {
  return randomBytes(32).toString('hex');
}

export function allowLocalWebhookUrls(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.FEATURE_LOCAL_WEBHOOKS === 'true';
}

export function validateConnectorUrl(url: string | null | undefined): { ok: true } | { ok: false; error: string } {
  const raw = asText(url);
  if (!raw) return { ok: true };

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, error: 'Must be a valid URL' };
  }

  if (parsed.protocol === 'https:') return { ok: true };

  if (parsed.protocol === 'http:' && allowLocalWebhookUrls()) {
    const host = parsed.hostname.toLowerCase();
    const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    if (isLocal) return { ok: true };
  }

  return { ok: false, error: 'Webhook URL must use https://' };
}

export function toPublicConnector(row: ConnectorRow): PublicConnector {
  return {
    id: row.id,
    type: row.type,
    enabled: !!row.enabled,
    url: row.url || null,
    allowed_channels: normalizeConnectorChannels(row.allowed_channels, 'all'),
    secret_present: !!asText(row.secret),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function syncBusinessLegacyWebhook(
  supabase: {
    from: (table: string) => {
      update: (payload: Record<string, unknown>) => { eq: (column: string, value: string) => unknown };
    };
  },
  businessId: string,
  connector: {
    enabled: boolean;
    url: string | null;
    secret: string | null;
    allowed_channels: string[] | null;
  },
): Promise<void> {
  await supabase
    .from('businesses')
    .update({
      webhook_enabled: connector.enabled,
      webhook_url: connector.url || null,
      webhook_secret: connector.secret || null,
      webhook_channels: normalizeConnectorChannels(connector.allowed_channels, 'all'),
    })
    .eq('id', businessId);
}

export async function ensureLegacyWebhookConnector(args: {
  admin: {
    from: (table: string) => {
      insert: (payload: Record<string, unknown>) => {
        select: (columns: string) => { single: () => PromiseLike<{ data: unknown; error: { message: string } | null }> };
      };
    };
  };
  businessId: string;
  legacy: LegacyWebhookBusinessConfig;
}): Promise<ConnectorRow | null> {
  const enabled = !!args.legacy.webhook_enabled;
  const url = asText(args.legacy.webhook_url);
  if (!enabled || !url) return null;

  const { data, error } = await args.admin
    .from('connectors')
    .insert({
      business_id: args.businessId,
      type: 'webhook',
      enabled: true,
      url,
      secret: asText(args.legacy.webhook_secret) || generateConnectorSecret(),
      allowed_channels: normalizeConnectorChannels(args.legacy.webhook_channels, 'all'),
    })
    .select('id, business_id, type, enabled, url, secret, allowed_channels, created_at, updated_at')
    .single();

  if (error || !data) return null;
  return data as ConnectorRow;
}
