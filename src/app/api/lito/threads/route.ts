export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { hasAcceptedBusinessMembership } from '@/lib/authz';
import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { validateBody, validateQuery } from '@/lib/validations';

const LitoThreadsBodySchema = z.object({
  biz_id: z.string().uuid(),
  recommendation_id: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(160).nullable().optional(),
  format: z.enum(['post', 'story', 'reel']).nullable().optional(),
  hook: z.string().trim().max(500).nullable().optional(),
});

const LitoThreadsQuerySchema = z.object({
  biz_id: z.string().uuid(),
  limit: z
    .preprocess((value) => {
      if (typeof value !== 'string') return undefined;
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : undefined;
    }, z.number().int().min(1).max(200).optional())
    .optional(),
});

type LitoThreadRow = {
  id: string;
  biz_id: string;
  recommendation_id: string | null;
  title: string;
  status: 'open' | 'closed';
  created_at: string;
  updated_at: string;
};

type LitoThreadListItem = LitoThreadRow & {
  messages_count: number;
  last_message_preview: string;
};

type LitoMessageListRow = {
  thread_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
};

type RecommendationSeedRow = {
  id: string;
  generated_copy: unknown;
  format: string | null;
};

const LITO_ALLOWED_ROLES = ['owner', 'manager', 'staff'] as const;

function withStandardHeaders(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('x-request-id', requestId);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function isSchemaDependencyError(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  const code = (error?.code || '').toUpperCase();
  const message = (error?.message || '').toLowerCase();
  return (
    code === '42703'
    || code === '42P01'
    || code === 'PGRST204'
    || code === 'PGRST205'
    || message.includes('schema cache')
    || (message.includes('column') && message.includes('does not exist'))
  );
}

function normalizeThreadRows(rows: Array<Record<string, unknown>>): LitoThreadRow[] {
  return rows
    .map((row) => {
      const id = typeof row.id === 'string' ? row.id : null;
      const bizId = typeof row.biz_id === 'string' ? row.biz_id : null;
      const title = typeof row.title === 'string' ? row.title : 'Nova conversa';
      const createdAt = typeof row.created_at === 'string' ? row.created_at : new Date(0).toISOString();
      const updatedAt = typeof row.updated_at === 'string' ? row.updated_at : createdAt;
      if (!id || !bizId) return null;
      return {
        id,
        biz_id: bizId,
        recommendation_id: typeof row.recommendation_id === 'string' ? row.recommendation_id : null,
        title,
        status: row.status === 'closed' ? 'closed' : 'open',
        created_at: createdAt,
        updated_at: updatedAt,
      } as LitoThreadRow;
    })
    .filter((row): row is LitoThreadRow => Boolean(row));
}

function sanitizePreview(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  if (compact.length <= 120) return compact;
  return `${compact.slice(0, 119).trimEnd()}…`;
}

function buildThreadList(rows: LitoThreadRow[], messagesRows: LitoMessageListRow[]): LitoThreadListItem[] {
  const countsByThread = new Map<string, number>();
  const previewByThread = new Map<string, string>();

  for (const row of messagesRows) {
    const threadId = row.thread_id;
    if (!threadId) continue;
    countsByThread.set(threadId, (countsByThread.get(threadId) || 0) + 1);

    if (!previewByThread.has(threadId) && row.role !== 'system') {
      previewByThread.set(threadId, sanitizePreview(row.content || ''));
    }
  }

  return rows.map((thread) => ({
    ...thread,
    messages_count: countsByThread.get(thread.id) || 0,
    last_message_preview: previewByThread.get(thread.id) || '',
  }));
}

function parseSeedTemplate(raw: unknown): { hook: string; idea: string; format: 'post' | 'story' | 'reel' } | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const hook = typeof obj.hook === 'string' ? obj.hook.trim() : '';
  const idea = typeof obj.idea === 'string' ? obj.idea.trim() : '';
  const formatRaw = typeof obj.format === 'string' ? obj.format.toLowerCase().trim() : 'post';
  const format = formatRaw === 'story' || formatRaw === 'reel' ? formatRaw : 'post';
  if (!hook && !idea) return null;
  return {
    hook: hook || 'Hi ha una oportunitat clara aquesta setmana.',
    idea: idea || 'Podem convertir-la en una peça fàcil d’executar.',
    format,
  };
}

