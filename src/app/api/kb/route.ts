export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { validateCsrf } from '@/lib/security/csrf';

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { audit } from '@/lib/audit';
import { validateBody, KBCreateSchema, KBUpdateSchema } from '@/lib/validations';
import { requireBizAccess, requireBizAccessPatternB, assertSingleBizId, withRequestContext } from '@/lib/api-handler';

// GET /api/kb?biz_id=xxx
export const GET = withRequestContext(async function(request: Request) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized', message: 'Auth required' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const bizId = searchParams.get('biz_id');
  if (!bizId) return NextResponse.json({ error: 'bad_request', code: 'BIZ_ID_REQUIRED', message: 'biz_id és requerit' }, { status: 400 });

  // ── Biz-level guard (defense-in-depth, layer 2 after RLS) ──
  const bizGuard = await requireBizAccess({ supabase, userId: user.id, bizId });
  if (bizGuard) return bizGuard;

  const { data, error } = await supabase
    .from('knowledge_base_entries')
    .select('*')
    .eq('biz_id', bizId)
    .order('category')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: 'db_error', message: error.message }, { status: 500 });
  return NextResponse.json(data);
});

// POST /api/kb
export const POST = withRequestContext(async function(request: Request) {
  const blocked = validateCsrf(request); if (blocked) return blocked;

  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized', message: 'Auth required' }, { status: 401 });

  // ── Validate ──
  const [body, err] = await validateBody(request, KBCreateSchema);
  if (err) return err;

  // ── Input hardening: biz_id per una sola via ─────────────────────────────
  const { bizId: resolvedBizId, error: ambigErr } = assertSingleBizId([
    new URL(request.url).searchParams.get('biz_id'),
    body.biz_id,
  ]);
  if (ambigErr) return ambigErr;
  // ── Biz-level guard ──
  const bizGuard = await requireBizAccess({ supabase, userId: user.id, bizId: resolvedBizId });
  if (bizGuard) return bizGuard;

  const { data, error } = await supabase
    .from('knowledge_base_entries')
    .insert({
      biz_id: body.biz_id,
      org_id: body.org_id,
      category: body.category,
      triggers: body.triggers,
      content: body.content,
      sentiment_context: body.sentiment_context ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: 'db_error', message: error.message }, { status: 500 });

  await audit(supabase, { orgId: body.org_id, bizId: body.biz_id, userId: user.id, action: 'create_kb', targetType: 'kb_entry', targetId: data.id });
  return NextResponse.json(data);
});

// PATCH /api/kb
export const PATCH = withRequestContext(async function(request: Request) {
  const blocked = validateCsrf(request); if (blocked) return blocked;

  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized', message: 'Auth required' }, { status: 401 });

  // ── Validate ──
  const [body, err] = await validateBody(request, KBUpdateSchema);
  if (err) return err;

  const { id, ...updates } = body;
  const access = await requireBizAccessPatternB(request, null, { supabase, user });
  if (access instanceof NextResponse) return access;

  const { data, error } = await supabase
    .from('knowledge_base_entries')
    .update(updates)
    .eq('id', id)
    .eq('biz_id', access.bizId)
    .select()
    .single();

  if (error?.code === 'PGRST116') {
    return NextResponse.json({ error: 'not_found', message: 'Entrada no trobada' }, { status: 404 });
  }
  if (error) return NextResponse.json({ error: 'db_error', message: error.message }, { status: 500 });
  return NextResponse.json(data);
});

// DELETE /api/kb
export const DELETE = withRequestContext(async function(request: Request) {
  const blocked = validateCsrf(request); if (blocked) return blocked;

  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized', message: 'Auth required' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'bad_request', message: 'id required' }, { status: 400 });
  const access = await requireBizAccessPatternB(request, searchParams.get('biz_id'), { supabase, user });
  if (access instanceof NextResponse) return access;

  const { data: deleted, error } = await supabase
    .from('knowledge_base_entries')
    .delete()
    .eq('id', id)
    .eq('biz_id', access.bizId)
    .select('id')
    .maybeSingle();

  if (error) return NextResponse.json({ error: 'db_error', message: error.message }, { status: 500 });
  if (!deleted) return NextResponse.json({ error: 'not_found', message: 'Entrada no trobada' }, { status: 404 });
  return NextResponse.json({ success: true });
});
