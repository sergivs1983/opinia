export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';

import { getLitoBizAccess } from '@/lib/lito/action-drafts';
import {
  DEFAULT_BUSINESS_MEMORY,
  sanitizeBusinessMemoryInput,
  type BusinessMemoryPayload,
} from '@/lib/lito/brand-brain';
import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';

type BusinessMemoryRow = {
  id: string;
  biz_id: string;
  brand_voice: unknown;
  policies: unknown;
  business_facts: unknown;
  updated_at: string;
  updated_by: string | null;
};

function withNoStore(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('x-request-id', requestId);
  return response;
}

function parseBizId(request: NextRequest): string | null {
  const bizId = (request.nextUrl.searchParams.get('biz_id') || '').trim();
  if (!bizId) return null;
  if (bizId.length > 64) return null;
  return bizId;
}

function mergeMemoryWithDefaults(value: unknown): BusinessMemoryPayload {
  const base = sanitizeBusinessMemoryInput({
    brand_voice: DEFAULT_BUSINESS_MEMORY.brand_voice,
    policies: DEFAULT_BUSINESS_MEMORY.policies,
    business_facts: DEFAULT_BUSINESS_MEMORY.business_facts,
  });
  const incoming = sanitizeBusinessMemoryInput(value);
  return {
    brand_voice: {
      ...base.brand_voice,
      ...incoming.brand_voice,
    },
    policies: {
      ...base.policies,
      ...incoming.policies,
    },
    business_facts: {
      ...base.business_facts,
      ...incoming.business_facts,
    },
  };
}

function mergeForUpdate(existing: BusinessMemoryPayload, patchRaw: unknown): BusinessMemoryPayload {
  const patch = sanitizeBusinessMemoryInput(patchRaw);
  const raw = patchRaw && typeof patchRaw === 'object' ? patchRaw as Record<string, unknown> : {};

  return {
    brand_voice: raw.brand_voice !== undefined ? patch.brand_voice : existing.brand_voice,
    policies: raw.policies !== undefined ? patch.policies : existing.policies,
    business_facts: raw.business_facts !== undefined ? patch.business_facts : existing.business_facts,
  };
}

