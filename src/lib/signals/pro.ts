import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import { mapBusinessTypeToVertical, type RecommendationVertical } from '@/lib/recommendations/d0';

export type SignalsLevel = 'basic' | 'advanced' | 'full';

export type SignalsProvider = 'google_business';

export type SignalKind = 'alert' | 'opportunity';

export type SignalSeverity = 'low' | 'med' | 'high';

export type SignalCode =
  | 'REPUTATION_LEAK'
  | 'TOPIC_RECURRENT'
  | 'LANGUAGE_SHIFT'
  | 'VIP_REVIEW'
  | 'DIGITAL_SILENCE'
  | 'OPPORTUNITY_TREND';

export type BizSignalRow = {
  id: string;
  org_id: string;
  biz_id: string;
  provider: SignalsProvider;
  code: SignalCode;
  kind: SignalKind;
  severity: SignalSeverity;
  title: string;
  reason: string;
  why: string | null;
  severity_score: number;
  fingerprint: string | null;
  cooldown_until: string | null;
  data: Record<string, unknown>;
  is_active: boolean;
  signal_day: string;
  created_at: string;
  updated_at: string;
};

export type SignalCard = {
  id: string;
  org_id: string;
  biz_id: string;
  provider: SignalsProvider;
  source: 'signal' | 'evergreen';
  kind: SignalKind;
  code: string;
  severity: SignalSeverity;
  title: string;
  reason: string;
  why: string;
  severity_score: number;
  fingerprint: string | null;
  data: Record<string, unknown>;
  cta_label: string;
  cta_route: string;
  cta_url: string;
  signal_day: string;
  created_at: string;
  updated_at: string;
};

type BusinessProfile = {
  id: string;
  org_id: string;
  name: string | null;
  type: string | null;
  default_language: string | null;
};

type ReviewRow = {
  id: string;
  rating: number | null;
  sentiment: string | null;
  review_text: string | null;
  language_detected: string | null;
  author_name: string | null;
  metadata: unknown;
  source: string | null;
  created_at: string;
};

type InsightDayRow = {
  day: string;
  metrics: unknown;
  categories_summary: unknown;
  keywords_top: string[] | null;
  lang_dist: unknown;
  dominant_lang: string | null;
};

type TopicStats = {
  pos: number;
  neg: number;
  neutral: number;
  total: number;
  reviewIds: Set<string>;
};

type ComputedSignal = {
  code: SignalCode;
  kind: SignalKind;
  severity: SignalSeverity;
  severity_score: number;
  title: string;
  reason: string;
  why: string;
  fingerprint: string;
  cooldown_until: string;
  data: Record<string, unknown>;
};

type RunParams = {
  admin: SupabaseClient;
  business: BusinessProfile;
  provider: SignalsProvider;
  signalsLevel: SignalsLevel;
  signalDay: string;
  rangeDays: number;
};

type RunResult = {
  processed: number;
  active: number;
  deactivated: number;
  signals: BizSignalRow[];
  signal_day: string;
};

type MaybeError = { code?: string | null; message?: string | null } | null | undefined;

const GOOGLE_SOURCES = ['google', 'google_business'] as const;
const DEFAULT_CTA_LABEL = 'Veure amb LITO';

const SIGNAL_CODES_BY_LEVEL: Record<SignalsLevel, SignalCode[]> = {
  basic: ['REPUTATION_LEAK', 'DIGITAL_SILENCE'],
  advanced: ['REPUTATION_LEAK', 'TOPIC_RECURRENT', 'LANGUAGE_SHIFT', 'DIGITAL_SILENCE'],
  full: ['REPUTATION_LEAK', 'TOPIC_RECURRENT', 'LANGUAGE_SHIFT', 'VIP_REVIEW', 'DIGITAL_SILENCE', 'OPPORTUNITY_TREND'],
};

const TOPIC_KEYWORDS: Record<string, string[]> = {
  service: ['service', 'servei', 'servicio', 'staff', 'atencio', 'atención', 'trato', 'waiter', 'camarer'],
  price: ['price', 'preu', 'precio', 'car', 'cara', 'caro', 'expensive', 'cheap', 'value'],
  clean: ['clean', 'cleanliness', 'neteja', 'limpieza', 'dirty', 'sucio', 'brut', 'higiene'],
  food: ['food', 'menjar', 'comida', 'plat', 'plato', 'dish', 'breakfast', 'dinner', 'smell'],
  ambience: ['ambience', 'ambient', 'atmosphere', 'soroll', 'noise', 'music', 'decor'],
};

const SIGNAL_COOLDOWN_DAYS = 7;

