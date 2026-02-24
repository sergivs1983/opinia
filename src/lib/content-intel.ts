export type ContentIntelLanguage = 'ca' | 'es' | 'en';
export type ContentSuggestionType = 'reel' | 'story' | 'post';

export interface ReviewForContentIntel {
  id: string;
  source: string;
  review_text: string;
  rating: number;
  review_date: string | null;
  created_at: string;
}

export interface ContentTheme {
  theme: string;
  mentions: number;
  keywords: string[];
}

export interface DerivedBusinessProfile {
  business_type_guess: 'restaurant' | 'hotel' | 'clinic' | 'retail' | 'services' | 'other';
  audience_guess: 'couples' | 'families' | 'tourists' | 'locals' | 'business' | 'mixed';
  peak_times_guess: string[];
  content_angles: string[];
}

export interface ContentInsightPayload {
  top_themes: ContentTheme[];
  differentiators: string[];
  complaints: string[];
  audience_signals: string[];
  derived_business_profile: DerivedBusinessProfile;
}

export interface ContentSuggestionEvidence {
  review_id: string;
  quote: string;
}

export interface ContentSuggestionDraft {
  type: ContentSuggestionType;
  title: string;
  hook: string;
  shot_list: string[];
  caption: string;
  cta: string;
  best_time: string;
  hashtags: string[];
  evidence: ContentSuggestionEvidence[];
}

interface NormalizeSuggestionsOptions {
  language: ContentIntelLanguage;
  reviews: ReviewForContentIntel[];
  differentiators: string[];
  peakTimesGuess: string[];
}

interface FallbackSuggestionOptions extends NormalizeSuggestionsOptions {
  contentAngles: string[];
}

const LANGUAGE_SET = new Set<ContentIntelLanguage>(['ca', 'es', 'en']);
const TYPE_SET = new Set<ContentSuggestionType>(['reel', 'story', 'post']);

const STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'with', 'this', 'from', 'very', 'your', 'you', 'are',
  'els', 'les', 'amb', 'per', 'del', 'que', 'una', 'molt', 'hem', 'han', 'com',
  'los', 'las', 'con', 'por', 'una', 'muy', 'han', 'hemos', 'para', 'pero',
]);

function isLanguage(value: unknown): value is ContentIntelLanguage {
  return typeof value === 'string' && LANGUAGE_SET.has(value as ContentIntelLanguage);
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const item of value) {
    const text = normalizeText(item);
    if (text) result.push(text);
  }
  return result;
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

function uniqueList(values: string[], max: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= max) break;
  }
  return result;
}

function extractQuote(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const firstSentence = clean.split(/[.!?]\s/)[0]?.trim() || clean;
  return clip(firstSentence, 180);
}

function guessAudience(reviews: ReviewForContentIntel[]): DerivedBusinessProfile['audience_guess'] {
  const corpus = reviews.map((r) => r.review_text.toLowerCase()).join(' ');
  if (/family|familia|nens|niños/.test(corpus)) return 'families';
  if (/parella|couple|romantic/.test(corpus)) return 'couples';
  if (/tourist|turista|visitant/.test(corpus)) return 'tourists';
  if (/local|ve[iï]n|barrio|barri/.test(corpus)) return 'locals';
  if (/business|negoci|empresa/.test(corpus)) return 'business';
  return 'mixed';
}

function mapBusinessType(businessType?: string | null): DerivedBusinessProfile['business_type_guess'] {
  const value = (businessType || '').toLowerCase();
  if (value === 'restaurant' || value === 'bar' || value === 'cafe') return 'restaurant';
  if (value === 'hotel' || value === 'apartment') return 'hotel';
  if (value === 'shop') return 'retail';
  if (value === 'other') return 'other';
  return 'services';
}

function inferPeakTimesFromReviews(reviews: ReviewForContentIntel[]): string[] {
  const hours = reviews
    .map((review) => review.review_date || review.created_at)
    .map((date) => new Date(date))
    .filter((date) => !Number.isNaN(date.getTime()))
    .map((date) => date.getUTCHours());

  if (hours.length === 0) return ['evening'];

  const bins: Record<string, number> = { midday: 0, afternoon: 0, evening: 0 };
  for (const hour of hours) {
    if (hour >= 11 && hour < 15) bins.midday += 1;
    else if (hour >= 15 && hour < 18) bins.afternoon += 1;
    else bins.evening += 1;
  }

  const ordered = Object.entries(bins)
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => key)
    .filter((key) => bins[key] > 0);

  return ordered.length > 0 ? ordered.slice(0, 3) : ['evening'];
}

