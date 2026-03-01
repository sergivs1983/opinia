import type { SupabaseClient } from '@supabase/supabase-js';
import type { LitoMemberRole } from '@/lib/ai/lito-rbac';

export type SignalsLevel = 'basic' | 'advanced' | 'full';
export type CanonicalPlanCode = 'starter' | 'business' | 'scale';

export type OrgEntitlements = {
  org_id: string;
  plan_code: CanonicalPlanCode;
  locations_limit: number;
  seats_limit: number;
  lito_drafts_limit: number;
  signals_level: SignalsLevel;
  staff_daily_limit: number;
  staff_monthly_ratio_cap: number;
};

type EntitlementFeature = 'lito_copy' | 'locations' | 'seats';

type EntitlementCheckArgs = {
  entitlements: OrgEntitlements;
  feature: EntitlementFeature;
  current?: number;
  amount?: number;
};

type PlanDefaults = Omit<OrgEntitlements, 'org_id'>;

type OrgEntitlementsRow = {
  org_id: string;
  locations_limit: number | null;
  seats_limit: number | null;
  lito_drafts_limit: number | null;
  signals_level: string | null;
  staff_daily_limit: number | null;
  staff_monthly_ratio_cap: number | null;
};

type OrgRow = {
  id: string;
  plan_code: string | null;
};

export type EntitlementErrorCode = 'feature_locked' | 'quota_exceeded' | 'limit_reached';

export class EntitlementError extends Error {
  readonly code: EntitlementErrorCode;
  readonly feature: EntitlementFeature;

  constructor(code: EntitlementErrorCode, feature: EntitlementFeature, message: string) {
    super(message);
    this.code = code;
    this.feature = feature;
  }
}

const PLAN_DEFAULTS: Record<CanonicalPlanCode, PlanDefaults> = {
  starter: {
    plan_code: 'starter',
    locations_limit: 1,
    seats_limit: 1,
    lito_drafts_limit: 15,
    signals_level: 'basic',
    staff_daily_limit: 10,
    staff_monthly_ratio_cap: 0.3,
  },
  business: {
    plan_code: 'business',
    locations_limit: 5,
    seats_limit: 3,
    lito_drafts_limit: 150,
    signals_level: 'advanced',
    staff_daily_limit: 10,
    staff_monthly_ratio_cap: 0.3,
  },
  scale: {
    plan_code: 'scale',
    locations_limit: 15,
    seats_limit: 9999,
    lito_drafts_limit: 1000,
    signals_level: 'full',
    staff_daily_limit: 10,
    staff_monthly_ratio_cap: 0.3,
  },
};

const LEGACY_PLAN_MAP: Record<string, CanonicalPlanCode> = {
  starter: 'starter',
  starter_29: 'starter',
  starter_49: 'starter',
  free: 'starter',
  business: 'business',
  pro: 'business',
  pro_49: 'business',
  scale: 'scale',
  scale_149: 'scale',
  pro_149: 'scale',
  enterprise: 'scale',
};

function toNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeSignals(value: unknown, fallback: SignalsLevel): SignalsLevel {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'advanced' || normalized === 'full') return normalized;
  if (normalized === 'basic') return 'basic';
  return fallback;
}

export function normalizePlanCode(planCode: string | null | undefined): CanonicalPlanCode {
  const normalized = String(planCode || '').trim().toLowerCase();
  return LEGACY_PLAN_MAP[normalized] || 'starter';
}

export function defaultsForPlan(planCode: string | null | undefined): PlanDefaults {
  const canonical = normalizePlanCode(planCode);
  return PLAN_DEFAULTS[canonical];
}

function isSchemaMissing(error: unknown): boolean {
  const code = String((error as { code?: string })?.code || '').toUpperCase();
  const message = String((error as { message?: string })?.message || '').toLowerCase();
  return (
    code === '42P01'
    || code === '42703'
    || code === 'PGRST204'
    || code === 'PGRST205'
    || message.includes('schema cache')
    || message.includes('does not exist')
  );
}

