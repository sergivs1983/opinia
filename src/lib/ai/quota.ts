import type { SupabaseClient } from '@supabase/supabase-js';

export type OrgPlanConfig = {
  plan_id: 'starter' | 'business' | 'scale';
  drafts_limit: number;
  max_locals: number;
};

export type QuotaConsumeResult = {
  ok: boolean;
  used: number;
  limit: number;
  remaining: number;
  reason?: string;
};

export type QuotaUsage = {
  used: number;
  limit: number;
  remaining: number;
  month: string;
};

const PLAN_DEFAULT: OrgPlanConfig = {
  plan_id: 'starter',
  drafts_limit: 120,
  max_locals: 2,
};

const PLAN_MAP: Record<string, OrgPlanConfig> = {
  starter: { plan_id: 'starter', drafts_limit: 120, max_locals: 2 },
  starter_29: { plan_id: 'starter', drafts_limit: 120, max_locals: 2 },
  starter_49: { plan_id: 'starter', drafts_limit: 120, max_locals: 2 },
  free: { plan_id: 'starter', drafts_limit: 120, max_locals: 2 },
  business: { plan_id: 'business', drafts_limit: 400, max_locals: 5 },
  pro: { plan_id: 'business', drafts_limit: 400, max_locals: 5 },
  pro_49: { plan_id: 'business', drafts_limit: 400, max_locals: 5 },
  scale: { plan_id: 'scale', drafts_limit: 1500, max_locals: 15 },
  scale_149: { plan_id: 'scale', drafts_limit: 1500, max_locals: 15 },
  pro_149: { plan_id: 'scale', drafts_limit: 1500, max_locals: 15 },
  enterprise: { plan_id: 'scale', drafts_limit: 1500, max_locals: 15 },
};

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getMonthStartUTC(input: Date = new Date()): string {
  const year = input.getUTCFullYear();
  const month = String(input.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
}

export function getOrgPlanConfig(planCode?: string | null): OrgPlanConfig {
  const normalized = (planCode || '').trim().toLowerCase();
  return PLAN_MAP[normalized] || PLAN_DEFAULT;
}

function normalizeQuotaPayload(raw: unknown): QuotaConsumeResult {
  if (Array.isArray(raw)) {
    return normalizeQuotaPayload(raw[0] || null);
  }

  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;

    if (typeof obj.ok === 'boolean') {
      const used = toNumber(obj.used, 0);
      const limit = toNumber(obj.limit, 0);
      return {
        ok: obj.ok,
        reason: typeof obj.reason === 'string' ? obj.reason : undefined,
        used,
        limit,
        remaining: toNumber(obj.remaining, Math.max(limit - used, 0)),
      };
    }

    if (typeof obj.allowed === 'boolean') {
      const used = toNumber(obj.used, 0);
      const limit = toNumber(obj.limit ?? obj.quota_limit, 0);
      return {
        ok: obj.allowed,
        reason: obj.allowed ? undefined : 'quota_exceeded',
        used,
        limit,
        remaining: Math.max(limit - used, 0),
      };
    }
  }

  return {
    ok: false,
    reason: 'invalid_quota_response',
    used: 0,
    limit: 0,
    remaining: 0,
  };
}

export async function consumeQuota(
  supabase: SupabaseClient,
  orgId: string,
  inc = 1,
): Promise<QuotaConsumeResult> {
  const monthStart = getMonthStartUTC();
  const { data, error } = await supabase.rpc('consume_draft_quota', {
    p_org_id: orgId,
    p_month_start: monthStart,
    p_increment: inc,
  });

  if (error) {
    return {
      ok: false,
      reason: error.code || error.message || 'quota_rpc_failed',
      used: 0,
      limit: 0,
      remaining: 0,
    };
  }

  return normalizeQuotaPayload(data);
}

export async function getDraftUsage(
  supabase: SupabaseClient,
  orgId: string,
): Promise<QuotaUsage | null> {
  const month = getMonthStartUTC();
  const { data, error } = await supabase
    .from('ai_quotas_monthly')
    .select('drafts_used, drafts_limit')
    .eq('org_id', orgId)
    .eq('month_start', month)
    .maybeSingle();

  if (error || !data) return null;

  const used = toNumber((data as { drafts_used?: unknown }).drafts_used, 0);
  const limit = toNumber((data as { drafts_limit?: unknown }).drafts_limit, 0);
  return {
    used,
    limit,
    remaining: Math.max(limit - used, 0),
    month,
  };
}
