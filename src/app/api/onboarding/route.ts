import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createLogger, createRequestId } from '@/lib/logger';
import {
  validateBody,
  OnboardingPatchSchema,
} from '@/lib/validations';
import {
  getOnboardingState,
  resolveOnboardingLanguage,
  type OnboardingLanguage,
} from '@/lib/onboarding';

interface OnboardingPatchBody {
  step?: number;
  completed?: boolean;
  dismissed?: boolean;
}

interface BusinessRow {
  id: string;
  org_id: string;
  language?: string | null;
  locale?: string | null;
  default_language?: string | null;
}

interface OrgRow {
  locale?: string | null;
}

export async function GET(request: Request) {
  const requestId = request.headers.get('x-request-id')?.trim() || createRequestId();
  const log = createLogger({ request_id: requestId, route: '/api/onboarding' });

  const withResponseRequestId = (response: NextResponse) => {
    response.headers.set('x-request-id', requestId);
    return response;
  };

  try {
    const supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return withResponseRequestId(
        NextResponse.json({ error: 'unauthorized', message: 'Auth required', request_id: requestId }, { status: 401 }),
      );
    }

    const businessId = request.headers.get('x-biz-id')?.trim();
    if (!businessId) {
      return withResponseRequestId(
        NextResponse.json(
          { error: 'validation_error', message: 'Missing x-biz-id workspace header', request_id: requestId },
          { status: 400 },
        ),
      );
    }

    const { data: businessData, error: businessError } = await supabase
      .from('businesses')
      .select('*')
      .eq('id', businessId)
      .single();

    if (businessError || !businessData) {
      return withResponseRequestId(
        NextResponse.json({ error: 'forbidden', message: 'No access to this business', request_id: requestId }, { status: 403 }),
      );
    }

    const business = businessData as BusinessRow;

    const { data: orgData } = await supabase
      .from('organizations')
      .select('locale')
      .eq('id', business.org_id)
      .maybeSingle();

    const org = (orgData || null) as OrgRow | null;

    const state = await getOnboardingState(supabase, businessId);
    const language: OnboardingLanguage = resolveOnboardingLanguage({
      business,
      org,
    });

    return withResponseRequestId(
      NextResponse.json({
        ...state,
        language,
        request_id: requestId,
      }),
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown';
    log.error('Unhandled onboarding GET error', { error: message });
    return withResponseRequestId(
      NextResponse.json(
        { error: 'internal_error', message: 'Error intern del servidor', request_id: requestId },
        { status: 500 },
      ),
    );
  }
}

export async function PATCH(request: Request) {
  const requestId = request.headers.get('x-request-id')?.trim() || createRequestId();
  const log = createLogger({ request_id: requestId, route: '/api/onboarding' });

  const withResponseRequestId = (response: NextResponse) => {
    response.headers.set('x-request-id', requestId);
    return response;
  };

  try {
    const supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return withResponseRequestId(
        NextResponse.json({ error: 'unauthorized', message: 'Auth required', request_id: requestId }, { status: 401 }),
      );
    }

    const businessId = request.headers.get('x-biz-id')?.trim();
    if (!businessId) {
      return withResponseRequestId(
        NextResponse.json(
          { error: 'validation_error', message: 'Missing x-biz-id workspace header', request_id: requestId },
          { status: 400 },
        ),
      );
    }

    const [body, bodyErr] = await validateBody(request, OnboardingPatchSchema);
    if (bodyErr) return withResponseRequestId(bodyErr);
    const payload = body as OnboardingPatchBody;

    const { data: businessAccess, error: businessAccessError } = await supabase
      .from('businesses')
      .select('id')
      .eq('id', businessId)
      .single();

    if (businessAccessError || !businessAccess) {
      return withResponseRequestId(
        NextResponse.json({ error: 'forbidden', message: 'No access to this business', request_id: requestId }, { status: 403 }),
      );
    }

    const updatePayload: Record<string, unknown> = {
      business_id: businessId,
      last_seen_at: new Date().toISOString(),
    };

    if (payload.step !== undefined) updatePayload.step = payload.step;
    if (payload.completed !== undefined) updatePayload.completed = payload.completed;
    if (payload.dismissed !== undefined) updatePayload.dismissed = payload.dismissed;

    const { data: progressData, error: progressError } = await supabase
      .from('onboarding_progress')
      .upsert(updatePayload, { onConflict: 'business_id' })
      .select('business_id, step, completed, dismissed, last_seen_at, created_at, updated_at')
      .single();

    if (progressError || !progressData) {
      log.error('Failed to update onboarding progress', {
        error: progressError?.message || 'unknown',
        business_id: businessId,
      });
      return withResponseRequestId(
        NextResponse.json(
          { error: 'db_error', message: 'Failed to update onboarding progress', request_id: requestId },
          { status: 500 },
        ),
      );
    }

    return withResponseRequestId(
      NextResponse.json({ progress: progressData, request_id: requestId }),
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown';
    log.error('Unhandled onboarding PATCH error', { error: message });
    return withResponseRequestId(
      NextResponse.json(
        { error: 'internal_error', message: 'Error intern del servidor', request_id: requestId },
        { status: 500 },
      ),
    );
  }
}
