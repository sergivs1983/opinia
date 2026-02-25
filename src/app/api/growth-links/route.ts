export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { validateCsrf } from '@/lib/security/csrf';

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { NextResponse } from 'next/server';
import { validateBody, GrowthLinkCreateSchema } from '@/lib/validations';
import { requireBizAccess, requireBizAccessPatternB, assertSingleBizId, withRequestContext } from '@/lib/api-handler';

/**
 * GET /api/growth-links?biz_id=xxx
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
    .from('growth_links')
    .select('*')
    .eq('biz_id', bizId)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Attach click counts for the last 7 days
  const admin = createAdminClient();
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  const linkIds = (data || []).map(l => l.id);

  let eventCounts: Record<string, number> = {};
  if (linkIds.length > 0) {
    const { data: events } = await admin
      .from('growth_events')
      .select('link_id')
      .in('link_id', linkIds)
      .gte('created_at', weekAgo);

    for (const e of (events || [])) {
      eventCounts[e.link_id] = (eventCounts[e.link_id] || 0) + 1;
    }
  }

  const enriched = (data || []).map(link => ({
    ...link,
    clicks_7d: eventCounts[link.id] || 0,
  }));

  return NextResponse.json(enriched);
});

/**
 * POST /api/growth-links
 * Body: { biz_id, org_id, target_url, type? }
 */
export const POST = withRequestContext(async function(request: Request) {
  const blocked = validateCsrf(request); if (blocked) return blocked;

  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // ── Validate ──
  const [body, err] = await validateBody(request, GrowthLinkCreateSchema);
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

  const slug = generateSlug();

  const { data, error } = await supabase
    .from('growth_links')
    .insert({
      biz_id: body.biz_id,
      org_id: body.org_id,
      target_url: body.target_url,
      slug,
      type: body.type,
      is_active: true,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
});

/**
 * DELETE /api/growth-links?id=xxx
 */
export const DELETE = withRequestContext(async function(request: Request) {
  const blocked = validateCsrf(request); if (blocked) return blocked;

  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  // ── Patró B: fetch biz_id from resource, then guard ──────────────────────
  const { data: existing } = await supabase
    .from('growth_links')
    .select('biz_id')
    .eq('id', id)
    .single();
  if (!existing) return NextResponse.json({ error: 'not_found', message: 'Enllaç no trobat' }, { status: 404 });

  // Patró B: cross-tenant → 404 (no filtrar existència)
  const bizGuard = await requireBizAccessPatternB({ supabase, userId: user.id, bizId: existing.biz_id });
  if (bizGuard) return bizGuard;

  const { error } = await supabase.from('growth_links').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
});

function generateSlug(): string {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  let slug = '';
  for (let i = 0; i < 6; i++) {
    slug += chars[Math.floor(Math.random() * chars.length)];
  }
  return slug;
}
