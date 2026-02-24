export type BillingCycle = 'monthly' | 'yearly';
export type PricingPlanId = 'starter' | 'pro' | 'agency';
export type PricingLocale = 'ca' | 'es' | 'en';

export type PricingFeatureId =
  | 'business_locations'
  | 'team_seats'
  | 'role_permissions'
  | 'ai_replies'
  | 'multi_language'
  | 'seo_controls'
  | 'content_intelligence'
  | 'content_studio'
  | 'asset_library'
  | 'planner'
  | 'weekly_exports'
  | 'analytics_roi'
  | 'benchmarks'
  | 'connectors_webhook'
  | 'assets_monthly'
  | 'multi_location_support'
  | 'priority_render'
  | 'priority_support';

export type PlanFeatureValue = boolean | string;

export interface PricingFeature {
  id: PricingFeatureId;
  labelKey: string;
}

export interface PricingPlan {
  id: PricingPlanId;
  nameKey: string;
  descriptionKey: string;
  bulletsKeys: [string, string, string];
  monthlyPriceCents: number;
  annualPriceCents: number;
  recommended: boolean;
  ctaHref: string;
  features: Record<PricingFeatureId, PlanFeatureValue>;
}

export interface PricingPlanPrice {
  monthlyPriceCents: number;
  annualPriceCents: number;
  effectiveMonthlyCents: number;
  savingsPct: number;
  currentPriceCents: number;
}

export const YEARLY_MONTHS_CHARGED = 10;
export const YEARLY_MONTHS_BASE = 12;
export const SAVINGS_PERCENT = 17;

export const FEATURES: PricingFeature[] = [
  { id: 'business_locations', labelKey: 'pricing.features.business_locations' },
  { id: 'team_seats', labelKey: 'pricing.features.team_seats' },
  { id: 'role_permissions', labelKey: 'pricing.features.role_permissions' },
  { id: 'ai_replies', labelKey: 'pricing.features.ai_replies' },
  { id: 'multi_language', labelKey: 'pricing.features.multi_language' },
  { id: 'seo_controls', labelKey: 'pricing.features.seo_controls' },
  { id: 'content_intelligence', labelKey: 'pricing.features.content_intelligence' },
  { id: 'content_studio', labelKey: 'pricing.features.content_studio' },
  { id: 'asset_library', labelKey: 'pricing.features.asset_library' },
  { id: 'planner', labelKey: 'pricing.features.planner' },
  { id: 'weekly_exports', labelKey: 'pricing.features.weekly_exports' },
  { id: 'analytics_roi', labelKey: 'pricing.features.analytics_roi' },
  { id: 'benchmarks', labelKey: 'pricing.features.benchmarks' },
  { id: 'connectors_webhook', labelKey: 'pricing.features.connectors_webhook' },
  { id: 'assets_monthly', labelKey: 'pricing.features.assets_monthly' },
  { id: 'multi_location_support', labelKey: 'pricing.features.multi_location_support' },
  { id: 'priority_render', labelKey: 'pricing.features.priority_render' },
  { id: 'priority_support', labelKey: 'pricing.features.priority_support' },
];

