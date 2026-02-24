import type { SupabaseClient } from '@supabase/supabase-js';

export type OnboardingLanguage = 'ca' | 'es' | 'en';

export interface OnboardingState {
  step: number;
  completed: boolean;
  dismissed: boolean;
  hasReviews: boolean;
  hasSuggestions: boolean;
  hasAssets: boolean;
  hasPlannerItems: boolean;
}

interface OnboardingBusinessLike {
  language?: unknown;
  locale?: unknown;
  default_language?: unknown;
}

interface OnboardingOrgLike {
  locale?: unknown;
}

interface OnboardingProgressRow {
  step: number | null;
  completed: boolean | null;
  dismissed: boolean | null;
}

function asLanguage(value: unknown): OnboardingLanguage | null {
  if (value === 'ca' || value === 'es' || value === 'en') return value;
  return null;
}

function normalizeStep(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1;
  const step = Math.round(value);
  if (step < 1 || step > 4) return 1;
  return step;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  return fallback;
}

function hasAtLeastOneRow(data: unknown, error: unknown): boolean {
  if (error) return false;
  if (!Array.isArray(data)) return false;
  return data.length > 0;
}

export function resolveOnboardingLanguage(args: {
  bodyLanguage?: unknown;
  business?: OnboardingBusinessLike | null;
  org?: OnboardingOrgLike | null;
}): OnboardingLanguage {
  const candidates: unknown[] = [
    args.bodyLanguage,
    args.business?.language,
    args.business?.locale,
    args.business?.default_language,
    args.org?.locale,
  ];

  for (const candidate of candidates) {
    const language = asLanguage(candidate);
    if (language) return language;
  }

  return 'ca';
}

export async function getOnboardingState(
  supabase: SupabaseClient,
  businessId: string,
): Promise<OnboardingState> {
  let progress: OnboardingProgressRow = {
    step: 1,
    completed: false,
    dismissed: false,
  };

  const { data: progressData, error: progressError } = await supabase
    .from('onboarding_progress')
    .select('step, completed, dismissed')
    .eq('business_id', businessId)
    .maybeSingle();

  if (!progressError && progressData) {
    progress = progressData as OnboardingProgressRow;
  } else if (!progressError && !progressData) {
    const { data: createdData, error: createError } = await supabase
      .from('onboarding_progress')
      .upsert(
        {
          business_id: businessId,
          step: 1,
          completed: false,
          dismissed: false,
        },
        { onConflict: 'business_id' },
      )
      .select('step, completed, dismissed')
      .maybeSingle();

    if (!createError && createdData) {
      progress = createdData as OnboardingProgressRow;
    }
  }

  const [
    reviewsResult,
    suggestionsResult,
    assetsResult,
    plannerResult,
  ] = await Promise.all([
    supabase
      .from('reviews')
      .select('id')
      .eq('biz_id', businessId)
      .limit(1),
    supabase
      .from('content_suggestions')
      .select('id')
      .eq('business_id', businessId)
      .limit(1),
    supabase
      .from('content_assets')
      .select('id')
      .eq('business_id', businessId)
      .limit(1),
    supabase
      .from('content_planner_items')
      .select('id')
      .eq('business_id', businessId)
      .limit(1),
  ]);

  return {
    step: normalizeStep(progress.step),
    completed: normalizeBoolean(progress.completed, false),
    dismissed: normalizeBoolean(progress.dismissed, false),
    hasReviews: hasAtLeastOneRow(reviewsResult.data, reviewsResult.error),
    hasSuggestions: hasAtLeastOneRow(suggestionsResult.data, suggestionsResult.error),
    hasAssets: hasAtLeastOneRow(assetsResult.data, assetsResult.error),
    hasPlannerItems: hasAtLeastOneRow(plannerResult.data, plannerResult.error),
  };
}
