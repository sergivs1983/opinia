import type { Business, ContentSuggestion } from '@/types/database';
import type { JsonObject, JsonValue } from '@/types/json';

export type StudioLanguage = 'ca' | 'es' | 'en';
export type StudioFormat = 'story' | 'feed';
export type StudioTemplateId = 'quote-clean' | 'feature-split' | 'top3-reasons' | 'behind-scenes';
export type StudioPlatform = 'x' | 'threads';
export type StudioTone = 'professional' | 'friendly' | 'bold';

export interface StudioBrandOverride {
  primary?: string;
  secondary?: string;
  text?: string;
  logo_url?: string;
}

export interface StudioBrand {
  primary: string;
  secondary: string;
  text: string;
  logo_url: string | null;
}

export interface StudioRenderPayload {
  business_name: string;
  language: StudioLanguage;
  format: StudioFormat;
  template_id: StudioTemplateId;
  title: string;
  hook: string;
  caption: string;
  quote: string;
  cta: string;
  best_time: string;
  bullets: string[];
  hashtags: string[];
  brand: StudioBrand;
}

export interface RenderStudioPngResult {
  pngBuffer: Buffer;
  pngBase64: string;
  width: number;
  height: number;
  usedFallback: boolean;
}

interface SuggestionInput {
  title: string | null;
  hook: string | null;
  caption: string | null;
  cta: string | null;
  best_time: string | null;
  shot_list: JsonValue;
  hashtags: string[];
  evidence: JsonValue;
}

interface RenderTemplateParams {
  payload: StudioRenderPayload;
}

interface GenerateTextVariantsParams {
  platform: StudioPlatform;
  language: StudioLanguage;
  tone: StudioTone;
  suggestion: SuggestionInput;
  differentiators?: string[];
}

interface BuildStoragePathsArgs {
  businessId: string;
  assetId: string;
  format: StudioFormat;
  templateId: StudioTemplateId;
  now?: Date;
}

interface BuildPayloadFromStoredArgs {
  storedPayload: JsonValue;
  businessName: string;
  language: StudioLanguage;
  format: StudioFormat;
  templateId: StudioTemplateId;
  brand?: StudioBrandOverride;
}

const LANGUAGE_SET = new Set<StudioLanguage>(['ca', 'es', 'en']);
const TEMPLATE_SET = new Set<StudioTemplateId>(['quote-clean', 'feature-split', 'top3-reasons', 'behind-scenes']);

const FALLBACK_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl9dB8AAAAASUVORK5CYII=';

const DEFAULT_BRAND: StudioBrand = {
  primary: '#2563eb',
  secondary: '#eff6ff',
  text: '#0f172a',
  logo_url: null,
};

const CONTENT_ASSETS_BUCKET = 'content-assets';

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeHexColor(value: unknown, fallback: string): string {
  const text = asText(value);
  if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(text)) return text;
  return fallback;
}

function toUniqueLines(values: string[], max: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = value.toLowerCase();
    if (!value || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(value);
    if (out.length >= max) break;
  }
  return out;
}

function asStringArray(value: JsonValue, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const values = value
    .map((item) => asText(item))
    .filter((item) => item.length > 0);
  return toUniqueLines(values, max);
}

function extractEvidenceQuotes(evidence: JsonValue): string[] {
  if (!Array.isArray(evidence)) return [];

  const quotes = evidence
    .map((item) => {
      if (!item || typeof item !== 'object') return '';
      const quote = (item as { quote?: unknown }).quote;
      return asText(quote);
    })
    .filter((quote) => quote.length > 0)
    .map((quote) => clip(quote, 220));

  return toUniqueLines(quotes, 3);
}

function getLocalizedFallback(language: StudioLanguage) {
  return {
    ca: {
      title: 'Nova idea per publicar',
      quote: 'Els clients destaquen aquesta experiència aquesta setmana.',
      cta: 'Reserva ara',
      directPrefix: 'Directe',
      storyPrefix: 'Història curta',
      hotTakePrefix: 'Punt de vista',
    },
    es: {
      title: 'Nueva idea para publicar',
      quote: 'Los clientes destacan esta experiencia esta semana.',
      cta: 'Reserva ahora',
      directPrefix: 'Directo',
      storyPrefix: 'Historia breve',
      hotTakePrefix: 'Punto de vista',
    },
    en: {
      title: 'New publish-ready idea',
      quote: 'Guests keep highlighting this experience this week.',
      cta: 'Book now',
      directPrefix: 'Direct',
      storyPrefix: 'Short story',
      hotTakePrefix: 'Take',
    },
  }[language];
}