export async function getOrgEntitlements(params: {
  supabase: SupabaseClient;
  orgId: string;
}): Promise<OrgEntitlements> {
  const { supabase, orgId } = params;

  const [{ data: orgData }, { data: entitlementData, error: entitlementErr }] = await Promise.all([
    supabase
      .from('organizations')
      .select('id, plan_code')
      .eq('id', orgId)
      .maybeSingle(),
    supabase
      .from('org_entitlements')
      .select('org_id, locations_limit, seats_limit, lito_drafts_limit, signals_level, staff_daily_limit, staff_monthly_ratio_cap')
      .eq('org_id', orgId)
      .maybeSingle(),
  ]);

  const org = (orgData || null) as OrgRow | null;
  const fallback = defaultsForPlan(org?.plan_code);

  if (!entitlementErr && entitlementData) {
    const row = entitlementData as OrgEntitlementsRow;
    return {
      org_id: orgId,
      plan_code: fallback.plan_code,
      locations_limit: toNumber(row.locations_limit, fallback.locations_limit),
      seats_limit: toNumber(row.seats_limit, fallback.seats_limit),
      lito_drafts_limit: toNumber(row.lito_drafts_limit, fallback.lito_drafts_limit),
      signals_level: normalizeSignals(row.signals_level, fallback.signals_level),
      staff_daily_limit: toNumber(row.staff_daily_limit, fallback.staff_daily_limit),
      staff_monthly_ratio_cap: toNumber(row.staff_monthly_ratio_cap, fallback.staff_monthly_ratio_cap),
    };
  }

  if (entitlementErr && !isSchemaMissing(entitlementErr)) {
    throw entitlementErr;
  }

  return {
    org_id: orgId,
    ...fallback,
  };
}

export function requireEntitlement(args: EntitlementCheckArgs): void {
  // NOTE:
  // Real LITO quota is enforced in ai_quotas_monthly via consume_draft_quota RPC.
  // This module only performs feature gating by entitlement/RBAC shape.
  const amount = Math.max(1, args.amount ?? 1);
  const current = Math.max(0, args.current ?? 0);

  if (args.feature === 'lito_copy') {
    if (!isLitoCopyEnabled(args.entitlements)) {
      throw new EntitlementError('feature_locked', args.feature, 'lito_copy_locked');
    }
    return;
  }

  if (args.feature === 'locations') {
    if (current + amount > args.entitlements.locations_limit) {
      throw new EntitlementError('limit_reached', args.feature, 'locations_limit_reached');
    }
    return;
  }

  if (current + amount > args.entitlements.seats_limit) {
    throw new EntitlementError('limit_reached', args.feature, 'seats_limit_reached');
  }
}

export function canUseLitoCopy(input: {
  role: LitoMemberRole;
  pausedFlag: boolean;
  entitlements: OrgEntitlements;
}): { allowed: boolean; reason?: 'paused' | 'feature_locked' } {
  if (input.role === 'staff' && input.pausedFlag) {
    return { allowed: false, reason: 'paused' };
  }

  if (!isLitoCopyEnabled(input.entitlements)) {
    return { allowed: false, reason: 'feature_locked' };
  }

  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Convenience helpers
// ---------------------------------------------------------------------------

/** Returns true when the staff panic toggle is active for the given org row. */
export function isStaffPaused(org: { lito_staff_ai_paused?: boolean | null }): boolean {
  return Boolean(org.lito_staff_ai_paused);
}

/** Returns the signals_level from an OrgEntitlements record. */
export function getSignalsLevel(ent: OrgEntitlements): SignalsLevel {
  return ent.signals_level;
}

/** Returns the location and seat limits from an OrgEntitlements record. */
export function getLimits(ent: OrgEntitlements): { locations_limit: number; seats_limit: number } {
  return { locations_limit: ent.locations_limit, seats_limit: ent.seats_limit };
}

/** Returns the configured Drafts LITO value for plan display/configuration. */
export function getDraftLimit(ent: OrgEntitlements): number {
  return ent.lito_drafts_limit;
}

/** Returns true when LITO Copy feature is enabled for the plan/overrides. */
export function isLitoCopyEnabled(ent: OrgEntitlements): boolean {
  return (ent.lito_drafts_limit ?? 0) > 0;
}
