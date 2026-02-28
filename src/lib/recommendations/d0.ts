import type { SupabaseClient } from '@supabase/supabase-js';

export type RecommendationStatus = 'shown' | 'accepted' | 'dismissed' | 'published';
export type RecommendationVertical = 'general' | 'restaurant' | 'hotel';
export type LanguageConfidence = 'high' | 'medium' | 'low';

export type RecommendationHowTo = {
  why: string;
  steps: string[];
  checklist: string[];
  assets_needed: string[];
  time_estimate_min: number;
  example_caption?: string;
};

export type RecommendationSignalMeta = {
  keyword?: string;
  keyword_mentions?: number;
  avg_rating?: number;
  neg_reviews?: number;
  dominant_lang?: string;
  confidence?: LanguageConfidence;
};

export type RecommendationLanguageMeta = {
  base_lang: string;
  suggested_lang: string;
  confidence: LanguageConfidence;
};

export type RecommendationTemplate = {
  format: string;
  hook: string;
  idea: string;
  cta: string;
  assets_needed: string[];
  how_to: RecommendationHowTo;
  signal: RecommendationSignalMeta;
  language: RecommendationLanguageMeta;
};

export type WeeklyRecommendationItem = {
  id: string;
  rule_id: string;
  status: RecommendationStatus;
  source: 'evergreen' | 'signal';
  generated_at: string;
  week_start: string;
  priority: number;
  vertical: RecommendationVertical;
  recommendation_template: RecommendationTemplate;
  format: string;
  hook: string;
  idea: string;
  cta: string;
  how_to: RecommendationHowTo;
  signal_meta: RecommendationSignalMeta;
  language: RecommendationLanguageMeta;
};

type RecommendationLogRow = {
  id: string;
  rule_id: string;
  status: RecommendationStatus;
  source?: 'evergreen' | 'signal' | null;
  signal?: unknown;
  format?: string | null;
  steps?: unknown;
  assets_needed?: string[] | null;
  copy_short?: string | null;
  copy_long?: string | null;
  hashtags?: string[] | null;
  generated_copy: unknown;
  generated_at: string;
  week_start: string;
};

type SocialPlaybookRow = {
  id: string;
  vertical: RecommendationVertical;
  name: string;
};

type PlaybookRuleRow = {
  id: string;
  playbook_id: string;
  priority: number;
  cooldown_days: number;
  recommendation_template: unknown;
  created_at: string;
  trigger_type: string;
  trigger_config: unknown;
};

type InsightsDailyRow = {
  topic: string | null;
  praise_count: number | null;
  complaint_count: number | null;
  total_count: number | null;
  avg_rating: number | null;
};

type BizInsightsDailyRow = {
  day: string;
  metrics: unknown;
  categories_summary: unknown;
  keywords_top: string[] | null;
  lang_dist: unknown;
  dominant_lang: string | null;
};

type ReviewLanguageRow = {
  language_detected: string | null;
};

type SignalContext = {
  keyword: string | null;
  keywordMentions: number | null;
  avgRating: number | null;
  negReviews: number;
  dominantLang: string | null;
  baseLang: string;
  suggestedLang: string;
  confidence: LanguageConfidence;
  negTrigger: boolean;
};

type D1RuleCode = 'OFFENSIVE_KEYWORD' | 'DEFENSIVE_NEG' | 'HUMAN_EVERGREEN';

type D1RuleSeed = {
  code: D1RuleCode;
  priority: number;
  trigger_type: 'offensive_keyword' | 'defensive_neg' | 'evergreen';
  cooldown_days: number;
  recommendation_template: Omit<RecommendationTemplate, 'signal' | 'language'>;
};

export const VISIBLE_STATUSES: RecommendationStatus[] = ['shown', 'accepted', 'published'];
const TARGET_WEEKLY_RECOMMENDATIONS = 3;
const SIGNAL_RANGE_DAYS = 7;

const D1_PLAYBOOK_NAMES: Record<RecommendationVertical, string> = {
  general: 'General SMB',
  restaurant: 'Restaurant',
  hotel: 'Hotel',
};

