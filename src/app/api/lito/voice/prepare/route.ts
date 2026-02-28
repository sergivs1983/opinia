export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { getLitoBizAccess } from '@/lib/lito/action-drafts';
import { resolveVoiceCapabilities } from '@/lib/lito/voice';
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

    const access = await getLitoBizAccess({
      supabase,
      userId: user.id,
      bizId: payload.biz_id,
    });
    if (!access.allowed || !access.orgId) {
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

    const capabilities = resolveVoiceCapabilities((orgData as OrganizationRow | null)?.ai_provider ?? null);
    if (!capabilities.enabled) {
      return withStandardHeaders(
        NextResponse.json(
          {
            error: 'voice_unavailable',
            reason: capabilities.reason,
            message: capabilities.message,
            request_id: requestId,
          },
          { status: 503 },
        ),
        requestId,
      );
    }

    return withStandardHeaders(
      NextResponse.json({
        ok: true,
        mode: capabilities.mode,
        maxSeconds: 30,
        upload: {
          mode: capabilities.mode,
          maxSeconds: 30,
        },
        provider: capabilities.provider,
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
