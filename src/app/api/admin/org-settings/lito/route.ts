export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireBizAccessPatternB, requireImplicitBizAccessPatternB } from '@/lib/api-handler';
import { validateCsrf } from '@/lib/security/csrf';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createLogger } from '@/lib/logger';
import { validateBody, validateQuery } from '@/lib/validations';

const QuerySchema = z.object({
  org_id: z.string().uuid(),
});

const BodySchema = z.object({
  org_id: z.string().uuid(),
  ai_provider: z.enum(['auto', 'openai', 'anthropic']).optional(),
  lito_staff_ai_paused: z.boolean().optional(),
});

type OrganizationSettingsRow = {
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
  const log = createLogger({ route: 'GET /api/admin/org-settings/lito', request_id: requestId });

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

    const workspaceBizId = request.headers.get('x-biz-id')?.trim() || null;
    const access = await requireImplicitBizAccessPatternB(request, {
      supabase,
      user,
      headerBizId: workspaceBizId,
    });
    if (access instanceof NextResponse) {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }
    if (access.membership.orgId !== query.org_id) {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }
    if (access.role !== 'owner' && access.role !== 'manager' && access.role !== 'admin') {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    const { data, error } = await supabase
      .from('organizations')
      .select('id, ai_provider, lito_staff_ai_paused')
      .eq('id', query.org_id)
      .maybeSingle();

    if (error || !data) {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    const settings = data as OrganizationSettingsRow;
    return withStandardHeaders(
      NextResponse.json({
        ok: true,
        settings: {
          ai_provider: (settings.ai_provider || 'auto') as 'auto' | 'openai' | 'anthropic',
          lito_staff_ai_paused: Boolean(settings.lito_staff_ai_paused),
        },
        request_id: requestId,
      }),
      requestId,
    );
  } catch (error) {
    log.error('lito_org_settings_get_unhandled', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withStandardHeaders(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}

export async function PATCH(request: Request) {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ route: 'PATCH /api/admin/org-settings/lito', request_id: requestId });

  try {
    const blocked = validateCsrf(request);
    if (blocked) return withStandardHeaders(blocked, requestId);

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

    const workspaceBizId = request.headers.get('x-biz-id')?.trim() || null;
    const access = await requireBizAccessPatternB(request, workspaceBizId, {
      supabase,
      user,
      headerBizId: workspaceBizId,
    });
    if (access instanceof NextResponse) return withStandardHeaders(access, requestId);
    if (access.membership.orgId !== body.org_id) {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }
    if (access.role !== 'owner' && access.role !== 'manager') {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    const updatePayload: Record<string, unknown> = {};
    if (typeof body.ai_provider === 'string') {
      updatePayload.ai_provider = body.ai_provider;
    }
    if (typeof body.lito_staff_ai_paused === 'boolean') {
      updatePayload.lito_staff_ai_paused = body.lito_staff_ai_paused;
    }

    if (Object.keys(updatePayload).length === 0) {
      return withStandardHeaders(
        NextResponse.json({ error: 'validation_error', message: 'No hi ha canvis per desar.', request_id: requestId }, { status: 400 }),
        requestId,
      );
    }

    const { data, error } = await supabase
      .from('organizations')
      .update(updatePayload)
      .eq('id', body.org_id)
      .select('id, ai_provider, lito_staff_ai_paused')
      .single();

    if (error || !data) {
      return withStandardHeaders(
        NextResponse.json({ error: 'internal', message: 'No s\'ha pogut actualitzar la configuració.', request_id: requestId }, { status: 500 }),
        requestId,
      );
    }

    const settings = data as OrganizationSettingsRow;
    return withStandardHeaders(
      NextResponse.json({
        ok: true,
        settings: {
          ai_provider: (settings.ai_provider || 'auto') as 'auto' | 'openai' | 'anthropic',
          lito_staff_ai_paused: Boolean(settings.lito_staff_ai_paused),
        },
        request_id: requestId,
      }),
      requestId,
    );
  } catch (error) {
    log.error('lito_org_settings_patch_unhandled', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withStandardHeaders(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}
