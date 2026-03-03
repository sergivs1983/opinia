export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { enqueueRebuildCards } from '@/lib/lito/cards-cache';
import { requireInternalGuard } from '@/lib/internal-guard';
import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { getOAuthTokens, saveOAuthTokens } from '@/lib/server/tokens';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  listGoogleReviews,
  refreshGoogleAccessToken,
  type GbpReviewSyncItem,
} from '@/lib/integrations/google/reviews';

const INTERNAL_PATH = '/api/_internal/gbp/reviews/sync';
const UPSERT_CHUNK_SIZE = 200;

const BodySchema = z.object({
  biz_id: z.string().uuid(),
});

type BusinessRow = {
  id: string;
  org_id: string;
  google_location_name: string | null;
  google_location_id: string | null;
  google_account_id: string | null;
};

type IntegrationRow = {
  id: string;
  biz_id: string;
  account_id: string | null;
  is_active: boolean | null;
};

function jsonNoStore(body: Record<string, unknown>, requestId: string, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('x-request-id', requestId);
  return response;
}

function normalizeAccountName(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('accounts/')) return trimmed;
  return `accounts/${trimmed}`;
}

function normalizeLocationName(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('accounts/') && trimmed.includes('/locations/')) {
    const marker = trimmed.indexOf('/locations/');
    return trimmed.slice(marker + 1);
  }
  if (trimmed.startsWith('locations/')) return trimmed;
  if (/^\d+$/.test(trimmed)) return `locations/${trimmed}`;
  return null;
}

function buildLocationResources(input: {
  business: BusinessRow;
  integration: IntegrationRow;
}): string[] {
  const candidates = new Set<string>();

  const locationName = normalizeLocationName(input.business.google_location_name)
    || normalizeLocationName(input.business.google_location_id);
  const accountName = normalizeAccountName(input.business.google_account_id)
    || normalizeAccountName(input.integration.account_id);

  if (locationName && locationName.startsWith('accounts/')) {
    candidates.add(locationName);
  }
  if (accountName && locationName) {
    candidates.add(`${accountName}/${locationName}`);
  }
  if (locationName) {
    candidates.add(locationName);
  }

  return Array.from(candidates);
}

async function upsertReviews(input: {
  admin: ReturnType<typeof createAdminClient>;
  bizId: string;
  reviews: GbpReviewSyncItem[];
}): Promise<number> {
  if (input.reviews.length === 0) return 0;

  let upserted = 0;
  for (let index = 0; index < input.reviews.length; index += UPSERT_CHUNK_SIZE) {
    const chunk = input.reviews.slice(index, index + UPSERT_CHUNK_SIZE);
    const rows = chunk.map((review) => ({
      biz_id: input.bizId,
      gbp_review_id: review.gbpReviewId,
      star_rating: review.starRating,
      comment_preview: review.commentPreview,
      reviewer_label: review.reviewerLabel,
      create_time: review.createTime,
      has_reply: review.hasReply,
      reply_time: review.replyTime,
      synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

    const { error } = await input.admin
      .from('gbp_reviews')
      .upsert(rows, { onConflict: 'gbp_review_id' });

    if (error) {
      throw new Error(error.message || 'gbp_reviews_upsert_failed');
    }

    upserted += rows.length;
  }

  return upserted;
}

function isAuthFailure(input: { httpStatus: number; errorCode: string | null }): boolean {
  return input.httpStatus === 401
    || input.httpStatus === 403
    || input.errorCode === 'UNAUTHENTICATED'
    || input.errorCode === 'invalid_grant';
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

  const { data: businessData, error: businessError } = await admin
    .from('businesses')
    .select('id, org_id, google_location_name, google_location_id, google_account_id')
    .eq('id', bizId)
    .eq('is_active', true)
    .maybeSingle();

  if (businessError || !businessData) {
    return jsonNoStore({ error: 'not_found', message: 'Business not found', request_id: requestId }, requestId, 404);
  }

  const business = businessData as BusinessRow;
  const { data: integrationData, error: integrationError } = await admin
    .from('integrations')
    .select('id, biz_id, account_id, is_active')
    .eq('biz_id', bizId)
    .eq('provider', 'google_business')
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (integrationError) {
    log.error('gbp_reviews_sync_integration_lookup_failed', {
      biz_id: bizId,
      error_code: integrationError.code || null,
      error: integrationError.message || null,
    });
    return jsonNoStore({ error: 'internal', message: 'Integration lookup failed', request_id: requestId }, requestId, 500);
  }

  if (!integrationData) {
    return jsonNoStore({ error: 'not_found', message: 'Google integration not found', request_id: requestId }, requestId, 404);
  }

  const integration = integrationData as IntegrationRow;
  const locationResources = buildLocationResources({ business, integration });
  if (locationResources.length === 0) {
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

  let tokens: { accessToken: string; refreshToken: string | null };
  try {
    tokens = await getOAuthTokens(admin, integration.id);
  } catch (error) {
    log.warn('gbp_reviews_sync_missing_tokens', {
      biz_id: bizId,
      integration_id: integration.id,
      error: error instanceof Error ? error.message : String(error),
    });
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

  let listed = await listGoogleReviews({
    accessToken: tokens.accessToken,
    locationResources,
    pageSize: 50,
    maxPages: 20,
  });

  if (!listed.ok && isAuthFailure({ httpStatus: listed.httpStatus, errorCode: listed.errorCode }) && tokens.refreshToken) {
    const clientId = process.env.GOOGLE_CLIENT_ID?.trim() || '';
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() || '';
    if (clientId && clientSecret) {
      const refreshed = await refreshGoogleAccessToken({
        refreshToken: tokens.refreshToken,
        clientId,
        clientSecret,
      });

      if (refreshed.ok) {
        const persistedRefreshToken = refreshed.refreshToken || tokens.refreshToken;
        await saveOAuthTokens(admin, integration.id, refreshed.accessToken, persistedRefreshToken);
        listed = await listGoogleReviews({
          accessToken: refreshed.accessToken,
          locationResources,
          pageSize: 50,
          maxPages: 20,
        });
      }
    }
  }

  if (!listed.ok) {
    log.warn('gbp_reviews_sync_upstream_failed', {
      biz_id: bizId,
      integration_id: integration.id,
      http_status: listed.httpStatus,
      error_code: listed.errorCode,
      error_message: listed.errorMessage,
      location_resource: listed.locationResource,
    });
    return jsonNoStore(
      {
        error: 'upstream_error',
        message: 'Google reviews sync failed',
        http_status: listed.httpStatus,
        error_code: listed.errorCode,
        request_id: requestId,
      },
      requestId,
      502,
    );
  }

  try {
    const upserted = await upsertReviews({
      admin,
      bizId,
      reviews: listed.reviews,
    });

    await admin
      .from('integrations')
      .update({ last_sync_at: new Date().toISOString() })
      .eq('id', integration.id);

    await enqueueRebuildCards({
      supabase: admin,
      bizId,
    });

    return jsonNoStore(
      {
        ok: true,
        biz_id: bizId,
        location_resource: listed.locationResource,
        synced: listed.fetched,
        upserted,
        request_id: requestId,
      },
      requestId,
      200,
    );
  } catch (error) {
    log.error('gbp_reviews_sync_failed', {
      biz_id: bizId,
      integration_id: integration.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonNoStore(
      { error: 'internal', message: 'Error intern del servidor', request_id: requestId },
      requestId,
      500,
    );
  }
}
