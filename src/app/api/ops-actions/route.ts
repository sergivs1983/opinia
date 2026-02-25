export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { validateCsrf } from '@/lib/security/csrf';

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { validateBody, OpsActionCreateSchema, OpsActionUpdateSchema } from '@/lib/validations';
import { requireBizAccess, requireBizAccessPatternB, assertSingleBizId, withRequestContext } from '@/lib/api-handler';

export const GET = withRequestContext(async function(request: Request) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const bizId = searchParams.get('biz_id');
  if (!bizId) return NextResponse.json({ error: 'bad_request', code: 'BIZ_ID_REQUIRED', message: 'biz_id és requerit' }, { status: 400 });

  // ── Biz-level guard ──────────────────────────────────────────────────────
  const bizGuard = await requireBizAccess({ supabase, userId: user.id, bizId });
  if (bizGuard) return bizGuard;

  const status = searchParams.get('status');
  let query = supabase
    .from('ops_actions')
    .select('*')
    .eq('biz_id', bizId)
    .order('created_at', { ascending: false });

  if (status && status !== 'all') query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
});

export const POST = withRequestContext(async function(request: Request) {
  const blocked = validateCsrf(request); if (blocked) return blocked;

  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // ── Validate ──
  const [body, err] = await validateBody(request, OpsActionCreateSchema);
  if (err) return err;

  // ── Input hardening: biz_id per una sola via ─────────────────────────────
  const { bizId: resolvedBizId, error: ambigErr } = assertSingleBizId([
    new URL(request.url).searchParams.get('biz_id'),
    body.biz_id,
  ]);
  if (ambigErr) return ambigErr;
  // ── Biz-level guard ──────────────────────────────────────────────────────
  const bizGuard = await requireBizAccess({ supabase, userId: user.id, bizId: resolvedBizId });
  if (bizGuard) return bizGuard;

  const { data, error } = await supabase
    .from('ops_actions')
    .insert({
      biz_id: body.biz_id,
      org_id: body.org_id,
      theme: body.theme,
      title: body.title,
      recommendation: body.recommendation || null,
      priority: body.priority,
      status: 'open',
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
});

export const PATCH = withRequestContext(async function(request: Request) {
  const blocked = validateCsrf(request); if (blocked) return blocked;

  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // ── Validate ──
  const [body, err] = await validateBody(request, OpsActionUpdateSchema);
  if (err) return err;

  const { id, ...updates } = body;

  // ── Patró B: fetch biz_id from resource, then guard ──────────────────────
  const { data: existing } = await supabase
    .from('ops_actions')
    .select('biz_id')
    .eq('id', id)
    .single();
  if (!existing) return NextResponse.json({ error: 'not_found', message: 'Acció no trobada' }, { status: 404 });

  // Patró B: cross-tenant → 404 (no filtrar existència)
  const bizGuard = await requireBizAccessPatternB({ supabase, userId: user.id, bizId: existing.biz_id });
  if (bizGuard) return bizGuard;

  const payload: Record<string, unknown> = { ...updates };
  if (updates.status === 'done') payload.done_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('ops_actions')
    .update(payload)
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
});

export const DELETE = withRequestContext(async function(request: Request) {
  const blocked = validateCsrf(request); if (blocked) return blocked;

  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  // ── Patró B: fetch biz_id from resource, then guard ──────────────────────
  const { data: existing } = await supabase
    .from('ops_actions')
    .select('biz_id')
    .eq('id', id)
    .single();
  if (!existing) return NextResponse.json({ error: 'not_found', message: 'Acció no trobada' }, { status: 404 });

  // Patró B: cross-tenant → 404 (no filtrar existència)
  const bizGuard = await requireBizAccessPatternB({ supabase, userId: user.id, bizId: existing.biz_id });
  if (bizGuard) return bizGuard;

  const { error } = await supabase.from('ops_actions').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
});