const D1_RULE_SEEDS: Record<RecommendationVertical, D1RuleSeed[]> = {
  general: [
    {
      code: 'OFFENSIVE_KEYWORD',
      priority: 8,
      trigger_type: 'offensive_keyword',
      cooldown_days: 7,
      recommendation_template: {
        format: 'post',
        hook: 'El que més destaqueu: {{keyword}}',
        idea: 'Fes una publicació curta reforçant com treballeu {{keyword}} amb un exemple real del dia a dia.',
        cta: 'Acaba demanant que deixin la seva experiència a Google.',
        assets_needed: ['1 foto real del local o servei', 'Logotip opcional'],
        how_to: {
          why: 'Aprofita el que els clients ja valoren per convertir-ho en confiança pública.',
          steps: [
            'Tria una foto real d’aquestes últimes 48h.',
            'Escriu una frase clara sobre {{keyword}}.',
            'Afegeix un detall concret (temps, equip, procés o resultat).',
            'Tanca amb CTA per ressenyes.',
          ],
          checklist: ['Imatge nítida', 'Missatge en 2-3 línies', 'CTA final'],
          assets_needed: ['Foto vertical o quadrada', 'Plantilla simple de marca'],
          time_estimate_min: 12,
          example_caption: 'Avui hem tornat a posar el focus en {{keyword}} perquè cada client surti tranquil.',
        },
      },
    },
    {
      code: 'DEFENSIVE_NEG',
      priority: 9,
      trigger_type: 'defensive_neg',
      cooldown_days: 5,
      recommendation_template: {
        format: 'story',
        hook: 'Com millorem cada setmana',
        idea: 'Explica una millora concreta aplicada aquesta setmana per elevar l’experiència del client.',
        cta: 'Convida a provar-ho i compartir feedback.',
        assets_needed: ['Story amb text curt', 'Foto de l’equip o procés'],
        how_to: {
          why: 'Quan hi ha senyals negatives, la transparència redueix fricció i reforça credibilitat.',
          steps: [
            'Defineix una acció de millora real que ja estigui aplicada.',
            'Comunica-la amb to proper i sense excuses.',
            'Inclou un missatge de disponibilitat per escoltar feedback.',
          ],
          checklist: ['Millora verificable', 'To responsable', 'Sense culpabilitzar el client'],
          assets_needed: ['1 story amb fons neutre', 'Text gran i llegible'],
          time_estimate_min: 10,
          example_caption: 'Aquesta setmana hem ajustat el procés d’atenció per reduir esperes.',
        },
      },
    },
    {
      code: 'HUMAN_EVERGREEN',
      priority: 10,
      trigger_type: 'evergreen',
      cooldown_days: 7,
      recommendation_template: {
        format: 'reel',
        hook: 'Qui hi ha darrere del servei',
        idea: 'Mostra 2-3 moments del teu equip preparant el servei abans d’obrir.',
        cta: 'Pregunta quin contingut voldrien veure la setmana vinent.',
        assets_needed: ['2-3 clips curts verticals', 'Música suau'],
        how_to: {
          why: 'Humanitzar la marca incrementa record i confiança sense dependre de promocions.',
          steps: [
            'Grava clips curts de preparació o coordinació d’equip.',
            'Ordena’ls de forma simple: inici, acció, resultat.',
            'Afegeix un text curt amb el missatge principal.',
          ],
          checklist: ['Clips curts (<4s)', 'Llum correcta', 'Missatge final clar'],
          assets_needed: ['Mòbil en vertical', 'Espai ordenat'],
          time_estimate_min: 15,
          example_caption: 'Així preparem cada servei perquè tot surti rodó.',
        },
      },
    },
  ],
  restaurant: [
    {
      code: 'OFFENSIVE_KEYWORD',
      priority: 8,
      trigger_type: 'offensive_keyword',
      cooldown_days: 7,
      recommendation_template: {
        format: 'post',
        hook: 'El que més destaqueu del restaurant: {{keyword}}',
        idea: 'Ensenya en una foto el detall relacionat amb {{keyword}} i explica per què el cuideu.',
        cta: 'Convida a reservar i a deixar ressenya.',
        assets_needed: ['Foto de plat/sala', 'Text curt sobre procés'],
        how_to: {
          why: 'Reforça els motius pels quals la gent us tria i ho comparteix públicament.',
          steps: [
            'Escull un visual del detall més comentat.',
            'Descriu en una línia com el treballeu.',
            'Afegeix una crida suau a la reserva o opinió.',
          ],
          checklist: ['Imatge de qualitat', 'Missatge concret', 'CTA amable'],
          assets_needed: ['Foto principal', 'Copys curts'],
          time_estimate_min: 12,
          example_caption: 'Quan parleu de {{keyword}}, ens motiveu a seguir millorant cada servei.',
        },
      },
    },
    {
      code: 'DEFENSIVE_NEG',
      priority: 9,
      trigger_type: 'defensive_neg',
      cooldown_days: 5,
      recommendation_template: {
        format: 'story',
        hook: 'Millora activa aquesta setmana',
        idea: 'Comparteix una millora aplicada al servei o temps d’espera.',
        cta: 'Demana feedback dels clients habituals.',
        assets_needed: ['Story text + foto cuina/sala'],
        how_to: {
          why: 'Visualitzar millores redueix percepció de risc en nous clients.',
          steps: [
            'Defineix una millora concreta (temps, comanda, atenció).',
            'Publica story amb “abans/ara”.',
            'Convida a respondre la story amb opinió.',
          ],
          checklist: ['Missatge honest', 'Dada concreta', 'To constructiu'],
          assets_needed: ['Captura simple del canvi', 'Foto de suport'],
          time_estimate_min: 10,
          example_caption: 'Hem optimitzat la preparació en hores punta per servir més àgil.',
        },
      },
    },
    {
      code: 'HUMAN_EVERGREEN',
      priority: 10,
      trigger_type: 'evergreen',
      cooldown_days: 7,
      recommendation_template: {
        format: 'reel',
        hook: 'Backstage abans del servei',
        idea: 'Mostra equip i preparació prèvia d’obertura en 3 clips.',
        cta: 'Pregunta quin plat volen veure la propera setmana.',
        assets_needed: ['3 clips verticals', 'Música ambiental'],
        how_to: {
          why: 'El backstage gastronòmic és fàcil d’executar i genera molta proximitat.',
          steps: [
            'Grava mise en place, sala i un detall final.',
            'Munta clips amb ordre cronològic.',
            'Afegeix text curt amb el valor diferencial.',
          ],
          checklist: ['Vertical', 'Text breu', 'Call to action final'],
          assets_needed: ['Mòbil', 'Llum de cuina/sala'],
          time_estimate_min: 15,
          example_caption: 'Abans d’obrir, cada detall compta. Així ho preparem.',
        },
      },
    },
  ],
  hotel: [
    {
      code: 'OFFENSIVE_KEYWORD',
      priority: 8,
      trigger_type: 'offensive_keyword',
      cooldown_days: 7,
      recommendation_template: {
        format: 'post',
        hook: 'Allò que més valoreu: {{keyword}}',
        idea: 'Mostra una imatge de l’espai o servei relacionat amb {{keyword}} i explica com el cuideu.',
        cta: 'Convida a reservar estada.',
        assets_needed: ['Foto d’habitació o espai comú', 'Text curt'],
        how_to: {
          why: 'Posa el focus en el que millor funciona i transforma-ho en nova demanda.',
          steps: [
            'Tria un espai representatiu.',
            'Explica el valor concret en una frase.',
            'Inclou CTA de reserva o consulta.',
          ],
          checklist: ['Espai net i lluminós', 'Missatge específic', 'CTA visible'],
          assets_needed: ['Foto principal', 'Text de 1-2 línies'],
          time_estimate_min: 12,
          example_caption: 'Ens encanta llegir-vos quan destaqueu {{keyword}}.',
        },
      },
    },
    {
      code: 'DEFENSIVE_NEG',
      priority: 9,
      trigger_type: 'defensive_neg',
      cooldown_days: 5,
      recommendation_template: {
        format: 'story',
        hook: 'Millores implementades aquesta setmana',
        idea: 'Comunica una acció concreta de millora en check-in, neteja o descans.',
        cta: 'Convida a explicar com ha estat l’experiència.',
        assets_needed: ['Story amb text i imatge real'],
        how_to: {
          why: 'Un missatge proactiu ajuda a recuperar confiança i evita rumors interns.',
          steps: [
            'Escull una millora real ja aplicada.',
            'Explica-la en llenguatge simple.',
            'Convida els hostes a confirmar el canvi.',
          ],
          checklist: ['Acció verificable', 'To proper', 'Sense sobrepromeses'],
          assets_needed: ['1 imatge d’espai/servei', 'Text curt'],
          time_estimate_min: 10,
          example_caption: 'Hem reforçat el procés de recepció per agilitzar arribades.',
        },
      },
    },
    {
      code: 'HUMAN_EVERGREEN',
      priority: 10,
      trigger_type: 'evergreen',
      cooldown_days: 7,
      recommendation_template: {
        format: 'reel',
        hook: 'El teu equip, en acció',
        idea: 'Mostra el dia a dia de recepció, habitacions i atenció al client en 3 moments.',
        cta: 'Pregunta quin servei valoren més en una estada.',
        assets_needed: ['3 clips breus', 'Text superposat'],
        how_to: {
          why: 'Donar cara humana al servei hoteler incrementa confiança prèvia a la reserva.',
          steps: [
            'Grava tres moments curts del servei.',
            'Ordena clips amb inici, punt fort i tancament.',
            'Afegeix subtítol amb missatge de valor.',
          ],
          checklist: ['Clips estables', 'Text llegible', 'CTA final'],
          assets_needed: ['Mòbil vertical', 'Música suau'],
          time_estimate_min: 15,
          example_caption: 'Així preparem cada detall perquè la teva estada sigui impecable.',
        },
      },
    },
  ],
};

