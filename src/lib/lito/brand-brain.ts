export type BrandVoiceFormality = 'tu' | 'voste' | 'mixt';
export type BrandPriorityFocus = 'reviews' | 'social' | 'both';
export type BusinessMemoryType = 'hotel' | 'restaurant' | 'bar_cafeteria' | 'retail' | 'other' | '';

export type BusinessMemoryBrandVoice = {
  tone: string[];
  formality: BrandVoiceFormality;
  avoid: string[];
  keywords: string[];
  examples: string[];
};

export type BusinessMemoryPolicies = {
  require_approval: boolean;
  response_time_h: number;
  never_mention: string[];
  max_length_words: number;
  primary_focus: BrandPriorityFocus;
};

export type BusinessMemoryFacts = {
  type: BusinessMemoryType;
  services: string[];
  hours: string[];
  location_notes: string;
  seasonal_peaks: string[];
  current_offers: string[];
  faqs: string[];
};

export type BusinessMemoryPayload = {
  brand_voice: BusinessMemoryBrandVoice;
  policies: BusinessMemoryPolicies;
  business_facts: BusinessMemoryFacts;
};

export const DEFAULT_BUSINESS_MEMORY: BusinessMemoryPayload = {
  brand_voice: {
    tone: [],
    formality: 'mixt',
    avoid: [],
    keywords: [],
    examples: [],
  },
  policies: {
    require_approval: true,
    response_time_h: 4,
    never_mention: [],
    max_length_words: 120,
    primary_focus: 'both',
  },
  business_facts: {
    type: '',
    services: [],
    hours: [],
    location_notes: '',
    seasonal_peaks: [],
    current_offers: [],
    faqs: [],
  },
};

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function cleanText(value: unknown, maxLen: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function cleanStringArray(value: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];

  for (const item of value) {
    const next = cleanText(item, maxLen);
    if (!next) continue;
    const dedupeKey = next.toLocaleLowerCase('ca');
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(next);
    if (out.length >= maxItems) break;
  }

  return out;
}

function cleanCommaSeparated(value: string, maxItems: number, maxLen: number): string[] {
  return cleanStringArray(
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
    maxItems,
    maxLen,
  );
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  return fallback;
}

function asIntInRange(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const floored = Math.floor(value);
  if (floored < min) return min;
  if (floored > max) return max;
  return floored;
}

function normalizePrimaryFocus(value: unknown, fallback: BrandPriorityFocus): BrandPriorityFocus {
  if (value === 'reviews' || value === 'social' || value === 'both') return value;
  return fallback;
}

function normalizeFormality(value: unknown, fallback: BrandVoiceFormality): BrandVoiceFormality {
  if (value === 'tu' || value === 'voste' || value === 'mixt') return value;
  if (value === 'voste') return 'voste';
  return fallback;
}

function normalizeBusinessType(value: unknown, fallback: BusinessMemoryType): BusinessMemoryType {
  if (
    value === 'hotel'
    || value === 'restaurant'
    || value === 'bar_cafeteria'
    || value === 'retail'
    || value === 'other'
  ) {
    return value;
  }
  return fallback;
}

export function sanitizeBusinessMemoryInput(input: unknown): BusinessMemoryPayload {
  const root = asObject(input);
  const brandVoice = asObject(root.brand_voice);
  const policies = asObject(root.policies);
  const businessFacts = asObject(root.business_facts);

  return {
    brand_voice: {
      tone: cleanStringArray(brandVoice.tone, 12, 48),
      formality: normalizeFormality(brandVoice.formality, DEFAULT_BUSINESS_MEMORY.brand_voice.formality),
      avoid: cleanStringArray(brandVoice.avoid, 16, 60),
      keywords: cleanStringArray(brandVoice.keywords, 20, 40),
      examples: cleanStringArray(brandVoice.examples, 8, 220),
    },
    policies: {
      require_approval: asBoolean(policies.require_approval, DEFAULT_BUSINESS_MEMORY.policies.require_approval),
      response_time_h: asIntInRange(policies.response_time_h, DEFAULT_BUSINESS_MEMORY.policies.response_time_h, 1, 168),
      never_mention: cleanStringArray(policies.never_mention, 16, 80),
      max_length_words: asIntInRange(
        policies.max_length_words,
        DEFAULT_BUSINESS_MEMORY.policies.max_length_words,
        20,
        300,
      ),
      primary_focus: normalizePrimaryFocus(
        policies.primary_focus,
        DEFAULT_BUSINESS_MEMORY.policies.primary_focus,
      ),
    },
    business_facts: {
      type: normalizeBusinessType(
        businessFacts.type,
        DEFAULT_BUSINESS_MEMORY.business_facts.type,
      ),
      services: cleanStringArray(businessFacts.services, 20, 80),
      hours: cleanStringArray(businessFacts.hours, 14, 120),
      location_notes: cleanText(businessFacts.location_notes, 280),
      seasonal_peaks: cleanStringArray(businessFacts.seasonal_peaks, 12, 80),
      current_offers: cleanStringArray(businessFacts.current_offers, 12, 120),
      faqs: cleanStringArray(businessFacts.faqs, 16, 220),
    },
  };
}

export function splitCommaSeparatedInput(value: string, maxItems: number, maxLen: number): string[] {
  return cleanCommaSeparated(value, maxItems, maxLen);
}
