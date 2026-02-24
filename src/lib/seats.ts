import type { SupabaseClient } from '@supabase/supabase-js';
import type { MemberRole } from '@/types/database';
import { normalizeMemberRole } from '@/lib/roles';

export const SEAT_LIMIT_REACHED_MESSAGE =
  "Has arribat al límit de persones del teu pla. Puja de pla per afegir-ne més.";

export const BUSINESS_LIMIT_REACHED_MESSAGE =
  "Has arribat al límit d'establiments del teu pla. Puja de pla per afegir-ne més.";

export const ROLE_NOT_ALLOWED_FOR_PLAN_MESSAGE =
  'Aquest rol no està disponible al teu pla actual. Actualitza el pla per assignar-lo.';

export const PLAN_LIMITS = {
  starter_49: {
    seats_limit: 2,
    business_limit: 3,
    plan_price_cents: 4900,
    allowed_roles: ['owner', 'manager', 'responder'] as const,
  },
  pro_149: {
    seats_limit: 6,
    business_limit: 10,
    plan_price_cents: 14900,
    allowed_roles: ['owner', 'admin', 'manager', 'responder'] as const,
  },
} as const;

export const PLAN_SEAT_LIMITS = {
  starter_49: PLAN_LIMITS.starter_49.seats_limit,
  pro_149: PLAN_LIMITS.pro_149.seats_limit,
} as const;

export type SeatPlanCode = keyof typeof PLAN_LIMITS;

export type OrgLimitConfig = {
  plan_code: SeatPlanCode;
  seats_limit: number;
  business_limit: number;
};

export type OrgSeatSnapshot = OrgLimitConfig & {
  seats_used: number;
  seats_remaining: number;
  is_full: boolean;
  businesses_used: number;
  businesses_remaining: number;
  is_business_limit_reached: boolean;
};

type OrgRowWithLimits = {
  id: string;
  plan_code?: string | null;
  seats_limit?: number | null;
  business_limit?: number | null;
  plan_tier?: string | null;
  max_seats?: number | null;
  plan?: string | null;
  max_team_members?: number | null;
  max_businesses?: number | null;
};

export class OrgSeatLimitError extends Error {
  readonly status = 409;
  readonly code = 'seat_limit_reached';
  readonly snapshot: OrgSeatSnapshot;

  constructor(snapshot: OrgSeatSnapshot) {
    super(SEAT_LIMIT_REACHED_MESSAGE);
    this.snapshot = snapshot;
  }
}

export class OrgBusinessLimitError extends Error {
  readonly status = 409;
  readonly code = 'business_limit_reached';
  readonly snapshot: OrgSeatSnapshot;

  constructor(snapshot: OrgSeatSnapshot) {
    super(BUSINESS_LIMIT_REACHED_MESSAGE);
    this.snapshot = snapshot;
  }
}

export class OrgRoleNotAllowedForPlanError extends Error {
  readonly status = 409;
  readonly code = 'role_not_allowed_for_plan';
  readonly planCode: SeatPlanCode;
  readonly role: MemberRole;

  constructor(args: { planCode: SeatPlanCode; role: MemberRole }) {
    super(ROLE_NOT_ALLOWED_FOR_PLAN_MESSAGE);
    this.planCode = args.planCode;
    this.role = args.role;
  }
}

function normalize(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase();
}

export function normalizeSeatPlanCode(planCode?: string | null, legacyPlan?: string | null): SeatPlanCode {
  const normalizedPlanCode = normalize(planCode);
  if (normalizedPlanCode === 'pro_149') return 'pro_149';
  if (normalizedPlanCode === 'starter_49') return 'starter_49';

  const normalizedLegacyPlan = normalize(legacyPlan);
  if (
    normalizedLegacyPlan === 'pro_149'
    || normalizedLegacyPlan === 'pro'
    || normalizedLegacyPlan === 'agency'
    || normalizedLegacyPlan === 'enterprise'
  ) {
    return 'pro_149';
  }
  return 'starter_49';
}