const SIGNAL_SEVERITY_SCORE: Record<SignalCode, number> = {
  REPUTATION_LEAK: 90,
  TOPIC_RECURRENT: 80,
  LANGUAGE_SHIFT: 60,
  VIP_REVIEW: 50,
  DIGITAL_SILENCE: 70,
  OPPORTUNITY_TREND: 55,
};

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function stableJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(',')}]`;
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(obj[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function buildSignalFingerprint(signal: Pick<ComputedSignal, 'code' | 'kind' | 'data'>): string {
  const data = signal.data || {};
  let keyPayload: Record<string, unknown>;

  switch (signal.code) {
    case 'REPUTATION_LEAK':
      keyPayload = {
        neg_reviews_48h: asNumber(data.neg_reviews_48h) ?? 0,
        avg_delta: asNumber(data.avg_delta) ?? 0,
      };
      break;
    case 'TOPIC_RECURRENT':
      keyPayload = {
        topic: String(data.topic || '').toLowerCase(),
        neg_share: asNumber(data.neg_share) ?? 0,
      };
      break;
    case 'LANGUAGE_SHIFT':
      keyPayload = {
        dominant_lang: normalizeLang(String(data.dominant_lang || '')) || '',
        dominant_share: asNumber(data.dominant_share) ?? 0,
      };
      break;
    case 'VIP_REVIEW':
      keyPayload = {
        review_id: String(data.review_id || ''),
      };
      break;
    case 'DIGITAL_SILENCE':
      keyPayload = {
        days_without_reviews: asNumber(data.days_without_reviews) ?? 0,
      };
      break;
    case 'OPPORTUNITY_TREND':
      keyPayload = {
        topic: String(data.topic || '').toLowerCase(),
        growth_ratio: asNumber(data.growth_ratio) ?? 0,
      };
      break;
  }

  const canonical = `${signal.kind}|${signal.code}|${stableJson(keyPayload)}`;
  return createHash('sha256').update(canonical).digest('hex');
}

function buildSignalWhy(signal: Pick<ComputedSignal, 'code' | 'data'>): string {
  const data = signal.data || {};
  switch (signal.code) {
    case 'REPUTATION_LEAK': {
      const neg48 = Math.max(0, Math.round(asNumber(data.neg_reviews_48h) ?? 0));
      const prev = asNumber(data.avg_rating_prev_7d);
      const current = asNumber(data.avg_rating_7d);
      if (neg48 >= 1) {
        return `${neg48} ressenyes <3★ en 48h`;
      }
      if (prev !== null && current !== null) {
        return `Mitjana 7 dies: ${prev.toFixed(1)}★ → ${current.toFixed(1)}★`;
      }
      return 'Senyal de reputació negativa recent';
    }
    case 'TOPIC_RECURRENT': {
      const topic = String(data.topic || 'servei');
      const share = Math.max(0, Math.round((asNumber(data.neg_share) ?? 0) * 100));
      return `${share}% mencions negatives sobre “${topic}” (7 dies)`;
    }
    case 'LANGUAGE_SHIFT': {
      const lang = String(data.dominant_lang || 'ca').toUpperCase();
      const share = Math.max(0, Math.round((asNumber(data.dominant_share) ?? 0) * 100));
      return `${share}% ressenyes en ${lang} (7 dies)`;
    }
    case 'VIP_REVIEW':
      return 'Ressenya 5★ d’un perfil destacat';
    case 'DIGITAL_SILENCE': {
      const days = Math.max(1, Math.round(asNumber(data.days_without_reviews) ?? 10));
      return `${days} dies sense ressenyes noves`;
    }
    case 'OPPORTUNITY_TREND': {
      const topic = String(data.topic || 'tema');
      const growth = asNumber(data.growth_ratio) ?? 1;
      const pct = Math.max(0, Math.round((growth - 1) * 100));
      return `+${pct}% mencions positives “${topic}” (7 dies)`;
    }
  }
}

function normalizeLang(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  return normalized.slice(0, 12);
}

function isSchemaDependencyError(error: MaybeError): boolean {
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || '').toLowerCase();
  return (
    code === '42P01'
    || code === '42703'
    || code === 'PGRST204'
    || code === 'PGRST205'
    || message.includes('schema cache')
    || message.includes('does not exist')
  );
}

function normalizeDateInput(day?: string | null): string {
  if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
  return new Date().toISOString().slice(0, 10);
}

function dayStartIso(day: string): string {
  return `${day}T00:00:00.000Z`;
}

function addDays(day: string, offset: number): string {
  const d = new Date(dayStartIso(day));
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function diffDays(fromDay: string, toDay: string): number {
  const from = new Date(dayStartIso(fromDay)).getTime();
  const to = new Date(dayStartIso(toDay)).getTime();
  return Math.max(0, Math.floor((to - from) / 86400000));
}

function averageRating(rows: ReviewRow[]): number | null {
  const values = rows
    .map((row) => (typeof row.rating === 'number' && Number.isFinite(row.rating) ? row.rating : null))
    .filter((value): value is number => value !== null);
  if (values.length === 0) return null;
  const sum = values.reduce((acc, value) => acc + value, 0);
  return Number((sum / values.length).toFixed(3));
}

function isNegativeReview(row: ReviewRow): boolean {
  const sentiment = String(row.sentiment || '').toLowerCase();
  if (sentiment === 'negative') return true;
  return typeof row.rating === 'number' && row.rating <= 2;
}

function isPositiveReview(row: ReviewRow): boolean {
  const sentiment = String(row.sentiment || '').toLowerCase();
  if (sentiment === 'positive') return true;
  return typeof row.rating === 'number' && row.rating >= 4;
}

function detectMacroTopics(reviewText: string): string[] {
  const text = reviewText.toLowerCase();
  const found: string[] = [];
  for (const [macro, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    if (keywords.some((keyword) => text.includes(keyword))) {
      found.push(macro);
    }
  }
  return found;
}

function normalizeReviewText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function parseMetrics(value: unknown): { new_reviews: number; avg_rating: number | null; neg_reviews: number; pos_reviews: number } {
  const obj = parseJsonObject(value);
  const newReviews = Number(obj.new_reviews ?? 0);
  const avgRatingRaw = obj.avg_rating;
  const avgRating = typeof avgRatingRaw === 'number' && Number.isFinite(avgRatingRaw)
    ? avgRatingRaw
    : typeof avgRatingRaw === 'string' && Number.isFinite(Number(avgRatingRaw))
      ? Number(avgRatingRaw)
      : null;
  const negReviews = Number(obj.neg_reviews ?? 0);
  const posReviews = Number(obj.pos_reviews ?? 0);
  return {
    new_reviews: Number.isFinite(newReviews) ? newReviews : 0,
    avg_rating: avgRating,
    neg_reviews: Number.isFinite(negReviews) ? negReviews : 0,
    pos_reviews: Number.isFinite(posReviews) ? posReviews : 0,
  };
}

function parseLangDist(value: unknown): Record<string, number> {
  const obj = parseJsonObject(value);
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(obj)) {
    const lang = normalizeLang(key);
    const count = Number(raw);
    if (!lang || !Number.isFinite(count) || count <= 0) continue;
    out[lang] = count;
  }
  return out;
}

function parseCategoriesSummary(value: unknown): Record<string, TopicStats> {
  const obj = parseJsonObject(value);
  const out: Record<string, TopicStats> = {};
  for (const [topic, raw] of Object.entries(obj)) {
    const macro = detectMacroTopics(topic).at(0) || topic.toLowerCase();
    const statsObj = parseJsonObject(raw);
    const pos = Number(statsObj.pos ?? 0);
    const neg = Number(statsObj.neg ?? 0);
    const neutral = Number(statsObj.neutral ?? 0);
    const total = Number(statsObj.total ?? pos + neg + neutral);
    if (!out[macro]) {
      out[macro] = { pos: 0, neg: 0, neutral: 0, total: 0, reviewIds: new Set<string>() };
    }
    out[macro].pos += Number.isFinite(pos) ? pos : 0;
    out[macro].neg += Number.isFinite(neg) ? neg : 0;
    out[macro].neutral += Number.isFinite(neutral) ? neutral : 0;
    out[macro].total += Number.isFinite(total) ? total : 0;
  }
  return out;
}

function buildTopicStatsFromReviews(rows: ReviewRow[]): Record<string, TopicStats> {
  const stats: Record<string, TopicStats> = {};
  for (const row of rows) {
    const text = normalizeReviewText(row.review_text);
    if (!text) continue;
    const macros = detectMacroTopics(text);
    if (macros.length === 0) continue;

    for (const macro of macros) {
      if (!stats[macro]) {
        stats[macro] = { pos: 0, neg: 0, neutral: 0, total: 0, reviewIds: new Set<string>() };
      }
      const target = stats[macro];
      if (isNegativeReview(row)) target.neg += 1;
      else if (isPositiveReview(row)) target.pos += 1;
      else target.neutral += 1;
      target.total += 1;
      target.reviewIds.add(row.id);
    }
  }
  return stats;
}

function mergeTopicStats(base: Record<string, TopicStats>, extra: Record<string, TopicStats>): Record<string, TopicStats> {
  const merged: Record<string, TopicStats> = { ...base };
  for (const [topic, stats] of Object.entries(extra)) {
    if (!merged[topic]) {
      merged[topic] = {
        pos: stats.pos,
        neg: stats.neg,
        neutral: stats.neutral,
        total: stats.total,
        reviewIds: new Set(stats.reviewIds),
      };
      continue;
    }
    merged[topic].pos += stats.pos;
    merged[topic].neg += stats.neg;
    merged[topic].neutral += stats.neutral;
    merged[topic].total += stats.total;
    for (const reviewId of stats.reviewIds) merged[topic].reviewIds.add(reviewId);
  }
  return merged;
}

function signalSeverityRank(severity: SignalSeverity): number {
  if (severity === 'high') return 0;
  if (severity === 'med') return 1;
  return 2;
}

function signalKindRank(kind: SignalKind): number {
  return kind === 'alert' ? 0 : 1;
}

export function getSignalsLevelLimit(level: SignalsLevel): number {
  if (level === 'basic') return 3;
  if (level === 'advanced') return 4;
  return 5;
}

function signalAllowed(level: SignalsLevel, code: SignalCode): boolean {
  return SIGNAL_CODES_BY_LEVEL[level].includes(code);
}

function includesGoogleSource(source: string | null | undefined): boolean {
  const normalized = String(source || '').trim().toLowerCase();
  return (GOOGLE_SOURCES as readonly string[]).includes(normalized);
}

function extractMetadataLowerString(value: unknown): string {
  try {
    return JSON.stringify(value || {}).toLowerCase();
  } catch {
    return '';
  }
}

function hasTruthyFlag(obj: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((key) => {
    const value = obj[key];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value > 0;
    if (typeof value === 'string') return ['true', 'yes', '1', 'local_guide', 'top_reviewer'].includes(value.toLowerCase().trim());
    return false;
  });
}

function isVipReview(row: ReviewRow): boolean {
  const metadataObject = parseJsonObject(row.metadata);
  const metadataText = extractMetadataLowerString(row.metadata);

  const hasVipMetadata =
    hasTruthyFlag(metadataObject, ['local_guide', 'localGuide', 'is_local_guide', 'top_reviewer', 'topReviewer'])
    || metadataText.includes('local guide')
    || metadataText.includes('top reviewer')
    || metadataText.includes('local_guide')
    || metadataText.includes('top_reviewer');

  if (hasVipMetadata && (row.rating || 0) >= 5) return true;

  const fallbackLongReview = Boolean(row.author_name && row.author_name.trim().length > 0)
    && normalizeReviewText(row.review_text).length > 80
    && (row.rating || 0) >= 5;

  return fallbackLongReview;
}

function toSafeReviewIds(rows: ReviewRow[], max = 5): string[] {
  return rows.slice(0, max).map((row) => row.id);
}

function toIsoDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function langDominantFromDist(dist: Record<string, number>): { dominant: string | null; share: number; total: number } {
  let dominant: string | null = null;
  let maxCount = 0;
  let total = 0;

  for (const [lang, count] of Object.entries(dist)) {
    if (!Number.isFinite(count) || count <= 0) continue;
    total += count;
    if (count > maxCount) {
      maxCount = count;
      dominant = lang;
    }
  }

  if (!dominant || total <= 0) return { dominant: null, share: 0, total: 0 };
  return { dominant, share: Number((maxCount / total).toFixed(3)), total };
}

function buildCurrentAndPreviousWindows(params: {
  rows: ReviewRow[];
  signalDay: string;
  rangeDays: number;
}): {
  current: ReviewRow[];
  previous: ReviewRow[];
  last48h: ReviewRow[];
  silenceWindow: ReviewRow[];
} {
  const anchorExclusive = new Date(dayStartIso(addDays(params.signalDay, 1))).getTime();
  const currentSince = anchorExclusive - (params.rangeDays * 86400000);
  const previousSince = currentSince - (params.rangeDays * 86400000);
  const last48hSince = anchorExclusive - (2 * 86400000);
  const silenceSince = anchorExclusive - (10 * 86400000);

  const current: ReviewRow[] = [];
  const previous: ReviewRow[] = [];
  const last48h: ReviewRow[] = [];
  const silenceWindow: ReviewRow[] = [];

  for (const row of params.rows) {
    const ts = Date.parse(row.created_at);
    if (!Number.isFinite(ts)) continue;
    if (ts >= currentSince && ts < anchorExclusive) current.push(row);
    if (ts >= previousSince && ts < currentSince) previous.push(row);
    if (ts >= last48hSince && ts < anchorExclusive) last48h.push(row);
    if (ts >= silenceSince && ts < anchorExclusive) silenceWindow.push(row);
  }

  return { current, previous, last48h, silenceWindow };
}

function sortSignalsPriority(a: SignalCard, b: SignalCard): number {
  const kindDelta = signalKindRank(a.kind) - signalKindRank(b.kind);
  if (kindDelta !== 0) return kindDelta;
  const scoreDelta = (b.severity_score || 0) - (a.severity_score || 0);
  if (scoreDelta !== 0) return scoreDelta;
  const severityDelta = signalSeverityRank(a.severity) - signalSeverityRank(b.severity);
  if (severityDelta !== 0) return severityDelta;
  return Date.parse(b.updated_at) - Date.parse(a.updated_at);
}

function buildSignalTitle(code: SignalCode): string {
  switch (code) {
    case 'REPUTATION_LEAK': return 'Fuita de reputació detectada';
    case 'TOPIC_RECURRENT': return 'Tema recurrent en negatiu';
    case 'LANGUAGE_SHIFT': return 'Canvi d\'idioma detectat';
    case 'VIP_REVIEW': return 'Ressenya VIP per amplificar';
    case 'DIGITAL_SILENCE': return 'Silenci digital';
    case 'OPPORTUNITY_TREND': return 'Tendència positiva aprofitable';
  }
}

function toSignalCard(params: { row: BizSignalRow; bizId: string }): SignalCard {
  const recommendationId = typeof params.row.data?.recommendation_id === 'string'
    ? params.row.data.recommendation_id
    : null;
  const query = new URLSearchParams({ biz_id: params.bizId, signal_id: params.row.id });
  if (recommendationId) query.set('recommendation_id', recommendationId);

  return {
    id: params.row.id,
    org_id: params.row.org_id,
    biz_id: params.row.biz_id,
    provider: params.row.provider,
    source: 'signal',
    kind: params.row.kind,
    code: params.row.code,
    severity: params.row.severity,
    severity_score: params.row.severity_score || 0,
    title: params.row.title,
    reason: params.row.reason,
    why: params.row.why || params.row.reason,
    fingerprint: params.row.fingerprint,
    data: params.row.data || {},
    cta_label: DEFAULT_CTA_LABEL,
    cta_route: `/dashboard/lito/chat?${query.toString()}`,
    cta_url: `/dashboard/lito/chat?${query.toString()}`,
    signal_day: params.row.signal_day,
    created_at: params.row.created_at,
    updated_at: params.row.updated_at,
  };
}

function buildEvergreenPool(vertical: RecommendationVertical): Array<Pick<SignalCard, 'code' | 'title' | 'reason'>> {
  if (vertical === 'restaurant') {
    return [
      {
        code: 'EVERGREEN_MENU',
        title: 'Mostra el teu menú del dia',
        reason: 'Un post curt amb el plat destacat activa visibilitat local de forma immediata.',
      },
      {
        code: 'EVERGREEN_BACKSTAGE',
        title: 'Backstage de servei',
        reason: 'Ensenyar preparació d\'equip genera confiança i proximitat.',
      },
      {
        code: 'EVERGREEN_REVIEW',
        title: 'Transforma una bona ressenya en contingut',
        reason: 'Amplificar feedback positiu reforça reputació i record de marca.',
      },
    ];
  }

  if (vertical === 'hotel') {
    return [
      {
        code: 'EVERGREEN_EXPERIENCE',
        title: 'Destaca una experiència real de client',
        reason: 'Publicar moments reals d\'estada converteix millor que missatges genèrics.',
      },
      {
        code: 'EVERGREEN_TEAM',
        title: 'Presenta l\'equip que cuida l\'estada',
        reason: 'Humanitzar el servei incrementa confiança en noves reserves.',
      },
      {
        code: 'EVERGREEN_REPUTATION',
        title: 'Respon i reutilitza una ressenya recent',
        reason: 'La resposta activa i visible millora percepció de servei.',
      },
    ];
  }

  return [
    {
      code: 'EVERGREEN_TEAM',
      title: 'Presenta qui hi ha darrere del negoci',
      reason: 'La proximitat humana facilita confiança i conversió.',
    },
    {
      code: 'EVERGREEN_VALUE',
      title: 'Explica el teu valor diferencial',
      reason: 'Recordar el diferencial ajuda a destacar davant competidors locals.',
    },
    {
      code: 'EVERGREEN_REVIEW',
      title: 'Converteix una ressenya en peça social',
      reason: 'Reaprofitar feedback real crea contingut ràpid i creïble.',
    },
  ];
}

export function buildEvergreenSignals(params: {
  bizId: string;
  orgId: string;
  provider: SignalsProvider;
  vertical: RecommendationVertical;
  limit: number;
  signalDay: string;
}): SignalCard[] {
  const nowIso = new Date().toISOString();
  const pool = buildEvergreenPool(params.vertical);
  return pool.slice(0, Math.max(1, params.limit)).map((item, idx) => {
    const query = new URLSearchParams({
      biz_id: params.bizId,
      signal_id: `evergreen-${params.signalDay}-${idx + 1}`,
    });

    return {
      id: `evergreen-${params.signalDay}-${idx + 1}`,
      org_id: params.orgId,
      biz_id: params.bizId,
      provider: params.provider,
      source: 'evergreen',
      kind: 'opportunity',
      code: item.code,
      severity: 'low',
      severity_score: 20,
      title: item.title,
      reason: item.reason,
      why: item.reason,
      fingerprint: null,
      data: { source: 'evergreen' },
      cta_label: DEFAULT_CTA_LABEL,
      cta_route: `/dashboard/lito/chat?${query.toString()}`,
      cta_url: `/dashboard/lito/chat?${query.toString()}`,
      signal_day: params.signalDay,
      created_at: nowIso,
      updated_at: nowIso,
    };
  });
}

async function loadInsightsRows(params: {
  admin: SupabaseClient;
  bizId: string;
  provider: SignalsProvider;
  sinceDay: string;
  untilDay: string;
}): Promise<InsightDayRow[]> {
  const { data, error } = await params.admin
    .from('biz_insights_daily')
    .select('day, metrics, categories_summary, keywords_top, lang_dist, dominant_lang')
    .eq('biz_id', params.bizId)
    .eq('provider', params.provider)
    .gte('day', params.sinceDay)
    .lte('day', params.untilDay)
    .order('day', { ascending: true });

  if (error) {
    if (isSchemaDependencyError(error)) return [];
    throw new Error(error.message || 'insights_query_failed');
  }

  return (data || []) as InsightDayRow[];
}

async function ensureInsightsCoverage(params: {
  admin: SupabaseClient;
  business: BusinessProfile;
  provider: SignalsProvider;
  signalDay: string;
  rangeDays: number;
  reviews: ReviewRow[];
}): Promise<number> {
  const sinceDay = addDays(params.signalDay, -(params.rangeDays - 1));
  const requiredDays: string[] = [];
  for (let idx = params.rangeDays - 1; idx >= 0; idx -= 1) {
    requiredDays.push(addDays(params.signalDay, -idx));
  }

  const { data: existingData, error: existingErr } = await params.admin
    .from('biz_insights_daily')
    .select('day')
    .eq('biz_id', params.business.id)
    .eq('provider', params.provider)
    .gte('day', sinceDay)
    .lte('day', params.signalDay);

  if (existingErr) {
    if (isSchemaDependencyError(existingErr)) return 0;
    throw new Error(existingErr.message || 'insights_existing_failed');
  }

  const existingDays = new Set((existingData || []).map((row) => String((row as { day?: string }).day || '')));
  const missingDays = requiredDays.filter((day) => !existingDays.has(day));
  if (missingDays.length === 0) return 0;

  const rowsByDay = new Map<string, ReviewRow[]>();
  for (const day of requiredDays) rowsByDay.set(day, []);

  for (const review of params.reviews) {
    const day = toIsoDate(review.created_at);
    if (!rowsByDay.has(day)) continue;
    rowsByDay.get(day)!.push(review);
  }

  const nowIso = new Date().toISOString();
  const upsertRows: Array<Record<string, unknown>> = [];

  for (const day of missingDays) {
    const dayRows = rowsByDay.get(day) || [];
    const ratingRows = dayRows.filter((row) => typeof row.rating === 'number' && Number.isFinite(row.rating));
    const avg = ratingRows.length > 0
      ? Number((ratingRows.reduce((acc, row) => acc + (row.rating || 0), 0) / ratingRows.length).toFixed(3))
      : null;
    const neg = dayRows.filter((row) => isNegativeReview(row)).length;
    const pos = dayRows.filter((row) => isPositiveReview(row)).length;

    const langDist: Record<string, number> = {};
    for (const row of dayRows) {
      const lang = normalizeLang(row.language_detected);
      if (!lang) continue;
      langDist[lang] = (langDist[lang] || 0) + 1;
    }
    const dominant = langDominantFromDist(langDist);

    const topicStats = buildTopicStatsFromReviews(dayRows);
    const categoriesSummary: Record<string, { pos: number; neg: number; neutral: number; total: number }> = {};
    for (const [topic, stats] of Object.entries(topicStats)) {
      categoriesSummary[topic] = {
        pos: stats.pos,
        neg: stats.neg,
        neutral: stats.neutral,
        total: stats.total,
      };
    }

    const keywordsTop = Object.entries(topicStats)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 6)
      .map(([topic]) => topic);

    upsertRows.push({
      org_id: params.business.org_id,
      biz_id: params.business.id,
      provider: params.provider,
      day,
      metrics: {
        new_reviews: dayRows.length,
        avg_rating: avg,
        neg_reviews: neg,
        pos_reviews: pos,
      },
      categories_summary: categoriesSummary,
      keywords_top: keywordsTop.length > 0 ? keywordsTop : null,
      lang_dist: langDist,
      dominant_lang: dominant.dominant,
      updated_at: nowIso,
    });
  }

  if (upsertRows.length === 0) return 0;

  const { error: upsertErr } = await params.admin
    .from('biz_insights_daily')
    .upsert(upsertRows, { onConflict: 'biz_id,provider,day' });

  if (upsertErr) {
    if (isSchemaDependencyError(upsertErr)) return 0;
    throw new Error(upsertErr.message || 'insights_upsert_failed');
  }

  return upsertRows.length;
}

function chooseTopicRecurrent(stats: Record<string, TopicStats>): { topic: string; share: number; neg: number; total: number; reviewIds: string[] } | null {
  let best: { topic: string; share: number; neg: number; total: number; reviewIds: string[] } | null = null;

  for (const [topic, values] of Object.entries(stats)) {
    if (values.total < 3) continue;
    const share = values.total > 0 ? values.neg / values.total : 0;
    if (share < 0.3) continue;

    if (!best || share > best.share || (share === best.share && values.neg > best.neg)) {
      best = {
        topic,
        share: Number(share.toFixed(3)),
        neg: values.neg,
        total: values.total,
        reviewIds: Array.from(values.reviewIds).slice(0, 5),
      };
    }
  }

  return best;
}

function chooseOpportunityTrend(params: {
  current: Record<string, TopicStats>;
  previous: Record<string, TopicStats>;
}): { topic: string; currentPos: number; previousPos: number; growth: number } | null {
  let best: { topic: string; currentPos: number; previousPos: number; growth: number } | null = null;

  for (const [topic, current] of Object.entries(params.current)) {
    const previous = params.previous[topic];
    const prevPos = previous?.pos || 0;
    const currentPos = current.pos || 0;
    if (prevPos <= 0 || currentPos < 3) continue;
    const growth = currentPos / prevPos;
    if (growth < 1.5) continue;
    if (!best || growth > best.growth || (growth === best.growth && currentPos > best.currentPos)) {
      best = {
        topic,
        currentPos,
        previousPos: prevPos,
        growth: Number(growth.toFixed(2)),
      };
    }
  }

  return best;
}

function toComputedSignal(
  signalDay: string,
  payload: Pick<ComputedSignal, 'code' | 'kind' | 'severity' | 'title' | 'reason' | 'data'>,
): ComputedSignal {
  const fingerprint = buildSignalFingerprint({
    code: payload.code,
    kind: payload.kind,
    data: payload.data,
  });
  return {
    ...payload,
    severity_score: SIGNAL_SEVERITY_SCORE[payload.code] || 0,
    why: buildSignalWhy({
      code: payload.code,
      data: payload.data,
    }),
    fingerprint,
    cooldown_until: `${addDays(signalDay, SIGNAL_COOLDOWN_DAYS)}T00:00:00.000Z`,
  };
}

function buildSignals(params: {
  business: BusinessProfile;
  signalDay: string;
  rangeDays: number;
  level: SignalsLevel;
  currentReviews: ReviewRow[];
  previousReviews: ReviewRow[];
  last48hReviews: ReviewRow[];
  silenceReviews: ReviewRow[];
  currentTopicStats: Record<string, TopicStats>;
  previousTopicStats: Record<string, TopicStats>;
  insightsCurrent: InsightDayRow[];
}): ComputedSignal[] {
  const out: ComputedSignal[] = [];
  const baseLang = normalizeLang(params.business.default_language) || 'ca';

  // 1) REPUTATION_LEAK
  const neg48 = params.last48hReviews.filter((row) => isNegativeReview(row));
  const avg7 = averageRating(params.currentReviews);
  const avgPrev7 = averageRating(params.previousReviews);
  const avgDrop = avg7 !== null && avgPrev7 !== null ? Number((avg7 - avgPrev7).toFixed(3)) : null;

  if (neg48.length >= 3 || (avgDrop !== null && avgDrop < -0.2)) {
    const reason = neg48.length >= 3
      ? `${neg48.length} ressenyes negatives en les últimes 48 hores.`
      : `La mitjana de 7 dies ha baixat de ${avgPrev7?.toFixed(1)} a ${avg7?.toFixed(1)}.`;

    out.push(toComputedSignal(params.signalDay, {
      code: 'REPUTATION_LEAK',
      kind: 'alert',
      severity: neg48.length >= 4 ? 'high' : 'med',
      title: buildSignalTitle('REPUTATION_LEAK'),
      reason,
      data: {
        neg_reviews_48h: neg48.length,
        avg_rating_7d: avg7,
        avg_rating_prev_7d: avgPrev7,
        avg_delta: avgDrop,
        review_ids: toSafeReviewIds(neg48),
      },
    }));
  }

  // 2) TOPIC_RECURRENT
  if (signalAllowed(params.level, 'TOPIC_RECURRENT')) {
    let mergedStats = params.currentTopicStats;
    if (Object.keys(mergedStats).length === 0 && params.insightsCurrent.length > 0) {
      for (const row of params.insightsCurrent) {
        mergedStats = mergeTopicStats(mergedStats, parseCategoriesSummary(row.categories_summary));
      }
    }

    const recurrent = chooseTopicRecurrent(mergedStats);
    if (recurrent) {
      out.push(toComputedSignal(params.signalDay, {
        code: 'TOPIC_RECURRENT',
        kind: 'alert',
        severity: recurrent.share >= 0.5 || recurrent.neg >= 4 ? 'high' : 'med',
        title: buildSignalTitle('TOPIC_RECURRENT'),
        reason: `El tema "${recurrent.topic}" concentra ${Math.round(recurrent.share * 100)}% de mencions negatives aquesta setmana.`,
        data: {
          topic: recurrent.topic,
          neg_count: recurrent.neg,
          total_mentions: recurrent.total,
          neg_share: recurrent.share,
          review_ids: recurrent.reviewIds,
        },
      }));
    }
  }

  // 3) LANGUAGE_SHIFT
  if (signalAllowed(params.level, 'LANGUAGE_SHIFT')) {
    const currentLangDist: Record<string, number> = {};
    for (const row of params.currentReviews) {
      const lang = normalizeLang(row.language_detected);
      if (!lang) continue;
      currentLangDist[lang] = (currentLangDist[lang] || 0) + 1;
    }

    if (Object.keys(currentLangDist).length === 0 && params.insightsCurrent.length > 0) {
      for (const insight of params.insightsCurrent) {
        const langDist = parseLangDist(insight.lang_dist);
        for (const [lang, count] of Object.entries(langDist)) {
          currentLangDist[lang] = (currentLangDist[lang] || 0) + count;
        }
      }
    }

    const dominant = langDominantFromDist(currentLangDist);
    if (dominant.dominant && dominant.dominant !== baseLang && dominant.share >= 0.2) {
      out.push(toComputedSignal(params.signalDay, {
        code: 'LANGUAGE_SHIFT',
        kind: 'alert',
        severity: dominant.share >= 0.5 ? 'med' : 'low',
        title: buildSignalTitle('LANGUAGE_SHIFT'),
        reason: `Idioma dominant detectat: ${dominant.dominant.toUpperCase()} (${Math.round(dominant.share * 100)}% de les ressenyes recents).`,
        data: {
          dominant_lang: dominant.dominant,
          dominant_share: dominant.share,
          default_language: baseLang,
          total_reviews: dominant.total,
        },
      }));
    }
  }

  // 4) VIP_REVIEW
  if (signalAllowed(params.level, 'VIP_REVIEW')) {
    const sortedCurrent = [...params.currentReviews].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    const vip = sortedCurrent.find((row) => isVipReview(row));
    if (vip) {
      const author = vip.author_name?.trim() || 'Client destacat';
      out.push(toComputedSignal(params.signalDay, {
        code: 'VIP_REVIEW',
        kind: 'opportunity',
        severity: 'med',
        title: buildSignalTitle('VIP_REVIEW'),
        reason: `S'ha detectat una ressenya 5★ rellevant de ${author}.`,
        data: {
          review_id: vip.id,
          author_name: vip.author_name,
          rating: vip.rating,
          created_at: vip.created_at,
        },
      }));
    }
  }

  // 5) DIGITAL_SILENCE
  if (signalAllowed(params.level, 'DIGITAL_SILENCE')) {
    if (params.silenceReviews.length === 0) {
      let daysWithoutReviews = 10;
      const latestCurrent = [...params.currentReviews, ...params.previousReviews]
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
      if (latestCurrent?.created_at) {
        const latestDay = toIsoDate(latestCurrent.created_at);
        if (latestDay) {
          daysWithoutReviews = Math.max(10, diffDays(latestDay, params.signalDay));
        }
      }

      out.push(toComputedSignal(params.signalDay, {
        code: 'DIGITAL_SILENCE',
        kind: 'alert',
        severity: 'med',
        title: buildSignalTitle('DIGITAL_SILENCE'),
        reason: `No hi ha ressenyes noves des de fa ${daysWithoutReviews} dies.`,
        data: {
          days_without_reviews: daysWithoutReviews,
          lookback_days: 10,
        },
      }));
    }
  }

  // 6) OPPORTUNITY_TREND (full)
  if (signalAllowed(params.level, 'OPPORTUNITY_TREND')) {
    const trend = chooseOpportunityTrend({
      current: params.currentTopicStats,
      previous: params.previousTopicStats,
    });
    if (trend) {
      out.push(toComputedSignal(params.signalDay, {
        code: 'OPPORTUNITY_TREND',
        kind: 'opportunity',
        severity: trend.growth >= 2 ? 'high' : 'med',
        title: buildSignalTitle('OPPORTUNITY_TREND'),
        reason: `El tema "${trend.topic}" creix en positiu (+${Math.round((trend.growth - 1) * 100)}%).`,
        data: {
          topic: trend.topic,
          current_positive: trend.currentPos,
          previous_positive: trend.previousPos,
          growth_ratio: trend.growth,
        },
      }));
    }
  }

  return out.filter((signal) => signalAllowed(params.level, signal.code));
}

