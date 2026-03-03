export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { validateCsrf } from '@/lib/security/csrf';

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { validateBody, TriggerCreateSchema, TriggerUpdateSchema } from '@/lib/validations';
import { requireBizAccess, requireBizAccessPatternB, assertSingleBizId, withRequestContext } from '@/lib/api-handler';

/**
 * GET /api/triggers?biz_id=xxx — list triggers for a business
 * POST /api/triggers — create a trigger
 * PUT /api/triggers — update a trigger (body includes id)
 * DELETE /api/triggers?id=xxx — delete a trigger
 */

export const GET = withRequestContext(async function(request: Request) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const bizId = searchParams.get('biz_id');
  if (!bizId) return NextResponse.json({ error: 'bad_request', code: 'BIZ_ID_REQUIRED', message: 'biz_id és requerit' }, { status: 400 });

  // ── Biz-level guard ──────────────────────────────────────────────────────
  const bizGuard = await requireBizAccess({ supabase, userId: user.id, bizId });
  if (bizGuard) return bizGuard;

  const { data, error } = await supabase
    .from('action_triggers')
    .select('*')
    .eq('biz_id', bizId)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ triggers: data });
});

export const POST = withRequestContext(async function(request: Request) {
  const blocked = validateCsrf(request); if (blocked) return blocked;

  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // ── Validate ──
  const [body, err] = await validateBody(request, TriggerCreateSchema);
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

  const { data, error } = await supabase.from('action_triggers').insert({
    org_id: body.org_id,
    biz_id: body.biz_id,
    name: body.name,
    match_topics: body.match_topics,
    match_phrases: body.match_phrases,
    min_rating: body.min_rating ?? null,
    sentiment_filter: body.sentiment_filter ?? null,
    action_type: body.action_type,
    action_target: body.action_target,
    action_payload_template: body.action_payload_template ?? {},
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ trigger: data }, { status: 201 });
});

export const PUT = withRequestContext(async function(request: Request) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // ── Validate ──
  const [body, err] = await validateBody(request, TriggerUpdateSchema);
  if (err) return err;

  const { id, ...updates } = body;
  const access = await requireBizAccessPatternB(request, null, { supabase, user });
  if (access instanceof NextResponse) return access;

  const { data, error } = await supabase
    .from('action_triggers')
    .update(updates)
    .eq('id', id)
    .eq('biz_id', access.bizId)
    .select()
    .single();

  if (error?.code === 'PGRST116') {
    return NextResponse.json({ error: 'not_found', message: 'Trigger no trobat' }, { status: 404 });
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ trigger: data });
});

export const DELETE = withRequestContext(async function(request: Request) {
  const blocked = validateCsrf(request); if (blocked) return blocked;

  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const access = await requireBizAccessPatternB(request, searchParams.get('biz_id'), { supabase, user });
  if (access instanceof NextResponse) return access;

  const { data: deleted, error } = await supabase
    .from('action_triggers')
    .delete()
    .eq('id', id)
    .eq('biz_id', access.bizId)
    .select('id')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!deleted) return NextResponse.json({ error: 'not_found', message: 'Trigger no trobat' }, { status: 404 });
  return NextResponse.json({ ok: true });
});
