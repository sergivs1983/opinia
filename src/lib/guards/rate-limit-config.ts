import { normalizePlanCode, type CanonicalPlanCode } from '@/lib/billing/entitlements';

export type RateLimitBucketKey = 'lito_chat' | 'copy_generate' | 'copy_refine';

type PlanRateLimits = {
  org: number;
  user: number;
};

const RATE_LIMITS: Record<RateLimitBucketKey, Record<CanonicalPlanCode, PlanRateLimits>> = {
  lito_chat: {
    starter: { org: 30, user: 15 },
    business: { org: 90, user: 30 },
    scale: { org: 240, user: 60 },
  },
  copy_generate: {
    starter: { org: 20, user: 10 },
    business: { org: 60, user: 20 },
    scale: { org: 150, user: 40 },
  },
  copy_refine: {
    starter: { org: 30, user: 15 },
    business: { org: 90, user: 30 },
    scale: { org: 240, user: 60 },
  },
};

export function resolveRateLimitsForPlan(params: {
  key: RateLimitBucketKey;
  planCode: string | null | undefined;
}): { planCode: CanonicalPlanCode; orgLimitPerMin: number; userLimitPerMin: number } {
  const planCode = normalizePlanCode(params.planCode);
  const values = RATE_LIMITS[params.key][planCode];

  return {
    planCode,
    orgLimitPerMin: values.org,
    userLimitPerMin: values.user,
  };
}