async function fetchReviewWindow(params: {
  admin: SupabaseClient;
  bizId: string;
  sinceIso: string;
  untilIso: string;
}): Promise<ReviewRow[]> {
  const { data, error } = await params.admin
    .from('reviews')
    .select('id, rating, sentiment, review_text, language_detected, author_name, metadata, source, created_at')
    .eq('biz_id', params.bizId)
    .in('source', GOOGLE_SOURCES as unknown as string[])
    .gte('created_at', params.sinceIso)
    .lt('created_at', params.untilIso)
    .order('created_at', { ascending: false })
    .limit(4000);

  if (error) throw new Error(error.message || 'reviews_query_failed');
  const rows = (data || []) as ReviewRow[];
  return rows.filter((row) => includesGoogleSource(row.source));
}

function toBizSignalRows(params: {
  business: BusinessProfile;
  provider: SignalsProvider;
  signalDay: string;
  signals: ComputedSignal[];
}): Array<Record<string, unknown>> {
  const nowIso = new Date().toISOString();
  return params.signals.map((signal) => ({
    org_id: params.business.org_id,
    biz_id: params.business.id,
    provider: params.provider,
    code: signal.code,
    kind: signal.kind,
    severity: signal.severity,
    severity_score: signal.severity_score,
    title: signal.title,
    reason: signal.reason,
    why: signal.why,
    fingerprint: signal.fingerprint,
    cooldown_until: signal.cooldown_until,
    data: signal.data,
    is_active: true,
    signal_day: params.signalDay,
    updated_at: nowIso,
  }));
}