function applyTone(text: string, tone: StudioTone): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return '';

  if (tone === 'professional') {
    return clean
      .replace(/\s*!+/g, '.')
      .replace(/\s*\?+/g, '?');
  }

  if (tone === 'bold') {
    const segments = clean.split('. ');
    if (segments.length === 0) return clean;
    segments[0] = segments[0].toUpperCase();
    return segments.join('. ');
  }

  return clean;
}

function platformLimit(platform: StudioPlatform): number {
  return platform === 'threads' ? 320 : 240;
}

function clampVariant(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const sliced = value.slice(0, limit - 1);
  const cut = sliced.lastIndexOf(' ');
  if (cut > 60) {
    return `${sliced.slice(0, cut).trimEnd()}…`;
  }
  return `${sliced.trimEnd()}…`;
}

function buildQuoteCleanTemplate({ payload }: RenderTemplateParams): string {
  return `
    <main class="frame quote-clean">
      <div class="chip">${escapeHtml(payload.format.toUpperCase())}</div>
      <section class="quote-block">
        <p class="quote">“${escapeHtml(payload.quote)}”</p>
      </section>
      <footer>
        <p class="author">${escapeHtml(payload.business_name)}</p>
        <p class="cta">${escapeHtml(payload.cta)}</p>
      </footer>
    </main>
  `;
}

function buildFeatureSplitTemplate({ payload }: RenderTemplateParams): string {
  const bullets = payload.bullets
    .slice(0, 3)
    .map((bullet) => `<li>${escapeHtml(bullet)}</li>`)
    .join('');

  return `
    <main class="frame feature-split">
      <section class="left">
        <p class="eyebrow">${escapeHtml(payload.template_id)}</p>
        <h1>${escapeHtml(payload.title)}</h1>
        <p class="hook">${escapeHtml(payload.hook)}</p>
        <p class="caption">${escapeHtml(payload.caption)}</p>
      </section>
      <section class="right">
        <h2>Key points</h2>
        <ul>${bullets}</ul>
        <p class="time">${escapeHtml(payload.best_time || '-')}</p>
      </section>
    </main>
  `;
}

function buildTemplateMarkup(params: RenderTemplateParams): string {
  const templateId = params.payload.template_id;
  if (templateId === 'quote-clean') return buildQuoteCleanTemplate(params);
  return buildFeatureSplitTemplate(params);
}

function buildTemplateHtml(payload: StudioRenderPayload): string {
  const { width, height } = getStudioDimensions(payload.format);

  const templateMarkup = buildTemplateMarkup({ payload });

  return `
<!doctype html>
<html lang="${payload.language}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=${width}, initial-scale=1" />
    <style>
      * { box-sizing: border-box; }
      html, body {
        margin: 0;
        width: ${width}px;
        height: ${height}px;
        overflow: hidden;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        color: ${payload.brand.text};
      }
      body {
        background: linear-gradient(160deg, ${payload.brand.secondary} 0%, #ffffff 45%, ${payload.brand.secondary} 100%);
      }
      .frame {
        width: 100%;
        height: 100%;
        padding: 72px;
      }
      .chip {
        display: inline-block;
        padding: 10px 18px;
        border-radius: 999px;
        font-size: 20px;
        letter-spacing: 0.04em;
        background: ${payload.brand.primary};
        color: #ffffff;
        font-weight: 700;
      }
      .quote-clean {
        display: grid;
        grid-template-rows: auto 1fr auto;
        gap: 28px;
      }
      .quote-block {
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
        border-radius: 36px;
        padding: 48px;
        background: rgba(255, 255, 255, 0.82);
        border: 2px solid rgba(15, 23, 42, 0.08);
      }
      .quote {
        margin: 0;
        font-size: 74px;
        line-height: 1.08;
        font-weight: 700;
      }
      .author {
        margin: 0;
        font-size: 30px;
        font-weight: 700;
      }
      .cta {
        margin: 10px 0 0;
        font-size: 28px;
        color: ${payload.brand.primary};
      }
      .feature-split {
        display: grid;
        grid-template-columns: 1.1fr 0.9fr;
        gap: 34px;
      }
      .left, .right {
        border-radius: 32px;
        background: rgba(255,255,255,0.88);
        border: 2px solid rgba(15, 23, 42, 0.08);
        padding: 40px;
      }
      .eyebrow {
        margin: 0;
        font-size: 20px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: ${payload.brand.primary};
      }
      h1 {
        margin: 12px 0 0;
        font-size: 56px;
        line-height: 1.08;
      }
      .hook {
        margin: 20px 0 0;
        font-size: 34px;
        line-height: 1.24;
      }
      .caption {
        margin: 20px 0 0;
        font-size: 26px;
        line-height: 1.35;
      }
      h2 {
        margin: 0;
        font-size: 32px;
      }
      ul {
        margin: 22px 0 0;
        padding-left: 24px;
        display: grid;
        gap: 14px;
        font-size: 28px;
        line-height: 1.3;
      }
      .time {
        margin: 30px 0 0;
        font-size: 22px;
        color: ${payload.brand.primary};
        font-weight: 600;
      }
    </style>
  </head>
  <body>
    ${templateMarkup}
  </body>
</html>`;
}

