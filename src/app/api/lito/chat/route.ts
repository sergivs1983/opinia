export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { resolveProvider } from '@/lib/ai/provider';
import { callLLM } from '@/lib/llm/provider';
import { createLogger } from '@/lib/logger';
import { getLitoBizAccess } from '@/lib/lito/action-drafts';
import { getLitoCardsCacheByBiz, normalizeCachedCards } from '@/lib/lito/cards-cache';
import { buildLITOPayload } from '@/lib/lito/context/build';
import type { LITOChatMode, LITOPayload } from '@/lib/lito/context/types';
import { projectCardsForRole, sortCardsByPriority } from '@/lib/lito/orchestrator';
import {
  applyOrchestratorCopyOverrides,
  type LitoOrchestratorSafeOutput,
  validateOrchestratorSafeOutput,
} from '@/lib/lito/output/schema';
import { buildOrchestratorSafePrompt } from '@/lib/lito/prompt/orchestrator-safe';
import { buildLitoSystemPrompt } from '@/lib/lito/prompt/system';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { ActionCard, ActionCardMode, ActionCardRole } from '@/types/lito-cards';

const BodySchema = z.object({
  biz_id: z.string().uuid(),
  message: z.string().trim().min(1).max(2000),
  thread_id: z.string().uuid().optional(),
  mode: z.enum(['chat', 'orchestrator', 'orchestrator_safe']).optional(),
});

type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

type SSEChunk = {
  event: string;
  data: unknown;
};

function withNoStore(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('x-request-id', requestId);
  return response;
}

function jsonNoStore(body: Record<string, unknown>, requestId: string, status = 200): NextResponse {
  return withNoStore(NextResponse.json(body, { status }), requestId);
}

function encodeSseChunk(chunk: SSEChunk): string {
  return `event: ${chunk.event}\ndata: ${JSON.stringify(chunk.data)}\n\n`;
}

function compactText(value: unknown, max = 180): string {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!text) return '';
  return text.slice(0, max);
}

function parseRole(role: string | null | undefined): ActionCardRole | null {
  if (role === 'owner' || role === 'manager' || role === 'staff') return role;
  return null;
}

function parseActionCardsMode(mode: string | null | undefined): ActionCardMode {
  return mode === 'advanced' ? 'advanced' : 'basic';
}

function buildUserPrompt(input: {
  payload: LITOPayload;
  message: string;
  mode: LITOChatMode;
}): string {
  const { payload } = input;
  const signalLine = payload.signals_context.top
    .slice(0, 3)
    .map((signal) => `${compactText(signal.title, 80)} (${compactText(signal.metric, 80)})`)
    .join(' | ');

  const state = payload.state_context;

  return [
    `Mode: ${input.mode}`,
    `Business summary:\n${payload.context_summary}`,
    'State snapshot:',
    `- due_today_count: ${state.due_today_count}`,
    `- pending_drafts_count: ${state.pending_drafts_count}`,
    `- scheduled_this_week_count: ${state.scheduled_this_week_count}`,
    `- snoozed_or_missed_count: ${state.snoozed_or_missed_count}`,
    `- days_since_last_published: ${state.days_since_last_published ?? 'null'}`,
    `- active_signals_count: ${payload.signals_context.active_count}`,
    `- top_signals: ${signalLine || 'none'}`,
    `User message:\n${input.message}`,
  ].join('\n');
}

function toAnthropicMessages(messages: ChatMessage[]): {
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  const system = messages
    .filter((entry) => entry.role === 'system')
    .map((entry) => entry.content)
    .join('\n\n')
    .trim();

  const list = messages
    .filter((entry) => entry.role !== 'system')
    .map((entry) => ({
      role: entry.role as 'user' | 'assistant',
      content: entry.content,
    }));

  return {
    system,
    messages: list.length > 0 ? list : [{ role: 'user', content: '' }],
  };
}