const PLAN_DEFS: Omit<PricingPlan, 'annualPriceCents'>[] = [
  {
    id: 'starter',
    nameKey: 'pricing.plans.starter.name',
    descriptionKey: 'pricing.plans.starter.desc',
    bulletsKeys: [
      'pricing.plans.starter.b1',
      'pricing.plans.starter.b2',
      'pricing.plans.starter.b3',
    ],
    monthlyPriceCents: 2900,
    recommended: false,
    ctaHref: '/login?redirect=/dashboard/onboarding',
    features: {
      business_locations: 'pricing.values.starter.business_locations',
      team_seats: 'pricing.values.starter.team_seats',
      role_permissions: 'pricing.values.starter.role_permissions',
      ai_replies: 'pricing.values.starter.ai_replies',
      multi_language: true,
      seo_controls: true,
      content_intelligence: true,
      content_studio: true,
      asset_library: true,
      planner: true,
      weekly_exports: 'pricing.values.starter.weekly_exports',
      analytics_roi: true,
      benchmarks: false,
      connectors_webhook: true,
      assets_monthly: 'pricing.values.starter.assets_monthly',
      multi_location_support: false,
      priority_render: false,
      priority_support: false,
    },
  },
  {
    id: 'pro',
    nameKey: 'pricing.plans.pro.name',
    descriptionKey: 'pricing.plans.pro.desc',
    bulletsKeys: [
      'pricing.plans.pro.b1',
      'pricing.plans.pro.b2',
      'pricing.plans.pro.b3',
    ],
    monthlyPriceCents: 4900,
    recommended: true,
    ctaHref: '/login?redirect=/dashboard/onboarding',
    features: {
      business_locations: 'pricing.values.pro.business_locations',
      team_seats: 'pricing.values.pro.team_seats',
      role_permissions: 'pricing.values.pro.role_permissions',
      ai_replies: 'pricing.values.pro.ai_replies',
      multi_language: true,
      seo_controls: true,
      content_intelligence: true,
      content_studio: true,
      asset_library: true,
      planner: true,
      weekly_exports: 'pricing.values.pro.weekly_exports',
      analytics_roi: true,
      benchmarks: true,
      connectors_webhook: true,
      assets_monthly: 'pricing.values.pro.assets_monthly',
      multi_location_support: true,
      priority_render: false,
      priority_support: true,
    },
  },
  {
    id: 'agency',
    nameKey: 'pricing.plans.agency.name',
    descriptionKey: 'pricing.plans.agency.desc',
    bulletsKeys: [
      'pricing.plans.agency.b1',
      'pricing.plans.agency.b2',
      'pricing.plans.agency.b3',
    ],
    monthlyPriceCents: 14900,
    recommended: false,
    ctaHref: '/login?redirect=/dashboard/onboarding',
    features: {
      business_locations: 'pricing.values.agency.business_locations',
      team_seats: 'pricing.values.agency.team_seats',
      role_permissions: 'pricing.values.agency.role_permissions',
      ai_replies: 'pricing.values.agency.ai_replies',
      multi_language: true,
      seo_controls: true,
      content_intelligence: true,
      content_studio: true,
      asset_library: true,
      planner: true,
      weekly_exports: 'pricing.values.agency.weekly_exports',
      analytics_roi: true,
      benchmarks: true,
      connectors_webhook: true,
      assets_monthly: 'pricing.values.agency.assets_monthly',
      multi_location_support: true,
      priority_render: true,
      priority_support: true,
    },
  },
];

export const PLANS: PricingPlan[] = PLAN_DEFS.map((plan) => ({
  ...plan,
  annualPriceCents: plan.monthlyPriceCents * YEARLY_MONTHS_CHARGED,
}));

export const plans = PLANS;

export function getEffectiveMonthlyCents(annualPriceCents: number): number {
  return annualPriceCents / YEARLY_MONTHS_BASE;
}

export function formatPrice(
  cents: number,
  locale: PricingLocale,
  options?: { decimals?: number },
): string {
  const resolvedLocale = locale === 'ca' ? 'ca-ES' : locale === 'es' ? 'es-ES' : 'en-US';
  const amount = cents / 100;
  const decimals = options?.decimals ?? (Number.isInteger(amount) ? 0 : 2);
  const value = new Intl.NumberFormat(resolvedLocale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);

  return `${value}€`;
}

export function getPrice(
  plan: PricingPlan,
  billing: BillingCycle = 'monthly',
): PricingPlanPrice {
  const monthlyPriceCents = plan.monthlyPriceCents;
  const annualPriceCents = plan.annualPriceCents;
  const effectiveMonthlyCents = getEffectiveMonthlyCents(annualPriceCents);

  return {
    monthlyPriceCents,
    annualPriceCents,
    effectiveMonthlyCents,
    savingsPct: SAVINGS_PERCENT,
    currentPriceCents: billing === 'yearly' ? annualPriceCents : monthlyPriceCents,
  };
}
