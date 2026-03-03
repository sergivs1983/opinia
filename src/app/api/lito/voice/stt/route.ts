export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

import crypto from 'node:crypto';

import { NextResponse } from 'next/server';

import { requireBizAccessPatternB } from '@/lib/api-handler';
import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { getVoiceDayBucket } from '@/lib/lito/voice-idempotency';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import {
  transcribeWithWhisper,
  validateAudioUpload,
  VoiceProviderUnavailableError,
} from '@/lib/voice/openai';

type ThreadRow = {
  id: string;
  biz_id: string;
};

type VoiceClipRow = {
  id: string;
  transcript: string | null;
  transcript_lang: string | null;
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

function parseDurationSeconds(raw: FormDataEntryValue | null): number | undefined {
  if (typeof raw !== 'string') return undefined;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
}

function normalizeLang(raw: FormDataEntryValue | null): string {
  if (typeof raw !== 'string') return 'ca';
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'es' || normalized === 'en' || normalized === 'ca') return normalized;
  return normalized.slice(0, 12) || 'ca';
}

export async function POST(request: Request) {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'POST /api/lito/voice/stt' });

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

    const formData = await request.formData();
    const bizId = typeof formData.get('biz_id') === 'string' ? String(formData.get('biz_id')).trim() : '';
    const threadIdRaw = typeof formData.get('thread_id') === 'string' ? String(formData.get('thread_id')).trim() : '';
    const threadId = threadIdRaw || null;
    const lang = normalizeLang(formData.get('lang'));
    const durationSeconds = parseDurationSeconds(formData.get('duration_seconds'));
    const audioEntry = formData.get('audio');

    if (!bizId || !/^[0-9a-f-]{36}$/i.test(bizId)) {
      return withStandardHeaders(
        NextResponse.json({ error: 'bad_request', message: 'biz_id invàlid', request_id: requestId }, { status: 400 }),
        requestId,
      );
    }

    if (!(audioEntry instanceof File)) {
      return withStandardHeaders(
        NextResponse.json({ error: 'bad_request', message: 'audio requerit', request_id: requestId }, { status: 400 }),
        requestId,
      );
    }

    const audioValidation = validateAudioUpload(audioEntry, durationSeconds);
    if (!audioValidation.ok) {
      return withStandardHeaders(
        NextResponse.json(
          { error: 'bad_request', reason: audioValidation.reason, message: 'Audio invàlid', request_id: requestId },
          { status: 400 },
        ),
        requestId,
      );
    }

    const access = await requireBizAccessPatternB(request, bizId, {
      supabase,
      user,
      bodyBizId: bizId,
    });
    if (access instanceof NextResponse) return withStandardHeaders(access, requestId);
    if (access.role !== 'owner' && access.role !== 'manager' && access.role !== 'staff') {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    const admin = createAdminClient();

    if (threadId) {
      const { data: threadData, error: threadErr } = await admin
        .from('lito_threads')
        .select('id, biz_id')
        .eq('id', threadId)
        .maybeSingle();

      if (threadErr || !threadData || (threadData as ThreadRow).biz_id !== access.bizId) {
        return withStandardHeaders(
          NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
          requestId,
        );
      }
    }

    const bytes = Buffer.from(await audioEntry.arrayBuffer());
    const dayBucket = getVoiceDayBucket();
    const idempotencyKey = crypto
      .createHash('sha256')
      .update(`${user.id}|${bizId}|${threadId || 'no-thread'}|${lang}|${dayBucket}|`)
      .update(bytes)
      .digest('hex');

    const { data: existingClip, error: existingClipErr } = await admin
      .from('lito_voice_clips')
      .select('id, transcript, transcript_lang')
      .eq('org_id', access.membership.orgId)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();

    if (existingClipErr && !isMissingColumnError(existingClipErr)) {
      log.warn('voice_stt_idempotency_lookup_failed', {
        error_code: existingClipErr.code || null,
        error: existingClipErr.message || null,
      });
    }

    if (existingClip) {
      const clip = existingClip as VoiceClipRow;
      return withStandardHeaders(
        NextResponse.json({
          ok: true,
          idempotent: true,
          clip_id: clip.id,
          transcript: clip.transcript || '',
          transcript_lang: clip.transcript_lang || lang,
          request_id: requestId,
        }),
        requestId,
      );
    }

    const fileForWhisper = new Blob([bytes], { type: audioEntry.type || 'audio/webm' });

    let whisper;
    try {
      whisper = await transcribeWithWhisper({
        file: fileForWhisper,
        fileName: audioEntry.name || 'voice.webm',
        language: lang,
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

    const nowIso = new Date().toISOString();
    const insertPayload = {
      org_id: access.membership.orgId,
      biz_id: access.bizId,
      thread_id: threadId,
      user_id: user.id,
      status: 'transcribed',
      transcript: whisper.transcript,
      transcript_lang: whisper.language || lang,
      idempotency_key: idempotencyKey,
      meta: {
        type: 'stt_whisper',
        provider: 'openai',
        model: whisper.model,
        pii_redacted: true,
      },
      expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      deleted_at: null as string | null,
      created_at: nowIso,
    };

    let clipData: VoiceClipRow | null = null;
    let clipError: PostgrestErrorShape | null = null;

    const insertWithFullSchema = await admin
      .from('lito_voice_clips')
      .insert(insertPayload)
      .select('id, transcript, transcript_lang')
      .single();

    clipData = (insertWithFullSchema.data as VoiceClipRow | null) || null;
    clipError = insertWithFullSchema.error as PostgrestErrorShape | null;

    if ((clipError || !clipData) && isMissingColumnError(clipError)) {
      const fallbackInsert = await admin
        .from('lito_voice_clips')
        .insert({
          org_id: access.membership.orgId,
          biz_id: access.bizId,
          thread_id: threadId,
          user_id: user.id,
          status: 'transcribed',
          transcript: whisper.transcript,
          transcript_lang: whisper.language || lang,
          meta: {
            type: 'stt_whisper',
            provider: 'openai',
            model: whisper.model,
            pii_redacted: true,
          },
          created_at: nowIso,
        })
        .select('id, transcript, transcript_lang')
        .single();

      clipData = (fallbackInsert.data as VoiceClipRow | null) || null;
      clipError = fallbackInsert.error as PostgrestErrorShape | null;
    }

    if ((clipError?.code === '23505' || clipError?.code === '409') && !clipData) {
      const { data: existingClipAfterConflict } = await admin
        .from('lito_voice_clips')
        .select('id, transcript, transcript_lang')
        .eq('org_id', access.membership.orgId)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();

      if (existingClipAfterConflict) {
        const clip = existingClipAfterConflict as VoiceClipRow;
        return withStandardHeaders(
          NextResponse.json({
            ok: true,
            idempotent: true,
            clip_id: clip.id,
            transcript: clip.transcript || whisper.transcript,
            transcript_lang: clip.transcript_lang || whisper.language || lang,
            request_id: requestId,
          }),
          requestId,
        );
      }
    }

    if (clipError || !clipData) {
      log.error('voice_stt_clip_insert_failed', {
        error_code: clipError?.code || null,
        error: clipError?.message || null,
        biz_id: access.bizId,
      });
      return withStandardHeaders(
        NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
        requestId,
      );
    }

    return withStandardHeaders(
      NextResponse.json({
        ok: true,
        idempotent: false,
        clip_id: clipData.id,
        transcript: whisper.transcript,
        transcript_lang: whisper.language || lang,
        request_id: requestId,
      }),
      requestId,
    );
  } catch (error) {
    log.error('voice_stt_unhandled', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withStandardHeaders(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}
