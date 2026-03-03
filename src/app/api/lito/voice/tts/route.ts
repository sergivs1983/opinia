export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireBizAccessPatternB } from '@/lib/api-handler';
import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { validateBody } from '@/lib/validations';
import {
  buildTTSAudioDataUrl,
  buildTTSFingerprint,
  normalizeVoiceTextForTTS,
  synthesizeWithOpenAITTS,
  VoiceProviderUnavailableError,
} from '@/lib/voice/openai';

const BodySchema = z.object({
  biz_id: z.string().uuid(),
  message_id: z.string().uuid(),
  lang: z.string().trim().min(2).max(12).optional(),
  voice: z.string().trim().min(2).max(32).optional(),
});

type ThreadRow = {
  id: string;
  biz_id: string;
};

type MessageRow = {
  id: string;
  thread_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
};

type VoiceClipRow = {
  id: string;
  audio_url: string | null;
  transcript_lang: string | null;
  meta: unknown;
};

type PostgrestErrorShape = {
  code?: string;
  message?: string;
};

function withStandardHeaders(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('x-request-id', requestId);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function isMissingColumnError(error: PostgrestErrorShape | null | undefined): boolean {
  return error?.code === '42703' || error?.code === 'PGRST204';
}

function normalizeLang(raw?: string): string {
  const value = (raw || '').trim().toLowerCase();
  if (value === 'ca' || value === 'es' || value === 'en') return value;
  return 'ca';
}

export async function POST(request: Request) {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'POST /api/lito/voice/tts' });

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

    const [body, bodyErr] = await validateBody(request, BodySchema);
    if (bodyErr) return withStandardHeaders(bodyErr, requestId);
    const payload = body as z.infer<typeof BodySchema>;

    const access = await requireBizAccessPatternB(request, payload.biz_id, {
      supabase,
      user,
      bodyBizId: payload.biz_id,
    });
    if (access instanceof NextResponse) return withStandardHeaders(access, requestId);
    if (access.role !== 'owner' && access.role !== 'manager' && access.role !== 'staff') {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    const admin = createAdminClient();

    const { data: messageData, error: messageErr } = await admin
      .from('lito_messages')
      .select('id, thread_id, role, content')
      .eq('id', payload.message_id)
      .maybeSingle();

    if (messageErr || !messageData) {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    const message = messageData as MessageRow;
    const { data: threadData, error: threadErr } = await admin
      .from('lito_threads')
      .select('id, biz_id')
      .eq('id', message.thread_id)
      .maybeSingle();

    if (threadErr || !threadData || (threadData as ThreadRow).biz_id !== access.bizId) {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    const safeText = normalizeVoiceTextForTTS(message.content || '');
    if (!safeText) {
      return withStandardHeaders(
        NextResponse.json({ error: 'bad_request', message: 'Missatge buit per TTS', request_id: requestId }, { status: 400 }),
        requestId,
      );
    }

    const lang = normalizeLang(payload.lang);
    const voice = (payload.voice || 'alloy').trim().toLowerCase();
    const fingerprint = buildTTSFingerprint({
      messageId: message.id,
      text: safeText,
      lang,
      voice,
    });

    const nowIso = new Date().toISOString();
    const { data: cachedClipData, error: cachedClipErr } = await admin
      .from('lito_voice_clips')
      .select('id, audio_url, transcript_lang, meta')
      .eq('org_id', access.membership.orgId)
      .eq('biz_id', access.bizId)
      .eq('thread_id', message.thread_id)
      .contains('meta', { type: 'tts', fingerprint })
      .is('deleted_at', null)
      .gt('expires_at', nowIso)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let cachedClip = cachedClipData as VoiceClipRow | null;
    if (cachedClipErr && isMissingColumnError(cachedClipErr)) {
      const fallbackCached = await admin
        .from('lito_voice_clips')
        .select('id, audio_url, transcript_lang, meta')
        .eq('org_id', access.membership.orgId)
        .eq('biz_id', access.bizId)
        .eq('thread_id', message.thread_id)
        .contains('meta', { type: 'tts', fingerprint })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      cachedClip = (fallbackCached.data as VoiceClipRow | null) || null;
    } else if (cachedClipErr) {
      log.warn('voice_tts_cache_lookup_failed', {
        error_code: cachedClipErr.code || null,
        error: cachedClipErr.message || null,
        message_id: message.id,
      });
    }

    if (cachedClip?.audio_url) {
      return withStandardHeaders(
        NextResponse.json({
          ok: true,
          cached: true,
          clip_id: cachedClip.id,
          audio_url: cachedClip.audio_url,
          transcript_lang: cachedClip.transcript_lang || lang,
          request_id: requestId,
        }),
        requestId,
      );
    }

    let tts;
    try {
      tts = await synthesizeWithOpenAITTS({
        text: safeText,
        voice,
        format: 'mp3',
      });
    } catch (error) {
      if (error instanceof VoiceProviderUnavailableError) {
        return withStandardHeaders(
          NextResponse.json(
            { error: 'voice_unavailable', reason: error.reason, message: error.message, request_id: requestId },
            { status: 503 },
          ),
          requestId,
        );
      }
      throw error;
    }

    const audioUrl = buildTTSAudioDataUrl({ mimeType: tts.mimeType, audioBase64: tts.audioBase64 });
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

    const insertPayload = {
      org_id: access.membership.orgId,
      biz_id: access.bizId,
      thread_id: message.thread_id,
      user_id: user.id,
      status: 'uploaded',
      audio_url: audioUrl,
      transcript: safeText,
      transcript_lang: lang,
      idempotency_key: fingerprint,
      meta: {
        type: 'tts',
        provider: 'openai',
        model: tts.model,
        voice,
        format: tts.format,
        message_id: message.id,
        fingerprint,
        pii_redacted: true,
      },
      expires_at: expiresAt,
      deleted_at: null as string | null,
      created_at: nowIso,
    };

    const inserted = await admin
      .from('lito_voice_clips')
      .insert(insertPayload)
      .select('id, audio_url, transcript_lang, meta')
      .single();

    let clipData = inserted.data as VoiceClipRow | null;
    let clipErr = inserted.error as PostgrestErrorShape | null;
    if ((clipErr || !clipData) && isMissingColumnError(clipErr)) {
      const fallbackInsert = await admin
        .from('lito_voice_clips')
        .insert({
          org_id: access.membership.orgId,
          biz_id: access.bizId,
          thread_id: message.thread_id,
          user_id: user.id,
          status: 'uploaded',
          audio_url: audioUrl,
          transcript: safeText,
          transcript_lang: lang,
          meta: {
            type: 'tts',
            provider: 'openai',
            model: tts.model,
            voice,
            format: tts.format,
            message_id: message.id,
            fingerprint,
            pii_redacted: true,
          },
          created_at: nowIso,
        })
        .select('id, audio_url, transcript_lang, meta')
        .single();
      clipData = (fallbackInsert.data as VoiceClipRow | null) || null;
      clipErr = fallbackInsert.error as PostgrestErrorShape | null;
    }

    if ((clipErr?.code === '23505' || clipErr?.code === '409') && !clipData) {
      const existingAfterConflict = await admin
        .from('lito_voice_clips')
        .select('id, audio_url, transcript_lang, meta')
        .eq('org_id', access.membership.orgId)
        .eq('idempotency_key', fingerprint)
        .maybeSingle();
      clipData = (existingAfterConflict.data as VoiceClipRow | null) || null;
      clipErr = existingAfterConflict.error as PostgrestErrorShape | null;
    }

    if (clipErr || !clipData || !clipData.audio_url) {
      log.error('voice_tts_cache_insert_failed', {
        error_code: clipErr?.code || null,
        error: clipErr?.message || null,
        message_id: message.id,
      });
      return withStandardHeaders(
        NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
        requestId,
      );
    }

    return withStandardHeaders(
      NextResponse.json({
        ok: true,
        cached: false,
        clip_id: clipData.id,
        audio_url: clipData.audio_url,
        transcript_lang: clipData.transcript_lang || lang,
        request_id: requestId,
      }),
      requestId,
    );
  } catch (error) {
    log.error('voice_tts_unhandled', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withStandardHeaders(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}
