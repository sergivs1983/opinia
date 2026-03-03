export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireBizAccessPatternB } from '@/lib/api-handler';
import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { resolveVoiceCapabilities, type LitoVoicePrepareMode } from '@/lib/lito/voice';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { validateBody } from '@/lib/validations';

const BodySchema = z.object({
  biz_id: z.string().uuid(),
  thread_id: z.string().uuid().optional(),
});

type ThreadRow = {
  id: string;
  biz_id: string;
};

type OrganizationRow = {
  id: string;
  ai_provider: string | null;
};

function withStandardHeaders(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('x-request-id', requestId);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export async function POST(request: Request) {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'POST /api/lito/voice/prepare' });

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

    if (payload.thread_id) {
      const { data: threadData, error: threadErr } = await admin
        .from('lito_threads')
        .select('id, biz_id')
        .eq('id', payload.thread_id)
        .maybeSingle();

      if (threadErr || !threadData || (threadData as ThreadRow).biz_id !== access.bizId) {
        return withStandardHeaders(
          NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
          requestId,
        );
      }
    }

    const { data: orgData } = await admin
      .from('organizations')
      .select('id, ai_provider')
      .eq('id', access.membership.orgId)
      .maybeSingle();

    const capabilities = resolveVoiceCapabilities((orgData as OrganizationRow | null)?.ai_provider ?? null);

    // When voice is manually disabled, degrade gracefully to paste_transcript_only
    // instead of returning a hard 503 (P1 fix: LITO_VOICE_MANUAL_DISABLED must not
    // block transcript-based workflows that require no audio recording).
    const effectiveMode: LitoVoicePrepareMode = capabilities.enabled
      ? capabilities.mode
      : 'paste_transcript_only';

    // GDPR art. 5.1.e data minimisation notice — always included.
    const gdpr_notice =
      "L'àudio s'eliminarà automàticament passats 90 dies. " +
      'No conservem dades de veu més temps del necessari (RGPD art. 5.1.e).';

    return withStandardHeaders(
      NextResponse.json({
        ok: true,
        mode: effectiveMode,
        maxSeconds: 30,
        upload: {
          mode: effectiveMode,
          maxSeconds: 30,
        },
        provider: capabilities.provider,
        gdpr_notice,
        request_id: requestId,
      }),
      requestId,
    );
  } catch (error) {
    log.error('lito_voice_prepare_unhandled', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withStandardHeaders(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}