const EMPTY_UUID = '00000000-0000-0000-0000-000000000000';

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => asString(entry))
    .filter(Boolean);
}

function normalizeLanguageCode(value: string | null | undefined): string | null {
  const raw = asString(value);
  if (!raw) return null;
  const short = raw.toLowerCase().split(/[-_]/)[0];
  return short || null;
}

function isVisibleStatus(status: RecommendationStatus): boolean {
  return status === 'shown' || status === 'accepted' || status === 'published';
}

function isMissingInsightDependency(error: unknown): boolean {
  const message = asString((error as { message?: string })?.message).toLowerCase();
  const code = asString((error as { code?: string })?.code).toUpperCase();
  return code === '42P01'
    || code === '42703'
    || code === 'PGRST205'
    || message.includes('insights_daily')
    || message.includes('biz_insights_daily');
}

function isMissingRecommendationColumn(error: unknown): boolean {
  const message = asString((error as { message?: string })?.message).toLowerCase();
  const code = asString((error as { code?: string })?.code).toUpperCase();
  return code === '42703'
    || code === 'PGRST204'
    || message.includes('recommendation_log.')
    || message.includes('could not find the')
    || message.includes('schema cache');
}

function safeJsonParse(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  if (!value.trim()) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function interpolatePlaceholders(input: unknown, vars: Record<string, string>): unknown {
  if (typeof input === 'string') {
    return input.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => vars[key] || '');
  }
  if (Array.isArray(input)) {
    return input.map((entry) => interpolatePlaceholders(entry, vars));
  }
  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      out[key] = interpolatePlaceholders(value, vars);
    }
    return out;
  }
  return input;
}

export function getWeekStartMondayIso(input: Date): string {
  const d = new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
  const day = d.getUTCDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diffToMonday);
  return d.toISOString().slice(0, 10);
}

export function mapBusinessTypeToVertical(type: string | null | undefined): RecommendationVertical {
  const normalized = asString(type).toLowerCase();
  if (normalized === 'restaurant') return 'restaurant';
  if (normalized === 'hotel') return 'hotel';
  return 'general';
}

function parseHowTo(input: unknown): RecommendationHowTo | null {
  const obj = asObject(input);
  const why = asString(obj.why);
  const steps = asStringArray(obj.steps);
  const checklist = asStringArray(obj.checklist);
  const assetsNeeded = asStringArray(obj.assets_needed);
  const timeEstimate = asNumber(obj.time_estimate_min, 0);
  const exampleCaption = asString(obj.example_caption) || undefined;

  if (!why || steps.length === 0 || checklist.length === 0 || assetsNeeded.length === 0 || timeEstimate <= 0) {
    return null;
  }

  return {
    why,
    steps,
    checklist,
    assets_needed: assetsNeeded,
    time_estimate_min: timeEstimate,
    example_caption: exampleCaption,
  };
}

function parseSignalMeta(input: unknown): RecommendationSignalMeta {
  const obj = asObject(input);
  const keyword = asString(obj.keyword) || undefined;
  const keywordMentionsRaw = obj.keyword_mentions;
  const keyword_mentions = typeof keywordMentionsRaw === 'number' && Number.isFinite(keywordMentionsRaw)
    ? keywordMentionsRaw
    : undefined;
  const avgRatingRaw = obj.avg_rating;
  const avg_rating = typeof avgRatingRaw === 'number' && Number.isFinite(avgRatingRaw) ? avgRatingRaw : undefined;
  const negReviewsRaw = obj.neg_reviews;
  const neg_reviews = typeof negReviewsRaw === 'number' && Number.isFinite(negReviewsRaw) ? negReviewsRaw : undefined;
  const dominant_lang = asString(obj.dominant_lang) || undefined;
  const confidenceRaw = asString(obj.confidence).toLowerCase();
  const confidence = confidenceRaw === 'high' || confidenceRaw === 'medium' || confidenceRaw === 'low'
    ? confidenceRaw
    : undefined;
  return {
    keyword,
    keyword_mentions,
    avg_rating,
    neg_reviews,
    dominant_lang,
    confidence,
  };
}

function parseLanguageMeta(input: unknown): RecommendationLanguageMeta | null {
  const obj = asObject(input);
  const base = normalizeLanguageCode(asString(obj.base_lang));
  const suggested = normalizeLanguageCode(asString(obj.suggested_lang));
  const confidenceRaw = asString(obj.confidence).toLowerCase();
  if (!base || !suggested) return null;
  const confidence: LanguageConfidence = confidenceRaw === 'high' || confidenceRaw === 'medium' || confidenceRaw === 'low'
    ? confidenceRaw
    : 'low';
  return {
    base_lang: base,
    suggested_lang: suggested,
    confidence,
  };
}

function buildFallbackHowTo(template: { format: string; hook: string; idea: string; cta: string }): RecommendationHowTo {
  return {
    why: 'Publicar contingut regular ajuda a convertir reputació en confiança.',
    steps: [
      `Prepara una peça ràpida en format ${template.format}.`,
      `Destaca una idea clara: ${template.idea}`,
      `Tanca amb una crida a l'acció: ${template.cta}`,
    ],
    checklist: ['Missatge clar', 'Visual real del local', 'CTA final visible'],
    assets_needed: ['Imatge o vídeo curt', 'Text breu'],
    time_estimate_min: 12,
    example_caption: `${template.hook} — ${template.idea}`,
  };
}

