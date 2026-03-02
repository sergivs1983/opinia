import type { SupabaseClient } from '@supabase/supabase-js';

import { isGuardrailDevHooksEnabled } from '@/lib/guards/dev-hooks';
import { GuardrailError } from '@/lib/guards/errors';

type RateLimitRpcRow = {
  allowed?: unknown;
  retry_after_seconds?: unknown;
};

function toBool(value: unknown): boolean {
  return value === true;
}

function toInt(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.floor(value);
  }
  const parsed = Number(value);
  if (Number.isFinite(parsed)) return Math.floor(parsed);
  return fallback;
}

function parseRateLimitRow(data: unknown): { allowed: boolean; retryAfterSeconds: number } {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') {
    return { allowed: false, retryAfterSeconds: 60 };
  }

  const typed = row as RateLimitRpcRow;
  const retryAfterSeconds = Math.max(1, Math.min(60, toInt(typed.retry_after_seconds, 60)));
  return {
    allowed: toBool(typed.allowed),
    retryAfterSeconds,
  };
}

async function emitRateLimitEvent(params: {
  supabase: SupabaseClient;
  orgId: string;
  userId: string;
  bizId?: string | null;
  eventName: 'rate_limited_org' | 'rate_limited_user';
  key: string;
  limit: number;
  retryAfter: number;
  requestId: string;
}): Promise<void> {
  try {
    await params.supabase.rpc('insert_telemetry_event', {
      p_org_id: params.orgId,
      p_user_id: params.userId,
      p_event_name: params.eventName,
      p_props: {
        org_id: params.orgId,
        user_id: params.userId,
        biz_id: params.bizId ?? null,
        key: params.key,
        limit: params.limit,
        window: 'minute',
        retry_after: params.retryAfter,
        request_id: params.requestId,
      },
    });
  } catch {
    // Telemetry should never break guardrails.
  }
}

export async function enforceOrgUserRateLimit(params: {
  supabase: SupabaseClient;
  orgId: string;
  userId: string;
  bizId?: string | null;
  key: string;
  orgLimitPerMin: number;
  userLimitPerMin: number;
  requestId: string;
  forceRateLimit?: boolean;
}): Promise<void> {
  const orgLimit = Math.max(1, Math.floor(params.orgLimitPerMin));
  const userLimit = Math.max(1, Math.floor(params.userLimitPerMin));

  if (params.forceRateLimit === true && isGuardrailDevHooksEnabled()) {
    const retryAfter = 60;
    await emitRateLimitEvent({
      supabase: params.supabase,
      orgId: params.orgId,
      userId: params.userId,
      bizId: params.bizId,
      eventName: 'rate_limited_org',
      key: params.key,
      limit: orgLimit,
      retryAfter,
      requestId: params.requestId,
    });

    throw new GuardrailError('rate_limited', 'rate_limited', {
      retryAfter,
      scope: 'org',
      key: params.key,
      limit: orgLimit,
    });
  }

  const orgResult = await params.supabase.rpc('consume_rate_limit_org', {
    p_org_id: params.orgId,
    p_bucket_key: params.key,
    p_limit: orgLimit,
    p_window_seconds: 60,
  });

  if (orgResult.error) {
    throw new Error(orgResult.error.message || 'consume_rate_limit_org_failed');
  }

  const orgRow = parseRateLimitRow(orgResult.data);
  if (!orgRow.allowed) {
    await emitRateLimitEvent({
      supabase: params.supabase,
      orgId: params.orgId,
      userId: params.userId,
      bizId: params.bizId,
      eventName: 'rate_limited_org',
      key: params.key,
      limit: orgLimit,
      retryAfter: orgRow.retryAfterSeconds,
      requestId: params.requestId,
    });

    throw new GuardrailError('rate_limited', 'rate_limited', {
      retryAfter: orgRow.retryAfterSeconds,
      scope: 'org',
      key: params.key,
      limit: orgLimit,
    });
  }

  const userResult = await params.supabase.rpc('consume_rate_limit_user', {
    p_user_id: params.userId,
    p_bucket_key: params.key,
    p_limit: userLimit,
    p_window_seconds: 60,
  });

  if (userResult.error) {
    throw new Error(userResult.error.message || 'consume_rate_limit_user_failed');
  }

  const userRow = parseRateLimitRow(userResult.data);
  if (!userRow.allowed) {
    await emitRateLimitEvent({
      supabase: params.supabase,
      orgId: params.orgId,
      userId: params.userId,
      bizId: params.bizId,
      eventName: 'rate_limited_user',
      key: params.key,
      limit: userLimit,
      retryAfter: userRow.retryAfterSeconds,
      requestId: params.requestId,
    });

    throw new GuardrailError('rate_limited', 'rate_limited', {
      retryAfter: userRow.retryAfterSeconds,
      scope: 'user',
      key: params.key,
      limit: userLimit,
    });
  }
}
