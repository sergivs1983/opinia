import { z } from 'zod';

export const BIZ_SETTINGS_AI_ENGINE = 'opinia_ai' as const;
export const BIZ_SETTINGS_MAX_INSTRUCTIONS = 500;
export const BIZ_SETTINGS_MAX_KEYWORDS = 20;
export const BIZ_SETTINGS_MAX_KEYWORD_LENGTH = 50;

export type BizSettingsRow = {
  biz_id: string;
  signature: string | null;
  ai_instructions: string | null;
  keywords_use: string[];
  keywords_avoid: string[];
  ai_engine: string;
  seo_enabled: boolean;
  updated_at: string;
  updated_by: string | null;
};

export const DEFAULT_BIZ_SETTINGS = {
  signature: null,
  ai_instructions: null,
  keywords_use: [] as string[],
  keywords_avoid: [] as string[],
  ai_engine: BIZ_SETTINGS_AI_ENGINE,
  seo_enabled: false,
};

export const SettingsPatchSchema = z.object({
  biz_id: z.string().uuid().optional(),
  signature: z.string().max(120).optional().nullable(),
  ai_instructions: z.string().max(BIZ_SETTINGS_MAX_INSTRUCTIONS).optional().nullable(),
  keywords_use: z.union([z.array(z.string()), z.string()]).optional(),
  keywords_avoid: z.union([z.array(z.string()), z.string()]).optional(),
  ai_engine: z.string().trim().min(1).max(60).optional(),
  seo_enabled: z.boolean().optional(),
}).strict();

const INJECTION_PATTERNS: RegExp[] = [
  /<\s*script\b/i,
  /<\s*\/\s*script\s*>/i,
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /system\s*prompt/i,
  /prompt\s*injection/i,
  /```/,
  /;\s*drop\s+table/i,
  /union\s+select/i,
];

export function hasBasicInjectionPattern(input: string): boolean {
  return INJECTION_PATTERNS.some((pattern) => pattern.test(input));
}

function normalizeKeywordToken(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function toKeywordTokens(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.split(','))
      .flat();
  }
  if (typeof input === 'string') {
    return input.split(',');
  }
  return [];
}

export function sanitizeKeywordList(
  input: unknown,
): { ok: true; value: string[] } | { ok: false; error: string } {
  const rawTokens = toKeywordTokens(input);
  const unique: string[] = [];
  const seen = new Set<string>();

  for (const token of rawTokens) {
    const normalized = normalizeKeywordToken(token);
    if (!normalized) continue;
    if (normalized.length > BIZ_SETTINGS_MAX_KEYWORD_LENGTH) {
      return { ok: false, error: 'keyword_too_long' };
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
    if (unique.length > BIZ_SETTINGS_MAX_KEYWORDS) {
      return { ok: false, error: 'too_many_keywords' };
    }
  }

  return { ok: true, value: unique };
}

export function sanitizeAiInstructions(
  input: string | null | undefined,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (input === null || input === undefined) {
    return { ok: true, value: null };
  }

  const value = String(input).trim();
  if (!value) return { ok: true, value: null };
  if (value.length > BIZ_SETTINGS_MAX_INSTRUCTIONS) {
    return { ok: false, error: 'ai_instructions_too_long' };
  }
  if (hasBasicInjectionPattern(value)) {
    return { ok: false, error: 'ai_instructions_injection_pattern' };
  }

  return { ok: true, value };
}

export function canEditBizSettingsRole(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'manager';
}

export type SanitizedSettingsPatch = Partial<Pick<
  BizSettingsRow,
  'signature' | 'ai_instructions' | 'keywords_use' | 'keywords_avoid' | 'ai_engine' | 'seo_enabled'
>>;

export function sanitizeSettingsPatch(
  input: z.infer<typeof SettingsPatchSchema>,
): { ok: true; value: SanitizedSettingsPatch } | { ok: false; error: string } {
  const patch: SanitizedSettingsPatch = {};

  if (Object.prototype.hasOwnProperty.call(input, 'signature')) {
    const normalized = typeof input.signature === 'string' ? input.signature.trim() : '';
    patch.signature = normalized.length > 0 ? normalized : null;
  }

  if (Object.prototype.hasOwnProperty.call(input, 'ai_instructions')) {
    const sanitized = sanitizeAiInstructions(input.ai_instructions ?? null);
    if (!sanitized.ok) return sanitized;
    patch.ai_instructions = sanitized.value;
  }

  if (Object.prototype.hasOwnProperty.call(input, 'keywords_use')) {
    const sanitized = sanitizeKeywordList(input.keywords_use);
    if (!sanitized.ok) return sanitized;
    patch.keywords_use = sanitized.value;
  }

  if (Object.prototype.hasOwnProperty.call(input, 'keywords_avoid')) {
    const sanitized = sanitizeKeywordList(input.keywords_avoid);
    if (!sanitized.ok) return sanitized;
    patch.keywords_avoid = sanitized.value;
  }

  if (Object.prototype.hasOwnProperty.call(input, 'ai_engine')) {
    // Engine is locked to OpinIA AI in this release.
    patch.ai_engine = BIZ_SETTINGS_AI_ENGINE;
  }

  if (Object.prototype.hasOwnProperty.call(input, 'seo_enabled')) {
    patch.seo_enabled = Boolean(input.seo_enabled);
  }

  return { ok: true, value: patch };
}

export function pickBizIdCandidates(args: {
  queryBizId: string | null;
  headerBizId: string | null;
  bodyBizId: string | null;
}): string | null {
  return args.queryBizId || args.headerBizId || args.bodyBizId || null;
}