function buildDefaultLanguage(baseLang: string): RecommendationLanguageMeta {
  return {
    base_lang: normalizeLanguageCode(baseLang) || 'ca',
    suggested_lang: normalizeLanguageCode(baseLang) || 'ca',
    confidence: 'low',
  };
}

export function parseTemplate(input: unknown): RecommendationTemplate | null {
  if (!input || typeof input !== 'object') return null;
  const obj = input as Record<string, unknown>;
  const format = asString(obj.format);
  const hook = asString(obj.hook);
  const idea = asString(obj.idea);
  const cta = asString(obj.cta);
  if (!format || !hook || !idea || !cta) return null;

  const assets_needed = asStringArray(obj.assets_needed);
  const how_to = parseHowTo(obj.how_to) || buildFallbackHowTo({ format, hook, idea, cta });
  const signal = parseSignalMeta(obj.signal);
  const language = parseLanguageMeta(obj.language) || buildDefaultLanguage('ca');

  return {
    format,
    hook,
    idea,
    cta,
    assets_needed: assets_needed.length > 0 ? assets_needed : how_to.assets_needed,
    how_to,
    signal,
    language,
  };
}

export function parseTemplateFromGeneratedCopy(value: unknown): RecommendationTemplate | null {
  return parseTemplate(safeJsonParse(value));
}

export function ensureTemplateOrFallback(template: unknown): RecommendationTemplate {
  const parsed = parseTemplate(template);
  if (parsed) return parsed;

  const format = 'post';
  const hook = 'Comparteix una història real del teu negoci';
  const idea = 'Publica un contingut curt i visual amb un detall diferencial del servei.';
  const cta = 'Convida a deixar una ressenya després de la visita.';
  const fallbackHowTo = buildFallbackHowTo({ format, hook, idea, cta });

  return {
    format,
    hook,
    idea,
    cta,
    assets_needed: fallbackHowTo.assets_needed,
    how_to: fallbackHowTo,
    signal: {},
    language: buildDefaultLanguage('ca'),
  };
}

function mergeTemplate(baseTemplate: RecommendationTemplate, overrideTemplate: RecommendationTemplate | null): RecommendationTemplate {
  if (!overrideTemplate) return baseTemplate;
  const mergedSignal: RecommendationSignalMeta = {
    ...baseTemplate.signal,
    ...overrideTemplate.signal,
  };
  const mergedLanguage = overrideTemplate.language || baseTemplate.language;
  const mergedHowTo = overrideTemplate.how_to || baseTemplate.how_to;
  const mergedAssets = overrideTemplate.assets_needed.length > 0 ? overrideTemplate.assets_needed : baseTemplate.assets_needed;

  return {
    format: overrideTemplate.format || baseTemplate.format,
    hook: overrideTemplate.hook || baseTemplate.hook,
    idea: overrideTemplate.idea || baseTemplate.idea,
    cta: overrideTemplate.cta || baseTemplate.cta,
    assets_needed: mergedAssets.length > 0 ? mergedAssets : mergedHowTo.assets_needed,
    how_to: mergedHowTo,
    signal: mergedSignal,
    language: mergedLanguage,
  };
}

function daysBetweenUtc(now: Date, previousIso: string): number {
  const previous = new Date(previousIso);
  if (Number.isNaN(previous.getTime())) return Number.MAX_SAFE_INTEGER;
  return Math.floor((now.getTime() - previous.getTime()) / (1000 * 60 * 60 * 24));
}

function isCooldownExpired(
  rule: Pick<PlaybookRuleRow, 'id' | 'cooldown_days'>,
  latestByRuleId: Map<string, string>,
  now: Date,
): boolean {
  const latest = latestByRuleId.get(rule.id);
  if (!latest) return true;
  const elapsedDays = daysBetweenUtc(now, latest);
  return elapsedDays >= Math.max(rule.cooldown_days ?? 0, 0);
}

async function fetchWeekLogs(params: {
  readClient: SupabaseClient;
  bizId: string;
  weekStart: string;
}): Promise<RecommendationLogRow[]> {
  const extendedQuery = await params.readClient
    .from('recommendation_log')
    .select('id, rule_id, status, source, signal, format, steps, assets_needed, copy_short, copy_long, hashtags, generated_copy, generated_at, week_start')
    .eq('biz_id', params.bizId)
    .eq('week_start', params.weekStart)
    .order('generated_at', { ascending: true });

  if (extendedQuery.error && isMissingRecommendationColumn(extendedQuery.error)) {
    const fallbackQuery = await params.readClient
      .from('recommendation_log')
      .select('id, rule_id, status, generated_copy, generated_at, week_start')
      .eq('biz_id', params.bizId)
      .eq('week_start', params.weekStart)
      .order('generated_at', { ascending: true });

    if (fallbackQuery.error) {
      throw new Error(`weekly_logs_query_failed:${fallbackQuery.error.message}`);
    }
    return (fallbackQuery.data || []) as RecommendationLogRow[];
  }

  if (extendedQuery.error) {
    throw new Error(`weekly_logs_query_failed:${extendedQuery.error.message}`);
  }

  return (extendedQuery.data || []) as RecommendationLogRow[];
}