async function consumeSSEStream(input: {
  stream: ReadableStream<Uint8Array>;
  onEvent: (eventName: string, data: string) => Promise<void> | void;
}): Promise<void> {
  const reader = input.stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let delimiter = buffer.indexOf('\n\n');
    while (delimiter >= 0) {
      const rawEvent = buffer.slice(0, delimiter);
      buffer = buffer.slice(delimiter + 2);

      const lines = rawEvent
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter(Boolean);

      let eventName = 'message';
      const dataLines: string[] = [];

      for (const line of lines) {
        if (line.startsWith(':')) continue;
        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim() || 'message';
          continue;
        }
        if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart());
        }
      }

      const data = dataLines.join('\n');
      if (data.length > 0) {
        await input.onEvent(eventName, data);
      }

      delimiter = buffer.indexOf('\n\n');
    }
  }
}

async function streamFromOpenAI(input: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  mode: LITOChatMode;
  signal: AbortSignal;
  onDelta: (value: string) => void;
}): Promise<void> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({
      model: input.model,
      messages: input.messages,
      max_tokens: 800,
      temperature: 0.5,
      stream: true,
      ...(input.mode === 'orchestrator' ? { response_format: { type: 'json_object' } } : {}),
    }),
    signal: input.signal,
  });

  if (!response.ok || !response.body) {
    const details = await response.text().catch(() => '');
    throw new Error(`openai_stream_failed:${response.status}:${details.slice(0, 200)}`);
  }

  await consumeSSEStream({
    stream: response.body,
    onEvent: async (_eventName, data) => {
      if (data === '[DONE]') return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        return;
      }
      const delta = (parsed as { choices?: Array<{ delta?: { content?: string } }> }).choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta.length > 0) {
        input.onDelta(delta);
      }
    },
  });
}

async function streamFromAnthropic(input: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  signal: AbortSignal;
  onDelta: (value: string) => void;
}): Promise<void> {
  const normalized = toAnthropicMessages(input.messages);
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': input.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: input.model,
      max_tokens: 800,
      temperature: 0.5,
      stream: true,
      system: normalized.system || undefined,
      messages: normalized.messages,
    }),
    signal: input.signal,
  });

  if (!response.ok || !response.body) {
    const details = await response.text().catch(() => '');
    throw new Error(`anthropic_stream_failed:${response.status}:${details.slice(0, 200)}`);
  }

  await consumeSSEStream({
    stream: response.body,
    onEvent: async (eventName, data) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        return;
      }

      const typed = parsed as {
        type?: string;
        delta?: { text?: string };
      };

      if (eventName === 'content_block_delta' || typed.type === 'content_block_delta') {
        const delta = typed.delta?.text;
        if (typeof delta === 'string' && delta.length > 0) {
          input.onDelta(delta);
        }
      }
    },
  });
}

function sseResponse(input: {
  requestId: string;
  writer: (push: (chunk: SSEChunk) => void) => Promise<void>;
}): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const push = (chunk: SSEChunk): void => {
        controller.enqueue(encoder.encode(encodeSseChunk(chunk)));
      };

      void (async () => {
        try {
          await input.writer(push);
        } finally {
          controller.close();
        }
      })();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'x-request-id': input.requestId,
    },
  });
}

async function loadCardsForOrchestrator(input: {
  admin: ReturnType<typeof createAdminClient>;
  bizId: string;
  role: ActionCardRole;
}): Promise<{ mode: ActionCardMode; cards: ActionCard[] }> {
  const cached = await getLitoCardsCacheByBiz({
    admin: input.admin,
    bizId: input.bizId,
  });

  if (!cached) {
    return {
      mode: 'basic',
      cards: [],
    };
  }

  const mode = parseActionCardsMode(cached.mode);
  const cards = sortCardsByPriority(
    projectCardsForRole(normalizeCachedCards(cached.cards), input.role),
  );

  return { mode, cards };
}

function buildOrchestratorResponse(input: {
  output: LitoOrchestratorSafeOutput;
  allCards: ActionCard[];
}): {
  greeting: string;
  priority_message: string;
  next_question: string;
  selected_card_ids: string[];
  cards_final: ActionCard[];
} {
  const byId = new Map(input.allCards.map((card) => [card.id, card]));
  const selectedCards = input.output.selected_card_ids
    .map((id) => byId.get(id))
    .filter((card): card is ActionCard => Boolean(card));
  const cardsWithCopy = applyOrchestratorCopyOverrides({
    cards: selectedCards,
    cardsCopy: input.output.cards_copy,
  });

  return {
    greeting: input.output.greeting,
    priority_message: input.output.priority_message,
    next_question: input.output.next_question,
    selected_card_ids: input.output.selected_card_ids,
    cards_final: cardsWithCopy,
  };
}