export function resolveStudioLanguage(args: {
  requestedLanguage?: unknown;
  suggestionLanguage?: unknown;
  businessLanguage?: unknown;
}): StudioLanguage {
  const candidates = [args.requestedLanguage, args.suggestionLanguage, args.businessLanguage];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && LANGUAGE_SET.has(candidate as StudioLanguage)) {
      return candidate as StudioLanguage;
    }
  }
  return 'ca';
}

export function getStudioDimensions(format: StudioFormat): { width: number; height: number } {
  return format === 'story'
    ? { width: 1080, height: 1920 }
    : { width: 1080, height: 1350 };
}

export function resolveTemplateId(value: unknown): StudioTemplateId {
  if (typeof value === 'string' && TEMPLATE_SET.has(value as StudioTemplateId)) {
    return value as StudioTemplateId;
  }
  return 'quote-clean';
}

export function extractDifferentiators(themesValue: JsonValue | null): string[] {
  if (!themesValue || typeof themesValue !== 'object' || Array.isArray(themesValue)) return [];
  const differentiators = (themesValue as { differentiators?: JsonValue }).differentiators;
  return asStringArray(differentiators || [], 6);
}

export function buildStudioRenderPayload(args: {
  suggestion: SuggestionInput;
  business: Pick<Business, 'name' | 'default_language'>;
  language: StudioLanguage;
  format: StudioFormat;
  templateId: StudioTemplateId;
  brand?: StudioBrandOverride;
}): StudioRenderPayload {
  const fallback = getLocalizedFallback(args.language);

  const title = clip(asText(args.suggestion.title) || asText(args.suggestion.hook) || fallback.title, 120);
  const hook = clip(asText(args.suggestion.hook) || asText(args.suggestion.caption) || fallback.title, 180);
  const caption = clip(asText(args.suggestion.caption) || hook || fallback.title, 280);
  const quotes = extractEvidenceQuotes(args.suggestion.evidence);
  const quote = quotes[0] || hook || fallback.quote;
  const cta = clip(asText(args.suggestion.cta) || fallback.cta, 80);

  const bullets = asStringArray(args.suggestion.shot_list, 3);
  if (bullets.length === 0) {
    bullets.push(hook, caption, cta);
  }

  const hashtags = (args.suggestion.hashtags || [])
    .map((item) => asText(item))
    .filter((item) => item.length > 0)
    .map((item) => (item.startsWith('#') ? item : `#${item}`));

  const brand: StudioBrand = {
    primary: normalizeHexColor(args.brand?.primary, DEFAULT_BRAND.primary),
    secondary: normalizeHexColor(args.brand?.secondary, DEFAULT_BRAND.secondary),
    text: normalizeHexColor(args.brand?.text, DEFAULT_BRAND.text),
    logo_url: asText(args.brand?.logo_url) || null,
  };

  return {
    business_name: clip(asText(args.business.name) || 'OpinIA', 80),
    language: args.language,
    format: args.format,
    template_id: args.templateId,
    title,
    hook,
    caption,
    quote,
    cta,
    best_time: asText(args.suggestion.best_time),
    bullets: bullets.map((item) => clip(item, 90)),
    hashtags: toUniqueLines(hashtags, 6),
    brand,
  };
}

export function payloadToJson(payload: StudioRenderPayload): JsonObject {
  return payload as unknown as JsonObject;
}

export function buildStoragePaths({
  businessId,
  assetId,
  format,
  templateId,
  now = new Date(),
}: BuildStoragePathsArgs): { storageBucket: string; storagePath: string; objectPath: string } {
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const fileName = `${assetId}_${format}_${templateId}.png`;
  const objectPath = `${businessId}/${year}/${month}/${fileName}`;
  const storagePath = `${CONTENT_ASSETS_BUCKET}/${objectPath}`;

  return {
    storageBucket: CONTENT_ASSETS_BUCKET,
    storagePath,
    objectPath,
  };
}

export function storagePathToObjectPath(storagePath: string, bucket: string = CONTENT_ASSETS_BUCKET): string {
  const prefix = `${bucket}/`;
  if (storagePath.startsWith(prefix)) {
    return storagePath.slice(prefix.length);
  }
  return storagePath;
}

