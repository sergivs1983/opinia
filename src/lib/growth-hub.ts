import type { JsonValue } from '@/types/json';
import type { ContentSuggestion } from '@/types/database';

export type ThemeSentiment = 'positive' | 'neutral' | 'negative';

export interface GrowthHubTheme {
  theme: string;
  mentions: number;
  sentiment?: ThemeSentiment;
}

export interface GrowthHubThemesPayload {
  top_themes: GrowthHubTheme[];
  differentiators: string[];
  complaints: string[];
}

export interface GrowthHubStrongPoint {
  theme: string;
  mentions: number;
}

export interface GrowthHubOpportunity {
  theme: string;
  mentions: number;
  complaint: string | null;
  hasOpportunity: boolean;
}

export interface GrowthPlannerItem {
  id: string;
  when: string;
  title: string;
  status: 'pending' | 'published';
}

export const GROWTH_NO_DATA_THEME = '__growth_no_data__';
export const GROWTH_NO_RECURRING_ISSUES_THEME = '__growth_no_recurring_issues__';

function normalize(text: string): string {
  return text.toLowerCase().trim();
}

function scoreMatch(theme: string, query: string): number {
  const themeNorm = normalize(theme);
  const queryNorm = normalize(query);
  if (!themeNorm || !queryNorm) return 0;
  if (themeNorm === queryNorm) return 100;
  if (themeNorm.includes(queryNorm) || queryNorm.includes(themeNorm)) return 80;

  const words = queryNorm.split(/\s+/).filter(Boolean);
  let score = 0;
  for (const word of words) {
    if (word.length < 3) continue;
    if (themeNorm.includes(word)) score += 10;
  }
  return score;
}

function asThemeList(payload: GrowthHubThemesPayload): GrowthHubTheme[] {
  return Array.isArray(payload.top_themes)
    ? payload.top_themes
        .map((theme) => ({
          theme: (theme.theme || '').trim(),
          mentions: Number.isFinite(theme.mentions) ? Math.max(0, Math.round(theme.mentions)) : 0,
          sentiment: theme.sentiment,
        }))
        .filter((theme) => theme.theme.length > 0)
    : [];
}

function pickThemeForText(themes: GrowthHubTheme[], text: string): GrowthHubTheme | null {
  const ranked = themes
    .map((theme) => ({ theme, score: scoreMatch(theme.theme, text) }))
    .sort((a, b) => b.score - a.score || b.theme.mentions - a.theme.mentions);

  return ranked[0]?.score > 0 ? ranked[0].theme : null;
}

export function pickStrongPoint(payload: GrowthHubThemesPayload): GrowthHubStrongPoint {
  const themes = asThemeList(payload);
  const differentiators = (payload.differentiators || []).map((d) => d.trim()).filter(Boolean);

  if (differentiators.length > 0) {
    const source = differentiators[0];
    const match = pickThemeForText(themes, source);
    return {
      theme: source,
      mentions: match?.mentions || themes[0]?.mentions || 0,
    };
  }

  const positives = themes
    .filter((theme) => theme.sentiment === 'positive')
    .sort((a, b) => b.mentions - a.mentions);

  if (positives.length > 0) {
    return {
      theme: positives[0].theme,
      mentions: positives[0].mentions,
    };
  }

  if (themes.length > 0) {
    const sorted = [...themes].sort((a, b) => b.mentions - a.mentions);
    return {
      theme: sorted[0].theme,
      mentions: sorted[0].mentions,
    };
  }

  return {
    theme: GROWTH_NO_DATA_THEME,
    mentions: 0,
  };
}

export function pickOpportunity(payload: GrowthHubThemesPayload): GrowthHubOpportunity {
  const themes = asThemeList(payload);
  const complaints = (payload.complaints || []).map((c) => c.trim()).filter(Boolean);

  if (complaints.length === 0) {
    return {
      theme: GROWTH_NO_RECURRING_ISSUES_THEME,
      mentions: 0,
      complaint: null,
      hasOpportunity: false,
    };
  }

  const complaint = complaints[0];
  const matchedTheme = pickThemeForText(themes, complaint);
  const fallbackNegative = themes
    .filter((theme) => theme.sentiment === 'negative')
    .sort((a, b) => b.mentions - a.mentions)[0];

  const selectedTheme = matchedTheme || fallbackNegative;

  return {
    theme: selectedTheme?.theme || complaint,
    mentions: selectedTheme?.mentions || 1,
    complaint,
    hasOpportunity: true,
  };
}

function asEvidenceQuotes(value: JsonValue): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return '';
      const quote = (item as { quote?: unknown }).quote;
      return typeof quote === 'string' ? quote.trim() : '';
    })
    .filter((quote) => quote.length > 0);
}

export function extractPrimaryEvidenceQuote(suggestions: ContentSuggestion[]): string | null {
  for (const suggestion of suggestions) {
    const quotes = asEvidenceQuotes(suggestion.evidence);
    if (quotes.length > 0) return quotes[0];
  }
  return null;
}

export function buildPlannerItems(suggestions: ContentSuggestion[]): GrowthPlannerItem[] {
  return suggestions.slice(0, 3).map((suggestion) => ({
    id: suggestion.id,
    when: suggestion.best_time || '-',
    title: suggestion.title || 'Idea de contingut',
    status: suggestion.status === 'published' ? 'published' : 'pending',
  }));
}