async function fetchRecentSignalFingerprints(params: {
  admin: SupabaseClient;
  bizId: string;
  provider: SignalsProvider;
  sinceIso: string;
}): Promise<Set<string>> {
  const { data, error } = await params.admin
    .from('biz_signals')
    .select('kind, fingerprint')
    .eq('biz_id', params.bizId)
    .eq('provider', params.provider)
    .eq('is_active', true)
    .gte('created_at', params.sinceIso)
    .not('fingerprint', 'is', null);

  if (error) {
    if (isSchemaDependencyError(error)) return new Set();
    throw new Error(error.message || 'biz_signals_recent_fingerprints_failed');
  }

  const keys = new Set<string>();
  for (const row of (data || []) as Array<{ kind?: string | null; fingerprint?: string | null }>) {
    const kind = String(row.kind || '').trim();
    const fingerprint = String(row.fingerprint || '').trim();
    if (!kind || !fingerprint) continue;
    keys.add(`${kind}::${fingerprint}`);
  }
  return keys;
}

async function fetchActiveRowsForDay(params: {
  admin: SupabaseClient;
  bizId: string;
  provider: SignalsProvider;
  signalDay: string;
}): Promise<BizSignalRow[]> {
  const { data, error } = await params.admin
    .from('biz_signals')
    .select('id, org_id, biz_id, provider, code, kind, severity, severity_score, title, reason, why, fingerprint, cooldown_until, data, is_active, signal_day, created_at, updated_at')
    .eq('biz_id', params.bizId)
    .eq('provider', params.provider)
    .eq('signal_day', params.signalDay)
    .eq('is_active', true);

  if (error) {
    if (isSchemaDependencyError(error)) return [];
    throw new Error(error.message || 'biz_signals_active_query_failed');
  }

  return (data || []) as BizSignalRow[];
}