export function buildStudioRenderPayloadFromStored({
  storedPayload,
  businessName,
  language,
  format,
  templateId,
  brand,
}: BuildPayloadFromStoredArgs): StudioRenderPayload {
  const fallback = getLocalizedFallback(language);
  const raw = storedPayload && typeof storedPayload === 'object' && !Array.isArray(storedPayload)
    ? storedPayload as Record<string, unknown>
    : {};

  const bullets = Array.isArray(raw.bullets)
    ? raw.bullets.map((item) => asText(item)).filter(Boolean).slice(0, 3)
    : [];

  const hashtags = Array.isArray(raw.hashtags)
    ? raw.hashtags.map((item) => asText(item)).filter(Boolean).slice(0, 6)
    : [];

  const rawBrand = raw.brand && typeof raw.brand === 'object'
    ? raw.brand as Record<string, unknown>
    : {};

  const resolvedBrand = {
    primary: normalizeHexColor(brand?.primary ?? rawBrand.primary, DEFAULT_BRAND.primary),
    secondary: normalizeHexColor(brand?.secondary ?? rawBrand.secondary, DEFAULT_BRAND.secondary),
    text: normalizeHexColor(brand?.text ?? rawBrand.text, DEFAULT_BRAND.text),
    logo_url: asText(brand?.logo_url) || asText(rawBrand.logo_url) || null,
  };

  return {
    business_name: clip(asText(businessName) || asText(raw.business_name) || 'OpinIA', 80),
    language,
    format,
    template_id: templateId,
    title: clip(asText(raw.title) || fallback.title, 120),
    hook: clip(asText(raw.hook) || asText(raw.caption) || fallback.title, 180),
    caption: clip(asText(raw.caption) || asText(raw.hook) || fallback.title, 280),
    quote: clip(asText(raw.quote) || asText(raw.hook) || fallback.quote, 220),
    cta: clip(asText(raw.cta) || fallback.cta, 80),
    best_time: asText(raw.best_time),
    bullets: bullets.length > 0 ? bullets.map((item) => clip(item, 90)) : [fallback.title],
    hashtags: hashtags.length > 0 ? hashtags : [],
    brand: resolvedBrand,
  };
}

export async function renderStudioPng(payload: StudioRenderPayload): Promise<RenderStudioPngResult> {
  const { width, height } = getStudioDimensions(payload.format);
  const html = buildTemplateHtml(payload);

  try {
    const playwright = await import('playwright');
    const browser = await playwright.chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const page = await browser.newPage({
        viewport: { width, height },
        deviceScaleFactor: 1,
      });

      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      const png = await page.screenshot({ type: 'png' });
      await page.close();

      const pngBuffer = Buffer.from(png);
      return {
        pngBuffer,
        pngBase64: pngBuffer.toString('base64'),
        width,
        height,
        usedFallback: false,
      };
    } finally {
      await browser.close();
    }
  } catch {
    const fallbackBuffer = Buffer.from(FALLBACK_PNG_BASE64, 'base64');
    return {
      pngBuffer: fallbackBuffer,
      pngBase64: FALLBACK_PNG_BASE64,
      width,
      height,
      usedFallback: true,
    };
  }
}

export function generateStudioTextVariants({
  platform,
  language,
  tone,
  suggestion,
  differentiators = [],
}: GenerateTextVariantsParams): string[] {
  const fallback = getLocalizedFallback(language);
  const hook = asText(suggestion.hook) || asText(suggestion.title) || fallback.title;
  const caption = asText(suggestion.caption) || hook;
  const cta = asText(suggestion.cta) || fallback.cta;
  const quote = extractEvidenceQuotes(suggestion.evidence)[0] || caption;
  const tags = (suggestion.hashtags || [])
    .map((item) => asText(item))
    .filter((item) => item.length > 0)
    .slice(0, 2)
    .map((item) => (item.startsWith('#') ? item : `#${item}`))
    .join(' ')
    .trim();
  const differentiator = clip(asText(differentiators[0] || ''), 80);

  const directBase = `${fallback.directPrefix}: ${hook}. ${cta}${tags ? ` ${tags}` : ''}`;
  const storyBase = `${fallback.storyPrefix}: "${quote}" ${caption}. ${cta}`;
  const hotTakeBody = differentiator || hook;
  const hotTakeBase = `${fallback.hotTakePrefix}: ${hotTakeBody}. ${cta}${tags ? ` ${tags}` : ''}`;

  const limit = platformLimit(platform);
  const candidates = [directBase, storyBase, hotTakeBase]
    .map((item) => applyTone(item, tone))
    .map((item) => clampVariant(item, limit));

  const unique: string[] = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (unique.some((current) => current.toLowerCase() === candidate.toLowerCase())) continue;
    unique.push(candidate);
  }

  while (unique.length < 3) {
    const fallbackVariant = clampVariant(
      applyTone(`${hook}. ${caption}. ${cta}`, tone),
      limit,
    );
    unique.push(fallbackVariant);
  }

  return unique.slice(0, 3);
}
