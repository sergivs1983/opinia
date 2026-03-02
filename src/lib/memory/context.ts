import type { SupabaseClient } from '@supabase/supabase-js';

export type BizMemoryProfileRow = {
  biz_id: string;
  org_id: string;
  profile_json: Record<string, unknown>;
  updated_at: string;
};

export type BizMemoryVoiceRow = {
  biz_id: string;
  org_id: string;
  voice_json: Record<string, unknown>;
  updated_at: string;
};

export type BizMemoryPolicyRow = {
  id: string;
  biz_id: string;
  org_id: string;
  kind: string;
  rules_json: Record<string, unknown>;
  enabled: boolean;
  priority: number;
  updated_at: string;
};

export type BizMemoryEventRow = {
  id: string;
  biz_id: string;
  org_id: string;
  type: string;
  source: string;
  summary: string;
  evidence_ref: Record<string, unknown>;
  occurred_at: string;
  confidence: number | null;
  created_at: string;
};

export type BizMemoryContext = {
  profile: BizMemoryProfileRow | null;
  voice: BizMemoryVoiceRow | null;
  policies_top: BizMemoryPolicyRow[];
  events_recent: BizMemoryEventRow[];
};

function isSchemaMissing(error: unknown): boolean {
  const code = ((error as { code?: string })?.code || '').toUpperCase();
  const message = ((error as { message?: string })?.message || '').toLowerCase();
  return (
    code === '42P01'
    || code === '42703'
    || code === 'PGRST204'
    || code === 'PGRST205'
    || message.includes('schema cache')
    || message.includes('does not exist')
  );
}

function ensureObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function redactMemorySummaryText(input: string): string {
  return input
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]')
    .replace(/(\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g, '[PHONE]')
    .replace(/https?:\/\/\S+/gi, '[URL]')
    .trim();
}

export function sanitizeMemoryEventSummary(input: string): string {
  return redactMemorySummaryText(input)
    .replace(/\s+/g, ' ')
    .slice(0, 240)
    .trim();
}

export function sanitizeMemoryObject(input: unknown, depth = 0): Record<string, unknown> {
  if (depth > 5 || !input || typeof input !== 'object' || Array.isArray(input)) return {};

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string') {
      out[key] = redactMemorySummaryText(value).slice(0, 280);
      continue;
    }
    if (Array.isArray(value)) {
      out[key] = value
        .slice(0, 20)
        .map((item) => {
          if (typeof item === 'string') return redactMemorySummaryText(item).slice(0, 180);
          if (item && typeof item === 'object') return sanitizeMemoryObject(item, depth + 1);
          if (typeof item === 'number' || typeof item === 'boolean') return item;
          return null;
        })
        .filter((item) => item !== null);
      continue;
    }
    if (value && typeof value === 'object') {
      out[key] = sanitizeMemoryObject(value, depth + 1);
      continue;
    }
    if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      out[key] = value;
    }
  }
  return out;
}

