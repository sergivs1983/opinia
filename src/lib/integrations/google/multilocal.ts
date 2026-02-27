type GoogleLocalsPlan = 'starter_29' | 'starter_49' | 'pro_149' | 'enterprise';

function normalize(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase();
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function resolvePlan(planCode?: string | null, plan?: string | null): GoogleLocalsPlan {
  const code = normalize(planCode);
  const legacy = normalize(plan);

  if (
    code === 'enterprise'
    || legacy === 'enterprise'
  ) return 'enterprise';

  if (
    code === 'pro_149'
    || legacy === 'pro_149'
    || legacy === 'pro'
    || legacy === 'agency'
  ) return 'pro_149';

  if (
    code === 'starter_29'
    || legacy === 'starter_29'
    || legacy === 'starter'
    || legacy === 'basic'
    || code.includes('29')
    || legacy.includes('29')
  ) return 'starter_29';

  if (
    code === 'starter_49'
    || legacy === 'starter_49'
    || code.includes('49')
    || legacy.includes('49')
  ) return 'starter_49';

  const defaultPlan = normalize(process.env.ORG_PLAN_DEFAULT);
  if (defaultPlan && defaultPlan !== code && defaultPlan !== legacy) {
    return resolvePlan(defaultPlan, defaultPlan);
  }

  return 'starter_49';
}

export function getGoogleLocalsLimit(args: {
  planCode?: string | null;
  plan?: string | null;
}): number {
  const plan = resolvePlan(args.planCode, args.plan);
  if (plan === 'starter_29') return 2;
  if (plan === 'starter_49') return 5;
  if (plan === 'pro_149') return 10;
  return parsePositiveInt(process.env.ORG_ENTERPRISE_MAX_LOCALS, 25);
}

export function normalizeGoogleLocationId(raw: string): string {
  const value = raw.trim();
  if (!value) return '';
  if (value.includes('/locations/')) {
    return value.split('/locations/').pop() || value;
  }
  if (value.startsWith('locations/')) {
    return value.slice('locations/'.length);
  }
  if (value.includes('/')) return value.split('/').pop() || value;
  return value;
}

export function toSlugBase(name: string, city?: string | null): string {
  const composed = city?.trim() ? `${name}-${city}` : name;
  return composed
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}
