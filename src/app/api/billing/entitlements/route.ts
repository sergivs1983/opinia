export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getAcceptedOrgMembership } from '@/lib/authz';
import { getOrgEntitlements } from '@/lib/billing/entitlements';
import { getDraftUsage } from '@/lib/ai/quota';
import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { validateQuery } from '@/lib/validations';

const QuerySchema = z.object({
  org_id: z.string().uuid(),
});

function withStandardHeaders(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('x-request-id', requestId);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export async function GET(request: Request) {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'GET /api/billing/entitlements' });

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
    const { org_id: orgId } = query;

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

    const [entitlements, usage] = await Promise.all([
      getOrgEntitlements({ supabase, orgId }),
      getDraftUsage(supabase, orgId),
    ]);

    return withStandardHeaders(
      NextResponse.json({
        ok: true,
        org_id: orgId,
        plan_code: entitlements.plan_code,
        entitlements,
        usage: usage || {
          used: 0,
          limit: entitlements.lito_drafts_limit,
          remaining: Math.max(entitlements.lito_drafts_limit, 0),
          month: new Date().toISOString().slice(0, 7) + '-01',
        },
        request_id: requestId,
      }),
      requestId,
    );
  } catch (error) {
    log.error('billing_entitlements_unhandled', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withStandardHeaders(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}