async function fetchSignalContext(params: {
  readClient: SupabaseClient;
  bizId: string;
  businessDefaultLanguage: string;
  rangeDays: number;
}): Promise<SignalContext> {
  const now = new Date();
  const since = new Date(now);
  since.setUTCDate(since.getUTCDate() - Math.max(params.rangeDays - 1, 0));
  const sinceDateIso = since.toISOString().slice(0, 10);
  const sinceTimestampIso = since.toISOString();

  const baseLang = normalizeLanguageCode(params.businessDefaultLanguage) || 'ca';

  let keyword: string | null = null;
  let keywordMentions: number | null = null;
  let avgRating: number | null = null;
  let negReviews = 0;
  const distribution = new Map<string, number>();

  const { data: rollupRows, error: rollupError } = await params.readClient
    .from('biz_insights_daily')
    .select('day, metrics, categories_summary, keywords_top, lang_dist, dominant_lang')
    .eq('biz_id', params.bizId)
    .eq('provider', 'google_business')
    .gte('day', sinceDateIso)
    .order('day', { ascending: false });

  if (!rollupError && rollupRows && rollupRows.length > 0) {
    const rows = rollupRows as BizInsightsDailyRow[];
    let weightedRatingSum = 0;
    let weightedRatingCount = 0;
    let bestTopic = '';
    let bestTopicCount = -1;

    for (const row of rows) {
      const metrics = asObject(row.metrics);
      const categories = asObject(row.categories_summary);
      const dayReviews = asNumber(metrics.new_reviews, 0);
      const dayAvg = asNumber(metrics.avg_rating, NaN);
      const dayNeg = asNumber(metrics.neg_reviews, 0);
      negReviews += dayNeg;

      if (Number.isFinite(dayAvg) && dayReviews > 0) {
        weightedRatingSum += dayAvg * dayReviews;
        weightedRatingCount += dayReviews;
      }

      for (const [topic, value] of Object.entries(categories)) {
        const topicStats = asObject(value);
        const total = asNumber(topicStats.total, 0);
        if (topic && total > bestTopicCount) {
          bestTopicCount = total;
          bestTopic = topic;
        }
      }

      if (Array.isArray(row.keywords_top)) {
        for (const topic of row.keywords_top) {
          const normalized = asString(topic);
          if (!normalized) continue;
          const next = (distribution.get(normalized) || 0) + 1;
          distribution.set(normalized, next);
        }
      }

      const langDist = asObject(row.lang_dist);
      for (const [lang, count] of Object.entries(langDist)) {
        const code = normalizeLanguageCode(lang);
        if (!code) continue;
        distribution.set(code, (distribution.get(code) || 0) + asNumber(count, 0));
      }
    }

    keyword = bestTopic || null;
    keywordMentions = bestTopicCount > 0 ? bestTopicCount : null;
    avgRating = weightedRatingCount > 0 ? Number((weightedRatingSum / weightedRatingCount).toFixed(2)) : null;
  } else if (rollupError && !isMissingInsightDependency(rollupError)) {
    throw new Error(`signals_query_failed:${rollupError.message}`);
  }

  if (!rollupRows || rollupRows.length === 0) {
    const { data: insightsRows, error: insightsError } = await params.readClient
      .from('insights_daily')
      .select('topic, praise_count, complaint_count, total_count, avg_rating')
      .eq('biz_id', params.bizId)
      .gte('date', sinceDateIso);

    if (!insightsError && insightsRows) {
      const rows = insightsRows as InsightsDailyRow[];
      let weightedRatingSum = 0;
      let weightedRatingCount = 0;
      let bestTopic = '';
      let bestTopicCount = -1;
      for (const row of rows) {
        const topic = asString(row.topic);
        const complaintCount = asNumber(row.complaint_count, 0);
        const praiseCount = asNumber(row.praise_count, 0);
        const totalCount = asNumber(row.total_count, complaintCount + praiseCount);
        negReviews += complaintCount;

        const rowRating = typeof row.avg_rating === 'number' && Number.isFinite(row.avg_rating)
          ? row.avg_rating
          : null;
        if (rowRating !== null && totalCount > 0) {
          weightedRatingSum += rowRating * totalCount;
          weightedRatingCount += totalCount;
        }

        if (topic && totalCount > bestTopicCount) {
          bestTopicCount = totalCount;
          bestTopic = topic;
        }
      }
      keyword = bestTopic || keyword;
      keywordMentions = bestTopicCount > 0 ? bestTopicCount : keywordMentions;
      if (weightedRatingCount > 0) {
        avgRating = Number((weightedRatingSum / weightedRatingCount).toFixed(2));
      }
    } else if (insightsError && !isMissingInsightDependency(insightsError)) {
      throw new Error(`signals_query_failed:${insightsError.message}`);
    }
  }

  const { data: reviewLangRows, error: reviewLangError } = await params.readClient
    .from('reviews')
    .select('language_detected')
    .eq('biz_id', params.bizId)
    .gte('created_at', sinceTimestampIso)
    .limit(500);

  if (reviewLangError && !isMissingInsightDependency(reviewLangError)) {
    throw new Error(`signals_language_query_failed:${reviewLangError.message}`);
  }

  for (const row of (reviewLangRows || []) as ReviewLanguageRow[]) {
    const code = normalizeLanguageCode(row.language_detected);
    if (!code) continue;
    distribution.set(code, (distribution.get(code) || 0) + 1);
  }

  let dominantLang: string | null = null;
  let dominantCount = 0;
  let totalLangCount = 0;
  for (const [lang, count] of distribution.entries()) {
    totalLangCount += count;
    if (count > dominantCount) {
      dominantCount = count;
      dominantLang = lang;
    }
  }

  let confidence: LanguageConfidence = 'low';
  let suggestedLang = baseLang;
  if (dominantLang) {
    suggestedLang = dominantLang;
    confidence = totalLangCount > 0 && (dominantCount / totalLangCount) >= 0.6 ? 'high' : 'medium';
  }

  const negTrigger = (avgRating !== null && avgRating < 4.2) || negReviews >= 3;

  return {
    keyword,
    keywordMentions,
    avgRating,
    negReviews,
    dominantLang,
    baseLang,
    suggestedLang,
    confidence,
    negTrigger,
  };
}