function getThemeSeed(language: ContentIntelLanguage) {
  return {
    ca: {
      genericTheme: 'Experiència del client',
      defaultAngles: ['behind the scenes', 'experience', 'before/after'],
    },
    es: {
      genericTheme: 'Experiencia del cliente',
      defaultAngles: ['behind the scenes', 'experience', 'before/after'],
    },
    en: {
      genericTheme: 'Customer experience',
      defaultAngles: ['behind the scenes', 'experience', 'before/after'],
    },
  }[language];
}

function tokenizeReviews(reviews: ReviewForContentIntel[]): string[] {
  return reviews
    .flatMap((review) => review.review_text.toLowerCase().split(/[^\p{L}\p{N}]+/u))
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !STOPWORDS.has(token));
}

function buildTopThemes(reviews: ReviewForContentIntel[], language: ContentIntelLanguage): ContentTheme[] {
  const tokens = tokenizeReviews(reviews);
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) || 0) + 1);
  }

  const topKeywords = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([keyword, mentions]) => ({ keyword, mentions }));

  if (topKeywords.length === 0) {
    const seed = getThemeSeed(language);
    return [{ theme: seed.genericTheme, mentions: reviews.length || 1, keywords: [] }];
  }

  return topKeywords.map((entry) => ({
    theme: entry.keyword,
    mentions: entry.mentions,
    keywords: [entry.keyword],
  }));
}

export function parseJsonResponse<T>(raw: string): T | null {
  const clean = raw.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  if (!clean) return null;
  try {
    return JSON.parse(clean) as T;
  } catch {
    return null;
  }
}

