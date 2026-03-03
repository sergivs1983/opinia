export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase/admin';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { requireInternalGuard } from '@/lib/internal-guard';

// ─── Handler ──────────────────────────────────────────────────────────────────

/**
 * POST /api/cron/audit-probe
 *
 * Requires: Authorization: Bearer <CRON_SECRET>
 * Writes one sentinel row to audit_logs (action="probe") and returns its id.
 * Used by the check:audit gate to verify the audit_logs table is reachable.
 *
 * This endpoint is intentionally grouped under /api/cron/ (Vercel cron convention).
 * The CRON_SECRET Bearer auth is the security boundary — no other auth is required.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = getRequestIdFromHeaders(request.headers);
  const blocked = requireInternalGuard(request, {
    requestId,
    mode: 'secret',
  });
  if (blocked) return blocked;

  const admin = getAdminClient();

  const { data, error } = await admin
    .from('audit_logs')
    .insert({
      // Sentinel UUID: marks this row as a probe (not a real biz).
      biz_id:     '00000000-0000-0000-0000-000000000000',
      request_id: requestId,
      action:     'probe',
      resource:   'audit_logs',
      result:     'success',
      details:    { note: 'automated audit gate check' },
    })
    .select('id')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: data.id, requestId }, { status: 200 });
}
