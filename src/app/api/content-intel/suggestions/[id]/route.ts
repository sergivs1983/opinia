export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createLogger, createRequestId } from '@/lib/logger';
import { requireBizAccessPatternB } from '@/lib/api-handler';
import {
  validateBody,
  validateParams,
  ContentSuggestionPatchSchema,
  ContentSuggestionParamsSchema,
} from '@/lib/validations';

type SuggestionRow = {
  id: string;
  business_id: string;
  status: 'draft' | 'approved' | 'published';
};

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const requestId = request.headers.get('x-request-id')?.trim() || createRequestId();
  const log = createLogger({ request_id: requestId, route: '/api/content-intel/suggestions/[id]' });

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

    const [routeParams, paramsErr] = validateParams(params, ContentSuggestionParamsSchema);
    if (paramsErr) return withResponseRequestId(paramsErr);

    const [body, bodyErr] = await validateBody(request, ContentSuggestionPatchSchema);
    if (bodyErr) return withResponseRequestId(bodyErr);

    const { data: suggestionData, error: suggestionError } = await supabase
      .from('content_suggestions')
      .select('id, business_id, status')
      .eq('id', routeParams.id)
      .single();

    if (suggestionError || !suggestionData) {
      return withResponseRequestId(NextResponse.json({ error: 'not_found', message: 'Suggestion not found' }, { status: 404 }));
    }

    const suggestion = suggestionData as SuggestionRow;

    // ── Patró B: cross-tenant → 404 (no filtrar existència) ──────────────
    const bizGuard = await requireBizAccessPatternB({ supabase, userId: user.id, bizId: suggestion.business_id });
    if (bizGuard) return withResponseRequestId(bizGuard);

    const { data: updatedData, error: updateError } = await supabase
      .from('content_suggestions')
      .update({ status: body.status })
      .eq('id', routeParams.id)
      .select('id, insight_id, business_id, language, type, title, hook, shot_list, caption, cta, best_time, hashtags, evidence, status, created_at')
      .single();

    if (updateError || !updatedData) {
      log.error('Failed to update content suggestion status', { error: updateError?.message || 'unknown' });
      return withResponseRequestId(NextResponse.json({ error: 'db_error', message: 'Failed to update suggestion' }, { status: 500 }));
    }

    return withResponseRequestId(NextResponse.json({ suggestion: updatedData, request_id: requestId }));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown';
    log.error('Unhandled content suggestion update error', { error: message });
    return withResponseRequestId(
      NextResponse.json(
        { error: 'internal_error', message: 'Error intern del servidor', request_id: requestId },
        { status: 500 },
      ),
    );
  }
}
