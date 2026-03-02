export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { sanitizeMemoryEventSummary, sanitizeMemoryObject } from '@/lib/memory/context';
import { requireMemoryBizAccess, withStandardHeaders } from '@/app/api/memory/_shared';
import { validateBody } from '@/lib/validations';

const MemoryEventBodySchema = z.object({
  biz_id: z.string().uuid(),
  type: z.string().trim().min(1).max(80),
  source: z.string().trim().min(1).max(80),
  summary: z.string().trim().min(1).max(500),
  evidence_ref: z.record(z.string(), z.unknown()).optional(),
  occurred_at: z.string().datetime().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'POST /api/memory/events' });

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

    const [body, bodyErr] = await validateBody(request, MemoryEventBodySchema);
    if (bodyErr) return withStandardHeaders(bodyErr, requestId);
    const payload = body as z.infer<typeof MemoryEventBodySchema>;

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
    const { data, error } = await admin
      .from('biz_memory_events')
      .insert({
        biz_id: payload.biz_id,
        org_id: access.orgId,
        type: payload.type,
        source: payload.source,
        summary: sanitizeMemoryEventSummary(payload.summary),
        evidence_ref: sanitizeMemoryObject(payload.evidence_ref || {}),
        occurred_at: payload.occurred_at || new Date().toISOString(),
        confidence: typeof payload.confidence === 'number' ? payload.confidence : null,
      })
      .select('id, biz_id, org_id, type, source, summary, evidence_ref, occurred_at, confidence, created_at')
      .maybeSingle();

    if (error) {
      log.error('memory_event_insert_failed', {
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
        event: data || null,
        request_id: requestId,
      }),
      requestId,
    );
  } catch (error) {
    log.error('memory_events_post_unhandled', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withStandardHeaders(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}
