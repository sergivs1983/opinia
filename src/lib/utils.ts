import type { Sentiment, ReplyTone, ReplyStatus, ReviewSource } from '@/types/database';

export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

type TranslateFn = (key: string, vars?: Record<string, string | number>) => string;

function translateOrFallback(
  translate: TranslateFn | undefined,
  key: string,
  fallback: string,
  vars?: Record<string, string | number>,
): string {
  if (!translate) return fallback;
  const translated = translate(key, vars);
  return translated === key ? fallback : translated;
}

function intlLocale(locale: string = 'ca'): string {
  if (locale === 'es') return 'es-ES';
  if (locale === 'en') return 'en-US';
  return 'ca-ES';
}

// --- Sentiment ---
export function ratingToSentiment(rating: number): Sentiment {
  if (rating <= 2) return 'negative';
  if (rating === 3) return 'neutral';
  return 'positive';
}

export function sentimentEmoji(s: Sentiment): string {
  return { positive: '😊', neutral: '😐', negative: '😞' }[s];
}

export function sentimentLabel(s: Sentiment, translate?: TranslateFn): string {
  if (s === 'positive') return translateOrFallback(translate, 'common.sentiment.positive', 'Positiva');
  if (s === 'neutral') return translateOrFallback(translate, 'common.sentiment.neutral', 'Neutra');
  return translateOrFallback(translate, 'common.sentiment.negative', 'Negativa');
}

export function sentimentColor(s: Sentiment): string {
  return {
    positive: 'text-emerald-300 bg-emerald-500/18 border border-emerald-300/35',
    neutral: 'text-amber-300 bg-amber-500/18 border border-amber-300/35',
    negative: 'text-red-300 bg-red-500/18 border border-red-300/35',
  }[s];
}

export function sentimentDot(s: Sentiment): string {
  return { positive: 'bg-emerald-500', neutral: 'bg-amber-500', negative: 'bg-red-500' }[s];
}

// --- Tone ---
export function toneLabel(tone: ReplyTone, translate?: TranslateFn): string {
  if (tone === 'proper') return translateOrFallback(translate, 'common.tones.proper.label', 'Proper');
  if (tone === 'professional') return translateOrFallback(translate, 'common.tones.professional.label', 'Professional');
  return translateOrFallback(translate, 'common.tones.premium.label', 'Premium');
}

export function toneDescription(tone: ReplyTone, translate?: TranslateFn): string {
  if (tone === 'proper') return translateOrFallback(translate, 'common.tones.proper.description', 'Empàtic i proper');
  if (tone === 'professional') return translateOrFallback(translate, 'common.tones.professional.description', 'Clar i formal');
  return translateOrFallback(translate, 'common.tones.premium.description', 'Elegant i distingit');
}

export function toneIcon(t: ReplyTone): string {
  return { proper: '💛', professional: '📋', premium: '✨' }[t];
}

export function toneBg(t: ReplyTone): string {
  return {
    proper: 'border-amber-300/35 bg-gradient-to-br from-amber-500/18 to-orange-500/12',
    professional: 'border-cyan-300/35 bg-gradient-to-br from-cyan-500/18 to-slate-500/12',
    premium: 'border-emerald-300/35 bg-gradient-to-br from-emerald-500/18 to-teal-500/12',
  }[t];
}

export function toneBadge(t: ReplyTone): string {
  return {
    proper: 'bg-amber-500/18 text-amber-300 border border-amber-300/35',
    professional: 'bg-cyan-500/18 text-cyan-300 border border-cyan-300/35',
    premium: 'bg-emerald-500/18 text-emerald-300 border border-emerald-300/35',
  }[t];
}

// --- Status ---
export function statusLabel(status: ReplyStatus, translate?: TranslateFn): string {
  if (status === 'draft') return translateOrFallback(translate, 'common.replyStatus.draft', 'Esborrany');
  if (status === 'selected') return translateOrFallback(translate, 'common.replyStatus.selected', 'Seleccionat');
  if (status === 'published') return translateOrFallback(translate, 'common.replyStatus.published', 'Publicat');
  return translateOrFallback(translate, 'common.replyStatus.archived', 'Arxivat');
}

export function statusColor(s: ReplyStatus): string {
  return {
    draft: 'text-white/70 bg-white/8 border border-white/14',
    selected: 'text-emerald-300 bg-brand-accent/18 border border-brand-accent/35',
    published: 'text-emerald-300 bg-emerald-500/18 border border-emerald-300/35',
    archived: 'text-white/55 bg-white/5 border border-white/10',
  }[s];
}

// --- Source ---
export function sourceLabel(source: ReviewSource, translate?: TranslateFn): string {
  if (source === 'google') return translateOrFallback(translate, 'common.platforms.google', 'Google');
  if (source === 'tripadvisor') return translateOrFallback(translate, 'common.platforms.tripadvisor', 'TripAdvisor');
  if (source === 'booking') return translateOrFallback(translate, 'common.platforms.booking', 'Booking');
  if (source === 'manual') return translateOrFallback(translate, 'common.platforms.manual', 'Manual');
  return translateOrFallback(translate, 'common.platforms.other', 'Altre');
}

export function sourceIcon(s: ReviewSource): string {
  return { google: '🔵', tripadvisor: '🟢', booking: '🔷', manual: '✏️', other: '📎' }[s];
}

// --- Format ---
export function formatDate(d: string, locale: string = 'ca'): string {
  return new Date(d).toLocaleDateString(intlLocale(locale), { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(d: string, locale: string = 'ca'): string {
  return new Date(d).toLocaleDateString(intlLocale(locale), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function timeAgo(d: string, translate?: TranslateFn, locale: string = 'ca'): string {
  const now = Date.now();
  const diff = now - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return translateOrFallback(translate, 'common.time.justNow', 'ara');
  if (mins < 60) return translateOrFallback(translate, 'common.time.minutesAgo', `fa ${mins} min`, { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return translateOrFallback(translate, 'common.time.hoursAgo', `fa ${hours} h`, { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return translateOrFallback(translate, 'common.time.daysAgo', `fa ${days} d`, { count: days });
  return formatDate(d, locale);
}

export function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + '…';
}

export function starsString(rating: number): string {
  return '★'.repeat(rating) + '☆'.repeat(5 - rating);
}

// --- Workspace persistence ---
const WS_KEY = 'opinia_workspace';

export function saveWorkspace(orgId: string, bizId: string) {
  try { localStorage.setItem(WS_KEY, JSON.stringify({ orgId, bizId })); } catch {}
}

export function loadWorkspace(): { orgId: string; bizId: string } | null {
  try {
    const raw = localStorage.getItem(WS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
