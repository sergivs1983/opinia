export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { audit, type AuditAction } from '@/lib/audit';
import { validateBody, AuditLogSchema } from '@/lib/validations';
import type { JsonObject } from '@/types/json';
import { requireBizAccess, withRequestContext } from '@/lib/api-handler';
import { hasAcceptedOrgMembership } from '@/lib/authz';

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
  const limit = Math.min(parseInt(searchParams.get('limit') || '30'), 100);

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
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // ── Validate ──
  const [body, err] = await validateBody(request, AuditLogSchema);
  if (err) return err;

  // ── Org-level guard: valida org_id del body (untrusted input del client) ─
  // Qualsevol usuari autenticat podria enviar org_id d'un altre tenant.
  // Validem que l'usuari és membre acceptat de l'org abans de persistir.
  const isOrgMember = await hasAcceptedOrgMembership({
    supabase,
    userId: user.id,
    orgId: body.org_id,
  });
  if (!isOrgMember) {
    return NextResponse.json(
      { error: 'forbidden', code: 'ORG_FORBIDDEN', message: 'No tens accés a aquesta organització' },
      { status: 403 },
    );
  }

  // ── Biz-level guard addicional (si biz_id present) ──────────────────────
  if (body.biz_id) {
    const bizGuard = await requireBizAccess({ supabase, userId: user.id, bizId: body.biz_id });
    if (bizGuard) return bizGuard;
  }

  await audit(supabase, {
    orgId: body.org_id,
    bizId: body.biz_id ?? null,
    userId: user.id,
    action: body.action as AuditAction,
    metadata: (body.metadata || {}) as JsonObject,
  });

  return NextResponse.json({ success: true });
});
