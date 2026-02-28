/**
 * D1.3 Signals PRO — selector library
 *
 * Reads biz_insights_daily rollup rows and generates prioritised signal cards
 * for the Sala de Comandaments (/dashboard/lito).
 *
 * Priority:
 *   A) Alerts (defensive):  reputation_drop | inactivity | language_shift
 *   B) Opportunities:       high_avg
 *   C) Cold-start evergreen (fallback when no strong signals)
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// ── Public types ───────────────────────────────────────────────────────────────

export type SignalType = 'alert' | 'opportunity' | 'evergreen';
export type SignalSeverity = 'high' | 'med' | 'low';

export type SignalCard = {
  id: string;
  type: SignalType;
  title: string;
  reason: string;
  severity: SignalSeverity;
  cta_label: string;
  action: {
    kind: 'open_thread';
    recommendation_id?: string;
  };
};

type GetSignalsParams = {
  supabase: SupabaseClient;
  biz_id: string;
  provider?: string;
  days?: number;
};

// ── Internal row types ─────────────────────────────────────────────────────────

type InsightRow = {
  day: string;
  metrics: {
    new_reviews?: number | null;
    avg_rating?: number | null;
    neg_reviews?: number | null;
    pos_reviews?: number | null;
  } | null;
  dominant_lang?: string | null;
};

type BusinessRow = {
  default_language?: string | null;
  type?: string | null;
};

// ── Main export ────────────────────────────────────────────────────────────────

/**
 * Returns 3..5 signal cards for the given business and week.
 * Always returns at least 3 evergreen cards as cold-start fallback.
 */
export async function getSignalsForWeek({
  supabase,
  biz_id,
  provider = 'google_business',
  days = 7,
}: GetSignalsParams): Promise<SignalCard[]> {
  // ── Load business metadata ─────────────────────────────────────────────────
  const { data: bizData } = await supabase
    .from('businesses')
    .select('default_language, type')
    .eq('id', biz_id)
    .maybeSingle();

  const biz = bizData as BusinessRow | null;
  const defaultLang = (biz?.default_language || 'ca').toLowerCase().trim();
  const vertical = (biz?.type || 'general').toLowerCase().trim();

  // ── Load last N days of rollup rows ────────────────────────────────────────
  const sinceDate = new Date();
  sinceDate.setUTCDate(sinceDate.getUTCDate() - days);
  const sinceIso = sinceDate.toISOString().slice(0, 10);

  const { data: rowsData } = await supabase
    .from('biz_insights_daily')
    .select('day, metrics, dominant_lang')
    .eq('biz_id', biz_id)
    .eq('provider', provider)
    .gte('day', sinceIso)
    .order('day', { ascending: false });

  const rows = (rowsData || []) as InsightRow[];

  const signals: SignalCard[] = [];

  // ── A1) reputation_drop: neg_reviews >= 3 in last 2 days ──────────────────
  const last2 = rows.slice(0, 2);
  const negIn2Days = last2.reduce((sum, r) => sum + (r.metrics?.neg_reviews ?? 0), 0);
  if (negIn2Days >= 3) {
    signals.push({
      id: 'reputation_drop',
      type: 'alert',
      title: 'Caiguda de reputació',
      reason: `${negIn2Days} ressenyes negatives en els últims 2 dies.`,
      severity: 'high',
      cta_label: 'Gestionar a LITO',
      action: { kind: 'open_thread' },
    });
  }

  // ── A2) inactivity: sum(new_reviews) = 0 in last 10 days ──────────────────
  const last10 = rows.slice(0, 10);
  const totalLast10 = last10.reduce((sum, r) => sum + (r.metrics?.new_reviews ?? 0), 0);
  // No rollup rows = same as no reviews (treat as inactivity)
  if (last10.length === 0 || totalLast10 === 0) {
    signals.push({
      id: 'inactivity',
      type: 'alert',
      title: 'Sense activitat',
      reason:
        last10.length === 0
          ? 'No s\'han registrat ressenyes en els últims 10 dies.'
          : 'Cap ressenya nova en els últims 10 dies.',
      severity: 'med',
      cta_label: 'Activar a LITO',
      action: { kind: 'open_thread' },
    });
  }

  // ── A3) language_shift: dominant_lang != business.default_language ─────────
  const latestWithReviews = rows.find((r) => (r.metrics?.new_reviews ?? 0) > 0);
  if (latestWithReviews?.dominant_lang) {
    const dominantNorm = latestWithReviews.dominant_lang.toLowerCase().trim();
    if (dominantNorm && dominantNorm !== 'und' && dominantNorm !== defaultLang) {
      signals.push({
        id: 'language_shift',
        type: 'alert',
        title: 'Canvi d\'idioma detectat',
        reason: `Les últimes ressenyes arriben en ${latestWithReviews.dominant_lang} (esperat: ${defaultLang}).`,
        severity: 'low',
        cta_label: 'Adaptar resposta',
        action: { kind: 'open_thread' },
      });
    }
  }

  // ── B1) high_avg: avg_rating >= 4.6 and new_reviews >= 3 (week) ───────────
  let weightedRatingSum = 0;
  let weightedRatingCount = 0;
  let totalNewWeek = 0;

  for (const row of rows) {
    const n = row.metrics?.new_reviews ?? 0;
    const avg = row.metrics?.avg_rating ?? null;
    totalNewWeek += n;
    if (avg !== null && n > 0) {
      weightedRatingSum += avg * n;
      weightedRatingCount += n;
    }
  }

  const weekAvg = weightedRatingCount > 0 ? weightedRatingSum / weightedRatingCount : 0;
  if (weekAvg >= 4.6 && totalNewWeek >= 3) {
    signals.push({
      id: 'high_avg',
      type: 'opportunity',
      title: 'Puntuació excel·lent',
      reason: `Valoració mitjana de ${weekAvg.toFixed(1)} amb ${totalNewWeek} ressenyes aquesta setmana.`,
      severity: 'low',
      cta_label: 'Aprofitar a LITO',
      action: { kind: 'open_thread' },
    });
  }

  // ── C) Cold-start evergreen (pad to at least 3 cards) ─────────────────────
  if (signals.length < 3) {
    const pool = EVERGREEN_POOL[vertical] ?? EVERGREEN_POOL['general'];
    for (const card of pool) {
      if (signals.length >= 5) break;
      // Avoid duplicating ids
      if (!signals.some((s) => s.id === card.id)) {
        signals.push(card);
      }
    }
  }

  return signals.slice(0, 5);
}