export async function getMemoryContext(params: {
  admin: SupabaseClient;
  bizId: string;
  orgId: string;
  policiesLimit?: number;
  eventsLimit?: number;
}): Promise<BizMemoryContext> {
  const policiesLimit = Math.max(1, Math.min(params.policiesLimit ?? 5, 10));
  const eventsLimit = Math.max(1, Math.min(params.eventsLimit ?? 10, 25));

  const [profileResult, voiceResult, policiesResult, eventsResult] = await Promise.all([
    params.admin
      .from('biz_memory_profile')
      .select('biz_id, org_id, profile_json, updated_at')
      .eq('biz_id', params.bizId)
      .eq('org_id', params.orgId)
      .maybeSingle(),
    params.admin
      .from('biz_memory_voice')
      .select('biz_id, org_id, voice_json, updated_at')
      .eq('biz_id', params.bizId)
      .eq('org_id', params.orgId)
      .maybeSingle(),
    params.admin
      .from('biz_memory_policies')
      .select('id, biz_id, org_id, kind, rules_json, enabled, priority, updated_at')
      .eq('biz_id', params.bizId)
      .eq('org_id', params.orgId)
      .eq('enabled', true)
      .order('priority', { ascending: true })
      .order('updated_at', { ascending: false })
      .limit(policiesLimit),
    params.admin
      .from('biz_memory_events')
      .select('id, biz_id, org_id, type, source, summary, evidence_ref, occurred_at, confidence, created_at')
      .eq('biz_id', params.bizId)
      .eq('org_id', params.orgId)
      .order('occurred_at', { ascending: false })
      .limit(eventsLimit),
  ]);

  if (profileResult.error && !isSchemaMissing(profileResult.error)) throw profileResult.error;
  if (voiceResult.error && !isSchemaMissing(voiceResult.error)) throw voiceResult.error;
  if (policiesResult.error && !isSchemaMissing(policiesResult.error)) throw policiesResult.error;
  if (eventsResult.error && !isSchemaMissing(eventsResult.error)) throw eventsResult.error;

  const profileData = profileResult.error ? null : (profileResult.data as Record<string, unknown> | null);
  const voiceData = voiceResult.error ? null : (voiceResult.data as Record<string, unknown> | null);
  const policiesData = policiesResult.error ? [] : (policiesResult.data || []);
  const eventsData = eventsResult.error ? [] : (eventsResult.data || []);

  return {
    profile: profileData
      ? {
          biz_id: String(profileData.biz_id || params.bizId),
          org_id: String(profileData.org_id || params.orgId),
          profile_json: ensureObject(profileData.profile_json),
          updated_at: String(profileData.updated_at || new Date(0).toISOString()),
        }
      : null,
    voice: voiceData
      ? {
          biz_id: String(voiceData.biz_id || params.bizId),
          org_id: String(voiceData.org_id || params.orgId),
          voice_json: ensureObject(voiceData.voice_json),
          updated_at: String(voiceData.updated_at || new Date(0).toISOString()),
        }
      : null,
    policies_top: (policiesData as Record<string, unknown>[]).map((row) => ({
      id: String(row.id || ''),
      biz_id: String(row.biz_id || params.bizId),
      org_id: String(row.org_id || params.orgId),
      kind: String(row.kind || 'general'),
      rules_json: ensureObject(row.rules_json),
      enabled: Boolean(row.enabled),
      priority: Number.isFinite(Number(row.priority)) ? Number(row.priority) : 100,
      updated_at: String(row.updated_at || new Date(0).toISOString()),
    })),
    events_recent: (eventsData as Record<string, unknown>[]).map((row) => ({
      id: String(row.id || ''),
      biz_id: String(row.biz_id || params.bizId),
      org_id: String(row.org_id || params.orgId),
      type: String(row.type || 'general'),
      source: String(row.source || 'manual'),
      summary: sanitizeMemoryEventSummary(String(row.summary || '')),
      evidence_ref: ensureObject(row.evidence_ref),
      occurred_at: String(row.occurred_at || row.created_at || new Date(0).toISOString()),
      confidence: Number.isFinite(Number(row.confidence)) ? Number(row.confidence) : null,
      created_at: String(row.created_at || new Date(0).toISOString()),
    })),
  };
}

function cleanLine(input: unknown): string | null {
  const value = typeof input === 'string' ? input.trim() : '';
  if (!value) return null;
  return redactMemorySummaryText(value).slice(0, 120);
}

export function buildMemorySummary(context: BizMemoryContext): string {
  const profile = ensureObject(context.profile?.profile_json);
  const voice = ensureObject(context.voice?.voice_json);

  const profileBits = [
    cleanLine(profile.positioning),
    cleanLine(profile.value_proposition),
    cleanLine(profile.audience),
    cleanLine(profile.vertical),
    cleanLine(profile.city),
  ].filter((item): item is string => Boolean(item));

  const voiceBits = [
    cleanLine(voice.tone),
    cleanLine(voice.formality),
    cleanLine(voice.style),
  ].filter((item): item is string => Boolean(item));

  const policyBits = context.policies_top
    .slice(0, 3)
    .map((policy) => cleanLine(policy.kind))
    .filter((item): item is string => Boolean(item));

  const eventBits = context.events_recent
    .slice(0, 2)
    .map((event) => cleanLine(event.summary))
    .filter((item): item is string => Boolean(item));

  const segments: string[] = [];
  if (profileBits.length > 0) segments.push(`Perfil: ${profileBits.join(' · ')}`);
  if (voiceBits.length > 0) segments.push(`To: ${voiceBits.join(' · ')}`);
  if (policyBits.length > 0) segments.push(`Polítiques: ${policyBits.join(', ')}`);
  if (eventBits.length > 0) segments.push(`Historial: ${eventBits.join(' | ')}`);

  return segments.join(' || ').slice(0, 700);
}

export function extractVoiceToneHint(context: BizMemoryContext): string | null {
  const voice = ensureObject(context.voice?.voice_json);
  return cleanLine(voice.tone || voice.style || voice.formality);
}