async function ensureD10RuleCatalog(writeClient: SupabaseClient): Promise<void> {
  const playbookRows = (Object.keys(D1_PLAYBOOK_NAMES) as RecommendationVertical[]).map((vertical) => ({
    vertical,
    name: D1_PLAYBOOK_NAMES[vertical],
    description: `Playbook ${vertical} D1.0`,
    is_active: true,
  }));

  const { error: playbookUpsertError } = await writeClient
    .from('social_playbooks')
    .upsert(playbookRows, { onConflict: 'vertical,name', ignoreDuplicates: false });
  if (playbookUpsertError) {
    throw new Error(`playbook_seed_failed:${playbookUpsertError.message}`);
  }

  const { data: playbooksData, error: playbooksError } = await writeClient
    .from('social_playbooks')
    .select('id, vertical, name')
    .in('vertical', ['general', 'restaurant', 'hotel'])
    .in('name', ['General SMB', 'Restaurant', 'Hotel']);
  if (playbooksError) {
    throw new Error(`playbook_lookup_failed:${playbooksError.message}`);
  }

  const playbooks = (playbooksData || []) as SocialPlaybookRow[];
  const playbookByVertical = new Map<RecommendationVertical, SocialPlaybookRow>();
  for (const row of playbooks) {
    if (!playbookByVertical.has(row.vertical)) playbookByVertical.set(row.vertical, row);
  }
  const playbookIds = [...playbookByVertical.values()].map((row) => row.id);
  if (playbookIds.length === 0) return;

  const { data: existingRulesData, error: existingRulesError } = await writeClient
    .from('playbook_rules')
    .select('id, playbook_id, trigger_type, trigger_config')
    .in('playbook_id', playbookIds);
  if (existingRulesError) {
    throw new Error(`playbook_rules_lookup_failed:${existingRulesError.message}`);
  }

  const existingRules = (existingRulesData || []) as Array<Pick<PlaybookRuleRow, 'id' | 'playbook_id' | 'trigger_type' | 'trigger_config'>>;
  const inserts: Array<Record<string, unknown>> = [];

  for (const vertical of Object.keys(D1_RULE_SEEDS) as RecommendationVertical[]) {
    const playbook = playbookByVertical.get(vertical);
    if (!playbook) continue;
    for (const seed of D1_RULE_SEEDS[vertical]) {
      const alreadyExists = existingRules.some((rule) => {
        if (rule.playbook_id !== playbook.id || rule.trigger_type !== seed.trigger_type) return false;
        const config = asObject(rule.trigger_config);
        return asString(config.d1_code) === seed.code;
      });
      if (alreadyExists) continue;
      inserts.push({
        playbook_id: playbook.id,
        priority: seed.priority,
        trigger_type: seed.trigger_type,
        trigger_config: { d1_code: seed.code, kind: seed.code === 'HUMAN_EVERGREEN' ? 'human' : 'signal' },
        recommendation_template: seed.recommendation_template,
        cooldown_days: seed.cooldown_days,
        is_active: true,
      });
    }
  }

  if (inserts.length === 0) return;
  const { error: rulesInsertError } = await writeClient
    .from('playbook_rules')
    .insert(inserts);
  if (rulesInsertError) {
    throw new Error(`playbook_rules_seed_failed:${rulesInsertError.message}`);
  }
}

async function fetchCandidateRules(params: {
  readClient: SupabaseClient;
  vertical: RecommendationVertical;
}): Promise<{ playbooks: SocialPlaybookRow[]; rules: PlaybookRuleRow[] }> {
  const verticals: RecommendationVertical[] = params.vertical === 'general'
    ? ['general']
    : [params.vertical, 'general'];

  const { data: playbooksData, error: playbooksError } = await params.readClient
    .from('social_playbooks')
    .select('id, vertical, name')
    .in('vertical', verticals)
    .eq('is_active', true);

  if (playbooksError) {
    throw new Error(`playbooks_query_failed:${playbooksError.message}`);
  }

  const playbooks = (playbooksData || []) as SocialPlaybookRow[];
  const playbookIds = playbooks.map((row) => row.id);
  if (playbookIds.length === 0) return { playbooks, rules: [] };

  const { data: rulesData, error: rulesError } = await params.readClient
    .from('playbook_rules')
    .select('id, playbook_id, priority, cooldown_days, recommendation_template, created_at, trigger_type, trigger_config')
    .eq('is_active', true)
    .in('playbook_id', playbookIds);

  if (rulesError) {
    throw new Error(`rules_query_failed:${rulesError.message}`);
  }

  const playbookById = new Map(playbooks.map((row) => [row.id, row]));
  const rules = ((rulesData || []) as PlaybookRuleRow[]).sort((a, b) => {
    const aVertical = playbookById.get(a.playbook_id)?.vertical;
    const bVertical = playbookById.get(b.playbook_id)?.vertical;
    const aWeight = aVertical === params.vertical ? 0 : 1;
    const bWeight = bVertical === params.vertical ? 0 : 1;
    if (aWeight !== bWeight) return aWeight - bWeight;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.created_at.localeCompare(b.created_at);
  });

  return { playbooks, rules };
}

function matchesRuleSignal(rule: PlaybookRuleRow, signal: SignalContext): boolean {
  if (rule.trigger_type === 'offensive_keyword') {
    return Boolean(signal.keyword);
  }
  if (rule.trigger_type === 'defensive_neg') {
    return signal.negTrigger;
  }
  return true;
}

function createSignalMeta(rule: PlaybookRuleRow, signal: SignalContext): RecommendationSignalMeta {
  const base: RecommendationSignalMeta = {
    keyword_mentions: signal.keywordMentions ?? undefined,
    avg_rating: signal.avgRating ?? undefined,
    neg_reviews: signal.negReviews,
    dominant_lang: signal.dominantLang ?? undefined,
    confidence: signal.confidence,
  };
  if (rule.trigger_type === 'offensive_keyword' && signal.keyword) {
    base.keyword = signal.keyword;
  }
  return base;
}

function buildTemplateFromRule(args: {
  rule: PlaybookRuleRow;
  signal: SignalContext;
  vertical: RecommendationVertical;
}): RecommendationTemplate {
  const baseTemplate = ensureTemplateOrFallback(args.rule.recommendation_template);
  const replacements: Record<string, string> = {
    keyword: args.signal.keyword || 'el servei',
    avg_rating: args.signal.avgRating !== null ? args.signal.avgRating.toFixed(1) : '-',
    neg_reviews: String(args.signal.negReviews),
    suggested_lang: args.signal.suggestedLang,
  };
  const interpolatedRaw = interpolatePlaceholders(baseTemplate, replacements);
  const parsed = ensureTemplateOrFallback(interpolatedRaw);
  const signalMeta = createSignalMeta(args.rule, args.signal);

  return {
    ...parsed,
    assets_needed: parsed.assets_needed.length > 0 ? parsed.assets_needed : parsed.how_to.assets_needed,
    signal: signalMeta,
    language: {
      base_lang: args.signal.baseLang,
      suggested_lang: args.signal.suggestedLang,
      confidence: args.signal.confidence,
    },
  };
}

