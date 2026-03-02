import type { SupabaseClient } from '@supabase/supabase-js';

import { getMemoryContext } from '@/lib/memory/context';
import type { LITOLearnedContext } from '@/lib/lito/context/types';

function cleanPoint(value: unknown, max = 96): string | null {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!text) return null;
  return text.slice(0, max);
}

function uniqueCompact(values: Array<string | null | undefined>, max: number): string[] {
  const out: string[] = [];
  for (const raw of values) {
    const value = cleanPoint(raw);
    if (!value) continue;
    if (out.includes(value)) continue;
    out.push(value);
    if (out.length >= max) break;
  }
  return out;
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readText(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' ? value : null;
}

export async function loadLearnedContext(input: {
  admin: SupabaseClient;
  orgId: string;
  bizId: string;
}): Promise<LITOLearnedContext> {
  try {
    const memory = await getMemoryContext({
      admin: input.admin,
      orgId: input.orgId,
      bizId: input.bizId,
      policiesLimit: 3,
      eventsLimit: 0,
    });

    const profile = asObject(memory.profile?.profile_json);
    const voice = asObject(memory.voice?.voice_json);

    const profilePoints = uniqueCompact([
      readText(profile, 'positioning'),
      readText(profile, 'value_proposition'),
      readText(profile, 'audience'),
      readText(profile, 'vertical'),
      readText(profile, 'city'),
    ], 4);

    const voicePoints = uniqueCompact([
      readText(voice, 'tone'),
      readText(voice, 'formality'),
      readText(voice, 'style'),
      readText(voice, 'signature'),
    ], 3);

    const policyPoints = uniqueCompact(
      memory.policies_top.map((entry) => entry.kind),
      3,
    );

    return {
      memory_available: Boolean(memory.profile || memory.voice || memory.policies_top.length > 0),
      profile_points: profilePoints,
      voice_points: voicePoints,
      policy_points: policyPoints,
    };
  } catch {
    return {
      memory_available: false,
      profile_points: [],
      voice_points: [],
      policy_points: [],
    };
  }
}