async function ensureBusinessMemoryRow(input: {
  admin: ReturnType<typeof createAdminClient>;
  bizId: string;
  userId: string;
}): Promise<BusinessMemoryRow> {
  const { data: existing, error: selectError } = await input.admin
    .from('business_memory')
    .select('id, biz_id, brand_voice, policies, business_facts, updated_at, updated_by')
    .eq('biz_id', input.bizId)
    .maybeSingle();

  if (selectError) {
    throw new Error(selectError.message || 'business_memory_select_failed');
  }
  if (existing) return existing as BusinessMemoryRow;

  const nowIso = new Date().toISOString();
  const { data: inserted, error: insertError } = await input.admin
    .from('business_memory')
    .insert({
      biz_id: input.bizId,
      brand_voice: DEFAULT_BUSINESS_MEMORY.brand_voice,
      policies: DEFAULT_BUSINESS_MEMORY.policies,
      business_facts: DEFAULT_BUSINESS_MEMORY.business_facts,
      updated_at: nowIso,
      updated_by: input.userId,
    })
    .select('id, biz_id, brand_voice, policies, business_facts, updated_at, updated_by')
    .single();

  if (insertError || !inserted) {
    throw new Error(insertError?.message || 'business_memory_insert_failed');
  }

  return inserted as BusinessMemoryRow;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'GET /api/business-memory' });

  try {
    const bizId = parseBizId(request);
    if (!bizId) {
      return withNoStore(
        NextResponse.json({ error: 'bad_request', message: 'biz_id és requerit', request_id: requestId }, { status: 400 }),
        requestId,
      );
    }

    const supabase = createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return withNoStore(
        NextResponse.json({ error: 'unauthorized', message: 'Auth required', request_id: requestId }, { status: 401 }),
        requestId,
      );
    }

    const access = await getLitoBizAccess({
      supabase,
      userId: user.id,
      bizId,
    });
    if (!access.allowed || !access.role) {
      return withNoStore(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    const admin = createAdminClient();
    const row = await ensureBusinessMemoryRow({
      admin,
      bizId,
      userId: user.id,
    });

    const memory = mergeMemoryWithDefaults({
      brand_voice: row.brand_voice,
      policies: row.policies,
      business_facts: row.business_facts,
    });

    const canEdit = access.role === 'owner' || access.role === 'manager';
    return withNoStore(
      NextResponse.json({
        ok: true,
        memory: {
          id: row.id,
          biz_id: row.biz_id,
          ...memory,
          updated_at: row.updated_at,
          updated_by: row.updated_by,
        },
        can_edit: canEdit,
        role: access.role,
        request_id: requestId,
      }),
      requestId,
    );
  } catch (error) {
    log.error('business_memory_get_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withNoStore(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}

async function upsertBusinessMemory(request: NextRequest): Promise<NextResponse> {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'PUT /api/business-memory' });

  try {
    const bizId = parseBizId(request);
    if (!bizId) {
      return withNoStore(
        NextResponse.json({ error: 'bad_request', message: 'biz_id és requerit', request_id: requestId }, { status: 400 }),
        requestId,
      );
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return withNoStore(
        NextResponse.json({ error: 'bad_request', message: 'JSON invàlid', request_id: requestId }, { status: 400 }),
        requestId,
      );
    }

    if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
      return withNoStore(
        NextResponse.json({ error: 'bad_request', message: 'Body invàlid', request_id: requestId }, { status: 400 }),
        requestId,
      );
    }

    const supabase = createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return withNoStore(
        NextResponse.json({ error: 'unauthorized', message: 'Auth required', request_id: requestId }, { status: 401 }),
        requestId,
      );
    }

    const access = await getLitoBizAccess({
      supabase,
      userId: user.id,
      bizId,
    });
    if (!access.allowed || !access.role) {
      return withNoStore(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    if (access.role !== 'owner' && access.role !== 'manager') {
      return withNoStore(
        NextResponse.json({ error: 'forbidden', message: 'Només gestors poden editar', request_id: requestId }, { status: 403 }),
        requestId,
      );
    }

    const admin = createAdminClient();
    const current = await ensureBusinessMemoryRow({
      admin,
      bizId,
      userId: user.id,
    });
    const currentMemory = mergeMemoryWithDefaults({
      brand_voice: current.brand_voice,
      policies: current.policies,
      business_facts: current.business_facts,
    });
    const nextMemory = mergeForUpdate(currentMemory, rawBody);

    const nowIso = new Date().toISOString();
    const { data: updated, error: updateError } = await admin
      .from('business_memory')
      .upsert(
        {
          biz_id: bizId,
          brand_voice: nextMemory.brand_voice,
          policies: nextMemory.policies,
          business_facts: nextMemory.business_facts,
          updated_at: nowIso,
          updated_by: user.id,
        },
        { onConflict: 'biz_id' },
      )
      .select('id, biz_id, brand_voice, policies, business_facts, updated_at, updated_by')
      .single();

    if (updateError || !updated) {
      throw new Error(updateError?.message || 'business_memory_upsert_failed');
    }

    return withNoStore(
      NextResponse.json({
        ok: true,
        memory: {
          id: updated.id,
          biz_id: updated.biz_id,
          ...nextMemory,
          updated_at: updated.updated_at,
          updated_by: updated.updated_by,
        },
        can_edit: true,
        role: access.role,
        request_id: requestId,
      }),
      requestId,
    );
  } catch (error) {
    log.error('business_memory_put_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withNoStore(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  return upsertBusinessMemory(request);
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  return upsertBusinessMemory(request);
}
