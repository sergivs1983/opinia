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

type AssistantChannel = 'instagram' | 'tiktok';

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

  const asStringArray = (value: unknown): string[] => (
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
  );

  const fromObject = (candidate: unknown): RecommendationTemplate | null => {
    if (!candidate || typeof candidate !== 'object') return null;
    const parsed = candidate as Record<string, unknown>;
    const format = typeof parsed.format === 'string' ? parsed.format : '';
    const hook = typeof parsed.hook === 'string' ? parsed.hook : '';
    const idea = typeof parsed.idea === 'string' ? parsed.idea : '';
    const cta = typeof parsed.cta === 'string' ? parsed.cta : '';
    if (!format || !hook || !idea || !cta) return null;

    const howToRaw = parsed.how_to && typeof parsed.how_to === 'object'
      ? parsed.how_to as Record<string, unknown>
      : null;
    const executionChecklist = asStringArray(parsed.execution_checklist);
    const shotlist = asStringArray(parsed.shotlist);

    return {
      format,
      hook,
      idea,
      cta,
      assets_needed: asStringArray(parsed.assets_needed),
      how_to: {
        why: typeof howToRaw?.why === 'string' ? howToRaw.why : 'Executa la recomanació amb una peça curta i clara.',
        steps: asStringArray(howToRaw?.steps).length > 0 ? asStringArray(howToRaw?.steps) : executionChecklist,
        checklist: asStringArray(howToRaw?.checklist).length > 0 ? asStringArray(howToRaw?.checklist) : executionChecklist,
        assets_needed: asStringArray(howToRaw?.assets_needed).length > 0 ? asStringArray(howToRaw?.assets_needed) : shotlist,
        time_estimate_min: typeof howToRaw?.time_estimate_min === 'number' ? howToRaw.time_estimate_min : 10,
      },
    };
  };

  if (typeof raw === 'object') {
    return fromObject(raw);
  }

  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return fromObject(parsed);
  } catch {
    // ignore parse errors; fallback to generic response
  }

  return null;
}

function normalizeFormat(value: string): 'post' | 'story' | 'reel' {
  const normalized = value.toLowerCase();
  if (normalized === 'story' || normalized === 'reel') return normalized;
  return 'post';
}

function detectChannelFromText(content: string): AssistantChannel {
  const text = content.toLowerCase();
  if (text.includes('tiktok') || text.includes('tik tok')) return 'tiktok';
  return 'instagram';
}

function wantsFullIkea(content: string): boolean {
  const text = content.toLowerCase();
  const triggers = [
    'pas a pas',
    'checklist',
    'com ho faig',
    'com es fa',
    'com fer-ho',
    'com faig',
    'how to',
    'step by step',
  ];
  return triggers.some((trigger) => text.includes(trigger));
}

function seemsLost(content: string): boolean {
  const text = content.toLowerCase();
  const lostSignals = [
    'no ho entenc',
    'estic perdut',
    'estic perduda',
    'no sé per on començar',
    'ajuda',
    'help',
    'em perdo',
  ];
  return lostSignals.some((signal) => text.includes(signal));
}

function buildImmediateSteps(params: {
  format: 'post' | 'story' | 'reel';
  channel: AssistantChannel;
  hook: string;
  idea: string;
  cta: string;
}): string[] {
  if (params.format === 'story') {
    if (params.channel === 'tiktok') {
      return [
        `Obre amb text gran i directe: "${params.hook}".`,
        `Tanca demanant comentaris amb una CTA breu: ${params.cta}.`,
      ];
    }
    return [
      `Story 1 amb hook clar: "${params.hook}".`,
      `Story 2 amb sticker + CTA final: ${params.cta}.`,
    ];
  }

  if (params.format === 'reel') {
    if (params.channel === 'tiktok') {
      return [
        `0-2s amb ganxo visual + text curt: "${params.hook}".`,
        `Tanca amb CTA a seguir/comentar: ${params.cta}.`,
      ];
    }
    return [
      `0-3s amb hook en pantalla: "${params.hook}".`,
      `Afegeix música en tendència i caption final: ${params.cta}.`,
    ];
  }

  if (params.channel === 'tiktok') {
    return [
      `Publica una frase molt directa amb el hook: "${params.hook}".`,
      `Acaba amb pregunta a comentaris + CTA: ${params.cta}.`,
    ];
  }
  return [
    `Fes un post curt amb hook + idea: "${params.hook}" / ${params.idea}.`,
    `Afegeix ubicació i tanca amb CTA: ${params.cta}.`,
  ];
}

function buildOptions(format: 'post' | 'story' | 'reel', channel: AssistantChannel): [string, string] {
  if (format === 'story') {
    return [
      `A) Story ràpida a ${channel} (2 pantalles).`,
      `B) Convertir-ho a Reel curt (10-15s).`,
    ];
  }
  if (format === 'reel') {
    return [
      `A) Reel curt (${channel}) amb hook en 3 segons.`,
      'B) Versió Post resumida per avui.',
    ];
  }
  return [
    `A) Post directe a ${channel} (publicació avui).`,
    'B) Adaptar-ho a Reel per més abast.',
  ];
}