// ── Evergreen pool ─────────────────────────────────────────────────────────────

const EVERGREEN_POOL: Record<string, SignalCard[]> = {
  restaurant: [
    {
      id: 'eg_restaurant_menu',
      type: 'evergreen',
      title: 'Destaca el menú del dia',
      reason: 'Publicar l\'oferta gastronòmica millora la visibilitat local a Google.',
      severity: 'low',
      cta_label: 'Crear contingut',
      action: { kind: 'open_thread' },
    },
    {
      id: 'eg_restaurant_specialty',
      type: 'evergreen',
      title: 'Promou els teus especialitats',
      reason: 'Les publicacions sobre plats únics generen més interacció orgànica.',
      severity: 'low',
      cta_label: 'Crear contingut',
      action: { kind: 'open_thread' },
    },
    {
      id: 'eg_restaurant_reviews',
      type: 'evergreen',
      title: 'Respon les últimes ressenyes',
      reason: 'Respondre ressenyes millora el posicionament local i la reputació.',
      severity: 'low',
      cta_label: 'Gestionar a LITO',
      action: { kind: 'open_thread' },
    },
  ],
  hotel: [
    {
      id: 'eg_hotel_experience',
      type: 'evergreen',
      title: 'Destaca l\'experiència d\'hostatjament',
      reason: 'El contingut sobre serveis únics augmenta les reserves directes.',
      severity: 'low',
      cta_label: 'Crear contingut',
      action: { kind: 'open_thread' },
    },
    {
      id: 'eg_hotel_reviews',
      type: 'evergreen',
      title: 'Respon les ressenyes recents',
      reason: 'Els hostes valoren la resposta ràpida i millora el rànquing TripAdvisor.',
      severity: 'low',
      cta_label: 'Gestionar a LITO',
      action: { kind: 'open_thread' },
    },
    {
      id: 'eg_hotel_team',
      type: 'evergreen',
      title: 'Presenta el teu equip',
      reason: 'El contingut d\'equip humanitza la marca i genera confiança.',
      severity: 'low',
      cta_label: 'Crear contingut',
      action: { kind: 'open_thread' },
    },
  ],
  general: [
    {
      id: 'eg_general_team',
      type: 'evergreen',
      title: 'Presenta el teu equip',
      reason: 'El contingut d\'equip humanitza la marca i genera confiança.',
      severity: 'low',
      cta_label: 'Crear contingut',
      action: { kind: 'open_thread' },
    },
    {
      id: 'eg_general_success',
      type: 'evergreen',
      title: 'Comparteix una historia d\'èxit',
      reason: 'Els casos d\'èxit reals inspiren confiança en nous clients.',
      severity: 'low',
      cta_label: 'Crear contingut',
      action: { kind: 'open_thread' },
    },
    {
      id: 'eg_general_reviews',
      type: 'evergreen',
      title: 'Respon les últimes ressenyes',
      reason: 'Respondre ressenyes millora el posicionament local i la reputació.',
      severity: 'low',
      cta_label: 'Gestionar a LITO',
      action: { kind: 'open_thread' },
    },
  ],
};
