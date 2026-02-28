'use client';

import type { LitoRecommendationItem, LitoThreadItem } from '@/components/lito/types';

type FormatKey = 'post' | 'story' | 'reel';

function normalizeFormat(value: string | null | undefined): FormatKey {
  if (value === 'story' || value === 'reel') return value;
  return 'post';
}

function parseFromThreadTitle(title: string | null | undefined): { format?: FormatKey; hook?: string } {
  if (!title) return {};
  const trimmed = title.trim();
  if (!trimmed) return {};

  const withFormat = trimmed.match(/^LITO\s*[—-]\s*(Post|Story|Reel)\s*:\s*(.+)$/i);
  if (withFormat) {
    return {
      format: normalizeFormat(withFormat[1]?.toLowerCase()),
      hook: withFormat[2]?.trim() || undefined,
    };
  }

  return {};
}

export function buildFallbackRecommendation(params: {
  thread: LitoThreadItem | null;
  recommendationId: string;
  selectedFormat: FormatKey;
  defaultTitle: string;
}): LitoRecommendationItem {
  const parsed = parseFromThreadTitle(params.thread?.title);
  const format = parsed.format || params.selectedFormat;
  const hook = parsed.hook || params.defaultTitle;

  return {
    id: params.recommendationId,
    rule_id: `thread:${params.recommendationId}`,
    status: 'shown',
    format,
    hook,
    idea: '',
    cta: '',
    recommendation_template: {
      format,
      hook,
      idea: '',
      cta: '',
      assets_needed: [],
    },
  };
}
