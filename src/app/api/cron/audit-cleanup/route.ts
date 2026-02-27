export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase/admin';

// ─── Auth ─────────────────────────────────────────────────────────────────────

function validateCronAuth(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get('authorization') ?? '';
  return auth === `Bearer ${secret}`;
}

// ─── Retention config ─────────────────────────────────────────────────────────
//
// Plan lives in organizations.plan (businesses.org_id → organizations.id).
// If the plan is unknown or the join returns null, fall back to 90d.
//
// NOTE: add any new plan codes here to get correct retention.

const RETENTION_DAYS: Record<string, number> = {
  starter:    30,
  free:       30,  // treat 'free' same as starter
  pro:        90,
  growth:     90,  // alias occasionally used alongside 'pro'
  enterprise: 365,
};

const RETENTION_FALLBACK_DAYS = 90; // matches 'pro' — applied when plan is null/unknown

// ─── Handler ──────────────────────────────────────────────────────────────────

/**
 * POST /api/cron/audit-cleanup
 *
 * Requires: Authorization: Bearer <CRON_SECRET>
 * Deletes audit_logs rows older than the retention window per business,
 * derived from organizations.plan (via businesses.org_id → organizations.id).
 * Returns { ok: true, deleted: <n> }.
 *
 * Trigger note: the audit_logs_immutable_tg trigger allows DELETE for service_role
 * (the role used by getAdminClient). UPDATE is denied for all roles including service_role.
 *
 * Fallback: if organizations.plan is absent or unrecognised, retention = 90d (pro-level).
 * Add new plan codes to RETENTION_DAYS above when introducing new plans.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!validateCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = getAdminClient();

  // Load all businesses with their org plan via FK join:
  // businesses.org_id references organizations.id (auto-detected by Supabase).
  const { data: bizRows, error: fetchErr } = await admin
    .from('businesses')
    .select('id, organizations(plan)');

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  let totalDeleted = 0;

  for (const row of bizRows ?? []) {
    const bizId = row.id as string;

    // Supabase returns the joined relation as an object or null.
    const org = (row as { organizations: { plan?: string } | null }).organizations;
    const plan = org?.plan ?? null;
    const retentionDays = plan
      ? (RETENTION_DAYS[plan] ?? RETENTION_FALLBACK_DAYS)
      : RETENTION_FALLBACK_DAYS;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);

    const { count, error: delErr } = await admin
      .from('audit_logs')
      .delete({ count: 'exact' })
      .eq('biz_id', bizId)
      .lt('created_at', cutoff.toISOString());

    if (delErr) {
      // Log and continue — one biz failure must not abort the whole cleanup.
      console.error(`[audit-cleanup] biz ${bizId} delete failed:`, delErr.message);
      continue;
    }

    totalDeleted += count ?? 0;
  }

  return NextResponse.json({ ok: true, deleted: totalDeleted }, { status: 200 });
}
