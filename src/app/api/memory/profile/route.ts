export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireBizAccessPatternB } from '@/lib/api-handler';
import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { sanitizeMemoryObject } from '@/lib/memory/context';
import { withStandardHeaders } from '@/app/api/memory/_shared';
import { validateBody } from '@/lib/validations';

const MemoryProfileBodySchema = z.object({
  biz_id: z.string().uuid(),
  profile: z.record(z.string(), z.unknown()).default({}),
});

async function upsertProfile(request: Request): Promise<NextResponse> {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'PUT|PATCH /api/memory/profile' });

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

    const [body, bodyErr] = await validateBody(request, MemoryProfileBodySchema);
    if (bodyErr) return withStandardHeaders(bodyErr, requestId);
    const payload = body as z.infer<typeof MemoryProfileBodySchema>;

    const access = await requireBizAccessPatternB(request, payload.biz_id, {
      supabase,
      user,
      bodyBizId: payload.biz_id,
    });
    if (access instanceof NextResponse) return withStandardHeaders(access, requestId);
    if (access.role !== 'owner' && access.role !== 'manager' && access.role !== 'staff') {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    const admin = createAdminClient();
    const nowIso = new Date().toISOString();
    const profileJson = sanitizeMemoryObject(payload.profile);

    const { data, error } = await admin
      .from('biz_memory_profile')
      .upsert(
        {
          biz_id: access.bizId,
          org_id: access.membership.orgId,
          profile_json: profileJson,
          updated_at: nowIso,
        },
        { onConflict: 'biz_id' },
      )
      .select('biz_id, org_id, profile_json, updated_at')
      .maybeSingle();

    if (error) {
      log.error('memory_profile_upsert_failed', {
        error_code: error.code || null,
        error: error.message || null,
        biz_id: access.bizId,
      });
      return withStandardHeaders(
        NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
        requestId,
      );
    }

    return withStandardHeaders(
      NextResponse.json({
        ok: true,
        profile: data || null,
        request_id: requestId,
      }),
      requestId,
    );
  } catch (error) {
    log.error('memory_profile_upsert_unhandled', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withStandardHeaders(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}

export async function PUT(request: Request): Promise<NextResponse> {
  return upsertProfile(request);
}

export async function PATCH(request: Request): Promise<NextResponse> {
  return upsertProfile(request);
}
