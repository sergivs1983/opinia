import { getOrgPlanConfig } from '@/lib/ai/quota';
import { normalizePlanCode } from '@/lib/billing/entitlements';

export type CanonicalPlanCode = 'starter' | 'business' | 'scale';

export type CanonicalPlanEntitlements = {
  plan_code: CanonicalPlanCode;
  drafts_limit: number;
  locations_limit: number;
  seats_limit: number;
  signals_level: 'basic' | 'advanced' | 'full';
  monthly_price_cents: number;
};

function normalizeEnv(value: string | undefined): string | null {
  const trimmed = (value || '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

export const STRIPE_PRICE_IDS: Record<CanonicalPlanCode, string | null> = {
  starter: normalizeEnv(process.env.STRIPE_PRICE_STARTER),
  business: normalizeEnv(process.env.STRIPE_PRICE_BUSINESS || process.env.STRIPE_PRICE_PRO),
  scale: normalizeEnv(process.env.STRIPE_PRICE_SCALE || process.env.STRIPE_PRICE_PRO_149),
};

export const STRIPE_PRICE_TO_PLAN: Record<string, CanonicalPlanCode> = (() => {
  const out: Record<string, CanonicalPlanCode> = {};
  for (const [plan, priceId] of Object.entries(STRIPE_PRICE_IDS) as Array<[CanonicalPlanCode, string | null]>) {
    if (priceId) out[priceId] = plan;
  }
  return out;
})();

const PLAN_SIGNALS: Record<CanonicalPlanCode, 'basic' | 'advanced' | 'full'> = {
  starter: 'basic',
  business: 'advanced',
  scale: 'full',
};

const PLAN_SEATS: Record<CanonicalPlanCode, number> = {
  starter: 1,
  business: 3,
  scale: 10,
};

const PLAN_PRICE_CENTS: Record<CanonicalPlanCode, number> = {
  starter: 2900,
  business: 4900,
  scale: 14900,
};

export function canonicalPlanFromAny(rawPlan: string | null | undefined): CanonicalPlanCode {
  return normalizePlanCode(rawPlan);
}

export function getStripePriceForPlan(plan: CanonicalPlanCode): string | null {
  return STRIPE_PRICE_IDS[plan] || null;
}

export function getPlanFromStripePrice(priceId: string | null | undefined): CanonicalPlanCode | null {
  const trimmed = (priceId || '').trim();
  if (!trimmed) return null;
  return STRIPE_PRICE_TO_PLAN[trimmed] || null;
}

export function getEntitlementsForPlan(plan: CanonicalPlanCode): CanonicalPlanEntitlements {
  const quota = getOrgPlanConfig(plan);
  return {
    plan_code: plan,
    drafts_limit: quota.drafts_limit,
    locations_limit: quota.max_locals,
    seats_limit: PLAN_SEATS[plan],
    signals_level: PLAN_SIGNALS[plan],
    monthly_price_cents: PLAN_PRICE_CENTS[plan],
  };
}

export function toLegacySeatPlanCode(plan: CanonicalPlanCode): 'starter_49' | 'pro_149' {
  return plan === 'scale' ? 'pro_149' : 'starter_49';
}
