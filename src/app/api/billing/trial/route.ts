export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getAcceptedOrgMembership } from '@/lib/authz';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { createLogger } from '@/lib/logger';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import {
  enforceTrialQuota,
  getTrialDraftCap,
  getTrialState,
  getTrialUsedEstimate,
  type TrialOrgRow,
} from '@/lib/billing/trial';
import { validateQuery } from '@/lib/validations';

const QuerySchema = z.object({
  org_id: z.string().uuid(),
});

type OrganizationTrialRow = {
  id: string;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  trial_state: string | null;
  trial_plan_code: string | null;
};

function withStandardHeaders(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('x-request-id', requestId);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export async function GET(request: Request) {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'GET /api/billing/trial' });

  try {
    const supabase = createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return withStandardHeaders(
        NextResponse.json({ error: 'unauthorized', message: 'Auth required', request_id: requestId }, { status: 401 }),
        requestId,
      );
    }

    const [query, queryErr] = validateQuery(request, QuerySchema);
    if (queryErr) return withStandardHeaders(queryErr, requestId);
    const orgId = query.org_id;

    const membership = await getAcceptedOrgMembership({
      supabase,
      userId: user.id,
      orgId,
    });

    if (!membership) {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    const { data: orgData, error: orgErr } = await supabase
      .from('organizations')
      .select('id, trial_started_at, trial_ends_at, trial_state, trial_plan_code')
      .eq('id', orgId)
      .maybeSingle();

    if (orgErr || !orgData) {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    const organization = orgData as OrganizationTrialRow;
    const trial = getTrialState(organization as TrialOrgRow);
    const cap = getTrialDraftCap(trial);
    const usedEstimate = await getTrialUsedEstimate({
      supabase,
      orgId,
    });

    const capCheck = await enforceTrialQuota({
      supabase,
      orgId,
      trial,
      inc: 1,
    });

    return withStandardHeaders(
      NextResponse.json({
        ok: true,
        org_id: orgId,
        trial_state: trial.state,
        trial_started_at: trial.started_at,
        trial_ends_at: trial.ends_at,
        days_left: trial.remaining_days,
        trial_plan_code: trial.plan_code,
        cap,
        used_estimate: usedEstimate,
        remaining_estimate: cap ? Math.max(cap - usedEstimate, 0) : null,
        can_consume_one: capCheck.ok,
        request_id: requestId,
      }),
      requestId,
    );
  } catch (error) {
    log.error('billing_trial_unhandled', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withStandardHeaders(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}
