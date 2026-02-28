export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { getLitoBizAccess, type LitoActionDraftRow } from '@/lib/lito/action-drafts';
import {
  buildVoiceAssistantMessage,
  detectVoiceDraftSeeds,
  resolveVoiceAvailability,
} from '@/lib/lito/voice';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { validateBody } from '@/lib/validations';

const BodySchema = z.object({
  biz_id: z.string().uuid(),
  thread_id: z.string().uuid().optional(),
  transcript_text: z.string().trim().min(3).max(4000),
  transcript_lang: z.string().trim().min(2).max(12).optional(),
});

type ThreadRow = {
  id: string;
  biz_id: string;
};

type VoiceClipRow = {
  id: string;
};

type OrganizationRow = {
  id: string;
  ai_provider: string | null;
};

type MessageRow = {
  id: string;
  thread_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  meta: unknown;
  created_at: string;
};

function withStandardHeaders(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('x-request-id', requestId);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export async function POST(request: Request) {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'POST /api/lito/voice/transcribe' });

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

    const access = await getLitoBizAccess({
      supabase,
      userId: user.id,
      bizId: payload.biz_id,
    });
    if (!access.allowed || !access.orgId || !access.role) {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    const admin = createAdminClient();

    if (payload.thread_id) {
      const { data: threadData, error: threadErr } = await admin
        .from('lito_threads')
        .select('id, biz_id')
        .eq('id', payload.thread_id)
        .maybeSingle();

      if (threadErr || !threadData || (threadData as ThreadRow).biz_id !== payload.biz_id) {
        return withStandardHeaders(
          NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
          requestId,
        );
      }
    }

    const { data: orgData } = await admin
      .from('organizations')
      .select('id, ai_provider')
      .eq('id', access.orgId)
      .maybeSingle();

    const availability = resolveVoiceAvailability((orgData as OrganizationRow | null)?.ai_provider ?? null);
    if (!availability.enabled) {
      return withStandardHeaders(
        NextResponse.json(
          {
            error: 'voice_unavailable',
            reason: availability.reason,
            message: availability.message,
            request_id: requestId,
          },
          { status: 503 },
        ),
        requestId,
      );
    }

    const transcriptText = payload.transcript_text.trim();
    const transcriptLang = payload.transcript_lang?.trim() || 'ca';

    const { data: clipData, error: clipErr } = await admin
      .from('lito_voice_clips')
      .insert({
        org_id: access.orgId,
        biz_id: payload.biz_id,
        thread_id: payload.thread_id ?? null,
        user_id: user.id,
        status: 'transcribed',
        transcript: transcriptText,
        transcript_lang: transcriptLang,
        meta: {
          source: 'manual_transcript',
          provider: availability.provider,
        },
      })
      .select('id')
      .single();

    if (clipErr || !clipData) {
      log.error('lito_voice_clip_insert_failed', {
        error_code: clipErr?.code || null,
        error: clipErr?.message || null,
        biz_id: payload.biz_id,
      });
      return withStandardHeaders(
        NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
        requestId,
      );
    }

    const clipId = (clipData as VoiceClipRow).id;
    const draftSeeds = detectVoiceDraftSeeds(transcriptText);
    const createdDrafts: LitoActionDraftRow[] = [];

    for (const seed of draftSeeds) {
      const nowIso = new Date().toISOString();
      const { data: draftData, error: draftErr } = await admin
        .from('lito_action_drafts')
        .insert({
          org_id: access.orgId,
          biz_id: payload.biz_id,
          thread_id: payload.thread_id ?? null,
          source_voice_clip_id: clipId,
          kind: seed.kind,
          status: 'draft',
          payload: seed.payload,
          created_by: user.id,
          created_at: nowIso,
          updated_at: nowIso,
        })
        .select('id, org_id, biz_id, thread_id, source_voice_clip_id, kind, status, payload, created_by, reviewed_by, created_at, updated_at')
        .single();

      if (!draftErr && draftData) {
        createdDrafts.push(draftData as LitoActionDraftRow);
        continue;
      }

      if (draftErr?.code === '23505') {
        const { data: existingData } = await admin
          .from('lito_action_drafts')
          .select('id, org_id, biz_id, thread_id, source_voice_clip_id, kind, status, payload, created_by, reviewed_by, created_at, updated_at')
          .eq('source_voice_clip_id', clipId)
          .eq('kind', seed.kind)
          .maybeSingle();
        if (existingData) {
          createdDrafts.push(existingData as LitoActionDraftRow);
          continue;
        }
      }

      log.warn('lito_action_draft_insert_failed', {
        error_code: draftErr?.code || null,
        error: draftErr?.message || null,
        clip_id: clipId,
        kind: seed.kind,
      });
    }

    const insertedMessages: MessageRow[] = [];
    if (payload.thread_id) {
      const { data: userMessageData } = await admin
        .from('lito_messages')
        .insert({
          thread_id: payload.thread_id,
          role: 'user',
          content: `🎙️ ${transcriptText}`,
          meta: {
            type: 'voice_transcript',
            clip_id: clipId,
            transcript_lang: transcriptLang,
          },
        })
        .select('id, thread_id, role, content, meta, created_at')
        .single();

      if (userMessageData) {
        insertedMessages.push(userMessageData as MessageRow);
      }

      const assistantSummary = buildVoiceAssistantMessage({
        transcript: transcriptText,
        drafts: createdDrafts.map((item) => ({ kind: item.kind, status: item.status })),
      });
      const { data: assistantMessageData } = await admin
        .from('lito_messages')
        .insert({
          thread_id: payload.thread_id,
          role: 'assistant',
          content: assistantSummary,
          meta: {
            type: 'voice_actions_summary',
            clip_id: clipId,
            actions_count: createdDrafts.length,
          },
        })
        .select('id, thread_id, role, content, meta, created_at')
        .single();

      if (assistantMessageData) {
        insertedMessages.push(assistantMessageData as MessageRow);
      }

      await admin
        .from('lito_threads')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', payload.thread_id);
    }

    return withStandardHeaders(
      NextResponse.json({
        ok: true,
        clip_id: clipId,
        transcript: {
          text: transcriptText,
          lang: transcriptLang,
        },
        actions: createdDrafts,
        messages: insertedMessages,
        viewer_role: access.role,
        request_id: requestId,
      }),
      requestId,
    );
  } catch (error) {
    log.error('lito_voice_transcribe_unhandled', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withStandardHeaders(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}
