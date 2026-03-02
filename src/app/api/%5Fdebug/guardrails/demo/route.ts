export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getOrgEntitlements } from '@/lib/billing/entitlements';
import { resolveGuardrailDevHooks } from '@/lib/guards/dev-hooks';
import { isGuardrailError } from '@/lib/guards/errors';
import { enforceOrchestratorDailyCap } from '@/lib/guards/orchestrator-cap';
import { enforceOrgUserRateLimit } from '@/lib/guards/rate-limit';
import { resolveRateLimitsForPlan } from '@/lib/guards/rate-limit-config';
import { createLogger } from '@/lib/logger';
import { getLitoBizAccess } from '@/lib/lito/action-drafts';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const QuerySchema = z.object({
  biz_id: z.string().uuid(),
  kind: z.enum(['rate_limit', 'orchestrator_cap']),
});

function withStandardHeaders(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('x-request-id', requestId);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function buildRateLimitedMessage(retryAfter: number): string {
  return `Vas massa ràpid. Torna-ho a provar en ${retryAfter} segons.`;
}

function nextUtcDayStartIso(base: Date = new Date()): string {
  return new Date(Date.UTC(
    base.getUTCFullYear(),
    base.getUTCMonth(),
    base.getUTCDate() + 1,
    0,
    0,
    0,
    0,
  )).toISOString();
}

export async function GET(request: Request): Promise<NextResponse> {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'GET /api/_debug/guardrails/demo' });

  if (process.env.NODE_ENV === 'production') {
    return withStandardHeaders(
      NextResponse.json({ ok: false, error: 'not_found', request_id: requestId }, { status: 404 }),
      requestId,
    );
  }

  const url = new URL(request.url);
  const query = QuerySchema.safeParse({
    biz_id: url.searchParams.get('biz_id'),
    kind: url.searchParams.get('kind'),
  });
  if (!query.success) {
    return withStandardHeaders(
      NextResponse.json(
        {
          ok: false,
          error: 'bad_request',
          message: query.error.issues[0]?.message || 'Query invàlida',
          request_id: requestId,
        },
        { status: 400 },
      ),
      requestId,
    );
  }

  const supabase = createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return withStandardHeaders(
      NextResponse.json({ ok: false, error: 'unauthorized', message: 'Auth required', request_id: requestId }, { status: 401 }),
      requestId,
    );
  }

  const access = await getLitoBizAccess({
    supabase,
    userId: user.id,
    bizId: query.data.biz_id,
  });
  if (!access.allowed || !access.orgId) {
    return withStandardHeaders(
      NextResponse.json({ ok: false, error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
      requestId,
    );
  }

  const admin = createAdminClient();
  let entitlements: Awaited<ReturnType<typeof getOrgEntitlements>>;
  try {
    entitlements = await getOrgEntitlements({
      supabase: admin,
      orgId: access.orgId,
    });
  } catch (error) {
    log.error('guardrails_demo_entitlements_failed', {
      org_id: access.orgId,
      biz_id: query.data.biz_id,
      user_id: user.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return withStandardHeaders(
      NextResponse.json({ ok: false, error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
  const guardrailDevHooks = resolveGuardrailDevHooks(request);

  if (query.data.kind === 'rate_limit') {
    const rateLimits = resolveRateLimitsForPlan({
      key: 'lito_chat',
      planCode: entitlements.plan_code,
    });
    try {
      await enforceOrgUserRateLimit({
        supabase,
        orgId: access.orgId,
        userId: user.id,
        bizId: query.data.biz_id,
        key: 'lito_chat',
        orgLimitPerMin: rateLimits.orgLimitPerMin,
        userLimitPerMin: rateLimits.userLimitPerMin,
        requestId,
        forceRateLimit: guardrailDevHooks.forceRateLimit,
      });
    } catch (error) {
      if (isGuardrailError(error) && error.code === 'rate_limited') {
        const retryAfter = Math.max(1, Math.min(60, Number(error.meta.retryAfter || 60)));
        return withStandardHeaders(
          NextResponse.json(
            {
              ok: false,
              code: 'rate_limited',
              message: buildRateLimitedMessage(retryAfter),
              request_id: requestId,
              retry_after: retryAfter,
            },
            { status: 429 },
          ),
          requestId,
        );
      }

      log.error('guardrails_demo_rate_limit_failed', {
        org_id: access.orgId,
        biz_id: query.data.biz_id,
        user_id: user.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return withStandardHeaders(
        NextResponse.json({ ok: false, error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
        requestId,
      );
    }

    return withStandardHeaders(
      NextResponse.json({
        ok: true,
        kind: query.data.kind,
        forced: guardrailDevHooks.forceRateLimit,
        request_id: requestId,
      }),
      requestId,
    );
  }

  try {
    await enforceOrchestratorDailyCap({
      supabase,
      orgId: access.orgId,
      userId: user.id,
      bizId: query.data.biz_id,
      planCode: entitlements.plan_code,
      requestId,
      forceOrchestratorCap: guardrailDevHooks.forceOrchestratorCap,
    });
  } catch (error) {
    if (isGuardrailError(error) && error.code === 'orchestrator_cap_reached') {
      const resetsAt = error.meta.resetsAt || nextUtcDayStartIso();
      const body: Record<string, unknown> = {
        ok: false,
        code: 'orchestrator_cap_reached',
        message: 'Avui ja he fet moltes decisions. Torna-ho a provar demà.',
        request_id: requestId,
        resets_at: resetsAt,
      };
      if (entitlements.plan_code !== 'scale') {
        body.upgrade_url = '/dashboard/billing?plan=business';
      }
      return withStandardHeaders(
        NextResponse.json(body, { status: 429 }),
        requestId,
      );
    }

    log.error('guardrails_demo_orchestrator_cap_failed', {
      org_id: access.orgId,
      biz_id: query.data.biz_id,
      user_id: user.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return withStandardHeaders(
      NextResponse.json({ ok: false, error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }

  return withStandardHeaders(
    NextResponse.json({
      ok: true,
      kind: query.data.kind,
      forced: guardrailDevHooks.forceOrchestratorCap,
      request_id: requestId,
    }),
    requestId,
  );
}
