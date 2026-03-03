export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireBizAccessPatternB } from '@/lib/api-handler';
import { toLitoMemberRole } from '@/lib/ai/lito-rbac';
import { resolveLitoCopyStatus } from '@/lib/ai/copy-status';
import { resolveProvider } from '@/lib/ai/provider';
import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { validateQuery } from '@/lib/validations';

const QuerySchema = z.object({
  biz_id: z.string().uuid(),
});

type BusinessStatusRow = {
  id: string;
  org_id: string;
};

type OrganizationStatusRow = {
  id: string;
  ai_provider: string | null;
  lito_staff_ai_paused: boolean | null;
};

function withStandardHeaders(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('x-request-id', requestId);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export async function GET(request: Request) {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'GET /api/lito/copy/status' });

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
    const payload = query as z.infer<typeof QuerySchema>;
    const gate = await requireBizAccessPatternB(request, payload.biz_id, {
      supabase,
      user,
      queryBizId: payload.biz_id,
    });
    if (gate instanceof NextResponse) return withStandardHeaders(gate, requestId);

    const memberRole = toLitoMemberRole(gate.role);
    if (!memberRole) {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    const admin = createAdminClient();
    const { data: businessData, error: businessErr } = await admin
      .from('businesses')
      .select('id, org_id')
      .eq('id', gate.bizId)
      .maybeSingle();

    if (businessErr || !businessData) {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    const business = businessData as BusinessStatusRow;
    const { data: orgData, error: orgErr } = await admin
      .from('organizations')
      .select('id, ai_provider, lito_staff_ai_paused')
      .eq('id', business.org_id)
      .maybeSingle();

    if (orgErr || !orgData) {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    const organization = orgData as OrganizationStatusRow;
    const providerState = resolveProvider({
      orgProvider: organization.ai_provider ?? null,
    });
    const status = resolveLitoCopyStatus({
      providerState,
      paused: memberRole === 'staff' && Boolean(organization.lito_staff_ai_paused),
    });

    return withStandardHeaders(
      NextResponse.json({
        enabled: status.enabled,
        reason: status.reason,
        provider: status.provider,
        request_id: requestId,
      }),
      requestId,
    );
  } catch (error) {
    log.error('lito_copy_status_unhandled', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withStandardHeaders(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}
