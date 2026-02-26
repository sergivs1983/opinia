export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { validateCsrf } from '@/lib/security/csrf';

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createLogger, createRequestId } from '@/lib/logger';
import {
  validateBody,
  ContentStudioXGenerateSchema,
} from '@/lib/validations';
import {
  extractDifferentiators,
  generateStudioTextVariants,
  resolveStudioLanguage,
  type StudioLanguage,
  type StudioPlatform,
  type StudioTone,
} from '@/lib/content-studio';
import type { Business, ContentSuggestion } from '@/types/database';
import type { JsonValue } from '@/types/json';
import { rateLimitAI, checkDailyAIQuota } from '@/lib/security/ratelimit';

interface XGenerateBody {
  suggestionId: string;
  platform: StudioPlatform;
  language?: StudioLanguage;
  tone: StudioTone;
}

type SuggestionTextRow = Pick<ContentSuggestion,
  'id' | 'business_id' | 'insight_id' | 'language' | 'title' | 'hook' |
  'caption' | 'cta' | 'best_time' | 'shot_list' | 'hashtags' | 'evidence'>;

type BusinessTextRow = Pick<Business, 'id' | 'default_language'>;

interface InsightThemesRow {
  themes: JsonValue | null;
}

export async function POST(request: Request) {
  const blocked = validateCsrf(request); if (blocked) return blocked;

  const requestId = request.headers.get('x-request-id')?.trim() || createRequestId();
  const log = createLogger({ request_id: requestId, route: '/api/content-studio/x-generate' });

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

    const [body, bodyErr] = await validateBody(request, ContentStudioXGenerateSchema);
    if (bodyErr) return withResponseRequestId(bodyErr);

    const payload = body as XGenerateBody;

    const { data: suggestionData, error: suggestionError } = await supabase
      .from('content_suggestions')
      .select('id, business_id, insight_id, language, title, hook, caption, cta, best_time, shot_list, hashtags, evidence')
      .eq('id', payload.suggestionId)
      .single();

    if (suggestionError || !suggestionData) {
      return withResponseRequestId(NextResponse.json({ error: 'not_found', message: 'Suggestion not found' }, { status: 404 }));
    }

    const suggestion = suggestionData as SuggestionTextRow;
    const workspaceBusinessId = request.headers.get('x-biz-id')?.trim();

    if (workspaceBusinessId && workspaceBusinessId !== suggestion.business_id) {
      return withResponseRequestId(
        NextResponse.json({ error: 'forbidden', message: 'Suggestion does not belong to current workspace' }, { status: 403 }),
      );
    }

    // ── Bloc 8: Rate limit + AI daily quota ──
    const rlKey = `${suggestion.business_id}:${user.id}`;
    const rl = await rateLimitAI(rlKey);
    if (!rl.ok) return withResponseRequestId(rl.res);
    const quota = await checkDailyAIQuota(suggestion.business_id, 'free');
    if (!quota.ok) return withResponseRequestId(quota.res);

    const { data: businessData, error: businessError } = await supabase
      .from('businesses')
      .select('id, default_language')
      .eq('id', suggestion.business_id)
      .single();

    if (businessError || !businessData) {
      return withResponseRequestId(NextResponse.json({ error: 'forbidden', message: 'No access to this business' }, { status: 403 }));
    }

    const business = businessData as BusinessTextRow;
    const language = resolveStudioLanguage({
      requestedLanguage: payload.language,
      suggestionLanguage: suggestion.language,
      businessLanguage: business.default_language,
    });

    let differentiators: string[] = [];
    if (suggestion.insight_id) {
      const { data: insightData } = await supabase
        .from('content_insights')
        .select('themes')
        .eq('id', suggestion.insight_id)
        .maybeSingle();

      if (insightData) {
        differentiators = extractDifferentiators((insightData as InsightThemesRow).themes);
      }
    }

    const variants = generateStudioTextVariants({
      platform: payload.platform,
      language,
      tone: payload.tone,
      suggestion,
      differentiators,
    });

    const { error: postSaveError } = await supabase
      .from('content_text_posts')
      .insert({
        business_id: business.id,
        suggestion_id: suggestion.id,
        language,
        platform: payload.platform,
        variants,
      });

    if (postSaveError) {
      log.warn('Content text post persistence skipped', { error: postSaveError.message });
    }

    return withResponseRequestId(NextResponse.json({ variants, request_id: requestId }));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown';
    log.error('Unhandled content studio text generation error', { error: message });

    return withResponseRequestId(
      NextResponse.json(
        { error: 'internal_error', message: 'Error intern del servidor', request_id: requestId },
        { status: 500 },
      ),
    );
  }
}