async function ensureTargetCount(params: {
  readClient: SupabaseClient;
  writeClient: SupabaseClient;
  bizId: string;
  orgId: string;
  vertical: RecommendationVertical;
  weekStart: string;
  existingLogs: RecommendationLogRow[];
  signal: SignalContext;
}): Promise<void> {
  const visibleNow = params.existingLogs.filter((row) => isVisibleStatus(row.status));
  if (visibleNow.length >= TARGET_WEEKLY_RECOMMENDATIONS) return;

  await ensureD10RuleCatalog(params.writeClient);

  const needed = TARGET_WEEKLY_RECOMMENDATIONS - visibleNow.length;
  const { playbooks, rules: candidateRules } = await fetchCandidateRules({
    readClient: params.readClient,
    vertical: params.vertical,
  });
  if (candidateRules.length === 0) return;

  const maxCooldown = Math.max(...candidateRules.map((rule) => rule.cooldown_days || 0), 0);
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - Math.max(maxCooldown, 7));

  const { data: recentLogsData, error: recentLogsError } = await params.readClient
    .from('recommendation_log')
    .select('rule_id, status, generated_at')
    .eq('biz_id', params.bizId)
    .in('status', VISIBLE_STATUSES)
    .gte('generated_at', since.toISOString())
    .order('generated_at', { ascending: false });

  if (recentLogsError) {
    throw new Error(`recent_logs_query_failed:${recentLogsError.message}`);
  }

  const latestByRuleId = new Map<string, string>();
  for (const row of recentLogsData || []) {
    const ruleId = asString((row as { rule_id?: string }).rule_id);
    const generatedAt = asString((row as { generated_at?: string }).generated_at);
    if (ruleId && generatedAt && !latestByRuleId.has(ruleId)) {
      latestByRuleId.set(ruleId, generatedAt);
    }
  }

  const existingWeekRuleIds = new Set(params.existingLogs.map((row) => row.rule_id));
  const existingWeekKeywords = new Set<string>();
  for (const log of params.existingLogs) {
    const template = parseTemplateFromGeneratedCopy(log.generated_copy);
    const keyword = asString(template?.signal?.keyword).toLowerCase();
    if (keyword) existingWeekKeywords.add(keyword);
  }

  const selected: PlaybookRuleRow[] = [];
  const selectedIds = new Set<string>();
  const now = new Date();
  const selectedKeywords = new Set(existingWeekKeywords);
  let selectedSignalCount = 0;

  const trySelect = (rule: PlaybookRuleRow): boolean => {
    if (selected.length >= needed) return false;
    if (existingWeekRuleIds.has(rule.id) || selectedIds.has(rule.id)) return false;
    if (!matchesRuleSignal(rule, params.signal)) return false;
    if (!isCooldownExpired(rule, latestByRuleId, now)) return false;
    const isSignalRule = rule.trigger_type === 'offensive_keyword' || rule.trigger_type === 'defensive_neg';
    if (isSignalRule && selectedSignalCount >= 1) return false;

    if (rule.trigger_type === 'offensive_keyword' && params.signal.keyword) {
      const normalizedKeyword = params.signal.keyword.toLowerCase();
      if (selectedKeywords.has(normalizedKeyword)) return false;
      selectedKeywords.add(normalizedKeyword);
    }

    selected.push(rule);
    selectedIds.add(rule.id);
    if (isSignalRule) selectedSignalCount += 1;
    return true;
  };

  const byType = (type: string) => candidateRules.filter((rule) => rule.trigger_type === type);
  const offensiveRules = byType('offensive_keyword');
  const defensiveRules = byType('defensive_neg');
  const humanRules = candidateRules.filter((rule) => {
    if (rule.trigger_type !== 'evergreen') return false;
    const cfg = asObject(rule.trigger_config);
    return asString(cfg.d1_code) === 'HUMAN_EVERGREEN' || asString(cfg.kind) === 'human';
  });
  const evergreenRules = candidateRules.filter((rule) => rule.trigger_type === 'evergreen');
  const fallbackRules = candidateRules.filter((rule) => !['offensive_keyword', 'defensive_neg', 'evergreen'].includes(rule.trigger_type));

  const prioritizedSignalRules = [...offensiveRules, ...defensiveRules].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.created_at.localeCompare(b.created_at);
  });

  for (const rule of prioritizedSignalRules) {
    if (selectedSignalCount >= 1) break;
    if (rule.trigger_type === 'offensive_keyword' && !params.signal.keyword) continue;
    if (rule.trigger_type === 'defensive_neg' && !params.signal.negTrigger) continue;
    if (trySelect(rule)) break;
  }

  for (const rule of humanRules) {
    if (selected.length >= needed) break;
    trySelect(rule);
  }

  for (const rule of evergreenRules) {
    if (selected.length >= needed) break;
    trySelect(rule);
  }

  for (const rule of [...offensiveRules, ...defensiveRules, ...fallbackRules, ...candidateRules]) {
    if (selected.length >= needed) break;
    if (selectedIds.has(rule.id)) continue;
    if (existingWeekRuleIds.has(rule.id)) continue;
    if (!matchesRuleSignal(rule, params.signal)) continue;
    selected.push(rule);
    selectedIds.add(rule.id);
  }

  if (selected.length > 0) {
    const playbookVerticalById = new Map(playbooks.map((row) => [row.id, row.vertical]));
    const rowsToInsert = selected.map((rule) => {
      const template = buildTemplateFromRule({
        rule,
        signal: params.signal,
        vertical: playbookVerticalById.get(rule.playbook_id) || params.vertical,
      });
      const source = (rule.trigger_type === 'offensive_keyword' || rule.trigger_type === 'defensive_neg')
        ? 'signal'
        : 'evergreen';
      return {
        org_id: params.orgId,
        biz_id: params.bizId,
        rule_id: rule.id,
        week_start: params.weekStart,
        status: 'shown' as const,
        source,
        format: template.format,
        signal: template.signal,
        steps: template.how_to.steps,
        assets_needed: template.assets_needed,
        generated_copy: template,
      };
    });

    const { error: insertError } = await params.writeClient
      .from('recommendation_log')
      .upsert(rowsToInsert, { onConflict: 'biz_id,rule_id,week_start', ignoreDuplicates: true });

    if (insertError) {
      throw new Error(`insert_logs_failed:${insertError.message}`);
    }
  }

  const refreshedLogs = await fetchWeekLogs({
    readClient: params.readClient,
    bizId: params.bizId,
    weekStart: params.weekStart,
  });
  const refreshedVisible = refreshedLogs.filter((row) => isVisibleStatus(row.status));
  if (refreshedVisible.length >= TARGET_WEEKLY_RECOMMENDATIONS) return;

  const stillMissing = TARGET_WEEKLY_RECOMMENDATIONS - refreshedVisible.length;
  const dismissedToRevive = refreshedLogs
    .filter((row) => row.status === 'dismissed')
    .slice(0, stillMissing)
    .map((row) => row.id);

  if (dismissedToRevive.length === 0) return;

  const { error: reviveError } = await params.writeClient
    .from('recommendation_log')
    .update({ status: 'shown' })
    .in('id', dismissedToRevive);

  if (reviveError) {
    throw new Error(`revive_dismissed_failed:${reviveError.message}`);
  }
}

