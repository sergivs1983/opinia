export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { validateCsrf } from '@/lib/security/csrf';

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createRequestId } from '@/lib/logger';
import { requireBizAccessPatternB } from '@/lib/api-handler';
import { validateBody } from '@/lib/validations';
import { WorkspaceActiveOrgSchema } from '@/lib/validations';

export async function POST(request: Request) {
  const blocked = validateCsrf(request); if (blocked) return blocked;

  const requestId = request.headers.get('x-request-id')?.trim() || createRequestId();
  const withRequestId = (response: NextResponse) => {
    response.headers.set('x-request-id', requestId);
    return response;
  };

  try {
    const supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return withRequestId(
        NextResponse.json({ error: 'unauthorized', message: 'Auth required', request_id: requestId }, { status: 401 }),
      );
    }

    const [body, bodyErr] = await validateBody(request, WorkspaceActiveOrgSchema);
    if (bodyErr) return withRequestId(bodyErr);

    const workspaceBizId = request.headers.get('x-biz-id')?.trim();
    const access = await requireBizAccessPatternB(request, workspaceBizId, {
      supabase,
      user,
      headerBizId: workspaceBizId || null,
    });
    if (access instanceof NextResponse) return withRequestId(access);

    const { data: scopedBusiness } = await supabase
      .from('businesses')
      .select('id')
      .eq('id', access.bizId)
      .eq('org_id', body.orgId)
      .maybeSingle();

    if (!scopedBusiness) {
      return withRequestId(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
      );
    }

    const writeClient = supabase;

    const { error: clearError } = await writeClient
      .from('memberships')
      .update({ is_default: false })
      .eq('user_id', user.id)
      .not('accepted_at', 'is', null)
      .neq('org_id', body.orgId);

    if (clearError) {
      return withRequestId(
        NextResponse.json({ error: 'db_error', message: clearError.message, request_id: requestId }, { status: 500 }),
      );
    }

    const { data: setData, error: setError } = await writeClient
      .from('memberships')
      .update({ is_default: true })
      .eq('user_id', user.id)
      .eq('org_id', body.orgId)
      .not('accepted_at', 'is', null)
      .select('id')
      .limit(1);

    if (setError) {
      return withRequestId(
        NextResponse.json({ error: 'db_error', message: setError.message, request_id: requestId }, { status: 500 }),
      );
    }

    if (!Array.isArray(setData) || setData.length === 0) {
      return withRequestId(
        NextResponse.json({ error: 'not_found', message: 'Membership not found', request_id: requestId }, { status: 404 }),
      );
    }

    return withRequestId(
      NextResponse.json({ orgId: body.orgId, request_id: requestId }),
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return withRequestId(
      NextResponse.json({ error: 'internal_error', message, request_id: requestId }, { status: 500 }),
    );
  }
}