export function getWeekRange(weekStart: string): { from: string; to: string } {
  const start = new Date(`${weekStart}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  return {
    from: start.toISOString(),
    to: end.toISOString(),
  };
}

export function resolveContentIntelLanguage(args: {
  requestedLanguage?: unknown;
  business?: {
    default_language?: unknown;
    locale?: unknown;
    language?: unknown;
  } | null;
  orgLocale?: unknown;
}): ContentIntelLanguage {
  const candidates: unknown[] = [
    args.requestedLanguage,
    args.business?.language,
    args.business?.locale,
    args.business?.default_language,
    args.orgLocale,
  ];

  for (const candidate of candidates) {
    if (isLanguage(candidate)) return candidate;
  }
  return 'ca';
}

export function fallbackBestTime(
  language: ContentIntelLanguage,
  peakTimesGuess: string[],
  bestTime?: string,
): string {
  const explicit = normalizeText(bestTime);
  if (explicit) return explicit;

  const joined = peakTimesGuess.join(' ').toLowerCase();
  const mappings = {
    ca: { midday: 'Dt 13:00', evening: 'Dj 19:30', default: 'Dj 19:30' },
    es: { midday: 'Mar 13:00', evening: 'Jue 19:30', default: 'Jue 19:30' },
    en: { midday: 'Tue 1:00 PM', evening: 'Thu 7:30 PM', default: 'Thu 7:30 PM' },
  }[language];

  if (joined.includes('midday')) return mappings.midday;
  if (joined.includes('evening') || joined.includes('afternoon')) return mappings.evening;
  return mappings.default;
}

export function normalizeInsightPayload(args: {
  raw: unknown;
  language: ContentIntelLanguage;
  reviews: ReviewForContentIntel[];
  businessType?: string | null;
}): ContentInsightPayload {
  const base = buildFallbackInsight({
    language: args.language,
    reviews: args.reviews,
    businessType: args.businessType,
  });

  if (!args.raw || typeof args.raw !== 'object') return base;
  const raw = args.raw as Record<string, unknown>;

  const rawThemes = Array.isArray(raw.top_themes) ? raw.top_themes : [];
  const topThemes: ContentTheme[] = rawThemes
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const rec = item as Record<string, unknown>;
      const theme = normalizeText(rec.theme || rec.name);
      const mentionsRaw = rec.mentions;
      const mentions = typeof mentionsRaw === 'number' && Number.isFinite(mentionsRaw)
        ? Math.max(1, Math.round(mentionsRaw))
        : 1;
      const keywords = uniqueList(asStringArray(rec.keywords), 6);
      if (!theme) return null;
      return { theme: clip(theme, 80), mentions, keywords };
    })
    .filter((item): item is ContentTheme => item !== null)
    .slice(0, 8);

  const differentiators = uniqueList(asStringArray(raw.differentiators), 6);
  const complaints = uniqueList(asStringArray(raw.complaints), 6);
  const audienceSignals = uniqueList(asStringArray(raw.audience_signals), 6);

  const rawProfile = raw.derived_business_profile;
  const normalizedProfile = normalizeDerivedProfile({
    raw: rawProfile,
    base: base.derived_business_profile,
  });

  return {
    top_themes: topThemes.length > 0 ? topThemes : base.top_themes,
    differentiators: differentiators.length > 0 ? differentiators : base.differentiators,
    complaints: complaints.length > 0 ? complaints : base.complaints,
    audience_signals: audienceSignals.length > 0 ? audienceSignals : base.audience_signals,
    derived_business_profile: normalizedProfile,
  };
}

function normalizeDerivedProfile(args: {
  raw: unknown;
  base: DerivedBusinessProfile;
}): DerivedBusinessProfile {
  if (!args.raw || typeof args.raw !== 'object') return args.base;
  const raw = args.raw as Record<string, unknown>;

  const businessType = normalizeText(raw.business_type_guess) as DerivedBusinessProfile['business_type_guess'];
  const audience = normalizeText(raw.audience_guess) as DerivedBusinessProfile['audience_guess'];

  return {
    business_type_guess: businessType && ['restaurant', 'hotel', 'clinic', 'retail', 'services', 'other'].includes(businessType)
      ? businessType
      : args.base.business_type_guess,
    audience_guess: audience && ['couples', 'families', 'tourists', 'locals', 'business', 'mixed'].includes(audience)
      ? audience
      : args.base.audience_guess,
    peak_times_guess: uniqueList(asStringArray(raw.peak_times_guess), 3).length > 0
      ? uniqueList(asStringArray(raw.peak_times_guess), 3)
      : args.base.peak_times_guess,
    content_angles: uniqueList(asStringArray(raw.content_angles), 3).length > 0
      ? uniqueList(asStringArray(raw.content_angles), 3)
      : args.base.content_angles,
  };
}

export function buildFallbackInsight(args: {
  language: ContentIntelLanguage;
  reviews: ReviewForContentIntel[];
  businessType?: string | null;
}): ContentInsightPayload {
  const topThemes = buildTopThemes(args.reviews, args.language).slice(0, 8);

  const differentiators = uniqueList(
    topThemes.map((theme) => theme.theme).filter(Boolean),
    4,
  );

  const complaints = uniqueList(
    args.reviews
      .filter((review) => review.rating <= 3)
      .map((review) => extractQuote(review.review_text))
      .filter(Boolean),
    4,
  );

  const profile: DerivedBusinessProfile = {
    business_type_guess: mapBusinessType(args.businessType),
    audience_guess: guessAudience(args.reviews),
    peak_times_guess: inferPeakTimesFromReviews(args.reviews),
    content_angles: getThemeSeed(args.language).defaultAngles,
  };

  return {
    top_themes: topThemes,
    differentiators: differentiators.length > 0 ? differentiators : [getThemeSeed(args.language).genericTheme],
    complaints,
    audience_signals: [profile.audience_guess],
    derived_business_profile: profile,
  };
}

function normalizeEvidence(
  raw: unknown,
  reviews: ReviewForContentIntel[],
): ContentSuggestionEvidence[] {
  const reviewMap = new Map(reviews.map((review) => [review.id, review]));
  const result: ContentSuggestionEvidence[] = [];
  const seen = new Set<string>();

  const items = Array.isArray(raw) ? raw : [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const reviewId = normalizeText(rec.review_id);
    const quote = normalizeText(rec.quote);
    if (!reviewId || !quote) continue;

    const review = reviewMap.get(reviewId);
    if (!review) continue;

    const reviewTextLower = review.review_text.toLowerCase();
    if (!reviewTextLower.includes(quote.toLowerCase())) continue;

    const key = `${reviewId}:${quote.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ review_id: reviewId, quote: clip(quote, 220) });
  }

  if (result.length > 0) return result.slice(0, 3);

  const fallback = reviews[0];
  if (!fallback) return [];
  return [{ review_id: fallback.id, quote: extractQuote(fallback.review_text) }];
}

