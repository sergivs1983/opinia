import type { SupabaseClient } from '@supabase/supabase-js';
import { consumeQuota, type QuotaConsumeResult } from '@/lib/ai/quota';
import { consumeStaffDailyAction } from '@/lib/ai/staff-rate-limit';

export type StaffGuardResult = {
  ok: boolean;
  reason?: string;
  used: number;
  limit: number;
  remaining: number;
};

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseGuardPayload(raw: unknown): StaffGuardResult {
  if (raw && typeof raw === 'object') {
    const row = raw as Record<string, unknown>;
    const ok = Boolean(row.ok);
    const used = toNumber(row.used, 0);
    const limit = toNumber(row.limit, 0);
    return {
      ok,
      reason: typeof row.reason === 'string' ? row.reason : undefined,
      used,
      limit,
      remaining: toNumber(row.remaining, Math.max(limit - used, 0)),
    };
  }

  return {
    ok: false,
    reason: 'invalid_guard_payload',
    used: 0,
    limit: 0,
    remaining: 0,
  };
}

function isSchemaMissing(error: unknown): boolean {
  const code = ((error as { code?: string })?.code || '').toUpperCase();
  const message = ((error as { message?: string })?.message || '').toLowerCase();
  return (
    code === '42703'
    || code === '42P01'
    || code === 'PGRST202'
    || code === 'PGRST204'
    || code === 'PGRST205'
    || message.includes('schema cache')
    || message.includes('does not exist')
    || message.includes('function')
  );
}

export async function consumeStaffDaily(params: {
  supabase: SupabaseClient;
  admin: SupabaseClient;
  orgId: string;
  userId: string;
  inc?: number;
  limit?: number;
}): Promise<StaffGuardResult> {
  const inc = Math.max(1, params.inc ?? 1);
  const limit = Math.max(1, params.limit ?? 10);
  const day = new Date().toISOString().slice(0, 10);

  const { data, error } = await params.supabase.rpc('consume_staff_daily', {
    p_org_id: params.orgId,
    p_user_id: params.userId,
    p_day: day,
    p_inc: inc,
    p_limit: limit,
  });

  if (!error) {
    return parseGuardPayload(data);
  }

  if (isSchemaMissing(error)) {
    const fallback = await consumeStaffDailyAction({
      admin: params.admin,
      userId: params.userId,
      limit,
    });
    if (fallback.ok) {
      return {
        ok: true,
        used: fallback.used,
        limit: fallback.limit,
        remaining: Math.max(fallback.limit - fallback.used, 0),
      };
    }
    return {
      ok: false,
      reason: fallback.reason,
      used: fallback.used,
      limit: fallback.limit,
      remaining: Math.max(fallback.limit - fallback.used, 0),
    };
  }

  return {
    ok: false,
    reason: error.code || error.message || 'staff_daily_failed',
    used: 0,
    limit,
    remaining: limit,
  };
}

export async function enforceStaffMonthlyCap(params: {
  supabase: SupabaseClient;
  orgId: string;
  inc?: number;
  capRatio?: number;
}): Promise<StaffGuardResult> {
  const inc = Math.max(1, params.inc ?? 1);
  const capRatio = params.capRatio ?? 0.30;

  const { data, error } = await params.supabase.rpc('enforce_staff_monthly_cap', {
    p_org_id: params.orgId,
    p_inc: inc,
    p_cap_ratio: capRatio,
  });

  if (!error) {
    return parseGuardPayload(data);
  }

  if (isSchemaMissing(error)) {
    // Keep feature usable if migration has not been applied yet.
    return {
      ok: true,
      used: 0,
      limit: 0,
      remaining: 0,
    };
  }

  return {
    ok: false,
    reason: error.code || error.message || 'staff_monthly_cap_failed',
    used: 0,
    limit: 0,
    remaining: 0,
  };
}

export async function consumeOrgQuota(params: {
  supabase: SupabaseClient;
  orgId: string;
  inc?: number;
}): Promise<QuotaConsumeResult> {
  const inc = Math.max(1, params.inc ?? 1);
  const { data, error } = await params.supabase.rpc('consume_org_quota', {
    p_org_id: params.orgId,
    p_inc: inc,
  });

  if (!error) {
    const row = parseGuardPayload(data);
    return {
      ok: row.ok,
      reason: row.reason,
      used: row.used,
      limit: row.limit,
      remaining: row.remaining,
    };
  }

  if (isSchemaMissing(error)) {
    return consumeQuota(params.supabase, params.orgId, inc);
  }

  return {
    ok: false,
    reason: error.code || error.message || 'quota_wrapper_failed',
    used: 0,
    limit: 0,
    remaining: 0,
  };
}