export function seatLimitForPlan(planCode: SeatPlanCode): number {
  return PLAN_LIMITS[planCode].seats_limit;
}

export function businessLimitForPlan(planCode: SeatPlanCode): number {
  return PLAN_LIMITS[planCode].business_limit;
}

export function roleAllowedForPlan(planCode: SeatPlanCode, role: string | null | undefined): boolean {
  const normalizedRole = normalizeMemberRole(role as MemberRole | null | undefined);
  if (planCode === 'starter_49') {
    return normalizedRole !== 'admin';
  }
  return true;
}

export function mapSeatPlan(planCodeInput: string): {
  plan_code: SeatPlanCode;
  seats_limit: number;
  business_limit: number;
  plan_price_cents: number;
} {
  const planCode = normalizeSeatPlanCode(planCodeInput, planCodeInput);
  return {
    plan_code: planCode,
    seats_limit: PLAN_LIMITS[planCode].seats_limit,
    business_limit: PLAN_LIMITS[planCode].business_limit,
    plan_price_cents: PLAN_LIMITS[planCode].plan_price_cents,
  };
}

export function mapBillingPlanToSeatPlan(planId: string, monthlyPriceEur?: number | null) {
  const normalizedPlanId = normalize(planId);
  if (normalizedPlanId === 'pro_149' || normalizedPlanId === 'pro' || normalizedPlanId === 'agency' || normalizedPlanId === 'enterprise') {
    return mapSeatPlan('pro_149');
  }
  if (typeof monthlyPriceEur === 'number' && monthlyPriceEur >= 149) return mapSeatPlan('pro_149');
  return mapSeatPlan('starter_49');
}

export function isMissingSeatColumnsError(error: unknown): boolean {
  const message = normalize((error as { message?: string })?.message);
  return (
    message.includes('plan_code')
    || message.includes('seats_limit')
    || message.includes('business_limit')
    || message.includes('billing_status')
    || message.includes('plan_price_cents')
  );
}

function isMissingBusinessMembershipsTableError(error: unknown): boolean {
  const message = normalize((error as { message?: string })?.message);
  return message.includes('business_memberships') && message.includes('does not exist');
}

async function fetchOrgLimitConfig(
  supabase: SupabaseClient,
  orgId: string,
): Promise<OrgLimitConfig> {
  const { data: withLimits, error: withLimitsError } = await supabase
    .from('organizations')
    .select('id, plan_code, seats_limit, business_limit, plan_tier, max_seats, plan, max_team_members, max_businesses')
    .eq('id', orgId)
    .maybeSingle();

  let orgRow = withLimits as OrgRowWithLimits | null;

  if (withLimitsError && isMissingSeatColumnsError(withLimitsError)) {
    const { data: fallbackRow, error: fallbackError } = await supabase
      .from('organizations')
      .select('id, plan_tier, max_seats, plan, max_team_members, max_businesses')
      .eq('id', orgId)
      .maybeSingle();

    if (fallbackError || !fallbackRow) {
      throw new Error(fallbackError?.message || 'Organization not found');
    }
    orgRow = fallbackRow as OrgRowWithLimits;
  } else if (withLimitsError || !orgRow) {
    throw new Error(withLimitsError?.message || 'Organization not found');
  }

  const planCode = normalizeSeatPlanCode(orgRow.plan_code, orgRow.plan);

  const fallbackSeatsFromLegacy =
    typeof orgRow.max_seats === 'number' && orgRow.max_seats > 0
      ? orgRow.max_seats
      : typeof orgRow.max_team_members === 'number' && orgRow.max_team_members > 0
        ? orgRow.max_team_members
        : seatLimitForPlan(planCode);

  const seatsLimit =
    typeof orgRow.seats_limit === 'number' && orgRow.seats_limit > 0
      ? orgRow.seats_limit
      : fallbackSeatsFromLegacy;

  const fallbackBusinessesFromLegacy =
    typeof orgRow.max_businesses === 'number' && orgRow.max_businesses > 0
      ? orgRow.max_businesses
      : businessLimitForPlan(planCode);

  const businessLimit =
    typeof orgRow.business_limit === 'number' && orgRow.business_limit > 0
      ? orgRow.business_limit
      : fallbackBusinessesFromLegacy;

  return {
    plan_code: planCode,
    seats_limit: seatsLimit,
    business_limit: businessLimit,
  };
}

