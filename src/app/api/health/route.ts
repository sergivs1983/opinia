import { type NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { log } from '@/lib/logger';

/**
 * GET /api/health
 * PUBLIC — no auth required.
 *
 * Response: { status: "ok"|"degraded", db: "ok"|"down", requestId: string }
 * HTTP 200 if DB ok, 503 if DB down.
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestIdFromHeaders(request.headers);

  let db: 'ok' | 'down' = 'down';
  try {
    const supabase = createServerSupabaseClient();
    const { error } = await supabase.from('organizations').select('id').limit(1);
    db = error ? 'down' : 'ok';
  } catch {
    log.warn('health: db check failed', { requestId, action: 'db_check', resource: 'organizations' });
    db = 'down';
  }

  const ok = db === 'ok';
  return NextResponse.json(
    { status: ok ? 'ok' : 'degraded', db, requestId },
    { status: ok ? 200 : 503 },
  );
}
