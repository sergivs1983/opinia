export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import {
  LITO_WORKER_DEFAULT_LIMIT,
  markLitoJobDone,
  markLitoJobFailedOrRetry,
  popLitoJobs,
  upsertLitoCardsCache,
} from '@/lib/lito/cards-cache';
import { buildActionCards } from '@/lib/lito/orchestrator';
import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { validateHmacHeader } from '@/lib/security/hmac';
import { createAdminClient } from '@/lib/supabase/admin';

const BodySchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
});

const INTERNAL_PATH = '/api/_internal/lito/rebuild-cards';
const WORKER_ROLE = 'manager' as const;
const WORKER_SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

type BusinessOrgRow = {
  id: string;
  org_id: string;
};

function withNoStore(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('x-request-id', requestId);
  return response;
}

function parseBody(rawBody: string): { limit?: number } | null {
  if (!rawBody.trim()) return {};
  try {
    const parsedRaw = JSON.parse(rawBody) as unknown;
    const parsed = BodySchema.safeParse(parsedRaw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'POST /api/_internal/lito/rebuild-cards' });

  const rawBody = await request.text();
  const hmac = validateHmacHeader({
    timestampHeader: request.headers.get('x-opin-timestamp'),
    signatureHeader: request.headers.get('x-opin-signature'),
    method: 'POST',
    pathname: INTERNAL_PATH,
    rawBody,
  });

  if (!hmac.valid) {
    return withNoStore(
      NextResponse.json({ error: 'unauthorized', reason: hmac.reason, request_id: requestId }, { status: 401 }),
      requestId,
    );
  }

  const payload = parseBody(rawBody);
  if (payload === null) {
    return withNoStore(
      NextResponse.json({ error: 'bad_request', message: 'Invalid JSON body', request_id: requestId }, { status: 400 }),
      requestId,
    );
  }

  const admin = createAdminClient();
  const limit = payload.limit ?? LITO_WORKER_DEFAULT_LIMIT;

  try {
    const jobs = await popLitoJobs({ admin, limit });
    if (jobs.length === 0) {
      return withNoStore(
        NextResponse.json({ ok: true, processed: 0, failed: 0, request_id: requestId }),
        requestId,
      );
    }

    const bizIds = Array.from(new Set(jobs.map((job) => job.biz_id)));
    const { data: businessesData, error: businessErr } = await admin
      .from('businesses')
      .select('id, org_id')
      .in('id', bizIds);

    if (businessErr) {
      throw new Error(businessErr.message || 'lito_cards_worker_business_lookup_failed');
    }

    const businessMap = new Map<string, BusinessOrgRow>();
    for (const business of (businessesData || []) as BusinessOrgRow[]) {
      businessMap.set(business.id, business);
    }

    let processed = 0;
    let failed = 0;

    for (const job of jobs) {
      try {
        const business = businessMap.get(job.biz_id);
        if (!business) {
          throw new Error('business_not_found');
        }

        const cardsResult = await buildActionCards({
          admin,
          bizId: job.biz_id,
          orgId: business.org_id,
          userId: WORKER_SYSTEM_USER_ID,
          role: WORKER_ROLE,
        });

        await upsertLitoCardsCache({
          admin,
          bizId: job.biz_id,
          cards: cardsResult.cards,
          generatedAt: cardsResult.generatedAt,
          mode: cardsResult.mode,
          stale: false,
        });

        await markLitoJobDone({ admin, jobId: job.id });
        processed += 1;
      } catch (error) {
        failed += 1;
        log.warn('lito_cards_worker_job_failed', {
          job_id: job.id,
          biz_id: job.biz_id,
          attempts: job.attempts,
          error: error instanceof Error ? error.message : String(error),
        });

        await markLitoJobFailedOrRetry({
          admin,
          job: { id: job.id, attempts: job.attempts },
          error,
        }).catch((markErr) => {
          log.error('lito_cards_worker_mark_failed_retry_failed', {
            job_id: job.id,
            biz_id: job.biz_id,
            error: markErr instanceof Error ? markErr.message : String(markErr),
          });
        });
      }
    }

    return withNoStore(
      NextResponse.json({
        ok: true,
        processed,
        failed,
        request_id: requestId,
      }),
      requestId,
    );
  } catch (error) {
    log.error('lito_cards_worker_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withNoStore(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}