export async function runSignalsForBusiness(params: RunParams): Promise<RunResult> {
  const signalDay = normalizeDateInput(params.signalDay);
  const rangeDays = Math.max(1, Math.min(params.rangeDays, 30));
  const lookbackDays = Math.max(rangeDays * 2, 14, 10);
  const sinceDay = addDays(signalDay, -(lookbackDays - 1));
  const untilDayExclusive = addDays(signalDay, 1);

  const reviews = await fetchReviewWindow({
    admin: params.admin,
    bizId: params.business.id,
    sinceIso: dayStartIso(sinceDay),
    untilIso: dayStartIso(untilDayExclusive),
  });

  await ensureInsightsCoverage({
    admin: params.admin,
    business: params.business,
    provider: params.provider,
    signalDay,
    rangeDays,
    reviews,
  });

  const insightsCurrent = await loadInsightsRows({
    admin: params.admin,
    bizId: params.business.id,
    provider: params.provider,
    sinceDay: addDays(signalDay, -(rangeDays - 1)),
    untilDay: signalDay,
  });

  const windows = buildCurrentAndPreviousWindows({
    rows: reviews,
    signalDay,
    rangeDays,
  });

  const currentTopicStats = buildTopicStatsFromReviews(windows.current);
  const previousTopicStats = buildTopicStatsFromReviews(windows.previous);

  const computedSignals = buildSignals({
    business: params.business,
    signalDay,
    rangeDays,
    level: params.signalsLevel,
    currentReviews: windows.current,
    previousReviews: windows.previous,
    last48hReviews: windows.last48h,
    silenceReviews: windows.silenceWindow,
    currentTopicStats,
    previousTopicStats,
    insightsCurrent,
  });

  const cooldownSinceIso = new Date(Date.now() - (SIGNAL_COOLDOWN_DAYS * 86400000)).toISOString();
  const recentFingerprints = await fetchRecentSignalFingerprints({
    admin: params.admin,
    bizId: params.business.id,
    provider: params.provider,
    sinceIso: cooldownSinceIso,
  });

  const dedupedSignals = computedSignals.filter((signal) => {
    const dedupKey = `${signal.kind}::${signal.fingerprint}`;
    if (recentFingerprints.has(dedupKey)) return false;
    recentFingerprints.add(dedupKey);
    return true;
  });

  const rowsToUpsert = toBizSignalRows({
    business: params.business,
    provider: params.provider,
    signalDay,
    signals: dedupedSignals,
  });

  if (rowsToUpsert.length > 0) {
    const { error: upsertErr } = await params.admin
      .from('biz_signals')
      .upsert(rowsToUpsert, { onConflict: 'biz_id,code,signal_day' });

    if (upsertErr) {
      throw new Error(upsertErr.message || 'biz_signals_upsert_failed');
    }
  }

  const { data: existingData, error: existingErr } = await params.admin
    .from('biz_signals')
    .select('id, code, is_active')
    .eq('biz_id', params.business.id)
    .eq('provider', params.provider)
    .eq('signal_day', signalDay);

  if (existingErr) {
    throw new Error(existingErr.message || 'biz_signals_existing_failed');
  }

  const activeCodes = new Set(computedSignals.map((signal) => signal.code));
  const deactivateIds = ((existingData || []) as Array<{ id: string; code: string; is_active: boolean }>)
    .filter((row) => row.is_active && !activeCodes.has(row.code as SignalCode))
    .map((row) => row.id);

  if (deactivateIds.length > 0) {
    const { error: deactivateErr } = await params.admin
      .from('biz_signals')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .in('id', deactivateIds);

    if (deactivateErr) {
      throw new Error(deactivateErr.message || 'biz_signals_deactivate_failed');
    }
  }

  const activeRows = await fetchActiveRowsForDay({
    admin: params.admin,
    bizId: params.business.id,
    provider: params.provider,
    signalDay,
  });

  return {
    processed: dedupedSignals.length,
    active: activeRows.length,
    deactivated: deactivateIds.length,
    signals: activeRows,
    signal_day: signalDay,
  };
}

