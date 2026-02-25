export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { validateCsrf } from '@/lib/security/csrf';

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { hasAcceptedOrgMembership } from '@/lib/authz';
import { asMembershipRoleFilter, TEAM_MANAGEMENT_ROLES } from '@/lib/roles';
import { assertOrgHasBusinessCapacity, OrgBusinessLimitError } from '@/lib/seats';
import {
  validateBody,
  validateQuery,
  AdminBusinessesListQuerySchema,
  AdminBusinessCreateSchema,
  AdminBusinessUpdateSchema,
  AdminBusinessOrderSchema,
} from '@/lib/validations';

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

async function ensureOrgManagerPermission(args: {
  orgId: string;
}) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };

  const allowed = await hasAcceptedOrgMembership({
    supabase,
    userId: user.id,
    orgId: args.orgId,
    allowedRoles: asMembershipRoleFilter(TEAM_MANAGEMENT_ROLES),
  });
  if (!allowed) {
    return { supabase, user, response: NextResponse.json({ error: 'forbidden' }, { status: 403 }) };
  }

  return { supabase, user, response: null as NextResponse | null };
}

export async function GET(request: Request) {
  const [query, queryErr] = validateQuery(request, AdminBusinessesListQuerySchema);
  if (queryErr) return queryErr;

  const access = await ensureOrgManagerPermission({ orgId: query.org_id });
  if (access.response) return access.response;

  const { data, error } = await access.supabase
    .from('businesses')
    .select('id, org_id, name, slug, type, city, url, is_active, sort_order, created_at, updated_at')
    .eq('org_id', query.org_id)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) {
    const fallback = await access.supabase
      .from('businesses')
      .select('id, org_id, name, slug, type, city, url, is_active, created_at, updated_at')
      .eq('org_id', query.org_id)
      .order('name', { ascending: true });

    if (fallback.error) {
      return NextResponse.json({ error: fallback.error.message }, { status: 500 });
    }

    const withFallbackSort = (fallback.data || []).map((row, index) => ({
      ...row,
      sort_order: index,
    }));
    return NextResponse.json({ businesses: withFallbackSort });
  }

  return NextResponse.json({ businesses: data || [] });
}

export async function POST(request: Request) {
  const blocked = validateCsrf(request); if (blocked) return blocked;

  const [body, bodyErr] = await validateBody(request, AdminBusinessCreateSchema);
  if (bodyErr) return bodyErr;

  const access = await ensureOrgManagerPermission({ orgId: body.org_id });
  if (access.response) return access.response;

  try {
    await assertOrgHasBusinessCapacity(access.supabase, body.org_id);
  } catch (limitError: unknown) {
    if (limitError instanceof OrgBusinessLimitError) {
      return NextResponse.json({
        error: limitError.code,
        message: limitError.message,
        limits: limitError.snapshot,
      }, { status: limitError.status });
    }
    return NextResponse.json({ error: 'business_limit_check_failed', message: "No hem pogut validar el límit d'establiments." }, { status: 500 });
  }

  const slug = body.slug ? slugify(body.slug) : slugify(body.name);
  const { data: maxSortData } = await access.supabase
    .from('businesses')
    .select('sort_order')
    .eq('org_id', body.org_id)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextSortOrder = ((maxSortData as { sort_order?: number } | null)?.sort_order ?? -1) + 1;

  const { data, error } = await access.supabase
    .from('businesses')
    .insert({
      org_id: body.org_id,
      name: body.name.trim(),
      slug: slug || null,
      type: body.type,
      url: body.url ?? null,
      sort_order: nextSortOrder,
      is_active: true,
    })
    .select('id, org_id, name, slug, type, city, url, is_active, sort_order, created_at, updated_at')
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'duplicate', message: 'El slug del negoci ja existeix.' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ business: data }, { status: 201 });
}

export async function PUT(request: Request) {
  const [body, bodyErr] = await validateBody(request, AdminBusinessUpdateSchema);
  if (bodyErr) return bodyErr;

  const access = await ensureOrgManagerPermission({ orgId: body.org_id });
  if (access.response) return access.response;

  const payload: Record<string, unknown> = {};
  if (typeof body.name === 'string') payload.name = body.name.trim();
  if (typeof body.type === 'string') payload.type = body.type;
  if (body.slug !== undefined) payload.slug = body.slug ? slugify(body.slug) : null;
  if (body.url !== undefined) payload.url = body.url ?? null;
  if (typeof body.is_active === 'boolean') payload.is_active = body.is_active;

  const { data, error } = await access.supabase
    .from('businesses')
    .update(payload)
    .eq('id', body.business_id)
    .eq('org_id', body.org_id)
    .select('id, org_id, name, slug, type, city, url, is_active, sort_order, created_at, updated_at')
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'duplicate', message: 'El slug del negoci ja existeix.' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ business: data });
}

export async function PATCH(request: Request) {
  const blocked = validateCsrf(request); if (blocked) return blocked;

  const [body, bodyErr] = await validateBody(request, AdminBusinessOrderSchema);
  if (bodyErr) return bodyErr;

  const access = await ensureOrgManagerPermission({ orgId: body.org_id });
  if (access.response) return access.response;

  const ids = body.items.map((item) => item.id);
  const { data: orgRows, error: orgRowsError } = await access.supabase
    .from('businesses')
    .select('id')
    .eq('org_id', body.org_id)
    .in('id', ids);

  if (orgRowsError) {
    return NextResponse.json({ error: orgRowsError.message }, { status: 500 });
  }
  if ((orgRows || []).length !== ids.length) {
    return NextResponse.json({
      error: 'validation_error',
      message: 'No tots els negocis pertanyen a la mateixa organització.',
    }, { status: 400 });
  }

  for (const row of body.items) {
    const { error } = await access.supabase
      .from('businesses')
      .update({ sort_order: row.sort_order })
      .eq('id', row.id)
      .eq('org_id', body.org_id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
