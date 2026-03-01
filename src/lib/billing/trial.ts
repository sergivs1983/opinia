import type { SupabaseClient } from '@supabase/supabase-js';
import { getMonthStartUTC } from '@/lib/ai/quota';

export type TrialState = 'none' | 'active' | 'ended';

export type TrialOrgRow = {
  trial_started_at?: string | null;
  trial_ends_at?: string | null;
  trial_state?: string | null;
  trial_plan_code?: string | null;
};

export type TrialStateInfo = {
  state: TrialState;
  started_at: string | null;
  ends_at: string | null;
  remaining_days: number;
  plan_code: string;
};

export type TrialQuotaCheck = {
  ok: boolean;
  used: number;
  limit: number;
  remaining: number;
  reason?: 'trial_cap_reached';
};

const TRIAL_DRAFT_CAP = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeState(value: string | null | undefined): TrialState {
  if (value === 'active' || value === 'ended') return value;
  return 'none';
}

export function getTrialState(org: TrialOrgRow | null | undefined, now: Date = new Date()): TrialStateInfo {
  const startedAt = org?.trial_started_at || null;
  const endsAtRaw = org?.trial_ends_at || null;
  const endsAtDate = toDate(endsAtRaw);

  let state = normalizeState(org?.trial_state || null);

  if (state === 'active' && endsAtDate && now.getTime() > endsAtDate.getTime()) {
    state = 'ended';
  }

  if (state === 'none' && endsAtDate) {
    state = now.getTime() > endsAtDate.getTime() ? 'ended' : 'active';
  }

  const remainingDays = state === 'active' && endsAtDate
    ? Math.max(0, Math.ceil((endsAtDate.getTime() - now.getTime()) / DAY_MS))
    : 0;

  return {
    state,
    started_at: startedAt,
    ends_at: endsAtRaw,
    remaining_days: remainingDays,
    plan_code: org?.trial_plan_code || 'business',
  };
}

export function isSoftLocked(trial: TrialStateInfo): boolean {
  return trial.state === 'ended';
}

export function getTrialDraftCap(trial: TrialStateInfo): number | null {
  if (trial.state !== 'active') return null;
  return TRIAL_DRAFT_CAP;
}

export async function getTrialUsedEstimate(params: {
  supabase: SupabaseClient;
  orgId: string;
  monthStart?: string;
}): Promise<number> {
  const monthStart = params.monthStart || getMonthStartUTC();
  const { data, error } = await params.supabase
    .from('ai_quotas_monthly')
    .select('drafts_used')
    .eq('org_id', params.orgId)
    .eq('month_start', monthStart)
    .maybeSingle();

  if (error || !data) return 0;
  return toNumber((data as { drafts_used?: unknown }).drafts_used, 0);
}

export async function enforceTrialQuota(params: {
  supabase: SupabaseClient;
  orgId: string;
  trial: TrialStateInfo;
  inc?: number;
}): Promise<TrialQuotaCheck> {
  const limit = getTrialDraftCap(params.trial);
  if (!limit) {
    return {
      ok: true,
      used: 0,
      limit: 0,
      remaining: 0,
    };
  }

  const increment = Math.max(1, params.inc ?? 1);
  const used = await getTrialUsedEstimate({
    supabase: params.supabase,
    orgId: params.orgId,
  });

  if (used + increment > limit) {
    return {
      ok: false,
      reason: 'trial_cap_reached',
      used,
      limit,
      remaining: Math.max(limit - used, 0),
    };
  }

  return {
    ok: true,
    used,
    limit,
    remaining: Math.max(limit - used, 0),
  };
}