function normalizeType(value: unknown, fallback: ContentSuggestionType): ContentSuggestionType {
  const text = normalizeText(value);
  return TYPE_SET.has(text as ContentSuggestionType) ? (text as ContentSuggestionType) : fallback;
}

function normalizeHashtags(raw: unknown, differentiators: string[], language: ContentIntelLanguage): string[] {
  const cleaned = uniqueList(
    asStringArray(raw)
      .map((tag) => tag.replace(/^#+/, '').trim())
      .map((tag) => tag.replace(/\s+/g, ''))
      .filter(Boolean)
      .map((tag) => `#${tag}`),
    8,
  );

  if (cleaned.length > 0) return cleaned;

  const baseTag = {
    ca: ['#ressenyes', '#negocilocal'],
    es: ['#reseñas', '#negociolocal'],
    en: ['#reviews', '#localbusiness'],
  }[language];

  const fromDiff = differentiators
    .map((value) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''))
    .filter((value) => value.length >= 3)
    .slice(0, 3)
    .map((value) => `#${value}`);

  return uniqueList([...fromDiff, ...baseTag], 8);
}

export function normalizeSuggestions(args: {
  raw: unknown;
  options: NormalizeSuggestionsOptions;
  contentAngles: string[];
}): ContentSuggestionDraft[] {
  const fallback = buildFallbackSuggestions({
    ...args.options,
    contentAngles: args.contentAngles,
  });

  if (!Array.isArray(args.raw)) return fallback;

  const rawSuggestions = args.raw as Array<Record<string, unknown>>;
  const normalized: ContentSuggestionDraft[] = [];

  for (let i = 0; i < rawSuggestions.length && normalized.length < 3; i += 1) {
    const item = rawSuggestions[i];
    if (!item || typeof item !== 'object') continue;

    const fallbackItem = fallback[normalized.length];
    const evidence = normalizeEvidence(item.evidence, args.options.reviews);

    normalized.push({
      type: normalizeType(item.type, fallbackItem.type),
      title: clip(normalizeText(item.title) || fallbackItem.title, 120),
      hook: clip(normalizeText(item.hook_0_3s || item.hook) || fallbackItem.hook, 180),
      shot_list: uniqueList(asStringArray(item.shot_list), 8).length > 0
        ? uniqueList(asStringArray(item.shot_list), 8)
        : fallbackItem.shot_list,
      caption: clip(normalizeText(item.caption) || fallbackItem.caption, 700),
      cta: clip(normalizeText(item.cta) || fallbackItem.cta, 180),
      best_time: fallbackBestTime(args.options.language, args.options.peakTimesGuess, normalizeText(item.best_time)),
      hashtags: normalizeHashtags(item.hashtags, args.options.differentiators, args.options.language),
      evidence: evidence.length > 0 ? evidence : fallbackItem.evidence,
    });
  }

  while (normalized.length < 3) {
    normalized.push(fallback[normalized.length]);
  }

  return normalized.slice(0, 3);
}

export function buildFallbackSuggestions(options: FallbackSuggestionOptions): ContentSuggestionDraft[] {
  const angleA = options.contentAngles[0] || options.differentiators[0] || 'experience';
  const angleB = options.contentAngles[1] || options.differentiators[1] || 'team';
  const angleC = options.contentAngles[2] || options.differentiators[2] || 'details';

  const evidence = normalizeEvidence([], options.reviews);

  const content = {
    ca: {
      reel: {
        title: `Reel: ${angleA}`,
        hook: `En 3 segons: per què destaca el teu negoci en ${angleA}.`,
        caption: `Mostra en vídeo el punt fort de la setmana (${angleA}).\nAfegeix una prova real de client i tanca amb invitació clara.`,
        cta: 'Reserva o vine aquesta setmana.',
        shots: [
          `${angleA} en primer pla`,
          'Moment real d’atenció o servei',
          'Tancament amb crida a l’acció',
        ],
      },
      story: {
        title: `Story: ${angleB}`,
        hook: `Què passa darrere de ${angleB}?`,
        caption: `Story en 3 pantalles: context, detall i resultat.\nInclou una cita real d’una ressenya per reforçar credibilitat.`,
        cta: 'Respon aquesta story i t’ajudem a triar.',
        shots: [
          `Obrir amb ${angleB}`,
          'Micro prova social (quote)',
          'Pregunta final per generar resposta',
        ],
      },
      post: {
        title: `Post: ${angleC}`,
        hook: `La diferència està en ${angleC}.`,
        caption: `Post carrusel: abans/després o pas a pas de ${angleC}.\nConnecta-ho amb una experiència de client real.`,
        cta: 'Guarda aquest post per a la teva propera visita.',
        shots: [
          `Context de ${angleC}`,
          'Detall operatiu que marca la diferència',
          'Resultat final percebut pel client',
        ],
      },
    },
    es: {
      reel: {
        title: `Reel: ${angleA}`,
        hook: `En 3 segundos: por qué tu negocio destaca en ${angleA}.`,
        caption: `Muestra en vídeo el punto fuerte de la semana (${angleA}).\nAñade una prueba real de cliente y cierra con una invitación clara.`,
        cta: 'Reserva o ven esta semana.',
        shots: [
          `${angleA} en primer plano`,
          'Momento real de atención o servicio',
          'Cierre con llamada a la acción',
        ],
      },
      story: {
        title: `Story: ${angleB}`,
        hook: `¿Qué hay detrás de ${angleB}?`,
        caption: `Story en 3 pantallas: contexto, detalle y resultado.\nIncluye una cita real de reseña para reforzar credibilidad.`,
        cta: 'Responde esta story y te ayudamos a elegir.',
        shots: [
          `Abrir con ${angleB}`,
          'Micro prueba social (quote)',
          'Pregunta final para generar respuesta',
        ],
      },
      post: {
        title: `Post: ${angleC}`,
        hook: `La diferencia está en ${angleC}.`,
        caption: `Post carrusel: antes/después o paso a paso de ${angleC}.\nConéctalo con una experiencia real de cliente.`,
        cta: 'Guarda este post para tu próxima visita.',
        shots: [
          `Contexto de ${angleC}`,
          'Detalle operativo que marca la diferencia',
          'Resultado final percibido por el cliente',
        ],
      },
    },
    en: {
      reel: {
        title: `Reel: ${angleA}`,
        hook: `In 3 seconds: why your business stands out in ${angleA}.`,
        caption: `Show this week’s strongest differentiator (${angleA}) in a short reel.\nAnchor it with one real review quote and finish with a clear invite.`,
        cta: 'Book or drop by this week.',
        shots: [
          `${angleA} in a hero close-up`,
          'Real service interaction',
          'Ending with a clear call to action',
        ],
      },
      story: {
        title: `Story: ${angleB}`,
        hook: `What happens behind ${angleB}?`,
        caption: `3-frame story: context, detail, result.\nInclude one real customer quote to make it credible.`,
        cta: 'Reply to this story and we’ll help you choose.',
        shots: [
          `Open with ${angleB}`,
          'Micro social proof (quote)',
          'Final question to drive replies',
        ],
      },
      post: {
        title: `Post: ${angleC}`,
        hook: `The difference is in ${angleC}.`,
        caption: `Carousel post: before/after or step-by-step around ${angleC}.\nTie it back to a real customer experience.`,
        cta: 'Save this post for your next visit.',
        shots: [
          `Context around ${angleC}`,
          'Operational detail that matters',
          'Final outcome seen by guests',
        ],
      },
    },
  }[options.language];

  const times = options.peakTimesGuess;

  return [
    {
      type: 'reel',
      title: content.reel.title,
      hook: content.reel.hook,
      shot_list: content.reel.shots,
      caption: content.reel.caption,
      cta: content.reel.cta,
      best_time: fallbackBestTime(options.language, times),
      hashtags: normalizeHashtags([], options.differentiators, options.language),
      evidence,
    },
    {
      type: 'story',
      title: content.story.title,
      hook: content.story.hook,
      shot_list: content.story.shots,
      caption: content.story.caption,
      cta: content.story.cta,
      best_time: fallbackBestTime(options.language, times),
      hashtags: normalizeHashtags([], options.differentiators, options.language),
      evidence,
    },
    {
      type: 'post',
      title: content.post.title,
      hook: content.post.hook,
      shot_list: content.post.shots,
      caption: content.post.caption,
      cta: content.post.cta,
      best_time: fallbackBestTime(options.language, times),
      hashtags: normalizeHashtags([], options.differentiators, options.language),
      evidence,
    },
  ];
}
