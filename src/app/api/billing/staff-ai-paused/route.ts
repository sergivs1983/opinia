export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getAcceptedOrgMembership } from '@/lib/authz';
import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { validateBody } from '@/lib/validations';

const BodySchema = z.object({
  org_id: z.string().uuid(),
  paused: z.boolean(),
});

function withStandardHeaders(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('x-request-id', requestId);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export async function POST(request: Request) {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'POST /api/billing/staff-ai-paused' });

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

    const [body, bodyErr] = await validateBody(request, BodySchema);
    if (bodyErr) return withStandardHeaders(bodyErr, requestId);

    const membership = await getAcceptedOrgMembership({
      supabase,
      userId: user.id,
      orgId: body.org_id,
    });

    if (!membership || (membership.normalized_role !== 'owner' && membership.normalized_role !== 'manager')) {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    // Use admin client to bypass RLS — managers also need write access but the
    // org_update policy only covers owner role (session-scoped RLS restriction).
    const admin = createAdminClient();
    const { error: updateErr } = await admin
      .from('organizations')
      .update({ lito_staff_ai_paused: body.paused })
      .eq('id', body.org_id);

    if (updateErr) {
      log.error('billing_staff_ai_paused_update_failed', {
        org_id: body.org_id,
        error_code: updateErr.code || null,
        error: updateErr.message || null,
      });
      return withStandardHeaders(
        NextResponse.json({ error: 'internal', message: 'No s\'ha pogut actualitzar la configuració.', request_id: requestId }, { status: 500 }),
        requestId,
      );
    }

    return withStandardHeaders(
      NextResponse.json({
        ok: true,
        org_id: body.org_id,
        lito_staff_ai_paused: body.paused,
        request_id: requestId,
      }),
      requestId,
    );
  } catch (error) {
    log.error('billing_staff_ai_paused_unhandled', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withStandardHeaders(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}
