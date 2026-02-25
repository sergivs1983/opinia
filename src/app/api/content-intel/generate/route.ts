export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createLogger, createRequestId } from '@/lib/logger';
import { callLLMClient } from '@/lib/llm/client';
import type { LLMProvider } from '@/lib/llm/provider';
import { requireBizAccess } from '@/lib/api-handler';
import {
  validateBody,
  ContentIntelGenerateSchema,
} from '@/lib/validations';
import {
  parseJsonResponse,
  getWeekRange,
  resolveContentIntelLanguage,
  normalizeInsightPayload,
  buildFallbackInsight,
  normalizeSuggestions,
  buildFallbackSuggestions,
  type ContentInsightPayload,
  type ContentIntelLanguage,
  type ContentSuggestionDraft,
  type ReviewForContentIntel,
} from '@/lib/content-intel';
import type { Business } from '@/types/database';

interface GenerateRequestBody {
  businessId: string;
  weekStart: string;
  platforms: Array<'google' | 'tripadvisor'>;
  maxReviews: number;
  language?: ContentIntelLanguage;
}

interface InsightDbRow {
  id: string;
}

interface SuggestionDbRow {
  id: string;
  insight_id: string;
  business_id: string;
  language: ContentIntelLanguage;
  type: 'reel' | 'story' | 'post';
  title: string | null;
  hook: string | null;
  shot_list: unknown;
  caption: string | null;
  cta: string | null;
  best_time: string | null;
  hashtags: string[];
  evidence: unknown;
  status: 'draft' | 'approved' | 'published';
  created_at: string;
}

interface ProfileLocaleRow {
  locale: string | null;
}

interface OrgLocaleRow {
  locale: string | null;
}

type BusinessIntelRow = Pick<Business,
  'id' | 'org_id' | 'name' | 'type' | 'default_language' | 'formality' |
  'ai_instructions' | 'tone_keywords_positive' | 'tone_keywords_negative' |
  'default_signature' | 'city'
> & {
  llm_provider?: LLMProvider | null;
  language?: string | null;
  locale?: string | null;
};

type ThemesOnlyPayload = Omit<ContentInsightPayload, 'derived_business_profile'>;

const MAX_PROMPT_REVIEWS = 120;

function summarizeReviewsForPrompt(reviews: ReviewForContentIntel[]): string {
  return reviews
    .slice(0, MAX_PROMPT_REVIEWS)
    .map((review) => {
      const cleanedText = review.review_text.replace(/\s+/g, ' ').trim();
      return `[${review.id}] ${review.rating}★ (${review.source}) "${cleanedText.slice(0, 320)}"`;
    })
    .join('\n');
}

function buildThemesPrompt(args: {
  business: BusinessIntelRow;
  language: ContentIntelLanguage;
  reviews: ReviewForContentIntel[];
  kbFacts: string[];
}): string {
  const kbBlock = args.kbFacts.length > 0
    ? args.kbFacts.slice(0, 8).map((fact, idx) => `- ${idx + 1}. ${fact}`).join('\n')
    : '- (no additional business memory)';

  return `Target language: ${args.language}
Business: ${args.business.name}
Business type hint: ${args.business.type}
City: ${args.business.city || 'unknown'}
Formality: ${args.business.formality}

Business memory:
${kbBlock}

Reviews (trusted evidence source):
${summarizeReviewsForPrompt(args.reviews)}

Return ONLY JSON with this shape:
{
  "top_themes": [{ "theme": "", "mentions": 1, "keywords": [""] }],
  "differentiators": [""],
  "complaints": [""],
  "audience_signals": [""],
  "derived_business_profile": {
    "business_type_guess": "restaurant|hotel|clinic|retail|services|other",
    "audience_guess": "couples|families|tourists|locals|business|mixed",
    "peak_times_guess": ["midday", "afternoon", "evening"],
    "content_angles": ["behind the scenes", "before/after", "experience"]
  }
}
Rules:
- top_themes max 8
- mentions must be numeric
- differentiators must be concrete (avoid generic labels)
- complaints should summarize recurrent friction points
- Do not include markdown.`;
}

