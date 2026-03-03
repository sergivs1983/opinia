export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { validateCsrf } from '@/lib/security/csrf';

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { audit, type AuditAction } from '@/lib/audit';
import { validateBody, AuditLogSchema } from '@/lib/validations';
import type { JsonObject } from '@/types/json';
import { requireBizAccess, requireBizAccessPatternB, withRequestContext } from '@/lib/api-handler';
import { parseLimitParam } from '@/lib/security/query-limits';

/**
 * GET /api/audit?biz_id=xxx&limit=30
 * Returns recent audit entries for a business.
 */
export const GET = withRequestContext(async function(request: Request) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const bizId = searchParams.get('biz_id');
  const limitResult = parseLimitParam(searchParams, 'limit', 30);
  if (!limitResult.ok) return limitResult.error;
  const { limit } = limitResult;

  if (!bizId) return NextResponse.json({ error: 'bad_request', code: 'BIZ_ID_REQUIRED', message: 'biz_id és requerit' }, { status: 400 });

  // ── Biz-level guard ──────────────────────────────────────────────────────
  const bizGuard = await requireBizAccess({ supabase, userId: user.id, bizId });
  if (bizGuard) return bizGuard;

  const { data, error } = await supabase
    .from('activity_log')
    .select('id, action, target_type, target_id, metadata, created_at, user_id')
    .eq('biz_id', bizId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
});

/**
 * POST /api/audit
 * Body: { action, org_id, biz_id?, metadata? }
 */
export const POST = withRequestContext(async function(request: Request) {
  const blocked = validateCsrf(request); if (blocked) return blocked;

  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // ── Validate ──
  const [body, err] = await validateBody(request, AuditLogSchema);
  if (err) return err;

  const workspaceBizId = request.headers.get('x-biz-id')?.trim() || null;
  const gate = await requireBizAccessPatternB(request, body.biz_id || workspaceBizId, {
    supabase,
    user,
    bodyBizId: body.biz_id || null,
    headerBizId: workspaceBizId,
  });
  if (gate instanceof NextResponse) return gate;
  if (!gate.role) {
    return NextResponse.json(
      { error: 'not_found', code: 'RESOURCE_NOT_FOUND', message: 'Recurs no trobat' },
      { status: 404 },
    );
  }
  if (gate.membership.orgId !== body.org_id) {
    return NextResponse.json(
      { error: 'not_found', code: 'RESOURCE_NOT_FOUND', message: 'Recurs no trobat' },
      { status: 404 },
    );
  }

  await audit(supabase, {
    orgId: gate.membership.orgId,
    bizId: gate.bizId,
    userId: user.id,
    action: body.action as AuditAction,
    metadata: (body.metadata || {}) as JsonObject,
  });

  return NextResponse.json({ success: true });
});
