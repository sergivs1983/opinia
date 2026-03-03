export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { validateCsrf } from '@/lib/security/csrf';

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { requireBizAccessPatternB } from '@/lib/api-handler';
import { NextResponse } from 'next/server';
import { validateBody, CompetitorCreateSchema } from '@/lib/validations';

/**
 * GET /api/competitors?biz_id=xxx
 */
export async function GET(request: Request) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const bizId = searchParams.get('biz_id');
  const access = await requireBizAccessPatternB(request, bizId, { supabase, user });
  if (access instanceof NextResponse) return access;

  const { data, error } = await supabase
    .from('competitors')
    .select('*')
    .eq('biz_id', access.bizId)
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

/**
 * POST /api/competitors
 * Body: { biz_id, org_id, name, place_id?, public_url?, avg_rating?, review_count? }
 */
export async function POST(request: Request) {
  const blocked = validateCsrf(request); if (blocked) return blocked;

  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const [body, err] = await validateBody(request, CompetitorCreateSchema);
  if (err) return err;

  const access = await requireBizAccessPatternB(request, body.biz_id, { supabase, user });
  if (access instanceof NextResponse) return access;

  const { data, error } = await supabase
    .from('competitors')
    .insert({
      biz_id: access.bizId,
      org_id: access.membership.orgId,
      name: body.name,
      place_id: body.place_id ?? null,
      public_url: body.public_url ?? null,
      avg_rating: body.avg_rating ?? null,
      review_count: body.review_count ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

/**
 * DELETE /api/competitors?id=xxx
 */
export async function DELETE(request: Request) {
  const blocked = validateCsrf(request); if (blocked) return blocked;

  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const bizId = searchParams.get('biz_id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const access = await requireBizAccessPatternB(request, bizId, { supabase, user });
  if (access instanceof NextResponse) return access;

  const { error } = await supabase
    .from('competitors')
    .delete()
    .eq('id', id)
    .eq('biz_id', access.bizId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
