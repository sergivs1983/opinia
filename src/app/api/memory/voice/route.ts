export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { sanitizeMemoryObject } from '@/lib/memory/context';
import { requireMemoryBizAccess, withStandardHeaders } from '@/app/api/memory/_shared';
import { validateBody } from '@/lib/validations';

const MemoryVoiceBodySchema = z.object({
  biz_id: z.string().uuid(),
  voice: z.record(z.string(), z.unknown()).default({}),
});

async function upsertVoice(request: Request): Promise<NextResponse> {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'PUT|PATCH /api/memory/voice' });

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

    const [body, bodyErr] = await validateBody(request, MemoryVoiceBodySchema);
    if (bodyErr) return withStandardHeaders(bodyErr, requestId);
    const payload = body as z.infer<typeof MemoryVoiceBodySchema>;

    const access = await requireMemoryBizAccess({
      supabase,
      userId: user.id,
      bizId: payload.biz_id,
    });

    if (!access.ok) {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    const admin = createAdminClient();
    const nowIso = new Date().toISOString();
    const voiceJson = sanitizeMemoryObject(payload.voice);

    const { data, error } = await admin
      .from('biz_memory_voice')
      .upsert(
        {
          biz_id: payload.biz_id,
          org_id: access.orgId,
          voice_json: voiceJson,
          updated_at: nowIso,
        },
        { onConflict: 'biz_id' },
      )
      .select('biz_id, org_id, voice_json, updated_at')
      .maybeSingle();

    if (error) {
      log.error('memory_voice_upsert_failed', {
        error_code: error.code || null,
        error: error.message || null,
        biz_id: payload.biz_id,
      });
      return withStandardHeaders(
        NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
        requestId,
      );
    }

    return withStandardHeaders(
      NextResponse.json({
        ok: true,
        voice: data || null,
        request_id: requestId,
      }),
      requestId,
    );
  } catch (error) {
    log.error('memory_voice_upsert_unhandled', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withStandardHeaders(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}

export async function PUT(request: Request): Promise<NextResponse> {
  return upsertVoice(request);
}

export async function PATCH(request: Request): Promise<NextResponse> {
  return upsertVoice(request);
}
