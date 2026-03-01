export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { validateHmacHeader } from '@/lib/security/hmac';
import { createAdminClient } from '@/lib/supabase/admin';
import { log } from '@/lib/logger';

/**
 * POST /api/_internal/voice/purge
 *
 * Internal HMAC-authenticated endpoint that soft-deletes lito_voice_clips
 * rows whose TTL has elapsed (expires_at < now(), deleted_at IS NULL).
 * This applies to both STT clips and TTS cached clips.
 *
 * Authentication: x-opin-timestamp + x-opin-signature (HMAC-SHA256).
 *   Secret  : INTERNAL_HMAC_SECRET env var.
 *   Canonical: "{ts}.POST./api/_internal/voice/purge.{sha256(body)}"
 *   Replay   : 5-minute window enforced by validateHmacHeader().
 *
 * Returns: { ok: true, deleted: N }
 *
 * Callers: cron job / scripts/smoke-flow-voice-ttl.sh
 */

const PURGE_PATHNAME = '/api/_internal/voice/purge';

function withPurgeHeaders(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('x-request-id', requestId);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();

  try {
    // Read raw body before HMAC validation (must be read once)
    const rawBody = await request.text();

    const hmacResult = validateHmacHeader({
      timestampHeader: request.headers.get('x-opin-timestamp'),
      signatureHeader: request.headers.get('x-opin-signature'),
      method:          'POST',
      pathname:        PURGE_PATHNAME,
      rawBody,
    });

    if (!hmacResult.valid) {
      log.warn('voice_purge_hmac_rejected', { reason: hmacResult.reason, request_id: requestId });
      return withPurgeHeaders(
        NextResponse.json(
          { error: 'unauthorized', reason: hmacResult.reason },
          { status: 401 },
        ),
        requestId,
      );
    }

    const admin = createAdminClient();

    // Soft-delete all clips whose TTL has elapsed.
    // deleted_at IS NULL guard prevents double-marking.
    const now = new Date().toISOString();
    const { data, error } = await admin
      .from('lito_voice_clips')
      .update({ deleted_at: now })
      .lt('expires_at', now)
      .is('deleted_at', null)
      .select('id');

    if (error) {
      log.error('voice_purge_db_error', { error: error.message, request_id: requestId });
      return withPurgeHeaders(
        NextResponse.json(
          { error: 'db_error', message: error.message },
          { status: 500 },
        ),
        requestId,
      );
    }

    const deleted = data?.length ?? 0;
    log.info('voice_purge_complete', { deleted, clip_scope: 'stt+tts', request_id: requestId });

    return withPurgeHeaders(
      NextResponse.json({ ok: true, deleted }),
      requestId,
    );
  } catch (err) {
    log.error('voice_purge_unhandled', {
      error: err instanceof Error ? err.message : String(err),
      request_id: requestId,
    });
    return withPurgeHeaders(
      NextResponse.json({ error: 'internal' }, { status: 500 }),
      requestId,
    );
  }
}