function toFormatLabel(format: 'post' | 'story' | 'reel'): 'Post' | 'Story' | 'Reel' {
  if (format === 'story') return 'Story';
  if (format === 'reel') return 'Reel';
  return 'Post';
}

function truncateForTitle(value: string, maxLength = 92): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 1).trimEnd()}…`;
}

function buildGeneralThreadTitle(now = new Date()): string {
  void now;
  return 'Nova conversa';
}

function buildRecommendationThreadTitle(params: {
  format?: 'post' | 'story' | 'reel' | null;
  hook?: string | null;
}): string {
  const formatLabel = toFormatLabel(params.format || 'post');
  const hook = truncateForTitle(params.hook || '', 96);
  if (!hook) return `LITO — ${formatLabel}: Recomanació`;
  return `LITO — ${formatLabel}: ${hook}`;
}

function sanitizeThreadTitle(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (compact.length <= 160) return compact;
  return compact.slice(0, 159).trimEnd();
}

function buildRecommendationIntroMessage(seed: { hook: string; idea: string; format: 'post' | 'story' | 'reel' }): string {
  return [
    `He detectat una oportunitat aquesta setmana: ${seed.hook}`,
    seed.idea,
    '',
    `Vols que la convertim en un ${toFormatLabel(seed.format)}, una Story o un Reel?`,
  ].join('\n');
}

async function ensureRecommendationKickoffMessage(params: {
  admin: ReturnType<typeof createAdminClient>;
  bizId: string;
  recommendationId: string;
  threadId: string;
  requestId: string;
  log: ReturnType<typeof createLogger>;
}): Promise<void> {
  const { data: existingMessagesData, error: existingMessagesErr } = await params.admin
    .from('lito_messages')
    .select('id')
    .eq('thread_id', params.threadId)
    .limit(1);

  if (existingMessagesErr) {
    params.log.warn('lito_thread_seed_messages_probe_failed', {
      request_id: params.requestId,
      thread_id: params.threadId,
      error_code: existingMessagesErr.code || null,
      error: existingMessagesErr.message || null,
    });
    return;
  }

  if ((existingMessagesData || []).length > 0) return;

  const { data: recommendationData, error: recommendationErr } = await params.admin
    .from('recommendation_log')
    .select('id, generated_copy, format')
    .eq('id', params.recommendationId)
    .eq('biz_id', params.bizId)
    .maybeSingle();

  if (recommendationErr || !recommendationData) {
    params.log.warn('lito_thread_seed_recommendation_lookup_failed', {
      request_id: params.requestId,
      thread_id: params.threadId,
      recommendation_id: params.recommendationId,
      error_code: recommendationErr?.code || null,
      error: recommendationErr?.message || null,
    });
    return;
  }

  const recommendation = recommendationData as RecommendationSeedRow;
  const parsed = parseSeedTemplate(recommendation.generated_copy);
  const formatFromColumn = recommendation.format === 'story' || recommendation.format === 'reel'
    ? recommendation.format
    : 'post';

  const seed = parsed || {
    hook: 'Hi ha una oportunitat aquesta setmana per explicar una cosa que el client valora.',
    idea: 'Et proposo una peça curta i accionable per publicar avui mateix.',
    format: formatFromColumn,
  };

  const introMessage = buildRecommendationIntroMessage(seed);
  const { error: insertErr } = await params.admin
    .from('lito_messages')
    .insert({
      thread_id: params.threadId,
      role: 'assistant',
      content: introMessage,
      meta: {
        type: 'recommendation_intro',
        recommendation_id: params.recommendationId,
        suggested_format: seed.format,
      },
    });

  if (insertErr) {
    params.log.warn('lito_thread_seed_message_insert_failed', {
      request_id: params.requestId,
      thread_id: params.threadId,
      recommendation_id: params.recommendationId,
      error_code: insertErr.code || null,
      error: insertErr.message || null,
    });
  }
}

export async function POST(request: Request) {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'POST /api/lito/threads' });

  try {
    const supabase = createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return withStandardHeaders(
        NextResponse.json({ error: 'unauthorized', message: 'Auth required', request_id: requestId }, { status: 401 }),
        requestId,
      );
    }

    const [body, bodyErr] = await validateBody(request, LitoThreadsBodySchema);
    if (bodyErr) return withStandardHeaders(bodyErr, requestId);
    const payload = body as z.infer<typeof LitoThreadsBodySchema>;

    const access = await hasAcceptedBusinessMembership({
      supabase,
      userId: user.id,
      businessId: payload.biz_id,
      allowedRoles: [...LITO_ALLOWED_ROLES],
    });
    if (!access.allowed || !access.orgId) {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    const admin = createAdminClient();

    const recommendationId = payload.recommendation_id ?? null;
    let recommendationSeed: RecommendationSeedRow | null = null;
    if (recommendationId) {
      const { data: recommendationData, error: recommendationErr } = await admin
        .from('recommendation_log')
        .select('id, generated_copy, format')
        .eq('id', recommendationId)
        .eq('biz_id', payload.biz_id)
        .maybeSingle();
      if (recommendationErr || !recommendationData) {
        return withStandardHeaders(
          NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
          requestId,
        );
      }
      recommendationSeed = recommendationData as RecommendationSeedRow;
    }

    if (recommendationId) {
      const { data: existingOpenData } = await admin
        .from('lito_threads')
        .select('id, biz_id, recommendation_id, title, status, created_at, updated_at')
        .eq('biz_id', payload.biz_id)
        .eq('recommendation_id', recommendationId)
        .eq('status', 'open')
        .maybeSingle();

      if (existingOpenData) {
        await ensureRecommendationKickoffMessage({
          admin,
          bizId: payload.biz_id,
          recommendationId,
          threadId: (existingOpenData as LitoThreadRow).id,
          requestId,
          log,
        });
        return withStandardHeaders(
          NextResponse.json({
            ok: true,
            thread: existingOpenData as LitoThreadRow,
            request_id: requestId,
          }),
          requestId,
        );
      }

      const { data: existingAnyData } = await admin
        .from('lito_threads')
        .select('id, biz_id, recommendation_id, title, status, created_at, updated_at')
        .eq('biz_id', payload.biz_id)
        .eq('recommendation_id', recommendationId)
        .maybeSingle();
      if (existingAnyData) {
        await ensureRecommendationKickoffMessage({
          admin,
          bizId: payload.biz_id,
          recommendationId,
          threadId: (existingAnyData as LitoThreadRow).id,
          requestId,
          log,
        });
        return withStandardHeaders(
          NextResponse.json({
            ok: true,
            thread: existingAnyData as LitoThreadRow,
            request_id: requestId,
          }),
          requestId,
        );
      }
    }

    const parsedSeedTemplate = recommendationSeed
      ? parseSeedTemplate(recommendationSeed.generated_copy)
      : null;
    const resolvedRecommendationFormat = payload.format
      || parsedSeedTemplate?.format
      || (recommendationSeed?.format === 'story' || recommendationSeed?.format === 'reel'
        ? recommendationSeed.format
        : 'post');
    const resolvedRecommendationHook = payload.hook
      || parsedSeedTemplate?.hook
      || null;

    const title = payload.title
      ? sanitizeThreadTitle(payload.title)
      : recommendationId
        ? sanitizeThreadTitle(
            buildRecommendationThreadTitle({
              format: resolvedRecommendationFormat,
              hook: resolvedRecommendationHook,
            }),
          )
        : sanitizeThreadTitle(buildGeneralThreadTitle());

    const { data: insertedData, error: insertErr } = await admin
      .from('lito_threads')
      .insert({
        org_id: access.orgId,
        biz_id: payload.biz_id,
        recommendation_id: recommendationId,
        title,
      })
      .select('id, biz_id, recommendation_id, title, status, created_at, updated_at')
      .single();

    if (insertErr || !insertedData) {
      if (insertErr?.code === '23505' && recommendationId) {
        const { data: conflictData } = await admin
          .from('lito_threads')
          .select('id, biz_id, recommendation_id, title, status, created_at, updated_at')
          .eq('biz_id', payload.biz_id)
          .eq('recommendation_id', recommendationId)
          .maybeSingle();

        if (conflictData) {
          await ensureRecommendationKickoffMessage({
            admin,
            bizId: payload.biz_id,
            recommendationId,
            threadId: (conflictData as LitoThreadRow).id,
            requestId,
            log,
          });
          return withStandardHeaders(
            NextResponse.json({
              ok: true,
              thread: conflictData as LitoThreadRow,
              request_id: requestId,
            }),
            requestId,
          );
        }
      }

      log.error('lito_threads_insert_failed', {
        error_code: insertErr?.code || null,
        error: insertErr?.message || null,
        biz_id: payload.biz_id,
      });
      return withStandardHeaders(
        NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
        requestId,
      );
    }

    if (recommendationId) {
      await ensureRecommendationKickoffMessage({
        admin,
        bizId: payload.biz_id,
        recommendationId,
        threadId: (insertedData as LitoThreadRow).id,
        requestId,
        log,
      });
    }

    return withStandardHeaders(
      NextResponse.json(
        {
          ok: true,
          thread: insertedData as LitoThreadRow,
          request_id: requestId,
        },
        { status: 201 },
      ),
      requestId,
    );
  } catch (error) {
    log.error('lito_threads_post_unhandled', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withStandardHeaders(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}

export async function GET(request: Request) {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'GET /api/lito/threads' });

  try {
    const supabase = createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return withStandardHeaders(
        NextResponse.json({ error: 'unauthorized', message: 'Auth required', request_id: requestId }, { status: 401 }),
        requestId,
      );
    }

    const [query, queryErr] = validateQuery(request, LitoThreadsQuerySchema);
    if (queryErr) return withStandardHeaders(queryErr, requestId);
    const payload = query as z.infer<typeof LitoThreadsQuerySchema>;
    const limit = payload.limit ?? 20;

    const access = await hasAcceptedBusinessMembership({
      supabase,
      userId: user.id,
      businessId: payload.biz_id,
      allowedRoles: [...LITO_ALLOWED_ROLES],
    });
    if (!access.allowed) {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from('lito_threads')
      .select('id, biz_id, recommendation_id, title, status, created_at, updated_at')
      .eq('biz_id', payload.biz_id)
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (error) {
      if (isSchemaDependencyError(error)) {
        log.warn('lito_threads_list_schema_fallback', {
          error_code: error.code || null,
          error: error.message || null,
        });
        return withStandardHeaders(
          NextResponse.json({
            ok: true,
            threads: [],
            request_id: requestId,
          }),
          requestId,
        );
      }
      log.error('lito_threads_list_failed', { error_code: error.code || null, error: error.message || null });
      return withStandardHeaders(
        NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
        requestId,
      );
    }

    const normalizedThreads = normalizeThreadRows((data || []) as Array<Record<string, unknown>>);
    if (normalizedThreads.length === 0) {
      return withStandardHeaders(
        NextResponse.json({
          ok: true,
          threads: [],
          request_id: requestId,
        }),
        requestId,
      );
    }

    const threadIds = normalizedThreads.map((thread) => thread.id);
    const { data: messagesData, error: messagesErr } = await admin
      .from('lito_messages')
      .select('thread_id, role, content, created_at')
      .in('thread_id', threadIds)
      .order('created_at', { ascending: false });

    if (messagesErr) {
      if (isSchemaDependencyError(messagesErr)) {
        log.warn('lito_threads_messages_schema_fallback', {
          error_code: messagesErr.code || null,
          error: messagesErr.message || null,
        });
        return withStandardHeaders(
          NextResponse.json({
            ok: true,
            threads: buildThreadList(normalizedThreads, []),
            request_id: requestId,
          }),
          requestId,
        );
      }

      log.error('lito_threads_messages_list_failed', { error_code: messagesErr.code || null, error: messagesErr.message || null });
      return withStandardHeaders(
        NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
        requestId,
      );
    }

    return withStandardHeaders(
      NextResponse.json({
        ok: true,
        threads: buildThreadList(normalizedThreads, (messagesData || []) as LitoMessageListRow[]),
        request_id: requestId,
      }),
      requestId,
    );
  } catch (error) {
    log.error('lito_threads_get_unhandled', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withStandardHeaders(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}
