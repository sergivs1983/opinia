import { z } from 'zod';

import { buildIkeaPayload, type IkeaVertical } from '@/lib/lito/ikea';

export type LitoCopyFormat = 'post' | 'story' | 'reel';
export type LitoCopyChannel = 'instagram' | 'tiktok' | 'facebook';
export type LitoCopyTone = 'formal' | 'neutral' | 'friendly';
export type LitoQuickRefineMode =
  | 'shorter'
  | 'premium'
  | 'funny'
  | 'formal'
  | 'translate_ca'
  | 'translate_es'
  | 'translate_en';

export type LitoGeneratedCopy = {
  caption_short: string;
  caption_long: string;
  hashtags: string[];
  shotlist: string[];
  image_idea: string;
  execution_checklist: string[];
  stickers: Array<'poll' | 'question' | 'countdown'>;
  director_notes: string[];
  assets_needed: string[];
  format: LitoCopyFormat;
  language: 'ca' | 'es' | 'en';
  channel: LitoCopyChannel;
  tone: LitoCopyTone;
};

export type BuildCopyBaseInput = {
  templateRaw: unknown;
  generatedCopyRaw: unknown;
  vertical: IkeaVertical;
  signal?: Record<string, unknown>;
  format?: string | null;
  language: 'ca' | 'es' | 'en';
  channel: LitoCopyChannel;
  tone: LitoCopyTone;
};

const ModelOutputSchema = z.object({
  caption_short: z.string().min(1).max(280),
  caption_long: z.string().min(1).max(500),
  hashtags: z.array(z.string().min(1)).min(1).max(10),
  shotlist: z.array(z.string().min(1)).min(1).max(8).optional(),
  image_idea: z.string().min(1).max(500),
  execution_checklist: z.array(z.string().min(1)).min(1).max(12).optional(),
  stickers: z.array(z.enum(['poll', 'question', 'countdown'])).optional(),
});

function clampText(value: unknown, max: number, fallback: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return fallback;
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}…`;
}

function cleanArray(input: unknown, fallback: string[], max = 8): string[] {
  if (!Array.isArray(input)) return fallback.slice(0, max);
  const normalized = input
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
  if (normalized.length === 0) return fallback.slice(0, max);
  return [...new Set(normalized)].slice(0, max);
}

function normalizeLanguage(input: unknown): 'ca' | 'es' | 'en' {
  const value = (typeof input === 'string' ? input : '').trim().toLowerCase();
  if (value === 'es' || value === 'en') return value;
  return 'ca';
}

function normalizeFormat(input: unknown): LitoCopyFormat {
  const value = (typeof input === 'string' ? input : '').trim().toLowerCase();
  if (value === 'story' || value === 'reel') return value;
  return 'post';
}

function normalizeChannel(input: unknown): LitoCopyChannel {
  const value = (typeof input === 'string' ? input : '').trim().toLowerCase();
  if (value === 'facebook' || value === 'tiktok') return value;
  return 'instagram';
}

function normalizeTone(input: unknown): LitoCopyTone {
  const value = (typeof input === 'string' ? input : '').trim().toLowerCase();
  if (value === 'formal' || value === 'friendly') return value as LitoCopyTone;
  return 'neutral';
}

function normalizeHashtags(tags: string[], fallback?: string[]): string[] {
  const cleaned = tags
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`))
    .map((tag) =>
      tag
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w#]/g, ''),
    )
    .filter((tag) => tag.length > 1);

  const unique = [...new Set(cleaned)];
  const fallbackPool = (fallback || ['#opinia', '#negocilocal', '#experiencia'])
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`))
    .map((tag) =>
      tag
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w#]/g, ''),
    )
    .filter((tag) => tag.length > 1);

  for (const tag of fallbackPool) {
    if (unique.length >= 3) break;
    if (!unique.includes(tag)) unique.push(tag);
  }

  while (unique.length < 3) {
    const synthetic = `#opinia${unique.length + 1}`;
    if (!unique.includes(synthetic)) unique.push(synthetic);
  }

  return unique.slice(0, 3);
}

