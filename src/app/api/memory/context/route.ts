export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';

import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getMemoryContext } from '@/lib/memory/context';
import { parseBizIdFromSearch, requireMemoryBizAccess, withStandardHeaders } from '@/app/api/memory/_shared';

export async function GET(request: Request): Promise<NextResponse> {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'GET /api/memory/context' });

  try {
    const bizId = parseBizIdFromSearch(request);
    if (!bizId) {
      return withStandardHeaders(
        NextResponse.json({ error: 'bad_request', message: 'biz_id és requerit', request_id: requestId }, { status: 400 }),
        requestId,
      );
    }

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

    const access = await requireMemoryBizAccess({
      supabase,
      userId: user.id,
      bizId,
    });

    if (!access.ok) {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    const admin = createAdminClient();
    const memory = await getMemoryContext({
      admin,
      bizId,
      orgId: access.orgId,
      policiesLimit: 5,
      eventsLimit: 10,
    });

    return withStandardHeaders(
      NextResponse.json({
        ok: true,
        profile: memory.profile,
        voice: memory.voice,
        policies_top: memory.policies_top,
        events_recent: memory.events_recent,
        request_id: requestId,
      }),
      requestId,
    );
  } catch (error) {
    log.error('memory_context_get_unhandled', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withStandardHeaders(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}