export async function listSignalsForBusiness(params: {
  admin: SupabaseClient;
  bizId: string;
  provider: SignalsProvider;
  sinceDay: string;
  limit: number;
}): Promise<BizSignalRow[]> {
  const { data, error } = await params.admin
    .from('biz_signals')
    .select('id, org_id, biz_id, provider, code, kind, severity, severity_score, title, reason, why, fingerprint, cooldown_until, data, is_active, signal_day, created_at, updated_at')
    .eq('biz_id', params.bizId)
    .eq('provider', params.provider)
    .eq('is_active', true)
    .gte('signal_day', params.sinceDay)
    .order('signal_day', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(Math.max(1, Math.min(params.limit, 30)));

  if (error) {
    if (isSchemaDependencyError(error)) return [];
    throw new Error(error.message || 'biz_signals_list_failed');
  }

  return (data || []) as BizSignalRow[];
}

export async function getSignalById(params: {
  admin: SupabaseClient;
  signalId: string;
  bizId: string;
}): Promise<BizSignalRow | null> {
  const { data, error } = await params.admin
    .from('biz_signals')
    .select('id, org_id, biz_id, provider, code, kind, severity, severity_score, title, reason, why, fingerprint, cooldown_until, data, is_active, signal_day, created_at, updated_at')
    .eq('id', params.signalId)
    .eq('biz_id', params.bizId)
    .maybeSingle();

  if (error) {
    if (isSchemaDependencyError(error)) return null;
    throw new Error(error.message || 'biz_signal_get_failed');
  }

  return (data as BizSignalRow | null) || null;
}

export function toSignalCards(params: {
  rows: BizSignalRow[];
  bizId: string;
  level?: SignalsLevel;
}): SignalCard[] {
  return [...params.rows]
    .map((row) => toSignalCard({ row, bizId: params.bizId }))
    .sort(sortSignalsPriority);
}

export function pickTopSignals(cards: SignalCard[], limit = 3): SignalCard[] {
  const safeLimit = Math.max(1, Math.min(limit, 10));
  const sorted = [...cards].sort(sortSignalsPriority);
  const alerts = sorted.filter((card) => card.kind === 'alert');
  const opportunities = sorted.filter((card) => card.kind === 'opportunity');
  const picked: SignalCard[] = [];
  const seen = new Set<string>();

  const pushIfNew = (card: SignalCard | undefined): void => {
    if (!card || seen.has(card.id) || picked.length >= safeLimit) return;
    picked.push(card);
    seen.add(card.id);
  };

  pushIfNew(alerts[0]);

  for (const card of opportunities) {
    if (picked.length >= safeLimit) break;
    pushIfNew(card);
  }

  if (picked.length < safeLimit) {
    for (const card of alerts.slice(1)) {
      if (picked.length >= safeLimit) break;
      pushIfNew(card);
    }
  }

  return picked.slice(0, safeLimit);
}

export function resolveVertical(type: string | null | undefined): RecommendationVertical {
  return mapBusinessTypeToVertical(type);
}

export async function listBusinessesWithActiveGoogleIntegration(params: {
  admin: SupabaseClient;
}): Promise<Array<{ biz_id: string; org_id: string }>> {
  const { data, error } = await params.admin
    .from('integrations')
    .select('biz_id, org_id')
    .eq('provider', 'google_business')
    .eq('is_active', true)
    .not('biz_id', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(2000);

  if (error) throw new Error(error.message || 'active_integrations_query_failed');

  const unique = new Map<string, { biz_id: string; org_id: string }>();
  for (const row of (data || []) as Array<{ biz_id?: string | null; org_id?: string | null }>) {
    if (!row.biz_id || !row.org_id) continue;
    if (!unique.has(row.biz_id)) unique.set(row.biz_id, { biz_id: row.biz_id, org_id: row.org_id });
  }
  return Array.from(unique.values());
}