export async function POST(request: NextRequest): Promise<Response> {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'POST /api/lito/chat' });

  let parsedBody: z.infer<typeof BodySchema>;
  try {
    const raw = await request.json();
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return jsonNoStore(
        {
          ok: false,
          code: 'bad_request',
          message: parsed.error.issues[0]?.message || 'Body invàlid',
          request_id: requestId,
        },
        requestId,
        400,
      );
    }
    parsedBody = parsed.data;
  } catch {
    return jsonNoStore(
      {
        ok: false,
        code: 'bad_request',
        message: 'JSON invàlid',
        request_id: requestId,
      },
      requestId,
      400,
    );
  }

  const supabase = createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return jsonNoStore(
      {
        ok: false,
        code: 'unauthorized',
        message: 'Auth required',
        request_id: requestId,
      },
      requestId,
      401,
    );
  }

  const access = await getLitoBizAccess({
    supabase,
    userId: user.id,
    bizId: parsedBody.biz_id,
  });

  const role = parseRole(access.role);
  if (!access.allowed || !access.orgId || !role) {
    return jsonNoStore(
      {
        ok: false,
        code: 'not_found',
        message: 'No disponible',
        request_id: requestId,
      },
      requestId,
      404,
    );
  }

  const mode: LITOChatMode = parsedBody.mode || 'chat';

  let payload: LITOPayload;
  let actionCardsMode: ActionCardMode = 'basic';
  let allCards: ActionCard[] = [];
  try {
    const admin = createAdminClient();
    payload = await buildLITOPayload({
      admin,
      bizId: parsedBody.biz_id,
      userId: user.id,
      mode: 'advanced',
    });

    if (mode === 'orchestrator_safe') {
      const cardsBundle = await loadCardsForOrchestrator({
        admin,
        bizId: parsedBody.biz_id,
        role,
      });
      actionCardsMode = cardsBundle.mode;
      allCards = cardsBundle.cards;
    }
  } catch (error) {
    log.error('lito_chat_context_build_failed', {
      biz_id: parsedBody.biz_id,
      user_id: user.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonNoStore(
      {
        ok: false,
        code: 'context_unavailable',
        message: 'No s’ha pogut preparar el context',
        request_id: requestId,
      },
      requestId,
      500,
    );
  }

  const providerState = resolveProvider({
    orgProvider: payload.business_context.ai_provider_preference,
  });

  if (!providerState.available) {
    return jsonNoStore(
      {
        ok: false,
        code: 'ai_unavailable',
        message: 'AI provider no disponible',
        request_id: requestId,
      },
      requestId,
      503,
    );
  }

  if (mode === 'orchestrator_safe') {
    if (allCards.length === 0) {
      return sseResponse({
        requestId,
        writer: async (push) => {
          push({
            event: 'meta',
            data: {
              ok: true,
              mode,
              cards_mode: actionCardsMode,
              generated_at: payload.generated_at,
              provider: providerState.provider,
            },
          });

          push({
            event: 'json',
            data: {
              greeting: payload.business_context.language === 'es'
                ? 'Vamos paso a paso.'
                : payload.business_context.language === 'en'
                  ? 'Let us go step by step.'
                  : 'Anem pas a pas.',
              priority_message: payload.business_context.language === 'es'
                ? 'No hay tarjetas activas ahora.'
                : payload.business_context.language === 'en'
                  ? 'No active cards right now.'
                  : 'Ara mateix no hi ha targetes actives.',
              next_question: payload.business_context.language === 'es'
                ? '¿Quieres que revisemos mañana?'
                : payload.business_context.language === 'en'
                  ? 'Should we check again tomorrow?'
                  : 'Vols que ho revisem demà?',
              selected_card_ids: [],
              cards_final: [],
              queue_count: 0,
              mode: actionCardsMode,
            },
          });

          push({ event: 'done', data: { ok: true } });
        },
      });
    }

    const systemPrompt = buildLitoSystemPrompt({
      payload,
      mode,
    });
    const orchestratorPrompt = buildOrchestratorSafePrompt({
      payload,
      role,
      mode: actionCardsMode,
      message: parsedBody.message,
      cards: allCards,
    });

    let llmRaw: string;
    try {
      const llmResponse = await callLLM({
        provider: providerState.provider as 'openai' | 'anthropic',
        model: providerState.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: orchestratorPrompt },
        ],
        temperature: 0.2,
        maxTokens: 700,
        json: true,
      });
      llmRaw = llmResponse.content || '';
    } catch (error) {
      log.warn('lito_orchestrator_safe_llm_failed', {
        biz_id: parsedBody.biz_id,
        user_id: user.id,
        provider: providerState.provider,
        error: error instanceof Error ? error.message : String(error),
      });
      return jsonNoStore(
        {
          ok: false,
          code: 'ai_unavailable',
          message: 'No he pogut generar el resum ara mateix',
          request_id: requestId,
        },
        requestId,
        503,
      );
    }

    const validated = validateOrchestratorSafeOutput({
      raw: llmRaw,
      cards: allCards,
      mode: actionCardsMode,
    });
    if (!validated.ok) {
      log.warn('lito_orchestrator_safe_bad_output', {
        biz_id: parsedBody.biz_id,
        user_id: user.id,
        provider: providerState.provider,
        error: validated.error,
      });
      return jsonNoStore(
        {
          ok: false,
          code: 'ai_bad_output',
          message: 'Resposta IA invàlida',
          request_id: requestId,
        },
        requestId,
        502,
      );
    }

    const finalJson = buildOrchestratorResponse({
      output: validated.value,
      allCards,
    });

    return sseResponse({
      requestId,
      writer: async (push) => {
        push({
          event: 'meta',
          data: {
            ok: true,
            mode,
            cards_mode: actionCardsMode,
            generated_at: payload.generated_at,
            provider: providerState.provider,
          },
        });
        push({
          event: 'json',
          data: {
            ...finalJson,
            queue_count: allCards.length,
            mode: actionCardsMode,
          },
        });
        push({
          event: 'done',
          data: {
            ok: true,
          },
        });
      },
    });
  }

  const systemPrompt = buildLitoSystemPrompt({
    payload,
    mode,
  });
  const userPrompt = buildUserPrompt({
    payload,
    message: parsedBody.message,
    mode,
  });

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  const upstreamAbort = new AbortController();
  const onAbort = () => upstreamAbort.abort();
  request.signal.addEventListener('abort', onAbort, { once: true });

  return sseResponse({
    requestId,
    writer: async (push) => {
      let fullText = '';
      try {
        push({
          event: 'meta',
          data: {
            ok: true,
            provider: providerState.provider,
            mode,
            generated_at: payload.generated_at,
          },
        });

        if (providerState.provider === 'anthropic') {
          const key = process.env.ANTHROPIC_API_KEY;
          if (!key) throw new Error('anthropic_key_missing');
          await streamFromAnthropic({
            apiKey: key,
            model: providerState.model,
            messages,
            signal: upstreamAbort.signal,
            onDelta: (delta) => {
              fullText += delta;
              push({ event: 'token', data: { delta } });
            },
          });
        } else {
          const key = process.env.OPENAI_API_KEY;
          if (!key) throw new Error('openai_key_missing');
          await streamFromOpenAI({
            apiKey: key,
            model: providerState.model,
            messages,
            mode,
            signal: upstreamAbort.signal,
            onDelta: (delta) => {
              fullText += delta;
              push({ event: 'token', data: { delta } });
            },
          });
        }

        push({
          event: 'done',
          data: {
            ok: true,
            text: fullText,
          },
        });
      } catch (error) {
        log.warn('lito_chat_stream_failed', {
          biz_id: parsedBody.biz_id,
          user_id: user.id,
          provider: providerState.provider,
          error: error instanceof Error ? error.message : String(error),
        });
        push({
          event: 'error',
          data: {
            ok: false,
            code: 'stream_failed',
            message: 'No he pogut respondre ara mateix. Torna-ho a provar.',
          },
        });
      } finally {
        request.signal.removeEventListener('abort', onAbort);
      }
    },
  });
}