async function enrichItemsFromLogs(params: {
  readClient: SupabaseClient;
  logs: RecommendationLogRow[];
  fallbackVertical: RecommendationVertical;
  signal: SignalContext;
}): Promise<WeeklyRecommendationItem[]> {
  const visibleLogs = params.logs.filter((row) => isVisibleStatus(row.status));
  if (visibleLogs.length === 0) return [];

  const ruleIds = [...new Set(visibleLogs.map((row) => row.rule_id))];
  const { data: rulesData, error: rulesError } = await params.readClient
    .from('playbook_rules')
    .select('id, playbook_id, priority, recommendation_template')
    .in('id', ruleIds);

  if (rulesError) {
    throw new Error(`rules_lookup_failed:${rulesError.message}`);
  }

  const playbookIds = [...new Set((rulesData || []).map((row) => (row as { playbook_id?: string }).playbook_id).filter(Boolean))];
  const { data: playbooksData, error: playbooksError } = await params.readClient
    .from('social_playbooks')
    .select('id, vertical')
    .in('id', playbookIds.length ? playbookIds : [EMPTY_UUID]);

  if (playbooksError) {
    throw new Error(`playbooks_lookup_failed:${playbooksError.message}`);
  }

  const verticalByPlaybookId = new Map<string, RecommendationVertical>();
  for (const row of playbooksData || []) {
    const id = asString((row as { id?: string }).id);
    const vertical = asString((row as { vertical?: string }).vertical) as RecommendationVertical;
    if (id && vertical) verticalByPlaybookId.set(id, vertical);
  }

  const ruleInfoById = new Map<string, { priority: number; vertical: RecommendationVertical; template: RecommendationTemplate }>();
  for (const row of rulesData || []) {
    const id = asString((row as { id?: string }).id);
    if (!id) continue;
    const playbookId = asString((row as { playbook_id?: string }).playbook_id);
    const priority = asNumber((row as { priority?: unknown }).priority, 100);
    const template = ensureTemplateOrFallback((row as { recommendation_template?: unknown }).recommendation_template);
    const vertical = verticalByPlaybookId.get(playbookId) || params.fallbackVertical;
    ruleInfoById.set(id, { priority, vertical, template });
  }

  // D1.4: sort signal-backed entries first so they appear at the top of the dashboard
  const sortedVisibleLogs = [...visibleLogs].sort((a, b) =>
    (a.source === 'signal' ? 0 : 1) - (b.source === 'signal' ? 0 : 1),
  );

  return sortedVisibleLogs.slice(0, TARGET_WEEKLY_RECOMMENDATIONS).map((row) => {
    const info = ruleInfoById.get(row.rule_id);
    const baseTemplate = info?.template || ensureTemplateOrFallback(null);
    const generatedTemplate = parseTemplateFromGeneratedCopy(row.generated_copy);
    const template = mergeTemplate(baseTemplate, generatedTemplate);
    const normalizedTemplate = ensureTemplateOrFallback(template);

    const signalMeta: RecommendationSignalMeta = {
      ...normalizedTemplate.signal,
      keyword_mentions: normalizedTemplate.signal.keyword_mentions ?? params.signal.keywordMentions ?? undefined,
      avg_rating: normalizedTemplate.signal.avg_rating ?? params.signal.avgRating ?? undefined,
      neg_reviews: normalizedTemplate.signal.neg_reviews ?? params.signal.negReviews,
      dominant_lang: normalizedTemplate.signal.dominant_lang ?? params.signal.dominantLang ?? undefined,
      confidence: normalizedTemplate.signal.confidence ?? params.signal.confidence,
    };

    const languageMeta: RecommendationLanguageMeta = normalizedTemplate.language || {
      base_lang: params.signal.baseLang,
      suggested_lang: params.signal.suggestedLang,
      confidence: params.signal.confidence,
    };

    return {
      id: row.id,
      rule_id: row.rule_id,
      status: row.status,
      source: row.source === 'signal' ? 'signal' : 'evergreen',
      generated_at: row.generated_at,
      week_start: row.week_start,
      priority: info?.priority ?? 100,
      vertical: info?.vertical ?? params.fallbackVertical,
      recommendation_template: {
        ...normalizedTemplate,
        signal: signalMeta,
        language: languageMeta,
      },
      format: normalizedTemplate.format,
      hook: normalizedTemplate.hook,
      idea: normalizedTemplate.idea,
      cta: normalizedTemplate.cta,
      how_to: normalizedTemplate.how_to,
      signal_meta: signalMeta,
      language: languageMeta,
    };
  });
}

export async function ensureAndGetWeeklyRecommendations(params: {
  readClient: SupabaseClient;
  writeClient: SupabaseClient;
  bizId: string;
  orgId: string;
  vertical: RecommendationVertical;
  weekStart: string;
  businessDefaultLanguage?: string | null;
}): Promise<{
  items: WeeklyRecommendationItem[];
  visibleCount: number;
}> {
  const signal = await fetchSignalContext({
    readClient: params.readClient,
    bizId: params.bizId,
    businessDefaultLanguage: params.businessDefaultLanguage || 'ca',
    rangeDays: SIGNAL_RANGE_DAYS,
  });

  const initialLogs = await fetchWeekLogs({
    readClient: params.readClient,
    bizId: params.bizId,
    weekStart: params.weekStart,
  });

  await ensureTargetCount({
    readClient: params.readClient,
    writeClient: params.writeClient,
    bizId: params.bizId,
    orgId: params.orgId,
    vertical: params.vertical,
    weekStart: params.weekStart,
    existingLogs: initialLogs,
    signal,
  });

  const finalLogs = await fetchWeekLogs({
    readClient: params.readClient,
    bizId: params.bizId,
    weekStart: params.weekStart,
  });

  const items = await enrichItemsFromLogs({
    readClient: params.readClient,
    logs: finalLogs,
    fallbackVertical: params.vertical,
    signal,
  });

  return {
    items: items.slice(0, TARGET_WEEKLY_RECOMMENDATIONS),
    visibleCount: items.length,
  };
}