export function buildSeatSnapshot(
  config: OrgLimitConfig,
  seatsUsed: number,
  businessesUsed: number,
): OrgSeatSnapshot {
  const safeUsed = Math.max(0, seatsUsed);
  const safeLimit = Math.max(1, config.seats_limit);
  const seatsRemaining = Math.max(0, safeLimit - safeUsed);

  const safeBusinessesUsed = Math.max(0, businessesUsed);
  const safeBusinessLimit = Math.max(1, config.business_limit);
  const businessesRemaining = Math.max(0, safeBusinessLimit - safeBusinessesUsed);

  return {
    plan_code: config.plan_code,
    seats_limit: safeLimit,
    business_limit: safeBusinessLimit,
    seats_used: safeUsed,
    seats_remaining: seatsRemaining,
    is_full: safeUsed >= safeLimit,
    businesses_used: safeBusinessesUsed,
    businesses_remaining: businessesRemaining,
    is_business_limit_reached: safeBusinessesUsed >= safeBusinessLimit,
  };
}

export async function getOrgSeatSnapshot(
  supabase: SupabaseClient,
  orgId: string,
  seatsUsedOverride?: number,
  businessesUsedOverride?: number,
): Promise<OrgSeatSnapshot> {
  const config = await fetchOrgLimitConfig(supabase, orgId);

  const seatsUsed =
    typeof seatsUsedOverride === 'number'
      ? seatsUsedOverride
      : (
          await supabase
            .from('memberships')
            .select('id', { count: 'exact', head: true })
            .eq('org_id', orgId)
        ).count || 0;

  const businessesUsed =
    typeof businessesUsedOverride === 'number'
      ? businessesUsedOverride
      : (
          await supabase
            .from('businesses')
            .select('id', { count: 'exact', head: true })
            .eq('org_id', orgId)
        ).count || 0;

  return buildSeatSnapshot(config, seatsUsed, businessesUsed);
}

export async function assertOrgHasSeat(
  supabase: SupabaseClient,
  orgId: string,
): Promise<OrgSeatSnapshot> {
  const snapshot = await getOrgSeatSnapshot(supabase, orgId);
  if (snapshot.is_full) {
    throw new OrgSeatLimitError(snapshot);
  }
  return snapshot;
}

export async function assertOrgHasBusinessCapacity(
  supabase: SupabaseClient,
  orgId: string,
): Promise<OrgSeatSnapshot> {
  const snapshot = await getOrgSeatSnapshot(supabase, orgId);
  if (snapshot.is_business_limit_reached) {
    throw new OrgBusinessLimitError(snapshot);
  }
  return snapshot;
}

export async function assertRoleAllowedForOrgPlan(
  supabase: SupabaseClient,
  args: {
    orgId: string;
    role: MemberRole;
  },
): Promise<void> {
  const config = await fetchOrgLimitConfig(supabase, args.orgId);
  if (!roleAllowedForPlan(config.plan_code, args.role)) {
    throw new OrgRoleNotAllowedForPlanError({
      planCode: config.plan_code,
      role: args.role,
    });
  }
}

export async function normalizeOrgRolesForPlan(
  supabase: SupabaseClient,
  args: {
    orgId: string;
    planCode: SeatPlanCode;
  },
): Promise<void> {
  if (args.planCode !== 'starter_49') return;

  await supabase
    .from('memberships')
    .update({ role: 'manager' })
    .eq('org_id', args.orgId)
    .eq('role', 'admin');

  const { error } = await supabase
    .from('business_memberships')
    .update({ role_override: 'manager' })
    .eq('org_id', args.orgId)
    .eq('role_override', 'admin');

  if (error && !isMissingBusinessMembershipsTableError(error)) {
    throw new Error(error.message);
  }
}
