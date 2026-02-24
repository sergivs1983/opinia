/**
 * OpinIA Billing — Plans, limits, and usage enforcement.
 * Server-side only. Never expose Stripe secrets to client.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

type BillingAdminClient = SupabaseClient;
type UsageField = 'ai_generations' | 'reviews_synced' | 'reviews_imported';

interface OrganizationPlanRow {
  plan: string;
  max_reviews_mo: number | null;
}

interface OrganizationSummaryRow {
  plan: string;
  [key: string]: unknown;
}

interface UsageMonthlyRow {
  id: string;
  org_id: string;
  month: string;
  ai_generations: number | null;
  reviews_synced: number | null;
  reviews_imported: number | null;
}

export interface UsageSummary {
  current_month: {
    ai_generations: number;
    reviews_synced: number;
    reviews_imported: number;
  };
  plan: PlanDef;
  org: OrganizationSummaryRow;
}

// ============================================================
// PLAN DEFINITIONS
// ============================================================
export interface PlanDef {
  id: string;
  name: string;
  price_monthly: number;       // EUR
  max_reviews_mo: number;      // AI generations per month
  max_businesses: number;
  max_team_members: number;
  features: string[];
  stripe_price_id: string | null;  // set in env or hardcode after Stripe setup
}

export const PLANS: Record<string, PlanDef> = {
  free: {
    id: 'free',
    name: 'Free',
    price_monthly: 0,
    max_reviews_mo: 10,
    max_businesses: 1,
    max_team_members: 1,
    features: ['10 respostes/mes', '1 negoci', 'Business Memory bàsic'],
    stripe_price_id: null,
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    price_monthly: 19,
    max_reviews_mo: 100,
    max_businesses: 2,
    max_team_members: 3,
    features: ['100 respostes/mes', '2 negocis', 'Business Memory complet', 'Insights', 'Export CSV'],
    stripe_price_id: process.env.STRIPE_PRICE_STARTER || null,
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    price_monthly: 49,
    max_reviews_mo: 500,
    max_businesses: 10,
    max_team_members: 10,
    features: ['500 respostes/mes', '10 negocis', 'Tot inclòs', 'Suport prioritari', 'API accés'],
    stripe_price_id: process.env.STRIPE_PRICE_PRO || null,
  },
};

export function getPlan(planId: string): PlanDef {
  return PLANS[planId] || PLANS.free;
}


// ============================================================
// USAGE ENFORCEMENT (server-side only)
// ============================================================
export interface UsageCheck {
  allowed: boolean;
  current: number;
  limit: number;
  plan: string;
  message?: string;
}

/**
 * Check if an org can generate another AI response this month.
 * Uses admin client to bypass RLS.
 */
export async function checkUsageLimit(
  admin: BillingAdminClient,
  orgId: string
): Promise<UsageCheck> {
  // Get org plan
  const { data: org } = await admin
    .from('organizations')
    .select('plan, max_reviews_mo')
    .eq('id', orgId)
    .single();
  const orgRow = (org as OrganizationPlanRow | null);

  if (!orgRow) {
    return { allowed: false, current: 0, limit: 0, plan: 'free', message: 'Organització no trobada' };
  }

  const plan = getPlan(orgRow.plan);
  const limit = orgRow.max_reviews_mo || plan.max_reviews_mo;

  // Get current month usage
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

  const { data: usage } = await admin
    .from('usage_monthly')
    .select('ai_generations')
    .eq('org_id', orgId)
    .eq('month', monthStart)
    .single();
  const usageRow = usage as Pick<UsageMonthlyRow, 'ai_generations'> | null;

  const current = usageRow?.ai_generations || 0;

  if (current >= limit) {
    return {
      allowed: false,
      current,
      limit,
      plan: orgRow.plan,
      message: `Has arribat al límit de ${limit} generacions/mes (pla ${plan.name}). Actualitza el pla per continuar.`,
    };
  }

  return { allowed: true, current, limit, plan: orgRow.plan };
}

/**
 * Increment usage counter after successful generation.
 */
export async function incrementUsage(
  admin: BillingAdminClient,
  orgId: string,
  field: UsageField = 'ai_generations'
): Promise<void> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

  // Upsert: create row if doesn't exist, increment if does
  const { data: existing } = await admin
    .from('usage_monthly')
    .select('id, ai_generations, reviews_synced, reviews_imported')
    .eq('org_id', orgId)
    .eq('month', monthStart)
    .single();
  const existingRow = existing as Pick<UsageMonthlyRow, 'id' | UsageField> | null;

  if (existingRow) {
    const updatePayload: { [K in UsageField]?: number } = {
      [field]: (existingRow[field] || 0) + 1,
    };
    await admin
      .from('usage_monthly')
      .update(updatePayload)
      .eq('id', existingRow.id);
  } else {
    await admin
      .from('usage_monthly')
      .insert({
        org_id: orgId,
        month: monthStart,
        [field]: 1,
      });
  }
}

/**
 * Get usage summary for billing display.
 */
export async function getUsageSummary(
  admin: BillingAdminClient,
  orgId: string
): Promise<UsageSummary> {
  const { data: org } = await admin
    .from('organizations')
    .select('*')
    .eq('id', orgId)
    .single();
  const orgRow = (org as OrganizationSummaryRow | null) || { plan: 'free' };

  const plan = getPlan(orgRow.plan || 'free');

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

  const { data: usage } = await admin
    .from('usage_monthly')
    .select('*')
    .eq('org_id', orgId)
    .eq('month', monthStart)
    .single();
  const usageRow = usage as UsageMonthlyRow | null;

  return {
    current_month: usageRow
      ? {
          ai_generations: usageRow.ai_generations || 0,
          reviews_synced: usageRow.reviews_synced || 0,
          reviews_imported: usageRow.reviews_imported || 0,
        }
      : { ai_generations: 0, reviews_synced: 0, reviews_imported: 0 },
    plan,
    org: orgRow,
  };
}