function buildQuestion(format: 'post' | 'story' | 'reel', channel: AssistantChannel): string {
  if (format === 'story') return `Ho publiquem avui a ${channel} en format Story? (sí/no)`;
  if (format === 'reel') return `Vols que el fem en Reel curt a ${channel}? (sí/no)`;
  return `Ho vols publicar avui com a Post a ${channel}? (sí/no)`;
}

function buildAssistantReplyFromTemplate(params: {
  template: RecommendationTemplate;
  userMessage: string;
  hasCopy: boolean;
}): { content: string; meta: Record<string, unknown> } {
  const format = normalizeFormat(params.template.format);
  const channel = detectChannelFromText(params.userMessage);
  const fullIkea = wantsFullIkea(params.userMessage) || seemsLost(params.userMessage);
  const immediateSteps = buildImmediateSteps({
    format,
    channel,
    hook: params.template.hook,
    idea: params.template.idea,
    cta: params.template.cta,
  });
  const options = buildOptions(format, channel);
  const quickQuestion = buildQuestion(format, channel);

  const lines: string[] = [
    'Ara mateix:',
    `1) ${immediateSteps[0]}`,
    `2) ${immediateSteps[1]}`,
    '',
    'Pregunta ràpida:',
    quickQuestion,
    '',
  ];

  if (fullIkea) {
    const fullSteps = (params.template.how_to.steps || params.template.how_to.checklist || []).slice(0, 8);
    lines.push('Mode IKEA complet:');
    if (fullSteps.length > 0) {
      fullSteps.forEach((step, index) => lines.push(`${index + 1}. ${step}`));
    } else {
      lines.push(`1. ${immediateSteps[0]}`);
      lines.push(`2. ${immediateSteps[1]}`);
      lines.push('3. Revisa que el missatge sigui clar i amb CTA final.');
    }
    lines.push('');
  } else {
    lines.push('Opcions:');
    lines.push(options[0]);
    lines.push(options[1]);
    lines.push('');
  }

  lines.push('Si vols:');
  lines.push('Mostra Mode IKEA complet');

  return {
    content: lines.join('\n'),
    meta: {
      mode: 'deterministic_ikea_assist',
      format,
      channel,
      full_ikea: fullIkea,
      has_copy: params.hasCopy,
    },
  };
}

function buildGenericAssistantReply(userMessage: string): { content: string; meta: Record<string, unknown> } {
  const fullIkea = wantsFullIkea(userMessage) || seemsLost(userMessage);
  const lines: string[] = [
    'Ara mateix:',
    '1) Tria canal: Instagram o TikTok.',
    '2) Digue’m objectiu en 3 paraules (reserves, visites o confiança).',
    '',
    'Pregunta ràpida:',
    'Vols que ho enfoquem a reserves aquesta setmana? (sí/no)',
    '',
  ];

  if (fullIkea) {
    lines.push('Mode IKEA complet:');
    lines.push('1. Defineix una sola idea principal.');
    lines.push('2. Prepara una peça visual real del negoci.');
    lines.push('3. Escriu hook curt + CTA final.');
    lines.push('4. Publica en horari actiu i respon comentaris.');
    lines.push('');
  } else {
    lines.push('Opcions:');
    lines.push('A) Post curt avui.');
    lines.push('B) Reel curt demà.');
    lines.push('');
  }

  lines.push('Si vols:');
  lines.push('Mostra Mode IKEA complet');

  return {
    content: lines.join('\n'),
    meta: {
      mode: 'deterministic_generic',
      full_ikea: fullIkea,
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

    let assistantReply = buildGenericAssistantReply(payload.content);
    if (thread.recommendation_id) {
      const { data: recommendationData } = await supabase
        .from('recommendation_log')
        .select('generated_copy, recommendation_template, copy_short, copy_long')
        .eq('id', thread.recommendation_id)
        .eq('biz_id', thread.biz_id)
        .maybeSingle();

      const row = recommendationData as {
        generated_copy?: unknown;
        recommendation_template?: unknown;
        copy_short?: string | null;
        copy_long?: string | null;
      } | null;

      const parsed = parseTemplateFromGeneratedCopy(row?.generated_copy || null)
        || parseTemplateFromGeneratedCopy(row?.recommendation_template || null);

      const hasCopy = Boolean(
        (typeof row?.copy_short === 'string' && row.copy_short.trim().length > 0)
        || (typeof row?.copy_long === 'string' && row.copy_long.trim().length > 0),
      );
      if (parsed) {
        assistantReply = buildAssistantReplyFromTemplate({
          template: parsed,
          userMessage: payload.content,
          hasCopy,
        });
      }
    } else {
      assistantReply = buildGenericAssistantReply(payload.content);
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