function buildSuggestionsPrompt(args: {
  language: ContentIntelLanguage;
  business: BusinessIntelRow;
  reviews: ReviewForContentIntel[];
  themes: ThemesOnlyPayload;
  profile: ContentInsightPayload['derived_business_profile'];
}): string {
  return `Target language for all text fields: ${args.language}
Business: ${args.business.name}

Themes JSON:
${JSON.stringify(args.themes)}

Derived profile JSON:
${JSON.stringify(args.profile)}

Reviews (evidence source):
${summarizeReviewsForPrompt(args.reviews)}

Return ONLY a JSON array with exactly 3 objects. Each object must follow:
{
  "type": "reel|story|post",
  "title": "",
  "hook_0_3s": "",
  "shot_list": ["", "", ""],
  "caption": "2-4 lines",
  "cta": "",
  "best_time": "",
  "hashtags": ["#..."],
  "evidence": [{"review_id":"<id>","quote":"exact substring from review text"}]
}
Rules:
- Every idea must be tied to 1-2 differentiators from Themes JSON.
- Evidence quote MUST be exact text from one review.
- best_time should be in target language.
- Avoid generic filler language.
- Do not include markdown.`;
}

export async function POST(request: Request) {
  let requestId = request.headers.get('x-request-id')?.trim() || createRequestId();
  let log = createLogger({ request_id: requestId, route: '/api/content-intel/generate' });

  const withResponseRequestId = (response: NextResponse) => {
    response.headers.set('x-request-id', requestId);
    return response;
  };

  try {
    const supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return withResponseRequestId(NextResponse.json({ error: 'unauthorized', message: 'Auth required' }, { status: 401 }));
    }

    const [body, validationErr] = await validateBody(request, ContentIntelGenerateSchema);
    if (validationErr) return withResponseRequestId(validationErr);

    const payload = body as GenerateRequestBody;

    const { data: businessData, error: businessError } = await supabase
      .from('businesses')
      .select('id, org_id, name, type, default_language, formality, ai_instructions, tone_keywords_positive, tone_keywords_negative, default_signature, city, llm_provider')
      .eq('id', payload.businessId)
      .single();

    if (businessError || !businessData) {
      return withResponseRequestId(NextResponse.json({ error: 'not_found', message: 'Business not found' }, { status: 404 }));
    }

    // ── Biz-level guard ──────────────────────────────────────────────────────
    const bizGuard = await requireBizAccess({ supabase, userId: user.id, bizId: payload.businessId });
    if (bizGuard) return withResponseRequestId(bizGuard);

    const business = businessData as BusinessIntelRow;

    const { data: profileData } = await supabase
      .from('profiles')
      .select('locale')
      .eq('id', user.id)
      .maybeSingle();

    const profileLocale = (profileData as ProfileLocaleRow | null)?.locale;

    let orgLocale: string | null = null;
    const orgLocaleQuery = await supabase
      .from('organizations')
      .select('locale')
      .eq('id', business.org_id)
      .maybeSingle();

    if (!orgLocaleQuery.error) {
      orgLocale = (orgLocaleQuery.data as OrgLocaleRow | null)?.locale || null;
    }

    const language = resolveContentIntelLanguage({
      requestedLanguage: payload.language,
      business,
      orgLocale: orgLocale || profileLocale,
    });

    const { from, to } = getWeekRange(payload.weekStart);
    const maxReviews = Math.min(payload.maxReviews, 200);

    let reviewQuery = supabase
      .from('reviews')
      .select('id, source, review_text, rating, review_date, created_at')
      .eq('biz_id', payload.businessId)
      .gte('review_date', from)
      .lt('review_date', to)
      .order('review_date', { ascending: false })
      .limit(maxReviews);

    if (payload.platforms.length > 0) {
      reviewQuery = reviewQuery.in('source', payload.platforms);
    }

    const { data: weekReviews, error: reviewError } = await reviewQuery;
    if (reviewError) {
      log.error('Failed to load weekly reviews', { error: reviewError.message });
      return withResponseRequestId(NextResponse.json({ error: 'db_error', message: 'Failed to load reviews' }, { status: 500 }));
    }

    let reviews = (weekReviews || []) as ReviewForContentIntel[];

    if (reviews.length === 0) {
      let fallbackQuery = supabase
        .from('reviews')
        .select('id, source, review_text, rating, review_date, created_at')
        .eq('biz_id', payload.businessId)
        .gte('created_at', from)
        .lt('created_at', to)
        .order('created_at', { ascending: false })
        .limit(maxReviews);

      if (payload.platforms.length > 0) {
        fallbackQuery = fallbackQuery.in('source', payload.platforms);
      }

      const { data: createdAtReviews } = await fallbackQuery;
      reviews = (createdAtReviews || []) as ReviewForContentIntel[];
    }

    if (reviews.length === 0) {
      return withResponseRequestId(
        NextResponse.json(
          { error: 'no_reviews', message: 'No reviews found for selected week and platforms.', request_id: requestId },
          { status: 404 },
        ),
      );
    }

    const { data: kbData } = await supabase
      .from('knowledge_base_entries')
      .select('category, content')
      .eq('biz_id', payload.businessId)
      .limit(12);

    const kbFacts = (kbData || [])
      .map((item) => `${String(item.category || 'general')}: ${String(item.content || '')}`.trim())
      .filter((item) => item.length > 0);

    const llmProvider: LLMProvider = business.llm_provider || 'openai';
    const hasApiKey = llmProvider === 'anthropic'
      ? !!process.env.ANTHROPIC_API_KEY
      : !!process.env.OPENAI_API_KEY;

    const fallbackInsight = buildFallbackInsight({
      language,
      reviews,
      businessType: business.type,
    });

    let insight = fallbackInsight;

    if (hasApiKey) {
      try {
        const themesResponse = await callLLMClient({
          provider: llmProvider,
          orgId: business.org_id,
          bizId: business.id,
          requestId,
          feature: 'content_intel_themes',
          userId: user.id,
          critical: true,
          dlqPayload: {
            business_id: business.id,
            week_start: payload.weekStart,
            language,
            platforms: payload.platforms,
            step: 'themes',
          },
          temperature: 0.3,
          maxTokens: 1200,
          json: true,
          messages: [
            {
              role: 'system',
              content: 'You are a content strategist. Use only provided review evidence. Output only JSON.',
            },
            {
              role: 'user',
              content: buildThemesPrompt({
                business,
                language,
                reviews,
                kbFacts,
              }),
            },
          ],
        });

        const parsedThemes = parseJsonResponse<Record<string, unknown>>(themesResponse.content);
        insight = normalizeInsightPayload({
          raw: parsedThemes,
          language,
          reviews,
          businessType: business.type,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown';
        log.warn('Themes LLM failed; using fallback', { error: message });
      }
    }

    let suggestions: ContentSuggestionDraft[] = buildFallbackSuggestions({
      language,
      reviews,
      differentiators: insight.differentiators,
      peakTimesGuess: insight.derived_business_profile.peak_times_guess,
      contentAngles: insight.derived_business_profile.content_angles,
    });

    if (hasApiKey) {
      try {
        const suggestionResponse = await callLLMClient({
          provider: llmProvider,
          orgId: business.org_id,
          bizId: business.id,
          requestId,
          feature: 'content_intel_suggestions',
          userId: user.id,
          critical: true,
          dlqPayload: {
            business_id: business.id,
            week_start: payload.weekStart,
            language,
            platforms: payload.platforms,
            step: 'suggestions',
          },
          temperature: 0.6,
          maxTokens: 1800,
          json: true,
          messages: [
            {
              role: 'system',
              content: 'You are a social content strategist. Return only strict JSON and only use the evidence provided.',
            },
            {
              role: 'user',
              content: buildSuggestionsPrompt({
                language,
                business,
                reviews,
                themes: {
                  top_themes: insight.top_themes,
                  differentiators: insight.differentiators,
                  complaints: insight.complaints,
                  audience_signals: insight.audience_signals,
                },
                profile: insight.derived_business_profile,
              }),
            },
          ],
        });

        const parsedSuggestions = parseJsonResponse<unknown[]>(suggestionResponse.content);
        suggestions = normalizeSuggestions({
          raw: parsedSuggestions,
          options: {
            language,
            reviews,
            differentiators: insight.differentiators,
            peakTimesGuess: insight.derived_business_profile.peak_times_guess,
          },
          contentAngles: insight.derived_business_profile.content_angles,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown';
        log.warn('Suggestions LLM failed; using fallback', { error: message });
      }
    }

    const sourcePlatforms = Array.from(new Set(reviews.map((review) => review.source))).slice(0, 10);

    const { data: insightRow, error: insightSaveError } = await supabase
      .from('content_insights')
      .upsert({
        business_id: business.id,
        week_start: payload.weekStart,
        source_platforms: sourcePlatforms,
        language,
        themes: {
          top_themes: insight.top_themes,
          differentiators: insight.differentiators,
          complaints: insight.complaints,
          audience_signals: insight.audience_signals,
        },
        derived_business_profile: insight.derived_business_profile,
      }, { onConflict: 'business_id,week_start,language' })
      .select('id')
      .single();

    if (insightSaveError || !insightRow) {
      log.error('Failed to persist content insight', { error: insightSaveError?.message || 'unknown' });
      return withResponseRequestId(
        NextResponse.json(
          { error: 'db_error', message: 'Failed to persist content insight', request_id: requestId },
          { status: 500 },
        ),
      );
    }

    const savedInsight = insightRow as InsightDbRow;

    await supabase
      .from('content_suggestions')
      .delete()
      .eq('insight_id', savedInsight.id);

    const rowsToInsert = suggestions.slice(0, 3).map((suggestion) => ({
      insight_id: savedInsight.id,
      business_id: business.id,
      language,
      type: suggestion.type,
      title: suggestion.title,
      hook: suggestion.hook,
      shot_list: suggestion.shot_list,
      caption: suggestion.caption,
      cta: suggestion.cta,
      best_time: suggestion.best_time,
      hashtags: suggestion.hashtags,
      evidence: suggestion.evidence,
      status: 'draft' as const,
    }));

    const { data: suggestionRows, error: suggestionSaveError } = await supabase
      .from('content_suggestions')
      .insert(rowsToInsert)
      .select('id, insight_id, business_id, language, type, title, hook, shot_list, caption, cta, best_time, hashtags, evidence, status, created_at');

    if (suggestionSaveError) {
      log.error('Failed to persist content suggestions', { error: suggestionSaveError.message });
      return withResponseRequestId(
        NextResponse.json(
          { error: 'db_error', message: 'Failed to persist content suggestions', request_id: requestId },
          { status: 500 },
        ),
      );
    }

    const suggestionsResponse = (suggestionRows || []) as SuggestionDbRow[];

    log.info('Content intelligence generated', {
      business_id: business.id,
      week_start: payload.weekStart,
      language,
      reviews_used: reviews.length,
      suggestions: suggestionsResponse.length,
    });

    return withResponseRequestId(
      NextResponse.json({
        insightId: savedInsight.id,
        language,
        insight: {
          id: savedInsight.id,
          week_start: payload.weekStart,
          source_platforms: sourcePlatforms,
          themes: {
            top_themes: insight.top_themes,
            differentiators: insight.differentiators,
            complaints: insight.complaints,
            audience_signals: insight.audience_signals,
          },
          derived_business_profile: insight.derived_business_profile,
        },
        suggestions: suggestionsResponse,
        request_id: requestId,
      }),
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown';
    log.error('Content intelligence generation failed', { error: message });

    return withResponseRequestId(
      NextResponse.json(
        { error: 'internal_error', message: 'Error intern del servidor', request_id: requestId },
        { status: 500 },
      ),
    );
  }
}
