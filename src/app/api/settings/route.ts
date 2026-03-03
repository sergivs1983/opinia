export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';

import { requireBizAccessPatternB } from '@/lib/api-handler';
import { writeAudit } from '@/lib/audit-log';
import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import {
  canEditBizSettingsRole,
  DEFAULT_BIZ_SETTINGS,
  SettingsPatchSchema,
  sanitizeSettingsPatch,
  type BizSettingsRow,
  pickBizIdCandidates,
} from '@/lib/settings';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';

type BizSettingsSelectRow = {
  biz_id: string;
  signature: string | null;
  ai_instructions: string | null;
  keywords_use: string[] | null;
  keywords_avoid: string[] | null;
  ai_engine: string | null;
  seo_enabled: boolean | null;
  updated_at: string;
  updated_by: string | null;
};

function withNoStore(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('x-request-id', requestId);
  return response;
}

function asBizSettingsRow(row: BizSettingsSelectRow): BizSettingsRow {
  return {
    biz_id: row.biz_id,
    signature: row.signature ?? null,
    ai_instructions: row.ai_instructions ?? null,
    keywords_use: Array.isArray(row.keywords_use) ? row.keywords_use : [],
    keywords_avoid: Array.isArray(row.keywords_avoid) ? row.keywords_avoid : [],
    ai_engine: row.ai_engine || DEFAULT_BIZ_SETTINGS.ai_engine,
    seo_enabled: row.seo_enabled ?? false,
    updated_at: row.updated_at,
    updated_by: row.updated_by ?? null,
  };
}

async function loadBizSettings(input: {
  supabase: ReturnType<typeof createServerSupabaseClient>;
  bizId: string;
}): Promise<BizSettingsRow | null> {
  const { data, error } = await input.supabase
    .from('biz_settings')
    .select('biz_id, signature, ai_instructions, keywords_use, keywords_avoid, ai_engine, seo_enabled, updated_at, updated_by')
    .eq('biz_id', input.bizId)
    .maybeSingle();

  if (error || !data) return null;
  return asBizSettingsRow(data as BizSettingsSelectRow);
}

async function ensureBizSettings(input: {
  supabase: ReturnType<typeof createServerSupabaseClient>;
  admin: ReturnType<typeof createAdminClient>;
  bizId: string;
  userId: string;
}): Promise<BizSettingsRow> {
  const existing = await loadBizSettings({ supabase: input.supabase, bizId: input.bizId });
  if (existing) return existing;

  const nowIso = new Date().toISOString();
  const { error: upsertError } = await input.admin
    .from('biz_settings')
    .upsert({
      biz_id: input.bizId,
      signature: DEFAULT_BIZ_SETTINGS.signature,
      ai_instructions: DEFAULT_BIZ_SETTINGS.ai_instructions,
      keywords_use: DEFAULT_BIZ_SETTINGS.keywords_use,
      keywords_avoid: DEFAULT_BIZ_SETTINGS.keywords_avoid,
      ai_engine: DEFAULT_BIZ_SETTINGS.ai_engine,
      seo_enabled: DEFAULT_BIZ_SETTINGS.seo_enabled,
      updated_at: nowIso,
      updated_by: input.userId,
    }, {
      onConflict: 'biz_id',
      ignoreDuplicates: true,
    });

  if (upsertError) {
    throw new Error(upsertError.message || 'biz_settings_upsert_failed');
  }

  const afterInsert = await loadBizSettings({ supabase: input.supabase, bizId: input.bizId });
  if (afterInsert) return afterInsert;

  throw new Error('biz_settings_ensure_failed');
}

function getQueryBizId(request: NextRequest): string | null {
  const value = request.nextUrl.searchParams.get('biz_id');
  if (!value) return null;
  const normalized = value.trim();
  return normalized || null;
}

function getHeaderBizId(request: NextRequest): string | null {
  const value = request.headers.get('x-biz-id');
  if (!value) return null;
  const normalized = value.trim();
  return normalized || null;
}

function getClientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get('x-forwarded-for') || '';
  const first = forwarded.split(',')[0]?.trim();
  if (first) return first.slice(0, 120);
  const realIp = request.headers.get('x-real-ip')?.trim();
  return realIp ? realIp.slice(0, 120) : null;
}

function getUserAgent(request: NextRequest): string | null {
  const ua = request.headers.get('user-agent')?.trim();
  return ua ? ua.slice(0, 400) : null;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'GET /api/settings' });

  try {
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

    const queryBizId = getQueryBizId(request);
    const headerBizId = getHeaderBizId(request);
    const bizId = pickBizIdCandidates({
      queryBizId,
      headerBizId,
      bodyBizId: null,
    });

    const access = await requireBizAccessPatternB(request, bizId, {
      supabase,
      user,
      queryBizId,
      headerBizId,
    });
    if (access instanceof NextResponse) return withNoStore(access, requestId);

    const admin = createAdminClient();
    const settings = await ensureBizSettings({
      supabase,
      admin,
      bizId: access.bizId,
      userId: user.id,
    });

    return withNoStore(
      NextResponse.json({
        ok: true,
        settings,
        role: access.role,
        request_id: requestId,
      }),
      requestId,
    );
  } catch (error) {
    log.error('settings_get_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withNoStore(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'PATCH /api/settings' });

  try {
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return withNoStore(
        NextResponse.json({ error: 'bad_request', message: 'JSON invàlid', request_id: requestId }, { status: 400 }),
        requestId,
      );
    }

    const parsed = SettingsPatchSchema.safeParse(rawBody);
    if (!parsed.success) {
      return withNoStore(
        NextResponse.json({
          error: 'validation_error',
          message: parsed.error.issues[0]?.message || 'Body invàlid',
          request_id: requestId,
        }, { status: 400 }),
        requestId,
      );
    }

    const sanitized = sanitizeSettingsPatch(parsed.data);
    if (!sanitized.ok) {
      return withNoStore(
        NextResponse.json({
          error: 'validation_error',
          message: sanitized.error,
          request_id: requestId,
        }, { status: 400 }),
        requestId,
      );
    }

    if (Object.keys(sanitized.value).length === 0) {
      return withNoStore(
        NextResponse.json({
          error: 'validation_error',
          message: 'No hi ha camps per actualitzar',
          request_id: requestId,
        }, { status: 400 }),
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

    const queryBizId = getQueryBizId(request);
    const headerBizId = getHeaderBizId(request);
    const bodyBizId = parsed.data.biz_id || null;
    const bizId = pickBizIdCandidates({
      queryBizId,
      headerBizId,
      bodyBizId,
    });

    const access = await requireBizAccessPatternB(request, bizId, {
      supabase,
      user,
      bodyBizId,
      queryBizId,
      headerBizId,
    });
    if (access instanceof NextResponse) return withNoStore(access, requestId);

    if (!canEditBizSettingsRole(access.role)) {
      return withNoStore(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    const admin = createAdminClient();
    const before = await ensureBizSettings({
      supabase,
      admin,
      bizId: access.bizId,
      userId: user.id,
    });

    const { data: updatedData, error: updateError } = await admin
      .from('biz_settings')
      .update({
        ...sanitized.value,
        updated_at: new Date().toISOString(),
        updated_by: user.id,
      })
      .eq('biz_id', access.bizId)
      .select('biz_id, signature, ai_instructions, keywords_use, keywords_avoid, ai_engine, seo_enabled, updated_at, updated_by')
      .single();

    if (updateError || !updatedData) {
      throw new Error(updateError?.message || 'settings_update_failed');
    }

    const after = asBizSettingsRow(updatedData as BizSettingsSelectRow);

    void writeAudit({
      action: 'settings_updated',
      bizId: access.bizId,
      orgId: access.membership.orgId,
      userId: user.id,
      requestId,
      details: {
        before,
        after,
        ip: getClientIp(request),
        user_agent: getUserAgent(request),
      },
    });

    return withNoStore(
      NextResponse.json({
        ok: true,
        settings: after,
        role: access.role,
        request_id: requestId,
      }),
      requestId,
    );
  } catch (error) {
    log.error('settings_patch_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withNoStore(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}
