export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { validateCsrf } from '@/lib/security/csrf';

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { requireBizAccessPatternB } from '@/lib/api-handler';
import { createLogger, createRequestId } from '@/lib/logger';
import { rebuildMetricsLastDays } from '@/lib/metrics';
import { validateBody, MetricsRebuildBodySchema } from '@/lib/validations';

interface MetricsRebuildBody {
  days: number;
}

export async function POST(request: Request) {
  const blocked = validateCsrf(request); if (blocked) return blocked;

  const requestId = request.headers.get('x-request-id')?.trim() || createRequestId();
  const log = createLogger({ request_id: requestId, route: '/api/metrics/rebuild' });

  const withResponseRequestId = (response: NextResponse) => {
    response.headers.set('x-request-id', requestId);
    return response;
  };

  try {
    const supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return withResponseRequestId(
        NextResponse.json({ error: 'unauthorized', message: 'Auth required', request_id: requestId }, { status: 401 }),
      );
    }

    const [body, bodyErr] = await validateBody(request, MetricsRebuildBodySchema);
    if (bodyErr) return withResponseRequestId(bodyErr);
    const payload = body as MetricsRebuildBody;

    const businessId = request.headers.get('x-biz-id')?.trim();
    const access = await requireBizAccessPatternB(request, businessId, {
      supabase,
      user,
      headerBizId: businessId || null,
    });
    if (access instanceof NextResponse) return withResponseRequestId(access);

    const isOwner = access.role === 'owner';
    const featureFlag = process.env.METRICS_REBUILD_ENABLED === 'true';

    if (!isOwner && !featureFlag) {
      return withResponseRequestId(
        NextResponse.json(
          {
            error: 'forbidden',
            message: 'Metrics rebuild is restricted to owners (or METRICS_REBUILD_ENABLED=true).',
            request_id: requestId,
          },
          { status: 404 },
        ),
      );
    }

    const rebuilt = await rebuildMetricsLastDays(access.bizId, {
      days: payload.days,
      log,
    });

    return withResponseRequestId(
      NextResponse.json({
        ok: true,
        businessId: access.bizId,
        ...rebuilt,
        request_id: requestId,
      }),
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown';
    log.error('Unhandled metrics rebuild error', { error: message });
    return withResponseRequestId(
      NextResponse.json(
        { error: 'internal_error', message: 'Error intern del servidor', request_id: requestId },
        { status: 500 },
      ),
    );
  }
}
