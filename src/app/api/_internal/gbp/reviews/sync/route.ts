export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { enqueueRebuildCards } from '@/lib/lito/cards-cache';
import { requireInternalGuard } from '@/lib/internal-guard';
import { createLogger } from '@/lib/logger';
import {
  createGoogleReviewsProvider,
  ReviewsProviderError,
} from '@/lib/providers/google/google-reviews-provider';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { createAdminClient } from '@/lib/supabase/admin';

const INTERNAL_PATH = '/api/_internal/gbp/reviews/sync';

const BodySchema = z.object({
  biz_id: z.string().uuid(),
});

function jsonNoStore(body: Record<string, unknown>, requestId: string, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('x-request-id', requestId);
  return response;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'POST /api/_internal/gbp/reviews/sync' });
  const rawBody = await request.text();

  const blocked = requireInternalGuard(request, {
    requestId,
    mode: 'hmac',
    rawBody,
    pathname: INTERNAL_PATH,
  });
  if (blocked) {
    blocked.headers.set('Cache-Control', 'no-store');
    blocked.headers.set('x-request-id', requestId);
    return blocked;
  }

  let payloadRaw: unknown = {};
  if (rawBody.trim().length > 0) {
    try {
      payloadRaw = JSON.parse(rawBody);
    } catch {
      return jsonNoStore({ error: 'bad_request', message: 'Invalid JSON body', request_id: requestId }, requestId, 400);
    }
  }

  const parsed = BodySchema.safeParse(payloadRaw);
  if (!parsed.success) {
    return jsonNoStore(
      { error: 'bad_request', message: parsed.error.issues[0]?.message || 'Invalid request', request_id: requestId },
      requestId,
      400,
    );
  }

  const bizId = parsed.data.biz_id;
  const admin = createAdminClient();
  const provider = createGoogleReviewsProvider({
    supabase: admin,
    log,
  });

  try {
    const synced = await provider.syncReviews(bizId);

    if (synced.skipped === 'missing_location') {
      return jsonNoStore(
        {
          ok: true,
          biz_id: bizId,
          synced: 0,
          upserted: 0,
          skipped: 'missing_location',
          request_id: requestId,
        },
        requestId,
        200,
      );
    }

    if (synced.skipped === 'needs_reauth') {
      return jsonNoStore(
        {
          ok: true,
          biz_id: bizId,
          synced: 0,
          upserted: 0,
          skipped: 'needs_reauth',
          request_id: requestId,
        },
        requestId,
        200,
      );
    }

    await enqueueRebuildCards({
      supabase: admin,
      bizId,
    });

    const upserted = synced.imported + synced.updated + synced.unchanged;

    return jsonNoStore(
      {
        ok: true,
        biz_id: bizId,
        location_resource: synced.location_resource || null,
        synced: synced.total_fetched ?? upserted,
        upserted,
        request_id: requestId,
      },
      requestId,
      200,
    );
  } catch (error) {
    if (error instanceof ReviewsProviderError) {
      if (error.code === 'not_found') {
        return jsonNoStore(
          { error: 'not_found', message: error.message, request_id: requestId },
          requestId,
          404,
        );
      }

      if (error.code === 'upstream_error') {
        log.warn('gbp_reviews_sync_upstream_failed', {
          biz_id: bizId,
          integration_id: error.integrationId || null,
          http_status: error.httpStatus || null,
          error_code: error.errorCode || null,
          error_message: error.message,
        });

        return jsonNoStore(
          {
            error: 'upstream_error',
            message: 'Google reviews sync failed',
            http_status: error.httpStatus || 502,
            error_code: error.errorCode || null,
            request_id: requestId,
          },
          requestId,
          502,
        );
      }

      log.error('gbp_reviews_sync_provider_failed', {
        biz_id: bizId,
        integration_id: error.integrationId || null,
        error_code: error.errorCode || error.code,
        error: error.message,
      });
    } else {
      log.error('gbp_reviews_sync_failed', {
        biz_id: bizId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return jsonNoStore(
      { error: 'internal', message: 'Error intern del servidor', request_id: requestId },
      requestId,
      500,
    );
  }
}
