import type { SupabaseClient } from '@supabase/supabase-js';

import { sanitizeBusinessMemoryInput } from '@/lib/lito/brand-brain';
import type { LITOBusinessContext } from '@/lib/lito/context/types';

type BusinessRow = {
  id: string;
  org_id: string;
  name: string;
  type: string | null;
  city: string | null;
  country: string | null;
  default_language: string | null;
  formality: string | null;
};

type OrganizationRow = {
  id: string;
  ai_provider: string | null;
};

function normalizeLanguage(value: string | null | undefined): 'ca' | 'es' | 'en' {
  const normalized = (value || '').trim().toLowerCase();
  if (normalized === 'es' || normalized === 'en') return normalized;
  return 'ca';
}

function normalizeFormality(value: string | null | undefined): 'tu' | 'voste' | 'neutral' {
  const normalized = (value || '').trim().toLowerCase();
  if (normalized === 'tu') return 'tu';
  if (normalized === 'voste') return 'voste';
  return 'neutral';
}

function normalizeProvider(value: string | null | undefined): 'auto' | 'openai' | 'anthropic' {
  const normalized = (value || '').trim().toLowerCase();
  if (normalized === 'openai' || normalized === 'anthropic') return normalized;
  return 'auto';
}

export async function loadBusinessContext(input: {
  admin: SupabaseClient;
  bizId: string;
}): Promise<LITOBusinessContext> {
  const { data: businessData, error: businessError } = await input.admin
    .from('businesses')
    .select('id, org_id, name, type, city, country, default_language, formality')
    .eq('id', input.bizId)
    .maybeSingle();

  if (businessError || !businessData) {
    throw new Error(businessError?.message || 'lito_context_business_not_found');
  }

  const business = businessData as BusinessRow;

  const [{ data: orgData, error: orgError }, { data: memoryData, error: memoryError }] = await Promise.all([
    input.admin
      .from('organizations')
      .select('id, ai_provider')
      .eq('id', business.org_id)
      .maybeSingle(),
    input.admin
      .from('business_memory')
      .select('brand_voice, policies, business_facts')
      .eq('biz_id', business.id)
      .maybeSingle(),
  ]);

  if (orgError) {
    throw new Error(orgError.message || 'lito_context_org_lookup_failed');
  }
  if (memoryError) {
    throw new Error(memoryError.message || 'lito_context_business_memory_lookup_failed');
  }

  const organization = (orgData || null) as OrganizationRow | null;
  const memory = sanitizeBusinessMemoryInput(memoryData || {});

  return {
    biz_id: business.id,
    org_id: business.org_id,
    business_name: business.name,
    vertical: (business.type || 'general').toLowerCase(),
    city: business.city,
    country: business.country,
    language: normalizeLanguage(business.default_language),
    formality: normalizeFormality(business.formality),
    ai_provider_preference: normalizeProvider(organization?.ai_provider),
    channels: ['instagram', 'tiktok'],
    memory,
  };
}