function normalizeShotlist(shotlist: string[], fallback?: string[]): string[] {
  const base = [...new Set(shotlist.map((item) => item.trim()).filter(Boolean))].slice(0, 6);
  const fallbackItems = (fallback || [
    'Pla curt del producte o servei principal.',
    'Pla humà de l’equip atenent o preparant.',
    'Pla final amb CTA visible en pantalla.',
  ])
    .map((item) => item.trim())
    .filter(Boolean);

  for (const item of fallbackItems) {
    if (base.length >= 3) break;
    if (!base.includes(item)) base.push(item);
  }

  while (base.length < 3) {
    base.push(`Pla de suport ${base.length + 1}`);
  }

  return base.slice(0, 6);
}

function parseJson(text: string): unknown {
  const cleaned = text.replace(/```json|```/gi, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function asGeneratedCopyRaw(input: unknown): string | null {
  if (!input) return null;
  if (typeof input === 'string') return input;
  try {
    return JSON.stringify(input);
  } catch {
    return null;
  }
}

export function buildDeterministicCopyBase(input: BuildCopyBaseInput): LitoGeneratedCopy {
  const generatedCopyRaw = asGeneratedCopyRaw(input.generatedCopyRaw);
  const ikea = buildIkeaPayload({
    templateRaw: input.templateRaw,
    generatedCopyRaw,
    vertical: input.vertical,
    signal: input.signal || {},
  });

  const format = normalizeFormat(input.format || ikea.format);
  return {
    caption_short: clampText(ikea.copy_short, 280, ''),
    caption_long: clampText(ikea.copy_long, 500, ''),
    hashtags: normalizeHashtags(ikea.hashtags),
    shotlist: normalizeShotlist(cleanArray(ikea.director_notes, ikea.steps, 8), ikea.steps),
    image_idea: clampText(
      `${ikea.copy_short}. ${ikea.assets_needed[0] || 'Mostra un detall real del negoci.'}`,
      500,
      'Mostra una escena real del negoci amb llum natural.',
    ),
    execution_checklist: cleanArray(ikea.steps, [], 10),
    stickers: format === 'story' ? ['poll'] : [],
    director_notes: cleanArray(ikea.director_notes, [], 8),
    assets_needed: cleanArray(ikea.assets_needed, [], 10),
    format,
    language: normalizeLanguage(input.language),
    channel: normalizeChannel(input.channel),
    tone: normalizeTone(input.tone),
  };
}

export function parseModelOutput(content: string): z.infer<typeof ModelOutputSchema> | null {
  const parsed = parseJson(content);
  const result = ModelOutputSchema.safeParse(parsed);
  if (!result.success) return null;
  return result.data;
}

export function mergeModelOutputIntoCopy(base: LitoGeneratedCopy, model: z.infer<typeof ModelOutputSchema>): LitoGeneratedCopy {
  const format = normalizeFormat(base.format);
  const nextChecklist = cleanArray(model.execution_checklist, base.execution_checklist, 10);
  const nextShotlist = normalizeShotlist(cleanArray(model.shotlist, base.shotlist, 8), base.shotlist);
  const nextHashtags = normalizeHashtags(cleanArray(model.hashtags, base.hashtags, 8), base.hashtags);

  return {
    ...base,
    caption_short: clampText(model.caption_short, 280, base.caption_short),
    caption_long: clampText(model.caption_long, 500, base.caption_long),
    hashtags: nextHashtags,
    shotlist: nextShotlist,
    image_idea: clampText(model.image_idea, 500, base.image_idea),
    execution_checklist: nextChecklist.length > 0 ? nextChecklist : base.execution_checklist,
    stickers: format === 'story'
      ? (model.stickers && model.stickers.length > 0 ? model.stickers : base.stickers)
      : [],
  };
}

export function parseStoredGeneratedCopy(raw: unknown): LitoGeneratedCopy | null {
  if (!raw) return null;
  const parsed = typeof raw === 'string' ? parseJson(raw) : raw;
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  if (
    typeof obj.caption_short !== 'string'
    || typeof obj.caption_long !== 'string'
    || !Array.isArray(obj.hashtags)
    || !Array.isArray(obj.execution_checklist)
    || !Array.isArray(obj.assets_needed)
  ) {
    return null;
  }

  return {
    caption_short: clampText(obj.caption_short, 280, ''),
    caption_long: clampText(obj.caption_long, 500, ''),
    hashtags: normalizeHashtags(cleanArray(obj.hashtags, [], 8)),
    shotlist: normalizeShotlist(cleanArray(obj.shotlist, [], 8)),
    image_idea: clampText(obj.image_idea, 500, ''),
    execution_checklist: cleanArray(obj.execution_checklist, [], 10),
    stickers: Array.isArray(obj.stickers)
      ? obj.stickers.filter((item): item is 'poll' | 'question' | 'countdown' =>
        item === 'poll' || item === 'question' || item === 'countdown')
      : [],
    director_notes: cleanArray(obj.director_notes, [], 8),
    assets_needed: cleanArray(obj.assets_needed, [], 10),
    format: normalizeFormat(obj.format),
    language: normalizeLanguage(obj.language),
    channel: normalizeChannel(obj.channel),
    tone: normalizeTone(obj.tone),
  };
}

export function resolveQuickRefineInstruction(mode: LitoQuickRefineMode): string {
  switch (mode) {
    case 'shorter':
      return 'Fes el copy més curt i directe, mantenint el missatge principal.';
    case 'premium':
      return 'Dona-li un to més premium i elegant, sense sonar distant.';
    case 'funny':
      return 'Fes-lo més proper i lleugerament divertit, sense perdre professionalitat.';
    case 'formal':
      return 'Dona-li un to més formal i corporatiu.';
    case 'translate_ca':
      return 'Reescriu el copy complet en català natural.';
    case 'translate_es':
      return 'Reescriu el copy complet en castellà natural.';
    case 'translate_en':
      return 'Rewrite the copy in natural US English.';
    default:
      return 'Refina el copy mantenint la idea principal.';
  }
}

export function buildGeneratePrompt(params: {
  businessName: string;
  vertical: string;
  city?: string | null;
  language: string;
  channel: LitoCopyChannel;
  tone: LitoCopyTone;
  format: LitoCopyFormat;
  template: { hook: string; idea: string; cta: string };
  aiInstructions?: string | null;
  threadContext?: string[];
}): string {
  const contextLines = (params.threadContext || []).slice(0, 10);
  return [
    `Negoci: ${params.businessName}`,
    `Vertical: ${params.vertical || 'general'}`,
    `Ciutat: ${params.city || '-'}`,
    `Idioma: ${params.language}`,
    `Canal: ${params.channel}`,
    `To: ${params.tone}`,
    `Format: ${params.format}`,
    '',
    `Recomanació:`,
    `- Hook: ${params.template.hook}`,
    `- Idea: ${params.template.idea}`,
    `- CTA: ${params.template.cta}`,
    '',
    `Instruccions de negoci: ${params.aiInstructions || '-'}`,
    '',
    `Context recent (si n'hi ha):`,
    ...(contextLines.length > 0 ? contextLines.map((line, idx) => `${idx + 1}. ${line}`) : ['- cap']),
    '',
    'Retorna NOMÉS JSON vàlid amb aquest esquema:',
    '{"caption_short":"...<=280","caption_long":"...<=500","hashtags":["#..."],"shotlist":["..."],"image_idea":"...","execution_checklist":["..."],"stickers":["poll"]}',
    'Hashtags sense accents ni espais.',
  ].join('\n');
}

export function buildRefinePrompt(params: {
  language: string;
  instruction: string;
  current: LitoGeneratedCopy;
}): string {
  return [
    `Idioma objectiu: ${params.language}`,
    `Instrucció de refinament: ${params.instruction}`,
    '',
    'Copy actual (JSON):',
    JSON.stringify(
      {
        caption_short: params.current.caption_short,
        caption_long: params.current.caption_long,
        hashtags: params.current.hashtags,
        shotlist: params.current.shotlist,
        image_idea: params.current.image_idea,
      },
      null,
      2,
    ),
    '',
    'Retorna NOMÉS JSON vàlid amb el mateix esquema:',
    '{"caption_short":"...<=280","caption_long":"...<=500","hashtags":["#..."],"shotlist":["..."],"image_idea":"...","execution_checklist":["..."],"stickers":["poll"]}',
    'No afegeixis text fora del JSON.',
  ].join('\n');
}
