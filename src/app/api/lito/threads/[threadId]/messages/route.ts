export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { hasAcceptedBusinessMembership } from '@/lib/authz';
import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { validateBody, validateParams, validateQuery } from '@/lib/validations';

const ThreadParamsSchema = z.object({
  threadId: z.string().uuid(),
});

const ThreadMessagesQuerySchema = z.object({
  limit: z
    .preprocess((value) => {
      if (typeof value !== 'string') return undefined;
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : undefined;
    }, z.number().int().min(1).max(500).optional())
    .optional(),
});

const ThreadMessagesBodySchema = z.object({
  content: z.string().trim().min(1).max(4000),
});

type ThreadRow = {
  id: string;
  biz_id: string;
  recommendation_id: string | null;
  title: string;
  status: 'open' | 'closed';
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: string;
  thread_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  meta: unknown;
  created_at: string;
};

const LITO_ALLOWED_ROLES = ['owner', 'manager', 'staff'] as const;

type RecommendationTemplate = {
  format: string;
  hook: string;
  idea: string;
  cta: string;
  assets_needed: string[];
  how_to: {
    why: string;
    steps: string[];
    checklist: string[];
    assets_needed: string[];
    time_estimate_min: number;
  };
};

function withStandardHeaders(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('x-request-id', requestId);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function isPlaceholderThreadTitle(value: string): boolean {
  const normalized = value.toLowerCase().replace(/\s+/g, ' ').trim();
  return (
    normalized === 'lito — consultes'
    || normalized === 'lito — consultas'
    || normalized === 'lito — questions'
    || normalized === 'lito — consulta'
    || normalized.startsWith('lito — consulta ·')
    || normalized.startsWith('lito — consultas ·')
    || normalized.startsWith('lito — questions ·')
    || normalized === 'nova conversa'
    || normalized === 'nueva conversación'
    || normalized === 'new conversation'
  );
}

function capitalizeFirst(value: string): string {
  if (!value) return value;
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function makeThreadTitleFromText(content: string): string {
  let text = content.replace(/\s+/g, ' ').trim();
  if (!text) return 'Consulta';

  text = text.replace(/^[¡!¿?\-–—\s]+/, '');
  text = text.replace(/^(hola|bon dia|bones|hey|ei|hello|hi)\b[,\s!:.;-]*/i, '');
  text = text.replace(/^lito\b[,\s:;-]*/i, '');
  text = text.replace(/^(vull|voldria|necessito|necessitem|busco|m'agradaria|quiero|necesito|busco|i need|i want)\b[,\s:;-]*/i, '');
  text = text.replace(/^(em pots|me puedes|can you|could you|podries|podrías)\b[,\s:;-]*/i, '');
  text = text.trim();
  if (!text) return 'Consulta';

  const words = text.split(' ').filter(Boolean);
  let candidate = words.slice(0, 10).join(' ');
  if (candidate.length > 48) candidate = candidate.slice(0, 48).trimEnd();
  candidate = candidate.replace(/[.,;:!?]+$/g, '').trim();
  if (!candidate) return 'Consulta';

  return capitalizeFirst(candidate);
}

function parseTemplateFromGeneratedCopy(raw: unknown): RecommendationTemplate | null {
  if (!raw) return null;
  const trimmed = typeof raw === 'string' ? raw.trim() : JSON.stringify(raw);
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed) as Partial<RecommendationTemplate>;
    if (
      parsed
      && typeof parsed.format === 'string'
      && typeof parsed.hook === 'string'
      && typeof parsed.idea === 'string'
      && typeof parsed.cta === 'string'
    ) {
      return {
        format: parsed.format,
        hook: parsed.hook,
        idea: parsed.idea,
        cta: parsed.cta,
        assets_needed: Array.isArray(parsed.assets_needed) ? parsed.assets_needed.filter((v): v is string => typeof v === 'string') : [],
        how_to: {
          why: typeof parsed.how_to?.why === 'string' ? parsed.how_to.why : 'Executa la recomanació amb una peça curta i clara.',
          steps: Array.isArray(parsed.how_to?.steps) ? parsed.how_to.steps.filter((v): v is string => typeof v === 'string') : [],
          checklist: Array.isArray(parsed.how_to?.checklist) ? parsed.how_to.checklist.filter((v): v is string => typeof v === 'string') : [],
          assets_needed: Array.isArray(parsed.how_to?.assets_needed) ? parsed.how_to.assets_needed.filter((v): v is string => typeof v === 'string') : [],
          time_estimate_min: typeof parsed.how_to?.time_estimate_min === 'number' ? parsed.how_to.time_estimate_min : 10,
        },
      };
    }
  } catch {
    // ignore parse errors; fallback to generic response
  }

  return null;
}

function buildAssistantReplyFromTemplate(template: RecommendationTemplate): { content: string; meta: Record<string, unknown> } {
  const howTo = template.how_to;
  const steps = (howTo.steps || []).slice(0, 6);
  const checklist = (howTo.checklist || []).slice(0, 6);
  const assets = (template.assets_needed.length > 0 ? template.assets_needed : howTo.assets_needed).slice(0, 6);

  const lines: string[] = [
    `Perfecte. Anem a executar aquesta recomanació (${template.format}).`,
    `Objectiu: ${howTo.why}`,
    '',
    'Pas a pas:',
  ];

  if (steps.length === 0) {
    lines.push('1. Publica una peça curta amb el hook i una prova real del negoci.');
    lines.push('2. Tanca amb CTA perquè el client deixi feedback.');
  } else {
    steps.forEach((step, index) => lines.push(`${index + 1}. ${step}`));
  }

  lines.push('', 'Checklist ràpida:');
  if (checklist.length === 0) {
    lines.push('- Hook clar');
    lines.push('- Missatge en 2-4 línies');
    lines.push('- CTA final');
  } else {
    checklist.forEach((item) => lines.push(`- ${item}`));
  }

  lines.push('', 'Assets recomanats:');
  if (assets.length === 0) {
    lines.push('- 1 foto o clip real');
    lines.push('- Text curt sobre valor diferencial');
  } else {
    assets.forEach((item) => lines.push(`- ${item}`));
  }

  lines.push('', `Temps estimat: ${howTo.time_estimate_min} min`);
  lines.push('Quan ho publiquis, marca-ho com feta.');

  return {
    content: lines.join('\n'),
    meta: {
      mode: 'deterministic_howto',
      format: template.format,
      hook: template.hook,
    },
  };
}

function buildGenericAssistantReply(): { content: string; meta: Record<string, unknown> } {
  return {
    content: [
      'Perfecte, t\'ajudo a enfocar-ho ara mateix.',
      'Respon aquestes 3 preguntes breus:',
      '1) A quin canal publicaràs primer? (Instagram, Facebook, Google)',
      '2) Quin objectiu tens aquesta setmana? (reserves, visites, confiança)',
      '3) Quin to vols usar? (proper, formal o energètic)',
    ].join('\n'),
    meta: {
      mode: 'deterministic_generic',
    },
  };
}

async function loadThreadForUser(params: {
  supabase: ReturnType<typeof createServerSupabaseClient>;
  userId: string;
  threadId: string;
}): Promise<{ thread: ThreadRow | null; allowed: boolean }> {
  const { data, error } = await params.supabase
    .from('lito_threads')
    .select('id, biz_id, recommendation_id, title, status, created_at, updated_at')
    .eq('id', params.threadId)
    .maybeSingle();

  if (error || !data) return { thread: null, allowed: false };
  const thread = data as ThreadRow;
  const access = await hasAcceptedBusinessMembership({
    supabase: params.supabase,
    userId: params.userId,
    businessId: thread.biz_id,
    allowedRoles: [...LITO_ALLOWED_ROLES],
  });

  return {
    thread,
    allowed: access.allowed,
  };
}

export async function GET(
  request: Request,
  { params }: { params: { threadId: string } },
) {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'GET /api/lito/threads/[threadId]/messages' });

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

    const [routeParams, paramsErr] = validateParams(params, ThreadParamsSchema);
    if (paramsErr) return withStandardHeaders(paramsErr, requestId);
    const [query, queryErr] = validateQuery(request, ThreadMessagesQuerySchema);
    if (queryErr) return withStandardHeaders(queryErr, requestId);
    const limit = (query as z.infer<typeof ThreadMessagesQuerySchema>).limit ?? 200;

    const { thread, allowed } = await loadThreadForUser({
      supabase,
      userId: user.id,
      threadId: routeParams.threadId,
    });

    if (!thread || !allowed) {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    const admin = createAdminClient();

    const { count: existingUserMessagesCount, error: countErr } = await admin
      .from('lito_messages')
      .select('id', { count: 'exact', head: true })
      .eq('thread_id', thread.id)
      .eq('role', 'user');

    if (countErr) {
      log.warn('lito_user_message_count_failed', {
        error_code: countErr.code || null,
        error: countErr.message || null,
        thread_id: thread.id,
      });
    }

    const { data: messagesData, error: messagesErr } = await supabase
      .from('lito_messages')
      .select('id, thread_id, role, content, meta, created_at')
      .eq('thread_id', thread.id)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (messagesErr) {
      log.error('lito_thread_messages_query_failed', {
        error_code: messagesErr.code || null,
        error: messagesErr.message || null,
        thread_id: thread.id,
      });
      return withStandardHeaders(
        NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
        requestId,
      );
    }

    return withStandardHeaders(
      NextResponse.json({
        ok: true,
        thread,
        messages: (messagesData || []) as MessageRow[],
        request_id: requestId,
      }),
      requestId,
    );
  } catch (error) {
    log.error('lito_thread_messages_get_unhandled', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withStandardHeaders(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: { threadId: string } },
) {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'POST /api/lito/threads/[threadId]/messages' });

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

    const [routeParams, paramsErr] = validateParams(params, ThreadParamsSchema);
    if (paramsErr) return withStandardHeaders(paramsErr, requestId);
    const [body, bodyErr] = await validateBody(request, ThreadMessagesBodySchema);
    if (bodyErr) return withStandardHeaders(bodyErr, requestId);
    const payload = body as z.infer<typeof ThreadMessagesBodySchema>;

    const { thread, allowed } = await loadThreadForUser({
      supabase,
      userId: user.id,
      threadId: routeParams.threadId,
    });

    if (!thread || !allowed) {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    const { data: userMessageData, error: userMessageErr } = await supabase
      .from('lito_messages')
      .insert({
        thread_id: thread.id,
        role: 'user',
        content: payload.content,
      })
      .select('id, thread_id, role, content, meta, created_at')
      .single();

    if (userMessageErr || !userMessageData) {
      log.error('lito_user_message_insert_failed', {
        error_code: userMessageErr?.code || null,
        error: userMessageErr?.message || null,
        thread_id: thread.id,
      });
      return withStandardHeaders(
        NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
        requestId,
      );
    }

    let assistantReply = buildGenericAssistantReply();
    if (thread.recommendation_id) {
      const { data: recommendationData } = await supabase
        .from('recommendation_log')
        .select('generated_copy')
        .eq('id', thread.recommendation_id)
        .eq('biz_id', thread.biz_id)
        .maybeSingle();

      const parsed = parseTemplateFromGeneratedCopy(
        (recommendationData as { generated_copy?: unknown } | null)?.generated_copy || null,
      );
      if (parsed) {
        assistantReply = buildAssistantReplyFromTemplate(parsed);
      }
    }

    const { data: assistantMessageData, error: assistantMessageErr } = await supabase
      .from('lito_messages')
      .insert({
        thread_id: thread.id,
        role: 'assistant',
        content: assistantReply.content,
        meta: assistantReply.meta,
      })
      .select('id, thread_id, role, content, meta, created_at')
      .single();

    if (assistantMessageErr || !assistantMessageData) {
      log.error('lito_assistant_message_insert_failed', {
        error_code: assistantMessageErr?.code || null,
        error: assistantMessageErr?.message || null,
        thread_id: thread.id,
      });
      return withStandardHeaders(
        NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
        requestId,
      );
    }

    const admin = createAdminClient();

    // Count user messages that existed before this insert (for title auto-update)
    const { count: existingUserMessagesCount } = await admin
      .from('lito_messages')
      .select('id', { count: 'exact', head: true })
      .eq('thread_id', thread.id)
      .eq('role', 'user')
      .neq('id', (userMessageData as { id: string }).id);

    const threadUpdates: Record<string, string> = {
      updated_at: new Date().toISOString(),
    };

    if ((existingUserMessagesCount || 0) === 0 && isPlaceholderThreadTitle(thread.title)) {
      threadUpdates.title = makeThreadTitleFromText(payload.content);
    }

    const { error: threadUpdateErr } = await admin
      .from('lito_threads')
      .update(threadUpdates)
      .eq('id', thread.id);

    if (threadUpdateErr) {
      log.warn('lito_thread_touch_failed', {
        error_code: threadUpdateErr.code || null,
        error: threadUpdateErr.message || null,
        thread_id: thread.id,
      });
    }

    return withStandardHeaders(
      NextResponse.json({
        ok: true,
        messages: [
          userMessageData as MessageRow,
          assistantMessageData as MessageRow,
        ],
        request_id: requestId,
      }),
      requestId,
    );
  } catch (error) {
    log.error('lito_thread_messages_post_unhandled', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withStandardHeaders(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}
